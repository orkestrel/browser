/**
 * Proof for `tests/setup.ts`.
 *
 * The subject is the exported test infrastructure the workspace's suites drive: the in-memory CDP
 * transport, the scripting helpers layered on it, the protocol fixtures, and the encoded constants.
 * Production behavior is not re-proven here — where a case sends a real frame through
 * `createCDPClient`, the client is the driver and the assertion is on what the fixture answered.
 *
 * `tests/setup.ts` is host-independent and declares no DOM-driving export, so this file defers
 * nothing to a browser suite. This package registers no browser project: `vite.config.ts` runs
 * `src:core` and `src:server` in Node with `browser: { enabled: false }`, and the `setup` project
 * that collects this file does the same.
 *
 * Every expected value is derived by a route the module does not share: hand-written protocol
 * literals, a parent-index walk over the raw snapshot columns, and `atob` over the base64 constants.
 */

import type { CDPSentMessage } from './setup.js'
import { describe, expect, it } from 'vitest'
import { BrowserPage } from '@src/core'
import { createRecorder, readProperty, requireValue } from '@orkestrel/test'
import {
	readBrowserCompiledTimers,
	createBrowserElementFixture,
	createBrowserViewDouble,
	createAttachedPage,
	createCDPTestTransport,
	createCodegenBindingPayload,
	createConnectedCDPClient,
	emitDocumentReady,
	createDOMSnapshotResult,
	createRecordingWriter,
	createStartedCodegen,
	createTarget,
	evaluateJavaScript,
	ignoreAsyncCall,
	ignoreCall,
	JPEG_BASE64,
	PNG_BASE64,
	readCDPExpression,
	readCDPParams,
	replyOk,
	scriptCDPAttach,
	scriptEvaluate,
	scriptBrowserHistory,
	scriptFrameTree,
	BROWSER_HISTORY_DIRECTIONS,
	BROWSER_HISTORY_RESTORE_CASES,
	throwListenerError,
} from './setup.js'

