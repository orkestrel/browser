import type { ScratchInterface } from '@orkestrel/test/server'
import { afterEach, describe, it, expect } from 'vitest'
import {
	createScratch,
	createLink,
	supportsFileLinks,
	supportsDirectoryLinks,
} from '@orkestrel/test/server'
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { requireValue } from '@orkestrel/test'
import { createBrowserToolset, createMemoryBrowserJourneyStore } from '@src/core'
import { createBrowser, FileBrowserRunStore } from '@src/server'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../../../setupService.js'
import { FileBrowserStore } from '../../../../src/server/stores/FileBrowserStore.js'
import { BROWSER_RUN_FIXTURE } from '../../../setup.js'
import { describeBrowserRunStore } from '../../core/stores/suite.js'

const scratches: ScratchInterface[] = []
afterEach(() => {
	for (const scratch of scratches.splice(0)) scratch.destroy()
})
describeBrowserRunStore('FileBrowserRunStore', () => {
	const scratch = createScratch()
	scratches.push(scratch)
	return new FileBrowserRunStore({ root: scratch.path })
})

describe('FileBrowserRunStore standalone captures', () => {
	it('refuses an aborted snapshot before creating a runs directory', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const reason = new Error('Snapshot aborted')
		await expect(store.write(new Uint8Array(), { signal: AbortSignal.abort(reason) })).rejects.toBe(
			reason,
		)
		expect(await readdir(scratch.path)).toEqual([])
	})

	it('refuses a linked standalone runs directory', async (context) => {
		context.skip(
			!supportsDirectoryLinks(),
			'The directory link capability probe cannot create and read a link',
		)
		const scratch = createScratch()
		scratches.push(scratch)
		const outside = scratch.ensure('outside')
		createLink(join(scratch.path, 'runs'), outside)
		const store = new FileBrowserRunStore({ root: scratch.path })
		await expect(store.write(new Uint8Array([1]))).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		expect(await readdir(outside)).toEqual([])
	})

	it('capture saves real Chromium PNGs and returns only distinct file paths', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const browser = createBrowser({
			executable: requireSystemBrowser().executable,
			headless: true,
			profile: scratch.ensure('profile'),
			args: SERVICE_BROWSER_ARGS,
		})
		try {
			await browser.connect()
			const page = await requireValue(browser.context()).create()
			const toolset = createBrowserToolset(page, {
				journeys: {
					store: createMemoryBrowserJourneyStore(),
					runs: new FileBrowserRunStore({ root: scratch.path }),
					readonly: true,
				},
			})
			try {
				await toolset.start()
				const first = await toolset.tools.execute({
					id: 'first',
					name: 'capture',
					arguments: { full: false },
				})
				expect(first.success).toBe(true)
				if (!first.success || typeof first.value !== 'string')
					throw new Error('Capture returned no text path')
				expect(isAbsolute(first.value)).toBe(true)
				expect(dirname(dirname(first.value))).toBe(join(scratch.path, 'runs'))
				const bytes = await readFile(first.value)
				expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
				const second = await toolset.tools.execute({
					id: 'second',
					name: 'capture',
					arguments: { full: true },
				})
				expect(second.success).toBe(true)
				if (!second.success || typeof second.value !== 'string')
					throw new Error('Capture returned no text path')
				expect(second.value).not.toBe(first.value)
				expect(dirname(dirname(second.value))).toBe(join(scratch.path, 'runs'))
				expect([...(await readFile(second.value)).subarray(0, 8)]).toEqual([
					137, 80, 78, 71, 13, 10, 26, 10,
				])
				expect(await readFile(first.value)).toEqual(bytes)
			} finally {
				await toolset.destroy()
			}
		} finally {
			await browser.destroy()
		}
	}, 30_000)

	it('saves independent images under the runs root without replacing the first image', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const first = await store.write(new Uint8Array([137, 80]))
		const second = await store.write(new Uint8Array([137, 81]))
		expect(first).not.toBe(second)
		expect(dirname(dirname(first))).toBe(join(scratch.path, 'runs'))
		expect(dirname(dirname(second))).toBe(join(scratch.path, 'runs'))
		expect(await readFile(first)).toEqual(Buffer.from([137, 80]))
		expect(await readFile(second)).toEqual(Buffer.from([137, 81]))
		expect(await readdir(join(scratch.path, 'runs'))).toHaveLength(2)
	})
})

