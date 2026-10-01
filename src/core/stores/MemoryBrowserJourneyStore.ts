import type {
	BrowserJourney,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserStoreOptions,
	BrowserStorePage,
} from '../types.js'
import { BROWSER_JOURNEY_NAME_PATTERN } from '../constants.js'
import { BrowserError } from '../errors.js'
import { validateBrowserJourney } from '../helpers.js'

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
		if (!BROWSER_JOURNEY_NAME_PATTERN.test(name))
			throw new BrowserError(`Refused journey name: ${name}`, 'BROWSER_JOURNEY_PATH')
		return structuredClone(this.#journeys.get(name))
	}

	async set(
		journey: BrowserJourney,
		expected?: number,
		options?: BrowserStoreOptions,
	): Promise<BrowserJourneyRevision> {
		options?.signal?.throwIfAborted()
		validateBrowserJourney(journey)
		const previous = this.#revisions.get(journey.name)
		if (expected !== undefined && expected !== (this.#journeys.get(journey.name)?.revision ?? 0))
			throw new BrowserError(
				`Journey ${journey.name} changed since you read it`,
				'BROWSER_JOURNEY_STALE',
			)
		const revision = (previous ?? 0) + 1
		const saved = structuredClone({ journey, revision })
		this.#journeys.set(journey.name, saved)
		this.#revisions.set(journey.name, revision)
		return structuredClone(saved)
	}

	async delete(name: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		if (!BROWSER_JOURNEY_NAME_PATTERN.test(name))
			throw new BrowserError(`Refused journey name: ${name}`, 'BROWSER_JOURNEY_PATH')
		this.#journeys.delete(name)
	}

	async list(
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserJourneyRevision>> {
		options?.signal?.throwIfAborted()
		const entries = [...this.#journeys.entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([, revision]) => revision)
		const offset = options?.offset ?? 0
		const limit = options?.limit ?? Math.max(1, entries.length)
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
			throw new BrowserError(
				'Paging requires a nonnegative integer offset and a positive integer limit',
				'BROWSER_JOURNEY_ARGUMENT',
			)
		return {
			entries: structuredClone(entries.slice(offset, offset + limit)),
			truncated: offset + limit < entries.length,
			faults: [],
		}
	}
}
