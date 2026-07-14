/**
 * WebSocketCDPTransport tests.
 *
 * Drives the transport against a real in-process WebSocket server
 * (`createCdpTestServer`, tests/setupServer.ts) — no mocks of the underlying
 * `@orkestrel/websocket` client itself.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createNetServer } from 'node:net'
import type { Server as NetServer } from 'node:net'
import { WebSocketCDPTransport, isBrowserConnectionError } from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { createRecorder, waitForDelay } from '../../setup.js'

let server: CDPTestServerInterface | undefined
let stallServer: NetServer | undefined
let stallSockets: Set<import('node:net').Socket> | undefined

/**
 * Start a raw TCP server that accepts connections but never completes the
 * WebSocket upgrade handshake — the client socket stays stuck connecting for
 * as long as the caller holds it open.
 *
 * @returns The `ws://` URL of the stalling server
 */
async function createStallServer(): Promise<string> {
	const sockets = new Set<import('node:net').Socket>()
	const net = createNetServer((socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.on('close', () => sockets.delete(socket))
	})
	stallServer = net
	stallSockets = sockets

	await new Promise<void>((resolve) => net.listen(0, '127.0.0.1', resolve))
	const address = net.address()
	const port = typeof address === 'object' && address !== null ? address.port : 0
	return `ws://127.0.0.1:${port}/cdp`
}

afterEach(async () => {
	await server?.close()
	server = undefined

	if (stallServer !== undefined) {
		const net = stallServer
		const sockets = stallSockets
		stallServer = undefined
		stallSockets = undefined
		if (sockets !== undefined) for (const socket of sockets) socket.destroy()
		await new Promise<void>((resolve) => net.close(() => resolve()))
	}
})

describe('WebSocketCDPTransport', () => {
	it('start() opens a real WebSocket connection', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		await transport.start()
		await expect(transport.send('{}')).resolves.toBeUndefined()
		await transport.close()
	})

	it('send() delivers a frame the server receives (masked client frame decoded correctly)', async () => {
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
		const url = 'ws://localhost:19990/cdp'
		const transport = new WebSocketCDPTransport({ url, timeout: 200 })
		await expect(transport.start()).rejects.toThrow(
			new RegExp(`WebSocket CDP connection to ${url} (failed|timed out)`),
		)

		const error: unknown = await transport.start().catch((caught: unknown) => caught)
		expect(isBrowserConnectionError(error)).toBe(true)
		expect(error).toBeInstanceOf(Error)
		expect(error instanceof Error ? error.message : '').toContain(url)
	})

	it('close() aborts a connection still in flight and settles start() as rejected', async () => {
		const url = await createStallServer()
		const transport = new WebSocketCDPTransport({ url, timeout: 5000 })

		const started = transport.start()
		await waitForDelay(20)
		await transport.close()

		await expect(started).rejects.toSatisfy((error: unknown) => isBrowserConnectionError(error))
		await expect(started).rejects.toThrow(url)

		// no socket survived — send() still reports not-open, and close() stays idempotent
		await expect(transport.send('{}')).rejects.toThrow('WebSocket CDP transport is not open')
		await expect(transport.close()).resolves.toBeUndefined()
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

	it('round-trips a large (~5 MB) text frame intact', async () => {
		server = await createCdpTestServer()
		const transport = new WebSocketCDPTransport({ url: server.wsUrl })
		await transport.start()

		const large = 'x'.repeat(5 * 1024 * 1024)
		await transport.send(JSON.stringify({ id: 1, method: 'Large.frame', params: { large } }))

		// A large frame is reassembled from multiple chunks server-side; poll
		// (bounded) instead of a fixed delay so this never races that
		// reassembly, however long it happens to take.
		const deadline = Date.now() + 3000
		while (server.received.length === 0 && Date.now() < deadline) {
			await waitForDelay(20)
		}

		expect(server.received).toHaveLength(1)
		expect(server.received[0]?.method).toBe('Large.frame')
		expect(server.received[0]?.params?.['large']).toBe(large)

		await transport.close()
	})
})
