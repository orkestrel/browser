/**
 * src/core/BrowserPerformance.ts tests.
 *
 * The class enables the Performance domain, reads its metrics, and disables the domain
 * again. Each case drives it over the in-memory CDP transport and reads both the frames
 * it sent and the decoded metrics it returned.
 */

import { describe, expect, it } from 'vitest'
import { BrowserPerformance, isBrowserError } from '@src/core'
import { createAttachedPage, replyOk } from '../../setup.js'

describe('BrowserPerformance', () => {
	it('enables the domain, reads the metrics, and disables it again', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Performance.enable')
		replyOk(transport, 'Performance.disable')
		replyOk(transport, 'Performance.getMetrics', {
			metrics: [
				{ name: 'Timestamp', value: 12.5 },
				{ name: 'Nodes', value: 41 },
			],
		})
		const performance = new BrowserPerformance(page)

		await expect(performance.metrics()).resolves.toStrictEqual([
			{ name: 'Timestamp', value: 12.5 },
			{ name: 'Nodes', value: 41 },
		])
		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Performance.enable',
			'Performance.getMetrics',
			'Performance.disable',
		])
	})

	it('returns an empty list for an empty metric set', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Performance.enable')
		replyOk(transport, 'Performance.disable')
		replyOk(transport, 'Performance.getMetrics', { metrics: [] })
		const performance = new BrowserPerformance(page)

		await expect(performance.metrics()).resolves.toStrictEqual([])
	})

	it('rejects a malformed metric set and still disables the domain', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Performance.enable')
		replyOk(transport, 'Performance.disable')
		replyOk(transport, 'Performance.getMetrics', { metrics: [{ name: 'Nodes', value: 'many' }] })
		const performance = new BrowserPerformance(page)

		await expect(performance.metrics()).rejects.toSatisfy(isBrowserError)
		expect(transport.sent.map((message) => message.method)).toContain('Performance.disable')
	})

	it('surfaces a failing enable without reading metrics', async () => {
		const { page, transport } = await createAttachedPage()
		transport.onSend('Performance.enable', (message) => transport.fail(message.id, 'enable failed'))
		replyOk(transport, 'Performance.disable')
		const performance = new BrowserPerformance(page)

		await expect(performance.metrics()).rejects.toThrow('enable failed')
		expect(transport.sent.map((message) => message.method)).toStrictEqual(['Performance.enable'])
	})
})
