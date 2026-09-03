/**
 * src/core/BrowserTracing.ts tests.
 *
 * Tracing arms a `Tracing.tracingComplete` subscription, ends the trace, then drains the
 * IO stream Chromium hands back. Each case drives a real tracer over the in-memory CDP
 * transport, pushes the completion event through the transport the way Chromium would,
 * and reads the assembled bytes.
 */

import { describe, expect, it } from 'vitest'
import { BrowserTracing, isBrowserError } from '@src/core'
import { createAttachedPage, createRecordingWriter, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserTracing', () => {
	it('starts with the default categories and reports active between start and stop', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		const tracing = new BrowserTracing(page)

		expect(tracing.active).toBe(false)
		await tracing.start()
		expect(tracing.active).toBe(true)

		expect(readCDPParams(transport, 'Tracing.start')).toStrictEqual([
			{
				transferMode: 'ReturnAsStream',
				traceConfig: { includedCategories: ['devtools.timeline', 'v8.execute'] },
			},
		])
	})

	it('appends the screenshot and sampling categories when either is requested', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		const tracing = new BrowserTracing(page)

		await tracing.start({ categories: ['custom'], screenshots: true, sampling: true })

		expect(readCDPParams(transport, 'Tracing.start')[0]?.['traceConfig']).toStrictEqual({
			includedCategories: [
				'custom',
				'disabled-by-default-devtools.screenshot',
				'disabled-by-default-v8.cpu_profiler',
			],
		})
	})

	it('drains every stream chunk into one payload and closes the handle', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		replyOk(transport, 'Tracing.end')
		replyOk(transport, 'IO.close')
		let reads = 0
		transport.onSend('IO.read', (message) => {
			reads += 1
			transport.reply(
				message.id,
				reads === 1 ? { data: 'ab', eof: false } : { data: 'c', eof: true },
			)
		})
		transport.onSend('Tracing.end', () => {
			transport.event('Tracing.tracingComplete', { stream: 'stream-1' }, 'session-1')
		})
		const tracing = new BrowserTracing(page)

		await tracing.start()
		const trace = await tracing.stop()

		expect(new TextDecoder().decode(trace.bytes)).toBe('abc')
		expect(trace.path).toBeUndefined()
		expect(readCDPParams(transport, 'IO.close')).toStrictEqual([{ handle: 'stream-1' }])
		expect(tracing.active).toBe(false)
	})

	it('writes the trace to the configured path through the writer', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		replyOk(transport, 'Tracing.end')
		replyOk(transport, 'IO.close')
		replyOk(transport, 'IO.read', { data: 'trace', eof: true })
		transport.onSend('Tracing.end', () => {
			transport.event('Tracing.tracingComplete', { stream: 'stream-1' }, 'session-1')
		})
		const writer = createRecordingWriter()
		const tracing = new BrowserTracing(page, writer)

		await tracing.start({ path: 'traces/run.json' })
		const trace = await tracing.stop()

		expect(trace.path).toBe('traces/run.json')
		expect(writer.calls.map((call) => call.path)).toStrictEqual(['traces/run.json'])
		expect(new TextDecoder().decode(writer.calls[0]?.data)).toBe('trace')
	})

	it('refuses a path when no writer is configured', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		replyOk(transport, 'Tracing.end')
		replyOk(transport, 'IO.close')
		replyOk(transport, 'IO.read', { data: 'trace', eof: true })
		transport.onSend('Tracing.end', () => {
			transport.event('Tracing.tracingComplete', { stream: 'stream-1' }, 'session-1')
		})
		const tracing = new BrowserTracing(page)

		await tracing.start({ path: 'traces/run.json' })

		await expect(tracing.stop()).rejects.toThrow('Browser trace path requires a configured writer')
	})

	it('refuses a second start and a stop with nothing running', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		const tracing = new BrowserTracing(page)

		await expect(tracing.stop()).rejects.toThrow('Browser tracing is not active')
		await tracing.start()
		await expect(tracing.start()).rejects.toThrow('Browser tracing is already active')
	})

	it('stays inactive and unsubscribes when the start frame fails', async () => {
		const { page, transport } = await createAttachedPage()
		transport.onSend('Tracing.start', (message) => transport.fail(message.id, 'start failed'))
		const tracing = new BrowserTracing(page)

		await expect(tracing.start()).rejects.toThrow('start failed')

		expect(tracing.active).toBe(false)
		await expect(tracing.stop()).rejects.toThrow('Browser tracing is not active')
	})

	it('rejects a completion event that names no stream', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		replyOk(transport, 'Tracing.end')
		transport.onSend('Tracing.end', () => {
			transport.event('Tracing.tracingComplete', {}, 'session-1')
		})
		const tracing = new BrowserTracing(page)

		await tracing.start()

		await expect(tracing.stop()).rejects.toSatisfy(isBrowserError)
		expect(tracing.active).toBe(false)
	})

	it('destroy stops an active trace and is a no-op otherwise', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Tracing.start')
		replyOk(transport, 'Tracing.end')
		replyOk(transport, 'IO.close')
		replyOk(transport, 'IO.read', { data: 'trace', eof: true })
		transport.onSend('Tracing.end', () => {
			transport.event('Tracing.tracingComplete', { stream: 'stream-1' }, 'session-1')
		})
		const tracing = new BrowserTracing(page)

		await tracing.destroy()
		expect(transport.sent).toStrictEqual([])

		await tracing.start()
		await tracing.destroy()

		expect(tracing.active).toBe(false)
		expect(transport.sent.map((message) => message.method)).toContain('Tracing.end')
	})
})
