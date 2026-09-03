/**
 * src/core/BrowserCoverage.ts tests.
 *
 * The class arms the Profiler and CSS domains together and must unwind exactly the
 * domains it armed when a later step fails. Each case drives a real coverage collector
 * over the in-memory CDP transport and reads the frames it sent in order.
 */

import { describe, expect, it } from 'vitest'
import { BrowserCoverage, isBrowserError } from '@src/core'
import { createAttachedPage, replyOk } from '../../setup.js'

const SCRIPT_COVERAGE = {
	result: [
		{
			scriptId: 'script-1',
			url: 'https://example.com/app.js',
			functions: [
				{
					functionName: 'main',
					isBlockCoverage: true,
					ranges: [{ startOffset: 0, endOffset: 40, count: 2 }],
				},
			],
		},
	],
}

const STYLE_COVERAGE = {
	ruleUsage: [
		{ styleSheetId: 'sheet-1', startOffset: 0, endOffset: 10, used: true },
		{ styleSheetId: 'sheet-1', startOffset: 10, endOffset: 24, used: false },
	],
}

describe('BrowserCoverage', () => {
	it('arms both domains by default and reports active between start and stop', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
		]) {
			replyOk(transport, method)
		}
		const coverage = new BrowserCoverage(page)

		expect(coverage.active).toBe(false)
		await coverage.start()
		expect(coverage.active).toBe(true)

		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
		])
	})

	it('decodes script and style usage into their public shapes', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
			'DOM.enable',
			'DOM.disable',
			'CSS.enable',
			'CSS.disable',
			'CSS.startRuleUsageTracking',
		]) {
			replyOk(transport, method)
		}
		replyOk(transport, 'Profiler.takePreciseCoverage', SCRIPT_COVERAGE)
		replyOk(transport, 'CSS.stopRuleUsageTracking', STYLE_COVERAGE)
		const coverage = new BrowserCoverage(page)

		await coverage.start()
		const usage = await coverage.stop()

		expect(usage.scripts).toStrictEqual([
			{
				id: 'script-1',
				url: 'https://example.com/app.js',
				functions: [{ name: 'main', block: true, ranges: [{ start: 0, end: 40, count: 2 }] }],
			},
		])
		expect(usage.styles).toStrictEqual([
			{
				id: 'sheet-1',
				ranges: [
					{ start: 0, end: 10, count: 1 },
					{ start: 10, end: 24, count: 0 },
				],
			},
		])
		expect(coverage.active).toBe(false)
	})

	it('arms only the Profiler domain when css is turned off', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.startPreciseCoverage')
		const coverage = new BrowserCoverage(page)

		await coverage.start({ css: false })

		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
		])
	})

	it('refuses a start that turns off JavaScript and CSS together', async () => {
		const { page, transport } = await createAttachedPage()
		const coverage = new BrowserCoverage(page)

		await expect(coverage.start({ javascript: false, css: false })).rejects.toThrow(
			'Browser coverage requires JavaScript, CSS, or both',
		)
		expect(transport.sent).toStrictEqual([])
	})

	it('refuses a second start and a stop with nothing running', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
		]) {
			replyOk(transport, method)
		}
		const coverage = new BrowserCoverage(page)

		await expect(coverage.stop()).rejects.toThrow('Browser coverage is not active')
		await coverage.start()
		await expect(coverage.start()).rejects.toThrow('Browser coverage is already active')
	})

	it('unwinds every domain it armed when the CSS tracking start fails', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
			'DOM.enable',
			'DOM.disable',
			'CSS.enable',
			'CSS.disable',
		]) {
			replyOk(transport, method)
		}
		transport.onSend('CSS.startRuleUsageTracking', (message) =>
			transport.fail(message.id, 'tracking failed'),
		)
		const coverage = new BrowserCoverage(page)

		await expect(coverage.start()).rejects.toThrow('tracking failed')

		expect(coverage.active).toBe(false)
		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
			'CSS.disable',
			'DOM.disable',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
		])
	})

	it('rejects a malformed coverage payload', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
		]) {
			replyOk(transport, method)
		}
		replyOk(transport, 'Profiler.takePreciseCoverage', { result: 'not-a-list' })
		const coverage = new BrowserCoverage(page)

		await coverage.start({ css: false })
		await expect(coverage.stop()).rejects.toSatisfy(isBrowserError)
	})

	it('destroy stops an active collector and is a no-op otherwise', async () => {
		const { page, transport } = await createAttachedPage()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
		]) {
			replyOk(transport, method)
		}
		replyOk(transport, 'Profiler.takePreciseCoverage', SCRIPT_COVERAGE)
		const coverage = new BrowserCoverage(page)

		await coverage.destroy()
		expect(transport.sent).toStrictEqual([])

		await coverage.start({ css: false })
		await coverage.destroy()
		expect(coverage.active).toBe(false)
		expect(transport.sent.map((message) => message.method)).toContain(
			'Profiler.takePreciseCoverage',
		)
	})
})
