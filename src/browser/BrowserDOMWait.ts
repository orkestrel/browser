import type { BrowserDOMWaitInterface, BrowserMutationWait } from './types.js'
import { attempt } from '@orkestrel/contract'
import { BROWSER_WAIT_EVENTS, BrowserError, describeBrowserRefusal } from '@src/core'
import { isBrowserDocument } from './helpers.js'

/**
 * Parks one condition on DOM mutations and finished transitions and animations until it holds, with one deadline and coalesced wake tasks.
 *
 * @remarks
 * The wait observes every root `roots` returns, each through a `MutationObserver` of that root's
 * realm, and re-reads the roots after every mutation batch, every capture-phase `load`, and
 * the task after a `BROWSER_WAIT_EVENTS` event in an observed root: a same-origin
 * frame or an open shadow root that appears joins the observation,
 * and a root that departed (a replaced frame document, a removed shadow root) leaves it, with its
 * observer disconnected and its listeners removed. The check runs before the wait parks and
 * again after every subscription, and no check runs once the deadline, counted from `start`, has
 * passed, which the wait reads again after `roots` returns. The wait settles one time: on the
 * check's first value, on the signal's abort with its reason, at the deadline with
 * `TIMEOUT`, on a `pagehide` in the first root's window with `GONE`, or with whatever
 * the check or the roots function throws. A signal that aborts while `check` or `roots` runs
 * settles the wait with its reason, and wins over a value that same check returns. Settlement
 * disconnects every observer and removes every listener synchronously, so a mutation queued
 * before it runs no check, and a `roots` or `check` that settles the wait from inside leaves no
 * observer, listener, or further check behind.
 *
 * A shadow root attached after the wait began is a declared limit: attaching one fires no
 * mutation record and no event, so the wait discovers it at the next mutation batch, `load`,
 * or `BROWSER_WAIT_EVENTS` event it observes, and a match inserted into it with no other
 * observed change is not seen before the deadline. The wait never polls to close that gap.
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
	readonly #observers = new Map<
		Node,
		{ readonly observer: MutationObserver; readonly release: AbortController }
	>()
	#main: Window | undefined
	#timer: ReturnType<typeof setTimeout> | undefined
	#task: ReturnType<typeof setTimeout> | undefined
	readonly #recheckHandler = this.#recheck.bind(this)
	readonly #scheduleHandler = this.#schedule.bind(this)
	readonly #wakeHandler = this.#wake.bind(this)
	readonly #unloadHandler = this.#unload.bind(this)

	constructor(wait: BrowserMutationWait<T>) {
		this.#wait = wait
	}

	get roots(): readonly Node[] {
		return [...this.#observers.keys()]
	}

	async execute(): Promise<T> {
		const signal = this.#wait.signal
		signal?.throwIfAborted()
		const first = this.#wait.check()
		// The abort listener is not registered yet, so an abort from inside the check is read here.
		signal?.throwIfAborted()
		if (first !== undefined) return first
		this.#timer = setTimeout(this.#expire.bind(this), Math.max(0, this.#remaining()))
		signal?.addEventListener('abort', () => this.#fail(signal.reason), {
			signal: this.#release.signal,
		})
		this.#recheck()
		return await this.#settled.promise
	}

	// Hidden documents suspend animation frames; tasks still run.
	#schedule(): void {
		if (this.#release.signal.aborted || this.#task !== undefined) return
		this.#task = setTimeout(this.#wakeHandler, 0)
	}

	#wake(): void {
		this.#task = undefined
		this.#recheck()
	}

	// Subscribes to every live root and prunes departed ones, then runs the check. From here on
	// the abort listener turns a caller's abort into settlement, so the release state carries it.
	#recheck(): void {
		if (this.#release.signal.aborted) return
		if (this.#remaining() <= 0) {
			this.#expire()
			return
		}
		const result = attempt(() => {
			this.#reconcile()
			if (this.#release.signal.aborted) return undefined
			if (this.#remaining() <= 0) {
				this.#expire()
				return undefined
			}
			return this.#wait.check()
		})
		if (!result.success) this.#fail(result.error)
		else if (result.value !== undefined) this.#succeed(result.value)
	}

	#reconcile(): void {
		const live = new Set(this.#wait.roots())
		if (this.#release.signal.aborted) return
		for (const [root, entry] of this.#observers) {
			if (live.has(root)) continue
			entry.observer.disconnect()
			entry.release.abort()
			this.#observers.delete(root)
		}
		for (const root of live) {
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
			const release = new AbortController()
			root.addEventListener('load', this.#recheckHandler, { capture: true, signal: release.signal })
			for (const name of BROWSER_WAIT_EVENTS)
				root.addEventListener(name, this.#scheduleHandler, {
					capture: true,
					signal: release.signal,
				})
			this.#observers.set(root, { observer, release })
			// Only the first root's window failing ends the wait; a child frame's unload is followed
			// by its next document's `load`, which reconciles the roots.
			if (this.#main !== undefined) continue
			this.#main = view
			view.addEventListener('pagehide', this.#unloadHandler, { signal: this.#release.signal })
		}
	}

	#remaining(): number {
		const now = this.#wait.now
		return this.#wait.start + this.#wait.timeout - (now === undefined ? performance.now() : now())
	}

	#expire(): void {
		this.#fail(
			new BrowserError('TIMEOUT', `${this.#wait.subject} timed out`, {
				operation: 'wait',
				timeout: this.#wait.timeout,
			}),
		)
	}

	#unload(): void {
		this.#fail(
			new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'document' }, 'GONE'), {
				subject: 'document',
				reason: 'GONE',
			}),
		)
	}

	#succeed(value: T): void {
		this.#stop()
		this.#settled.resolve(value)
	}

	#fail(error: unknown): void {
		this.#stop()
		this.#settled.reject(error)
	}

	// Releases every observer, listener, and the timer before the promise settles.
	#stop(): void {
		clearTimeout(this.#timer)
		clearTimeout(this.#task)
		this.#task = undefined
		this.#release.abort()
		for (const entry of this.#observers.values()) {
			entry.observer.disconnect()
			entry.release.abort()
		}
		this.#observers.clear()
	}
}
