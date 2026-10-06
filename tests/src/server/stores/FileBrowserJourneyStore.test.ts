import type { ScratchInterface } from '@orkestrel/test/server'
import { afterEach, describe, it, expect } from 'vitest'
import { watch } from 'node:fs'
import { mkdir, rename, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_RUN_FIXTURE,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
} from '../../../setup.js'
import { requireValue } from '@orkestrel/test'
import {
	createScratch,
	createLink,
	supportsFileLinks,
	supportsDirectoryLinks,
} from '@orkestrel/test/server'
import { BrowserJourneyToolset, BrowserToolset } from '@src/core'
import {
	createFileBrowserJourneyStore,
	FileBrowserJourneyStore,
	FileBrowserRunStore,
} from '@src/server'
import { FileBrowserStore } from '../../../../src/server/stores/FileBrowserStore.js'
import { describeBrowserJourneyStore } from '../../core/stores/suite.js'
import { describeFileBrowserStores } from './suite.js'

const scratches: ScratchInterface[] = []
afterEach(() => {
	for (const scratch of scratches.splice(0)) scratch.destroy()
})
describeBrowserJourneyStore('FileBrowserJourneyStore', () => {
	const scratch = createScratch()
	scratches.push(scratch)
	return new FileBrowserJourneyStore({ root: scratch.path })
})
describeFileBrowserStores()

describe('BrowserJourneyToolset file listing', () => {
	it('forget removes file runs and captures, frees the name, and retains its revision', async () => {
		const scratch = createScratch()
		const store = new FileBrowserJourneyStore({ root: scratch.path })
		const runs = new FileBrowserRunStore({ root: scratch.path, limit: 1 })
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store, runs })
		await toolset.start()
		try {
			await store.set(BROWSER_JOURNEY_FIXTURE)
			const slot = await runs.open('add-kettle')
			await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
			await runs.capture(slot, 's1.png', new Uint8Array([137, 80]))
			expect(
				await toolset.tools.execute({
					id: 'forget',
					name: 'forget',
					arguments: { journey: 'add-kettle' },
				}),
			).toMatchObject({
				success: true,
				value: 'Forgot add-kettle and its 1 run; the name is free to record again.',
			})
			expect(await store.get('add-kettle')).toBeUndefined()
			expect((await runs.list('add-kettle')).entries).toEqual([])
			await expect(readFile(join(requireValue(slot.directory), 's1.png'))).rejects.toMatchObject({
				code: 'ENOENT',
			})
			expect(
				await toolset.tools.execute({
					id: 'record',
					name: 'record',
					arguments: { journey: 'add-kettle' },
				}),
			).toMatchObject({ success: true })
			await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
			await toolset.tools.execute({
				id: 'save',
				name: 'save',
				arguments: { description: 'Check again' },
			})
			expect((await store.get('add-kettle'))?.revision).toBe(2)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
			scratch.destroy()
		}
	})
	it('forget renders a held lock refusal without removing the journey or runs', async () => {
		const scratch = createScratch()
		const store = new FileBrowserJourneyStore({ root: scratch.path })
		const runs = new FileBrowserRunStore({ root: scratch.path })
		const files = new FileBrowserStore({ root: scratch.path })
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store, runs })
		try {
			const saved = await store.set(BROWSER_JOURNEY_FIXTURE)
			const slot = await runs.open('add-kettle')
			await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
			await files.lock(join(scratch.path, 'add-kettle', 'journey.lock'), async () => {
				await expect(
					requireValue(toolset.tools.tool('forget')).execute(
						{ journey: 'add-kettle' },
						{ signal: new AbortController().signal },
					),
				).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_LOCKED' })
				expect(
					await toolset.tools.execute({
						id: 'forget',
						name: 'forget',
						arguments: { journey: 'add-kettle' },
					}),
				).toMatchObject({
					success: false,
					error: 'Journey add-kettle is locked; call forget again.',
				})
			})
			expect(await store.get('add-kettle')).toEqual(saved)
			expect((await runs.list('add-kettle')).entries.map((run) => run.id)).toEqual([slot.id])
			expect(
				await toolset.tools.execute({
					id: 'retry',
					name: 'forget',
					arguments: { journey: 'add-kettle' },
				}),
			).toMatchObject({ success: true })
		} finally {
			await journeys.destroy()
			await toolset.destroy()
			scratch.destroy()
		}
	})
	it('lists every readable journey exactly once across store pages and reports a repeated fault once', async () => {
		const scratch = createScratch()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const store = createFileBrowserJourneyStore({ root: scratch.path, limit: 1 })
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			for (const name of ['zebra', 'broken', 'alpine', 'harbor'])
				await store.set(createBrowserJourneyFixture(undefined, { name }))
			scratch.write('broken/journey.json', '{')
			const result = await toolset.tools.execute({
				id: 'listing',
				name: 'journeys',
				arguments: { from: 1 },
			})
			expect(result).toMatchObject({ success: true })
			if (!result.success || typeof result.value !== 'string')
				throw new Error('The journeys tool did not return a listing')
			expect(result.value).toBe(
				'journeys (7 lines)\n1: alpine "Check readiness"\n2: s1 wait "Ready"\n3: broken cannot be read: Malformed journey revision\n4: harbor "Check readiness"\n5: s1 wait "Ready"\n6: zebra "Check readiness"\n7: s1 wait "Ready"\n[lines 1–7 of 7; the whole listing]',
			)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
			scratch.destroy()
		}
	})
})

describe('FileBrowserJourneyStore filesystem boundaries', () => {
	it.for(['root', 'journey', 'journey.json', 'revision', 'journey.lock'])(
		'refuses links at journey component %s',
		async (component, context) => {
			const scratch = createScratch()
			scratches.push(scratch)
			const root = join(scratch.path, 'root')
			await mkdir(root)
			const store = new FileBrowserJourneyStore({ root })
			const journey = createBrowserJourneyFixture()
			await store.set(journey)
			const path =
				component === 'root'
					? root
					: component === 'journey'
						? join(root, journey.name)
						: join(root, journey.name, component)
			if (component === 'journey.lock') await mkdir(path)
			await rename(path, path + '-moved')
			const directory =
				component === 'root' || component === 'journey' || component === 'journey.lock'
			context.skip(
				!(directory ? supportsDirectoryLinks() : supportsFileLinks()),
				'The installed link capability probe cannot create and read this link category',
			)
			createLink(path, path + '-moved')
			await expect(store.set(journey, 1)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
			await expect(store.delete(journey.name)).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		},
	)
	it('rolls back a journey replacement when cancellation prevents its counter write', async () => {
		const scratch = createScratch()
		scratches.push(scratch)
		const store = new FileBrowserJourneyStore({ root: scratch.path })
		const journey = createBrowserJourneyFixture()
		const saved = await store.set(journey)
		const controller = new AbortController()
		const directory = join(scratch.path, journey.name)
		const watcher = watch(directory, (_event, name) => {
			if (name === 'journey.json') controller.abort(new Error('counter write aborted'))
		})
		try {
			await expect(
				store.set({ ...journey, description: 'Replacement' }, 1, { signal: controller.signal }),
			).rejects.toThrow('counter write aborted')
		} finally {
			watcher.close()
		}
		expect(await store.get(journey.name)).toEqual(saved)
		expect(await readFile(join(directory, 'revision'), 'utf8')).toBe('1')
		expect((await readdir(directory)).sort()).toEqual(['journey.json', 'revision'])
		expect((await store.set(journey, 1)).revision).toBe(2)
	})
})
