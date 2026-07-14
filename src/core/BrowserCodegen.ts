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

export class BrowserCodegen implements BrowserCodegenInterface {
	#client: CDPClientInterface
	#sessionId: string
	#actions: BrowserCodegenAction[] = []
	#started = false
	#destroyed = false

	readonly #emitter: Emitter<BrowserCodegenEventMap>

	constructor(client: CDPClientInterface, sessionId: string, options?: BrowserCodegenOptions) {
		this.#client = client
		this.#sessionId = sessionId
		this.#emitter = new Emitter({ on: options?.on })
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
		if (this.#started) return
		this.#started = true

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
		} catch (error) {
			this.#client.unsubscribe('Runtime.bindingCalled', this.#onBindingCalled, this.#sessionId)
			this.#client.unsubscribe('Page.frameNavigated', this.#onFrameNavigated, this.#sessionId)
			this.#started = false
			throw error
		}

		this.#emitter.emit('start')
	}

	async stop(): Promise<readonly BrowserCodegenAction[]> {
		if (!this.#started) return this.actions()

		this.#client.unsubscribe('Runtime.bindingCalled', this.#onBindingCalled, this.#sessionId)
		this.#client.unsubscribe('Page.frameNavigated', this.#onFrameNavigated, this.#sessionId)

		this.#started = false

		const snapshot = this.actions()
		this.#emitter.emit('stop', snapshot)
		return snapshot
	}

	actions(): readonly BrowserCodegenAction[] {
		return normalizeCodegenActions(this.#actions)
	}

	script(options?: BrowserCodegenScriptOptions): string {
		return compileCodegenScript(this.actions(), options)
	}

	clear(): void {
		if (this.#actions.length === 0) {
			this.#emitter.emit('clear')
			return
		}
		this.#actions = []
		this.#emitter.emit('clear')
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return
		this.#destroyed = true

		try {
			await this.stop()
		} catch {
			// Swallow teardown errors — the underlying session may already be gone
		}

		this.#actions = []
		this.#emitter.destroy()
	}

	// === Private helpers

	#onBindingCalled = (params: Readonly<Record<string, unknown>>): void => {
		if (params['name'] !== BROWSER_CODEGEN_BINDING_NAME) return

		const action = parseCodegenActionPayload(params['payload'])
		if (action === undefined) return

		this.#actions.push(action)
		this.#emitter.emit('action', action)
	}

	#onFrameNavigated = (params: Readonly<Record<string, unknown>>): void => {
		const action = readCodegenNavigateAction(params)
		if (action === undefined) return

		this.#actions.push(action)
		this.#emitter.emit('action', action)
	}
}
