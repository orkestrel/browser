import type {
	BrowserCodegenInterface,
	BrowserCodegenOptions,
	BrowserFrame,
	BrowserPageInterface,
	BrowserNavigationOptions,
	BrowserActionOptions,
	BrowserScreenshotOptions,
	BrowserContentResult,
	BrowserScreenshotResult,
	BrowserWaitUntil,
	CDPClientInterface,
	ScreenshotWriterInterface,
} from './types.js'
import { BrowserCodegen } from './BrowserCodegen.js'
import { BrowserError, BrowserResultLimitError, BrowserSelectorError } from './errors.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_RESULT_LIMIT,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_STOP_LOADING_TIMEOUT_MS,
	BROWSER_WAIT_POLL_INTERVAL_MS,
} from './constants.js'
import { decodeBase64, guardEvaluateExpression } from './helpers.js'
import { isRecord, isString } from '@orkestrel/contract'

// === BrowserPage

export class BrowserPage implements BrowserPageInterface {
	readonly #client: CDPClientInterface
	readonly #targetId: string
	readonly #sessionId: string
	readonly #writer: ScreenshotWriterInterface | undefined
	#url = 'about:blank'
	#closed = false
	#codegen: BrowserCodegen | undefined
	#codegenStart: Promise<BrowserCodegen> | undefined
	#navigation: Promise<void> | undefined
	#closing: Promise<void> | undefined
	#releasing: Promise<void> | undefined
	#loadEvent: string | undefined
	#loadTimer: ReturnType<typeof setTimeout> | undefined
	#loadResolve: (() => void) | undefined
	#loadReject: ((error: unknown) => void) | undefined
	#destroyHandler = (params: Readonly<Record<string, unknown>>): void => {
		if (!isString(params['targetId']) || params['targetId'] !== this.#targetId) return
		this.#closed = true
		void this.#release().catch(() => undefined)
	}
	#loadHandler = (): void => this.#resolveLoad()

	constructor(
		client: CDPClientInterface,
		targetId: string,
		sessionId: string,
		writer?: ScreenshotWriterInterface,
		url?: string,
	) {
		this.#client = client
		this.#targetId = targetId
		this.#sessionId = sessionId
		this.#writer = writer
		if (url !== undefined) this.#url = url

		// Subscribe to external close detection (browser-level event, global subscription)
		this.#client.subscribe('Target.targetDestroyed', this.#destroyHandler)
	}

	// === Property accessors

	get url(): string {
		return this.#url
	}

	get closed(): boolean {
		return this.#closed
	}

	// === Public API

	async title(): Promise<string> {
		this.#assertOpen()
		const result = await this.#evaluate('document.title')
		return this.#requireString(result, 'Document title')
	}

	async navigate(url: string, options?: BrowserNavigationOptions): Promise<void> {
		this.#assertOpen()
		while (this.#navigation !== undefined) {
			await this.#navigation.catch(() => undefined)
		}
		this.#assertOpen()
		const navigation = this.#navigate(url, options)
		this.#navigation = navigation

		try {
			await navigation
		} finally {
			if (this.#navigation === navigation) this.#navigation = undefined
		}
	}

	async content(): Promise<BrowserContentResult> {
		this.#assertOpen()
		const [title, html, text, currentUrl] = await Promise.all([
			this.#evaluate('document.title'),
			this.#evaluate(
				guardEvaluateExpression('document.documentElement.outerHTML', BROWSER_RESULT_LIMIT),
			),
			this.#evaluate(
				guardEvaluateExpression(
					'document.body ? document.body.innerText : ""',
					BROWSER_RESULT_LIMIT,
				),
			),
			this.#evaluate('location.href'),
		])

		const url = this.#requireString(currentUrl, 'Document URL')
		this.#url = url

