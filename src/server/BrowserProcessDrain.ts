import type { BrowserProcessDrainInterface } from './types.js'
import { BROWSER_DRAIN_INTERVAL_MS } from './constants.js'

/** Waits for a process remainder whose host exposes no exit event. */
export class BrowserProcessDrain implements BrowserProcessDrainInterface {
	readonly #inspect: () => boolean | undefined
	readonly #deadline: number
	readonly #result: Promise<boolean | undefined>
	#confirmed = false

	constructor(inspect: () => boolean | undefined, timeout: number) {
		this.#inspect = inspect
		this.#deadline = performance.now() + timeout
		this.#result = this.#wait()
	}

	get result(): Promise<boolean | undefined> {
		return this.#result
	}

	async #wait(): Promise<boolean | undefined> {
		while (true) {
			const alive = this.#inspect()
			if (alive === false) return true
			if (alive === true) this.#confirmed = true
			const remaining = this.#deadline - performance.now()
			if (remaining <= 0) return this.#confirmed ? false : undefined
			await new Promise<void>((resolve) =>
				setTimeout(resolve, Math.min(BROWSER_DRAIN_INTERVAL_MS, remaining)),
			)
		}
	}
}
