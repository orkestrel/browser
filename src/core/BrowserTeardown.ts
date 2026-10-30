import type { BrowserTeardownFunction, BrowserTeardownInterface } from './types.js'

/** Runs teardown steps in order while retaining the first failure, including undefined. */
export class BrowserTeardown implements BrowserTeardownInterface {
	readonly result: Promise<unknown>
	#failure: unknown
	#settled = false

	constructor(steps: readonly BrowserTeardownFunction[]) {
		this.result = this.#settle(steps)
	}

	async #settle(steps: readonly BrowserTeardownFunction[]): Promise<unknown> {
		for (const step of steps) {
			try {
				await step()
			} catch (error) {
				if (!this.#settled) {
					this.#failure = error
					this.#settled = true
				}
			}
		}
		return this.#failure
	}
}
