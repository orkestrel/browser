import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { createConnectedCDPClient, createRecordingWriter, replyOk } from '../../setup.js'

describe('BrowserDiagnostics', () => {
	it('streams a trace to bytes and persists the completed result', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const writer = createRecordingWriter()
		replyOk(transport, 'Tracing.start')
		transport.onSend('Tracing.end', (message) => {
			transport.reply(message.id, {})
			transport.event('Tracing.tracingComplete', { stream: 'stream-1' }, 'session-1')
		})
		let read = 0
		transport.onSend('IO.read', (message) => {
			read += 1
			transport.reply(
				message.id,
				read === 1
					? { data: 'hello ', eof: false }
					: { data: 'd29ybGQ=', base64Encoded: true, eof: true },
			)
		})
		replyOk(transport, 'IO.close')
		const page = new BrowserPage(client, 'target-1', 'session-1', writer)

		await page.diagnostics.tracing.start({
			path: 'trace.json',
			screenshots: true,
			sampling: true,
		})
		const result = await page.diagnostics.tracing.stop()

		expect(new TextDecoder().decode(result.bytes)).toBe('hello world')
		expect(writer.calls[0]?.path).toBe('trace.json')
		expect(
			transport.sent.find((message) => message.method === 'Tracing.start')?.params,
		).toMatchObject({
			transferMode: 'ReturnAsStream',
			traceConfig: {
				includedCategories: expect.arrayContaining([
					'disabled-by-default-devtools.screenshot',
					'disabled-by-default-v8.cpu_profiler',
				]),
			},
		})
	})

	it('rejects invalid tracing transitions', async () => {
		const { client } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.diagnostics.tracing.stop()).rejects.toSatisfy(isBrowserError)
	})

	it('clears tracing state when ending the trace fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Tracing.start')
		transport.onSend('Tracing.end', (message) => transport.fail(message.id, 'trace end failed'))
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.diagnostics.tracing.start()
		await expect(page.diagnostics.tracing.stop()).rejects.toThrow('trace end failed')

		expect(page.diagnostics.tracing.active).toBe(false)
		await expect(page.diagnostics.tracing.start()).resolves.toBeUndefined()
	})

	it('captures precise JavaScript and CSS coverage with validated ranges', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
			'CSS.disable',
			'DOM.disable',
		]) {
			replyOk(transport, method)
		}
		replyOk(transport, 'Profiler.takePreciseCoverage', {
			result: [
				{
					scriptId: 'script-1',
					url: 'https://example.com/app.js',
					functions: [
						{
							functionName: 'main',
							isBlockCoverage: true,
							ranges: [{ startOffset: 0, endOffset: 10, count: 2 }],
						},
					],
				},
			],
		})
		replyOk(transport, 'CSS.stopRuleUsageTracking', {
			ruleUsage: [
				{ styleSheetId: 'style-1', startOffset: 0, endOffset: 5, used: true },
				{ styleSheetId: 'style-1', startOffset: 5, endOffset: 9, used: false },
			],
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.diagnostics.coverage.start()
		const result = await page.diagnostics.coverage.stop()

		expect(result.scripts[0]).toMatchObject({
			id: 'script-1',
			functions: [{ name: 'main', block: true }],
		})
		expect(result.styles[0]).toEqual({
			id: 'style-1',
			ranges: [
				{ start: 0, end: 5, count: 1 },
				{ start: 5, end: 9, count: 0 },
			],
		})
	})

	it('rolls back partially enabled CSS coverage after setup failure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'DOM.enable')
		transport.onSend('CSS.enable', (message) => transport.fail(message.id, 'css failed'))
		replyOk(transport, 'DOM.disable')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.diagnostics.coverage.start({ javascript: false })).rejects.toThrow(
			'css failed',
		)

		expect(page.diagnostics.coverage.active).toBe(false)
		expect(transport.sent.some((message) => message.method === 'DOM.disable')).toBe(true)
	})

	it('tears down both coverage domains when result collection fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Profiler.enable',
			'Profiler.startPreciseCoverage',
			'DOM.enable',
			'CSS.enable',
			'CSS.startRuleUsageTracking',
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
			'CSS.disable',
			'DOM.disable',
		]) {
			replyOk(transport, method)
		}
		transport.onSend('Profiler.takePreciseCoverage', (message) => {
			transport.fail(message.id, 'coverage failed')
		})
		replyOk(transport, 'CSS.stopRuleUsageTracking', { ruleUsage: [] })
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.diagnostics.coverage.start()
		await expect(page.diagnostics.coverage.stop()).rejects.toThrow('coverage failed')

		expect(page.diagnostics.coverage.active).toBe(false)
		for (const method of [
			'Profiler.stopPreciseCoverage',
			'Profiler.disable',
			'CSS.stopRuleUsageTracking',
			'CSS.disable',
			'DOM.disable',
		]) {
			expect(transport.sent.some((message) => message.method === method)).toBe(true)
		}
	})

	it('reads performance metrics and validates a sampled CPU profile', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Performance.enable')
		replyOk(transport, 'Performance.disable')
		replyOk(transport, 'Performance.getMetrics', {
			metrics: [{ name: 'TaskDuration', value: 1.25 }],
		})
		replyOk(transport, 'Profiler.setSamplingInterval')
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.start')
		replyOk(transport, 'Profiler.disable')
		replyOk(transport, 'Profiler.stop', {
			profile: {
				startTime: 1,
				endTime: 2,
				nodes: [
					{
						id: 1,
						callFrame: {
							functionName: 'main',
							scriptId: 'script-1',
							url: 'https://example.com/app.js',
							lineNumber: 1,
							columnNumber: 2,
						},
						hitCount: 3,
						children: [2],
					},
				],
				samples: [1],
				timeDeltas: [100],
			},
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')

		expect(await page.diagnostics.performance.metrics()).toEqual([
			{ name: 'TaskDuration', value: 1.25 },
		])
		const methods = transport.sent.map((message) => message.method)
		expect(methods.lastIndexOf('Performance.disable')).toBeGreaterThan(
			methods.lastIndexOf('Performance.getMetrics'),
		)
		await page.diagnostics.profiler.start(100)
		const profile = await page.diagnostics.profiler.stop()

		expect(profile).toMatchObject({
			start: 1,
			end: 2,
			samples: [1],
			deltas: [100],
		})
		expect(profile.nodes[0]).toMatchObject({
			id: 1,
			frame: { function: 'main', script: 'script-1' },
			hit: 3,
			children: [2],
		})
	})

	it('disables the Performance domain after a failed metrics read', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Performance.enable')
		replyOk(transport, 'Performance.disable')
		transport.onSend('Performance.getMetrics', (message) =>
			transport.fail(message.id, 'metrics failed'),
		)
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.diagnostics.performance.metrics()).rejects.toThrow('metrics failed')

		const methods = transport.sent.map((message) => message.method)
		expect(methods.lastIndexOf('Performance.disable')).toBeGreaterThan(
			methods.lastIndexOf('Performance.getMetrics'),
		)
	})

	it('disables the profiler after start and stop failures', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Profiler.enable')
		replyOk(transport, 'Profiler.disable')
		transport.onSend('Profiler.start', (message) => transport.fail(message.id, 'start failed'))
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.diagnostics.profiler.start()).rejects.toThrow('start failed')

		expect(page.diagnostics.profiler.active).toBe(false)
		expect(transport.sent.some((message) => message.method === 'Profiler.disable')).toBe(true)
	})
})
