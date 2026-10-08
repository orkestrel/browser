import type {
	BrowserCallOptions,
	BrowserDestination,
	BrowserNavigationEventMap,
	BrowserNavigationReason,
	BrowserNavigationRecordInterface,
	BrowserSettlementOptions,
	BrowserSettlementResult,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { BrowserError } from './errors.js'
import { validateBrowserTimeout } from './helpers.js'

/**
 * Records the navigation steps a page accepts after it opens and settles the navigation an input
 * into one frame started.
 *
 * @remarks
 * `BrowserNavigationManager.record` constructs it over the page's navigation steps, the main
 * frame's id, and a lookup of the parent the page last recorded for a frame, which returns
 * `undefined` for a frame whose parent the page cannot name. `lifetime` aborts when the page
 * closes, with the error the record's pending waits reject with.
 *
 * @example
 * ```ts
 * const record = page.navigation.record(element.frame)
 * await element.click()
 * const settled = await record.settle({ destinations, timeout: 4_000 })
 * record.destroy()
 * ```
 */
export class BrowserNavigationRecord implements BrowserNavigationRecordInterface {
	readonly #steps: EmitterInterface<BrowserNavigationEventMap>
	readonly #main: string
	readonly #parent: (frame: string) => string | undefined
	readonly #frame: string
	readonly #lifetime: AbortSignal
	// Every step accepted since the record opened, in arrival order, so a settlement that learns its
	// destinations after the input selects among the steps that preceded it.
	readonly #log: Array<
		| {
				readonly event: 'request'
				readonly frame: string
				readonly url: string
				readonly loader: string | undefined
				readonly reason: BrowserNavigationReason | undefined
		  }
		| {
				readonly event: 'commit'
				readonly frame: string
				readonly url: string
				readonly loader: string | undefined
				readonly same: boolean
		  }
		| { readonly event: 'load'; readonly frame: string; readonly loader: string | undefined }
		| { readonly event: 'detach'; readonly frame: string; readonly swapped: boolean }
	> = []
	readonly #waits = new Map<
		symbol,
		{
			readonly timer: ReturnType<typeof setTimeout>
			readonly signal: AbortSignal | undefined
			readonly listener: (() => void) | undefined
			readonly resolve: () => void
			readonly reject: (error: unknown) => void
		}
	>()
	readonly #settlements = new Map<
		symbol,
		{
			readonly frames: ReadonlySet<string>
			readonly any: boolean
			readonly timer: ReturnType<typeof setTimeout>
			readonly signal: AbortSignal | undefined
			readonly listener: (() => void) | undefined
			readonly resolve: (result: BrowserSettlementResult | undefined) => void
			readonly reject: (error: unknown) => void
		}
	>()
	#ended: { readonly reason: unknown } | undefined
	readonly #requestHandler = this.#handleRequest.bind(this)
	readonly #commitHandler = this.#handleCommit.bind(this)
	readonly #loadHandler = this.#handleLoad.bind(this)
	readonly #detachHandler = this.#handleDetach.bind(this)
	readonly #closeHandler = this.#handleClose.bind(this)

	constructor(
		steps: EmitterInterface<BrowserNavigationEventMap>,
		main: string,
		parent: (frame: string) => string | undefined,
		frame: string,
		lifetime: AbortSignal,
	) {
		this.#steps = steps
		this.#main = main
		this.#parent = parent
		this.#frame = frame
		this.#lifetime = lifetime
		if (lifetime.aborted) {
			this.#ended = { reason: lifetime.reason }
			return
		}
		steps.on('request', this.#requestHandler)
		steps.on('commit', this.#commitHandler)
		steps.on('load', this.#loadHandler)
		steps.on('detach', this.#detachHandler)
		lifetime.addEventListener('abort', this.#closeHandler, { once: true })
	}

	async wait(options?: BrowserCallOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const signal = options?.signal
		if (this.#ended !== undefined) throw this.#ended.reason
		if (signal?.aborted === true) throw signal.reason
		if (this.#started()) return
		const deferred = Promise.withResolvers<void>()
		const id = Symbol('wait')
		const listener = signal === undefined ? undefined : this.#abortWait.bind(this, id, signal)
		if (listener !== undefined) signal?.addEventListener('abort', listener, { once: true })
		this.#waits.set(id, {
			timer: setTimeout(this.#expireWait.bind(this, id, timeout), timeout),
			signal,
			listener,
			resolve: deferred.resolve,
			reject: deferred.reject,
		})
		return await deferred.promise
	}

	async settle(options?: BrowserSettlementOptions): Promise<BrowserSettlementResult | undefined> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const signal = options?.signal
		if (this.#ended !== undefined) throw this.#ended.reason
		if (signal?.aborted === true) throw signal.reason
		const destinations = options?.destinations ?? []
		const [frames, any] = this.#resolveFrames(destinations)
		const selection = this.#select(frames, any)
		// Without a destination, a navigation that has not started when the settlement begins was not
		// the input's.
		if (selection.done || (selection.result === undefined && destinations.length === 0))
			return selection.result
		const deferred = Promise.withResolvers<BrowserSettlementResult | undefined>()
		const id = Symbol('settle')
		const listener = signal === undefined ? undefined : this.#abortSettlement.bind(this, id, signal)
		if (listener !== undefined) signal?.addEventListener('abort', listener, { once: true })
		this.#settlements.set(id, {
			frames,
			any,
			timer: setTimeout(this.#expireSettlement.bind(this, id), timeout),
			signal,
			listener,
			resolve: deferred.resolve,
			reject: deferred.reject,
		})
		return await deferred.promise
	}

	destroy(): void {
		this.#end(new BrowserError('CLOSED', 'Browser navigation record ended'))
	}

	#end(reason: unknown): void {
		if (this.#ended !== undefined) return
		this.#ended = { reason }
		this.#steps.off('request', this.#requestHandler)
		this.#steps.off('commit', this.#commitHandler)
		this.#steps.off('load', this.#loadHandler)
		this.#steps.off('detach', this.#detachHandler)
		this.#lifetime.removeEventListener('abort', this.#closeHandler)
		for (const id of [...this.#waits.keys()]) this.#releaseWait(id)?.reject(reason)
		for (const id of [...this.#settlements.keys()]) this.#releaseSettlement(id)?.reject(reason)
	}

	// The record's frame and every ancestor the page names, and the main frame, which is every
	// frame's ancestor.
	#collectAncestors(): Set<string> {
		const frames = new Set<string>([this.#main])
		let current: string | undefined = this.#frame
		while (current !== undefined && !frames.has(current)) {
			frames.add(current)
			current = this.#parent(current)
		}
		frames.add(this.#frame)
		return frames
	}

	// Resolves each destination to the frame it names; a parent the page cannot name makes every
	// frame eligible, and never stands for the main frame.
	#resolveFrames(
		destinations: readonly BrowserDestination[],
	): readonly [frames: ReadonlySet<string>, any: boolean] {
		const frames = this.#collectAncestors()
		let any = false
		for (const { frame, relationship } of destinations) {
			if (relationship === 'top') frames.add(this.#main)
			else if (relationship === 'self') frames.add(frame)
			else if (frame === this.#main) frames.add(this.#main)
			else {
				const parent = this.#parent(frame)
				if (parent === undefined) any = true
				else frames.add(parent)
			}
		}
		return [frames, any]
	}

	#started(): boolean {
		const frames = this.#collectAncestors()
		return this.#log.some((step) => step.event === 'request' && frames.has(step.frame))
	}

	// Replays the log against the eligible frames: the earliest eligible start, superseded by a
	// later start in its frame before the commit; the commit that carries its loader, or the
	// frame's first commit when either loader is unknown; and the load of the commit's loader, or a
	// same-document commit. `done` reports a completed navigation or a selected frame that detached.
	#select(
		frames: ReadonlySet<string>,
		any: boolean,
	): { readonly done: boolean; readonly result: BrowserSettlementResult | undefined } {
		let start:
			| {
					readonly frame: string
					readonly url: string
					readonly loader: string | undefined
					readonly reason: BrowserNavigationReason | undefined
			  }
			| undefined
		let commit: { readonly url: string; readonly loader: string | undefined } | undefined
		for (const step of this.#log) {
			if (step.event === 'request') {
				if (
					start === undefined
						? any || frames.has(step.frame)
						: step.frame === start.frame && commit === undefined
				)
					start = step
				continue
			}
			if (start === undefined || step.frame !== start.frame) continue
			if (step.event === 'detach') {
				if (!step.swapped) return { done: true, result: this.#stage(start, commit, false) }
				continue
			}
			if (step.event === 'commit') {
				if (commit !== undefined) continue
				if (step.same)
					return { done: true, result: { url: step.url, stage: 'loaded', reason: start.reason } }
				if (start.loader === undefined || step.loader === undefined || step.loader === start.loader)
					commit = step
				continue
			}
			if (commit !== undefined && step.loader === commit.loader)
				return { done: true, result: this.#stage(start, commit, true) }
		}
		return { done: false, result: this.#stage(start, commit, false) }
	}

	#stage(
		start:
			| { readonly url: string; readonly reason: BrowserNavigationReason | undefined }
			| undefined,
		commit: { readonly url: string } | undefined,
		loaded: boolean,
	): BrowserSettlementResult | undefined {
		if (start === undefined) return undefined
		if (commit === undefined) return { url: start.url, stage: 'requested', reason: start.reason }
		return { url: commit.url, stage: loaded ? 'loaded' : 'committed', reason: start.reason }
	}

	#wake(): void {
		if (this.#waits.size > 0 && this.#started())
			for (const id of [...this.#waits.keys()]) this.#resolveWait(id)
		for (const [id, settlement] of [...this.#settlements]) {
			const selection = this.#select(settlement.frames, settlement.any)
			if (selection.done) this.#resolveSettlement(id, selection.result)
		}
	}

	// The resolution waits one microtask, so a cancellation that lands in the same turn as the step
	// that completed the wait wins with its reason.
	#resolveWait(id: symbol): void {
		const wait = this.#releaseWait(id)
		if (wait !== undefined) queueMicrotask(this.#finishWait.bind(this, wait))
	}

	#finishWait(wait: {
		readonly signal: AbortSignal | undefined
		readonly resolve: () => void
		readonly reject: (error: unknown) => void
	}): void {
		if (wait.signal?.aborted === true) wait.reject(wait.signal.reason)
		else wait.resolve()
	}

	#resolveSettlement(id: symbol, result: BrowserSettlementResult | undefined): void {
		const settlement = this.#releaseSettlement(id)
		if (settlement !== undefined)
			queueMicrotask(this.#finishSettlement.bind(this, settlement, result))
	}

	#finishSettlement(
		settlement: {
			readonly signal: AbortSignal | undefined
			readonly resolve: (result: BrowserSettlementResult | undefined) => void
			readonly reject: (error: unknown) => void
		},
		result: BrowserSettlementResult | undefined,
	): void {
		if (settlement.signal?.aborted === true) settlement.reject(settlement.signal.reason)
		else settlement.resolve(result)
	}

	#expireWait(id: symbol, timeout: number): void {
		this.#releaseWait(id)?.reject(
			new BrowserError('TIMEOUT', 'Browser navigation wait timed out', {
				operation: 'wait',
				frame: this.#frame,
				timeout,
			}),
		)
	}

	#expireSettlement(id: symbol): void {
		const settlement = this.#settlements.get(id)
		if (settlement === undefined) return
		this.#resolveSettlement(id, this.#select(settlement.frames, settlement.any).result)
	}

	#abortWait(id: symbol, signal: AbortSignal): void {
		this.#releaseWait(id)?.reject(signal.reason)
	}

	#abortSettlement(id: symbol, signal: AbortSignal): void {
		this.#releaseSettlement(id)?.reject(signal.reason)
	}

	#releaseWait(id: symbol):
		| {
				readonly signal: AbortSignal | undefined
				readonly resolve: () => void
				readonly reject: (error: unknown) => void
		  }
		| undefined {
		const wait = this.#waits.get(id)
		if (wait === undefined) return undefined
		clearTimeout(wait.timer)
		if (wait.listener !== undefined) wait.signal?.removeEventListener('abort', wait.listener)
		this.#waits.delete(id)
		return wait
	}

	#releaseSettlement(id: symbol):
		| {
				readonly signal: AbortSignal | undefined
				readonly resolve: (result: BrowserSettlementResult | undefined) => void
				readonly reject: (error: unknown) => void
		  }
		| undefined {
		const settlement = this.#settlements.get(id)
		if (settlement === undefined) return undefined
		clearTimeout(settlement.timer)
		if (settlement.listener !== undefined)
			settlement.signal?.removeEventListener('abort', settlement.listener)
		this.#settlements.delete(id)
		return settlement
	}

	#handleRequest(
		frame: string,
		url: string,
		loader: string | undefined,
		reason: BrowserNavigationReason | undefined,
	): void {
		this.#log.push({ event: 'request', frame, url, loader, reason })
		this.#wake()
	}

	#handleCommit(frame: string, url: string, loader: string | undefined, same: boolean): void {
		this.#log.push({ event: 'commit', frame, url, loader, same })
		this.#wake()
	}

	#handleLoad(frame: string, loader: string | undefined): void {
		this.#log.push({ event: 'load', frame, loader })
		this.#wake()
	}

	#handleDetach(frame: string, swapped: boolean): void {
		this.#log.push({ event: 'detach', frame, swapped })
		this.#wake()
	}

	#handleClose(): void {
		this.#end(this.#lifetime.reason)
	}
}
