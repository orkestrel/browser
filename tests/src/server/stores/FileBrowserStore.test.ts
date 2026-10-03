import type { AsyncHook } from 'node:async_hooks'
import { describe, it, expect } from 'vitest'
import {
	createScratch,
	createLink,
	supportsFileLinks,
	supportsDirectoryLinks,
} from '@orkestrel/test/server'
import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validateBrowserRun } from '@src/core'
import { BROWSER_JOURNEY_LOCK_ATTEMPTS, formatBrowserLockEntry } from '@src/server'
import { FileBrowserStore } from '../../../../src/server/stores/FileBrowserStore.js'
import { BROWSER_RUN_FIXTURE } from '../../../setup.js'
import { BrowserLockObserver, observeBrowserFilesystem } from '../../../setupServer.js'

describe('FileBrowserStore', () => {
	it('preserves committed results when an empty lock removal races another writer', async () => {
		const scratch = createScratch()
		try {
			const lock = join(scratch.path, 'journey.lock')
			let committed = false
			let competing: Promise<unknown> | undefined
			let races = 0
			const failures: unknown[] = []
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (path !== lock || !committed) return
				races += 1
				competing = rmdir(lock).catch((error: unknown) => error)
			})
			for (let index = 0; index < 512; index += 1) {
				committed = false
				const result = await files
					.lock(lock, async () => {
						committed = true
						return index
					})
					.catch((error: unknown) => error)
				await competing
				if (result !== index) failures.push(result)
			}
			expect(races).toBe(512)
			expect(failures).toEqual([])
			expect(await readdir(scratch.path)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('preserves an unrelated rename failure when the destination is a directory', async () => {
		const scratch = createScratch()
		try {
			const path = scratch.ensure('destination')
			const files = new BrowserLockObserver({ root: scratch.path }, async (checked) => {
				if (checked.endsWith('.tmp') && existsSync(checked)) await unlink(checked)
			})
			await expect(files.write(path, 'replacement')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_FILE',
				message: expect.stringContaining('ENOENT'),
			})
			expect(await readdir(scratch.path)).toEqual(['destination'])
		} finally {
			scratch.destroy()
		}
	})
	it('preserves the committed result when another writer reacquires after release rmdir gets ENOENT', async () => {
		const scratch = createScratch()
		let hook: AsyncHook | undefined
		try {
			const lock = join(scratch.path, 'journey.lock')
			const foreign = formatBrowserLockEntry(process.pid, '22222222-2222-4222-8222-222222222222')
			let committed = false
			let reclaimed = false
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (path !== lock || !committed) return
				expect(await readdir(lock)).toEqual([])
				await rmdir(lock)
				hook = observeBrowserFilesystem(() => {
					mkdirSync(lock)
					writeFileSync(join(lock, foreign), '')
					reclaimed = true
				})
			})
			await expect(
				files.lock(lock, async () => {
					await files.write(files.resolvePath('journey.json'), 'committed')
					committed = true
					return 'saved revision'
				}),
			).resolves.toBe('saved revision')
			expect(reclaimed).toBe(true)
			expect(await readFile(files.resolvePath('journey.json'), 'utf8')).toBe('committed')
			expect(await readdir(lock)).toEqual([foreign])
		} finally {
			hook?.disable()
			scratch.destroy()
		}
	})
	it('refuses ambiguous publication and admits the uncontended control', async () => {
		const scratch = createScratch()
		try {
			const lock = join(scratch.path, 'journey.lock')
			const foreign = formatBrowserLockEntry(process.pid, '22222222-2222-4222-8222-222222222222')
			let competing = true
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (dirname(path) !== lock || !competing) return
				competing = false
				await writeFile(join(lock, foreign), '')
			})
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(await readdir(lock)).toEqual([foreign])
			await unlink(join(lock, foreign))
			await expect(files.lock(lock, async () => 'entered')).resolves.toBe('entered')
			expect(await readdir(scratch.path)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('names the directory with ACCESS when release cannot rmdir it', async () => {
		const scratch = createScratch()
		try {
			const lock = join(scratch.path, 'journey.lock')
			let releasing = false
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (path !== lock || !releasing) return
				// Replace the emptied directory after its real check so rmdir reaches ENOTDIR or ENOENT.
				expect(await readdir(lock), 'release has unlinked its entry').toEqual([])
				await rmdir(lock)
				await writeFile(lock, 'replacement')
			})
			await expect(
				files.lock(lock, async () => {
					releasing = true
				}),
				'rmdir failure names the denied directory',
			).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_ACCESS',
				message: `Cannot remove lock directory: ${lock}`,
				context: { path: lock },
			})
			expect(await readFile(lock, 'utf8')).toBe('replacement')
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a replaced empty directory whose published entry belongs to another holder', async () => {
		const scratch = createScratch()
		try {
			const lock = join(scratch.path, 'journey.lock')
			const replacement = formatBrowserLockEntry(
				process.pid,
				'22222222-2222-4222-8222-222222222222',
			)
			let replaced = false
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (dirname(path) !== lock || replaced) return
				replaced = true
				await rmdir(lock)
				await mkdir(lock)
				await writeFile(join(lock, replacement), '')
			})
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(replaced).toBe(true)
			expect(await readdir(lock)).toEqual([replacement])
		} finally {
			scratch.destroy()
		}
	})
	it('bounds retries when every empty acquisition directory disappears before publication', async () => {
		const scratch = createScratch()
		try {
			const lock = join(scratch.path, 'journey.lock')
			let attempts = 0
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				if (dirname(path) !== lock) return
				attempts += 1
				await rmdir(lock)
			})
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(attempts).toBe(BROWSER_JOURNEY_LOCK_ATTEMPTS)
			expect(attempts).toBe(8)
			expect(await readdir(scratch.path)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('refuses unreadable holder identities and multiple entries without removing them', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const lock = files.resolvePath('journey.lock')
			await mkdir(lock)
			await writeFile(join(lock, 'invalid'), '')
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(await readdir(lock)).toEqual(['invalid'])
			await writeFile(join(lock, 'second'), '')
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect((await readdir(lock)).sort()).toEqual(['invalid', 'second'])
		} finally {
			scratch.destroy()
		}
	})
	it('refuses an inconclusive liveness check without reclaiming the entry', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const lock = files.resolvePath('journey.lock')
			const entry = formatBrowserLockEntry(
				Number.MAX_SAFE_INTEGER,
				'11111111-1111-4111-8111-111111111111',
			)
			await mkdir(lock)
			await writeFile(join(lock, entry), '')
			await expect(files.lock(lock, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(await readdir(lock)).toEqual([entry])
		} finally {
			scratch.destroy()
		}
	})
	it('names the entry with ACCESS when release cannot unlink it', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const lock = files.resolvePath('journey.lock')
			let blocked: string | undefined
			const failure = await files
				.lock(lock, async () => {
					const [name] = await readdir(lock)
					if (name === undefined) throw new Error('Missing holder')
					blocked = join(lock, name)
					await unlink(blocked)
					await mkdir(blocked)
				})
				.catch((error: unknown) => error)
			expect(failure).toMatchObject({
				code: 'BROWSER_JOURNEY_ACCESS',
				message: `Cannot remove lock entry: ${blocked}`,
				context: { path: blocked },
			})
			expect(blocked).toBeDefined()
			if (blocked === undefined) throw new Error('Missing blocked entry')
			expect(await readdir(lock)).toEqual([blocked.slice(lock.length + 1)])
		} finally {
			scratch.destroy()
		}
	})
	it('reclaims an empty lock directory left before holder publication', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const path = files.resolvePath('journey.lock')
			await mkdir(path)
			await expect(files.lock(path, async () => 'entered')).resolves.toBe('entered')
			expect(await readdir(scratch.path)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a live pid entry and preserves its lock directory', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const path = files.resolvePath('journey.lock')
			const entry = formatBrowserLockEntry(process.pid, '11111111-1111-4111-8111-111111111111')
			await mkdir(path)
			await writeFile(join(path, entry), '')
			await expect(files.lock(path, async () => 'entered')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_LOCKED',
			})
			expect(await readdir(path)).toEqual([entry])
		} finally {
			scratch.destroy()
		}
	})
	it('releases only its own entry when another holder replaces it', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const path = files.resolvePath('journey.lock')
			const replacement = formatBrowserLockEntry(
				process.pid,
				'22222222-2222-4222-8222-222222222222',
			)
			await files.lock(path, async () => {
				const entries = await readdir(path)
				expect(entries).toHaveLength(1)
				for (const entry of entries) await unlink(join(path, entry))
				await writeFile(join(path, replacement), '')
			})
			await expect(readdir(path), 'release preserves the replacement holder').resolves.toEqual([
				replacement,
			])
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a zero listing cap with the argument code', () => {
		const scratch = createScratch()
		try {
			expect(() => new FileBrowserStore({ root: scratch.path, limit: 0 })).toThrow(
				expect.objectContaining({ code: 'BROWSER_JOURNEY_ARGUMENT' }),
			)
		} finally {
			scratch.destroy()
		}
	})
	it('shares the run id pattern between run validation and filesystem admission', () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			expect
				.soft(() => validateBrowserRun(BROWSER_RUN_FIXTURE), 'run validator reads the id home')
				.not.toThrow()
			expect
				.soft(() => files.validateId(BROWSER_RUN_FIXTURE.id), 'file store reads the id home')
				.not.toThrow()
			expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, id: '../escape' })).toThrow(
				'malformed fields',
			)
			expect(() => files.validateId('../escape')).toThrow('Refused run id')
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a missing root with BROWSER_JOURNEY_PATH naming the root', () => {
		const scratch = createScratch()
		try {
			const root = join(scratch.path, 'absent')
			expect(() => new FileBrowserStore({ root })).toThrow(
				expect.objectContaining({ code: 'BROWSER_JOURNEY_PATH', message: `Missing root: ${root}` }),
			)
		} finally {
			scratch.destroy()
		}
	})
	it('retries a shared first producer candidate with exclusive allocation', async () => {
		const scratch = createScratch()
		try {
			const first = new FileBrowserStore({ root: scratch.path })
			const second = new FileBrowserStore({ root: scratch.path })
			const parent = first.resolvePath('check-ready', 'runs')
			const candidates = [
				BROWSER_RUN_FIXTURE.id,
				BROWSER_RUN_FIXTURE.id.replace(/-[a-f0-9]{4}$/, '-abcd'),
				BROWSER_RUN_FIXTURE.id.replace(/-[a-f0-9]{4}$/, '-dcba'),
			]
			let index = 0
			let firstIndex = 0
			const allocations = await Promise.all([
				first.allocate(parent, () =>
					firstIndex++ === 0
						? BROWSER_RUN_FIXTURE.id
						: BROWSER_RUN_FIXTURE.id.replace(/-[a-f0-9]{4}$/, '-eeee'),
				),
				second.allocate(
					parent,
					() => candidates[index++] ?? BROWSER_RUN_FIXTURE.id.replace(/-[a-f0-9]{4}$/, '-dcba'),
				),
			])
			expect(new Set(allocations.map((entry) => entry.id)).size).toBe(2)
			expect((await readdir(parent)).sort()).toEqual(allocations.map((entry) => entry.id).sort())
		} finally {
			scratch.destroy()
		}
	})
	it('cleans a temporary file when rename fails and preserves unrelated bytes', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const path = files.resolvePath('destination')
			await mkdir(path)
			await writeFile(join(path, 'previous'), 'saved')
			await expect(files.write(path, 'replacement')).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_FILE',
			})
			expect(await readdir(scratch.path)).toEqual(['destination'])
			expect(await readFile(join(path, 'previous'), 'utf8')).toBe('saved')
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a linked temporary target', async (context) => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			await writeFile(files.resolvePath('target'), 'saved')
			context.skip(
				!supportsFileLinks(),
				'supportsFileLinks cannot create and read a file symlink on this host',
			)
			createLink(files.resolvePath('.temporary.tmp'), files.resolvePath('target'))
			await expect(files.check(files.resolvePath('.temporary.tmp'))).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		} finally {
			scratch.destroy()
		}
	})
	it('refuses a path outside its canonical root and invalid arguments', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			expect(() => files.resolvePath('..', 'escape')).toThrow('Refused path')
			expect(() => files.validateId('../escape')).toThrow('Refused run id')
			expect(() => new FileBrowserStore({ root: scratch.path, limit: NaN })).toThrow('listing cap')
			await expect(
				files.list(files.resolvePath(), async () => undefined, { offset: -1 }),
			).rejects.toThrow('Paging')
			await expect(
				files.list(files.resolvePath(), async () => undefined, { limit: Infinity }),
			).rejects.toThrow('Paging')
		} finally {
			scratch.destroy()
		}
	})
	it('resolves a root alias only at construction and refuses later root replacement', async (context) => {
		const scratch = createScratch()
		try {
			await mkdir(join(scratch.path, 'root'))
			context.skip(
				!supportsDirectoryLinks(),
				'supportsDirectoryLinks cannot create and read a directory link on this host',
			)
			createLink(join(scratch.path, 'alias'), join(scratch.path, 'root'))
			const files = new FileBrowserStore({ root: join(scratch.path, 'alias') })
			expect(files.resolvePath('entry')).toBe(join(scratch.path, 'root', 'entry'))
			await rename(join(scratch.path, 'root'), join(scratch.path, 'moved'))
			createLink(join(scratch.path, 'root'), join(scratch.path, 'moved'))
			await expect(files.read(files.resolvePath('entry'))).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		} finally {
			scratch.destroy()
		}
	})
	it('honours cancellation between filesystem steps and releases an acquired lock', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			const controller = new AbortController()
			const path = files.resolvePath('journey.lock')
			await expect(
				files.lock(
					path,
					async () => {
						controller.abort(new Error('between steps'))
						await files.write(files.resolvePath('journey.json'), '{}', {
							signal: controller.signal,
						})
					},
					{ signal: controller.signal },
				),
			).rejects.toThrow('between steps')
			expect(await readdir(scratch.path)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
})
