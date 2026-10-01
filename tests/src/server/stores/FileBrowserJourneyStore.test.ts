import type { ScratchInterface } from '@orkestrel/test/server'
import { afterEach, describe, it, expect } from 'vitest'
import { watch } from 'node:fs'
import { mkdir, rename, symlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createBrowserJourneyFixture } from '../../../setup.js'
import { createScratch } from '@orkestrel/test/server'
import { FileBrowserJourneyStore } from '@src/server'
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

describe('FileBrowserJourneyStore filesystem boundaries', () => {
	it('refuses links at every journey component', async () => {
		for (const component of ['root', 'journey', 'journey.json', 'revision', 'journey.lock']) {
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
			if (component === 'journey.lock') await writeFile(path, '')
			await rename(path, path + '-moved')
			await symlink(
				path + '-moved',
				path,
				component === 'root' || component === 'journey' ? 'dir' : 'file',
			)
			await expect(store.set(journey, 1)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
			await expect(store.delete(journey.name)).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_PATH',
			})
		}
	})
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