describe('FileBrowserRunStore captures', () => {
	it('writes captures only into opened slots and refuses invalid names and unopened runs', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const slot = await store.create(BROWSER_RUN_FIXTURE.journey.name)
		const directory = slot.directory
		if (directory === undefined) throw new Error('Missing file directory')
		expect(await store.capture(slot, 's1.png', new Uint8Array([137, 80]))).toBe('s1.png')
		expect(new Uint8Array(await readFile(join(directory, 's1.png')))).toEqual(
			new Uint8Array([137, 80]),
		)
		for (const name of ['../s1.png', 's0.png', 's1.jpg', 's01.png'])
			await expect(store.capture(slot, name, new Uint8Array())).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
		await expect(store.set(BROWSER_RUN_FIXTURE)).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		await expect(
			new FileBrowserRunStore({ root: scratch.path }).set({ ...BROWSER_RUN_FIXTURE, id: slot.id }),
		).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
	})
	it('refuses a missing capture directory without recreating it', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const slot = await store.create('check-ready')
		if (slot.directory === undefined) throw new Error('Missing directory')
		await rename(slot.directory, slot.directory + '-moved')
		await expect(store.capture(slot, 's1.png', new Uint8Array([1]))).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		await expect(lstat(slot.directory)).rejects.toMatchObject({ code: 'ENOENT' })
	})
	it.for(['journey', 'runs', 'slot', 'capture'])(
		'refuses links at capture component %s',
		async (component, context) => {
			const scratch = createScratch()
			scratches.push(scratch)
			const store = new FileBrowserRunStore({ root: scratch.path })
			const slot = await store.create('check-ready')
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
			context.skip(
				!(component === 'capture' ? supportsFileLinks() : supportsDirectoryLinks()),
				'The installed link capability probe cannot create and read this link category',
			)
			createLink(path, path + '-moved')
			await expect(store.capture(slot, 's1.png', new Uint8Array([2]))).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
		},
	)
})