describe('element protocol and compiler fixtures', () => {
	it('catches a timer instrument that ignores syntax errors, intervals, or the actual delay argument', () => {
		expect(readBrowserCompiledTimers('setTimeout(() => undefined, 41)')).toEqual([
			{ name: 'setTimeout', delay: '41' },
		])
		expect(readBrowserCompiledTimers('setInterval(() => undefined, 7)')).toEqual([
			{ name: 'setInterval', delay: '7' },
		])
		expect(readBrowserCompiledTimers('setTimeout(() => undefined)')).toEqual([
			{ name: 'setTimeout', delay: undefined },
		])
		expect(() => readBrowserCompiledTimers('(')).toThrow('Unexpected')
	})

	it('catches losing the scripted iframe, overlapping backend, or frame-local quad', async () => {
		const { page, client } = await createBrowserElementFixture()
		try {
			const tree = await page.send('Accessibility.getFullAXTree', { frameId: 'main' })
			expect(readProperty(tree, 'nodes')).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ nodeId: 'link', backendDOMNodeId: 3 }),
					expect.objectContaining({
						nodeId: 'iframe',
						backendDOMNodeId: 13,
						role: { value: 'Iframe' },
					}),
				]),
			)
			const child = await page.send('Accessibility.getFullAXTree', { frameId: 'child' })
			expect(readProperty(child, 'nodes')).toEqual(
				expect.arrayContaining([expect.objectContaining({ nodeId: 'save', backendDOMNodeId: 3 })]),
			)
			expect(await page.send('DOM.getContentQuads', { backendNodeId: 3 })).toEqual({
				quads: [[10, 20, 30, 20, 30, 40, 10, 40]],
			})
		} finally {
			await client.close()
		}
	})

	it('catches a box model refusal that the failure option does not deliver', async () => {
		const refused = await createBrowserElementFixture({
			failure: { method: 'DOM.getBoxModel', message: 'No node found for given backend id' },
		})
		const answered = await createBrowserElementFixture()
		try {
			const refusal = await refused.page
				.send('DOM.getBoxModel', { backendNodeId: 13 })
				.catch((caught: unknown) => caught)
			expect(readProperty(refusal, 'message')).toBe('No node found for given backend id')
			expect(await answered.page.send('DOM.getBoxModel', { backendNodeId: 13 })).toEqual({
				model: {
					border: [220, 160, 420, 160, 420, 360, 220, 360],
					content: [230, 170, 410, 170, 410, 350, 230, 350],
				},
			})
		} finally {
			await refused.client.close()
			await answered.client.close()
		}
	})

	it('catches a fixture that answers WebMCP.enable as present or answers a withheld release or option call', async () => {
		const withheld: CDPSentMessage[] = []
		const { page, client, transport } = await createBrowserElementFixture({
			released: (message) => withheld.push(message),
			select: (message) => withheld.push(message),
		})
		try {
			const absent = await page.send('WebMCP.enable').catch((caught: unknown) => caught)
			expect(readProperty(absent, 'context')).toMatchObject({ code: -32601 })
			const pressed = page.send('Input.dispatchMouseEvent', { type: 'mousePressed' })
			await expect(pressed).resolves.toEqual({})
			const released = page.send('Input.dispatchMouseEvent', { type: 'mouseReleased' })
			const option = page.send('Runtime.callFunctionOn', {
				functionDeclaration: 'function() { return this instanceof HTMLSelectElement }',
			})
			await expect(
				page.send('Runtime.callFunctionOn', { functionDeclaration: 'function() { return 1 }' }),
			).resolves.toEqual({ result: { value: true } })
			expect(withheld.map((message) => message.method)).toEqual([
				'Input.dispatchMouseEvent',
				'Runtime.callFunctionOn',
			])
			for (const message of withheld) transport.reply(message.id, { held: message.method })
			await expect(released).resolves.toEqual({ held: 'Input.dispatchMouseEvent' })
			await expect(option).resolves.toEqual({ held: 'Runtime.callFunctionOn' })
		} finally {
			await client.close()
		}
	})

	it('catches a document-ready emission that leaves the page seeding readiness or moves its URL', async () => {
		const { client, transport } = await createConnectedCDPClient()
		try {
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			scriptEvaluate(transport, (expression) => expression.includes('outerHTML'), {
				url: 'https://example.test/',
				title: 'Ready',
				html: '<p>Ready</p>',
			})
			const page = new BrowserPage(
				client,
				'target-1',
				'session-1',
				undefined,
				'https://example.test/',
				'main-1',
			)
			emitDocumentReady(transport, page)
			expect(page.url).toBe('https://example.test/')
			expect((await page.read()).title).toBe('Ready')
			expect(transport.sent.map((message) => readCDPExpression(message))).not.toContain(
				'document.readyState',
			)
		} finally {
			await client.close()
		}
	})

	it('catches a view double that loses a call, reads another document, or waits when told to time out', async () => {
		const view = createBrowserViewDouble({
			url: 'https://example.test/cart',
			title: 'Cart',
			html: '<main><p>Two items</p></main>',
			waited: false,
		})
		expect([view.url, view.trusted, await view.title()]).toEqual([
			'https://example.test/cart',
			false,
			'Cart',
		])
		const outline = await view.elements.outline()
		expect(outline.text).toBe(
			'page "Cart" https://example.test/cart\ne1 button "Save"\ne2 textbox "Email"\ne3 combobox "Size"\n(3 of 3 elements)',
		)
		expect((await view.read()).markdown().text).toContain('Two items')
		const save = requireValue(view.elements.element('e1'))
		await save.click()
		await save.fill('x')
		await expect(save.select(['x'])).rejects.toThrow('Element is not a select control')
		await requireValue(view.elements.element('e3')).select(['Large'])
		const wait = await view.wait('Paid').catch((caught: unknown) => caught)
		expect(readProperty(wait, 'code')).toBe('BROWSER_WAIT_TIMEOUT')
		expect(view.elements.element('e9')).toBeUndefined()
		expect(view.calls).toEqual([
			'outline',
			'read',
			'click e1',
			'fill e1 x',
			'select e3 Large',
			'wait Paid',
		])
		const aborted = new AbortController()
		aborted.abort('stop')
		await expect(view.read({ signal: aborted.signal })).rejects.toBe('stop')
	})

	it('catches a fixture whose registry answer does not replace the absent-domain failure', async () => {
		const fixture = await createBrowserElementFixture({
			registry: (message) => fixture.transport.reply(message.id, { enabled: true }),
		})
		try {
			await expect(fixture.page.send('WebMCP.enable')).resolves.toEqual({ enabled: true })
		} finally {
			await fixture.client.close()
		}
	})
})

