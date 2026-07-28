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
import {
	compileCodegenScript,
	normalizeCodegenActions,
	parseCodegenActionPayload,
	readCodegenNavigateAction,
} from './helpers.js'
import { Emitter } from '@orkestrel/emitter'

// === BrowserCodegen

/**
 * Records page navigation and form interactions and compiles replayable scripts.
 */
export class BrowserCodegen implements BrowserCodegenInterface {
	readonly #client: CDPClientInterface
	readonly #sessionId: string
	#actions: BrowserCodegenAction[] = []
	#started = false
	#destroyed = false
	#starting: Promise<void> | undefined
	#stopping: Promise<readonly BrowserCodegenAction[]> | undefined
	#shutdown: Promise<void> | undefined
	readonly #emitter: Emitter<BrowserCodegenEventMap>
	readonly #onBindingCalled = this.#handleBindingCalled.bind(this)
	readonly #onFrameNavigated = this.#handleFrameNavigated.bind(this)

	constructor(client: CDPClientInterface, sessionId: string, options?: BrowserCodegenOptions) {
		this.#client = client
		this.#sessionId = sessionId
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
		if (this.#stopping !== undefined) await this.#stopping
		if (this.#destroyed) return
		if (this.#started) return
		const active = this.#starting
		if (active !== undefined) {
			await active
			return
		}

		const attempt = this.#begin()
		this.#starting = attempt
		try {
			await attempt
		} finally {
			if (this.#starting === attempt) this.#starting = undefined
		}
	}

	async stop(): Promise<readonly BrowserCodegenAction[]> {
		await this.#starting?.catch(() => undefined)
		if (!this.#started) return this.actions()
		const active = this.#stopping
		if (active !== undefined) return await active

		const attempt = this.#end()
		this.#stopping = attempt
		try {
			return await attempt
		} finally {
			if (this.#stopping === attempt) this.#stopping = undefined
		}
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

	async #begin(): Promise<void> {
		this.#client.subscribe('Runtime.bindingCalled', this.#onBindingCalled, this.#sessionId)
		this.#client.subscribe('Page.frameNavigated', this.#onFrameNavigated, this.#sessionId)

		try {
			await this.#client.send('Runtime.enable', undefined, this.#sessionId)
			await this.#client.send(
				'Runtime.addBinding',
				{ name: BROWSER_CODEGEN_BINDING_NAME },
				this.#sessionId,
			)
			await this.#client.send(
				'Page.addScriptToEvaluateOnNewDocument',
				{ source: BROWSER_CODEGEN_SOURCE },
				this.#sessionId,
			)
			await this.#client.send(
				'Runtime.evaluate',
				{ expression: BROWSER_CODEGEN_SOURCE, awaitPromise: true },
				this.#sessionId,
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

	async #end(): Promise<readonly BrowserCodegenAction[]> {
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
		const action = readCodegenNavigateAction(params)
		if (action === undefined) return

		this.#actions.push(action)
		this.#emitter.emit('action', action)
	}

	#unsubscribe(): void {
		this.#client.unsubscribe('Runtime.bindingCalled', this.#onBindingCalled, this.#sessionId)
		this.#client.unsubscribe('Page.frameNavigated', this.#onFrameNavigated, this.#sessionId)
	}
}
