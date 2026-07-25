import { describe, expect, it } from 'vitest'
import { BrowserHandle, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk } from '../../setup.js'

describe('BrowserHandle', () => {
	it('calls functions by value against the retained object', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.callFunctionOn', { result: { value: 42 } })
		const handle = new BrowserHandle(client, 'session-1', 'object-1')

		expect(await handle.call('function(value) { return this.count + value }', [2])).toBe(42)
		expect(transport.sent[0]?.params).toEqual({
			objectId: 'object-1',
			functionDeclaration: 'function(value) { return this.count + value }',
			arguments: [{ value: 2 }],
			awaitPromise: true,
			returnByValue: true,
		})
	})

	it('creates a child handle only when Chromium returns an object id', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let object = true
		transport.onSend('Runtime.callFunctionOn', (message) => {
			transport.reply(message.id, {
				result: object ? { objectId: 'object-2' } : { value: 1 },
			})
		})
		const handle = new BrowserHandle(client, 'session-1', 'object-1')

		expect((await handle.property('child'))?.id).toBe('object-2')
		object = false
		expect(await handle.property('primitive')).toBeUndefined()
	})

	it('disposes idempotently and rejects later operations', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.releaseObject')
		const handle = new BrowserHandle(client, 'session-1', 'object-1')

		await handle.dispose()
		await handle.dispose()

		expect(
			transport.sent.filter((message) => message.method === 'Runtime.releaseObject'),
		).toHaveLength(1)
		await expect(handle.value()).rejects.toSatisfy(isBrowserError)
	})
})
