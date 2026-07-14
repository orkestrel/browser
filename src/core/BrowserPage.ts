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
	#client: CDPClientInterface
	#targetId: string
	#sessionId: string
	#writer: ScreenshotWriterInterface | undefined
	#url = 'about:blank'
	#closed = false
	#codegen: BrowserCodegen | undefined
	#destroyHandler: (params: Readonly<Record<string, unknown>>) => void

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
		this.#destroyHandler = (params) => {
			if (isString(params['targetId']) && params['targetId'] === this.#targetId) {
				this.#closed = true
			}
		}
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
		const result = await this.#evaluate('document.title')
		return typeof result === 'string' ? result : ''
	}

	async navigate(url: string, options?: BrowserNavigationOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		const condition = options?.condition ?? 'load'

		// Set up load event listener before navigating
		const wait = this.#waitForLoadEvent(condition, timeout)

		// Never let wait.promise reject unobserved — convert to an outcome
		const waitOutcome = wait.promise.then(
			() => ({ ok: true as const }),
			(error: unknown) => ({ ok: false as const, error }),
		)

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

			// Wait for the load condition
			const outcome = await waitOutcome
			if (!outcome.ok) throw outcome.error
		} catch (error) {
			wait.cancel()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}

		const currentUrl = await this.#evaluate('location.href')
		this.#url = typeof currentUrl === 'string' ? currentUrl : url
	}

	async content(): Promise<BrowserContentResult> {
		const [title, html, text, currentUrl] = await Promise.all([
			this.#evaluate('document.title'),
			this.#evaluate(
				guardEvaluateExpression('document.documentElement.outerHTML', BROWSER_RESULT_LIMIT),
			),
			this.#evaluate('document.body ? document.body.innerText : ""'),
			this.#evaluate('location.href'),
		])

		if (typeof currentUrl === 'string') {
			this.#url = currentUrl
		}

		return {
			url: this.#url,
			title: typeof title === 'string' ? title : '',
			html: typeof html === 'string' ? html : '',
			text: typeof text === 'string' ? text : '',
		}
	}

	async screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
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
				const width = typeof contentSize['width'] === 'number' ? contentSize['width'] : 0
				const height = typeof contentSize['height'] === 'number' ? contentSize['height'] : 0

				if (width > 0 && height > 0) {
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
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		await this.#evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.scrollIntoView({ block: 'center' }); el.click(); } else { throw new Error('Element not found: ' + ${JSON.stringify(selector)}); } })()`,
		)
	}

	async fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void> {
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
		return this.#evaluate(guardEvaluateExpression(expression, BROWSER_RESULT_LIMIT))
	}

	async wait(selector: string, options?: BrowserActionOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
	}

	async frame(name: string): Promise<BrowserFrame | undefined> {
		const frames = await this.frames()
		return frames.find((frame) => frame.name === name || frame.url === name)
	}

	async frames(): Promise<readonly BrowserFrame[]> {
		const result: unknown = await this.#client.send('Page.getFrameTree', undefined, this.#sessionId)

		if (!isRecord(result) || !isRecord(result['frameTree'])) return []

		const frames: BrowserFrame[] = []
		this.#flattenFrameTree(result['frameTree'], frames)
		return frames
	}

	async codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface> {
		if (this.#codegen !== undefined) return this.#codegen

		const codegen = new BrowserCodegen(this.#client, this.#sessionId, options)
		await codegen.start()
		this.#codegen = codegen
		return codegen
	}

	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true

		// Tear down the recorder first so it can detach CDP listeners cleanly
		if (this.#codegen !== undefined) {
			try {
				await this.#codegen.destroy()
			} catch {
				// Swallow recorder teardown errors during page close
			}
			this.#codegen = undefined
		}

		// Unsubscribe from external close detection before sending close command
		this.#client.unsubscribe('Target.targetDestroyed', this.#destroyHandler)

		try {
			await this.#client.send('Target.closeTarget', { targetId: this.#targetId })
		} catch {
			// Target may already be closed
		}
	}

	// === Private helpers

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

	#waitForLoadEvent(
		condition: string,
		timeout: number,
	): { promise: Promise<void>; cancel: () => void } {
		const eventName =
			condition === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired'

		let settled = false
		let timer: ReturnType<typeof setTimeout>
		let handler: () => void

		const promise = new Promise<void>((resolve, reject) => {
			timer = setTimeout(() => {
				if (settled) return
				settled = true
				this.#client.unsubscribe(eventName, handler, this.#sessionId)
				reject(new BrowserError(`Navigation timeout after ${timeout}ms`))
			}, timeout)

			handler = (): void => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				this.#client.unsubscribe(eventName, handler, this.#sessionId)
				resolve()
			}

			this.#client.subscribe(eventName, handler, this.#sessionId)
		})

		const cancel = (): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			this.#client.unsubscribe(eventName, handler, this.#sessionId)
		}

		return { promise, cancel }
	}
}