		return {
			url,
			title: this.#requireString(title, 'Document title'),
			html: this.#requireString(html, 'Document HTML'),
			text: this.#requireString(text, 'Document text'),
		}
	}

	async screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
		this.#assertOpen()
		const format = options?.type ?? 'png'
		const params: Record<string, unknown> = { format }

		if (options?.quality !== undefined && format === 'jpeg') {
			params['quality'] = options.quality
		}

		if (options?.full === true) {
			// Get full page dimensions for full-page screenshot
			const metrics: unknown = await this.#client.send(
				'Page.getLayoutMetrics',
				undefined,
				this.#sessionId,
			)

			if (isRecord(metrics) && isRecord(metrics['contentSize'])) {
				const contentSize = metrics['contentSize']
				const width = contentSize['width']
				const height = contentSize['height']

				if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
					params['clip'] = { x: 0, y: 0, width, height, scale: 1 }
					params['captureBeyondViewport'] = true
				}
			}
		}

		const result: unknown = await this.#client.send(
			'Page.captureScreenshot',
			params,
			this.#sessionId,
		)

		if (!isRecord(result) || !isString(result['data'])) {
			throw new BrowserError('Screenshot failed: no data returned')
		}

		const bytes = decodeBase64(result['data'])

		if (options?.path !== undefined && this.#writer !== undefined) {
			await this.#writer.write(options.path, bytes)
		}

		return { bytes, path: options?.path }
	}

	async click(selector: string, options?: BrowserActionOptions): Promise<void> {
		this.#assertOpen()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		await this.#evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.scrollIntoView({ block: 'center' }); el.click(); } else { throw new Error('Element not found: ' + ${JSON.stringify(selector)}); } })()`,
		)
	}

	async fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void> {
		this.#assertOpen()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		await this.#evaluate(
			`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
                el.focus();
                if (el.isContentEditable) {
                    el.textContent = ${JSON.stringify(value)};
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    el.value = ${JSON.stringify(value)};
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            })()`,
		)
	}

	async select(
		selector: string,
		values: readonly string[],
		options?: BrowserActionOptions,
	): Promise<void> {
		this.#assertOpen()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		const valuesJson = JSON.stringify([...values])
		await this.#evaluate(
			`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
                const vals = ${valuesJson};
                for (const opt of el.options) {
                    opt.selected = vals.includes(opt.value);
                }
                el.dispatchEvent(new Event('change', { bubbles: true }));
            })()`,
		)
	}

	async evaluate(expression: string): Promise<unknown> {
		this.#assertOpen()
		return this.#evaluate(guardEvaluateExpression(expression, BROWSER_RESULT_LIMIT))
	}

	async wait(selector: string, options?: BrowserActionOptions): Promise<void> {
		this.#assertOpen()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
	}

	async frame(name: string): Promise<BrowserFrame | undefined> {
		const frames = await this.frames()
		return frames.find((frame) => frame.name === name || frame.url === name)
	}

	async frames(): Promise<readonly BrowserFrame[]> {
		this.#assertOpen()
		const result: unknown = await this.#client.send('Page.getFrameTree', undefined, this.#sessionId)

		if (!isRecord(result) || !isRecord(result['frameTree'])) return []

		const frames: BrowserFrame[] = []
		this.#flattenFrameTree(result['frameTree'], frames)
		return frames
	}

	async codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface> {
		this.#assertOpen()
		if (this.#codegen !== undefined) return this.#codegen
		const active = this.#codegenStart
		if (active !== undefined) return await active

		const attempt = this.#startCodegen(options)
		this.#codegenStart = attempt
		try {
			return await attempt
		} finally {
			if (this.#codegenStart === attempt) this.#codegenStart = undefined
		}
	}

	destroy(): Promise<void> {
		const active = this.#closing
		if (active !== undefined) return active

		this.#closed = true
		const closing = this.#destroy()
		this.#closing = closing
		return closing
	}

	close(): Promise<void> {
		const active = this.#closing
		if (active !== undefined) return active

		if (this.#closed) {
			const closing = this.#release()
			this.#closing = closing
			return closing
		}

		this.#closed = true
		const closing = this.#close()
		this.#closing = closing
		return closing
	}

	// === Private helpers

	async #navigate(url: string, options?: BrowserNavigationOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		const condition = options?.condition ?? 'load'

		const wait = this.#waitForLoadEvent(condition, timeout)
		void wait.catch(() => undefined)

		try {
			const result: unknown = await this.#client.send(
				'Page.navigate',
				{ url },
				this.#sessionId,
				timeout,
			)

			if (isRecord(result) && isString(result['errorText'])) {
				throw new BrowserError(`Navigation failed: ${result['errorText']}`)
			}

			await wait
		} catch (error) {
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}

		const currentUrl = await this.#evaluate('location.href')
		this.#url = this.#requireString(currentUrl, 'Navigation URL')
	}

	async #startCodegen(options?: BrowserCodegenOptions): Promise<BrowserCodegen> {
		const codegen = new BrowserCodegen(this.#client, this.#sessionId, options)
		await codegen.start()
		if (this.#closed) {
			await codegen.destroy()
			throw new BrowserError('Browser page is closed')
		}
		this.#codegen = codegen
		return codegen
	}

	async #destroy(): Promise<void> {
		await this.#release()
		try {
			await this.#client.send('Target.detachFromTarget', { sessionId: this.#sessionId })
		} catch {
			// The session may already be detached.
		}
	}

	async #close(): Promise<void> {
		await this.#release()

		try {
			await this.#client.send('Target.closeTarget', { targetId: this.#targetId })
		} catch {
			// The target may already be closed.
		}
	}

	#release(): Promise<void> {
		const active = this.#releasing
		if (active !== undefined) return active

		const release = this.#releaseResources()
		this.#releasing = release
		return release
	}

	async #releaseResources(): Promise<void> {
		this.#cancelLoad()
		await this.#codegenStart?.catch(() => undefined)

		if (this.#codegen !== undefined) {
			try {
				await this.#codegen.destroy()
			} catch {
				// The recorder's session may already be unavailable.
			}
			this.#codegen = undefined
		}

		this.#client.unsubscribe('Target.targetDestroyed', this.#destroyHandler)
	}

	#flattenFrameTree(node: Readonly<Record<string, unknown>>, out: BrowserFrame[]): void {
		const frame = node['frame']

		if (isRecord(frame) && isString(frame['id']) && isString(frame['url'])) {
			const parent = frame['parentId']
			const name = frame['name']

			out.push({
				id: frame['id'],
				...(isString(parent) ? { parent } : {}),
				...(isString(name) && name !== '' ? { name } : {}),
				url: frame['url'],
			})
		}

		const children = node['childFrames']
		if (Array.isArray(children)) {
			for (const child of children) {
				if (isRecord(child)) this.#flattenFrameTree(child, out)
			}
		}
	}

	// Best-effort: tells Chromium to abandon an in-flight navigation so the
	// renderer is not left wedged behind it. Bounded by a short cap (see
	// BROWSER_STOP_LOADING_TIMEOUT_MS) rather than the full per-call timeout,
	// so a wedged renderer cannot add up to the whole timeout to the failure
	// path; any failure here is swallowed so it never masks the original
	// navigate error.
	async #stopLoading(timeout: number): Promise<void> {
		try {
			await this.#client.send('Page.stopLoading', undefined, this.#sessionId, timeout)
		} catch {
			// Best-effort only — the original navigate error is what the caller receives
		}
	}

	async #evaluate(expression: string): Promise<unknown> {
		const result: unknown = await this.#client.send(
			'Runtime.evaluate',
			{
				expression,
				returnByValue: true,
				awaitPromise: true,
			},
			this.#sessionId,
		)

		if (!isRecord(result)) return undefined

		// Check for exceptions
		if (isRecord(result['exceptionDetails'])) {
			const details = result['exceptionDetails']
			if (isRecord(details['exception']) && isString(details['exception']['description'])) {
				const description = details['exception']['description']
				const limitMatch = BROWSER_RESULT_LIMIT_PATTERN.exec(description)
				if (limitMatch !== null) {
					throw new BrowserResultLimitError('Evaluation result exceeds BROWSER_RESULT_LIMIT', {
						length: Number(limitMatch[1]),
						limit: BROWSER_RESULT_LIMIT,
					})
				}
				throw new BrowserError(description)
			}
			throw new BrowserError('JavaScript evaluation failed')
		}

		// Extract the value from the result
		const remoteObject = result['result']
		if (!isRecord(remoteObject)) return undefined

		if ('value' in remoteObject) {
			return remoteObject['value']
		}

		return undefined
	}

	async #waitForSelector(selector: string, timeout: number): Promise<void> {
		const deadline = Date.now() + timeout
		const selectorJson = JSON.stringify(selector)

		while (Date.now() < deadline) {
			const found = await this.#evaluate(`document.querySelector(${selectorJson}) !== null`)
			if (found === true) return

			await new Promise((resolve) => setTimeout(resolve, BROWSER_WAIT_POLL_INTERVAL_MS))
		}

		throw new BrowserSelectorError(`Timeout waiting for selector: ${selector}`)
	}

	#waitForLoadEvent(condition: BrowserWaitUntil, timeout: number): Promise<void> {
		const eventName =
			condition === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired'
		const deferred = Promise.withResolvers<void>()
		this.#loadEvent = eventName
		this.#loadResolve = deferred.resolve
		this.#loadReject = deferred.reject
		this.#loadTimer = setTimeout(() => {
			this.#rejectLoad(new BrowserError(`Navigation timeout after ${timeout}ms`))
		}, timeout)
		this.#client.subscribe(eventName, this.#loadHandler, this.#sessionId)
		return deferred.promise
	}

	#resolveLoad(): void {
		const resolve = this.#loadResolve
		this.#clearLoad()
		resolve?.()
	}

	#rejectLoad(error: unknown): void {
		const reject = this.#loadReject
		this.#clearLoad()
		reject?.(error)
	}

	#cancelLoad(): void {
		this.#rejectLoad(new BrowserError('Navigation cancelled'))
	}

	#clearLoad(): void {
		if (this.#loadTimer !== undefined) clearTimeout(this.#loadTimer)
		if (this.#loadEvent !== undefined) {
			this.#client.unsubscribe(this.#loadEvent, this.#loadHandler, this.#sessionId)
		}
		this.#loadEvent = undefined
		this.#loadTimer = undefined
		this.#loadResolve = undefined
		this.#loadReject = undefined
	}

	#requireString(value: unknown, field: string): string {
		if (typeof value === 'string') return value
		throw new BrowserError(`${field} failed: no string value returned`)
	}

	#assertOpen(): void {
		if (this.#closed) throw new BrowserError('Browser page is closed')
	}
}
