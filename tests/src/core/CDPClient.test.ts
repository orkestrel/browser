import { describe, it, expect, beforeEach } from 'vitest'
import { createCDPClient } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import {
	isCDPError,
	CDPError,
	isCDPConnectionError,
	isCDPTimeoutError,
	CDPConnectionError,
	CDPTimeoutError,
} from '@src/core'
import { createRecorder, waitForDelay } from '@orkestrel/test'
import { createCDPTransport, replyOk } from '../../setup.js'
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

		it('rejects with a CDPError carrying method/code/message/data on a CDP error response', async () => {
			await client.connect()
			transport.onSend('Bad.method', (message) => {
				transport.emitter.emit(
					'message',
					JSON.stringify({
						id: message.id,
						error: { code: -32000, message: 'boom', data: 'extra' },
					}),
				)
			})

			const thrown: unknown = await client.send('Bad.method').catch((caught: unknown) => caught)
			expect(isCDPError(thrown)).toBe(true)
			expect(thrown instanceof CDPError ? thrown.context?.['method'] : undefined).toBe('Bad.method')
			expect(thrown instanceof CDPError ? thrown.context?.['code'] : undefined).toBe(-32000)
			expect(thrown instanceof CDPError ? thrown.context?.['message'] : undefined).toBe('boom')
			expect(thrown instanceof CDPError ? thrown.context?.['data'] : undefined).toBe('extra')
		})

		it('rejects immediately without leaking a pending timer when params are not serializable', async () => {
			const timedClient = createCDPClient({ transport, timeout: 20 })
			await timedClient.connect()
			const circular: Record<string, unknown> = {}
			circular['self'] = circular

			const sent = timedClient.send('Bad.method', circular)
			sent.catch(() => undefined)

			// Wait past the timeout window — if a pending entry leaked, a late
			// timeout rejection would replace the serialization failure.
			await waitForDelay(50)
			await expect(sent).rejects.toThrow('Converting circular structure to JSON')
			// Serialization failed before the frame reached the transport.
			expect(transport.sent).toHaveLength(0)
		})

		it('rejects when not connected', async () => {
			await expect(client.send('Target.getTargets')).rejects.toThrow('not connected')
		})

		it('rejects with a coded CDPConnectionError when not connected', async () => {
			const thrown: unknown = await client
				.send('Target.getTargets')
				.catch((caught: unknown) => caught)
			expect(isCDPConnectionError(thrown)).toBe(true)
			expect(thrown instanceof CDPConnectionError ? thrown.code : undefined).toBe(
				'BROWSER_CDP_CONNECTION_ERROR',
			)
			expect(thrown instanceof CDPConnectionError ? thrown.context?.['method'] : undefined).toBe(
				'Target.getTargets',
			)
		})

		it('times out a pending request', async () => {
			const timedClient = createCDPClient({ transport, timeout: 20 })
			await timedClient.connect()

			await expect(timedClient.send('Never.replies')).rejects.toThrow('timed out')
		})

		it('rejects a timed-out request with a coded CDPTimeoutError carrying method/timeout', async () => {
			const timedClient = createCDPClient({ transport, timeout: 20 })
			await timedClient.connect()

			const thrown: unknown = await timedClient
				.send('Never.replies')
				.catch((caught: unknown) => caught)

			expect(isCDPTimeoutError(thrown)).toBe(true)
			expect(thrown instanceof CDPTimeoutError ? thrown.context?.['method'] : undefined).toBe(
				'Never.replies',
			)
			expect(thrown instanceof CDPTimeoutError ? thrown.context?.['timeout'] : undefined).toBe(20)
		})

		it('uses a per-call timeout that overrides the client-wide default', async () => {
			const longClient = createCDPClient({ transport, timeout: 10_000 })
			await longClient.connect()

			const started = performance.now()
			const thrown: unknown = await longClient
				.send('Never.replies', undefined, undefined, 20)
				.catch((caught: unknown) => caught)
			const elapsed = performance.now() - started

			expect(isCDPTimeoutError(thrown)).toBe(true)
			expect(thrown instanceof CDPTimeoutError ? thrown.context?.['timeout'] : undefined).toBe(20)
			// The 10s client-wide default never bounded this call.
			expect(elapsed).toBeLessThan(1_000)
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

		it('does not fire a handler subscribed re-entrantly during dispatch for the in-flight event', async () => {
			await client.connect()
			const lateRecorder = createRecorder<[Readonly<Record<string, unknown>>]>()

			client.subscribe('Page.loadEventFired', () => {
				client.subscribe('Page.loadEventFired', lateRecorder.handler)
			})

			transport.event('Page.loadEventFired', { timestamp: 1 })
			expect(lateRecorder.count).toBe(0)

			transport.event('Page.loadEventFired', { timestamp: 2 })
			expect(lateRecorder.count).toBe(1)
		})

		it('isolates a throwing handler so sibling handlers still receive the event', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()
			client.subscribe('Page.loadEventFired', () => {
				throw new Error('observer failed')
			})
			client.subscribe('Page.loadEventFired', recorder.handler)

			expect(() => transport.event('Page.loadEventFired', { timestamp: 1 })).not.toThrow()
			expect(recorder.count).toBe(1)
		})
	})

	describe('reconnect()', () => {
		it('closes and re-establishes the transport', async () => {
			await client.connect()
			await client.reconnect()
			expect(client.connected).toBe(true)
			expect(transport.started).toBe(true)
		})

		it('keeps subscriptions registered across close()/reconnect()', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()
			client.subscribe('Page.loadEventFired', recorder.handler)

			await client.reconnect()

			transport.event('Page.loadEventFired', { timestamp: 1 })
			expect(recorder.count).toBe(1)
		})

		it('keeps a session-scoped subscription registered across close()/reconnect()', async () => {
			await client.connect()
			const recorder = createRecorder<[Readonly<Record<string, unknown>>]>()
			client.subscribe('Runtime.bindingCalled', recorder.handler, 'session-a')

			await client.reconnect()

			transport.event('Runtime.bindingCalled', { payload: 'x' }, 'session-a')
			expect(recorder.count).toBe(1)
		})
	})

	describe('message framing', () => {
		it('ignores a response frame with an unknown/expired id without throwing', async () => {
			await client.connect()

			expect(() => transport.reply(9999, { ok: true })).not.toThrow()

			// Client stays functional afterward
			replyOk(transport, 'Target.getTargets', { targetInfos: [] })
			const result = await client.send('Target.getTargets')
			expect(result).toEqual({ targetInfos: [] })
		})

		it('ignores a non-JSON text frame per the framing contract', async () => {
			await client.connect()

			expect(() => transport.emitter.emit('message', 'not json {')).not.toThrow()

			// Client stays functional afterward
			replyOk(transport, 'Target.getTargets', { targetInfos: [] })
			const result = await client.send('Target.getTargets')
			expect(result).toEqual({ targetInfos: [] })
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

		it('rejects pending requests with a coded CDPConnectionError on close', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			await client.close()

			const thrown = await pending
			expect(isCDPConnectionError(thrown)).toBe(true)
			expect(thrown instanceof CDPConnectionError ? thrown.code : undefined).toBe(
				'BROWSER_CDP_CONNECTION_ERROR',
			)
		})

		it('is idempotent when not connected', async () => {
			await expect(client.close()).resolves.toBeUndefined()
		})

		it('marks disconnected when the transport emits close', async () => {
			await client.connect()
			transport.closeRemote()
			expect(client.connected).toBe(false)
		})

		it('rejects pending requests with a coded CDPConnectionError when the transport emits close', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			transport.closeRemote()

			const thrown = await pending
			expect(isCDPConnectionError(thrown)).toBe(true)
		})

		it('rejects pending requests and closes the transport after a transport error', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			transport.errorRemote(new Error('socket failed'))

			const thrown = await pending
			expect(isCDPConnectionError(thrown)).toBe(true)
			expect(client.connected).toBe(false)

			await client.close()
			expect(transport.closed).toBe(true)
		})

		it('closes the transport and rejects the in-flight connect() when close() races connect()', async () => {
			const connecting = client.connect().catch((caught: unknown) => caught)
			const closing = client.close()

			const thrown = await connecting
			await closing

			expect(isCDPConnectionError(thrown)).toBe(true)
			expect(thrown instanceof CDPConnectionError ? thrown.message : undefined).toBe(
				'CDP client was closed while connecting',
			)
			expect(client.connected).toBe(false)
			expect(transport.closed).toBe(true)
		})
	})
})
