import type { BrowserTransitionFunction, BrowserTransitionInterface } from './types.js'

/**
 * Runs one asynchronous transition at a time, shared by every caller that joins it.
 *
 * @remarks
 * An entity with a lifecycle runs the same guard around every transition: take
 * the promise already in flight when one exists, otherwise start the work, hold
 * its promise, and release the field afterwards only when it is still this
 * run's. Holding that guard in one place keeps the identity check — the part a
 * hand-written copy drops — identical at every site. The entry guards stay with
 * each entity, because what makes a transition unnecessary is the entity's own
 * state.
 *
 * @example
 * ```ts
 * import { BrowserTransition } from '@orkestrel/browser'
 *
 * const starting = new BrowserTransition()
 * await starting.execute(() => transport.start())
 * const joined = starting.pending // the in-flight promise, or undefined
 * ```
 */
export class BrowserTransition<T = void> implements BrowserTransitionInterface<T> {
	#pending: Promise<T> | undefined

	get pending(): Promise<T> | undefined {
		return this.#pending
	}

	async execute(work: BrowserTransitionFunction<T>): Promise<T> {
		const active = this.#pending
		if (active !== undefined) return await active

		const started = work()
		this.#pending = started
		try {
			return await started
		} finally {
			if (this.#pending === started) this.#pending = undefined
		}
	}
}
