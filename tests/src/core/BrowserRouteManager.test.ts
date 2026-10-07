import { describe, it, expect } from 'vitest'
import { BrowserPage } from '../../../src/core/BrowserPage.js'
import { createConnectedCDPClient, replyOk, ignoreAsyncCall } from '../../setup.js'

describe('BrowserRouteManager', () => {
	it('shares the owner manager and clears every route before disabling interception', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of ['Network.enable', 'Fetch.enable', 'Fetch.disable'])
			replyOk(transport, method)
		const page = new BrowserPage(client, 'target', 'session')
		try {
			const routes = page.network.routes
			expect(page.network.routes).toBe(routes)
			await routes.add({ url: '**/one' }, ignoreAsyncCall)
			await routes.add({ url: '**/two' }, ignoreAsyncCall)
			await routes.clear()
			expect(transport.sent.at(-1)?.method).toBe('Fetch.disable')
			const count = transport.sent.length
			await routes.remove(ignoreAsyncCall)
			await routes.clear()
			expect(transport.sent.length).toBe(count)
		} finally {
			await client.close()
			await page.destroy()
		}
	})
	it('rolls back a route whose Fetch setup fails and accepts a later route', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Fetch.disable')
		let refusing = true
		transport.onSend('Fetch.enable', (message) => {
			if (refusing) transport.fail(message.id, 'Fetch refused')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target', 'session')
		try {
			await expect(
				page.network.routes.add({ url: '**/failed' }, async (route) => await route.abort()),
			).rejects.toThrow('Fetch refused')
			refusing = false
			await page.network.routes.add({ url: '**/ok' }, ignoreAsyncCall)
			await page.network.routes.remove(ignoreAsyncCall)
			expect(transport.sent.at(-1)?.method).toBe('Fetch.disable')
		} finally {
			await client.close()
			await page.destroy()
		}
	})
})
