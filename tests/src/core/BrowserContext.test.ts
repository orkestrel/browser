import { describe, it, expect } from 'vitest'
import type { BrowserPageInterface, BrowserViewInterface } from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { BrowserContext, createBrowserToolset, isBrowserError } from '@src/core'
import { isString } from '@orkestrel/contract'
import {
	captureError,
	createRecorder,
	readProperty,
	requireValue,
	waitForCondition,
	waitForDelay,
} from '@orkestrel/test'
import {
	createConnectedCDPClient,
	createTarget,
	readCDPParams,
	replyOk,
	scriptBrowserElements,
	scriptCDPAttach,
	scriptEvaluate,
	throwListenerError,
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
			await waitForCondition('the context reports two pages', () => context.pages().length === 2)

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
				createTarget({ id: 't3', category: 'iframe' }),
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
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Browser.setDownloadBehavior')
			replyOk(transport, 'Network.enable')
			replyOk(transport, 'Target.detachFromTarget')

			const context = new BrowserContext(client)
			await context.sync([createTarget({ id: 't1' }), createTarget({ id: 't2' })])

			expect(context.pages()).toHaveLength(1)
			expect(context.page(0)?.closed).toBe(false)
		})
	})

	describe('popup discovery', () => {
		it('enables discovery once per connection and publishes a discovered window.open page once, on its own session, with the context reference allocator', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', {
				popup: 'popup-session',
				'tab-2': 'session-2',
			})
			scriptBrowserElements(transport)
			let created = 0
			transport.onSend('Target.createTarget', (message) => {
				created += 1
				transport.reply(message.id, { targetId: created === 1 ? 'opener' : `tab-${created}` })
			})
			const context = new BrowserContext(client, 'ctx-1')
			const sibling = new BrowserContext(client, 'ctx-2')
			try {
				const opener = await context.create()
				await sibling.create()
				await opener.elements.outline()
				const maximum = Math.max(
					...opener.elements.elements().map((element) => Number(element.reference.slice(1))),
				)
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				transport.event('Target.targetCreated', {
					targetInfo: {
						targetId: 'popup',
						type: 'page',
						title: '',
						url: '',
						attached: false,
						openerId: 'opener',
						canAccessOpener: true,
						openerFrameId: 'opener',
						browserContextId: 'ctx-1',
					},
				})
				await waitForCondition('the context lists the popup', () => context.pages().length === 2)

				const popup = requireValue(popups.calls[0]?.[0], 'popup')
				expect(popups.count).toBe(1)
				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(popup)
				expect(context.pages()).toHaveLength(2)
				expect(context.pages()[0]).toBe(opener)
				expect(context.pages()[1]).toBe(popup)
				expect(sibling.pages()).toHaveLength(1)
				expect(popup).toMatchObject({ target: 'popup', url: 'about:blank', closed: false })
				expect(popup.opener).toBe(opener)
				expect(readCDPParams(transport, 'Target.setDiscoverTargets')).toEqual([{ discover: true }])
				expect(
					transport.sent
						.filter((message) => message.method === 'Target.attachToTarget')
						.map((message) => [message.params?.['targetId'], message.sessionId]),
				).toEqual([
					['opener', undefined],
					['tab-2', undefined],
					['popup', undefined],
				])
				expect(
					transport.sent
						.filter((message) => message.sessionId === 'popup-session')
						.map((message) => message.method),
				).toEqual(
					expect.arrayContaining([
						'Page.enable',
						'Runtime.enable',
						'Page.setLifecycleEventsEnabled',
						'Target.setAutoAttach',
						'Page.setInterceptFileChooserDialog',
						'Network.enable',
					]),
				)

				transport.event(
					'Page.frameNavigated',
					{ frame: { id: 'frame-popup-session', url: 'https://example.test/popup' } },
					'popup-session',
				)
				expect(popup.url).toBe('https://example.test/popup')
				await popup.elements.outline()
				const references = popup.elements
					.elements()
					.map((element) => Number(element.reference.slice(1)))
				expect(references.length).toBeGreaterThan(0)
				expect(Math.min(...references)).toBeGreaterThan(maximum)
				expect(
					transport.sent
						.filter((message) => message.method === 'Accessibility.getFullAXTree')
						.map((message) => message.sessionId),
				).toContain('popup-session')
			} finally {
				await client.close()
			}
		})

		it('leaves a created page without an opener, in another context, or opened by a page it does not hold unattached', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			const context = new BrowserContext(client, 'ctx-1')
			try {
				const opener = await context.create()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				opener.emitter.on('popup', popups.handler)
				const base = { type: 'page', url: '', attached: false, browserContextId: 'ctx-1' }

				transport.event('Target.targetCreated', { targetInfo: { ...base, targetId: 'tab' } })
				transport.event('Target.targetCreated', {
					targetInfo: { ...base, targetId: 'stranger', openerId: 'elsewhere' },
				})
				transport.event('Target.targetCreated', {
					targetInfo: {
						...base,
						targetId: 'foreign',
						openerId: 'opener',
						browserContextId: 'ctx-2',
					},
				})
				transport.event('Target.targetCreated', {
					targetInfo: { ...base, targetId: 'worker', type: 'worker', openerId: 'opener' },
				})
				transport.event('Target.targetCreated', {
					targetInfo: { ...base, targetId: 'claimed', openerId: 'opener', attached: true },
				})
				transport.event('Target.targetCreated', {
					targetInfo: { ...base, targetId: 'popup', openerId: 'opener' },
				})
				await waitForCondition('the context lists the popup', () => context.pages().length === 2)

				expect(popups.calls.map(([page]) => page.target)).toEqual(['popup'])
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['opener', 'popup'])
			} finally {
				await client.close()
			}
		})

		it('publishes a popup discovery reports before its attachment event once and detaches the second session on the opener session', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-child',
						targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
					},
					'session-1',
				)
				await waitForCondition('the context lists the popup', () => context.pages().length === 2)
				transport.event(
					'Target.detachedFromTarget',
					{ sessionId: 'popup-child', targetId: 'popup' },
					'session-1',
				)

				const popup = requireValue(popups.calls[0]?.[0], 'popup')
				expect(popups.count).toBe(1)
				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(popup)
				expect(popup.closed).toBe(false)
				expect(context.pages()).toHaveLength(2)
				expect(context.pages()[0]).toBe(opener)
				expect(context.pages()[1]).toBe(popup)
				expect(
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId]),
				).toEqual([['popup-child', 'session-1']])
				expect(
					transport.sent.some(
						(message) => message.method === 'Page.enable' && message.sessionId === 'popup-child',
					),
				).toBe(false)
			} finally {
				await client.close()
			}
		})

		it('publishes a popup whose attachment event precedes discovery once, without a second attach', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)

				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-child',
						targetInfo: { targetId: 'popup', type: 'page', url: 'https://example.test/popup' },
					},
					'session-1',
				)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('the context lists the popup', () => context.pages().length === 2)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})

				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toMatchObject({
					target: 'popup',
					url: 'https://example.test/popup',
					opener,
				})
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['opener'])
			} finally {
				await client.close()
			}
		})

		it('publishes nothing and rejects nothing on the opener when the popup attach or its initialization fails', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Target.attachToTarget', (message) => {
				if (message.params?.['targetId'] === 'refused') transport.fail(message.id, 'No target')
			})
			transport.onSend('Page.enable', (message) => {
				if (message.sessionId === 'broken-session') transport.fail(message.id, 'Target closed')
			})
			scriptCDPAttach(transport, 'session-1', {
				broken: 'broken-session',
				popup: 'popup-session',
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)
				const info = { type: 'page', url: '', openerId: 'opener' }

				transport.event('Target.targetCreated', { targetInfo: { ...info, targetId: 'refused' } })
				transport.event('Target.targetCreated', { targetInfo: { ...info, targetId: 'broken' } })
				transport.event('Target.targetCreated', { targetInfo: { ...info, targetId: 'popup' } })
				await waitForCondition('the context lists the popup', () => context.pages().length === 2)

				expect(popups.calls.map(([page]) => page.target)).toEqual(['popup'])
				expect(pages.calls.map(([page]) => page.target)).toEqual(['popup'])
				expect(opener.closed).toBe(false)
				expect(
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId]),
				).toEqual([['broken-session', undefined]])
			} finally {
				await client.close()
			}
		})

		it('returns the toolset view to the opener when a discovered popup closes', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			scriptBrowserElements(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const toolset = createBrowserToolset(opener, { context })
				await toolset.start()
				const selected = createRecorder<[view: BrowserViewInterface]>()
				toolset.emitter.on('select', selected.handler)

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('the view follows the popup', () => selected.count === 1)
				const popup = requireValue(context.pages()[1], 'popup')
				expect(selected.calls[0]?.[0]).toBe(popup)
				expect(toolset.view).toBe(popup)

				transport.event('Target.targetDestroyed', { targetId: 'popup' })
				await waitForCondition('the view returns to the opener', () => selected.count === 2)

				expect(selected.calls[1]?.[0]).toBe(opener)
				expect(toolset.view).toBe(opener)
				expect(popup.closed).toBe(true)
				expect(context.pages()).toHaveLength(1)
				expect(context.pages()[0]).toBe(opener)
				await toolset.destroy()
			} finally {
				await client.close()
			}
		})

		it('keeps the popup discovery published when a sync that reattaches its target finishes later', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' }, (message) => {
				if (
					held.length > 0 ||
					message.method !== 'Target.attachToTarget' ||
					message.params?.['targetId'] !== 'popup'
				)
					return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				const synced = context.sync([createTarget({ id: 'opener' }), createTarget({ id: 'popup' })])
				await waitForCondition('sync attaches the popup target', () => held.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('the opener publishes the popup', () => popups.count === 1)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-session' })
				await synced
				await waitForCondition('the context lists the popup', () => pages.count === 1)

				const popup = requireValue(popups.calls[0]?.[0], 'popup')
				expect(popups.count).toBe(1)
				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(popup)
				expect(context.pages()).toHaveLength(2)
				expect(context.pages()[0]).toBe(opener)
				expect(context.pages()[1]).toBe(popup)
				expect(
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId]),
				).toEqual([['sync-session', undefined]])
			} finally {
				await client.close()
			}
		})

		it('publishes a target a sync attached first as the popup of its opener without a second page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { popup: 'sync-session' }, (message) => {
				if (
					held.length > 0 ||
					message.method !== 'Target.attachToTarget' ||
					message.params?.['targetId'] !== 'popup'
				)
					return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('discovery attaches the popup target', () => held.length === 1)
				await context.sync([createTarget({ id: 'opener' }), createTarget({ id: 'popup' })])
				expect(pages.count).toBe(1)
				transport.reply(requireValue(held[0], 'discovery attach').id, {
					sessionId: 'popup-session',
				})
				await waitForCondition('the opener publishes the popup', () => popups.count === 1)

				const popup = requireValue(popups.calls[0]?.[0], 'popup')
				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(popup)
				expect(context.pages()).toHaveLength(2)
				expect(context.pages()[0]).toBe(opener)
				expect(context.pages()[1]).toBe(popup)
				expect(popup.opener).toBe(opener)
				expect(
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId]),
				).toEqual([['popup-session', undefined]])
			} finally {
				await client.close()
			}
		})

		it('leaves a popup that closed while its adoption waited out of pages()', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const emulations: CDPSentMessage[] = []
			transport.onSend('Emulation.setTimezoneOverride', (message) => {
				if (message.sessionId === 'popup-session') emulations.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client, undefined, undefined, undefined, {
				timezone: 'America/New_York',
			})
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('the adoption emulates the popup', () => emulations.length === 1)
				const popup = requireValue(popups.calls[0]?.[0], 'popup')
				const closes = createRecorder<[]>()
				popup.emitter.on('close', closes.handler)
				transport.event('Target.targetDestroyed', { targetId: 'popup' })
				await waitForCondition('the popup closes', () => closes.count === 1)
				transport.reply(requireValue(emulations[0], 'emulation').id, {})
				await waitForDelay(20)

				expect(popup.closed).toBe(true)
				expect(pages.count).toBe(0)
				expect(context.pages()).toHaveLength(1)
				expect(context.pages()[0]).toBe(opener)
			} finally {
				await client.close()
			}
		})

		it('enables discovery again on the next connection of the same client', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport)
			let created = 0
			transport.onSend('Target.createTarget', (message) => {
				created += 1
				transport.reply(message.id, { targetId: `tab-${created}` })
			})
			replyOk(transport, 'Target.detachFromTarget')
			try {
				const first = new BrowserContext(client)
				await first.create()
				await first.create()
				await first.destroy()
				await client.reconnect()
				const second = new BrowserContext(client)
				await second.create()

				expect(readCDPParams(transport, 'Target.setDiscoverTargets')).toEqual([
					{ discover: true },
					{ discover: true },
				])
			} finally {
				await client.close()
			}
		})

		it('publishes a popup reported twice during its opener initialization once, after the opener', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' }, (message) => {
				if (
					held.length > 0 ||
					message.method !== 'Target.setAutoAttach' ||
					message.sessionId !== 'session-1'
				)
					return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			const context = new BrowserContext(client)
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const creating = context.create()
				// A failed assertion leaves the creation pending until the client closes.
				void creating.catch(() => undefined)
				await waitForCondition('the opener configures', () => held.length === 1)
				const report = {
					targetInfo: {
						targetId: 'popup',
						type: 'page',
						url: '',
						attached: false,
						openerId: 'opener',
					},
				}
				transport.event('Target.targetCreated', report)
				transport.event('Target.targetCreated', report)
				await waitForCondition('the popup initializes', () =>
					transport.sent.some(
						(message) =>
							message.method === 'Network.enable' && message.sessionId === 'popup-session',
					),
				)
				await waitForDelay(20)
				expect(pages.count).toBe(0)
				transport.reply(requireValue(held[0], 'opener configuration').id, {})
				const opener = await creating
				await waitForCondition('the context lists the popup', () => pages.count === 2)

				expect(pages.calls.map(([page]) => page.target)).toEqual(['opener', 'popup'])
				expect(pages.calls[1]?.[0].opener).toBe(opener)
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['opener', 'popup'])
			} finally {
				await client.close()
			}
		})

		it('publishes a popup reported before its opener existed once, after the opener publishes', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })
			let created = 0
			transport.onSend('Target.createTarget', (message) => {
				created += 1
				transport.reply(message.id, { targetId: created === 1 ? 'first' : 'opener' })
			})
			const context = new BrowserContext(client)
			try {
				await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				transport.event('Target.targetCreated', {
					targetInfo: {
						targetId: 'popup',
						type: 'page',
						url: '',
						attached: false,
						openerId: 'opener',
					},
				})
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['first'])

				const opener = await context.create()
				await waitForCondition('the context lists the popup', () => pages.count === 2)

				expect(pages.calls.map(([page]) => page.target)).toEqual(['opener', 'popup'])
				expect(pages.calls[1]?.[0].opener).toBe(opener)
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['first', 'opener', 'popup'])
			} finally {
				await client.close()
			}
		})

		it('publishes no popup whose holder closed while the losing session detached, and the toolset stays on the opener', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			const detaches: CDPSentMessage[] = []
			transport.onSend('Target.detachFromTarget', (message) => {
				if (message.params?.['sessionId'] === 'popup-session') detaches.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'session-1', { popup: 'sync-session' }, (message) => {
				if (
					held.length > 0 ||
					message.method !== 'Target.attachToTarget' ||
					message.params?.['targetId'] !== 'popup'
				)
					return false
				held.push(message)
				return true
			})
			scriptBrowserElements(transport)
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const toolset = createBrowserToolset(opener, { context })
				await toolset.start()
				const selected = createRecorder<[view: BrowserViewInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				toolset.emitter.on('select', selected.handler)
				opener.emitter.on('popup', popups.handler)

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForCondition('discovery attaches the popup target', () => held.length === 1)
				await context.sync([createTarget({ id: 'opener' }), createTarget({ id: 'popup' })])
				const winner = requireValue(context.pages()[1], 'synchronized popup')
				transport.reply(requireValue(held[0], 'discovery attach').id, {
					sessionId: 'popup-session',
				})
				await waitForCondition('the losing session detaches', () => detaches.length === 1)
				const closes = createRecorder<[]>()
				winner.emitter.on('close', closes.handler)
				transport.event('Target.targetDestroyed', { targetId: 'popup' })
				await waitForCondition('the winner closes', () => closes.count === 1)
				transport.reply(requireValue(detaches[0], 'losing detach').id, {})
				await waitForDelay(20)

				expect(popups.count).toBe(0)
				expect(context.pages()).toHaveLength(1)
				expect(context.pages()[0]).toBe(opener)
				expect(selected.count).toBe(0)
				expect(toolset.view).toBe(opener)
				await toolset.destroy()
			} finally {
				await client.close()
			}
		})

		it('publishes no popup for a holder whose setup fails after discovery found it', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const paused: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { popup: 'sync-session' }, (message) => {
				if (
					paused.length > 0 ||
					message.method !== 'Target.setAutoAttach' ||
					message.sessionId !== 'sync-session'
				)
					return false
				paused.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'opener' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const popups = createRecorder<[page: BrowserPageInterface]>()
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', popups.handler)

				const synced = context.sync([createTarget({ id: 'opener' }), createTarget({ id: 'popup' })])
				await waitForCondition('sync configures the popup', () => paused.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'popup', type: 'page', url: '', openerId: 'opener' },
				})
				await waitForDelay(20)
				transport.fail(requireValue(paused[0], 'paused setup').id, 'Target closed')
				await synced
				await waitForDelay(20)

				expect(popups.count).toBe(0)
				expect(pages.count).toBe(0)
				expect(context.pages()).toHaveLength(1)
				expect(context.pages()[0]).toBe(opener)
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['opener', 'popup'])
			} finally {
				await client.close()
			}
		})

		it('emits a popup of a popup after its opener emits that popup when the descendant initializes first', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const paused: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { b: 'session-b', c: 'session-c' }, (message) => {
				if (
					paused.length > 0 ||
					message.method !== 'Target.setAutoAttach' ||
					message.sessionId !== 'session-b'
				)
					return false
				paused.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'a' })
			const context = new BrowserContext(client)
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const order: string[] = []
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', (popup) => {
					order.push(`a>${popup.target}`)
					popup.emitter.on('popup', (descendant) =>
						order.push(`${popup.target}>${descendant.target}`),
					)
				})

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'b', type: 'page', url: '', openerId: 'a' },
				})
				await waitForCondition('the popup configures', () => paused.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'c', type: 'page', url: '', openerId: 'b' },
				})
				await waitForCondition('the descendant initializes', () =>
					transport.sent.some(
						(message) => message.method === 'Network.enable' && message.sessionId === 'session-c',
					),
				)
				await waitForDelay(20)
				expect(order).toEqual([])
				transport.reply(requireValue(paused[0], 'paused setup').id, {})
				await waitForCondition('the context lists both popups', () => pages.count === 2)

				expect(order).toEqual(['a>b', 'b>c'])
				expect(pages.calls.map(([page]) => page.target)).toEqual(['b', 'c'])
				expect(context.pages().map((page) => page.target)).toEqual(['a', 'b', 'c'])
			} finally {
				await client.close()
			}
		})

		it('publishes a popup of a popup after that popup when the popup adoption is still emulating', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const emulations: CDPSentMessage[] = []
			transport.onSend('Emulation.setTimezoneOverride', (message) => {
				if (message.sessionId === 'session-b') emulations.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'session-1', { b: 'session-b', c: 'session-c' })
			replyOk(transport, 'Target.createTarget', { targetId: 'a' })
			const context = new BrowserContext(client, undefined, undefined, undefined, {
				timezone: 'America/New_York',
			})
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const order: string[] = []
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', (popup) => {
					order.push(`a>${popup.target}`)
					popup.emitter.on('popup', (descendant) =>
						order.push(`${popup.target}>${descendant.target}`),
					)
				})

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'b', type: 'page', url: '', openerId: 'a' },
				})
				await waitForCondition('the popup adoption emulates', () => emulations.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'c', type: 'page', url: '', openerId: 'b' },
				})
				await waitForCondition('the popup emits its descendant', () => order.length === 2)
				await waitForDelay(20)
				expect(pages.count).toBe(0)
				transport.reply(requireValue(emulations[0], 'popup emulation').id, {})
				await waitForCondition('the context lists both popups', () => pages.count === 2)

				expect(order).toEqual(['a>b', 'b>c'])
				expect(pages.calls.map(([page]) => page.target)).toEqual(['b', 'c'])
				expect(context.pages().map((page) => page.target)).toEqual(['a', 'b', 'c'])
			} finally {
				await client.close()
			}
		})

		it('keeps a popup adoption boundary for its descendants after a losing sync of the same target settles', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			const emulations: CDPSentMessage[] = []
			transport.onSend('Emulation.setTimezoneOverride', (message) => {
				if (message.sessionId === 'session-b') emulations.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'session-1', { b: 'session-b', c: 'session-c' }, (message) => {
				if (
					held.length > 0 ||
					message.method !== 'Target.attachToTarget' ||
					message.params?.['targetId'] !== 'b'
				)
					return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'a' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client, undefined, undefined, undefined, {
				timezone: 'America/New_York',
			})
			try {
				const opener = await context.create()
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const order: string[] = []
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', (popup) => {
					order.push(`a>${popup.target}`)
					popup.emitter.on('popup', (descendant) =>
						order.push(`${popup.target}>${descendant.target}`),
					)
				})

				const synced = context.sync([createTarget({ id: 'a' }), createTarget({ id: 'b' })])
				await waitForCondition('sync attaches the popup target', () => held.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'b', type: 'page', url: '', openerId: 'a' },
				})
				await waitForCondition('the opener emits the popup', () => order.length === 1)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-b' })
				await synced
				await waitForCondition('the popup adoption emulates', () => emulations.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'c', type: 'page', url: '', openerId: 'b' },
				})
				await waitForCondition('the popup emits its descendant', () => order.length === 2)
				await waitForDelay(20)
				expect(pages.count).toBe(0)
				transport.reply(requireValue(emulations[0], 'popup emulation').id, {})
				await waitForCondition('the context lists both popups', () => pages.count === 2)

				expect(order).toEqual(['a>b', 'b>c'])
				expect(pages.calls.map(([page]) => page.target)).toEqual(['b', 'c'])
				expect(context.pages().map((page) => page.target)).toEqual(['a', 'b', 'c'])
			} finally {
				await client.close()
			}
		})

		it('publishes a created page once while a sync of its target waits, and closes no target', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { t: 'sync-session' }, (message) => {
				if (held.length > 0 || message.method !== 'Target.attachToTarget') return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			replyOk(transport, 'Target.detachFromTarget')
			replyOk(transport, 'Target.closeTarget')
			const context = new BrowserContext(client)
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const creating = context.create()
				void creating.catch(() => undefined)
				await waitForCondition('creation attaches its target', () => held.length === 1)
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForDelay(20)
				transport.reply(requireValue(held[0], 'creation attach').id, {
					sessionId: 'create-session',
				})
				const page = await creating
				await synced

				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(page)
				expect(context.pages()).toHaveLength(1)
				expect(context.pages()[0]).toBe(page)
				expect(readCDPParams(transport, 'Target.closeTarget')).toEqual([])
			} finally {
				await client.close()
			}
		})

		it('joins a creation to the page a sync already attaching its target publishes', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', undefined, (message) => {
				if (held.length > 0 || message.method !== 'Target.attachToTarget') return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			replyOk(transport, 'Target.detachFromTarget')
			replyOk(transport, 'Target.closeTarget')
			const context = new BrowserContext(client)
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForCondition('sync attaches the target', () => held.length === 1)
				const creating = context.create()
				void creating.catch(() => undefined)
				await waitForDelay(20)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-session' })
				await synced
				const page = await creating

				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(page)
				expect(context.pages()).toHaveLength(1)
				expect(readCDPParams(transport, 'Target.closeTarget')).toEqual([])
				expect(
					readCDPParams(transport, 'Target.attachToTarget').map((params) => params['targetId']),
				).toEqual(['t'])
			} finally {
				await client.close()
			}
		})

		it('keeps a popup adoption boundary when an initial popup listener starts a sync of the popup target', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			const emulations: CDPSentMessage[] = []
			let attaches = 0
			transport.onSend('Emulation.setTimezoneOverride', (message) => {
				if (message.sessionId === 'session-b') emulations.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'session-1', { b: 'session-b', c: 'session-c' }, (message) => {
				if (message.method !== 'Target.attachToTarget' || message.params?.['targetId'] !== 'b')
					return false
				attaches += 1
				if (attaches !== 2) return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 'a' })
			replyOk(transport, 'Target.detachFromTarget')
			const context = new BrowserContext(client, undefined, undefined, undefined, {
				timezone: 'America/New_York',
			})
			const synced: Array<Promise<void>> = []
			try {
				const opener = await context.create({
					on: {
						popup: () => {
							synced.push(context.sync([createTarget({ id: 'b' }), createTarget({ id: 'a' })]))
						},
					},
				})
				const pages = createRecorder<[page: BrowserPageInterface]>()
				const order: string[] = []
				context.emitter.on('page', pages.handler)
				opener.emitter.on('popup', (popup) => {
					order.push(`a>${popup.target}`)
					popup.emitter.on('popup', (descendant) =>
						order.push(`${popup.target}>${descendant.target}`),
					)
				})

				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'b', type: 'page', url: '', openerId: 'a' },
				})
				await waitForCondition(
					'the listener sync attaches the popup target',
					() => held.length === 1,
				)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-b' })
				await Promise.all(synced)
				await waitForCondition('the popup adoption emulates', () => emulations.length === 1)
				transport.event('Target.targetCreated', {
					targetInfo: { targetId: 'c', type: 'page', url: '', openerId: 'b' },
				})
				await waitForCondition('the popup emits its descendant', () => order.length === 2)
				await waitForDelay(20)
				expect(pages.count).toBe(0)
				transport.reply(requireValue(emulations[0], 'popup emulation').id, {})
				await waitForCondition('the context lists both popups', () => pages.count === 2)

				expect(order).toEqual(['a>b', 'b>c'])
				expect(pages.calls.map(([page]) => page.target)).toEqual(['b', 'c'])
				expect(context.pages().map((page) => page.target)).toEqual(['a', 'b', 'c'])
			} finally {
				await client.close()
			}
		})

		it('navigates a page a creation joins to the url the creation requested, and refuses the join when the page closes during that navigation', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			const pending: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { t: 'sync-session' }, (message) => {
				if (held.length > 0 || message.method !== 'Target.attachToTarget') return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			transport.onSend('Page.navigate', (message) => {
				if (message.params?.['url'] !== 'https://example.com/requested') {
					pending.push(message)
					return
				}
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			scriptEvaluate(
				transport,
				(expression) => expression.includes('location.href'),
				'https://example.com/requested',
			)
			const context = new BrowserContext(client)
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForCondition('sync attaches the target', () => held.length === 1)
				const creating = context.create({ url: 'https://example.com/requested', timeout: 2_000 })
				void creating.catch(() => undefined)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-session' })
				await synced
				const page = await creating

				expect(pages.count).toBe(1)
				expect(pages.calls[0]?.[0]).toBe(page)
				expect(
					transport.sent
						.filter((message) => message.method === 'Page.navigate')
						.map((message) => [message.params?.['url'], message.sessionId]),
				).toEqual([['https://example.com/requested', 'sync-session']])

				const closes = createRecorder<[]>()
				page.emitter.on('close', closes.handler)
				const refused = context
					.create({ url: 'https://example.com/late' })
					.catch((error: unknown) => error)
				await waitForCondition('the second join navigates', () => pending.length === 1)
				transport.event('Target.targetDestroyed', { targetId: 't' })
				await waitForCondition('the joined page closes', () => closes.count === 1)
				transport.reply(requireValue(pending[0], 'late navigation').id, {})

				const refusal = await refused
				expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_PAGE_CLOSED')
				expect(context.pages()).toEqual([])
			} finally {
				await client.close()
			}
		})

		it('navigates a joined page back to about:blank when the creation requested it and the page left it', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const creations: CDPSentMessage[] = []
			let location = 'about:blank'
			scriptCDPAttach(transport, 'session-1', { t: 'sync-session' })
			transport.onSend('Target.createTarget', (message) => creations.push(message))
			transport.onSend('Page.navigate', (message) => {
				const url = message.params?.['url']
				if (isString(url)) location = url
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			transport.onSend('Runtime.evaluate', (message) =>
				transport.reply(message.id, { result: { value: location } }),
			)
			const context = new BrowserContext(client)
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const creating = context.create({ url: 'about:blank', timeout: 2_000 })
				void creating.catch(() => undefined)
				await waitForCondition('creation requests its target', () => creations.length === 1)
				await context.sync([createTarget({ id: 't' })])
				const winner = requireValue(context.pages()[0], 'synchronized page')
				await winner.navigate('https://example.com/elsewhere')
				transport.reply(requireValue(creations[0], 'creation').id, { targetId: 't' })
				const page = await creating

				expect(page).toBe(winner)
				expect(pages.count).toBe(1)
				expect(
					transport.sent
						.filter((message) => message.method === 'Page.navigate')
						.map((message) => [message.params?.['url'], message.sessionId]),
				).toEqual([
					['https://example.com/elsewhere', 'sync-session'],
					['about:blank', 'sync-session'],
				])
				expect(location).toBe('about:blank')
			} finally {
				await client.close()
			}
		})

		it('reports a throw of a hook a joining creation registered to the creation error handler', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { t: 'sync-session' }, (message) => {
				if (held.length > 0 || message.method !== 'Target.attachToTarget') return false
				held.push(message)
				return true
			})
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			transport.onSend('Page.navigate', (message) => {
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			scriptEvaluate(
				transport,
				(expression) => expression.includes('location.href'),
				'https://example.com/requested',
			)
			const failures = createRecorder<[error: unknown, event: string]>()
			const context = new BrowserContext(client)
			try {
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForCondition('sync attaches the target', () => held.length === 1)
				const creating = context.create({
					url: 'https://example.com/requested',
					on: { navigate: throwListenerError },
					error: failures.handler,
				})
				void creating.catch(() => undefined)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-session' })
				await synced
				await creating
				expect(failures.count).toBe(0)

				transport.event(
					'Page.frameNavigated',
					{
						frame: { id: 'frame-sync-session', url: 'https://example.com/next', loaderId: 'next' },
					},
					'sync-session',
				)

				expect(
					failures.calls.map(([error, event]) => [readProperty(error, 'message'), event]),
				).toEqual([[readProperty(captureError(throwListenerError), 'message'), 'navigate']])
			} finally {
				await client.close()
			}
		})

		it('applies the viewport and hooks of a creation to the page it joins, and refuses the join when the page closes during its viewport', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			const viewports: CDPSentMessage[] = []
			scriptCDPAttach(transport, 'session-1', { t: 'sync-session' }, (message) => {
				if (held.length > 0 || message.method !== 'Target.attachToTarget') return false
				held.push(message)
				return true
			})
			transport.onSend('Emulation.setDeviceMetricsOverride', (message) => {
				if (message.params?.['width'] === 320) viewports.push(message)
				else transport.reply(message.id, {})
			})
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			const context = new BrowserContext(client)
			try {
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForCondition('sync attaches the target', () => held.length === 1)
				const closes = createRecorder<[]>()
				const creating = context.create({
					viewport: { width: 640, height: 480 },
					on: { close: closes.handler },
				})
				void creating.catch(() => undefined)
				transport.reply(requireValue(held[0], 'sync attach').id, { sessionId: 'sync-session' })
				await synced
				const page = await creating
				expect(
					transport.sent
						.filter((message) => message.method === 'Emulation.setDeviceMetricsOverride')
						.map((message) => [
							message.params?.['width'],
							message.params?.['height'],
							message.sessionId,
						]),
				).toEqual([[640, 480, 'sync-session']])

				const refused = context
					.create({ viewport: { width: 320, height: 240 } })
					.catch((error: unknown) => error)
				await waitForCondition('the second join applies its viewport', () => viewports.length === 1)
				transport.event('Target.targetDestroyed', { targetId: 't' })
				await waitForCondition('the joined page closes', () => closes.count === 1)
				transport.reply(requireValue(viewports[0], 'paused viewport').id, {})

				expect(page.closed).toBe(true)
				const refusal = await refused
				expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_PAGE_CLOSED')
				expect(context.pages()).toEqual([])
				expect(transport.sent.some((message) => message.method === 'Page.navigate')).toBe(false)
			} finally {
				await client.close()
			}
		})

		it('publishes no page a sync attached when it closed before publication, and the waiting creation rejects', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const viewports: CDPSentMessage[] = []
			let attaches = 0
			transport.onSend('Target.attachToTarget', (message) => {
				attaches += 1
				if (attaches === 2) transport.fail(message.id, 'No target with given id found')
			})
			transport.onSend('Emulation.setDeviceMetricsOverride', (message) => {
				if (message.sessionId === 'sync-session') viewports.push(message)
				else transport.reply(message.id, {})
			})
			scriptCDPAttach(transport, 'sync-session')
			replyOk(transport, 'Target.createTarget', { targetId: 't' })
			replyOk(transport, 'Target.detachFromTarget')
			replyOk(transport, 'Target.closeTarget')
			const context = new BrowserContext(client, undefined, { width: 800, height: 600 })
			const pages = createRecorder<[page: BrowserPageInterface]>()
			context.emitter.on('page', pages.handler)
			try {
				const synced = context.sync([createTarget({ id: 't' })])
				await waitForCondition('sync applies its viewport', () => viewports.length === 1)
				const creating = context.create()
				const refused = creating.catch((error: unknown) => error)
				await waitForDelay(20)
				transport.event('Target.targetDestroyed', { targetId: 't' })
				await waitForDelay(20)
				transport.fail(requireValue(viewports[0], 'paused viewport').id, 'Target closed')
				await synced

				expect(readProperty(await refused, 'message')).toBe('No target with given id found')
				expect(pages.count).toBe(0)
				expect(context.pages()).toEqual([])
				expect(readCDPParams(transport, 'Target.attachToTarget')).toHaveLength(2)
			} finally {
				await client.close()
			}
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

	describe('emitter options', () => {
		it('wires the initial listeners named by on and reports a throwing listener to error', async () => {
			const { client } = await createConnectedCDPClient()
			const closes = createRecorder<[]>()
			const failures = createRecorder<[error: unknown, event: string]>()
			const context = new BrowserContext(
				client,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				{ on: { close: closes.handler }, error: failures.handler },
			)
			context.emitter.on('close', throwListenerError)

			await context.destroy()

			expect(closes.count).toBe(1)
			expect(failures.calls.map(([, event]) => event)).toEqual(['close'])
		})
	})
})
