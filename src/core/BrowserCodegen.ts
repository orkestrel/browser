import type {
	BrowserCodegenAction,
	BrowserCodegenEventMap,
	BrowserCodegenInterface,
	BrowserCodegenOptions,
	BrowserCodegenScriptOptions,
	CDPClientInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BROWSER_CODEGEN_BINDING_NAME, BROWSER_CODEGEN_SOURCE } from './constants.js'
import { BrowserTransition } from './BrowserTransition.js'
import { compileCodegenScript } from './compilers.js'
import { normalizeCodegenActions } from './helpers.js'
import { parseCodegenActionPayload, parseCodegenNavigateAction } from './parsers.js'
import { Emitter } from '@orkestrel/emitter'

// === BrowserCodegen

/**
 * Records page navigation and form interactions and compiles replayable scripts.
 *
 * @example
 * ```ts
 * import { BrowserCodegen } from '@orkestrel/browser'
 *
 * const codegen = new BrowserCodegen(client, 'session-1')
 * await codegen.start()
 * const actions = await codegen.stop()
 * const script = codegen.script({ language: 'typescript' })
 * ```
 */
export class BrowserCodegen implements BrowserCodegenInterface {
	readonly #client: CDPClientInterface
	readonly #session: string
	#actions: BrowserCodegenAction[] = []
	#started = false
	#destroyed = false
	readonly #starting: BrowserTransition = new BrowserTransition()
	readonly #stopping: BrowserTransition<readonly BrowserCodegenAction[]> = new BrowserTransition()
	#shutdown: Promise<void> | undefined
	readonly #emitter: Emitter<BrowserCodegenEventMap>
	readonly #bindingCalledHandler = this.#handleBindingCalled.bind(this)
	readonly #frameNavigatedHandler = this.#handleFrameNavigated.bind(this)

	constructor(client: CDPClientInterface, session: string, options?: BrowserCodegenOptions) {
		this.#client = client
		this.#session = session
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
	}

	// === Property accessors

	get emitter(): EmitterInterface<BrowserCodegenEventMap> {
		return this.#emitter
	}

	get started(): boolean {
		return this.#started
	}

	// === Public API

	async start(): Promise<void> {
		if (this.#destroyed) return
		const stopping = this.#stopping.pending
		if (stopping !== undefined) await stopping
		if (this.#destroyed) return
		if (this.#started) return
		const active = this.#starting.pending
		if (active !== undefined) {
			await active
			return
		}

		await this.#starting.execute(() => this.#start())
	}

	async stop(): Promise<readonly BrowserCodegenAction[]> {
		await this.#starting.pending?.catch(() => undefined)
		if (!this.#started) return this.actions()
		const active = this.#stopping.pending
		if (active !== undefined) return await active

		return await this.#stopping.execute(() => this.#stop())
	}

	actions(): readonly BrowserCodegenAction[] {
		return normalizeCodegenActions(this.#actions)
	}

	script(options?: BrowserCodegenScriptOptions): string {
		return compileCodegenScript(this.actions(), options)
	}

	clear(): void {
		this.#actions = []
		this.#emitter.emit('clear')
	}

	destroy(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active
		if (this.#destroyed) return Promise.resolve()

		this.#destroyed = true
		const shutdown = this.#destroy()
		this.#shutdown = shutdown
		return shutdown
	}

	// === Private helpers

	async #start(): Promise<void> {
		this.#client.subscribe('Runtime.bindingCalled', this.#bindingCalledHandler, this.#session)
		this.#client.subscribe('Page.frameNavigated', this.#frameNavigatedHandler, this.#session)

		try {
			await this.#client.send('Runtime.enable', undefined, { session: this.#session })
			await this.#client.send(
				'Runtime.addBinding',
				{ name: BROWSER_CODEGEN_BINDING_NAME },
				{ session: this.#session },
			)
			await this.#client.send(
				'Page.addScriptToEvaluateOnNewDocument',
				{ source: BROWSER_CODEGEN_SOURCE },
				{ session: this.#session },
			)
			await this.#client.send(
				'Runtime.evaluate',
				{ expression: BROWSER_CODEGEN_SOURCE, awaitPromise: true },
				{ session: this.#session },
			)
			if (this.#destroyed) {
				this.#unsubscribe()
				return
			}
		} catch (error) {
			this.#unsubscribe()
			throw error
		}

		this.#started = true
		this.#emitter.emit('start')
	}

	async #stop(): Promise<readonly BrowserCodegenAction[]> {
		this.#unsubscribe()
		this.#started = false

		const snapshot = this.actions()
		this.#emitter.emit('stop', snapshot)
		return snapshot
	}

	async #destroy(): Promise<void> {
		try {
			await this.stop()
		} catch {
			// Swallow teardown errors — the underlying session may already be gone
		}

		this.#actions = []
		this.#emitter.destroy()
	}

	#handleBindingCalled(params: Readonly<Record<string, unknown>>): void {
		if (params['name'] !== BROWSER_CODEGEN_BINDING_NAME) return

		const action = parseCodegenActionPayload(params['payload'])
		if (action === undefined) return

		this.#actions.push(action)
		this.#emitter.emit('action', action)
	}

	#handleFrameNavigated(params: Readonly<Record<string, unknown>>): void {
		const action = parseCodegenNavigateAction(params)
		if (action === undefined) return

		this.#actions.push(action)
		this.#emitter.emit('action', action)
	}

	#unsubscribe(): void {
		this.#client.unsubscribe('Runtime.bindingCalled', this.#bindingCalledHandler, this.#session)
		this.#client.unsubscribe('Page.frameNavigated', this.#frameNavigatedHandler, this.#session)
	}
}
