/**
 * src/core/BrowserWorker.ts tests.
 *
 * `BrowserWorker` is interned rather than barrelled, so it is imported by path. Each case
 * drives the real class over a connected in-memory CDP client and asserts on the frames
 * it dispatched on its own flattened session.
 */

import { describe, expect, it } from 'vitest'
import { BrowserWorker } from '../../../src/core/BrowserWorker.js'
import {
	createCDPTransport,
	createConnectedCDPClient,
	readCDPParams,
	replyOk,
} from '../../setup.js'
import { createCDPClient } from '@src/core'

describe('BrowserWorker', () => {
	it('reports the identity and category it was constructed with', async () => {
		const { client } = await createConnectedCDPClient()
		const worker = new BrowserWorker(
			client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'service_worker',
		)

		expect([worker.id, worker.url, worker.category]).toStrictEqual([
			'worker-1',
			'https://example.com/w.js',
			'service_worker',
		])
	})

	it('evaluates a guarded expression on its own session and unwraps the result', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 21 } })
		const worker = new BrowserWorker(
			client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'worker',
		)

		await expect(worker.evaluate('1 + 20')).resolves.toBe(21)

		const frame = transport.sent.find((message) => message.method === 'Runtime.evaluate')
		expect(frame?.sessionId).toBe('session-worker')
		expect(frame?.params?.['returnByValue']).toBe(true)
		expect(frame?.params?.['awaitPromise']).toBe(true)
		expect(String(frame?.params?.['expression'])).toContain('1 + 20')
	})

	it('forwards an arbitrary method on its own session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.enable', { ok: true })
		const worker = new BrowserWorker(
			client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'shared_worker',
		)

		await expect(worker.send('Runtime.enable', { flag: 1 })).resolves.toStrictEqual({ ok: true })
		expect(readCDPParams(transport, 'Runtime.enable')).toStrictEqual([{ flag: 1 }])
	})

	it('closes the worker target once and swallows a failing close', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Target.closeTarget', (message) => transport.fail(message.id, 'already gone'))
		const worker = new BrowserWorker(
			client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'worker',
		)

		await expect(worker.close()).resolves.toBeUndefined()
		await expect(worker.close()).resolves.toBeUndefined()

		expect(readCDPParams(transport, 'Target.closeTarget')).toStrictEqual([{ targetId: 'worker-1' }])
	})

	it('refuses every call after a detach and after a close', async () => {
		const detached = await createConnectedCDPClient()
		const detachedWorker = new BrowserWorker(
			detached.client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'worker',
		)
		detachedWorker.detach()

		const closed = await createConnectedCDPClient()
		replyOk(closed.transport, 'Target.closeTarget')
		const closedWorker = new BrowserWorker(
			closed.client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'worker',
		)
		await closedWorker.close()

		await expect(detachedWorker.evaluate('1')).rejects.toThrow('Browser worker is closed')
		await expect(closedWorker.send('Runtime.enable')).rejects.toThrow('Browser worker is closed')
	})

	it('refuses every call while its client is disconnected', async () => {
		const transport = createCDPTransport()
		const client = createCDPClient({ transport })
		const worker = new BrowserWorker(
			client,
			'session-worker',
			'worker-1',
			'https://example.com/w.js',
			'worker',
		)

		await expect(worker.evaluate('1')).rejects.toThrow('Browser worker is disconnected')
		await expect(worker.send('Runtime.enable')).rejects.toThrow('Browser worker is disconnected')
	})
})
