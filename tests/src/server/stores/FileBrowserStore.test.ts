import { describe, it, expect } from 'vitest'
import { createScratch } from '@orkestrel/test/server'
import { mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateBrowserRun } from '@src/core'
import { FileBrowserStore } from '../../../../src/server/stores/FileBrowserStore.js'
import { BROWSER_RUN_FIXTURE } from '../../../setup.js'

describe('FileBrowserStore', () => {
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
	it('refuses a linked temporary target and a path outside its canonical root', async () => {
		const scratch = createScratch()
		try {
			const files = new FileBrowserStore({ root: scratch.path })
			await writeFile(files.resolvePath('target'), 'saved')
			await symlink(files.resolvePath('target'), files.resolvePath('.temporary.tmp'))
			await expect(files.check(files.resolvePath('.temporary.tmp'))).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
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
	it('resolves a root alias only at construction and refuses later root replacement', async () => {
		const scratch = createScratch()
		try {
			await mkdir(join(scratch.path, 'root'))
			await symlink(join(scratch.path, 'root'), join(scratch.path, 'alias'), 'dir')
			const files = new FileBrowserStore({ root: join(scratch.path, 'alias') })
			expect(files.resolvePath('entry')).toBe(join(scratch.path, 'root', 'entry'))
			await rename(join(scratch.path, 'root'), join(scratch.path, 'moved'))
			await symlink(join(scratch.path, 'moved'), join(scratch.path, 'root'), 'dir')
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
