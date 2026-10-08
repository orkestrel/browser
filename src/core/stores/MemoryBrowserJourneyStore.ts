import type {
	BrowserJourney,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserStoreOptions,
	BrowserStorePageOptions,
	BrowserJourneyWriteOptions,
	BrowserStorePage,
} from '../types.js'
import { BrowserError } from '../errors.js'
import {
	validateBrowserJourney,
	validateBrowserJourneyWriteOptions,
	validateBrowserJourneyName,
	validateBrowserStorePage,
} from '../helpers.js'

/**
 * Keeps owned journey snapshots and revision counters across deletion.
 * @example
 * const store = new MemoryBrowserJourneyStore()
 * await store.set(journey)
 */
export class MemoryBrowserJourneyStore implements BrowserJourneyStoreInterface {
	readonly #journeys = new Map<string, BrowserJourneyRevision>()
	readonly #revisions = new Map<string, number>()

	async get(
		name: string,
		options?: BrowserStoreOptions,
	): Promise<BrowserJourneyRevision | undefined> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		return structuredClone(this.#journeys.get(name))
	}

	async set(
		journey: BrowserJourney,
		options?: BrowserJourneyWriteOptions,
	): Promise<BrowserJourneyRevision> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyWriteOptions(options)
		validateBrowserJourneyName(journey.name)
		validateBrowserJourney(journey)
		const previous = this.#revisions.get(journey.name)
		if (
			(options?.exclusive === true && this.#journeys.get(journey.name) !== undefined) ||
			(options?.revision !== undefined &&
				options.revision !== this.#journeys.get(journey.name)?.revision)
		)
			throw new BrowserError('JOURNEY_STALE', `Journey ${journey.name} changed since you read it`)
		const revision = (previous ?? 0) + 1
		const saved = structuredClone({ journey, revision })
		this.#journeys.set(journey.name, saved)
		this.#revisions.set(journey.name, revision)
		return structuredClone(saved)
	}

	async delete(name: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		this.#journeys.delete(name)
	}

	async list(options?: BrowserStorePageOptions): Promise<BrowserStorePage<BrowserJourneyRevision>> {
		options?.signal?.throwIfAborted()
		const entries = [...this.#journeys.entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([, revision]) => revision)
		const offset = options?.offset ?? 0
		const limit = options?.limit ?? Math.max(1, entries.length)
		validateBrowserStorePage(offset, limit)
		return {
			entries: structuredClone(entries.slice(offset, offset + limit)),
			truncated: offset + limit < entries.length,
			faults: [],
		}
	}
}
