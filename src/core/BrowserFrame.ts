import type {
	BrowserActionOptions,
	BrowserContentResult,
	BrowserFrameInterface,
	BrowserHandleInterface,
	BrowserKeyboardInterface,
	BrowserMouseInterface,
	BrowserSelectorManagerInterface,
	BrowserSendOptions,
	BrowserSessionFunction,
	BrowserTouchInterface,
	BrowserWaitOptions,
	CDPHandler,
	CDPClientInterface,
} from './types.js'
import { BrowserHandle } from './BrowserHandle.js'
import { BrowserKeyboard } from './BrowserKeyboard.js'
import { BrowserMouse } from './BrowserMouse.js'
import { BrowserSelectorManager } from './BrowserSelectorManager.js'
import { BrowserTouch } from './BrowserTouch.js'
import { BROWSER_FRAME_WORLD_NAME, BROWSER_RESULT_LIMIT } from './constants.js'
import { compileGuardedEvaluateExpression } from './compilers.js'
import { readEvaluationResult, requireBrowserString } from './helpers.js'
import { BrowserError } from './errors.js'
import { isInteger, isRecord, isString } from '@orkestrel/contract'
import { createHTML, renderText } from '@orkestrel/html'

/**
 * Represents one attached document frame, evaluated through its own CDP execution world.
 *
 * @example
 * ```ts
 * import { BrowserFrame } from '@orkestrel/browser'
 *
 * const frame = new BrowserFrame(client, 'session-1', 'frame-1', 'https://example.com')
 * await frame.fill('[name=email]', 'ada@example.com')
 * const title = await frame.title()
 * ```
 */
export class BrowserFrame implements BrowserFrameInterface {
	readonly #client: CDPClientInterface
	readonly #session: string | BrowserSessionFunction
	readonly #id: string
	readonly #parent: string | undefined
	readonly #name: string | undefined
	readonly #isolated: boolean
	readonly #selectors: BrowserSelectorManager
	readonly #keyboard: BrowserKeyboard
	readonly #mouse: BrowserMouse
	readonly #touch: BrowserTouch
	#url: string

	constructor(
		client: CDPClientInterface,
		session: string | BrowserSessionFunction,
		id: string,
		url: string,
		parent?: string,
		name?: string,
		isolated = true,
	) {
		this.#client = client
		this.#session = session
		this.#id = id
		this.#url = url
		this.#parent = parent
		this.#name = name
		this.#isolated = isolated
		this.#selectors = new BrowserSelectorManager(this)
		this.#keyboard = new BrowserKeyboard(this)
		this.#mouse = new BrowserMouse(this)
		this.#touch = new BrowserTouch(this)
	}

	get id(): string {
		return this.#id
	}

	get parent(): string | undefined {
		return this.#parent
	}

	get name(): string | undefined {
		return this.#name
	}

	get url(): string {
		return this.#url
	}

	get selectors(): BrowserSelectorManagerInterface {
		return this.#selectors
	}

	get keyboard(): BrowserKeyboardInterface {
		return this.#keyboard
	}

	get mouse(): BrowserMouseInterface {
		return this.#mouse
	}

	get touch(): BrowserTouchInterface {
		return this.#touch
	}

	async title(): Promise<string> {
		this.assert()
		const result = await this.#evaluate('document.title')
		return requireBrowserString(result, 'Document title')
	}

	async content(): Promise<BrowserContentResult> {
		this.assert()
		const [title, html, text, currentUrl] = await Promise.all([
			this.#evaluate('document.title'),
			this.#captureHTML(),
			this.#evaluate(
				compileGuardedEvaluateExpression(
					'document.body ? document.body.innerText : ""',
					BROWSER_RESULT_LIMIT,
				),
			),
			this.#evaluate('location.href'),
		])

