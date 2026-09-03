/**
 * src/core/BrowserProfiler.ts tests.
 *
 * The class owns one boolean lifecycle over the Profiler domain. Each case drives a real
 * profiler over the in-memory CDP transport and asserts on the frames it sent, the
 * decoded profile it returned, and the `active` state it reports between transitions.
 */

import { describe, expect, it } from 'vitest'
import { BrowserProfiler, isBrowserError } from '@src/core'
import { createAttachedPage, replyOk } from '../../setup.js'

const PROFILE_RESULT = {
	profile: {
		startTime: 10,
		endTime: 40,
		nodes: [
			{
				id: 1,
				callFrame: {
					functionName: 'main',
					scriptId: 'script-1',
					url: 'https://example.com/app.js',
					lineNumber: 3,
					columnNumber: 7,
				},
				hitCount: 2,
				children: [2],
			},
			{
				id: 2,
				callFrame: {
					functionName: 'render',
					scriptId: 'script-1',
					url: 'https://example.com/app.js',
					lineNumber: 9,
					columnNumber: 1,
				},
			},
		],
		samples: [1, 2, 1],
		timeDeltas: [0, 5, 5],
	},
}

describe('BrowserProfiler', () => {
	it('reports inactive before a start and active between start and stop', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		replyOk(transport, 'Profiler.disable')
		replyOk(transport, 'Profiler.stop', PROFILE_RESULT)
		const profiler = new BrowserProfiler(page)

		expect(profiler.active).toBe(false)
		await profiler.start()
		expect(profiler.active).toBe(true)
		await profiler.stop()
		expect(profiler.active).toBe(false)
	})

	it('decodes the sampled profile into its nodes, samples, and deltas', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		replyOk(transport, 'Profiler.disable')
		replyOk(transport, 'Profiler.stop', PROFILE_RESULT)
		const profiler = new BrowserProfiler(page)

		await profiler.start()
		const profile = await profiler.stop()

		expect([profile.start, profile.end]).toStrictEqual([10, 40])
		expect(profile.nodes.map((node) => [node.id, node.frame.function, node.hit])).toStrictEqual([
			[1, 'main', 2],
			[2, 'render', undefined],
		])
		expect(profile.samples).toStrictEqual([1, 2, 1])
		expect(profile.deltas).toStrictEqual([0, 5, 5])
	})

	it('sets an explicit sampling interval before enabling the domain', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.setSamplingInterval')
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		const profiler = new BrowserProfiler(page)

		await profiler.start(100)

		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Profiler.setSamplingInterval',
			'Profiler.enable',
			'Profiler.start',
		])
		expect(transport.sent[0]?.params).toStrictEqual({ interval: 100 })
	})

	it('refuses a zero, negative, or fractional sampling interval', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.setSamplingInterval')
		const profiler = new BrowserProfiler(page)

		await expect(profiler.start(0)).rejects.toSatisfy(isBrowserError)
		await expect(profiler.start(-1)).rejects.toSatisfy(isBrowserError)
		await expect(profiler.start(1.5)).rejects.toSatisfy(isBrowserError)

		expect(transport.sent).toStrictEqual([])
		expect(profiler.active).toBe(false)
	})

	it('refuses a second start and a stop with nothing running', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		const profiler = new BrowserProfiler(page)

		await expect(profiler.stop()).rejects.toThrow('Browser CPU profiling is not active')
		await profiler.start()
		await expect(profiler.start()).rejects.toThrow('Browser CPU profiling is already active')
	})

	it('disables the domain and stays inactive when the start frame fails', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.disable')
		transport.onSend('Profiler.start', (message) => transport.fail(message.id, 'start failed'))
		const profiler = new BrowserProfiler(page)

		await expect(profiler.start()).rejects.toThrow('start failed')

		expect(profiler.active).toBe(false)
		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Profiler.enable',
			'Profiler.start',
			'Profiler.disable',
		])
	})

	it('destroy stops an active profiler and is a no-op otherwise', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		replyOk(transport, 'Profiler.disable')
		replyOk(transport, 'Profiler.stop', PROFILE_RESULT)
		const profiler = new BrowserProfiler(page)

		await profiler.destroy()
		expect(transport.sent).toStrictEqual([])

		await profiler.start()
		await profiler.destroy()
		expect(profiler.active).toBe(false)
		expect(transport.sent.map((message) => message.method)).toContain('Profiler.stop')
	})

	it('destroy swallows a failing stop rather than rejecting', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		replyOk(transport, 'Profiler.disable')
		transport.onSend('Profiler.stop', (message) => transport.fail(message.id, 'stop failed'))
		const profiler = new BrowserProfiler(page)

		await profiler.start()

		await expect(profiler.destroy()).resolves.toBeUndefined()
		expect(profiler.active).toBe(false)
	})
})
