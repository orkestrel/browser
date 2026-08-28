/**
 * src/core/BrowserFlight.ts tests.
 */

import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { BrowserFlight } from '@src/core'

describe('BrowserFlight', () => {
	it('runs the work once and joins every caller that arrives while it is in flight', async () => {
		const flight = new BrowserFlight()
		const started: string[] = []
		const deferred = Promise.withResolvers<void>()

		const first = flight.execute(async () => {
			started.push('work')
			await deferred.promise
		})
		const second = flight.execute(async () => {
			started.push('work')
			await deferred.promise
		})

		expect(flight.attempt).toBeDefined()
		deferred.resolve()
		await Promise.all([first, second])

		expect(started).toEqual(['work'])
		expect(flight.attempt).toBeUndefined()
	})

	it('releases the field for a later transition once the first settles', async () => {
		const flight = new BrowserFlight()
		const started: string[] = []

		await flight.execute(async () => {
			started.push('first')
		})
		await flight.execute(async () => {
			started.push('second')
		})

		expect(started).toEqual(['first', 'second'])
	})

	it('rejects every joined caller and releases the field when the work fails', async () => {
		const flight = new BrowserFlight()
		const deferred = Promise.withResolvers<void>()

		const first = flight.execute(() => deferred.promise)
		const second = flight.execute(() => deferred.promise)
		deferred.reject(new Error('transition failed'))

		await expect(first).rejects.toThrow('transition failed')
		await expect(second).rejects.toThrow('transition failed')
		expect(flight.attempt).toBeUndefined()
		await expect(flight.execute(async () => undefined)).resolves.toBeUndefined()
	})

	it('leaves a later transition owning the field when an earlier one settles after it', async () => {
		const flight = new BrowserFlight<string>()
		const slow = Promise.withResolvers<string>()

		const first = flight.execute(() => slow.promise)
		const held = flight.attempt
		slow.resolve('first')
		await first

		const fast = flight.execute(async () => {
			await waitForDelay(10)
			return 'second'
		})
		expect(flight.attempt).not.toBe(held)
		await expect(fast).resolves.toBe('second')
		expect(flight.attempt).toBeUndefined()
	})

	it('returns the in-flight result to a caller that joins rather than re-running the work', async () => {
		const flight = new BrowserFlight<number>()
		let calls = 0

		const first = flight.execute(async () => {
			calls += 1
			await waitForDelay(10)
			return 42
		})
		const joined = flight.execute(async () => {
			calls += 1
			return 7
		})

		await expect(first).resolves.toBe(42)
		await expect(joined).resolves.toBe(42)
		expect(calls).toBe(1)
	})
})