// === Fake CDP transport

describe('createCDPTestTransport', () => {
	it('decomposes a request frame into the recorded message and skips a frame carrying no request', async () => {
		const transport = createCDPTestTransport()

		await transport.send(
			JSON.stringify({
				id: 7,
				method: 'Page.navigate',
				params: { url: 'https://example.com/' },
				sessionId: 'session-9',
			}),
		)
		await transport.send(JSON.stringify({ id: 8, method: 'Page.enable' }))
		await transport.send(JSON.stringify({ method: 'Page.loadEventFired', params: {} }))
		await transport.send(JSON.stringify({ id: 9 }))
		await transport.send(JSON.stringify([1, 2, 3]))

		expect(transport.sent).toStrictEqual([
			{
				id: 7,
				method: 'Page.navigate',
				params: { url: 'https://example.com/' },
				sessionId: 'session-9',
			},
			{ id: 8, method: 'Page.enable', params: undefined, sessionId: undefined },
		])
	})

	it('reports started and closed across the transport lifecycle', async () => {
		const transport = createCDPTestTransport()

		expect([transport.started, transport.closed]).toStrictEqual([false, false])

		await transport.start()
		expect([transport.started, transport.closed]).toStrictEqual([true, false])

		await transport.close()
		expect([transport.started, transport.closed]).toStrictEqual([false, true])

		await transport.start()
		expect([transport.started, transport.closed]).toStrictEqual([true, false])
	})

	it('invokes every handler registered for the sent method in registration order and no other', async () => {
		const transport = createCDPTestTransport()
		const order: string[] = []

		transport.onSend('Page.enable', () => order.push('enable-first'))
		transport.onSend('Page.enable', () => order.push('enable-second'))
		transport.onSend('Page.close', () => order.push('close'))

		await transport.send(JSON.stringify({ id: 1, method: 'Page.enable' }))

		expect(order).toStrictEqual(['enable-first', 'enable-second'])
	})

	it('hands the sent message to its handler', async () => {
		const transport = createCDPTestTransport()
		const recorder = createRecorder<readonly [CDPSentMessage]>()

		transport.onSend('Runtime.evaluate', recorder.handler)
		await transport.send(
			JSON.stringify({
				id: 4,
				method: 'Runtime.evaluate',
				params: { expression: 'document.title' },
				sessionId: 'session-2',
			}),
		)

		expect(recorder.calls).toStrictEqual([
			[
				{
					id: 4,
					method: 'Runtime.evaluate',
					params: { expression: 'document.title' },
					sessionId: 'session-2',
				},
			],
		])
	})

	it('correlates a reply and a failure to the request identifier', () => {
		const transport = createCDPTestTransport()
		const messages = createRecorder<readonly [string]>()
		transport.emitter.on('message', messages.handler)

		transport.reply(3, { ok: true })
		transport.fail(4, 'boom')

		const frames: unknown[] = messages.calls.map(([text]) => JSON.parse(text))
		expect(frames).toStrictEqual([
			{ id: 3, result: { ok: true } },
			{ id: 4, error: { message: 'boom' } },
		])
	})

	it('frames an event with defaulted parameters and an optional session', () => {
		const transport = createCDPTestTransport()
		const messages = createRecorder<readonly [string]>()
		transport.emitter.on('message', messages.handler)

		transport.event('Page.loadEventFired')
		transport.event(
			'Target.attachedToTarget',
			{ targetInfo: { targetId: 'target-1' } },
			'session-1',
		)

		const frames: unknown[] = messages.calls.map(([text]) => JSON.parse(text))
		expect(frames).toStrictEqual([
			{ method: 'Page.loadEventFired', params: {} },
			{
				method: 'Target.attachedToTarget',
				params: { targetInfo: { targetId: 'target-1' } },
				sessionId: 'session-1',
			},
		])
	})

	it('delivers a remote close and a remote error to the transport emitter', () => {
		const transport = createCDPTestTransport()
		const closes = createRecorder<readonly []>()
		const errors = createRecorder<readonly [unknown]>()
		transport.emitter.on('close', closes.handler)
		transport.emitter.on('error', errors.handler)
		const failure = new Error('socket died')

		transport.closeRemote()
		transport.errorRemote(failure)

		expect(closes.calls).toStrictEqual([[]])
		expect(errors.calls).toStrictEqual([[failure]])
	})
})

