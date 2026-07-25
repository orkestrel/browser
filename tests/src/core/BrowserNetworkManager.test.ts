import type { BrowserWebSocketFrame, BrowserWebSocketInterface } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import {
	createConnectedCDPClient,
	createRecorder,
	ignoreAsyncCall,
	replyOk,
	waitForCondition,
} from '../../setup.js'

describe('BrowserNetworkManager', () => {
	it('decodes requests, redirects, responses, failures, and completion events', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		await page.network.start()
		const requests = createRecorder<Parameters<(request: unknown) => void>>()
		const responses = createRecorder<Parameters<(response: unknown) => void>>()
		const failures = createRecorder<Parameters<(failure: unknown) => void>>()
		const finished = createRecorder<[id: string]>()
		page.network.emitter.on('request', requests.handler)
		page.network.emitter.on('response', responses.handler)
		page.network.emitter.on('failure', failures.handler)
		page.network.emitter.on('finish', finished.handler)

		transport.event(
			'Network.requestWillBeSent',
			{
				requestId: 'request-1',
				loaderId: 'loader-1',
				frameId: 'frame-1',
				type: 'Document',
				timestamp: 10,
				wallTime: 20,
				request: {
					url: 'https://example.com/',
					method: 'POST',
					headers: { Accept: 'text/html' },
					postData: 'body',
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
				timestamp: 11,
				response: {
					url: 'https://example.com/',
					status: 201,
					statusText: 'Created',
					headers: { 'content-type': 'text/html' },
					mimeType: 'text/html',
					protocol: 'h2',
					remoteIPAddress: '127.0.0.1',
					remotePort: 443,
					fromDiskCache: false,
					fromServiceWorker: false,
					timing: {
						requestTime: 10,
						proxyStart: -1,
						proxyEnd: -1,
						dnsStart: 0,
						dnsEnd: 1,
						connectStart: 1,
						connectEnd: 3,
						sslStart: 2,
						sslEnd: 3,
						sendStart: 3,
						sendEnd: 4,
						receiveHeadersEnd: 5,
					},
					securityDetails: {
						protocol: 'TLS 1.3',
						issuer: 'Example CA',
						validFrom: 100,
						validTo: 200,
					},
				},
			},
			'session-1',
		)
		transport.event(
			'Network.loadingFailed',
			{
				requestId: 'request-2',
				errorText: 'net::ERR_ABORTED',
				canceled: true,
			},
			'session-1',
		)
		transport.event('Network.loadingFinished', { requestId: 'request-1' }, 'session-1')

		expect(requests.calls[0]?.[0]).toMatchObject({
			id: 'request-1',
			method: 'POST',
			headers: { Accept: 'text/html' },
		})
		expect(responses.calls[0]?.[0]).toMatchObject({
			id: 'request-1',
			status: 201,
			phrase: 'Created',
			address: '127.0.0.1',
			worker: false,
			timing: {
				proxy: undefined,
				dns: { start: 0, end: 1 },
				connect: { start: 1, end: 3 },
				ssl: { start: 2, end: 3 },
				send: { start: 3, end: 4 },
				receive: 5,
			},
			security: {
				protocol: 'TLS 1.3',
				issuer: 'Example CA',
				from: 100,
				to: 200,
			},
		})
		expect(failures.calls[0]?.[0]).toMatchObject({
			id: 'request-2',
			cancelled: true,
		})
		expect(finished.calls).toEqual([['request-1']])
	})

	it('decodes plain, base64, text, and JSON response bodies', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		let body = { body: 'hello', base64Encoded: false }
		transport.onSend('Network.getResponseBody', (message) => transport.reply(message.id, body))
		const page = new BrowserPage(client, 'target-1', 'session-1')

		expect(await page.network.text('one')).toBe('hello')
		body = { body: 'eyJvayI6dHJ1ZX0=', base64Encoded: true }
		expect(await page.network.json('two')).toEqual({ ok: true })
		body = { body: 'not-json', base64Encoded: false }
		await expect(page.network.json('three')).rejects.toSatisfy(isBrowserError)
	})

	it('matches Fetch routes and fulfills them exactly once', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		replyOk(transport, 'Fetch.fulfillRequest')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.route(
			{ url: '**/api', method: 'GET' },
			async (route) =>
				await route.fulfill({
					status: 202,
					headers: { 'content-type': 'application/json' },
					body: '{"ok":true}',
				}),
		)

		transport.event(
			'Fetch.requestPaused',
			{
				requestId: 'fetch-1',
				resourceType: 'XHR',
				request: {
					url: 'https://example.com/api',
					method: 'GET',
					headers: {},
				},
			},
			'session-1',
		)
		await waitForCondition(() =>
			transport.sent.some((message) => message.method === 'Fetch.fulfillRequest'),
		)

		const sent = transport.sent.find((message) => message.method === 'Fetch.fulfillRequest')
		expect(sent?.params).toMatchObject({
			requestId: 'fetch-1',
			responseCode: 202,
			body: 'eyJvayI6dHJ1ZX0=',
		})
	})

	it('aborts an intercepted request when fulfillment fails without leaving the route handled', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		transport.onSend('Fetch.fulfillRequest', (message) => {
			transport.fail(message.id, 'fulfillment failed')
		})
		replyOk(transport, 'Fetch.failRequest')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.route(
			{ url: '**/api' },
			async (route) => await route.fulfill({ body: 'unavailable' }),
		)

		transport.event(
			'Fetch.requestPaused',
			{
				requestId: 'fetch-failure',
				request: { url: 'https://example.com/api', method: 'GET', headers: {} },
			},
			'session-1',
		)
		await waitForCondition(() =>
			transport.sent.some((message) => message.method === 'Fetch.failRequest'),
		)

		expect(
			transport.sent.find((message) => message.method === 'Fetch.failRequest')?.params,
		).toEqual({
			requestId: 'fetch-failure',
			errorReason: 'Failed',
		})
	})

	it('fails malformed paused requests with an id so Chromium is never left waiting', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		replyOk(transport, 'Fetch.failRequest')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.route({}, async () => undefined)

		transport.event(
			'Fetch.requestPaused',
			{ requestId: 'fetch-malformed', request: { url: 42 } },
			'session-1',
		)
		await waitForCondition(() =>
			transport.sent.some((message) => message.method === 'Fetch.failRequest'),
		)

		expect(
			transport.sent.find((message) => message.method === 'Fetch.failRequest')?.params,
		).toEqual({
			requestId: 'fetch-malformed',
			errorReason: 'Failed',
		})
	})

	it('continues an unmatched paused request and removes Fetch interception when unrouted', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		replyOk(transport, 'Fetch.continueRequest')
		replyOk(transport, 'Fetch.disable')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const handler = ignoreAsyncCall
		await page.network.route({ url: '**/match' }, handler)

		transport.event(
			'Fetch.requestPaused',
			{
				requestId: 'fetch-2',
				request: { url: 'https://example.com/other', method: 'GET', headers: {} },
			},
			'session-1',
		)
		await waitForCondition(() =>
			transport.sent.some((message) => message.method === 'Fetch.continueRequest'),
		)
		await page.network.unroute(handler)

		expect(transport.sent.some((message) => message.method === 'Fetch.disable')).toBe(true)
	})

	it('answers Fetch authentication challenges with configured credentials', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.enable')
		replyOk(transport, 'Fetch.continueWithAuth')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.credentials({ username: 'user', password: 'secret' })

		transport.event('Fetch.authRequired', { requestId: 'auth-1' }, 'session-1')
		await waitForCondition(() =>
			transport.sent.some((message) => message.method === 'Fetch.continueWithAuth'),
		)

		expect(
			transport.sent.find((message) => message.method === 'Fetch.continueWithAuth')?.params,
		).toEqual({
			requestId: 'auth-1',
			authChallengeResponse: {
				response: 'ProvideCredentials',
				username: 'user',
				password: 'secret',
			},
		})
	})

	it('promotes WebSocket frames, errors, and close into a typed socket entity', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.start()
		const sockets = createRecorder<[socket: BrowserWebSocketInterface]>()
		page.network.emitter.on('socket', sockets.handler)
		transport.event(
			'Network.webSocketCreated',
			{ requestId: 'socket-1', url: 'wss://example.com/socket' },
			'session-1',
		)
		const socket = sockets.calls[0]?.[0]
		expect(socket?.url).toBe('wss://example.com/socket')
		const received = createRecorder<[frame: BrowserWebSocketFrame]>()
		const closed = createRecorder<[timestamp: number]>()
		socket?.emitter.on('receive', received.handler)
		socket?.emitter.on('close', closed.handler)

		transport.event(
			'Network.webSocketFrameReceived',
			{
				requestId: 'socket-1',
				timestamp: 5,
				response: { opcode: 1, payloadData: 'hello', mask: false },
			},
			'session-1',
		)
		transport.event('Network.webSocketClosed', { requestId: 'socket-1', timestamp: 6 }, 'session-1')

		expect(received.calls[0]?.[0]).toEqual({
			opcode: 1,
			data: 'hello',
			masked: false,
			timestamp: 5,
		})
		expect(closed.calls).toEqual([[6]])
	})

	it('destroys listeners and socket emitters even when protocol disable fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		transport.onSend('Network.disable', (message) => {
			transport.fail(message.id, 'disable failed')
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.network.start()
		const sockets = createRecorder<[socket: BrowserWebSocketInterface]>()
		page.network.emitter.on('socket', sockets.handler)
		transport.event(
			'Network.webSocketCreated',
			{ requestId: 'socket-1', url: 'wss://example.com/socket' },
			'session-1',
		)
		const socket = sockets.calls[0]?.[0]

		await expect(page.network.destroy()).rejects.toThrow('disable failed')

		expect(page.network.emitter.destroyed).toBe(true)
		expect(socket?.emitter.destroyed).toBe(true)
	})
})
