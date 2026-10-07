import type { BrowserFrameInterface } from '@src/core'
import type { CDPSentMessage } from '../../../setup.js'
import { BrowserPage } from '../../../../src/core/BrowserPage.js'
import { scanBrowserLines } from '@src/core'
import { renderBrowserLine } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserContext } from '@src/core'
import { createRecorder, requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import {
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_CHILD_FIXTURE,
	BROWSER_ELEMENT_NAME_CASES,
	BROWSER_ELEMENT_NAME_AX_FIXTURE,
	RecordingCDPClient,
	attachBrowserElementChild,
	createBrowserElementFixture,
	createConnectedCDPClient,
	scriptBrowserElements,
	scriptCDPAttach,
	TIMER_LEAD,
} from '../../../setup.js'

describe('element manager', () => {
	it.each(['query', 'describe', 'accessibility', 'document'])(
		'resumes a wait after navigation interrupts %s',
		async (method) => {
			let attempts = 0
			const fixture = await createBrowserElementFixture({
				local: true,
				[method]: (message: CDPSentMessage) => {
					attempts += 1
					if (attempts === 1) {
						fixture.transport.event(
							'Page.frameNavigated',
							{
								frame: { id: 'main', url: fixture.page.url, loaderId: 'next' },
							},
							'session-main',
						)
						fixture.transport.event(
							'Page.lifecycleEvent',
							{
								frameId: 'main',
								loaderId: 'next',
								name: 'DOMContentLoaded',
							},
							'session-main',
						)
						if (method === 'document') fixture.transport.reply(message.id, {})
						else fixture.transport.fail(message.id, 'Could not find node with given id')
					} else if (method === 'accessibility') fixture.transport.reply(message.id, { nodes: [] })
					else if (method === 'describe')
						fixture.transport.reply(message.id, { node: { backendNodeId: 7 } })
					else if (method === 'document')
						fixture.transport.reply(message.id, { root: { nodeId: 2 } })
					else fixture.transport.reply(message.id, { nodeIds: [50] })
				},
			})
			const { page, client } = fixture
			try {
				await expect(
					page.elements.wait({ css: '#destination' }, { timeout: 500 }),
				).resolves.toHaveLength(1)
				expect(attempts).toBeGreaterThanOrEqual(2)
			} finally {
				await client.close()
			}
		},
	)

	it('rethrows a persistent protocol failure after the navigation retry', async () => {
		let attempts = 0
		const fixture = await createBrowserElementFixture({
			local: true,
			query: (message) => {
				attempts += 1
				if (attempts === 1) {
					fixture.transport.event(
						'Page.frameNavigated',
						{ frame: { id: 'main', url: fixture.page.url, loaderId: 'next' } },
						'session-main',
					)
					fixture.transport.event(
						'Page.lifecycleEvent',
						{ frameId: 'main', loaderId: 'next', name: 'DOMContentLoaded' },
						'session-main',
					)
				}
				fixture.transport.fail(message.id, 'Selector is invalid')
			},
		})
		const { page, client } = fixture
		try {
			await expect(page.elements.wait({ css: '[' }, { timeout: 500 })).rejects.toMatchObject({
				code: 'REMOTE',
				message: 'Selector is invalid',
			})
			expect(attempts).toBe(2)
		} finally {
			await client.close()
		}
	})

	it('parks an absent wait on DOM readiness after context loss without a navigation step', async () => {
		let captures = 0
		const fixture = await createBrowserElementFixture({
			local: true,
			accessibility: (message) => {
				captures += 1
				if (captures === 1) fixture.transport.fail(message.id, 'Execution context was destroyed')
				else fixture.transport.reply(message.id, { nodes: [] })
			},
		})
		try {
			const pending = fixture.page.elements.wait(
				{ name: 'spinner' },
				{ absent: true, timeout: 500 },
			)
			await waitForCondition('the context was lost', () => captures > 0)
			const concurrent = fixture.page.elements.wait(
				{ name: 'spinner' },
				{ absent: true, timeout: 500 },
			)
			await waitForDelay(20)
			const beforeReady = captures
			fixture.transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'loader-main', name: 'DOMContentLoaded' },
				'session-main',
			)
			await expect(pending).resolves.toEqual([])
			await expect(concurrent).resolves.toEqual([])
			expect(beforeReady).toBe(1)
			expect(captures).toBe(3)
		} finally {
			await fixture.client.close()
		}
	})

	it('reports a wait timeout when world creation consumes the remaining time', async () => {
		const { page, client } = await createBrowserElementFixture({
			local: true,
			world: () => undefined,
		})
		try {
			await expect(page.elements.wait({ css: '#missing' }, { timeout: 20 })).rejects.toMatchObject({
				code: 'TIMEOUT',
			})
		} finally {
			await client.close()
		}
	})

	it('sends no world request after an element wait deadline is spent', async () => {
		const { page, client, transport } = await createBrowserElementFixture({ local: true })
		try {
			await expect(page.elements.wait({ css: '#missing' }, { timeout: 0 })).rejects.toMatchObject({
				code: 'TIMEOUT',
			})
			expect(transport.sent.some((message) => message.method === 'Page.createIsolatedWorld')).toBe(
				false,
			)
		} finally {
			await client.close()
		}
	})

	it('rejects an element wait when the page closes before its deadline', async () => {
		const fixture = await createBrowserElementFixture({
			local: true,
			evaluation: (message) => {
				if (message.params?.['awaitPromise'] !== true)
					fixture.transport.reply(message.id, { result: { value: false } })
			},
		})
		fixture.transport.onSend('Target.closeTarget', (message) =>
			fixture.transport.reply(message.id, { success: true }),
		)
		try {
			const pending = fixture.page.elements
				.wait({ name: 'missing' }, { timeout: 10_000 })
				.catch((error: unknown) => error)
			await waitForCondition('the observer is armed', () =>
				fixture.transport.sent.some((message) => message.params?.['awaitPromise'] === true),
			)
			const started = performance.now()
			await fixture.page.close()
			expect(await Promise.race([pending, waitForDelay(200)])).toMatchObject({
				code: 'CLOSED',
			})
			expect(performance.now() - started).toBeLessThan(500)
		} finally {
			await fixture.client.close()
		}
	})

	it.each(BROWSER_ELEMENT_NAME_CASES)('$title', async ({ query, expected }) => {
		const fixture = await createBrowserElementFixture({
			accessibility: (message) =>
				fixture.transport.reply(message.id, BROWSER_ELEMENT_NAME_AX_FIXTURE),
		})
		try {
			expect((await fixture.page.elements.find(query)).map((element) => element.name)).toEqual(
				expected,
			)
		} finally {
			await fixture.client.close()
		}
	})

	it('drops references on the page steps and subscribes to no frame commit or detach of its own', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserElements(transport)
		const recording = new RecordingCDPClient(client)
		const page = new BrowserPage(
			recording,
			'main',
			'session-main',
			undefined,
			'https://example.test/cart',
		)
		try {
			await attachBrowserElementChild(transport, page)
			expect(
				['session-main', 'session-child'].flatMap((session) =>
					['Page.frameNavigated', 'Page.frameDetached'].map((method) =>
						recording.registrations(method, session),
					),
				),
			).toEqual([1, 1, 1, 1])
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: page.url, loaderId: 'loader-main' } },
				'session-main',
			)
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'loader-main', name: 'DOMContentLoaded' },
				'session-main',
			)
			await page.elements.outline()
			const child = requireValue(
				page.elements.elements().find((element) => element.name === 'Save'),
			)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.test/next', loaderId: 'loader-next' } },
				'session-child',
			)
			expect(page.elements.element(child.reference)).toBeUndefined()
		} finally {
			await client.close()
		}
	})

	it('catches a child navigation invalidating a completed child capture or preserving its old references', async () => {
		let navigate = false
		const fixture = await createBrowserElementFixture({
			title: (message) => {
				if (navigate)
					fixture.transport.event(
						'Page.frameNavigated',
						{ frame: { id: 'child', url: 'https://example.test/next' } },
						'session-child',
					)
				fixture.transport.reply(message.id, { result: { value: 'Cart' } })
			},
		})
		try {
			await fixture.page.elements.outline()
			navigate = true
			await expect(fixture.page.elements.outline()).rejects.toMatchObject({
				context: { reason: 'GONE' },
			})
			expect(fixture.page.elements.element('e6')).toBeUndefined()
			expect(fixture.page.elements.element('e1')?.name).toBe('Home')
		} finally {
			await fixture.client.close()
		}
	})

	it('catches stale getters reading a reused backend under a new reference', async () => {
		let changed = false
		const fixture = await createBrowserElementFixture({
			accessibility: (message) =>
				fixture.transport.reply(
					message.id,
					message.params?.['frameId'] === 'child'
						? BROWSER_ELEMENT_CHILD_FIXTURE
						: {
								nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
									node.nodeId === 'link' && changed
										? { ...node, role: { value: 'button' }, name: { value: 'Replacement' } }
										: node,
								),
							},
				),
		})
		try {
			await fixture.page.elements.outline()
			const old = requireValue(fixture.page.elements.element('e1'))
			changed = true
			fixture.transport.event(
				'Page.frameNavigated',
				{
					type: 'BackForwardCacheRestore',
					frame: { id: 'main', url: 'https://another.test/', loaderId: 'new' },
				},
				'session-main',
			)
			await fixture.page.elements.outline()
			expect(fixture.page.elements.element('e7')?.name).toBe('Replacement')
			expect([old.role, old.name]).toEqual(['link', 'Home'])
		} finally {
			await fixture.client.close()
		}
	})

	it('catches concurrent CSS finds invalidating each other frontend node ids', async () => {
		const queries: number[] = []
		let documents = 0
		const fixture = await createBrowserElementFixture({
			document: (message) => {
				documents += 1
				fixture.transport.reply(message.id, { root: { nodeId: documents } })
			},
			query: (message) => {
				queries.push(message.id)
			},
		})
		try {
			const first = fixture.page.elements.find({ css: '.first' })
			const second = fixture.page.elements.find({ css: '.second' })
			await waitForCondition('first CSS query', () => queries.length > 0)
			await waitForDelay(20)
			expect(documents).toBe(1)
			fixture.transport.reply(requireValue(queries[0]), { nodeIds: [50] })
			await first
			await waitForCondition('second CSS query', () => queries.length === 2)
			fixture.transport.reply(requireValue(queries[1]), { nodeIds: [50] })
			await second
			expect(
				fixture.transport.sent
					.filter((message) => ['DOM.getDocument', 'DOM.querySelectorAll'].includes(message.method))
					.map((message) => [message.method, message.sessionId]),
			).toEqual([
				['DOM.getDocument', 'session-main'],
				['DOM.querySelectorAll', 'session-main'],
				['DOM.getDocument', 'session-main'],
				['DOM.querySelectorAll', 'session-main'],
			])
		} finally {
			await fixture.client.close()
		}
	})

	it('catches using a CSS frontend node id as an accessibility within key', async () => {
		const fixture = await createBrowserElementFixture({
			describe: (message) =>
				fixture.transport.reply(message.id, {
					node:
						message.params?.['backendNodeId'] === 13
							? { backendNodeId: 13, frameId: 'child' }
							: { backendNodeId: 14 },
				}),
		})
		try {
			const found = await fixture.page.elements.find({ css: 'p' })
			const outline = await fixture.page.elements.outline({
				within: requireValue(found[0]).reference,
			})
			expect(outline.lines.map(renderBrowserLine)).toEqual(['Delivery included.'])
			expect(outline.lines.map(renderBrowserLine).join('\n')).not.toContain('Home')
			expect(outline.listed).toBe(0)
		} finally {
			await fixture.client.close()
		}
	})
	it('catches failing to re-run find after a mutation wakes an element wait', async () => {
		let arrived = false
		let observer: number | undefined
		const fixture = await createBrowserElementFixture({
			evaluation: (message) => {
				if (String(message.params?.['expression']).includes('new MutationObserver'))
					observer = message.id
				else fixture.transport.reply(message.id, { result: { value: false } })
			},
			accessibility: (message) =>
				fixture.transport.reply(
					message.id,
					message.params?.['frameId'] === 'child'
						? {
								nodes: BROWSER_ELEMENT_CHILD_FIXTURE.nodes.map((node) =>
									node.nodeId === 'save' && arrived ? { ...node, name: { value: 'Later' } } : node,
								),
							}
						: BROWSER_ELEMENT_AX_FIXTURE,
				),
		})
		try {
			const pending = fixture.page.elements.wait(
				{ role: 'button', name: 'later' },
				{ timeout: 500 },
			)
			await waitForCondition(
				'first accessibility capture',
				() =>
					fixture.transport.sent.filter(
						(message) => message.method === 'Accessibility.getFullAXTree',
					).length === 2,
			)
			arrived = true
			const observerIndex = fixture.transport.sent.findIndex((message) =>
				String(message.params?.['expression']).includes('new MutationObserver'),
			)
			const captureIndex = fixture.transport.sent.findIndex(
				(message) => message.method === 'Accessibility.getFullAXTree',
			)
			fixture.transport.reply(requireValue(observer), { result: { value: true } })
			expect((await pending).map((element) => [element.reference, element.name])).toEqual([
				['e6', 'Later'],
			])
			expect(observerIndex).toBeGreaterThanOrEqual(0)
			expect(observerIndex).toBeLessThan(captureIndex)
			expect(
				fixture.transport.sent.filter(
					(message) => message.method === 'Accessibility.getFullAXTree',
				),
			).toHaveLength(4)
		} finally {
			await fixture.client.close()
		}
	})
	it('catches publishing references from an AX response overtaken by navigation', async () => {
		const fixture = await createBrowserElementFixture({
			accessibility: (message) => {
				if (message.params?.['frameId'] === 'main')
					fixture.transport.event(
						'Page.frameNavigated',
						{ frame: { id: 'main', url: 'https://example.test/changed', loaderId: 'changed' } },
						'session-main',
					)
				fixture.transport.reply(
					message.id,
					message.params?.['frameId'] === 'child'
						? BROWSER_ELEMENT_CHILD_FIXTURE
						: BROWSER_ELEMENT_AX_FIXTURE,
				)
			},
		})
		try {
			const pending = fixture.page.elements.outline()
			await expect(pending).rejects.toMatchObject({
				context: { reason: 'GONE', subject: 'outline' },
			})
			await expect(pending).rejects.not.toHaveProperty('context.reference')
			expect(fixture.page.elements.elements()).toEqual([])
		} finally {
			await fixture.client.close()
		}
	})
	it('catches observing the parent document for a wait within an iframe', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			expect(
				(
					await page.elements.wait({ role: 'button', name: 'sav', within: 'e5' }, { timeout: 100 })
				).map((element) => element.reference),
			).toEqual(['e6'])
			const observer = transport.sent.find((message) =>
				String(message.params?.['expression']).includes('new MutationObserver'),
			)
			expect(observer).toMatchObject({ sessionId: 'session-child', params: { contextId: 92 } })
			await expect(page.elements.wait({ name: 'absent' }, { absent: true })).resolves.toEqual([])
		} finally {
			await client.close()
		}
	})
	it('catches losing an iframe subtree when within crosses a session boundary', async () => {
		const { page, client } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			expect(
				(await page.elements.find({ role: 'button', name: 'sav', within: 'e5' })).map(
					(element) => element.reference,
				),
			).toEqual(['e6'])
		} finally {
			await client.close()
		}
	})
	it('catches AX array order, omitted rows, duplicate text, untrimmed names, and incorrect limit counts', async () => {
		const { page, client } = await createBrowserElementFixture()
		try {
			const outline = await page.elements.outline()
			expect({ ...outline, lines: outline.lines.map(renderBrowserLine).join('\n') }).toEqual({
				url: 'https://example.test/cart',
				title: 'Cart',
				listed: 6,
				found: 6,
				lines:
					'# Your cart\ne1 link "Home"\ne2 textbox "Email" value="sam@example.test"\ne3 checkbox "Gift wrap" [checked]\ne4 button "Place order" [disabled]\nTwo items, 48.00 total.\ne5 Iframe "Checkout"\ne6 button "Save"\nDelivery included.',
				focus: undefined,
			})
			const cut = await page.elements.outline({ limit: 2 })
			expect(scanBrowserLines((await page.elements.outline()).lines, 'the save button')).toEqual([
				8,
			])
			expect(cut.listed).toBe(2)
			expect(cut.found).toBe(6)
			expect(cut.lines.map(renderBrowserLine).join('\n')).toContain('Two items, 48.00 total.')
			expect(cut.lines.map(renderBrowserLine).join('\n')).not.toContain('e3')
		} finally {
			await client.close()
		}
	})

	it('catches sessionless keys and routes iframe capture, geometry, and translated page input', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const outer = requireValue(page.elements.element('e1'))
			const inner = requireValue(page.elements.element('e6'))
			expect(outer.name).toBe('Home')
			expect(inner.name).toBe('Save')
			await inner.click()
			expect(
				transport.sent.find((message) => message.method === 'DOM.getNodeForLocation'),
			).toMatchObject({ sessionId: 'session-child', params: { x: 20, y: 30 } })
			expect(
				transport.sent.find(
					(message) =>
						message.method === 'Accessibility.getFullAXTree' &&
						message.params?.['frameId'] === 'child',
				)?.sessionId,
			).toBe('session-child')
			expect(
				transport.sent.find(
					(message) =>
						message.method === 'DOM.getContentQuads' && message.params?.['backendNodeId'] === 3,
				)?.sessionId,
			).toBe('session-child')
			expect(
				transport.sent
					.filter((message) => message.method === 'Input.dispatchMouseEvent')
					.map((message) => [
						message.sessionId,
						message.params?.['type'],
						message.params?.['x'],
						message.params?.['y'],
					]),
			).toEqual([
				['session-main', 'mousePressed', 250, 200],
				['session-main', 'mouseReleased', 250, 200],
			])
		} finally {
			await client.close()
		}
	})

	it('catches reference reallocation, reuse after navigation, and overbroad child invalidation', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const first = requireValue(page.elements.element('e1'))
			await page.elements.outline()
			expect(page.elements.element('e1')).toBe(first)
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'main', url: 'https://example.test/cart#done' },
				'session-main',
			)
			expect(page.elements.element('e1')).toBe(first)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.test/next' } },
				'session-main',
			)
			expect(page.elements.element('e6')).toBeUndefined()
			expect(page.elements.element('e1')).toBe(first)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'next' } },
				'session-main',
			)
			expect(page.elements.element('e1')).toBeUndefined()
			await expect(first.click()).rejects.toMatchObject({
				code: 'ELEMENT',
				context: { reason: 'GONE' },
				message: expect.stringContaining('read'),
			})
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'next', name: 'DOMContentLoaded' },
				'session-main',
			)
			await page.elements.outline()
			expect(page.elements.elements()[0]?.reference).toBe('e7')
		} finally {
			await client.close()
		}
	})

	it('catches ignoring a detached out-of-process child frame', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const main = requireValue(page.elements.element('e1'))
			const child = requireValue(page.elements.element('e6'))
			expect(child.name).toBe('Save')
			const maximum = Math.max(
				...page.elements.elements().map((element) => Number(element.reference.slice(1))),
			)
			transport.event('Page.frameDetached', { frameId: 'child', reason: 'remove' }, 'session-child')
			expect(page.elements.element('e6')).toBeUndefined()
			await expect(child.click()).rejects.toMatchObject({
				code: 'ELEMENT',
				context: { reason: 'GONE' },
			})
			expect(page.elements.element('e1')).toBe(main)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child-again',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://example.test/checkout' },
				},
				'session-main',
			)
			await waitForDelay()
			await page.elements.outline()
			const added = page.elements
				.elements()
				.filter((element) => Number(element.reference.slice(1)) > maximum)
			expect(added.map((element) => element.name)).toEqual(['Save'])
			expect(page.elements.element('e1')).toBe(main)
		} finally {
			await client.close()
		}
	})

	it('catches a retired frame session invalidating the references its replacement captured', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			const published = createRecorder<[frame: BrowserFrameInterface]>()
			page.emitter.on('session', published.handler)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child-again',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://example.test/checkout' },
				},
				'session-main',
			)
			await waitForCondition('the replacement session was published', () => published.count === 1)
			await waitForDelay()
			const captured = transport.sent.length
			await page.elements.outline()
			expect(
				transport.sent
					.slice(captured)
					.filter(
						(message) =>
							message.method === 'Accessibility.getFullAXTree' &&
							message.params?.['frameId'] === 'child',
					)
					.map((message) => message.sessionId),
			).toEqual(['session-child-again'])
			const saved = requireValue(
				page.elements.elements().find((element) => element.name === 'Save'),
			)

			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.test/stale' } },
				'session-child',
			)
			transport.event(
				'Target.detachedFromTarget',
				{ sessionId: 'session-child', targetId: 'child' },
				'session-main',
			)
			expect(page.elements.element(saved.reference)).toBe(saved)

			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.test/next' } },
				'session-child-again',
			)
			expect(page.elements.element(saved.reference)).toBeUndefined()
		} finally {
			await client.close()
		}
	})

	it('catches ignoring a detached in-process child frame', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserElements(transport, {
			accessibility: (message) =>
				transport.reply(
					message.id,
					message.params?.['frameId'] === 'child'
						? {
								nodes: [
									{
										nodeId: 'child-root',
										backendDOMNodeId: 40,
										role: { value: 'RootWebArea' },
										childIds: ['pay'],
									},
									{
										nodeId: 'pay',
										parentId: 'child-root',
										backendDOMNodeId: 41,
										role: { value: 'button' },
										name: { value: 'Pay' },
									},
								],
							}
						: BROWSER_ELEMENT_AX_FIXTURE,
				),
		})
		const page = new BrowserPage(
			client,
			'main',
			'session-main',
			undefined,
			'https://example.test/cart',
		)
		try {
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: page.url, loaderId: 'loader-main' } },
				'session-main',
			)
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'loader-main', name: 'DOMContentLoaded' },
				'session-main',
			)
			await page.elements.outline()
			const main = requireValue(page.elements.element('e1'))
			const child = requireValue(page.elements.elements().find((element) => element.name === 'Pay'))
			const maximum = Math.max(
				...page.elements.elements().map((element) => Number(element.reference.slice(1))),
			)
			transport.event('Page.frameDetached', { frameId: 'child', reason: 'remove' }, 'session-main')
			expect(page.elements.element(child.reference)).toBeUndefined()
			await expect(child.click()).rejects.toMatchObject({
				code: 'ELEMENT',
				context: { reason: 'GONE' },
			})
			expect(page.elements.element('e1')).toBe(main)
			await page.elements.outline()
			const added = page.elements
				.elements()
				.filter((element) => Number(element.reference.slice(1)) > maximum)
			expect(added.map((element) => element.name)).toEqual(['Pay'])
		} finally {
			await client.close()
		}
	})

	it('catches a per-page counter inside one browser context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(transport, 'session-1', { second: 'session-2' })
		scriptBrowserElements(transport)
		let created = 0
		transport.onSend('Target.createTarget', (message) => {
			created += 1
			transport.reply(message.id, { targetId: created === 1 ? 'first' : 'second' })
		})
		const context = new BrowserContext(client)
		try {
			const first = await context.create()
			await first.elements.outline()
			const maximum = Math.max(
				...first.elements.elements().map((element) => Number(element.reference.slice(1))),
			)
			const second = await context.create()
			await second.elements.outline()
			expect(Number(second.elements.elements()[0]?.reference.slice(1))).toBeGreaterThan(maximum)
		} finally {
			await client.close()
		}
	})

	it('catches exact-name matching and bypassing native CSS query and describe', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			expect(
				(await page.elements.find({ role: 'button', name: 'sav' })).map((element) => element.name),
			).toEqual(['Save'])
			const found = await page.elements.find({ css: '#order', within: 'e4' })
			expect(found.map((element) => element.reference)).toEqual(['e4'])
			const query = transport.sent.findIndex((message) => message.method === 'DOM.querySelectorAll')
			expect(query).toBeGreaterThan(-1)
			expect(
				transport.sent
					.slice(query + 1)
					.some(
						(message) => message.method === 'DOM.describeNode' && message.params?.['nodeId'] === 50,
					),
			).toBe(true)
		} finally {
			await client.close()
		}
	})

	it('catches early evaluation and accepting DOMContentLoaded for a different loader', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: page.url, loaderId: 'loading' } },
				'session-main',
			)
			const before = transport.sent.length
			const started = performance.now()
			const pending = page.elements.outline({ timeout: 500 })
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'stale', name: 'DOMContentLoaded' },
				'session-main',
			)
			await waitForDelay(20)
			expect(
				transport.sent.slice(before).some((message) => message.method === 'Runtime.evaluate'),
			).toBe(false)
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'loading', name: 'DOMContentLoaded' },
				'session-main',
			)
			expect((await pending).listed).toBe(6)
			expect(performance.now() - started).toBeGreaterThanOrEqual(20 - TIMER_LEAD)
		} finally {
			await client.close()
		}
	})

	it('catches a second element world and failure to recreate after contexts clear', async () => {
		const { page, transport, client } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			await requireValue(page.elements.element('e1')).click()
			await requireValue(page.elements.element('e1')).press('Enter')
			expect(
				transport.sent.filter((message) => message.method === 'Page.createIsolatedWorld'),
			).toHaveLength(1)
			expect(
				transport.sent
					.filter((message) => message.method === 'Runtime.callFunctionOn')
					.every((message) => message.params?.['executionContextId'] === 91),
			).toBe(true)
			transport.event('Runtime.executionContextsCleared', {}, 'session-main')
			await requireValue(page.elements.element('e1')).click()
			expect(
				transport.sent.filter((message) => message.method === 'Page.createIsolatedWorld'),
			).toHaveLength(2)
		} finally {
			await client.close()
		}
	})
})
