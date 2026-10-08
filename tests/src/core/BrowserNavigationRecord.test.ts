/**
 * Proof for `src/core/BrowserNavigationRecord.ts`.
 *
 * Each case drives a real record over a real step emitter that stands in for the steps a page
 * accepts, over the parent tree {@link BROWSER_RECORD_PARENTS} names. Every pending assertion holds
 * the next step back separately, so releasing two steps together never proves both waits.
 */

import type { BrowserSettlementResult } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { isBrowserError } from '@src/core'
import { BROWSER_RECORD_PARENTS, openBrowserNavigationRecord } from '../../setup.js'

describe('BrowserNavigationRecord', () => {
	describe('reason', () => {
		it('reports the reason of the selected start through its commit and load after wait resolves', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const waiting = record.wait({ timeout: 10_000 })
			steps.emit('request', 'main', 'https://example.test/next', undefined, 'formSubmissionPost')
			await waiting
			steps.emit(
				'request',
				'main',
				'https://example.test/next',
				'loader-next',
				'formSubmissionPost',
			)
			steps.emit('commit', 'main', 'https://example.test/next', 'loader-next', false)
			expect(await record.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/next',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			steps.emit('load', 'main', 'loader-next')
			expect(await record.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/next',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			record.destroy()
		})

		it("reports a superseding start's own reason over the request it replaced, and a request's reason for a same-document commit", async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			steps.emit('request', 'main', 'https://example.test/a', undefined, 'anchorClick')
			steps.emit('request', 'main', 'https://example.test/b', 'loader-b', undefined)
			expect(await record.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/b',
				stage: 'requested',
				reason: undefined,
			})
			record.destroy()
			const { record: fragment } = openBrowserNavigationRecord('main', steps)
			steps.emit(
				'request',
				'main',
				'https://example.test/cart?q=1#placed',
				undefined,
				'formSubmissionGet',
			)
			steps.emit('commit', 'main', 'https://example.test/cart?q=1#placed', undefined, true)
			expect(await fragment.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/cart?q=1#placed',
				stage: 'loaded',
				reason: 'formSubmissionGet',
			})
			fragment.destroy()
		})
	})

	describe('settle', () => {
		it('follows the earliest eligible start through its commit and the load of its loader', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.then(settled.handler)
			steps.emit('request', 'main', 'https://example.test/next', 'loader-next', undefined)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('commit', 'main', 'https://example.test/next', 'loader-next', false)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('load', 'main', 'loader-next')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/next', stage: 'loaded' }]])
			record.destroy()
		})

		it('ignores every step that arrived before the record opened', async () => {
			const { steps, record: earlier } = openBrowserNavigationRecord('main')
			steps.emit('request', 'main', 'https://example.test/a', 'loader-a', undefined)
			steps.emit('commit', 'main', 'https://example.test/a', 'loader-a', false)
			earlier.destroy()
			const { record } = openBrowserNavigationRecord('main', steps)
			steps.emit('load', 'main', 'loader-a')
			expect(await record.settle({ timeout: 10_000 })).toBeUndefined()
			record.destroy()
		})

		it('rejects a commit and load whose loader differs from the selected navigation', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.then(settled.handler)
			steps.emit('request', 'main', 'https://example.test/b', 'loader-b', undefined)
			steps.emit('commit', 'main', 'https://example.test/a', 'loader-a', false)
			steps.emit('load', 'main', 'loader-a')
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('commit', 'main', 'https://example.test/b', 'loader-b', false)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('load', 'main', 'loader-b')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/b', stage: 'loaded' }]])
			record.destroy()
		})

		it('takes the first commit after a start that names no loader', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			steps.emit('request', 'main', 'https://example.test/next', undefined, undefined)
			steps.emit('commit', 'main', 'https://example.test/next', 'loader-next', false)
			expect(await record.settle({ timeout: 20 })).toEqual({
				url: 'https://example.test/next',
				stage: 'committed',
			})
			record.destroy()
		})

		it('follows a navigation that supersedes the selected one in its frame before the commit', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.then(settled.handler)
			steps.emit('request', 'main', 'https://example.test/cart', 'loader-post', undefined)
			steps.emit('request', 'main', 'https://example.test/receipt', 'loader-redirect', undefined)
			steps.emit('commit', 'main', 'https://example.test/cart', 'loader-post', false)
			steps.emit('load', 'main', 'loader-post')
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('commit', 'main', 'https://example.test/receipt', 'loader-redirect', false)
			steps.emit('load', 'main', 'loader-redirect')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/receipt', stage: 'loaded' }]])
			record.destroy()
		})

		it('ignores a load that precedes the selected commit', async () => {
			const { steps, record } = openBrowserNavigationRecord('child')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'child', relationship: 'self' }] })
				.then(settled.handler)
			steps.emit('request', 'child', 'https://example.test/done', undefined, undefined)
			steps.emit('load', 'child', undefined)
			steps.emit('commit', 'child', 'https://example.test/done', undefined, false)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('load', 'child', undefined)
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/done', stage: 'loaded' }]])
			record.destroy()
		})

		it('settles a navigation that stays within the document without a load', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.then(settled.handler)
			steps.emit('request', 'main', 'https://example.test/cart?q=1#placed', undefined, undefined)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('commit', 'main', 'https://example.test/cart?q=1#placed', undefined, true)
			await waitForDelay()
			expect(settled.calls).toEqual([
				[{ url: 'https://example.test/cart?q=1#placed', stage: 'loaded' }],
			])
			record.destroy()
		})

		it('returns at once when no destination was submitted and nothing started', async () => {
			const { record } = openBrowserNavigationRecord('main')
			const started = performance.now()
			expect(await record.settle({ timeout: 10_000 })).toBeUndefined()
			expect(performance.now() - started).toBeLessThan(1_000)
			record.destroy()
		})

		it('bounds a submission that produces no navigation request without a stage', async () => {
			const { record } = openBrowserNavigationRecord('main')
			const started = performance.now()
			expect(
				await record.settle({
					destinations: [{ frame: 'main', relationship: 'self' }],
					timeout: 40,
				}),
			).toBeUndefined()
			expect(performance.now() - started).toBeGreaterThanOrEqual(35)
			record.destroy()
		})

		it('resolves with the stage it reached when its timeout passes', async () => {
			const requested = openBrowserNavigationRecord('main')
			requested.steps.emit('request', 'main', 'https://example.test/next', 'loader-next', undefined)
			expect(await requested.record.settle({ timeout: 20 })).toEqual({
				url: 'https://example.test/next',
				stage: 'requested',
			})
			requested.record.destroy()
			const committed = openBrowserNavigationRecord('main')
			committed.steps.emit('request', 'main', 'https://example.test/next', 'loader-next', undefined)
			committed.steps.emit('commit', 'main', 'https://example.test/final', 'loader-next', false)
			expect(await committed.record.settle({ timeout: 20 })).toEqual({
				url: 'https://example.test/final',
				stage: 'committed',
			})
			committed.record.destroy()
		})

		it('waits for the main frame when a child document submits to _top', async () => {
			const { steps, record } = openBrowserNavigationRecord('child')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'child', relationship: 'top' }] })
				.then(settled.handler)
			await waitForDelay(20)
			expect(settled.count).toBe(0)
			steps.emit('request', 'main', 'https://example.test/next', 'loader-next', undefined)
			steps.emit('commit', 'main', 'https://example.test/next', 'loader-next', false)
			steps.emit('load', 'main', 'loader-next')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/next', stage: 'loaded' }]])
			record.destroy()
		})

		it('waits for the parent frame when a nested document submits to _parent', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'nested', relationship: 'parent' }], timeout: 10_000 })
				.then(settled.handler)
			steps.emit('request', 'side', 'https://example.test/side', 'loader-side', undefined)
			steps.emit('request', 'nested', 'https://example.test/nested', 'loader-nested', undefined)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('request', 'child', 'https://example.test/applied', 'loader-applied', undefined)
			steps.emit('commit', 'child', 'https://example.test/applied', 'loader-applied', false)
			steps.emit('load', 'child', 'loader-applied')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/applied', stage: 'loaded' }]])
			record.destroy()
		})

		it('waits for the first navigation any frame starts when the page cannot name the parent', async () => {
			expect(BROWSER_RECORD_PARENTS.has('orphan')).toBe(false)
			const { steps, record } = openBrowserNavigationRecord('main')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'orphan', relationship: 'parent' }], timeout: 10_000 })
				.then(settled.handler)
			steps.emit('request', 'side', 'https://example.test/side', 'loader-side', undefined)
			steps.emit('commit', 'side', 'https://example.test/side', 'loader-side', false)
			steps.emit('load', 'side', 'loader-side')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/side', stage: 'loaded' }]])
			record.destroy()
		})

		it('settles the destination that requests among several without waiting for the others', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const settling = record.settle({
				destinations: [
					{ frame: 'child', relationship: 'self' },
					{ frame: 'side', relationship: 'self' },
				],
				timeout: 10_000,
			})
			steps.emit('request', 'side', 'https://example.test/side', 'loader-side', undefined)
			steps.emit('commit', 'side', 'https://example.test/side', 'loader-side', false)
			steps.emit('load', 'side', 'loader-side')
			const started = performance.now()
			expect(await settling).toEqual({ url: 'https://example.test/side', stage: 'loaded' })
			expect(performance.now() - started).toBeLessThan(1_000)
			record.destroy()
		})

		it('ignores a request of a frame outside its frame, its ancestors, and its destinations', async () => {
			const { steps, record } = openBrowserNavigationRecord('child')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			void record
				.settle({ destinations: [{ frame: 'child', relationship: 'self' }], timeout: 10_000 })
				.then(settled.handler)
			steps.emit('request', 'side', 'https://example.test/side', 'loader-side', undefined)
			steps.emit('commit', 'side', 'https://example.test/side', 'loader-side', false)
			steps.emit('load', 'side', 'loader-side')
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('request', 'child', 'https://example.test/done', 'loader-done', undefined)
			steps.emit('commit', 'child', 'https://example.test/done', 'loader-done', false)
			steps.emit('load', 'child', 'loader-done')
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/done', stage: 'loaded' }]])
			record.destroy()
		})

		it('follows its frame across a swap and ends when the frame detaches', async () => {
			const { steps, record } = openBrowserNavigationRecord('child')
			const settled = createRecorder<[result: BrowserSettlementResult | undefined]>()
			steps.emit('request', 'child', 'https://example.test/voucher', 'loader-voucher', undefined)
			void record.settle({ timeout: 10_000 }).then(settled.handler)
			steps.emit('detach', 'child', true)
			steps.emit('commit', 'child', 'https://example.test/voucher', 'loader-voucher', false)
			await waitForDelay()
			expect(settled.count).toBe(0)
			steps.emit('detach', 'child', false)
			await waitForDelay()
			expect(settled.calls).toEqual([[{ url: 'https://example.test/voucher', stage: 'committed' }]])
			record.destroy()
		})
	})

	describe('wait', () => {
		it('resolves at the first start in its frame or an ancestor and not in another frame', async () => {
			const { steps, record } = openBrowserNavigationRecord('nested')
			const started = createRecorder<[]>()
			void record.wait().then(started.handler)
			steps.emit('request', 'side', 'https://example.test/side', 'loader-side', undefined)
			await waitForDelay()
			expect(started.count).toBe(0)
			steps.emit('request', 'main', 'https://example.test/next', undefined, undefined)
			await waitForDelay()
			expect(started.count).toBe(1)
			await expect(record.wait()).resolves.toBeUndefined()
			record.destroy()
		})

		it('rejects an invalid timeout for a wait and a settlement', async () => {
			const { record } = openBrowserNavigationRecord('main')
			for (const error of [
				await record.wait({ timeout: -1 }).catch((caught: unknown) => caught),
				await record.settle({ timeout: Number.NaN }).catch((caught: unknown) => caught),
			])
				expect(isBrowserError(error) && error.message).toBe(
					'Browser timeout must be a non-negative finite number',
				)
			record.destroy()
		})

		it('rejects at its timeout with TIMEOUT', async () => {
			const { record } = openBrowserNavigationRecord('main')
			const error = await record.wait({ timeout: 20 }).catch((caught: unknown) => caught)
			expect(isBrowserError(error) && [error.code, error.context]).toEqual([
				'TIMEOUT',
				{ operation: 'wait', frame: 'main', timeout: 20 },
			])
			record.destroy()
		})
	})

	describe('lifetime', () => {
		it('rejects a pending wait and settlement with the reason of an abort and releases their timers', async () => {
			const { record } = openBrowserNavigationRecord('main')
			const timers = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length
			const controller = new AbortController()
			const waiting = record.wait({ signal: controller.signal }).catch((error: unknown) => error)
			const settling = record
				.settle({
					destinations: [{ frame: 'main', relationship: 'self' }],
					signal: controller.signal,
				})
				.catch((error: unknown) => error)
			const reason = new Error('The caller left')
			controller.abort(reason)
			expect(await waiting).toBe(reason)
			expect(await settling).toBe(reason)
			expect(process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length).toBe(
				timers,
			)
			await expect(record.settle({ signal: controller.signal })).rejects.toBe(reason)
			record.destroy()
		})

		it('honours a cancellation that lands in the same turn as the completing load', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const controller = new AbortController()
			steps.emit('request', 'main', 'https://example.test/next', 'loader-next', undefined)
			steps.emit('commit', 'main', 'https://example.test/next', 'loader-next', false)
			const settling = record.settle({ signal: controller.signal }).catch((error: unknown) => error)
			const reason = new Error('The caller left')
			steps.emit('load', 'main', 'loader-next')
			controller.abort(reason)
			expect(await settling).toBe(reason)
			record.destroy()
		})

		it('releases its timers when a navigation completes', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			const timers = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length
			const waiting = record.wait()
			const settling = record.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
			steps.emit('request', 'main', 'https://example.test/next', undefined, undefined)
			steps.emit('commit', 'main', 'https://example.test/next', undefined, true)
			await waiting
			await settling
			expect(process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length).toBe(
				timers,
			)
			record.destroy()
		})

		it('rejects what is pending when it ends, refuses later calls, and leaves the steps', async () => {
			const { steps, record } = openBrowserNavigationRecord('main')
			expect(steps.count()).toBe(4)
			const waiting = record.wait().catch((error: unknown) => error)
			const settling = record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.catch((error: unknown) => error)
			record.destroy()
			expect(steps.count()).toBe(0)
			const later = await record.wait().catch((error: unknown) => error)
			for (const error of [await waiting, await settling, later])
				expect(isBrowserError(error) && error.message).toBe('Browser navigation record ended')
		})

		it('rejects what is pending with the reason the page closed with, from then on', async () => {
			const { lifetime, record } = openBrowserNavigationRecord('main')
			const waiting = record.wait().catch((error: unknown) => error)
			const closed = new Error('Browser navigation wait ended because the page closed')
			lifetime.abort(closed)
			expect(await waiting).toBe(closed)
			await expect(record.settle()).rejects.toBe(closed)
		})
	})
})
