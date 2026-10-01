import type { BrowserStoreOptions, BrowserStorePage, BrowserStoreFault } from '@src/core'
import type { FileBrowserStoreOptions } from '../types.js'
import type { FileHandle } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserError, BROWSER_JOURNEY_NAME_PATTERN } from '@src/core'
import { BROWSER_FILE_STORE_LIMIT, BROWSER_FILE_STORE_RESERVED } from '../constants.js'

/**
 * Shares confined filesystem operations between the journey and run stores.
 * @remarks Requires an existing root directory. Links present during a component check are refused;
 * replacement between a check and its use by another filesystem writer is outside this boundary.
 * @example
 * const files = new FileBrowserStore({ root: directory })
 * files.validateName('check-ready')
 */
export class FileBrowserStore {
	readonly #root: string
	readonly #limit: number

	constructor(options: FileBrowserStoreOptions) {
		this.#limit = options.limit ?? BROWSER_FILE_STORE_LIMIT
		if (!Number.isSafeInteger(this.#limit) || this.#limit < 0)
			throw new BrowserError(
				'The listing cap must be a nonnegative integer',
				'BROWSER_JOURNEY_PATH',
			)
		try {
			this.#root = realpathSync(options.root)
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
				throw new BrowserError(`Missing root: ${options.root}`, 'BROWSER_JOURNEY_PATH', {
					path: options.root,
				})
			throw this.translateError(options.root, error)
		}
	}

	/** Checks a journey name before filesystem access. @param name - Journey name */
	validateName(name: string): void {
		if (!BROWSER_JOURNEY_NAME_PATTERN.test(name) || BROWSER_FILE_STORE_RESERVED.includes(name))
			throw new BrowserError(`Refused journey name: ${name}`, 'BROWSER_JOURNEY_PATH')
	}

	/** Checks a run id before filesystem access. @param id - Producer id */
	validateId(id: string): void {
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9]{4}$/.test(id))
			throw new BrowserError(`Refused run id: ${id}`, 'BROWSER_JOURNEY_PATH')
	}

