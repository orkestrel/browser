/**
 * src/core/BrowserTransition.ts tests.
 */

import { describe, expect, it } from 'vitest'
import { waitForDelay } from '@orkestrel/test'
import { BrowserTransition } from '@src/core'

describe('BrowserTransition', () => {
	it('runs the work once and joins every caller that arrives while it is in transition', async () => {
		const transition = new BrowserTransition()
		const started: string[] = []
		const deferred = Promise.withResolvers<void>()

		const first = transition.execute(async () => {
			started.push('work')
			await deferred.promise
		})
		const second = transition.execute(async () => {
			started.push('work')
			await deferred.promise
		})

		expect(transition.pending).toBeDefined()
		deferred.resolve()
		await Promise.all([first, second])

		expect(started).toEqual(['work'])
		expect(transition.pending).toBeUndefined()
	})

	it('releases the field for a later transition once the first settles', async () => {
		const transition = new BrowserTransition()
		const started: string[] = []

		await transition.execute(async () => {
			started.push('first')
		})
		await transition.execute(async () => {
			started.push('second')
		})

		expect(started).toEqual(['first', 'second'])
	})

	it('rejects every joined caller and releases the field when the work fails', async () => {
		const transition = new BrowserTransition()
		const deferred = Promise.withResolvers<void>()

		const first = transition.execute(() => deferred.promise)
		const second = transition.execute(() => deferred.promise)
		deferred.reject(new Error('transition failed'))

		await expect(first).rejects.toThrow('transition failed')
		await expect(second).rejects.toThrow('transition failed')
		expect(transition.pending).toBeUndefined()
		await expect(transition.execute(async () => undefined)).resolves.toBeUndefined()
	})

	it('leaves a later transition owning the field when an earlier one settles after it', async () => {
		const transition = new BrowserTransition<string>()
		const slow = Promise.withResolvers<string>()

		const first = transition.execute(() => slow.promise)
		const held = transition.pending
		slow.resolve('first')
		await first

		const fast = transition.execute(async () => {
			await waitForDelay(10)
			return 'second'
		})
		expect(transition.pending).not.toBe(held)
		await expect(fast).resolves.toBe('second')
		expect(transition.pending).toBeUndefined()
	})

	it('returns the in-transition result to a caller that joins rather than re-running the work', async () => {
		const transition = new BrowserTransition<number>()
		let calls = 0

		const first = transition.execute(async () => {
			calls += 1
			await waitForDelay(10)
			return 42
		})
		const joined = transition.execute(async () => {
			calls += 1
			return 7
		})

		await expect(first).resolves.toBe(42)
		await expect(joined).resolves.toBe(42)
		expect(calls).toBe(1)
	})
})