describe('FileBrowserRunStore persisted files', () => {
	it('allocates concurrent runs of one name across store instances without refusing', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const first = new FileBrowserRunStore({ root: scratch.path })
		const second = new FileBrowserRunStore({ root: join(scratch.path, '.') })
		const results = await Promise.allSettled([
			first.create('same-journey'),
			second.create('same-journey'),
		])
		expect(results).toMatchObject([{ status: 'fulfilled' }, { status: 'fulfilled' }])
		expect(await readdir(join(scratch.path, 'same-journey', 'runs'))).toHaveLength(2)
	})

	it('releases an aborted queued allocation without creating a slot or blocking its successor', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const controller = new AbortController()
		const reason = new Error('Queued allocation aborted')
		const first = store.create('same-journey')
		const aborted = store.create('same-journey', { signal: controller.signal })
		const successor = store.create('same-journey')
		controller.abort(reason)
		const results = await Promise.allSettled([first, aborted, successor])
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
		expect(results[1]).toEqual({ status: 'rejected', reason })
		expect(await readdir(join(scratch.path, 'same-journey', 'runs'))).toHaveLength(2)
	})

	it('preserves live-lock refusals for queued allocations and releases the queue after failure', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const files = new FileBrowserStore({ root: scratch.path })
		await files.lock(join(scratch.path, 'same-journey', 'journey.lock'), async () => {
			const results = await Promise.allSettled([
				store.create('same-journey'),
				store.create('same-journey'),
			])
			for (const result of results)
				expect(result).toMatchObject({
					status: 'rejected',
					reason: { code: 'JOURNEY_LOCKED' },
				})
		})
		const results = await Promise.allSettled([
			store.create('same-journey'),
			store.create('same-journey'),
		])
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
		expect(await readdir(join(scratch.path, 'same-journey', 'runs'))).toHaveLength(2)
	})

	it('clear removes unsaved and malformed runs from a reopened store beyond its listing limit', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path, limit: 1 })
		const name = BROWSER_RUN_FIXTURE.journey.name
		const saved = await store.create(name)
		await store.set({ ...BROWSER_RUN_FIXTURE, id: saved.id })
		const broken = await store.create(name)
		if (broken.directory === undefined) throw new Error('Missing directory')
		await writeFile(join(broken.directory, 'run.json'), '{')
		const unsaved = await store.create(name)
		await store.capture(unsaved, 's1.png', new Uint8Array([1]))
		const reopened = new FileBrowserRunStore({ root: scratch.path, limit: 1 })
		expect(await reopened.clear(name)).toBe(3)
		expect(await readdir(join(scratch.path, name, 'runs'))).toEqual([])
		await expect(store.set({ ...BROWSER_RUN_FIXTURE, id: unsaved.id })).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		await expect(store.capture(unsaved, 's1.png', new Uint8Array([2]))).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
	})
	it('open and clear both refuse the same held lock', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const files = new FileBrowserStore({ root: scratch.path })
		const slot = await store.create('add-kettle')
		await files.lock(join(scratch.path, 'add-kettle', 'journey.lock'), async () => {
			await expect(store.create('add-kettle')).rejects.toMatchObject({
				code: 'JOURNEY_LOCKED',
			})
			await expect(store.clear('add-kettle')).rejects.toMatchObject({
				code: 'JOURNEY_LOCKED',
			})
		})
		await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		expect(await store.clear('add-kettle')).toBe(1)
	})
	it('clear refuses linked run components before deleting siblings', async (context) => {
		for (const component of ['journey', 'runs', 'slot']) {
			const scratch = createScratch()
			scratches.push(scratch)
			const store = new FileBrowserRunStore({ root: scratch.path })
			const slot = await store.create('check-ready')
			if (slot.directory === undefined) throw new Error('Missing directory')
			await store.capture(slot, 's1.png', new Uint8Array([1]))
			const path =
				component === 'journey'
					? join(scratch.path, 'check-ready')
					: component === 'runs'
						? join(scratch.path, 'check-ready', 'runs')
						: slot.directory
			await rename(path, path + '-moved')
			context.skip(
				!supportsDirectoryLinks(),
				'supportsDirectoryLinks cannot create and read a directory link on this host',
			)
			createLink(path, path + '-moved')
			await expect(store.clear('check-ready')).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
			expect(new Uint8Array(await readFile(join(slot.directory, 's1.png')))).toEqual(
				new Uint8Array([1]),
			)
		}
	})
	it('deletes the whole run directory and its captures while preserving sibling runs', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const name = BROWSER_RUN_FIXTURE.journey.name
		const slot = await store.create(name)
		const sibling = await store.create(name)
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
			code: 'JOURNEY_PATH',
		})
	})
	it('deletes captures from an opened run without a run file and leaves missing runs absent', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		await expect(store.delete('check-ready', BROWSER_RUN_FIXTURE.id)).resolves.toBeUndefined()
		expect(await readdir(scratch.path)).toEqual([])
		const slot = await store.create('check-ready')
		if (slot.directory === undefined) throw new Error('Missing directory')
		await store.capture(slot, 's1.png', new Uint8Array([1]))
		await store.delete('check-ready', slot.id)
		await expect(lstat(slot.directory)).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(store.delete('check-ready', slot.id)).resolves.toBeUndefined()
		expect(await readdir(join(scratch.path, 'check-ready', 'runs'))).toEqual([])
	})
	it('refuses deletion through linked directory components and preserves their files', async (context) => {
		for (const component of ['journey', 'runs', 'slot']) {
			const scratch = createScratch()
			scratches.push(scratch)
			const store = new FileBrowserRunStore({ root: scratch.path })
			const slot = await store.create('check-ready')
			if (slot.directory === undefined) throw new Error('Missing directory')
			await store.capture(slot, 's1.png', new Uint8Array([1]))
			const path =
				component === 'journey'
					? join(scratch.path, 'check-ready')
					: component === 'runs'
						? join(scratch.path, 'check-ready', 'runs')
						: slot.directory
			await rename(path, path + '-moved')
			context.skip(
				!supportsDirectoryLinks(),
				'supportsDirectoryLinks cannot create and read a directory link on this host',
			)
			createLink(path, path + '-moved')
			await expect(store.delete('check-ready', slot.id)).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
			expect((await lstat(path)).isSymbolicLink()).toBe(true)
			expect(new Uint8Array(await readFile(join(slot.directory, 's1.png')))).toEqual(
				new Uint8Array([1]),
			)
		}
	})
	it('pages readable runs past malformed faults without requiring file links', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path, limit: 1 })
		const slots = []
		for (let index = 0; index < 3; index += 1) {
			const slot = await store.create(BROWSER_RUN_FIXTURE.journey.name)
			slots.push(slot)
			await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		}
		slots.sort((left, right) => (left.id < right.id ? -1 : 1))
		const [broken, readable, last] = slots
		if (broken?.directory === undefined || readable === undefined || last === undefined)
			throw new Error('Missing allocated slots')
		await writeFile(join(broken.directory, 'run.json'), '{')
		const page = await store.list(BROWSER_RUN_FIXTURE.journey.name, { limit: 100 })
		expect(page.entries.map((run) => run.id)).toEqual([readable.id])
		expect(page.truncated).toBe(true)
		expect(page.faults).toEqual([
			{ name: broken.id, reason: 'The stored entry is malformed or unreadable' },
		])
		const next = await store.list(BROWSER_RUN_FIXTURE.journey.name, { offset: 1 })
		expect(next.entries.map((run) => run.id)).toEqual([last.id])
		expect(next.truncated).toBe(false)
	})
	it('refuses links at the run file and reports the linked-entry fault', async (context) => {
		context.skip(
			!supportsFileLinks(),
			'supportsFileLinks cannot create and read a file symlink on this host',
		)
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserRunStore({ root: scratch.path })
		const slot = await store.create(BROWSER_RUN_FIXTURE.journey.name)
		await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		if (slot.directory === undefined) throw new Error('Missing directory')
		const path = join(slot.directory, 'run.json')
		await rename(path, path + '-moved')
		createLink(path, path + '-moved')
		await expect(store.get(BROWSER_RUN_FIXTURE.journey.name, slot.id)).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		await expect(store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		await expect(store.delete(BROWSER_RUN_FIXTURE.journey.name, slot.id)).rejects.toMatchObject({
			code: 'JOURNEY_PATH',
		})
		expect((await store.list(BROWSER_RUN_FIXTURE.journey.name)).faults).toEqual([
			{ name: slot.id, reason: 'The entry path is refused' },
		])
	})
})
