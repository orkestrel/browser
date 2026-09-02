import type { BrowserHandleInterface, CDPClientInterface } from './types.js'
import { BrowserError } from './errors.js'
import { readEvaluationResult } from './helpers.js'
import { isRecord, isString } from '@orkestrel/contract'

/**
 * Represents one retained remote object in a frame execution context.
 */
export class BrowserHandle implements BrowserHandleInterface {
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #id: string
	#disposed = false

	constructor(client: CDPClientInterface, session: string, id: string) {
		this.#client = client
		this.#session = session
		this.#id = id
	}

	get id(): string {
		return this.#id
	}

	async value(): Promise<unknown> {
		return await this.call('function() { return this }')
	}

	async call(declaration: string, args?: readonly unknown[]): Promise<unknown> {
		this.#assert()
		const result = await this.#client.send(
			'Runtime.callFunctionOn',
			{
				objectId: this.#id,
				functionDeclaration: declaration,
				arguments: args?.map((value) => ({ value })),
				awaitPromise: true,
				returnByValue: true,
			},
			{ session: this.#session },
		)
		return readEvaluationResult(result)
	}

	async property(name: string): Promise<BrowserHandleInterface | undefined> {
		this.#assert()
		const result = await this.#client.send(
			'Runtime.callFunctionOn',
			{
				objectId: this.#id,
				functionDeclaration: 'function(name) { return this[name] }',
				arguments: [{ value: name }],
				awaitPromise: true,
				returnByValue: false,
			},
			{ session: this.#session },
		)
		if (!isRecord(result) || !isRecord(result['result'])) return undefined
		const id = result['result']['objectId']
		return isString(id) ? new BrowserHandle(this.#client, this.#session, id) : undefined
	}

	async properties(): Promise<Readonly<Record<string, unknown>>> {
		const value = await this.call(
			'function() { const values = {}; for (const key of Object.keys(this)) values[key] = this[key]; return values }',
		)
		if (!isRecord(value)) {
			throw new BrowserError('Browser handle properties did not resolve to an object')
		}
		return value
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		if (!this.#client.connected) return
		try {
			await this.#client.send(
				'Runtime.releaseObject',
				{ objectId: this.#id },
				{
					session: this.#session,
				},
			)
		} catch {
			// The execution context may already be gone.
		}
	}

	#assert(): void {
		if (this.#disposed) throw new BrowserError('Browser handle is disposed')
		if (!this.#client.connected) throw new BrowserError('Browser handle is disconnected')
	}
}
