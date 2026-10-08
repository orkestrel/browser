import type {
	BrowserJourney,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserStoreOptions,
	BrowserStorePageOptions,
	BrowserJourneyWriteOptions,
	BrowserStorePage,
} from '@src/core'
import type { FileBrowserStoreOptions } from '../types.js'
import { isRecord, parseJSON } from '@orkestrel/contract'
import {
	BROWSER_JOURNEY_NAME_PATTERN,
	BrowserError,
	validateBrowserJourney,
	validateBrowserJourneyWriteOptions,
	normalizeBrowserJourneyReason,
} from '@src/core'
import {
	BROWSER_JOURNEY_SNAPSHOT_FILE,
	BROWSER_JOURNEY_REVISION_FILE,
	BROWSER_JOURNEY_LOCK_DIRECTORY,
} from '../constants.js'
import { FileBrowserStore } from './FileBrowserStore.js'

/**
 * Persists journeys with exclusive writes and revision counters retained across deletion.
 * @remarks Requires an existing root. A live holder refuses immediately; dead or empty locks are reclaimed within a bounded attempt count.
 * @example
 * const store = new FileBrowserJourneyStore({ root: directory })
 * await store.set(journey)
 */
export class FileBrowserJourneyStore implements BrowserJourneyStoreInterface {
	readonly #files: FileBrowserStore

	constructor(options: FileBrowserStoreOptions) {
		this.#files = new FileBrowserStore(options)
	}

	async get(
		name: string,
		options?: BrowserStoreOptions,
	): Promise<BrowserJourneyRevision | undefined> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		const path = this.#files.resolvePath(name, BROWSER_JOURNEY_SNAPSHOT_FILE)
		const source = await this.#files.read(path, options)
		if (source === undefined) return undefined
		try {
			const value = parseJSON(source)
			if (
				!isRecord(value) ||
				typeof value['revision'] !== 'number' ||
				!Number.isSafeInteger(value['revision']) ||
				value['revision'] < 1
			)
				throw new BrowserError('STORE_FILE', 'Malformed journey revision')
			if (!isRecord(value['journey']) || !('format' in value['journey']))
				throw new BrowserError('STORE_FILE', 'Missing journey format')
			validateBrowserJourney(value['journey'])
			if (value['journey'].name !== name)
				throw new BrowserError('STORE_FILE', 'Journey name differs from its directory')
			return { journey: value['journey'], revision: value['revision'] }
		} catch (error) {
			const translated = this.#files.translateError(path, error)
			throw new BrowserError(translated.code, translated.message, {
				...translated.context,
				reason: normalizeBrowserJourneyReason(error),
			})
		}
	}

	async set(
		journey: BrowserJourney,
		options?: BrowserJourneyWriteOptions,
	): Promise<BrowserJourneyRevision> {
		options?.signal?.throwIfAborted()
		validateBrowserJourneyWriteOptions(options)
		const condition = { revision: options?.revision, exclusive: options?.exclusive }
		this.#files.validateName(journey.name)
		validateBrowserJourney(journey)
		const owned = structuredClone(journey)
		const path = this.#files.resolvePath(owned.name, BROWSER_JOURNEY_SNAPSHOT_FILE)
		const counter = this.#files.resolvePath(owned.name, BROWSER_JOURNEY_REVISION_FILE)
		return this.#files.lock(
			this.#files.resolvePath(owned.name, BROWSER_JOURNEY_LOCK_DIRECTORY),
			async () => {
				const current = await this.get(owned.name, options)
				if (
					(condition.exclusive === true && current !== undefined) ||
					(condition.revision !== undefined && condition.revision !== current?.revision)
				)
					throw new BrowserError('JOURNEY_STALE', `Journey ${owned.name} changed since you read it`)
				const source = await this.#files.read(counter, options)
				const previous = source === undefined ? 0 : Number(source)
				if (!Number.isSafeInteger(previous) || previous < 0 || source?.trim() === '')
					throw new BrowserError('STORE_FILE', `Malformed revision: ${counter}`)
				const revision = Math.max(previous, current?.revision ?? 0) + 1
				if (!Number.isSafeInteger(revision))
					throw new BrowserError('STORE_FILE', `Exhausted revision: ${counter}`)
				const saved = { journey: owned, revision }
				await this.#files.write(path, JSON.stringify(saved), options)
				try {
					await this.#files.write(counter, String(revision), options)
				} catch (error) {
					// Rollback and lock cleanup must finish even when the caller aborts.
					if (current === undefined) await this.#files.remove(path)
					else await this.#files.write(path, JSON.stringify(current))
					throw error
				}
				return saved
			},
			options,
		)
	}

	async delete(name: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		await this.#files.lock(
			this.#files.resolvePath(name, BROWSER_JOURNEY_LOCK_DIRECTORY),
			async () => {
				const current = await this.get(name, options)
				if (current === undefined) return
				const counter = this.#files.resolvePath(name, BROWSER_JOURNEY_REVISION_FILE)
				const source = await this.#files.read(counter, options)
				const previous = source === undefined ? 0 : Number(source)
				if (!Number.isSafeInteger(previous) || previous < 0 || source?.trim() === '')
					throw new BrowserError('STORE_FILE', `Malformed revision: ${counter}`)
				// Preserve the committed revision even if a process exited before updating its counter.
				await this.#files.write(counter, String(Math.max(previous, current.revision ?? 0)), options)
				await this.#files.remove(
					this.#files.resolvePath(name, BROWSER_JOURNEY_SNAPSHOT_FILE),
					options,
				)
			},
			options,
		)
	}

	async list(options?: BrowserStorePageOptions): Promise<BrowserStorePage<BrowserJourneyRevision>> {
		options?.signal?.throwIfAborted()
		return this.#files.list(
			this.#files.resolvePath(),
			async (name) => {
				if (!BROWSER_JOURNEY_NAME_PATTERN.test(name)) return undefined
				return this.get(name, options)
			},
			options,
		)
	}
}
