import type { ScratchInterface } from '@orkestrel/test/server'
import { afterEach, describe, it, expect } from 'vitest'
import { createScratch } from '@orkestrel/test/server'
import { lstat, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileBrowserRunStore } from '@src/server'
import { BROWSER_RUN_FIXTURE, describeBrowserRunStore } from '../../../setup.js'

const scratches: ScratchInterface[] = []
afterEach(() => {
	for (const scratch of scratches.splice(0)) scratch.destroy()
})
describeBrowserRunStore('FileBrowserRunStore', () => {
	const scratch = createScratch()
	scratches.push(scratch)
	return new FileBrowserRunStore({ root: scratch.path })
})

describe('FileBrowserRunStore captures', () => {
	it('writes captures only into opened slots and refuses invalid names and unopened runs', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const slot = await store.open(BROWSER_RUN_FIXTURE.journey.name)
		const directory = slot.directory
		if (directory === undefined) throw new Error('Missing file directory')
		expect(await store.capture(slot, 's1.png', new Uint8Array([137, 80]))).toBe('s1.png')
		expect(new Uint8Array(await readFile(join(directory, 's1.png')))).toEqual(
			new Uint8Array([137, 80]),
		)
		for (const name of ['../s1.png', 's0.png', 's1.jpg', 's01.png'])
			await expect(store.capture(slot, name, new Uint8Array())).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		await expect(store.set(BROWSER_RUN_FIXTURE)).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
		await expect(
			new FileBrowserRunStore({ root: scratch.path }).set({ ...BROWSER_RUN_FIXTURE, id: slot.id }),
		).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
	})
	it('refuses a missing capture directory without recreating it', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const slot = await store.open('check-ready')
		if (slot.directory === undefined) throw new Error('Missing directory')
		await rename(slot.directory, slot.directory + '-moved')
		await expect(store.capture(slot, 's1.png', new Uint8Array([1]))).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
		await expect(lstat(slot.directory)).rejects.toMatchObject({ code: 'ENOENT' })
	})
	it('refuses links at every capture component', async () => {
		for (const component of ['journey', 'runs', 'slot', 'capture']) {
			const scratch = createScratch()
			scratches.push(scratch)
			const store = new FileBrowserRunStore({ root: scratch.path })
			const slot = await store.open('check-ready')
			if (slot.directory === undefined) throw new Error('Missing directory')
			await store.capture(slot, 's1.png', new Uint8Array([1]))
			const path =
				component === 'journey'
					? join(scratch.path, 'check-ready')
					: component === 'runs'
						? join(scratch.path, 'check-ready', 'runs')
						: component === 'slot'
							? slot.directory
							: join(slot.directory, 's1.png')
			await rename(path, path + '-moved')
			await symlink(path + '-moved', path, component === 'capture' ? 'file' : 'dir')
			await expect(store.capture(slot, 's1.png', new Uint8Array([2]))).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		}
	})
})

