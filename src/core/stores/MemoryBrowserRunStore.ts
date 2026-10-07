import type {
	BrowserRun,
	BrowserRunSlot,
	BrowserRunStoreInterface,
	BrowserStoreOptions,
	BrowserStorePage,
} from '../types.js'
import { BrowserError } from '../errors.js'
import {
	generateBrowserRunId,
	validateBrowserRun,
	validateBrowserJourneyName,
	validateBrowserStorePage,
} from '../helpers.js'

/**
 * Keeps owned runs under their journey names and producer ids without directories.
 * @example
 * const store = new MemoryBrowserRunStore()
 * const slot = await store.open('add-kettle')
 */
export class MemoryBrowserRunStore implements BrowserRunStoreInterface {
	readonly #runs = new Map<string, Map<string, BrowserRun>>()
	readonly #slots = new Map<string, Set<string>>()
	readonly #opened = new WeakMap<BrowserRunSlot, string>()

	async open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		const slots = this.#slots.get(name) ?? new Set<string>()
		let id = generateBrowserRunId()
		while (slots.has(id) || this.#runs.get(name)?.has(id)) id = generateBrowserRunId()
		slots.add(id)
		this.#slots.set(name, slots)
		const slot = { id }
		this.#opened.set(slot, name)
		return slot
	}

	async get(
		name: string,
		id: string,
		options?: BrowserStoreOptions,
	): Promise<BrowserRun | undefined> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		return structuredClone(this.#runs.get(name)?.get(id))
	}

	async set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		validateBrowserRun(run)
		if (!this.#slots.get(run.journey.name)?.has(run.id))
			throw new BrowserError('JOURNEY_PATH', 'The run was not opened by this store')
		const runs = this.#runs.get(run.journey.name) ?? new Map<string, BrowserRun>()
		runs.set(run.id, structuredClone(run))
		this.#runs.set(run.journey.name, runs)
	}

	async capture(
		slot: BrowserRunSlot,
		_name: string,
		_bytes: Uint8Array,
		options?: BrowserStoreOptions,
	): Promise<string | undefined> {
		options?.signal?.throwIfAborted()
		const journey = this.#opened.get(slot)
		if (journey === undefined || !this.#slots.get(journey)?.has(slot.id))
			throw new BrowserError('JOURNEY_PATH', 'The run slot was not opened by this store')
		// Memory stores own slots but have no directory in which to persist these bytes.
		return undefined
	}

	async delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		this.#runs.get(name)?.delete(id)
		this.#slots.get(name)?.delete(id)
	}

	async clear(name: string, options?: BrowserStoreOptions): Promise<number> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		const count = this.#slots.get(name)?.size ?? 0
		this.#runs.delete(name)
		this.#slots.delete(name)
		return count
	}

	async list(
		name: string,
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserRun>> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyName(name)
		const entries = [...(this.#runs.get(name)?.values() ?? [])].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		)
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
