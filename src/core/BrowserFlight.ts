import type { BrowserFlightFunction, BrowserFlightInterface } from './types.js'

/**
 * One asynchronous transition at a time, shared by every caller that joins it.
 *
 * @remarks
 * An entity with a lifecycle runs the same guard around every transition: take
 * the promise already in flight when one exists, otherwise start the work, hold
 * its promise, and release the field afterwards only when it is still this
 * attempt's. Holding that guard in one place keeps the identity check — the
 * part a hand-written copy drops — identical at every site. The entry guards
 * stay with each entity, because what makes a transition unnecessary is the
 * entity's own state.
 *
 * @example
 * ```ts
 * import { BrowserFlight } from '@orkestrel/browser'
 *
 * const starting = new BrowserFlight()
 * await starting.execute(() => transport.start())
 * const joined = starting.attempt // the in-flight promise, or undefined
 * ```
 */
export class BrowserFlight<T = void> implements BrowserFlightInterface<T> {
	#attempt: Promise<T> | undefined

	get attempt(): Promise<T> | undefined {
		return this.#attempt
	}

	async execute(work: BrowserFlightFunction<T>): Promise<T> {
		const active = this.#attempt
		if (active !== undefined) return await active

		const attempt = work()
		this.#attempt = attempt
		try {
			return await attempt
		} finally {
			if (this.#attempt === attempt) this.#attempt = undefined
		}
	}
}
