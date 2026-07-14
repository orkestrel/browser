import { describe, it, expect } from 'vitest'
import { BrowserContext, createCDPClient } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import { createCDPTransport, createTarget, replyOk } from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

// === Helpers

async function createConnectedClient(): Promise<{
	client: CDPClientInterface
	transport: CDPTestTransportInterface
}> {
	const transport = createCDPTransport()
	const client = createCDPClient({ transport })
	await client.connect()
	return { client, transport }
}

function scriptAttach(transport: CDPTestTransportInterface, sessionId = 'session-1'): void {
	replyOk(transport, 'Target.attachToTarget', { sessionId })
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Runtime.enable')
}

// === BrowserContext

describe('BrowserContext', () => {
	describe('page() / pages()', () => {
		it('returns undefined before any page exists', async () => {
			const { client } = await createConnectedClient()
			const context = new BrowserContext(client)
			expect(context.page()).toBeUndefined()
		})

		it('returns undefined for an out-of-range index', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client)
			await context.create()

			expect(context.page(9999)).toBeUndefined()
			expect(context.page(-1)).toBeUndefined()
		})

		it('returns a fresh copy from pages() each call', async () => {
			const { client } = await createConnectedClient()
			const context = new BrowserContext(client)
			expect(context.pages()).not.toBe(context.pages())
		})
	})

	describe('create()', () => {
		it('creates, attaches, and enables domains for a new page', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client)
			const page = await context.create()

			expect(page.closed).toBe(false)
			expect(context.pages()).toHaveLength(1)
			expect(transport.sent.some((m) => m.method === 'Target.createTarget')).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Target.attachToTarget')).toBe(true)
		})

		it('includes browserContextId when this context has a real id', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client, 'ctx-1')
			await context.create()

			const sent = transport.sent.find((m) => m.method === 'Target.createTarget')
			expect(sent?.params?.['browserContextId']).toBe('ctx-1')
		})

		it('applies the viewport override for the new page', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Emulation.setDeviceMetricsOverride')

			const context = new BrowserContext(client, undefined, { width: 800, height: 600 })
			await context.create()

			const sent = transport.sent.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
			expect(sent?.params).toEqual({ width: 800, height: 600, deviceScaleFactor: 1, mobile: false })
		})

		it('prefers the page-level viewport over the context default', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Emulation.setDeviceMetricsOverride')

			const context = new BrowserContext(client, undefined, { width: 800, height: 600 })
			await context.create({ viewport: { width: 1024, height: 768 } })

			const sent = transport.sent.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
			expect(sent?.params).toEqual({
				width: 1024,
				height: 768,
				deviceScaleFactor: 1,
				mobile: false,
			})
		})

		it('throws when target creation fails to return a targetId', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Target.createTarget', {})

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('Failed to create new browser target')
		})

		it('throws when attaching to the new target fails', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.attachToTarget', {})

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('Failed to attach to browser target')
		})
	})

	describe('sync()', () => {
		it('replaces pages with the given page-type targets', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)

			const context = new BrowserContext(client)
			await context.sync([
				createTarget({ id: 't1' }),
				createTarget({ id: 't2' }),
				createTarget({ id: 't3', type: 'iframe' }),
			])

			expect(context.pages()).toHaveLength(2)
		})

		it('discards previously synced pages on the next sync', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])
			await context.sync([createTarget({ id: 't3' })])

			expect(context.pages()).toHaveLength(1)
		})

		it('skips a target it cannot attach to', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Target.attachToTarget', {})

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' })])

			expect(context.pages()).toHaveLength(0)
		})

		it('applies the configured viewport to each synced page', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Emulation.setDeviceMetricsOverride')

			const context = new BrowserContext(client, undefined, { width: 400, height: 300 })
			await context.sync([createTarget({ id: 't1' })])

			const sent = transport.sent.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
			expect(sent?.params).toEqual({ width: 400, height: 300, deviceScaleFactor: 1, mobile: false })
		})
	})

	describe('close()', () => {
		it('closes all pages and clears the list', async () => {
			const { client, transport } = await createConnectedClient()
			scriptAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.closeTarget')

			const context = new BrowserContext(client)
			await context.create()
			await context.close()

			expect(context.pages()).toHaveLength(0)
		})

		it('disposes the real CDP browser context when it has an id', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Target.disposeBrowserContext')

			const context = new BrowserContext(client, 'ctx-1')
			await expect(context.close()).resolves.toBeUndefined()

			expect(transport.sent.some((m) => m.method === 'Target.disposeBrowserContext')).toBe(true)
		})

		it('resolves without error when the id is undefined', async () => {
			const { client } = await createConnectedClient()
			const context = new BrowserContext(client)
			await expect(context.close()).resolves.toBeUndefined()
		})
	})
})