// === Connected client fixture

describe('createConnectedCDPClient', () => {
	it('returns a started transport and a connected client whose sends reach the recorder', async () => {
		const { client, transport } = await createConnectedCDPClient()

		expect([client.connected, transport.started]).toStrictEqual([true, true])

		replyOk(transport, 'Browser.getVersion', { product: 'Test/1.0' })
		await expect(client.send('Browser.getVersion')).resolves.toStrictEqual({ product: 'Test/1.0' })
		expect(transport.sent.map((message) => message.method)).toStrictEqual(['Browser.getVersion'])
	})
})

describe('createAttachedPage', () => {
	it('returns a page bound to the named session and defaults it to session-1', async () => {
		const named = await createAttachedPage('session-5')
		replyOk(named.transport, 'Runtime.evaluate', { result: { value: 3 } })

		await named.page.evaluate('1 + 2')
		expect(readCDPParams(named.transport, 'Runtime.evaluate')).toHaveLength(1)
		expect(
			named.transport.sent.filter((message) => message.method === 'Runtime.evaluate')[0]?.sessionId,
		).toBe('session-5')

		const defaulted = await createAttachedPage()
		replyOk(defaulted.transport, 'Runtime.evaluate', { result: { value: 3 } })
		await defaulted.page.evaluate('1 + 2')
		expect(
			defaulted.transport.sent.filter((message) => message.method === 'Runtime.evaluate')[0]
				?.sessionId,
		).toBe('session-1')
	})
})

describe('readCDPParams', () => {
	it('collects the params of every matching frame in send order and reports an absent record as empty', async () => {
		const transport = createCDPTestTransport()

		await transport.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'a' } }))
		await transport.send(JSON.stringify({ id: 2, method: 'Page.enable' }))
		await transport.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: 'b' } }))

		expect(readCDPParams(transport, 'Page.navigate')).toStrictEqual([{ url: 'a' }, { url: 'b' }])
		expect(readCDPParams(transport, 'Page.enable')).toStrictEqual([{}])
		expect(readCDPParams(transport, 'Page.close')).toStrictEqual([])
	})
})

describe('replyOk', () => {
	it('answers every send of the scripted method with an empty result and leaves another method unanswered', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.enable')

		await expect(client.send('Page.enable')).resolves.toStrictEqual({})
		await expect(client.send('Page.enable')).resolves.toStrictEqual({})
		await expect(client.send('Page.close', undefined, { timeout: 50 })).rejects.toThrow(
			'CDP request timed out: Page.close',
		)

		expect(transport.sent.map((message) => message.method)).toStrictEqual([
			'Page.enable',
			'Page.enable',
			'Page.close',
		])
	})
})

