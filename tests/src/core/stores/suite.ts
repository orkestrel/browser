import type { BrowserJourneyStoreInterface, BrowserRunStoreInterface } from '@src/core'
import { describe, it, expect } from 'vitest'
import {
	BROWSER_RUN_FIXTURE,
	BROWSER_STORE_INVALID_NAMES,
	createBrowserJourneyFixture,
} from '../../../setup.js'

/**
 * Registers the shared journey-store contract against an isolated store per case.
 * @param name - Suite label
 * @param factory - Fresh store, synchronously or asynchronously created
 */
export function describeBrowserJourneyStore(
	name: string,
	factory: () => BrowserJourneyStoreInterface | Promise<BrowserJourneyStoreInterface>,
): void {
	describe(`${name}`, () => {
		it('refuses incompatible conditions and invalid revisions before any write', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			for (const options of [
				{ revision: 1, exclusive: true },
				{ revision: 1, exclusive: false },
				{ revision: 0 },
				{ revision: -1 },
				{ revision: 1.5 },
				{ revision: Number.NaN },
				{ revision: Number.POSITIVE_INFINITY },
				{ revision: Number.MAX_SAFE_INTEGER + 1 },
			]) {
				await expect(store.set(journey, options)).rejects.toMatchObject({ code: 'ARGUMENT' })
				expect(await store.get(journey.name)).toBeUndefined()
			}
			const saved = await store.set(journey)
			await expect(
				store.set({ ...journey, description: 'Rejected' }, { revision: 1, exclusive: true }),
			).rejects.toMatchObject({ code: 'ARGUMENT' })
			expect(await store.get(journey.name)).toEqual(saved)
			expect((await store.set(journey, { exclusive: false })).revision).toBe(2)
		})
		it('accepts exactly one competing exclusive creator and one revision writer', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			for (const options of [{ exclusive: true }, { revision: 1 }]) {
				const outcomes = await Promise.allSettled([
					store.set({ ...journey, description: 'First' }, options),
					store.set({ ...journey, description: 'Second' }, options),
				])
				expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
				const saved = outcomes.find((result) => result.status === 'fulfilled')
				if (saved?.status !== 'fulfilled') throw new Error('No accepted write')
				expect(await store.get(journey.name)).toEqual(saved.value)
				const refused = outcomes.filter((result) => result.status === 'rejected')
				for (const result of refused)
					expect(['JOURNEY_STALE', 'JOURNEY_LOCKED']).toContain(result.reason.code)
			}
			expect((await store.get(journey.name))?.revision).toBe(2)
		})
		it('owns the write conditions while an asynchronous backend acquires its lock', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			await store.set(journey)
			const options = { exclusive: true }
			const saving = store.set({ ...journey, description: 'Rejected' }, options)
			options.exclusive = false
			await expect(saving).rejects.toMatchObject({ code: 'JOURNEY_STALE' })
			expect((await store.get(journey.name))?.revision).toBe(1)
		})
		it('gets missing entries and deletes missing names', async () => {
			const store = await factory()
			expect(await store.get('missing')).toBeUndefined()
			await store.delete('missing')
			expect(await store.list()).toEqual({ entries: [], truncated: false, faults: [] })
		})
		it('refuses zero journey limits', async () => {
			const store = await factory()
			await expect(store.list({ limit: 0 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
			})
			await store.set(createBrowserJourneyFixture())
			await expect(store.list({ limit: 0 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
			})
		})
		it('refuses invalid journey names in point operations', async () => {
			const store = await factory()
			for (const invalid of BROWSER_STORE_INVALID_NAMES) {
				await expect(store.get(invalid)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
				await expect(store.delete(invalid)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
				const journey = createBrowserJourneyFixture([], { name: invalid })
				await expect(store.set(journey)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
				Reflect.set(journey, 'format', 9)
				await expect(store.set(journey)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
			}
		})
		it('owns input, returned values, and listings', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			const saved = await store.set(journey)
			Reflect.set(journey, 'description', 'caller edit')
			Reflect.set(saved.journey, 'description', 'result edit')
			const fetched = await store.get(journey.name)
			expect(fetched?.journey.description).toBe('Check readiness')
			if (fetched !== undefined) Reflect.set(fetched.journey, 'description', 'get edit')
			const listed = await store.list()
			for (const entry of listed.entries) Reflect.set(entry.journey, 'description', 'list edit')
			expect((await store.get(journey.name))?.journey.description).toBe('Check readiness')
		})
		it('refuses stale expected revisions and retains the accepted value', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			expect((await store.set(journey)).revision).toBe(1)
			expect(
				(await store.set({ ...journey, description: 'Accepted' }, { revision: 1 })).revision,
			).toBe(2)
			await expect(
				store.set({ ...journey, description: 'Stale' }, { revision: 1 }),
			).rejects.toMatchObject({
				code: 'JOURNEY_STALE',
				message: 'Journey check-ready changed since you read it',
			})
			expect((await store.get(journey.name))?.journey.description).toBe('Accepted')
		})
		it('creates only an absent journey with exclusive creation, including after deletion', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			const saved = await store.set(journey, { exclusive: true })
			expect(saved.revision).toBe(1)
			await expect(
				store.set({ ...journey, description: 'Replacement' }, { exclusive: true }),
			).rejects.toMatchObject({
				code: 'JOURNEY_STALE',
				message: `Journey ${journey.name} changed since you read it`,
			})
			expect(await store.get(journey.name)).toEqual(saved)
			await store.delete(journey.name)
			expect((await store.set(journey, { exclusive: true })).revision).toBe(2)
			await expect(store.set(journey, { revision: 1 })).rejects.toMatchObject({
				code: 'JOURNEY_STALE',
				message: `Journey ${journey.name} changed since you read it`,
			})
		})
		it('counts revisions across delete and recreate and refuses a stale writer', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			await store.set(journey)
			await store.delete(journey.name)
			expect(await store.get(journey.name)).toBeUndefined()
			await expect(store.set(journey, { revision: 1 })).rejects.toMatchObject({
				code: 'JOURNEY_STALE',
			})
			expect((await store.set(journey)).revision).toBe(2)
			await expect(store.set(journey, { revision: 1 })).rejects.toMatchObject({
				code: 'JOURNEY_STALE',
			})
		})
		it('refuses negative journey paging', async () => {
			const store = await factory()
			await expect(store.list({ offset: -1 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
				message: 'Paging requires a nonnegative integer offset and a positive integer limit',
			})
			await expect(store.list({ limit: -1 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
				message: 'Paging requires a nonnegative integer offset and a positive integer limit',
			})
		})
		it('sorts by name and pages with truthful truncation and empty faults', async () => {
			const store = await factory()
			for (const journeyName of ['zebra', 'alpine', 'harbor'])
				await store.set(createBrowserJourneyFixture(undefined, { name: journeyName }))
			expect((await store.list()).entries.map((entry) => entry.journey.name)).toEqual([
				'alpine',
				'harbor',
				'zebra',
			])
			const page = await store.list({ offset: 1, limit: 1 })
			expect(page.entries.map((entry) => entry.journey.name)).toEqual(['harbor'])
			expect(page.truncated).toBe(true)
			expect(page.faults).toEqual([])
			expect((await store.list({ offset: 2, limit: 1 })).truncated).toBe(false)
			expect(await store.list({ offset: 9, limit: 1 })).toEqual({
				entries: [],
				truncated: false,
				faults: [],
			})
		})
		it('refuses an unknown format before replacing a saved journey', async () => {
			const store = await factory()
			const journey = createBrowserJourneyFixture()
			await store.set(journey)
			Reflect.set(journey, 'format', 9)
			await expect(store.set(journey)).rejects.toMatchObject({ code: 'JOURNEY_FORMAT' })
			expect((await store.get(journey.name))?.revision).toBe(1)
		})
		it('honours an aborted signal on every primitive', async () => {
			const store = await factory()
			const options = { signal: AbortSignal.abort(new Error('store aborted')) }
			await expect(store.get('missing', options)).rejects.toThrow('store aborted')
			await expect(store.set(createBrowserJourneyFixture(), { ...options })).rejects.toThrow(
				'store aborted',
			)
			await expect(store.delete('missing', options)).rejects.toThrow('store aborted')
			await expect(store.list(options)).rejects.toThrow('store aborted')
		})
	})
}

/**
 * Registers shared run-store semantics against an isolated store per case.
 * @param name - Suite label
 * @param factory - Fresh store, synchronously or asynchronously created
 */
export function describeBrowserRunStore(
	name: string,
	factory: () => BrowserRunStoreInterface | Promise<BrowserRunStoreInterface>,
): void {
	describe(`${name}`, () => {
		it('refuses zero run limits', async () => {
			const store = await factory()
			await expect(store.list('add-kettle', { limit: 0 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
			})
		})
		it('clears saved runs and unsaved slots without touching another journey', async () => {
			const store = await factory()
			const journey = BROWSER_RUN_FIXTURE.journey.name
			const first = await store.create(journey)
			await store.set({ ...BROWSER_RUN_FIXTURE, id: first.id })
			const unsaved = await store.create(journey)
			const sibling = await store.create('other-journey')
			expect(await store.clear(journey)).toBe(2)
			expect(await store.list(journey)).toEqual({ entries: [], truncated: false, faults: [] })
			for (const slot of [first, unsaved]) {
				await expect(store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })).rejects.toMatchObject({
					code: 'JOURNEY_PATH',
				})
				await expect(store.capture(slot, 's1.png', new Uint8Array([1]))).rejects.toMatchObject({
					code: 'JOURNEY_PATH',
				})
			}
			await store.capture(sibling, 's1.png', new Uint8Array([2]))
			expect(await store.clear(journey)).toBe(0)
			expect(await store.clear('missing')).toBe(0)
			const recreated = await store.create(journey)
			await store.set({ ...BROWSER_RUN_FIXTURE, id: recreated.id })
			expect((await store.list(journey)).entries.map((run) => run.id)).toEqual([recreated.id])
		})
		it('refuses invalid journey names in run operations', async () => {
			const store = await factory()
			for (const invalid of BROWSER_STORE_INVALID_NAMES) {
				await expect(store.create(invalid)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
				await expect(store.clear(invalid)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
				await expect(store.get(invalid, BROWSER_RUN_FIXTURE.id)).rejects.toMatchObject({
					code: 'JOURNEY_PATH',
				})
				await expect(store.delete(invalid, BROWSER_RUN_FIXTURE.id)).rejects.toMatchObject({
					code: 'JOURNEY_PATH',
				})
				await expect(store.list(invalid)).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
			}
		})
		it('refuses writing a run this store never opened', async () => {
			const store = await factory()
			await expect(store.set(BROWSER_RUN_FIXTURE)).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
			expect(
				await store.get(BROWSER_RUN_FIXTURE.journey.name, BROWSER_RUN_FIXTURE.id),
			).toBeUndefined()
			const other = await factory()
			const slot = await other.create(BROWSER_RUN_FIXTURE.journey.name)
			await expect(store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
		})
		it('refuses negative run paging', async () => {
			const store = await factory()
			await expect(store.list('add-kettle', { offset: -1 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
				message: 'Paging requires a nonnegative integer offset and a positive integer limit',
			})
			await expect(store.list('add-kettle', { limit: -1 })).rejects.toMatchObject({
				code: 'JOURNEY_ARGUMENT',
				message: 'Paging requires a nonnegative integer offset and a positive integer limit',
			})
		})
		it('refuses capture on a slot the store did not open', async () => {
			const store = await factory()
			await expect(
				store.capture({ id: BROWSER_RUN_FIXTURE.id }, 's1.png', new Uint8Array([137, 80])),
			).rejects.toMatchObject({ code: 'JOURNEY_PATH' })
		})
		it('refuses capture on a slot opened by another store', async () => {
			const store = await factory()
			const other = await factory()
			const slot = await other.create('add-kettle')
			await expect(store.capture(slot, 's1.png', new Uint8Array([137, 80]))).rejects.toMatchObject({
				code: 'JOURNEY_PATH',
			})
		})
		it('honours an aborted signal when capturing an opened slot', async () => {
			const store = await factory()
			const slot = await store.create('add-kettle')
			await expect(
				store.capture(slot, 's1.png', new Uint8Array([137, 80]), {
					signal: AbortSignal.abort(new Error('capture aborted')),
				}),
			).rejects.toThrow('capture aborted')
		})
		it('opens unique ids and gets and deletes missing runs', async () => {
			const store = await factory()
			const first = await store.create('add-kettle')
			const second = await store.create('add-kettle')
			expect(first.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f]{4}$/)
			expect(first.id).not.toBe(second.id)
			expect(await store.get('add-kettle', first.id)).toBeUndefined()
			await store.delete('add-kettle', first.id)
			expect(await store.list('add-kettle')).toEqual({ entries: [], truncated: false, faults: [] })
		})
		it('owns snapshots and keys runs by journey name and id', async () => {
			const store = await factory()
			const run = structuredClone(BROWSER_RUN_FIXTURE)
			const slot = await store.create(run.journey.name)
			const saved = { ...run, id: slot.id }
			await store.set(saved)
			Reflect.set(saved, 'elapsed', 99)
			const fetched = await store.get(run.journey.name, slot.id)
			expect(fetched?.elapsed).toBe(25)
			if (fetched !== undefined) Reflect.set(fetched, 'elapsed', 100)
			for (const entry of (await store.list(run.journey.name)).entries)
				Reflect.set(entry, 'elapsed', 101)
			expect((await store.get(run.journey.name, slot.id))?.elapsed).toBe(25)
			expect(await store.get('other-journey', slot.id)).toBeUndefined()
			await store.delete(run.journey.name, slot.id)
			expect(await store.get(run.journey.name, slot.id)).toBeUndefined()
		})
		it('pages runs by id and isolates journey listings', async () => {
			const store = await factory()
			const ids: string[] = []
			for (let index = 0; index < 3; index += 1) {
				const slot = await store.create(BROWSER_RUN_FIXTURE.journey.name)
				ids.push(slot.id)
				await store.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
			}
			ids.sort()
			const page = await store.list(BROWSER_RUN_FIXTURE.journey.name, { offset: 1, limit: 1 })
			expect(page.entries.map((run) => run.id)).toEqual(ids.slice(1, 2))
			expect(page.truncated).toBe(true)
			expect(page.faults).toEqual([])
			expect(
				(await store.list(BROWSER_RUN_FIXTURE.journey.name, { offset: 2, limit: 1 })).truncated,
			).toBe(false)
			expect(
				(await store.list(BROWSER_RUN_FIXTURE.journey.name, { offset: 20, limit: 1 })).entries,
			).toEqual([])
			expect((await store.list('other-journey')).entries).toEqual([])
		})
		it('refuses an unknown format before overwriting a run', async () => {
			const store = await factory()
			const slot = await store.create(BROWSER_RUN_FIXTURE.journey.name)
			const run = { ...structuredClone(BROWSER_RUN_FIXTURE), id: slot.id }
			await store.set(run)
			Reflect.set(run, 'format', 9)
			await expect(store.set(run)).rejects.toMatchObject({ code: 'JOURNEY_FORMAT' })
			expect((await store.get(run.journey.name, run.id))?.format).toBe(1)
		})
		it('honours an aborted signal on every primitive', async () => {
			const store = await factory()
			const options = { signal: AbortSignal.abort(new Error('store aborted')) }
			await expect(store.create('add-kettle', options)).rejects.toThrow('store aborted')
			await expect(store.clear('add-kettle', options)).rejects.toThrow('store aborted')
			await expect(store.get('add-kettle', BROWSER_RUN_FIXTURE.id, options)).rejects.toThrow(
				'store aborted',
			)
			await expect(store.set(BROWSER_RUN_FIXTURE, options)).rejects.toThrow('store aborted')
			await expect(store.delete('add-kettle', BROWSER_RUN_FIXTURE.id, options)).rejects.toThrow(
				'store aborted',
			)
			await expect(store.list('add-kettle', options)).rejects.toThrow('store aborted')
		})
	})
}
