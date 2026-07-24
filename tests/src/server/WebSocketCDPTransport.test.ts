/**
 * WebSocketCDPTransport tests.
 *
 * Drives the transport against a real in-process WebSocket server
 * (`createCDPTestServer`, tests/setupServer.ts) — no mocks of the underlying
 * `@orkestrel/websocket` client itself.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketCDPTransport, isBrowserConnectionError } from '@src/server'
import { createCDPTestServer, createStallServer } from '../../setupServer.js'
import type { CDPTestServerInterface, StallServerInterface } from '../../setupServer.js'
import { createRecorder, requireValue, waitForCondition } from '../../setup.js'

let server: CDPTestServerInterface | undefined
let stall: StallServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	await stall?.close()
	stall = undefined
})

describe('WebSocketCDPTransport', () => {
	it('start() opens a real WebSocket connection', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		await transport.start()
		await expect(transport.send('{}')).resolves.toBeUndefined()
		await transport.close()
	})

	it('shares concurrent starts and keeps an open start idempotent', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })

		await Promise.all([transport.start(), transport.start()])
		await transport.start()

		expect(server.sockets).toBe(1)
		await transport.close()
	})

	it('send() delivers a frame the server receives (masked client frame decoded correctly)', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		await transport.start()

		await transport.send(JSON.stringify({ id: 1, method: 'Test.method', params: { a: 1 } }))
		await waitForCondition(() => server?.received.length === 1)

		expect(server.received).toHaveLength(1)
		expect(server.received[0]?.method).toBe('Test.method')
		expect(server.received[0]?.params?.['a']).toBe(1)

		await transport.close()
	})

	it('emits message events for server-pushed frames', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		const recorder = createRecorder<[string]>()
		transport.emitter.on('message', recorder.handler)

		await transport.start()
		server.event('Test.event', { value: 42 })
		await waitForCondition(() => recorder.count === 1)

		expect(recorder.count).toBe(1)
		const [payload] = requireValue(recorder.calls[0])
		const parsed: unknown = JSON.parse(payload)
		expect(parsed).toMatchObject({ method: 'Test.event', params: { value: 42 } })

		await transport.close()
	})

	it('emits close event when the server closes the socket', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		const recorder = createRecorder<[]>()
		transport.emitter.on('close', recorder.handler)

		await transport.start()
		await transport.close()

		// transport.close() itself triggers the socket close event
		expect(recorder.count).toBeGreaterThanOrEqual(1)
	})

	it('send() throws when the transport is not started', async () => {
		const transport = new WebSocketCDPTransport({ url: 'ws://localhost:1/cdp' })
		await expect(transport.send('{}')).rejects.toThrow('WebSocket CDP transport is not open')
	})

	it('close() is a no-op when never started', async () => {
		const transport = new WebSocketCDPTransport({ url: 'ws://localhost:1/cdp' })
		await expect(transport.close()).resolves.toBeUndefined()
	})

	it('close() resolves after the remote socket has already closed', async () => {
		server = await createCDPTestServer()
		const active = server
		const transport = new WebSocketCDPTransport({ url: active.endpoint })
		await transport.start()

		await active.close()
		server = undefined
		await waitForCondition(() => active.sockets === 0)

		await expect(transport.close()).resolves.toBeUndefined()
	})

	it('rejects non-WebSocket URL protocols with a coded error', async () => {
		const transport = new WebSocketCDPTransport({ url: 'http://localhost/cdp' })
		const error: unknown = await transport.start().catch((caught: unknown) => caught)

		expect(isBrowserConnectionError(error)).toBe(true)
	})

	it('forwards emitter listener failures to the configured error handler', async () => {
		server = await createCDPTestServer()
		const errors = createRecorder<[unknown, string]>()
		const transport = new WebSocketCDPTransport({
			url: server.endpoint,
			on: {
				message: () => {
					throw new Error('listener failed')
				},
			},
			error: errors.handler,
		})
		await transport.start()

		server.event('Test.event')
		await waitForCondition(() => errors.count === 1)

		expect(errors.calls[0]?.[1]).toBe('message')
		await transport.close()
	})

	it('start() rejects when connecting to an unreachable port', async () => {
		const url = 'ws://localhost:19990/cdp'
		const transport = new WebSocketCDPTransport({ url, timeout: 200 })
		await expect(transport.start()).rejects.toThrow(
			new RegExp(`WebSocket CDP connection to ${url} (failed|timed out)`),
		)

		const error: unknown = await transport.start().catch((caught: unknown) => caught)
		expect(isBrowserConnectionError(error)).toBe(true)
		expect(error).toBeInstanceOf(Error)
		if (!(error instanceof Error)) throw new Error('Expected a connection error')
		expect(error.message).toContain(url)
	})

	it('close() aborts a connection still in flight and settles start() as rejected', async () => {
		stall = await createStallServer()
		const url = stall.endpoint
		const transport = new WebSocketCDPTransport({ url, timeout: 5000 })

		const started = transport.start()
		await transport.close()

		await expect(started).rejects.toSatisfy((error: unknown) => isBrowserConnectionError(error))
		await expect(started).rejects.toThrow(url)

		// no socket survived — send() still reports not-open, and close() stays idempotent
		await expect(transport.send('{}')).rejects.toThrow('WebSocket CDP transport is not open')
		await expect(transport.close()).resolves.toBeUndefined()
	})

	it('start() opens a fresh socket each call (reconnect support)', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		await transport.start()
		await transport.close()
		await transport.start()

		await transport.send(JSON.stringify({ id: 1, method: 'Reconnect.check' }))
		await waitForCondition(
			() => server?.received.some((message) => message.method === 'Reconnect.check') === true,
		)
		expect(server.received.some((m) => m.method === 'Reconnect.check')).toBe(true)

		await transport.close()
	})

	it('round-trips a large (~5 MB) text frame intact', async () => {
		server = await createCDPTestServer()
		const transport = new WebSocketCDPTransport({ url: server.endpoint })
		await transport.start()

		const large = 'x'.repeat(5 * 1024 * 1024)
		await transport.send(JSON.stringify({ id: 1, method: 'Large.frame', params: { large } }))

		// A large frame is reassembled from multiple chunks server-side; poll
		// (bounded) instead of a fixed delay so this never races that
		// reassembly, however long it happens to take.
		await waitForCondition(() => server?.received.length === 1, 3000)

		expect(server.received).toHaveLength(1)
		expect(server.received[0]?.method).toBe('Large.frame')
		expect(server.received[0]?.params?.['large']).toBe(large)

		await transport.close()
	})
})