describe('scriptCDPAttach', () => {
	it('answers the attach handshake for the named session and defaults it to session-1', async () => {
		const named = await createConnectedCDPClient()
		scriptCDPAttach(named.transport, 'session-7')

		await expect(
			named.client.send('Target.attachToTarget', { targetId: 'target-1', flatten: true }),
		).resolves.toStrictEqual({ sessionId: 'session-7' })
		await expect(
			named.client.send('Page.enable', undefined, { session: 'session-7' }),
		).resolves.toStrictEqual({})
		await expect(
			named.client.send('Runtime.enable', undefined, { session: 'session-7' }),
		).resolves.toStrictEqual({})
		await expect(
			named.client.send('Page.getFrameTree', undefined, { session: 'session-7' }),
		).resolves.toStrictEqual({
			frameTree: { frame: { id: 'frame-session-7', url: 'about:blank' } },
		})

		const defaulted = await createConnectedCDPClient()
		scriptCDPAttach(defaulted.transport)

		await expect(
			defaulted.client.send('Target.attachToTarget', { targetId: 'target-1' }),
		).resolves.toStrictEqual({ sessionId: 'session-1' })
	})

	it('answers discovery, an attach to a mapped target with its own session, and that session with its own frame, and refuses a frame tree off every announced session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(transport, 'session-1', { popup: 'popup-session' })

		await expect(
			client.send('Target.setDiscoverTargets', { discover: true }),
		).resolves.toStrictEqual({})
		await expect(
			client.send('Target.attachToTarget', { targetId: 'popup', flatten: true }),
		).resolves.toStrictEqual({ sessionId: 'popup-session' })
		await expect(
			client.send('Target.attachToTarget', { targetId: 'other', flatten: true }),
		).resolves.toStrictEqual({ sessionId: 'session-1' })
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'popup-session' }),
		).resolves.toStrictEqual({
			frameTree: { frame: { id: 'frame-popup-session', url: 'about:blank' } },
		})
		await expect(client.send('Page.getFrameTree')).rejects.toMatchObject({
			message: "'Page.getFrameTree' wasn't found",
		})
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'unknown-session' }),
		).rejects.toMatchObject({ message: 'Session with given id not found.' })
		transport.event('Target.attachedToTarget', { sessionId: 'child-session' }, 'session-1')
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'child-session' }),
		).resolves.toStrictEqual({
			frameTree: { frame: { id: 'frame-child-session', url: 'about:blank' } },
		})
		transport.event('Target.detachedFromTarget', { sessionId: 'child-session' }, 'session-1')
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'child-session' }),
		).rejects.toMatchObject({ message: 'Session with given id not found.' })
	})

	it('admits no session from an attach reply that arrives after its connection ended', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(
			transport,
			'session-1',
			undefined,
			(message) => message.method === 'Target.attachToTarget',
		)
		const attaching = client.send('Target.attachToTarget', { targetId: 'target-1' })
		const refused = attaching.catch((error: unknown) => error)
		const request = requireValue(
			transport.sent.find((message) => message.method === 'Target.attachToTarget'),
			'attach request',
		)
		transport.closeRemote()
		expect(readProperty(await refused, 'message')).toBe('CDP connection closed')
		await client.connect()
		transport.reply(request.id, { sessionId: 'stale-session' })

		expect([...transport.sessions]).toEqual([])
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'stale-session' }),
		).rejects.toMatchObject({ message: 'Session with given id not found.' })
	})

	it('admits no session from a success reply that follows an error reply for one attach request', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(
			transport,
			'session-1',
			undefined,
			(message) => message.method === 'Target.attachToTarget',
		)
		const attaching = client.send('Target.attachToTarget', { targetId: 'target-1' })
		const request = requireValue(
			transport.sent.find((message) => message.method === 'Target.attachToTarget'),
			'attach request',
		)
		transport.fail(request.id, 'No target with given id found')
		await expect(attaching).rejects.toMatchObject({ message: 'No target with given id found' })
		transport.reply(request.id, { sessionId: 'late-session' })

		expect([...transport.sessions]).toEqual([])
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'late-session' }),
		).rejects.toMatchObject({ message: 'Session with given id not found.' })
	})

	it('admits only the first reply to an attach request and forgets every session when the connection ends', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(transport)
		transport.onSend('Target.getTargetInfo', (message) =>
			transport.reply(message.id, { sessionId: 'unrelated-session' }),
		)
		const attached = await client.send('Target.attachToTarget', { targetId: 'target-1' })
		const request = requireValue(
			transport.sent.find((message) => message.method === 'Target.attachToTarget'),
			'attach request',
		)
		transport.reply(request.id, { sessionId: 'late-session' })
		await client.send('Target.getTargetInfo')
		transport.event('Target.attachedToTarget', { sessionId: 'child-session' }, 'session-1')

		expect(attached).toStrictEqual({ sessionId: 'session-1' })
		expect([...transport.sessions]).toEqual(['session-1', 'child-session'])
		await client.reconnect()
		expect([...transport.sessions]).toEqual([])
		await expect(
			client.send('Page.getFrameTree', undefined, { session: 'session-1' }),
		).rejects.toMatchObject({ message: 'Session with given id not found.' })
		transport.event('Target.attachedToTarget', { sessionId: 'child-session' }, 'session-1')
		transport.closeRemote()
		expect([...transport.sessions]).toEqual([])
	})

	it('leaves a withheld message unanswered for the test to answer', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const held: CDPSentMessage[] = []
		scriptCDPAttach(transport, 'session-1', undefined, (message) => {
			if (message.sessionId !== 'session-1') return false
			held.push(message)
			return true
		})

		const enabled = client.send('Page.enable', undefined, { session: 'session-1' })
		await expect(client.send('Page.enable', undefined, { session: 'session-2' })).resolves.toEqual(
			{},
		)
		expect(held.map((message) => message.method)).toEqual(['Page.enable'])
		transport.reply(requireValue(held[0], 'held').id, { answered: true })
		await expect(enabled).resolves.toEqual({ answered: true })
	})
})

