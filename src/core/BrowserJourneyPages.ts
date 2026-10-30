import type {
	BrowserJourneyRevision,
	BrowserJourneyPagesInterface,
	BrowserJourneyStoreInterface,
	BrowserStorePage,
} from './types.js'

/** Iterates a store listing while retaining its offset between page requests. */
export class BrowserJourneyPages implements BrowserJourneyPagesInterface {
	readonly #store: BrowserJourneyStoreInterface
	readonly #signal: AbortSignal
	readonly #empty: boolean
	#offset = 0
	#page: BrowserStorePage<BrowserJourneyRevision> | undefined
	#ended = false

	constructor(store: BrowserJourneyStoreInterface, signal: AbortSignal, empty: boolean) {
		this.#store = store
		this.#signal = signal
		this.#empty = empty
	}

	[Symbol.asyncIterator](): this {
		return this
	}

	async next(): Promise<IteratorResult<BrowserStorePage<BrowserJourneyRevision>, undefined>> {
		if (this.#ended) return { done: true, value: undefined }
		if (this.#page !== undefined) {
			this.#offset += this.#page.entries.length
			if (!this.#page.truncated || (this.#empty && this.#page.entries.length === 0)) {
				this.#ended = true
				return { done: true, value: undefined }
			}
		}
		this.#page = await this.#store.list({ signal: this.#signal, offset: this.#offset })
		return { done: false, value: this.#page }
	}
}
