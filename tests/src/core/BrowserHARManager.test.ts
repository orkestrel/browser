import type { BrowserHAR } from '@src/core'
import { describe, expect, it } from 'vitest'
import { browserHARHeadersToRecord, BrowserPage, validateBrowserHAR } from '@src/core'
import { createConnectedCDPClient, createScreenshotWriter, replyOk } from '../../setup.js'

describe('BrowserHARManager', () => {
	it('removes recording listeners when Network startup fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Network.enable', (message) => transport.fail(message.id, 'network failed'))
		replyOk(transport, 'Fetch.disable')
		replyOk(transport, 'Network.disable')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const baseline = page.network.emitter.count()

		await expect(page.network.har.start()).rejects.toThrow('network failed')

		expect(page.network.har.recording).toBe(false)
		expect(page.network.emitter.count()).toBe(baseline)
	})

	it('records completed exchanges with optional base64 response content and persistence', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const writer = createScreenshotWriter()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Network.getResponseBody', {
			body: 'hello',
			base64Encoded: false,
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', writer, undefined, 'frame-1')
		await page.network.har.start({ content: true, path: 'trace.har' })

		transport.event(
			'Network.requestWillBeSent',
			{
				requestId: 'request-1',
				loaderId: 'loader-1',
				frameId: 'frame-1',
				timestamp: 1,
				wallTime: 2,
				request: {
					url: 'https://example.com/api',
					method: 'GET',
					headers: { accept: 'text/plain' },
				},
			},
			'session-1',
		)
		transport.event(
			'Network.responseReceived',
			{
				requestId: 'request-1',
				loaderId: 'loader-1',
				frameId: 'frame-1',
				timestamp: 2,
				response: {
					url: 'https://example.com/api',
					status: 200,
					statusText: 'OK',
					headers: { 'content-type': 'text/plain' },
					mimeType: 'text/plain',
					protocol: 'h2',
				},
			},
			'session-1',
		)
		transport.event('Network.loadingFinished', { requestId: 'request-1' }, 'session-1')

		const har = await page.network.har.stop()

		expect(har.log.version).toBe('1.2')
		expect(har.log.creator.name).toBe('@orkestrel/browser')
		expect(har.log.entries).toHaveLength(1)
		expect(har.log.entries[0]?.response).toMatchObject({
			status: 200,
			content: {
				text: 'aGVsbG8=',
				encoding: 'base64',
				size: 5,
			},
		})
		expect(writer.calls[0]?.path).toBe('trace.har')
		expect(new TextDecoder().decode(writer.calls[0]?.data)).toContain('"version": "1.2"')
	})

	it('replays matching entries and aborts an archive miss when fallback is disabled', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		replyOk(transport, 'Fetch.fulfillRequest')
		replyOk(transport, 'Fetch.failRequest')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const har: BrowserHAR = {
			log: {
				version: '1.2',
				creator: { name: 'test', version: '1' },
				entries: [
					{
						startedDateTime: '1970-01-01T00:00:00.000Z',
						time: 1,
						request: {
							method: 'GET',
							url: 'https://example.com/a',
							httpVersion: 'h2',
							cookies: [],
							headers: [],
							queryString: [],
							postData: undefined,
							headersSize: -1,
							bodySize: 0,
						},
						response: {
							status: 200,
							statusText: 'OK',
							httpVersion: 'h2',
							cookies: [],
							headers: [],
							content: {
								size: 2,
								mimeType: 'text/plain',
								text: 'b2s=',
								encoding: 'base64',
							},
							redirectURL: '',
							headersSize: -1,
							bodySize: 2,
						},
						cache: {},
						timings: {
							blocked: -1,
							dns: -1,
							connect: -1,
							send: 0,
							wait: 1,
							receive: 0,
							ssl: -1,
						},
					},
				],
			},
		}
		await page.network.har.replay(har)

		for (const [id, url] of [
			['fetch-hit', 'https://example.com/a'],
			['fetch-miss', 'https://example.com/b'],
		]) {
			transport.event(
				'Fetch.requestPaused',
				{ requestId: id, request: { url, method: 'GET', headers: {} } },
				'session-1',
			)
		}
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Fetch.fulfillRequest' &&
					message.params?.['requestId'] === 'fetch-hit',
			),
		).toBe(true)
		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Fetch.failRequest' && message.params?.['requestId'] === 'fetch-miss',
			),
		).toBe(true)

		expect(() =>
			validateBrowserHAR({
				...har,
				log: {
					...har.log,
					entries: [
						{
							...har.log.entries[0],
							timings: { ...har.log.entries[0]?.timings, wait: Number.NaN },
						},
					],
				},
			}),
		).toThrow('Browser HAR timing is malformed')
		expect(() =>
			validateBrowserHAR({
				...har,
				log: {
					...har.log,
					entries: [
						{
							...har.log.entries[0],
							response: {
								...har.log.entries[0]?.response,
								content: {
									...har.log.entries[0]?.response.content,
									text: 'not base64',
								},
							},
						},
					],
				},
			}),
		).toThrow('Browser HAR response content is malformed')
	})

	it('preserves hostile header names as own replay values without prototype mutation', () => {
		const headers = browserHARHeadersToRecord([
			{ name: '__proto__', value: 'safe' },
			{ name: 'constructor', value: 'header' },
		])

		expect(Object.hasOwn(headers, '__proto__')).toBe(true)
		expect(headers['__proto__']).toBe('safe')
		expect(headers['constructor']).toBe('header')
		expect(Object.getPrototypeOf(headers)).toBe(Object.prototype)
	})

	it('rejects malformed replay archives with entry context', () => {
		expect(() =>
			validateBrowserHAR({
				log: {
					version: '1.2',
					creator: { name: 'fixture', version: '1' },
					entries: [{ request: { method: 'GET', url: 'https://example.com' } }],
				},
			}),
		).toThrow('Browser HAR entry is malformed')
	})
})
