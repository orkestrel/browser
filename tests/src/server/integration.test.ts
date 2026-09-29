import { describe, expect, it } from 'vitest'
import { BrowserPage, createCDPClient } from '@src/core'
import { WebSocketCDPTransport } from '@src/server'
import { requireValue, waitForCondition } from '@orkestrel/test'
import { createCDPTestServer } from '../../setupServer.js'

describe('WebMCP over WebSocket', () => {
	it('C9 settles execute from a response and event sent in one socket write', async () => {
		const server = await createCDPTestServer()
		server.advertise([{ name: 'search', description: 'Search', frameId: 'main' }], {
			status: 'Completed',
			output: { found: 'book' },
		})
		const client = createCDPClient({
			transport: new WebSocketCDPTransport({ url: server.endpoint }),
		})
		try {
			await client.connect()
			const page = new BrowserPage(client, 'target', 'session', undefined, undefined, 'main')
			const registry = page.registry
			expect(await registry.start()).toBe(true)
			await waitForCondition('WebMCP tool advertised', () => registry.tool('search') !== undefined)
			const result = await registry.execute(
				requireValue(registry.tool('search')),
				{ query: 'book' },
				{ timeout: 1000 },
			)
			expect(result).toEqual({
				id: expect.any(String),
				status: 'Completed',
				output: { found: 'book' },
				error: undefined,
			})
			await registry.destroy()
			expect(
				server.received
					.filter((message) => message.method === 'WebMCP.invokeTool')
					.map((message) => message.params),
			).toEqual([{ frameId: 'main', toolName: 'search', input: { query: 'book' } }])
		} finally {
			await client.close()
			await server.close()
		}
	})
})
