/**
 * src/core/BrowserDownload.ts tests.
 *
 * `BrowserDownload` is interned rather than barrelled, so it is imported by path. The
 * class projects `Browser.downloadProgress` records onto its own state and events, so
 * each case drives `update` with a real progress record and reads both.
 */

import { describe, expect, it } from 'vitest'
import { BrowserDownload } from '../../../src/core/BrowserDownload.js'
import { createRecorder } from '@orkestrel/test'
import { createConnectedCDPClient, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserDownload', () => {
	it('reports its identity and a pending, empty progress before any update', async () => {
		const { client } = await createConnectedCDPClient()
		const download = new BrowserDownload(client, 'download-1', 'https://example.com/f', 'f.txt')

		expect([download.id, download.url, download.name]).toStrictEqual([
			'download-1',
			'https://example.com/f',
			'f.txt',
		])
		expect([download.status, download.received, download.total, download.path]).toStrictEqual([
			'pending',
			0,
			0,
			undefined,
		])
	})

	it('publishes each in-flight progress record without completing', async () => {
		const { client } = await createConnectedCDPClient()
		const download = new BrowserDownload(client, 'download-1', 'https://example.com/f', 'f.txt')
		const progress = createRecorder<[received: number, total: number]>()
		download.emitter.on('progress', progress.handler)

		download.update({ status: 'pending', received: 10, total: 100 })
		download.update({ status: 'pending', received: 60, total: 100 })

		expect(progress.calls).toStrictEqual([
			[10, 100],
			[60, 100],
		])
		expect([download.status, download.received, download.total]).toStrictEqual(['pending', 60, 100])
	})

	it('completes with the written path and destroys its emitter', async () => {
		const { client } = await createConnectedCDPClient()
		const download = new BrowserDownload(client, 'download-1', 'https://example.com/f', 'f.txt')
		const completions = createRecorder<[path: string | undefined]>()
		download.emitter.on('complete', completions.handler)

		download.update({ status: 'complete', received: 100, total: 100, path: '/tmp/f.txt' })

		expect(completions.calls).toStrictEqual([['/tmp/f.txt']])
		expect([download.status, download.path]).toStrictEqual(['complete', '/tmp/f.txt'])
		expect(download.emitter.destroyed).toBe(true)
	})

	it('cancels through the protocol while pending and stops sending once settled', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.cancelDownload')
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			'context-1',
		)

		await download.cancel()
		download.update({ status: 'cancelled', received: 0, total: 0 })
		await download.cancel()

		expect(readCDPParams(transport, 'Browser.cancelDownload')).toStrictEqual([
			{ guid: 'download-1', browserContextId: 'context-1' },
		])
		expect(download.status).toBe('cancelled')
	})

	it('omits the context from the cancel frame when the download has none', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.cancelDownload')
		const download = new BrowserDownload(client, 'download-1', 'https://example.com/f', 'f.txt')

		await download.cancel()

		expect(readCDPParams(transport, 'Browser.cancelDownload')).toStrictEqual([
			{ guid: 'download-1' },
		])
	})

	it('ignores every update delivered after the download settled', async () => {
		const { client } = await createConnectedCDPClient()
		const download = new BrowserDownload(client, 'download-1', 'https://example.com/f', 'f.txt')
		const progress = createRecorder<[received: number, total: number]>()
		download.emitter.on('progress', progress.handler)

		download.update({ status: 'complete', received: 5, total: 5 })
		download.update({ status: 'pending', received: 9, total: 9 })

		expect(progress.calls).toStrictEqual([[5, 5]])
		expect([download.status, download.received, download.total]).toStrictEqual(['complete', 5, 5])
	})
})
