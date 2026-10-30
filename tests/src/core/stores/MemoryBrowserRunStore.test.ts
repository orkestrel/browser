import { describe, expect, it } from 'vitest'
import { MemoryBrowserRunStore } from '@src/core'
import { BROWSER_RUN_STORE_CASES } from '../../../setup.js'

describe('MemoryBrowserRunStore', () => {
	for (const entry of BROWSER_RUN_STORE_CASES) {
		it(`${entry.title}`, async (context) => {
			for await (const received of entry.run(() => new MemoryBrowserRunStore())) {
				for (const observation of [received].filter((value) => value.comparison === 'identity')) {
					expect(observation.actual).toBe(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'different')) {
					expect(observation.actual).not.toBe(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'equal')) {
					expect(observation.actual).toEqual(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'object')) {
					expect(observation.actual).toMatchObject(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'contains')) {
					expect(observation.actual).toContain(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'length')) {
					expect(observation.actual).toHaveLength(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'maximum')) {
					expect(observation.actual).toBeLessThanOrEqual(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'undefined')) {
					expect(observation.actual).toBeUndefined()
				}
				for (const observation of [received].filter((value) => value.comparison === 'defined')) {
					expect(observation.actual).toBeDefined()
				}
				for (const observation of [received].filter((value) => value.comparison === 'match')) {
					expect(observation.actual).toMatch(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'rejected')) {
					expect(observation.actual).toHaveLength(1)
					const [result] = observation.actual
					expect(result?.status).toBe('rejected')
					if (result?.status !== 'rejected') throw new Error('The store call did not reject')
					expect(result.reason).toMatchObject(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'thrown')) {
					expect(observation.actual).toHaveLength(1)
					const [result] = observation.actual
					expect(result?.status).toBe('rejected')
					if (result?.status !== 'rejected') throw new Error('The store call did not reject')
					expect(() => {
						throw result.reason
					}).toThrow(observation.expected)
				}
				for (const observation of [received].filter((value) => value.comparison === 'path')) {
					expect(observation.actual).toHaveLength(1)
					const [result] = observation.actual
					expect(result?.status).toBe('rejected')
					if (result?.status !== 'rejected') throw new Error('The store call did not reject')
					expect(result.reason).toMatchObject({
						code: observation.expected.code,
						message: expect.stringContaining(observation.expected.path),
					})
				}
				for (const observation of [received].filter((value) => value.comparison === 'access')) {
					expect(observation.actual).toEqual({
						uid: observation.expected.uid,
						gid: observation.expected.gid,
						outcomes: observation.expected.paths.map((path) => ({
							status: 'rejected',
							code: 'STORE_ACCESS',
							message: expect.stringContaining(path),
						})),
					})
				}
				if (received.comparison === 'skip') context.skip(received.actual, received.expected)
			}
		})
	}
})

it('opens no capture directory', async () => {
	expect(await new MemoryBrowserRunStore().create('add-kettle')).not.toHaveProperty('directory')
})

it('resolves capture without a name for an opened memory slot', async () => {
	const store = new MemoryBrowserRunStore()
	const slot = await store.create('add-kettle')
	await expect(store.capture(slot, 's1.png', new Uint8Array([137, 80]))).resolves.toBeUndefined()
})