// === Expression scripting

describe('readCDPExpression', () => {
	it('reads a string expression and refuses a missing message, absent parameters, or a non-string', () => {
		expect(
			readCDPExpression({
				id: 1,
				method: 'Runtime.evaluate',
				params: { expression: 'document.title' },
				sessionId: undefined,
			}),
		).toBe('document.title')
		expect(readCDPExpression(undefined)).toBeUndefined()
		expect(
			readCDPExpression({
				id: 2,
				method: 'Page.enable',
				params: undefined,
				sessionId: undefined,
			}),
		).toBeUndefined()
		expect(
			readCDPExpression({
				id: 3,
				method: 'Runtime.evaluate',
				params: { expression: 42 },
				sessionId: undefined,
			}),
		).toBeUndefined()
	})
})

describe('scriptEvaluate', () => {
	it('wraps the value as a remote object only when the predicate accepts the expression', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(transport, (expression) => expression.includes('window.name'), 'orkestrel')

		await expect(
			client.send('Runtime.evaluate', { expression: 'window.name' }),
		).resolves.toStrictEqual({ result: { value: 'orkestrel' } })
		await expect(
			client.send('Runtime.evaluate', { expression: 'document.title' }, { timeout: 50 }),
		).rejects.toThrow('CDP request timed out: Runtime.evaluate')
	})
})

describe('scriptBrowserHistory', () => {
	it('answers the two-entry history at the requested index', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 1)

		expect(await client.send('Page.getNavigationHistory')).toStrictEqual({
			currentIndex: 1,
			entries: [
				{ id: 1, url: 'https://example.com/form' },
				{ id: 2, url: 'https://example.com/article' },
			],
		})
	})
})

describe('history case matrices', () => {
	it('lists both directions and pairs each with the index that has its target and the URL it restores', () => {
		expect(BROWSER_HISTORY_DIRECTIONS).toStrictEqual(['back', 'forward'])
		expect(BROWSER_HISTORY_RESTORE_CASES).toStrictEqual([
			['back', 1, 'https://example.com/form'],
			['forward', 0, 'https://example.com/article'],
		])
	})
})

describe('scriptFrameTree', () => {
	it('answers a three-level tree whose child frames name their parent and carry their own URL', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)

		const tree = await client.send('Page.getFrameTree')
		const root = readProperty<Readonly<Record<string, unknown>>>(tree, 'frameTree')
		const main = readProperty<Readonly<Record<string, unknown>>>(root, 'frame')
		const children = readProperty<ReadonlyArray<Readonly<Record<string, unknown>>>>(
			root,
			'childFrames',
		)
		const child = requireValue(children[0], 'The frame tree fixture carries no child frame')
		const childFrame = readProperty<Readonly<Record<string, unknown>>>(child, 'frame')
		const grandchildren = readProperty<ReadonlyArray<Readonly<Record<string, unknown>>>>(
			child,
			'childFrames',
		)
		const grandchild = requireValue(
			grandchildren[0],
			'The frame tree fixture carries no grandchild frame',
		)
		const grandchildFrame = readProperty<Readonly<Record<string, unknown>>>(grandchild, 'frame')

		expect(main).toStrictEqual({ id: 'main-1', url: 'https://example.com/' })
		expect(childFrame['parentId']).toBe(main['id'])
		expect(grandchildFrame['parentId']).toBe(childFrame['id'])
		expect([childFrame['url'], grandchildFrame['url']]).toStrictEqual([
			'https://example.com/child',
			'https://example.com/grandchild',
		])
		expect([childFrame['name'], grandchildFrame['name']]).toStrictEqual(['child-frame', ''])
	})

	it('answers a named frame session with its own root and every other session with the page tree', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(
			transport,
			new Map([['session-oopif', { id: 'oopif-7', url: 'https://other.example/embed' }]]),
		)

		const own = await client.send('Page.getFrameTree', undefined, { session: 'session-oopif' })
		const page = await client.send('Page.getFrameTree', undefined, { session: 'session-1' })
		const bare = await client.send('Page.getFrameTree')

		expect(own).toStrictEqual({
			frameTree: { frame: { id: 'oopif-7', url: 'https://other.example/embed' } },
		})
		for (const tree of [page, bare])
			expect(
				readProperty(readProperty<Readonly<Record<string, unknown>>>(tree, 'frameTree'), 'frame'),
			).toStrictEqual({ id: 'main-1', url: 'https://example.com/' })
	})
})

