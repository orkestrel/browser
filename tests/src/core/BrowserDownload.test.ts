/**
 * src/core/BrowserDownload.ts tests.
 *
 * `BrowserDownload` is interned rather than barrelled, so it is imported by path. The
 * class projects `Browser.downloadProgress` records onto its own state and events, so
 * each case drives its constructor callback with a real progress record and reads both.
 */

import type { BrowserDownloadProgress } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserDownload } from '../../../src/core/BrowserDownload.js'
import { createRecorder, requireValue } from '@orkestrel/test'
import { createConnectedCDPClient, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserDownload', () => {
	it('reports its identity and a pending, empty progress before any update', async () => {
		const { client } = await createConnectedCDPClient()
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			undefined,
			drivers.handler,
		)

		expect('update' in download).toBe(false)
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
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			undefined,
			drivers.handler,
		)
		const progress = createRecorder<[received: number, total: number]>()
		download.emitter.on('progress', progress.handler)

		requireValue(drivers.calls[0]?.[0])({ status: 'pending', received: 10, total: 100 })
		requireValue(drivers.calls[0]?.[0])({ status: 'pending', received: 60, total: 100 })

		expect(progress.calls).toStrictEqual([
			[10, 100],
			[60, 100],
		])
		expect([download.status, download.received, download.total]).toStrictEqual(['pending', 60, 100])
	})

	it('completes with the written path and destroys its emitter', async () => {
		const { client } = await createConnectedCDPClient()
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			undefined,
			drivers.handler,
		)
		const completions = createRecorder<[path: string | undefined]>()
		download.emitter.on('complete', completions.handler)

		requireValue(drivers.calls[0]?.[0])({
			status: 'complete',
			received: 100,
			total: 100,
			path: '/tmp/f.txt',
		})

		expect(completions.calls).toStrictEqual([['/tmp/f.txt']])
		expect([download.status, download.path]).toStrictEqual(['complete', '/tmp/f.txt'])
		expect(download.emitter.destroyed).toBe(true)
	})

	it('aborts through the protocol while pending and stops sending once settled', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.cancelDownload')
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			'context-1',
			drivers.handler,
		)

		await download.abort()
		requireValue(drivers.calls[0]?.[0])({ status: 'aborted', received: 0, total: 0 })
		await download.abort()

		expect(readCDPParams(transport, 'Browser.cancelDownload')).toStrictEqual([
			{ guid: 'download-1', browserContextId: 'context-1' },
		])
		expect(download.status).toBe('aborted')
	})

	it('omits the context from the abort frame when the download has none', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.cancelDownload')
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			undefined,
			drivers.handler,
		)

		await download.abort()

		expect(readCDPParams(transport, 'Browser.cancelDownload')).toStrictEqual([
			{ guid: 'download-1' },
		])
	})

	it('ignores every update delivered after the download settled', async () => {
		const { client } = await createConnectedCDPClient()
		const drivers = createRecorder<[(progress: BrowserDownloadProgress) => void]>()
		const download = new BrowserDownload(
			client,
			'download-1',
			'https://example.com/f',
			'f.txt',
			undefined,
			drivers.handler,
		)
		const progress = createRecorder<[received: number, total: number]>()
		download.emitter.on('progress', progress.handler)

		requireValue(drivers.calls[0]?.[0])({ status: 'complete', received: 5, total: 5 })
		requireValue(drivers.calls[0]?.[0])({ status: 'pending', received: 9, total: 9 })

		expect(progress.calls).toStrictEqual([[5, 5]])
		expect([download.status, download.received, download.total]).toStrictEqual(['complete', 5, 5])
	})
})
