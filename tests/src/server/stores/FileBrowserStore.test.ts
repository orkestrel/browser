import { describe, it, expect } from 'vitest'
import { createScratch } from '@orkestrel/test/server'
import { mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileBrowserStore } from '@src/server'
import { BROWSER_RUN_FIXTURE } from '../../../setup.js'

describe('FileBrowserStore', () => {
	it('retries a shared first producer candidate with exclusive allocation', async () => {
		const scratch = createScratch()
		try {
			const first = new FileBrowserStore({ root: scratch.path })
			const second = new FileBrowserStore({ root: scratch.path })
			const parent = first.path('check-ready', 'runs')
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
			const path = files.path('destination')
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
			await writeFile(files.path('target'), 'saved')
			await symlink(files.path('target'), files.path('.temporary.tmp'))
			await expect(files.check(files.path('.temporary.tmp'))).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
			expect(() => files.path('..', 'escape')).toThrow('Refused path')
			expect(() => files.id('../escape')).toThrow('Refused run id')
			expect(() => new FileBrowserStore({ root: scratch.path, limit: NaN })).toThrow('listing cap')
			await expect(files.list(files.path(), async () => undefined, { offset: -1 })).rejects.toThrow(
				'Paging',
			)
			await expect(
				files.list(files.path(), async () => undefined, { limit: Infinity }),
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
			expect(files.path('entry')).toBe(join(scratch.path, 'root', 'entry'))
			await rename(join(scratch.path, 'root'), join(scratch.path, 'moved'))
			await symlink(join(scratch.path, 'moved'), join(scratch.path, 'root'), 'dir')
			await expect(files.read(files.path('entry'))).rejects.toMatchObject({
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
			const path = files.path('journey.lock')
			await expect(
				files.lock(
					path,
					async () => {
						controller.abort(new Error('between steps'))
						await files.write(files.path('journey.json'), '{}', { signal: controller.signal })
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