// === Codegen fixtures

describe('createStartedCodegen', () => {
	it('returns a codegen already started over the scripted binding handshake for its session', async () => {
		const { codegen, transport } = await createStartedCodegen('session-4')

		expect(codegen.started).toBe(true)
		expect(transport.sent.map((message) => message.method)).toContain('Runtime.addBinding')
		expect(transport.sent.map((message) => message.method)).toContain(
			'Page.addScriptToEvaluateOnNewDocument',
		)
		expect(transport.sent.every((message) => message.sessionId === 'session-4')).toBe(true)
	})

	it('scripts the binding removal so stop() resolves on the started fixture', async () => {
		const { codegen } = await createStartedCodegen()

		await expect(codegen.stop()).resolves.toEqual([])
		expect(codegen.started).toBe(false)
	})
})

describe('createCodegenBindingPayload', () => {
	it('names the binding the started codegen registered and carries the record as JSON text', async () => {
		const { transport } = await createStartedCodegen()
		const binding = requireValue(
			transport.sent.find((message) => message.method === 'Runtime.addBinding'),
			'The started codegen registered no binding',
		)

		const payload = createCodegenBindingPayload({ action: 'click', selector: '#btn' })

		expect(payload['name']).toBe(binding.params?.['name'])
		expect(payload['payload']).toBe('{"action":"click","selector":"#btn"}')
	})
})

// === Protocol fixtures

describe('createTarget', () => {
	it('builds a page target and replaces only the overridden fields', () => {
		expect(createTarget()).toStrictEqual({
			id: 'target-1',
			category: 'page',
			title: 'Test Page',
			url: 'about:blank',
		})
		expect(createTarget({ id: 'target-2', url: 'https://example.com/' })).toStrictEqual({
			id: 'target-2',
			category: 'page',
			title: 'Test Page',
			url: 'https://example.com/',
		})
	})
})