	/** Resolves a confined target. @param parts - Relative components @returns Absolute target */
	resolvePath(...parts: readonly string[]): string {
		const path = resolve(this.#root, ...parts)
		if (
			path !== this.#root &&
			!path.startsWith(this.#root.endsWith(sep) ? this.#root : this.#root + sep)
		)
			throw new BrowserError(`Refused path: ${path}`, 'BROWSER_JOURNEY_PATH')
		return path
	}

	/**
	 * Checks every existing component including the root and target.
	 * @param path - Absolute target
	 * @param options - Cancellation options
	 * @returns True if the target exists; false if a component is missing
	 */
	async check(path: string, options?: BrowserStoreOptions): Promise<boolean> {
		this.resolvePath(path)
		let current = this.#root
		const parts = relative(this.#root, path).split(sep).filter(Boolean)
		for (let index = 0; index <= parts.length; index += 1) {
			options?.signal?.throwIfAborted()
			try {
				const status = await lstat(current)
				options?.signal?.throwIfAborted()
				if (status.isSymbolicLink())
					throw new BrowserError(`Refused symbolic link: ${current}`, 'BROWSER_JOURNEY_PATH')
				if (index < parts.length && !status.isDirectory())
					throw new BrowserError(`Not a directory: ${current}`, 'BROWSER_JOURNEY_PATH')
			} catch (error) {
				options?.signal?.throwIfAborted()
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
				throw this.translateError(current, error)
			}
			const part = parts[index]
			if (part !== undefined) current = this.resolvePath(current, part)
		}
		return true
	}

	/** Creates checked directories one component at a time. @param path - Directory @param options - Cancellation options */
	async createDirectory(path: string, options?: BrowserStoreOptions): Promise<void> {
		if (await this.check(path, options)) return
		if (path === this.#root) throw new BrowserError(`Missing root: ${path}`, 'BROWSER_JOURNEY_PATH')
		await this.createDirectory(dirname(path), options)
		options?.signal?.throwIfAborted()
		try {
			await mkdir(path)
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
				throw this.translateError(path, error)
		}
		await this.check(path, options)
	}

	/** Reads an existing file without collapsing a fault to absence. @param path - File @param options - Cancellation options @returns Bytes as UTF-8, or absence */
	async read(path: string, options?: BrowserStoreOptions): Promise<string | undefined> {
		if (!(await this.check(path, options))) return undefined
		try {
			options?.signal?.throwIfAborted()
			const value = await readFile(path, { encoding: 'utf8', signal: options?.signal })
			options?.signal?.throwIfAborted()
			return value
		} catch (error) {
			options?.signal?.throwIfAborted()
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
			throw this.translateError(path, error)
		}
	}

	/** Atomically replaces a file and cleans its owned temporary file on failure. @param path - Destination @param value - Bytes or UTF-8 @param options - Cancellation options */
	async write(
		path: string,
		value: string | Uint8Array,
		options?: BrowserStoreOptions,
	): Promise<void> {
		const temporary = this.resolvePath(dirname(path), `.${randomUUID()}.tmp`)
		let owned = false
		try {
			await this.check(path, options)
			await this.check(temporary, options)
			options?.signal?.throwIfAborted()
			const file = await open(temporary, 'wx')
			owned = true
			try {
				options?.signal?.throwIfAborted()
				await file.writeFile(value, { signal: options?.signal })
			} finally {
				await file.close()
			}
			await this.check(path, options)
			await this.check(temporary, options)
			options?.signal?.throwIfAborted()
			await rename(temporary, path)
			owned = false
		} catch (error) {
			options?.signal?.throwIfAborted()
			throw this.translateError(path, error)
		} finally {
			if (owned) await this.remove(temporary)
		}
	}

	/** Removes a checked file, accepting absence. @param path - File @param options - Cancellation options */
	async remove(path: string, options?: BrowserStoreOptions): Promise<void> {
		if (!(await this.check(path, options))) return
		try {
			options?.signal?.throwIfAborted()
			await unlink(path)
		} catch (error) {
			options?.signal?.throwIfAborted()
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
				throw this.translateError(path, error)
		}
	}

	/**
	 * Holds an exclusive journey lock through a mutation and releases it on every outcome.
	 * Reclaims a dead process's lock and retries acquisition once; a live or unknown holder refuses.
	 * @param path - Lock file
	 * @param action - Mutation inside the lock
	 * @param options - Cancellation options
	 * @returns The mutation result
	 */
	async lock<T>(path: string, action: () => Promise<T>, options?: BrowserStoreOptions): Promise<T> {
		await this.createDirectory(dirname(path), options)
		await this.check(path, options)
		options?.signal?.throwIfAborted()
		let file: FileHandle | undefined
		for (let attempt = 0; attempt < 2; attempt += 1) {
			options?.signal?.throwIfAborted()
			try {
				file = await open(path, 'wx')
				break
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
					throw this.translateError(path, error)
				if (attempt !== 0) break
				const source = await this.read(path, options)
				// A holder can release its lock between exclusive create and the read.
				if (source === undefined) continue
				const pid = Number(source)
				if (!Number.isSafeInteger(pid) || pid <= 0) break
				try {
					process.kill(pid, 0)
					break
				} catch (cause) {
					// Permission denial and other failures do not establish that the holder died.
					if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) break
				}
				await this.remove(path, options)
			}
		}
		if (file === undefined)
			throw new BrowserError(`Journey is locked: ${path}`, 'BROWSER_JOURNEY_LOCKED')
		try {
			options?.signal?.throwIfAborted()
			await file
				.writeFile(String(process.pid), { signal: options?.signal })
				.catch((error: unknown) => {
					options?.signal?.throwIfAborted()
					throw this.translateError(path, error)
				})
			options?.signal?.throwIfAborted()
			return await action()
		} finally {
			await file.close()
			await this.remove(path)
		}
	}

	/**
	 * Lists readable entries in sorted order with a bounded page and one extra readable probe.
	 * @param path - Parent directory
	 * @param reader - Entry reader
	 * @param options - Paging and cancellation
	 * @returns Page and observed entry faults
	 */
	async list<T>(
		path: string,
		reader: (name: string) => Promise<T | undefined>,
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<T>> {
		const offset = options?.offset ?? 0
		const requested = options?.limit ?? this.#limit
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(requested) ||
			requested < 0
		)
			throw new BrowserError('Paging requires nonnegative integers', 'BROWSER_JOURNEY_PATH')
		const limit = Math.min(requested, this.#limit)
		const entries: T[] = []
		const faults: BrowserStoreFault[] = []
		if (!(await this.check(path, options))) return { entries, faults, truncated: false }
		let names: string[]
		try {
			options?.signal?.throwIfAborted()
			names = (await readdir(path)).sort()
		} catch (error) {
			options?.signal?.throwIfAborted()
			throw this.translateError(path, error)
		}
		let count = 0
		for (const name of names) {
			options?.signal?.throwIfAborted()
			try {
				const entry = await reader(name)
				if (entry === undefined) continue
				if (count++ < offset) continue
				if (entries.length === limit) return { entries, faults, truncated: true }
				entries.push(entry)
			} catch (error) {
				options?.signal?.throwIfAborted()
				faults.push({
					path: this.resolvePath(path, name),
					message: error instanceof Error ? error.message : String(error),
				})
			}
		}
		return { entries, faults, truncated: false }
	}

	/**
	 * Allocates a run directory exclusively, retrying colliding producer candidates.
	 * @param parent - Checked parent directory
	 * @param candidate - Producer id source
	 * @param options - Cancellation options
	 * @returns Allocated id and absolute directory
	 */
	async allocate(
		parent: string,
		candidate: () => string,
		options?: BrowserStoreOptions,
	): Promise<{ readonly id: string; readonly path: string }> {
		await this.createDirectory(parent, options)
		for (;;) {
			options?.signal?.throwIfAborted()
			const id = candidate()
			this.validateId(id)
			const path = this.resolvePath(parent, id)
			await this.check(path, options)
			try {
				options?.signal?.throwIfAborted()
				await mkdir(path)
				options?.signal?.throwIfAborted()
				return { id, path }
			} catch (error) {
				options?.signal?.throwIfAborted()
				if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue
				throw this.translateError(path, error)
			}
		}
	}

	/** Translates filesystem and validation failures with their path. @param path - Failed path @param error - Cause @returns Coded error */
	translateError(path: string, error: unknown): BrowserError {
		const code = error instanceof Error && 'code' in error ? error.code : undefined
		return new BrowserError(
			`${path}: ${error instanceof Error ? error.message : String(error)}`,
			code === 'EACCES' || code === 'EPERM'
				? 'BROWSER_JOURNEY_ACCESS'
				: error instanceof BrowserError && code !== 'BROWSER_JOURNEY_INVALID'
					? error.code
					: 'BROWSER_JOURNEY_FILE',
			{ path },
		)
	}
}
