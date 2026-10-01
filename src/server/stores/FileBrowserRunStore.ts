import type {
	BrowserRun,
	BrowserRunSlot,
	BrowserRunStoreInterface,
	BrowserStoreOptions,
	BrowserStorePage,
} from '@src/core'
import type { FileBrowserStoreOptions } from '../types.js'
import { lstat, readdir, rm } from 'node:fs/promises'
import { isRecord, parseJSON } from '@orkestrel/contract'
import {
	BROWSER_JOURNEY_FORMAT_VERSION,
	BrowserError,
	generateBrowserRunId,
	validateBrowserRun,
} from '@src/core'
import {
	BROWSER_RUN_FILE,
	BROWSER_RUN_DIRECTORY,
	BROWSER_JOURNEY_LOCK_DIRECTORY,
} from '../constants.js'
import { FileBrowserStore } from './FileBrowserStore.js'

/**
 * Persists runs and captures only in directories allocated by this instance.
 * @remarks Requires an existing root. Reopened stores can read and delete saved runs.
 * @example
 * const store = new FileBrowserRunStore({ root: directory })
 * const slot = await store.open('check-ready')
 */
export class FileBrowserRunStore implements BrowserRunStoreInterface {
	readonly #files: FileBrowserStore
	readonly #slots = new WeakMap<BrowserRunSlot, string>()
	readonly #directories = new Set<string>()

	constructor(options: FileBrowserStoreOptions) {
		this.#files = new FileBrowserStore(options)
	}

	async open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		return this.#files.lock(
			this.#files.resolvePath(name, BROWSER_JOURNEY_LOCK_DIRECTORY),
			async () => {
				const directory = await this.#files.allocate(
					this.#files.resolvePath(name, BROWSER_RUN_DIRECTORY),
					generateBrowserRunId,
					options,
				)
				const slot = Object.freeze({ id: directory.id, directory: directory.path })
				this.#directories.add(directory.path)
				this.#slots.set(slot, directory.path)
				return slot
			},
			options,
		)
	}

	async get(
		name: string,
		id: string,
		options?: BrowserStoreOptions,
	): Promise<BrowserRun | undefined> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		this.#files.validateId(id)
		const path = this.#files.resolvePath(name, BROWSER_RUN_DIRECTORY, id, BROWSER_RUN_FILE)
		const source = await this.#files.read(path, options)
		if (source === undefined) return undefined
		try {
			const value = parseJSON(source)
			if (!isRecord(value) || !('format' in value))
				throw new BrowserError('Missing run format', 'BROWSER_JOURNEY_FILE')
			if (
				value['format'] === BROWSER_JOURNEY_FORMAT_VERSION &&
				(!isRecord(value['journey']) || !('format' in value['journey']))
			)
				throw new BrowserError('Missing run journey format', 'BROWSER_JOURNEY_FILE')
			validateBrowserRun(value)
			if (value.id !== id || value.journey.name !== name)
				throw new BrowserError('Run identity differs from its directory', 'BROWSER_JOURNEY_FILE')
			return value
		} catch (error) {
			throw this.#files.translateError(path, error)
		}
	}

	async set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(run.journey.name)
		this.#files.validateId(run.id)
		validateBrowserRun(run)
		const source = JSON.stringify(run)
		const directory = this.#files.resolvePath(run.journey.name, BROWSER_RUN_DIRECTORY, run.id)
		await this.#requireDirectory(directory, options)
		await this.#files.write(this.#files.resolvePath(directory, BROWSER_RUN_FILE), source, options)
	}

	async capture(
		slot: BrowserRunSlot,
		name: string,
		bytes: Uint8Array,
		options?: BrowserStoreOptions,
	): Promise<string> {
		options?.signal?.throwIfAborted()
		const directory = this.#slots.get(slot)
		if (directory === undefined || !/^s[1-9]\d*\.png$/.test(name))
			throw new BrowserError(
				'Capture requires an opened slot and an sN.png name',
				'BROWSER_JOURNEY_PATH',
			)
		const owned = new Uint8Array(bytes)
		await this.#requireDirectory(directory, options)
		await this.#files.write(this.#files.resolvePath(directory, name), owned, options)
		return name
	}

	async delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		this.#files.validateId(id)
		const directory = this.#files.resolvePath(name, BROWSER_RUN_DIRECTORY, id)
		await this.#files.check(this.#files.resolvePath(directory, BROWSER_RUN_FILE), options)
		try {
			options?.signal?.throwIfAborted()
			await rm(directory, { recursive: true, force: true, maxRetries: 3 })
			this.#directories.delete(directory)
			options?.signal?.throwIfAborted()
		} catch (error) {
			options?.signal?.throwIfAborted()
			throw this.#files.translateError(directory, error)
		}
	}

	async clear(name: string, options?: BrowserStoreOptions): Promise<number> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		const parent = this.#files.resolvePath(name, BROWSER_RUN_DIRECTORY)
		if (!(await this.#files.check(parent, options))) return 0
		return this.#files.lock(
			this.#files.resolvePath(name, BROWSER_JOURNEY_LOCK_DIRECTORY),
			async () => {
				try {
					options?.signal?.throwIfAborted()
					const ids = await readdir(parent)
					// Check the whole removal before deleting any run, including unsaved slots.
					for (const id of ids) {
						this.#files.validateId(id)
						await this.#files.check(this.#files.resolvePath(parent, id, BROWSER_RUN_FILE), options)
					}
					for (const id of ids) await this.delete(name, id, options)
					return ids.length
				} catch (error) {
					options?.signal?.throwIfAborted()
					throw this.#files.translateError(parent, error)
				}
			},
			options,
		)
	}

	async list(
		name: string,
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserRun>> {
		options?.signal?.throwIfAborted()
		this.#files.validateName(name)
		return this.#files.list(
			this.#files.resolvePath(name, BROWSER_RUN_DIRECTORY),
			(id) => this.get(name, id, options),
			options,
		)
	}

	async #requireDirectory(directory: string, options?: BrowserStoreOptions): Promise<void> {
		if (!this.#directories.has(directory) || !(await this.#files.check(directory, options)))
			throw new BrowserError(
				`Run directory was not opened or is missing: ${directory}`,
				'BROWSER_JOURNEY_PATH',
			)
		try {
			options?.signal?.throwIfAborted()
			const status = await lstat(directory)
			options?.signal?.throwIfAborted()
			if (!status.isDirectory())
				throw new BrowserError(
					`Run directory is not a directory: ${directory}`,
					'BROWSER_JOURNEY_PATH',
				)
		} catch (error) {
			options?.signal?.throwIfAborted()
			throw this.#files.translateError(directory, error)
		}
	}
}
