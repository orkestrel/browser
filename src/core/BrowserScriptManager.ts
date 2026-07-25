import type {
	BrowserBindingHandler,
	BrowserFrameInterface,
	BrowserScriptEntry,
	BrowserScriptManagerInterface,
} from './types.js'
import {
	compileBrowserBindingCleanup,
	compileBrowserBindingSource,
	compileBrowserBindingResult,
	readBrowserBindingCall,
	readBrowserScriptIdentifier,
} from './helpers.js'
import { BrowserError } from './errors.js'

/**
 * New-document scripts and promise-based host functions for one page.
 */
export class BrowserScriptManager implements BrowserScriptManagerInterface {
	readonly #frame: BrowserFrameInterface
	readonly #bindings: Map<string, BrowserBindingHandler> = new Map()
	readonly #scripts: Map<string, BrowserScriptEntry> = new Map()
	#subscribed = false
	#destroyed = false
	#bindingHandler = (params: Readonly<Record<string, unknown>>): void => {
		void this.#call(params).catch(() => undefined)
	}

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async add(source: string): Promise<string> {
		this.#assert()
		const result = await this.#frame.send('Page.addScriptToEvaluateOnNewDocument', { source })
		const id = readBrowserScriptIdentifier(result)
		this.#scripts.set(id, { source, binding: undefined })
		try {
			await this.#frame.evaluate(`(() => { ${source}\n })()`)
			return id
		} catch (error) {
			await this.#frame
				.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
				.catch(() => undefined)
			this.#scripts.delete(id)
			throw error
		}
	}

	async remove(id: string): Promise<void> {
		this.#assert()
		if (!this.#scripts.has(id)) return
		await this.#frame.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
		this.#scripts.delete(id)
	}

	async expose(name: string, handler: BrowserBindingHandler): Promise<void> {
		this.#assert()
		if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
			throw new BrowserError(
				'Browser binding name must be a valid JavaScript identifier',
				undefined,
				{
					name,
				},
			)
		}
		if (this.#bindings.has(name)) {
			throw new BrowserError('Browser binding already exists', undefined, { name })
		}
		const subscribed = this.#subscribed
		if (!subscribed) {
			await this.#frame.subscribe('Runtime.bindingCalled', this.#bindingHandler)
			this.#subscribed = true
		}
		let added = false
		try {
			await this.#frame.send('Runtime.addBinding', { name })
			added = true
			const id = await this.add(compileBrowserBindingSource(name))
			const entry = this.#scripts.get(id)
			if (entry === undefined) {
				throw new BrowserError('Browser binding script registration was lost', undefined, {
					name,
				})
			}
			this.#scripts.set(id, { source: entry.source, binding: name })
			this.#bindings.set(name, handler)
		} catch (error) {
			if (added) {
				await this.#frame.send('Runtime.removeBinding', { name }).catch(() => undefined)
			}
			if (!subscribed && this.#bindings.size === 0) {
				await this.#frame
					.unsubscribe('Runtime.bindingCalled', this.#bindingHandler)
					.catch(() => undefined)
				this.#subscribed = false
			}
			throw error
		}
	}

	async revoke(name: string): Promise<void> {
		this.#assert()
		if (!this.#bindings.has(name)) return
		for (const [id, entry] of this.#scripts) {
			if (entry.binding !== name) continue
			await this.#frame.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
			this.#scripts.delete(id)
		}
		await this.#frame.evaluate(compileBrowserBindingCleanup(name))
		await this.#frame.send('Runtime.removeBinding', { name })
		this.#bindings.delete(name)
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return
		for (const name of [...this.#bindings.keys()]) {
			await this.revoke(name).catch(() => undefined)
		}
		for (const id of [...this.#scripts.keys()]) {
			await this.remove(id).catch(() => undefined)
		}
		if (this.#subscribed) {
			await this.#frame
				.unsubscribe('Runtime.bindingCalled', this.#bindingHandler)
				.catch(() => undefined)
		}
		this.#subscribed = false
		this.#destroyed = true
	}

	async #call(params: Readonly<Record<string, unknown>>): Promise<void> {
		const call = readBrowserBindingCall(params)
		if (call === undefined) return
		const handler = this.#bindings.get(call.name)
		if (handler === undefined) return
		try {
			const value = await handler(...call.args)
			await this.#frame.send('Runtime.evaluate', {
				expression: compileBrowserBindingResult(call.name, call.id, true, value),
				contextId: call.context,
				awaitPromise: true,
			})
		} catch (error) {
			await this.#frame.send('Runtime.evaluate', {
				expression: compileBrowserBindingResult(call.name, call.id, false, String(error)),
				contextId: call.context,
				awaitPromise: true,
			})
		}
	}

	#assert(): void {
		if (this.#destroyed) throw new BrowserError('Browser script manager is destroyed')
	}
}