describe('createDOMSnapshotResult', () => {
	it('keeps every node column parallel and resolves each name inside the string table', () => {
		const snapshot = createDOMSnapshotResult()
		const strings = readProperty<readonly string[]>(snapshot, 'strings')
		const documents = readProperty<ReadonlyArray<Readonly<Record<string, unknown>>>>(
			snapshot,
			'documents',
		)
		const main = requireValue(documents[0], 'The snapshot fixture carries no main document')
		const nodes = readProperty<Readonly<Record<string, unknown>>>(main, 'nodes')
		const parentIndex = readProperty<readonly number[]>(nodes, 'parentIndex')
		const columns = ['nodeType', 'nodeName', 'nodeValue', 'backendNodeId', 'attributes']

		for (const column of columns) {
			expect(readProperty<readonly unknown[]>(nodes, column)).toHaveLength(parentIndex.length)
		}
		for (const index of readProperty<readonly number[]>(nodes, 'nodeName')) {
			expect(strings[index]).toEqual(expect.any(String))
		}

		const layout = readProperty<Readonly<Record<string, unknown>>>(main, 'layout')
		const nodeIndex = readProperty<readonly number[]>(layout, 'nodeIndex')
		for (const column of [
			'styles',
			'bounds',
			'text',
			'paintOrders',
			'offsetRects',
			'clientRects',
		]) {
			expect(readProperty<readonly unknown[]>(layout, column)).toHaveLength(nodeIndex.length)
		}
	})

	it('walks the main document ancestors the snapshot suites resolve', () => {
		const snapshot = createDOMSnapshotResult()
		const strings = readProperty<readonly string[]>(snapshot, 'strings')
		const documents = readProperty<ReadonlyArray<Readonly<Record<string, unknown>>>>(
			snapshot,
			'documents',
		)
		const main = requireValue(documents[0], 'The snapshot fixture carries no main document')
		const nodes = readProperty<Readonly<Record<string, unknown>>>(main, 'nodes')
		const parentIndex = readProperty<readonly number[]>(nodes, 'parentIndex')
		const nodeName = readProperty<readonly number[]>(nodes, 'nodeName')

		const walked: string[] = []
		let cursor = 3
		while (cursor >= 0) {
			walked.push(requireValue(strings[requireValue(nodeName[cursor])]))
			cursor = requireValue(parentIndex[cursor])
		}

		expect(walked).toStrictEqual(['DIV', 'BODY', 'HTML', '#document'])
	})

	it('links the iframe node to the child document it names as its source', () => {
		const snapshot = createDOMSnapshotResult()
		const strings = readProperty<readonly string[]>(snapshot, 'strings')
		const documents = readProperty<ReadonlyArray<Readonly<Record<string, unknown>>>>(
			snapshot,
			'documents',
		)
		const main = requireValue(documents[0], 'The snapshot fixture carries no main document')
		const nodes = readProperty<Readonly<Record<string, unknown>>>(main, 'nodes')
		const content = readProperty<Readonly<Record<string, readonly number[]>>>(
			nodes,
			'contentDocumentIndex',
		)
		const source = readProperty<Readonly<Record<string, readonly number[]>>>(
			nodes,
			'currentSourceURL',
		)
		const nodeName = readProperty<readonly number[]>(nodes, 'nodeName')

		const iframe = requireValue(content['index']?.[0], 'The snapshot fixture links no document')
		const linked = requireValue(content['value']?.[0], 'The snapshot fixture links no document')
		const child = requireValue(documents[linked], 'The linked document is absent')

		expect(strings[requireValue(nodeName[iframe])]).toBe('IFRAME')
		expect(source['index']?.[0]).toBe(iframe)
		expect(strings[requireValue(source['value']?.[0])]).toBe(
			strings[readProperty<number>(child, 'documentURL')],
		)
	})
})

// === Screenshot writer and encoded constants

describe('createRecordingWriter', () => {
	it('records the path and the exact bytes of every write in call order', async () => {
		const writer = createRecordingWriter()
		const first = Uint8Array.from([1, 2, 3])
		const second = Uint8Array.from([4])

		await writer.write('shot.png', first)
		await writer.write('other.png', second)

		expect(writer.calls.map((call) => call.path)).toStrictEqual(['shot.png', 'other.png'])
		expect(writer.calls[0]?.data).toBe(first)
		expect(writer.calls[1]?.data).toBe(second)
	})
})

describe('image constants', () => {
	it('decodes to the PNG and JPEG signature bytes the suites assert against', () => {
		expect(Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0))).toStrictEqual([
			137, 80, 78, 71, 13,
		])
		expect(Array.from(atob(JPEG_BASE64), (character) => character.charCodeAt(0))).toStrictEqual([
			255, 216, 255, 224,
		])
	})
})

// === Callback fixtures

describe('evaluateJavaScript', () => {
	it('returns the value of an expression fixture and surfaces a thrown or unparsable one', () => {
		expect(evaluateJavaScript('1 + 1')).toBe(2)
		expect(evaluateJavaScript('({ id: "hero", items: [1, 2] })')).toStrictEqual({
			id: 'hero',
			items: [1, 2],
		})
		expect(() => evaluateJavaScript('(() => { throw new Error("fixture failed") })()')).toThrow(
			'fixture failed',
		)
		expect(() => evaluateJavaScript('function(')).toThrow('Unexpected token')
	})
})

describe('listener fixtures', () => {
	it('supplies an inert synchronous stub, an inert asynchronous stub, and a stable failing listener', async () => {
		expect(ignoreCall()).toBeUndefined()
		await expect(ignoreAsyncCall()).resolves.toBeUndefined()
		expect(throwListenerError).toThrow('listener failed')
	})
})