		const url = requireBrowserString(currentUrl, 'Document URL')
		this.#url = url
		return {
			url,
			title: requireBrowserString(title, 'Document title'),
			html: requireBrowserString(html, 'Document HTML'),
			text: requireBrowserString(text, 'Document text'),
		}
	}

	async article(): Promise<string> {
		this.assert()
		const html = requireBrowserString(await this.#captureHTML(), 'Document HTML')
		return renderText(createHTML(html).distill().document)
	}

	async click(selector: string, options?: BrowserActionOptions): Promise<void> {
		this.assert()
		await this.#selectors.css(selector).click(options)
	}

	async fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void> {
		this.assert()
		await this.#selectors.css(selector).fill(value, options)
	}

	async select(
		selector: string,
		values: readonly string[],
		options?: BrowserActionOptions,
	): Promise<void> {
		this.assert()
		await this.#selectors.css(selector).select(values, options)
	}

	async evaluate(expression: string, timeout?: number): Promise<unknown> {
		this.assert()
		return await this.#evaluate(
			compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT),
			timeout,
		)
	}

	async handle(expression: string): Promise<BrowserHandleInterface> {
		this.assert()
		const session = await this.#sessionId()
		const params: Record<string, unknown> = {
			expression,
			returnByValue: false,
			awaitPromise: true,
		}
		const context = await this.#context(session)
		if (context !== undefined) params['contextId'] = context
		const result = await this.#client.send('Runtime.evaluate', params, { session })
		if (
			!isRecord(result) ||
			!isRecord(result['result']) ||
			!isString(result['result']['objectId'])
		) {
			throw new BrowserError('Browser expression did not resolve to an object handle', undefined, {
				frame: this.#id,
			})
		}
		return new BrowserHandle(this.#client, session, result['result']['objectId'])
	}

	async wait(selector: string, options?: BrowserWaitOptions): Promise<void> {
		this.assert()
		await this.#selectors.css(selector).wait(options)
	}

	async send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserSendOptions,
	): Promise<unknown> {
		this.assert()
		return await this.#client.send(method, params, {
			session: await this.#sessionId(),
			...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
		})
	}

	async subscribe(method: string, handler: CDPHandler): Promise<void> {
		this.assert()
		this.#client.subscribe(method, handler, await this.#sessionId())
	}

	async unsubscribe(method: string, handler: CDPHandler): Promise<void> {
		this.#client.unsubscribe(method, handler, await this.#sessionId())
	}

	async save(path: string, _bytes: Uint8Array): Promise<void> {
		// Frames satisfy the persistence contract, but only top-level pages receive a writer.
		throw new BrowserError('Browser frame has no configured file writer', undefined, { path })
	}

	assert(): void {
		if (!this.#client.connected) {
			throw new BrowserError('Browser frame is disconnected', undefined, { frame: this.#id })
		}
	}

	update(url: string): void {
		this.#url = url
	}

	async #captureHTML(): Promise<unknown> {
		return await this.#evaluate(
			compileGuardedEvaluateExpression('document.documentElement.outerHTML', BROWSER_RESULT_LIMIT),
		)
	}

	async #evaluate(expression: string, timeout?: number): Promise<unknown> {
		const session = await this.#sessionId()
		const params: Record<string, unknown> = {
			expression,
			returnByValue: true,
			awaitPromise: true,
		}

		const context = await this.#context(session, timeout)
		if (context !== undefined) params['contextId'] = context

		const result = await this.#client.send('Runtime.evaluate', params, {
			session,
			...(timeout !== undefined ? { timeout } : {}),
		})
		return readEvaluationResult(result)
	}

	async #context(session: string, timeout?: number): Promise<number | undefined> {
		if (!this.#isolated) return undefined
		const world = await this.#client.send(
			'Page.createIsolatedWorld',
			{ frameId: this.#id, worldName: BROWSER_FRAME_WORLD_NAME },
			{ session, ...(timeout !== undefined ? { timeout } : {}) },
		)
		if (!isRecord(world) || !isInteger(world['executionContextId'])) {
			throw new BrowserError('Failed to create frame execution context', undefined, {
				frame: this.#id,
			})
		}
		return world['executionContextId']
	}

	async #sessionId(): Promise<string> {
		if (isString(this.#session)) return this.#session
		return await this.#session(this.#id)
	}
}
