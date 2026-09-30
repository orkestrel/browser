import type { BrowserDOMWaitInterface, BrowserMutationWait } from './types.js'
import { attempt } from '@orkestrel/contract'
import { BrowserElementError, BrowserError } from '@src/core'
import { isBrowserDocument } from './helpers.js'

/**
 * Parks one condition on DOM mutations until it holds, with one deadline and no other timer.
 *
 * @remarks
 * The wait observes every root `roots` returns, each through a `MutationObserver` of that root's
 * realm, and re-reads the roots after every mutation batch and every capture-phase `load` in an
 * observed document, so a same-origin frame or an open shadow root that appears later joins the
 * observation. The check runs before the wait parks and again after every subscription. The
 * deadline counts from `start`. The wait fails on the signal's abort with its reason, at the
 * deadline with `BROWSER_WAIT_TIMEOUT`, on a `pagehide` in the first root's window with `GONE`, and
 * with whatever the check or the roots function throws. Settlement disconnects every observer
 * and removes every listener, so a later mutation runs nothing.
 *
 * @example
 * ```ts
 * const ready = await new BrowserDOMWait({
 * 	roots: () => [document],
 * 	check: () => document.querySelector('#ready') ?? undefined,
 * 	timeout: 1_000,
 * 	start: performance.now(),
 * 	subject: 'Ready wait',
 * }).execute()
 * ```
 */
export class BrowserDOMWait<T> implements BrowserDOMWaitInterface<T> {
	readonly #wait: BrowserMutationWait<T>
	readonly #settled = Promise.withResolvers<T>()
	readonly #release = new AbortController()
	readonly #observers = new Map<Node, MutationObserver>()
	#main: Window | undefined
	readonly #recheckHandler = this.#recheck.bind(this)
	readonly #unloadHandler = this.#unload.bind(this)

	constructor(wait: BrowserMutationWait<T>) {
		this.#wait = wait
	}

	async execute(): Promise<T> {
		const signal = this.#wait.signal
		signal?.throwIfAborted()
		const first = this.#wait.check()
		if (first !== undefined) return first
		const remaining = Math.max(0, this.#wait.start + this.#wait.timeout - performance.now())
		const timer = setTimeout(() => {
			this.#settled.reject(
				new BrowserError(`${this.#wait.subject} timed out`, 'BROWSER_WAIT_TIMEOUT', {
					timeout: this.#wait.timeout,
				}),
			)
		}, remaining)
		signal?.addEventListener('abort', () => this.#settled.reject(signal.reason), {
			signal: this.#release.signal,
		})
		this.#recheck()
		try {
			return await this.#settled.promise
		} finally {
			clearTimeout(timer)
			this.#release.abort()
			for (const observer of this.#observers.values()) observer.disconnect()
			this.#observers.clear()
		}
	}

	// Subscribes to every root not yet observed, then runs the check.
	#recheck(): void {
		const result = attempt(() => {
			this.#reconcile()
			return this.#wait.check()
		})
		if (!result.success) this.#settled.reject(result.error)
		else if (result.value !== undefined) this.#settled.resolve(result.value)
	}

	#reconcile(): void {
		for (const root of this.#wait.roots()) {
			if (this.#observers.has(root)) continue
			const document = isBrowserDocument(root) ? root : root.ownerDocument
			const view = document?.defaultView ?? null
			if (view === null) continue
			const observer = new view.MutationObserver(this.#recheckHandler)
			observer.observe(root, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			})
			this.#observers.set(root, observer)
			root.addEventListener('load', this.#recheckHandler, {
				capture: true,
				signal: this.#release.signal,
			})
			// Only the first root's window failing ends the wait; a child frame's unload is followed
			// by its next document's `load`, which reconciles the roots.
			if (this.#main !== undefined) continue
			this.#main = view
			view.addEventListener('pagehide', this.#unloadHandler, { signal: this.#release.signal })
		}
	}

	#unload(): void {
		this.#settled.reject(new BrowserElementError({ subject: 'document' }, 'GONE'))
	}
}
