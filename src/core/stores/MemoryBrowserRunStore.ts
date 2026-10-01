import type {
	BrowserRun,
	BrowserRunSlot,
	BrowserRunStoreInterface,
	BrowserStoreOptions,
	BrowserStorePage,
} from '../types.js'
import { BrowserError } from '../errors.js'
import { generateBrowserRunId } from '../helpers.js'
import { validateBrowserRun } from '../validators.js'

/**
 * Keeps owned runs under their journey names and producer ids without directories.
 * @example
 * const store = new MemoryBrowserRunStore()
 * const slot = await store.open('add-kettle')
 */
export class MemoryBrowserRunStore implements BrowserRunStoreInterface {
	readonly #runs = new Map<string, Map<string, BrowserRun>>()
	readonly #slots = new Map<string, Set<string>>()
	readonly #opened = new WeakSet<BrowserRunSlot>()

	async open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot> {
		options?.signal?.throwIfAborted()
		const slots = this.#slots.get(name) ?? new Set<string>()
		let id = generateBrowserRunId()
		while (slots.has(id) || this.#runs.get(name)?.has(id)) id = generateBrowserRunId()
		slots.add(id)
		this.#slots.set(name, slots)
		const slot = { id }
		this.#opened.add(slot)
		return slot
	}

	async get(
		name: string,
		id: string,
		options?: BrowserStoreOptions,
	): Promise<BrowserRun | undefined> {
		options?.signal?.throwIfAborted()
		return structuredClone(this.#runs.get(name)?.get(id))
	}

	async set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		validateBrowserRun(run)
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
		if (!this.#opened.has(slot))
			throw new BrowserError('The run slot was not opened by this store', 'BROWSER_JOURNEY_PATH')
		// Memory stores own slots but have no directory in which to persist these bytes.
		return undefined
	}

	async delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#runs.get(name)?.delete(id)
	}

	async list(
		name: string,
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserRun>> {
		options?.signal?.throwIfAborted()
		const entries = [...(this.#runs.get(name)?.values() ?? [])].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		)
		const offset = options?.offset ?? 0
		const limit = options?.limit ?? entries.length
		return {
			entries: structuredClone(entries.slice(offset, offset + limit)),
			truncated: offset + limit < entries.length,
			faults: [],
		}
	}
}
