import type {
	BrowserCodegenInterface,
	BrowserCodegenOptions,
	BrowserPageInterface,
	BrowserNavigationOptions,
	BrowserActionOptions,
	BrowserScreenshotOptions,
	BrowserContentResult,
	BrowserScreenshotResult,
} from '../types.js'
import type { CDPClient } from './CDPClient'
import { BrowserCodegen } from './BrowserCodegen.js'
import { BrowserError, BrowserSelectorError } from '../errors.js'
import { BROWSER_DEFAULT_TIMEOUT_MS, BROWSER_WAIT_POLL_INTERVAL_MS } from '../constants.js'
import { isRecord, isString } from '@scsr/core'
import { writeFileSync } from 'node:fs'

// === BrowserPage

export class BrowserPage implements BrowserPageInterface {
	#client: CDPClient
	#targetId: string
	#sessionId: string
	#url = 'about:blank'
	#closed = false
	#codegen: BrowserCodegen | undefined
	#destroyHandler: (params: Readonly<Record<string, unknown>>) => void

	constructor(client: CDPClient, targetId: string, sessionId: string) {
		this.#client = client
		this.#targetId = targetId
		this.#sessionId = sessionId

		// Subscribe to external close detection (browser-level event, global subscription)
		this.#destroyHandler = (params) => {
			if (isString(params['targetId']) && params['targetId'] === this.#targetId) {
				this.#closed = true
			}
		}
		this.#client.subscribe('Target.targetDestroyed', this.#destroyHandler)
	}

	// === Property accessors

	get id(): string {
		return this.#targetId
	}

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
		const loadPromise = this.#waitForLoadEvent(condition, timeout)

		// Navigate
		const result: unknown = await this.#client.send('Page.navigate', { url }, this.#sessionId)

		if (isRecord(result) && isString(result['errorText'])) {
			throw new BrowserError(`Navigation failed: ${result['errorText']}`)
		}

		// Wait for the load condition
		await loadPromise

		const currentUrl = await this.#evaluate('location.href')
		this.#url = typeof currentUrl === 'string' ? currentUrl : url
	}

	async content(): Promise<BrowserContentResult> {
		const [title, html, text, currentUrl] = await Promise.all([
			this.#evaluate('document.title'),
			this.#evaluate('document.documentElement.outerHTML'),
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

		const bytes = new Uint8Array(Buffer.from(result['data'], 'base64'))

		if (options?.path !== undefined) {
			writeFileSync(options.path, bytes)
		}

		return { bytes, path: options?.path }
	}

	async click(selector: string, options?: BrowserActionOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		await this.#evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.scrollIntoView({ block: 'center' }); el.click(); } else { throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}'); } })()`,
		)
	}

	async fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
		await this.#evaluate(
			`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}');
                el.focus();
                el.value = ${JSON.stringify(value)};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
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
                if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}');
                const vals = ${valuesJson};
                for (const opt of el.options) {
                    opt.selected = vals.includes(opt.value);
                }
                el.dispatchEvent(new Event('change', { bubbles: true }));
            })()`,
		)
	}

	async evaluate(expression: string): Promise<unknown> {
		return this.#evaluate(expression)
	}

	async wait(selector: string, options?: BrowserActionOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		await this.#waitForSelector(selector, timeout)
	}

	frame(name: string): BrowserPageInterface | undefined {
		// Frame support requires Page.getFrameTree and session attachment
		// For MVP, frames are not supported via direct CDP
		void name
		return undefined
	}

	frames(): readonly BrowserPageInterface[] {
		// For MVP, frames are not enumerated via direct CDP
		return []
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
				throw new BrowserError(details['exception']['description'])
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

	#waitForLoadEvent(condition: string, timeout: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#client.unsubscribe(eventName, handler, this.#sessionId)
				reject(new BrowserError(`Navigation timeout after ${timeout}ms`))
			}, timeout)

			const eventName =
				condition === 'domcontentloaded'
					? 'Page.domContentEventFired'
					: condition === 'networkidle'
						? 'Page.loadEventFired'
						: 'Page.loadEventFired'

			const handler = (): void => {
				clearTimeout(timer)
				this.#client.unsubscribe(eventName, handler, this.#sessionId)
				resolve()
			}

			this.#client.subscribe(eventName, handler, this.#sessionId)
		})
	}
}
