/**
 * src/core/factories.ts tests.
 *
 * `createCDPClient` is checked for shape and real wiring to the fake
 * transport from `tests/setup.ts` — the exhaustive request/response
 * behavior of the client itself is covered by `CDPClient.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { createCDPClient } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import { createCDPTransport, replyOk } from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

describe('createCDPClient', () => {
	it('returns a CDPClientInterface shape', () => {
		const transport = createCDPTransport()
		const client = createCDPClient({ transport })

		expect(client.connected).toBe(false)
		expect(typeof client.connect).toBe('function')
		expect(typeof client.reconnect).toBe('function')
		expect(typeof client.send).toBe('function')
		expect(typeof client.subscribe).toBe('function')
		expect(typeof client.unsubscribe).toBe('function')
		expect(typeof client.close).toBe('function')
	})

	it('connect() starts the provided transport', async () => {
		const transport: CDPTestTransportInterface = createCDPTransport()
		const client: CDPClientInterface = createCDPClient({ transport })

		expect(transport.started).toBe(false)
		await client.connect()
		expect(transport.started).toBe(true)
		expect(client.connected).toBe(true)
	})

	it('send() routes the request through the provided transport', async () => {
		const transport = createCDPTransport()
		const client = createCDPClient({ transport })
		await client.connect()
		replyOk(transport, 'Target.getTargets', { targetInfos: [] })

		const result = await client.send('Target.getTargets')

		expect(result).toEqual({ targetInfos: [] })
		expect(transport.sent).toHaveLength(1)
		expect(transport.sent[0]?.method).toBe('Target.getTargets')
	})

	it('connected reflects the client lifecycle across connect and close', async () => {
		const transport = createCDPTransport()
		const client = createCDPClient({ transport })

		expect(client.connected).toBe(false)
		await client.connect()
		expect(client.connected).toBe(true)
		await client.close()
		expect(client.connected).toBe(false)
	})
})
