import { describe, it, expect, beforeEach } from 'vitest'
import { createCDPClient, isBrowserError } from '@src/core'
import type { CDPClientInterface } from '@src/core'

import { getEventListeners } from 'node:events'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createCDPTestTransport, replyOk } from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

// === CDPClient

describe('CDPClient', () => {
	let transport: CDPTestTransportInterface
	let client: CDPClientInterface

	beforeEach(() => {
		transport = createCDPTestTransport()
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
		it('rejects only the detached session pending commands and preserves other sessions and root', async () => {
			await client.connect()
			const controller = new AbortController()
			const detached = createRecorder<[unknown]>()
			const other = createRecorder<[unknown]>()
			const root = createRecorder<[unknown]>()
			const pending = client
				.send('WebMCP.disable', undefined, { session: 'session-1', signal: controller.signal })
				.catch(detached.handler)
			const surviving = client
				.send('Runtime.evaluate', { expression: '1' }, { session: 'session-2' })
				.then(other.handler, other.handler)
			const browser = client.send('Browser.getVersion').then(root.handler, root.handler)
			try {
				expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
				transport.event('Target.detachedFromTarget', { sessionId: 'session-1' })
				await waitForCondition('detached session command rejects', () => detached.count === 1, {
					budget: 1000,
				})
				await pending
				expect(detached.calls[0]?.[0]).toMatchObject({ name: 'BrowserError', code: 'DISCONNECTED' })
				expect(detached.calls[0]?.[0]).toMatchObject({
					code: 'DISCONNECTED',
					context: { method: 'WebMCP.disable', session: 'session-1' },
				})
				expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
				expect(client.connected).toBe(true)
				expect(other.calls).toEqual([])
				expect(root.calls).toEqual([])
				transport.reply(transport.sent[0]?.id ?? 0, { late: true })
				transport.reply(transport.sent[1]?.id ?? 0, { result: 1 })
				transport.reply(transport.sent[2]?.id ?? 0, { product: 'fixture' })
				await Promise.all([surviving, browser])
				expect(other.calls).toEqual([[{ result: 1 }]])
				expect(root.calls).toEqual([[{ product: 'fixture' }]])
				expect(detached.count).toBe(1)
			} finally {
				await client.close()
				await Promise.all([pending, surviving, browser])
			}
		})

		it('rejects a child session command when its detach arrives on the parent session', async () => {
			await client.connect()
			const detached = createRecorder<[unknown]>()
			const parent = createRecorder<[unknown]>()
			const child = client
				.send('WebMCP.disable', undefined, { session: 'child' })
				.catch(detached.handler)
			const surviving = client
				.send('Runtime.evaluate', { expression: '1' }, { session: 'parent' })
				.then(parent.handler, parent.handler)
			try {
				transport.event('Target.detachedFromTarget', { sessionId: 'child' }, 'parent')
				await waitForCondition(
					'child command rejects after parent reports detach',
					() => detached.count === 1,
					{ budget: 1000 },
				)
				await child
				expect(detached.calls[0]?.[0]).toMatchObject({ name: 'BrowserError', code: 'DISCONNECTED' })
				expect(detached.calls[0]?.[0]).toMatchObject({
					context: { method: 'WebMCP.disable', session: 'child' },
				})
				expect(client.connected).toBe(true)
				expect(parent.calls).toEqual([])
				transport.reply(transport.sent[1]?.id ?? 0, { result: 1 })
				await surviving
				expect(parent.calls).toEqual([[{ result: 1 }]])
			} finally {
				await client.close()
				await Promise.all([child, surviving])
			}
		})

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

			await client.send('Page.navigate', { url: 'about:blank' }, { session: 'session-1' })

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

		it('rejects with a BrowserError carrying method/code/message/data on a CDP error response', async () => {
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
			expect(isBrowserError(thrown) && thrown.code === 'REMOTE').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'REMOTE' ? thrown.context?.['method'] : undefined,
			).toBe('Bad.method')
			expect(
				isBrowserError(thrown) && thrown.code === 'REMOTE' ? thrown.context?.['code'] : undefined,
			).toBe(-32000)
			expect(
				isBrowserError(thrown) && thrown.code === 'REMOTE'
					? thrown.context?.['message']
					: undefined,
			).toBe('boom')
			expect(
				isBrowserError(thrown) && thrown.code === 'REMOTE' ? thrown.context?.['data'] : undefined,
			).toBe('extra')
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

		it('rejects with a coded BrowserError when not connected', async () => {
			const thrown: unknown = await client
				.send('Target.getTargets')
				.catch((caught: unknown) => caught)
			expect(isBrowserError(thrown) && thrown.code === 'DISCONNECTED').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'DISCONNECTED' ? thrown.code : undefined,
			).toBe('DISCONNECTED')
			expect(
				isBrowserError(thrown) && thrown.code === 'DISCONNECTED'
					? thrown.context?.['method']
					: undefined,
			).toBe('Target.getTargets')
		})

		it('times out a pending request', async () => {
			const timedClient = createCDPClient({ transport, timeout: 20 })
			await timedClient.connect()

			await expect(timedClient.send('Never.replies')).rejects.toThrow('timed out')
		})

		it('rejects a timed-out request with a coded BrowserError carrying method/timeout', async () => {
			const timedClient = createCDPClient({ transport, timeout: 20 })
			await timedClient.connect()

			const thrown: unknown = await timedClient
				.send('Never.replies')
				.catch((caught: unknown) => caught)

			expect(isBrowserError(thrown) && thrown.code === 'TIMEOUT').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'TIMEOUT'
					? thrown.context?.['method']
					: undefined,
			).toBe('Never.replies')
			expect(
				isBrowserError(thrown) && thrown.code === 'TIMEOUT'
					? thrown.context?.['timeout']
					: undefined,
			).toBe(20)
		})

		it('uses a per-call timeout that overrides the client-wide default', async () => {
			const longClient = createCDPClient({ transport, timeout: 10_000 })
			await longClient.connect()

			const started = performance.now()
			const thrown: unknown = await longClient
				.send('Never.replies', undefined, { timeout: 20 })
				.catch((caught: unknown) => caught)
			const elapsed = performance.now() - started

			expect(isBrowserError(thrown) && thrown.code === 'TIMEOUT').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'TIMEOUT'
					? thrown.context?.['timeout']
					: undefined,
			).toBe(20)
			// The 10s client-wide default never bounded this call.
			expect(elapsed).toBeLessThan(1_000)
		})
	})

	describe('send() with a signal', () => {
		it('rejects with the signal reason before sending when already aborted', async () => {
			await client.connect()
			const reason = new Error('cancelled early')
			const controller = new AbortController()
			controller.abort(reason)

			await expect(
				client.send('Never.sent', undefined, { signal: controller.signal }),
			).rejects.toBe(reason)
			expect(transport.sent).toEqual([])
		})

		it('rejects with the reason on a later abort, clears the timer, and ignores a late reply', async () => {
			const { createHook } = await import('node:async_hooks')
			await client.connect()
			const reason = new Error('cancelled late')
			const controller = new AbortController()
			const timers = new Set<number>()
			const fired = createRecorder<[number]>()
			const destroyed = createRecorder<[number]>()
			const errors = createRecorder<[unknown]>()
			let recording = true
			// Record only timers created by this synchronous send, excluding unrelated host timers.
			const hook = createHook({
				init(id, category) {
					if (recording && category === 'Timeout') timers.add(id)
				},
				before(id) {
					if (timers.has(id)) fired.handler(id)
				},
				destroy(id) {
					if (timers.has(id)) destroyed.handler(id)
				},
			})
			client.emitter.on('error', errors.handler)
			hook.enable()
			try {
				const sent = client.send('Slow.call', undefined, {
					signal: controller.signal,
					timeout: 20,
				})
				recording = false
				const caught = sent.catch((thrown: unknown) => thrown)
				const id = transport.sent[0]?.id
				expect(id).toBeDefined()
				expect(timers.size).toBe(1)
				controller.abort(reason)
				expect(await caught).toBe(reason)

				// A leaked timer can fire silently after settlement; its callback must never run.
				await waitForDelay(50)
				expect(fired.calls).toEqual([])
				expect(destroyed.calls).toEqual([...timers].map((timer) => [timer]))
				await expect(sent).rejects.toBe(reason)
				transport.reply(id ?? 0, { late: true })
				await expect(sent).rejects.toBe(reason)
				expect(await caught).not.toMatchObject({ code: 'TIMEOUT' })
				expect(errors.calls).toEqual([])
			} finally {
				hook.disable()
				client.emitter.off('error', errors.handler)
				await client.close()
			}
		})

		it('releases the abort listener when the request settles by reply, so a reused signal holds none', async () => {
			await client.connect()
			const controller = new AbortController()
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
			const first = client.send('First.call', undefined, { signal: controller.signal })
			await waitForDelay(0)
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
			transport.reply(transport.sent[0]?.id ?? 0, { ok: true })
			await first
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
			// control: a second call on the same signal adds exactly one listener again, and the
			// abort after it settles rejects nothing
			const second = client.send('Second.call', undefined, { signal: controller.signal })
			await waitForDelay(0)
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
			transport.reply(transport.sent[1]?.id ?? 0, { ok: true })
			await expect(second).resolves.toEqual({ ok: true })
			controller.abort(new Error('after settle'))
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
		})
	})

	describe('test transport fail()', () => {
		it('writes a numeric code into the BrowserError context', async () => {
			await client.connect()
			const pending = client.send('Missing.method').catch((thrown: unknown) => thrown)
			await waitForDelay(0)
			transport.fail(transport.sent[0]?.id ?? 0, 'not found', -32601)

			const thrown = await pending
			expect(isBrowserError(thrown) && thrown.code === 'REMOTE').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'REMOTE' ? thrown.context?.['code'] : undefined,
			).toBe(-32601)
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

		it('rejects pending requests with a coded BrowserError on close', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			await client.close()

			const thrown = await pending
			expect(isBrowserError(thrown) && thrown.code === 'DISCONNECTED').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'DISCONNECTED' ? thrown.code : undefined,
			).toBe('DISCONNECTED')
		})

		it('is idempotent when not connected', async () => {
			await expect(client.close()).resolves.toBeUndefined()
		})

		it('marks disconnected when the transport emits close', async () => {
			await client.connect()
			transport.closeRemote()
			expect(client.connected).toBe(false)
		})

		it('rejects pending requests with a coded BrowserError when the transport emits close', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			transport.closeRemote()

			const thrown = await pending
			expect(isBrowserError(thrown) && thrown.code === 'DISCONNECTED').toBe(true)
		})

		it('rejects pending requests and closes the transport after a transport error', async () => {
			await client.connect()
			const pending = client.send('Never.replies').catch((caught: unknown) => caught)

			transport.errorRemote(new Error('socket failed'))

			const thrown = await pending
			expect(isBrowserError(thrown) && thrown.code === 'DISCONNECTED').toBe(true)
			expect(client.connected).toBe(false)

			await client.close()
			expect(transport.closed).toBe(true)
		})

		it('closes the transport and rejects the in-flight connect() when close() races connect()', async () => {
			const close = createRecorder<[]>()
			const drop = createRecorder<[]>()
			client.emitter.on('close', close.handler)
			client.emitter.on('drop', drop.handler)

			const connecting = client.connect().catch((caught: unknown) => caught)
			const closing = client.close()

			const thrown = await connecting
			await closing

			expect(isBrowserError(thrown) && thrown.code === 'DISCONNECTED').toBe(true)
			expect(
				isBrowserError(thrown) && thrown.code === 'DISCONNECTED' ? thrown.message : undefined,
			).toBe('CDP client was closed while connecting')
			expect(client.connected).toBe(false)
			expect(transport.closed).toBe(true)
			expect(close.count).toBe(1)
			expect(drop.count).toBe(0)
		})
	})

	describe('emitter', () => {
		it('reports connect and close, and never drop, around an explicit teardown', async () => {
			const connect = createRecorder<[]>()
			const close = createRecorder<[]>()
			const drop = createRecorder<[]>()
			client.emitter.on('connect', connect.handler)
			client.emitter.on('close', close.handler)
			client.emitter.on('drop', drop.handler)

			await client.connect()
			expect(connect.count).toBe(1)
			expect(close.count).toBe(0)

			await client.close()
			expect(close.count).toBe(1)
			expect(drop.count).toBe(0)
		})

		it('reports drop when the transport ends without a close request', async () => {
			const drop = createRecorder<[]>()
			const close = createRecorder<[]>()
			client.emitter.on('drop', drop.handler)
			client.emitter.on('close', close.handler)
			await client.connect()

			transport.closeRemote()

			expect(drop.count).toBe(1)
			expect(close.count).toBe(0)
		})

		it('reports the transport fault and gives pending requests JSON context', async () => {
			const errors = createRecorder<[error: unknown]>()
			client.emitter.on('error', errors.handler)
			await client.connect()
			const fault = new Error('socket failed')
			const pending = client.send('Pending.method').catch((error: unknown) => error)
			await waitForCondition('the request was sent', () =>
				transport.sent.some((message) => message.method === 'Pending.method'),
			)

			transport.errorRemote(fault)

			expect(errors.calls).toEqual([[fault]])
			expect(await pending).toMatchObject({
				name: 'BrowserError',
				code: 'DISCONNECTED',
				context: { method: 'Pending.method', error: 'Error: socket failed' },
			})
		})

		it('wires the listeners supplied at construction', async () => {
			const connect = createRecorder<[]>()
			const wired = createCDPClient({ transport, on: { connect: connect.handler } })

			await wired.connect()

			expect(connect.count).toBe(1)
		})
	})
})
