import type { BrowserHoldInterface } from './types.js'

/**
 * Owns a replay's caller token and releases its admission reservation once.
 *
 * @example
 * ```ts
 * const hold = await toolset.hold('add-kettle')
 * try {
 * 	await toolset.perform(call, { caller: hold.token, signal })
 * } finally {
 * 	hold.destroy()
 * }
 * ```
 */
export class BrowserHold implements BrowserHoldInterface {
	readonly #name: string
	readonly #token = crypto.randomUUID()
	#release: (() => void) | undefined

	constructor(name: string, release: () => void) {
		this.#name = name
		this.#release = release
	}

	get name(): string {
		return this.#name
	}

	get token(): string {
		return this.#token
	}

	destroy(): void {
		const release = this.#release
		this.#release = undefined
		release?.()
	}
}
