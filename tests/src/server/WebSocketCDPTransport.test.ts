import { WebSocketCDPTransport, isBrowserConnectionError } from '@src/server'
import { describe, expect, it } from 'vitest'

describe('WebSocketCDPTransport', () => {
	it('maps malformed debugger URLs to a typed connection error', async () => {
		const transport = new WebSocketCDPTransport({ url: 'not a URL' })

		await expect(transport.start()).rejects.toSatisfy(isBrowserConnectionError)
		await expect(transport.start()).rejects.toSatisfy(isBrowserConnectionError)
	})

	it('rejects non-WebSocket protocols before opening a request', async () => {
		const transport = new WebSocketCDPTransport({
			url: 'https://example.com/devtools/browser',
		})

		await expect(transport.start()).rejects.toSatisfy(isBrowserConnectionError)
		await expect(transport.start()).rejects.toSatisfy(isBrowserConnectionError)
	})
})
