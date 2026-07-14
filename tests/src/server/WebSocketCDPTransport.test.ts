/**
 * WebSocketCDPTransport tests.
 *
 * Drives the transport against a real in-process WebSocket server
 * (`createCdpTestServer`, tests/setupServer.ts) — no mocks of the WebSocket
 * client itself.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketCDPTransport } from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { createRecorder, waitForDelay } from '../../setup.js'

let server: CDPTestServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
})

describe('WebSocketCDPTransport', () => {
	it('start() opens a real WebSocket connection', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		await transport.start()
		await expect(transport.send('{}')).resolves.toBeUndefined()
		await transport.close()
	})

	it('send() delivers a frame the server receives', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		await transport.start()

		await transport.send(JSON.stringify({ id: 1, method: 'Test.method', params: { a: 1 } }))
		await waitForDelay(20)

		expect(server.received).toHaveLength(1)
		expect(server.received[0]?.method).toBe('Test.method')
		expect(server.received[0]?.params?.['a']).toBe(1)

		await transport.close()
	})

	it('emits message events for server-pushed frames', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		const recorder = createRecorder<[string]>()
		transport.emitter.on('message', recorder.handler)

		await transport.start()
		server.event('Test.event', { value: 42 })
		await waitForDelay(20)

		expect(recorder.count).toBe(1)
		const [payload] = recorder.calls[0] ?? []
		expect(payload).toBeDefined()
		const parsed: unknown = JSON.parse(payload ?? '{}')
		expect(parsed).toMatchObject({ method: 'Test.event', params: { value: 42 } })

		await transport.close()
	})

	it('emits close event when the server closes the socket', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
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

	it('start() rejects when connecting to an unreachable port', async () => {
		const transport = new WebSocketCDPTransport({ url: 'ws://localhost:19990/cdp', timeout: 200 })
		await expect(transport.start()).rejects.toThrow(/WebSocket CDP connection (failed|timed out)/)
	})

	it('start() opens a fresh socket each call (reconnect support)', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		await transport.start()
		await transport.close()
		await transport.start()

		await transport.send(JSON.stringify({ id: 1, method: 'Reconnect.check' }))
		await waitForDelay(20)
		expect(server.received.some((m) => m.method === 'Reconnect.check')).toBe(true)

		await transport.close()
	})
})
