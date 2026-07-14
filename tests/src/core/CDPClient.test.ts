import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCDPClient } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import { createCDPTransport, createRecorder, replyOk } from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

// === CDPClient

describe('CDPClient', () => {
	let transport: CDPTestTransportInterface
	let client: CDPClientInterface

	beforeEach(() => {
		transport = createCDPTransport()
		client = createCDPClient({ transport })
	})

	describe('connect()', () => {
		it('starts the transport and marks connected', async () => {
			expect(client.connected).toBe(false)
			await client.connect()
			expect(client.connected).toBe(true)
			expect(transport.started).toBe(true)
		})

		it('is idempotent when already connected', async () => {
			await client.connect()
			await client.connect()
			expect(client.connected).toBe(true)
		})
	})

	describe('send()', () => {
		it('resolves with the scripted result', async () => {
			await client.connect()
			replyOk(transport, 'Target.getTargets', { targetInfos: [] })

			const result = await client.send('Target.getTargets')
			expect(result).toEqual({ targetInfos: [] })
			expect(transport.sent).toHaveLength(1)
			expect(transport.sent[0]?.method).toBe('Target.getTargets')
		})

		it('sends params and sessionId on the frame', async () => {
			await client.connect()
			replyOk(transport, 'Page.navigate', { frameId: 'f1' })

			await client.send('Page.navigate', { url: 'about:blank' }, 'session-1')

			expect(transport.sent[0]?.params).toEqual({ url: 'about:blank' })
			expect(transport.sent[0]?.sessionId).toBe('session-1')
		})

		it('assigns increasing ids across calls', async () => {
			await client.connect()
			replyOk(transport, 'A')
			replyOk(transport, 'B')

			await client.send('A')
			await client.send('B')

			expect(transport.sent[0]?.id).toBe(1)
			expect(transport.sent[1]?.id).toBe(2)
		})

		it('rejects when the response carries an error', async () => {
			await client.connect()
			transport.onSend('Bad.method', (message) => transport.fail(message.id, 'boom'))

			await expect(client.send('Bad.method')).rejects.toThrow('boom')
		})

		it('rejects when not connected', async () => {
			await expect(client.send('Target.getTargets')).rejects.toThrow('not connected')
		})

		it('times out a pending request', async () => {
			vi.useFakeTimers()
			try {
				const timedClient = createCDPClient({ transport, timeout: 20 })
				await timedClient.connect()

				const pending = timedClient.send('Never.replies')
				await Promise.all([
					expect(pending).rejects.toThrow('timed out'),
					vi.advanceTimersByTimeAsync(25),
				])
			} finally {
				vi.useRealTimers()
			}
		})
	})

	describe('subscribe() / unsubscribe()', () => {
		it('fires a global handler for a matching event', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('Page.loadEventFired', recorder.handler)
			transport.event('Page.loadEventFired', { timestamp: 1 })

			expect(recorder.count).toBe(1)
			expect(recorder.calls[0]?.[0]).toEqual({ timestamp: 1 })
		})

		it('stops firing after unsubscribe', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('Page.loadEventFired', recorder.handler)
			client.unsubscribe('Page.loadEventFired', recorder.handler)
			transport.event('Page.loadEventFired', {})

			expect(recorder.count).toBe(0)
		})

		it('routes session-scoped events only to matching-session subscribers', async () => {
			await client.connect()
			const sessionRecorder = createRecorder<[Readonly<Record<string, unknown>>]>()
			const otherRecorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('Runtime.bindingCalled', sessionRecorder.handler, 'session-a')
			client.subscribe('Runtime.bindingCalled', otherRecorder.handler, 'session-b')

			transport.event('Runtime.bindingCalled', { payload: 'x' }, 'session-a')

			expect(sessionRecorder.count).toBe(1)
			expect(otherRecorder.count).toBe(0)
		})

		it('still fires global handlers for session-scoped events', async () => {
			await client.connect()
			const globalRecorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('Runtime.bindingCalled', globalRecorder.handler)
			transport.event('Runtime.bindingCalled', { payload: 'y' }, 'session-a')

			expect(globalRecorder.count).toBe(1)
		})

		it('unsubscribes a session-scoped handler independently', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('X.event', recorder.handler, 'session-a')
			client.unsubscribe('X.event', recorder.handler, 'session-a')
			transport.event('X.event', {}, 'session-a')

			expect(recorder.count).toBe(0)
		})
	})

	describe('reconnect()', () => {
		it('closes and re-establishes the transport', async () => {
			await client.connect()
			await client.reconnect()
			expect(client.connected).toBe(true)
			expect(transport.started).toBe(true)
		})
	})

	describe('close()', () => {
		it('rejects all pending requests', async () => {
			await client.connect()
			const pending = client.send('Never.replies')

			await client.close()

			await expect(pending).rejects.toThrow('closed')
			expect(client.connected).toBe(false)
		})

		it('is idempotent when not connected', async () => {
			await expect(client.close()).resolves.toBeUndefined()
		})

		it('marks disconnected when the transport emits close', async () => {
			await client.connect()
			transport.closeRemote()
			expect(client.connected).toBe(false)
		})
	})
})

afterEach(() => {
	vi.useRealTimers()
})
