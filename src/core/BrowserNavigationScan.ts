import type { BrowserNavigationSelection, BrowserNavigationStep } from './types.js'

/** Yields the settlement selected after each navigation step. */
export class BrowserNavigationScan extends Iterator<BrowserNavigationSelection, undefined> {
	readonly #steps: IteratorObject<BrowserNavigationStep>
	readonly #frames: ReadonlySet<string>
	readonly #any: boolean
	#start: Extract<BrowserNavigationStep, { readonly event: 'request' }> | undefined
	#commit: Extract<BrowserNavigationStep, { readonly event: 'commit' }> | undefined
	#ended = false

	constructor(steps: Iterable<BrowserNavigationStep>, frames: ReadonlySet<string>, any: boolean) {
		super()
		this.#steps = Iterator.from(steps)
		this.#frames = frames
		this.#any = any
	}

	next(): IteratorResult<BrowserNavigationSelection, undefined> {
		if (this.#ended) return { done: true, value: undefined }
		const next = this.#steps.next()
		if (next.done) {
			this.#ended = true
			return { done: false, value: this.#stage(false, false) }
		}
		const step = next.value
		const start = this.#start
		const commit = this.#commit
		if (step.event === 'request') {
			if (
				start === undefined
					? this.#any || this.#frames.has(step.frame)
					: step.frame === start.frame && commit === undefined
			)
				this.#start = step
			return { done: false, value: this.#stage(false, false) }
		}
		if (start === undefined || step.frame !== start.frame)
			return { done: false, value: this.#stage(false, false) }
		if (step.event === 'detach') {
			this.#ended = !step.swapped
			return { done: false, value: this.#stage(!step.swapped, false) }
		}
		if (step.event === 'commit') {
			if (commit !== undefined) return { done: false, value: this.#stage(false, false) }
			if (step.same) {
				this.#ended = true
				return {
					done: false,
					value: { done: true, result: { url: step.url, stage: 'loaded', reason: start.reason } },
				}
			}
			if (start.loader === undefined || step.loader === undefined || step.loader === start.loader)
				this.#commit = step
			return { done: false, value: this.#stage(false, false) }
		}
		this.#ended = commit !== undefined && step.loader === commit.loader
		return { done: false, value: this.#stage(this.#ended, this.#ended) }
	}

	#stage(done: boolean, loaded: boolean): BrowserNavigationSelection {
		const start = this.#start
		const commit = this.#commit
		return {
			done,
			result:
				start === undefined
					? undefined
					: commit === undefined
						? { url: start.url, stage: 'requested', reason: start.reason }
						: { url: commit.url, stage: loaded ? 'loaded' : 'committed', reason: start.reason },
		}
	}
}