describe('FileBrowserRunStore persisted files', () => {
	it('deletes the whole run directory and its captures while preserving sibling runs', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const name = BROWSER_RUN_FIXTURE.journey.name
		const slot = await store.open(name)
		const sibling = await store.open(name)
		if (slot.directory === undefined) throw new Error('Missing directory')
		await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		await store.set({ ...BROWSER_RUN_FIXTURE, id: sibling.id })
		await store.capture(slot, 's1.png', new Uint8Array([137, 80]))
		await store.capture(slot, 's2.png', new Uint8Array([1, 2]))
		await store.capture(sibling, 's1.png', new Uint8Array([3, 4]))
		const reopened = new FileBrowserRunStore({ root: scratch.path })
		await reopened.delete(name, slot.id)
		await expect(lstat(slot.directory)).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(readFile(join(slot.directory, 's1.png'))).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(readFile(join(slot.directory, 's2.png'))).rejects.toMatchObject({ code: 'ENOENT' })
		expect(await reopened.get(name, slot.id)).toBeUndefined()
		expect((await reopened.list(name)).entries.map((run) => run.id)).toEqual([sibling.id])
		if (sibling.directory === undefined) throw new Error('Missing sibling directory')
		expect(new Uint8Array(await readFile(join(sibling.directory, 's1.png')))).toEqual(
			new Uint8Array([3, 4]),
		)
		await expect(reopened.delete(name, slot.id)).resolves.toBeUndefined()
		await expect(store.capture(slot, 's3.png', new Uint8Array([5]))).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
	})
	it('deletes captures from an opened run without a run file and leaves missing runs absent', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		await expect(store.delete('check-ready', BROWSER_RUN_FIXTURE.id)).resolves.toBeUndefined()
		expect(await readdir(scratch.path)).toEqual([])
		const slot = await store.open('check-ready')
		if (slot.directory === undefined) throw new Error('Missing directory')
		await store.capture(slot, 's1.png', new Uint8Array([1]))
		await store.delete('check-ready', slot.id)
		await expect(lstat(slot.directory)).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(store.delete('check-ready', slot.id)).resolves.toBeUndefined()
		expect(await readdir(join(scratch.path, 'check-ready', 'runs'))).toEqual([])
	})
	it('refuses deletion through linked directory components and preserves their files', async () => {
		for (const component of ['journey', 'runs', 'slot']) {
			const scratch = createScratch()
			scratches.push(scratch)
			const store = new FileBrowserRunStore({ root: scratch.path })
			const slot = await store.open('check-ready')
			if (slot.directory === undefined) throw new Error('Missing directory')
			await store.capture(slot, 's1.png', new Uint8Array([1]))
			const path =
				component === 'journey'
					? join(scratch.path, 'check-ready')
					: component === 'runs'
						? join(scratch.path, 'check-ready', 'runs')
						: slot.directory
			await rename(path, path + '-moved')
			await symlink(path + '-moved', path, 'dir')
			await expect(store.delete('check-ready', slot.id)).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
			expect((await lstat(path)).isSymbolicLink()).toBe(true)
			expect(new Uint8Array(await readFile(join(slot.directory, 's1.png')))).toEqual(
				new Uint8Array([1]),
			)
		}
	})
	it('pages runs with faults and refuses links at the run file', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path, limit: 1 })
		const slots = []
		for (let index = 0; index < 4; index += 1) {
			const slot = await store.open(BROWSER_RUN_FIXTURE.journey.name)
			slots.push(slot)
			await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		}
		slots.sort((left, right) => (left.id < right.id ? -1 : 1))
		const broken = slots[0]
		const linked = slots[1]
		const readable = slots[2]
		const last = slots[3]
		if (
			broken?.directory === undefined ||
			linked?.directory === undefined ||
			readable === undefined ||
			last === undefined
		)
			throw new Error('Missing allocated slots')
		await writeFile(join(broken.directory, 'run.json'), '{')
		const path = join(linked.directory, 'run.json')
		await rename(path, path + '-moved')
		await symlink(path + '-moved', path, 'file')
		await expect(store.get(BROWSER_RUN_FIXTURE.journey.name, linked.id)).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
		await expect(store.set({ ...BROWSER_RUN_FIXTURE, id: linked.id })).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
		await expect(store.delete(BROWSER_RUN_FIXTURE.journey.name, linked.id)).rejects.toMatchObject({
			code: 'BROWSER_JOURNEY_PATH',
		})
		const page = await store.list(BROWSER_RUN_FIXTURE.journey.name, { limit: 100 })
		expect(page.entries.map((run) => run.id)).toEqual([readable.id])
		expect(page.truncated).toBe(true)
		expect(page.faults.map((fault) => fault.path)).toEqual([broken.directory, linked.directory])
		const next = await store.list(BROWSER_RUN_FIXTURE.journey.name, { offset: 1 })
		expect(next.entries.map((run) => run.id)).toEqual([last.id])
		expect(next.truncated).toBe(false)
	})
})
