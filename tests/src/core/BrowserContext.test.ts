import { describe, it, expect } from 'vitest'
import type { BrowserPageInterface } from '@src/core'
import { BrowserContext } from '@src/core'
import { createRecorder } from '@orkestrel/test'
import {
	createConnectedCDPClient,
	createTarget,
	replyOk,
	scriptCDPAttach,
	waitForCondition,
} from '../../setup.js'

// === BrowserContext

describe('BrowserContext', () => {
	describe('page() / pages()', () => {
		it('returns undefined before any page exists', async () => {
			const { client } = await createConnectedCDPClient()
			const context = new BrowserContext(client)
			expect(context.page()).toBeUndefined()
		})

		it('returns undefined for an out-of-range index', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client)
			await context.create()

			expect(context.page(9999)).toBeUndefined()
			expect(context.page(-1)).toBeUndefined()
		})

		it('returns a fresh copy from pages() each call', async () => {
			const { client } = await createConnectedCDPClient()
			const context = new BrowserContext(client)
			expect(context.pages()).not.toBe(context.pages())
		})
	})

	describe('create()', () => {
		it('creates, attaches, and enables domains for a new page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client)
			const page = await context.create()

			expect(page.closed).toBe(false)
			expect(context.pages()).toHaveLength(1)
			expect(transport.sent.some((m) => m.method === 'Target.createTarget')).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Target.attachToTarget')).toBe(true)
		})

		it('includes browserContextId when this context has a real id', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })

			const context = new BrowserContext(client, 'ctx-1')
			await context.create()

			const sent = transport.sent.find((m) => m.method === 'Target.createTarget')
			expect(sent?.params?.['browserContextId']).toBe('ctx-1')
		})

		it('applies the viewport override for the new page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Emulation.setDeviceMetricsOverride')

			const context = new BrowserContext(client, undefined, { width: 800, height: 600 })
			await context.create()

			const sent = transport.sent.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
			expect(sent?.params).toEqual({ width: 800, height: 600, deviceScaleFactor: 1, mobile: false })
		})

		it('prefers the page-level viewport over the context default', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
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

		it('applies context emulation before adopting and emitting a popup page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Emulation.setTimezoneOverride')
			const context = new BrowserContext(client, undefined, undefined, undefined, {
				timezone: 'America/New_York',
			})
			await context.sync([createTarget({ id: 'parent' })])
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			pages.clear()

			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'popup-session',
					targetInfo: {
						targetId: 'popup',
						type: 'page',
						url: 'https://example.com/popup',
					},
				},
				'session-1',
			)
			await waitForCondition(() => context.pages().length === 2)

			expect(pages.count).toBe(1)
			expect(
				transport.sent.some(
					(message) =>
						message.method === 'Emulation.setTimezoneOverride' &&
						message.sessionId === 'popup-session',
				),
			).toBe(true)
		})

		it('throws when target creation fails to return a targetId', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.createTarget', {})

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('Failed to create new browser target')
		})

		it('throws when attaching to the new target fails', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.attachToTarget', {})
			replyOk(transport, 'Target.closeTarget')

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('Failed to attach to browser target')
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(true)
		})

		it('detaches the session and closes the target when domain setup fails', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.attachToTarget', { sessionId: 'session-1' })
			transport.onSend('Page.enable', (message) => transport.fail(message.id, 'enable failed'))
			replyOk(transport, 'Target.detachFromTarget')
			replyOk(transport, 'Target.closeTarget')

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('enable failed')

			expect(transport.sent.some((message) => message.method === 'Target.detachFromTarget')).toBe(
				true,
			)
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(true)
			expect(context.pages()).toEqual([])
		})

		it('releases a constructed page and closes its target when configuration fails', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.attachToTarget', { sessionId: 'session-1' })
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.getFrameTree', {
				frameTree: { frame: { id: 'frame-1', url: 'about:blank' } },
			})
			transport.onSend('Target.setAutoAttach', (message) => {
				transport.fail(message.id, 'auto attach failed')
			})
			replyOk(transport, 'Target.detachFromTarget')
			replyOk(transport, 'Target.closeTarget')

			const context = new BrowserContext(client)
			await expect(context.create()).rejects.toThrow('auto attach failed')

			expect(transport.sent.some((message) => message.method === 'Target.detachFromTarget')).toBe(
				true,
			)
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(true)
			expect(context.pages()).toEqual([])
		})
	})

	describe('sync()', () => {
		it('seeds the reattached page url from the target immediately, before any navigate/content call', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1', url: 'https://example.com/reattached' })])

			expect(context.page(0)?.url).toBe('https://example.com/reattached')
		})

		it('replaces pages with the given page-type targets', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)

			const context = new BrowserContext(client)
			await context.sync([
				createTarget({ id: 't1' }),
				createTarget({ id: 't2' }),
				createTarget({ id: 't3', type: 'iframe' }),
			])

			expect(context.pages()).toHaveLength(2)
		})

		it('discards previously synced pages on the next sync', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])
			await context.sync([createTarget({ id: 't3' })])

			expect(context.pages()).toHaveLength(1)
		})

		it('skips a target it cannot attach to', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.attachToTarget', {})

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' })])

			expect(context.pages()).toHaveLength(0)
		})

		it('detaches pages for targets no longer present and preserves kept pages', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])
			const kept = context.page(0)

			const attachCountBefore = transport.sent.filter(
				(m) => m.method === 'Target.attachToTarget',
			).length

			await context.sync([createTarget({ id: 't1' })])

			expect(context.pages()).toHaveLength(1)
			expect(context.page(0)).toBe(kept)
			expect(transport.sent.some((m) => m.method === 'Target.detachFromTarget')).toBe(true)

			// The kept target must not be re-attached
			const attachCountAfter = transport.sent.filter(
				(m) => m.method === 'Target.attachToTarget',
			).length
			expect(attachCountAfter).toBe(attachCountBefore)
		})

		it('applies the configured viewport to each synced page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Emulation.setDeviceMetricsOverride')

			const context = new BrowserContext(client, undefined, { width: 400, height: 300 })
			await context.sync([createTarget({ id: 't1' })])

			const sent = transport.sent.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
			expect(sent?.params).toEqual({ width: 400, height: 300, deviceScaleFactor: 1, mobile: false })
		})

		it('sync([]) on a context holding pages closes all pages and empties pages()', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])
			expect(context.pages()).toHaveLength(2)

			await context.sync([])

			expect(context.pages()).toHaveLength(0)
			expect(transport.sent.filter((m) => m.method === 'Target.detachFromTarget')).toHaveLength(2)
		})

		it('reflects new insertion order after a removed target is re-added in a later sync', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])
			const originalT2 = context.page(1)

			// Remove t1 — t2 is kept, unaffected
			await context.sync([createTarget({ id: 't2' })])
			expect(context.pages()).toHaveLength(1)
			expect(context.page(0)).toBe(originalT2)

			// Re-add t1 after t2 — insertion order places it LAST, not back at index 0
			await context.sync([createTarget({ id: 't2' }), createTarget({ id: 't1' })])

			expect(context.pages()).toHaveLength(2)
			expect(context.page(0)).toBe(originalT2)
			expect(context.page(1)).not.toBe(originalT2)
		})

		it('skips a target whose Page.enable/Runtime.enable rejects mid-attach, leaving the map uncorrupted', async () => {
			const { client, transport } = await createConnectedCDPClient()

			transport.onSend('Target.attachToTarget', (message) => {
				const targetId = message.params?.['targetId']
				const sessionId = targetId === 't1' ? 'session-bad' : 'session-good'
				transport.reply(message.id, { sessionId })
			})
			transport.onSend('Page.enable', (message) => {
				if (message.sessionId === 'session-bad') {
					transport.fail(message.id, 'boom')
				} else {
					transport.reply(message.id, {})
				}
			})
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.getFrameTree', {
				frameTree: { frame: { id: 'frame-good', url: 'about:blank' } },
			})
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Page.setInterceptFileChooserDialog')
			replyOk(transport, 'Browser.setDownloadBehavior')
			replyOk(transport, 'Network.enable')
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])

			expect(context.pages()).toHaveLength(1)
			expect(context.page(0)?.closed).toBe(false)
		})
	})

	describe('close()', () => {
		it('closes all pages and clears the list', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.closeTarget')

			const context = new BrowserContext(client)
			await context.create()
			await context.close()

			expect(context.pages()).toHaveLength(0)
		})

		it('disposes the real CDP browser context when it has an id', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.disposeBrowserContext')

			const context = new BrowserContext(client, 'ctx-1')
			await expect(context.close()).resolves.toBeUndefined()

			expect(transport.sent.some((m) => m.method === 'Target.disposeBrowserContext')).toBe(true)
		})

		it('resolves without error when the id is undefined', async () => {
			const { client } = await createConnectedCDPClient()
			const context = new BrowserContext(client)
			await expect(context.close()).resolves.toBeUndefined()
		})
	})

	describe('destroy()', () => {
		it('detaches pages without closing targets or disposing the remote context', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'target-1' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client, 'ctx-1')
			await context.create()

			await context.destroy()

			expect(context.pages()).toEqual([])
			expect(transport.sent.some((message) => message.method === 'Target.detachFromTarget')).toBe(
				true,
			)
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(false)
			expect(
				transport.sent.some((message) => message.method === 'Target.disposeBrowserContext'),
			).toBe(false)
		})

		it('rejects page creation after teardown', async () => {
			const { client } = await createConnectedCDPClient()
			const context = new BrowserContext(client)
			await context.destroy()

			await expect(context.create()).rejects.toThrow('Browser context is closed')
		})
	})
})
