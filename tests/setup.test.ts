/**
 * Proof for `tests/setup.ts`.
 *
 * The subject is the exported test infrastructure the workspace's suites drive: the in-memory CDP
 * transport, the scripting helpers layered on it, the protocol fixtures, the encoded constants,
 * and the rewrite that records a generated journey module's actions.
 * Production behavior is not re-proven here — where a case sends a real frame through
 * `createCDPClient`, the client is the driver and the assertion is on what the fixture answered.
 *
 * `tests/setup.ts` is host-independent and declares no DOM-driving export, so this file defers
 * nothing to a browser suite. This package registers no browser project: `vite.config.ts` runs
 * `src:core` and `src:server` in Node with `browser: { enabled: false }`, and the `setup` project
 * that collects this file does the same.
 *
 * Every expected value is derived by a route the module does not share: hand-written protocol
 * literals, a parent-index walk over the raw snapshot columns, `atob` over the base64 constants, and
 * hand-written module lines.
 */

import type { BrowserPageInterface } from '@src/core'
import type { CDPSentMessage } from './setup.js'
import { describe, expect, it } from 'vitest'
import {
	BrowserPage,
	compileGuardedEvaluateExpression,
	compileSubmitObserverExpression,
	compileSubmitReadExpression,
} from '@src/core'
import {
	captureError,
	createRecorder,
	readProperty,
	requireValue,
	waitForCondition,
} from '@orkestrel/test'
import {
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_FRAMED_FIXTURE,
	BROWSER_RECORD_PARENTS,
	BROWSER_PENDING_REQUEST_CASES,
	BROWSER_SUBMIT_EARLY_CASES,
	BROWSER_SUBMIT_NEGATIVE_CASES,
	BROWSER_SUBMIT_FOCUS_CASES,
	BROWSER_SUBMIT_FOCUS_STEPS,
	BROWSER_SUBMIT_MALFORMED_READS,
	BROWSER_SUBMIT_UNREAD_CASES,
	BrowserSubmitElement,
	BrowserSubmitWindow,
	BrowserSubmitWindows,
	RecordingCDPClient,
	answerBrowserEvaluation,
	attachBrowserElementChild,
	buildBrowserElementTree,
	emitBrowserNavigation,
	evaluateBrowserSubmit,
	matchesBrowserSubmitObserver,
	matchesBrowserSubmitRead,
	openBrowserNavigationRecord,
	readBrowserSubmitToken,
	scriptBrowserElements,
	readBrowserCompiledTimers,
	createBrowserElementFixture,
	createBrowserViewDouble,
	createAttachedPage,
	createDiscoveringPage,
	emitBrowserWindowOpen,
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
	readCDPSessionMethods,
	createReferenceSequence,
	replyOk,
	scriptCDPAttach,
	scriptEvaluate,
	scriptBrowserHistory,
	scriptFrameTree,
	BROWSER_HISTORY_DIRECTIONS,
	BROWSER_HISTORY_RESTORE_CASES,
	throwListenerError,
	BROWSER_JOURNEY_MODULE_JAVASCRIPT,
	instrumentBrowserJourneyModule,
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

	it('holds the page target with held, so a second holder is refused, and holds none without it', async () => {
		const held = await createBrowserElementFixture({ held: true })
		const free = await createBrowserElementFixture()
		try {
			const refusals = [held, free].map((fixture) =>
				captureError(
					() =>
						new BrowserPage(
							fixture.recording,
							'main',
							'session-other',
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							createReferenceSequence(),
						),
				),
			)

			expect(refusals[0]).toMatchObject({ code: 'BROWSER_TARGET_HELD' })
			expect(refusals[1]).toBeUndefined()
		} finally {
			await held.client.close()
			await free.client.close()
		}
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

	it('catches a fixture that answers WebMCP.enable as present or answers a withheld release, option, or text call', async () => {
		const withheld: CDPSentMessage[] = []
		const { page, client, transport } = await createBrowserElementFixture({
			released: (message) => withheld.push(message),
			select: (message) => withheld.push(message),
			text: (message) => withheld.push(message),
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
			const text = page.send('Runtime.callFunctionOn', {
				functionDeclaration: 'function() { this.select() }',
			})
			await expect(
				page.send('Runtime.callFunctionOn', { functionDeclaration: 'function() { return 1 }' }),
			).resolves.toEqual({ result: { value: true } })
			expect(withheld.map((message) => message.method)).toEqual([
				'Input.dispatchMouseEvent',
				'Runtime.callFunctionOn',
				'Runtime.callFunctionOn',
			])
			for (const message of withheld) transport.reply(message.id, { held: message.id })
			await expect(released).resolves.toEqual({ held: withheld[0]?.id })
			await expect(option).resolves.toEqual({ held: withheld[1]?.id })
			await expect(text).resolves.toEqual({ held: withheld[2]?.id })
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

describe('createDiscoveringPage', () => {
	it('returns a page that attaches a popup discovery names it the opener of on popup-session, unlike a page constructed without a reference', async () => {
		const report = {
			targetInfo: {
				targetId: 'popup-1',
				type: 'page',
				url: '',
				attached: false,
				openerId: 'target-1',
				browserContextId: 'default',
			},
		}
		const discovering = await createDiscoveringPage()
		const direct = await createAttachedPage()
		try {
			const popups = createRecorder<[page: BrowserPageInterface]>()
			discovering.page.emitter.on('popup', popups.handler)
			discovering.transport.event('Target.targetCreated', report)
			direct.transport.event('Target.targetCreated', report)
			await waitForCondition('the discovering page emits its popup', () => popups.count === 1)

			expect(popups.calls[0]?.[0]).toMatchObject({ target: 'popup-1', opener: discovering.page })
			expect(
				discovering.transport.sent
					.filter((message) => message.method === 'Page.enable')
					.map((message) => message.sessionId),
			).toStrictEqual(['popup-session'])
			expect(direct.transport.sent.map((message) => message.method)).not.toContain(
				'Target.attachToTarget',
			)
		} finally {
			await discovering.client.close()
			await direct.client.close()
		}
	})

	it('leaves a message the withheld predicate names unanswered', async () => {
		const { client, transport } = await createDiscoveringPage(
			(message) => message.method === 'Target.attachToTarget',
		)
		try {
			let answered = false
			void client.send('Target.attachToTarget', { targetId: 'popup-1', flatten: true }).then(
				() => (answered = true),
				() => undefined,
			)
			const enabled = client.send('Page.enable', undefined, { session: 'session-1' })

			await expect(enabled).resolves.toStrictEqual({})
			expect(transport.sent.map((message) => message.method)).toContain('Target.attachToTarget')
			expect(answered).toBe(false)
		} finally {
			await client.close()
		}
	})
})

describe('emitBrowserWindowOpen', () => {
	it('reports Page.windowOpen on the named session with the address, defaulting it', async () => {
		const { client, transport } = await createConnectedCDPClient()
		try {
			const opened = createRecorder<[params: Readonly<Record<string, unknown>>]>()
			client.subscribe('Page.windowOpen', opened.handler, 'session-7')
			emitBrowserWindowOpen(transport, 'session-7', 'https://example.test/details')
			emitBrowserWindowOpen(transport, 'session-7')
			emitBrowserWindowOpen(transport, 'session-8')

			expect(opened.calls.map(([params]) => params)).toStrictEqual([
				{
					url: 'https://example.test/details',
					windowName: '',
					windowFeatures: [],
					userGesture: true,
				},
				{ url: 'https://example.com/popup', windowName: '', windowFeatures: [], userGesture: true },
			])
		} finally {
			await client.close()
		}
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

describe('createReferenceSequence', () => {
	it('advances each provider by one per call and keeps two providers independent', () => {
		const first = createReferenceSequence()
		const second = createReferenceSequence()

		expect([first(), first(), second(), first(), second()]).toStrictEqual([
			'e1',
			'e2',
			'e1',
			'e3',
			'e2',
		])
	})
})

describe('readCDPSessionMethods', () => {
	it('lists the methods sent on a session and those naming it, in send order, and nothing for another session', async () => {
		const transport = createCDPTestTransport()

		await transport.send(
			JSON.stringify({ id: 1, method: 'Page.enable', sessionId: 'session-child' }),
		)
		await transport.send(
			JSON.stringify({ id: 2, method: 'Page.enable', sessionId: 'session-main' }),
		)
		await transport.send(
			JSON.stringify({
				id: 3,
				method: 'Target.detachFromTarget',
				params: { sessionId: 'session-child' },
				sessionId: 'session-main',
			}),
		)

		expect(readCDPSessionMethods(transport, 'session-child')).toStrictEqual([
			'Page.enable',
			'Target.detachFromTarget',
		])
		expect(readCDPSessionMethods(transport, 'session-other')).toStrictEqual([])
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
			named.client.send('Runtime.runIfWaitingForDebugger', undefined, { session: 'session-7' }),
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

describe('submit observer fixtures', () => {
	it('answers an attribute from its record and null for one it lacks', () => {
		const element = new BrowserSubmitElement({ target: '_top' })
		expect(element.getAttribute('target')).toBe('_top')
		expect(element.getAttribute('method')).toBeNull()
	})

	it('registers submit listeners only, honours the once option, dispatches inert events, and answers a base target', () => {
		const window = new BrowserSubmitWindow('results')
		const seen = createRecorder<[event: unknown]>()
		window.addEventListener('click', seen.handler)
		window.addEventListener('submit', seen.handler)
		window.addEventListener('submit', ignoreCall, { once: true })
		expect(window.listeners).toBe(2)
		window.dispatch({
			prevented: true,
			form: { method: 'post' },
			submitter: { formtarget: '_top' },
		})
		expect(window.listeners).toBe(1)
		const [event] = requireValue(seen.calls[0])
		expect(readProperty(event, 'defaultPrevented')).toBe(true)
		expect(readProperty(event, 'submitter')).toBeInstanceOf(BrowserSubmitElement)
		window.removeEventListener('submit', seen.handler)
		expect(window.listeners).toBe(0)
		expect(window.querySelector('base[target]')?.getAttribute('target')).toBe('results')
		expect(new BrowserSubmitWindow().querySelector('base[target]')).toBeNull()
	})

	it('sends a key to the capture listeners, the focused element, and the bubbling listeners in that order, and sends none from an iframe or without a focus', () => {
		const window = new BrowserSubmitWindow()
		const seen: Array<readonly [phase: string, key: unknown, target: unknown, focus: unknown]> = []
		window.addEventListener(
			'keydown',
			(event: unknown) =>
				seen.push([
					'bubble',
					readProperty(event, 'key'),
					readProperty(readProperty(event, 'target'), 'localName'),
					window.activeElement?.localName,
				]),
			false,
		)
		window.addEventListener(
			'keydown',
			(event: unknown) =>
				seen.push([
					'capture',
					readProperty(event, 'key'),
					readProperty(readProperty(event, 'target'), 'localName'),
					window.activeElement?.localName,
				]),
			{ capture: true },
		)
		expect(window.listeners).toBe(2)
		window.press('Enter')
		expect(seen).toEqual([])
		window.focus({
			name: 'input',
			form: { method: 'post' },
			moves: { name: 'textarea', form: { method: 'get' } },
		})
		window.press('Enter')
		expect(seen).toEqual([
			['capture', 'Enter', 'input', 'input'],
			['bubble', 'Enter', 'input', 'textarea'],
		])
		expect(window.evaluate('document.activeElement.localName')).toBe('textarea')
		expect(window.activeElement?.form?.getAttribute('method')).toBe('get')
		window.focus({ name: 'iframe' })
		window.press('Enter')
		window.focus()
		window.press('Enter')
		expect(seen).toHaveLength(2)
		expect(window.activeElement).toBeNull()
	})

	it('keeps one registration per type, listener, and capture flag, and removes only the matching one', () => {
		const window = new BrowserSubmitWindow()
		const keys = createRecorder<[event: unknown]>()
		window.addEventListener('keydown', keys.handler, true)
		window.addEventListener('keydown', keys.handler, { capture: true })
		window.addEventListener('keydown', keys.handler)
		expect(window.listeners).toBe(2)
		window.removeEventListener('keydown', keys.handler)
		expect(window.listeners).toBe(1)
		window.focus({ name: 'input', form: {} })
		window.press('Enter')
		expect(keys.count).toBe(1)
		window.removeEventListener('keydown', keys.handler, true)
		expect(window.listeners).toBe(0)
	})

	it('presses a key in every window it holds', () => {
		const windows = new BrowserSubmitWindows()
		const main = createRecorder<[event: unknown]>()
		const child = createRecorder<[event: unknown]>()
		windows.window('session-main', 91).addEventListener('keydown', main.handler)
		windows.window('session-child', 92).addEventListener('keydown', child.handler)
		windows.window('session-main', 91).focus({ name: 'iframe' })
		windows.window('session-child', 92).focus({ name: 'input', form: {} })
		windows.press('Enter')
		expect([main.count, child.count]).toEqual([0, 1])
	})

	it('holds the pending-request cases, focus steps, focus cases, early-navigation cases, negative-read cases, unread cases, and malformed reads the submit proofs register', () => {
		expect(BROWSER_SUBMIT_FOCUS_STEPS).toHaveLength(9)
		for (const [label, main, child, tool, args, line] of BROWSER_SUBMIT_FOCUS_STEPS) {
			expect(label).not.toBe('')
			expect([main, child].every((focus) => focus === undefined || focus.name !== '')).toBe(true)
			expect(['type', 'press', 'click']).toContain(tool)
			expect(Object.keys(args).length).toBeGreaterThan(0)
			expect(line).toMatch(/^(?:Typed|Pressed|Clicked) .+\.$/)
		}
		expect(BROWSER_SUBMIT_FOCUS_CASES).toHaveLength(8)
		expect(BROWSER_SUBMIT_FOCUS_CASES.filter(([, , , implicit]) => implicit)).toHaveLength(2)
		expect(BROWSER_SUBMIT_EARLY_CASES.map(([, , reason, clause]) => [reason, clause])).toEqual([
			['formSubmissionPost', 'and submitted the form'],
			['anchorClick', 'and pressed Enter'],
			['formSubmissionPost', 'and pressed Enter'],
		])
		expect(BROWSER_SUBMIT_EARLY_CASES[2]?.[1]).toEqual(['start'])
		expect(BROWSER_SUBMIT_UNREAD_CASES).toHaveLength(4)
		expect(BROWSER_SUBMIT_NEGATIVE_CASES.map(([, first]) => first)).toEqual([true, false])
		expect(BROWSER_PENDING_REQUEST_CASES).toHaveLength(10)
		expect(
			BROWSER_PENDING_REQUEST_CASES.filter(([, , , , reason]) => reason !== undefined).map(
				([name]) => name,
			),
		).toEqual([
			'a start of the requested URL takes the request reason',
			'a swapped frame keeps its request',
		])
		expect(
			BROWSER_SUBMIT_UNREAD_CASES.filter(
				([, , , , clause]) => clause === 'and submitted the form',
			).map(([, stages, reason]) => [stages.includes('request'), reason]),
		).toEqual([[true, 'formSubmissionGet']])
		expect(BROWSER_SUBMIT_MALFORMED_READS.map(([name]) => name)).toEqual([
			'a record without implicit',
			'a record whose submitted is a string',
			'a record whose destinations hold a number',
			'null',
			'a bare array',
		])
	})

	it('evaluates an expression against globals of its own, apart from every other window', () => {
		const first = new BrowserSubmitWindow()
		const second = new BrowserSubmitWindow()
		expect(first.evaluate('(globalThis.marker = 7, globalThis.marker)')).toBe(7)
		expect(second.evaluate('globalThis.marker')).toBeUndefined()
		expect(first.evaluate("typeof document.querySelector === 'function'")).toBe(true)
	})

	it('keeps one window per session and context, sums their listeners, and evaluates a message in the window it names', () => {
		const windows = new BrowserSubmitWindows()
		const main = windows.window('session-main', 91)
		expect(windows.window('session-main', 91)).toBe(main)
		expect(windows.window('session-child', 91)).not.toBe(main)
		main.addEventListener('submit', ignoreCall)
		windows.window('session-child', 92).addEventListener('submit', ignoreCall)
		expect(windows.listeners).toBe(2)
		main.evaluate('(globalThis.frame = "main")')
		expect(
			windows.evaluate({
				id: 1,
				method: 'Runtime.evaluate',
				params: { expression: 'globalThis.frame', contextId: 91 },
				sessionId: 'session-main',
			}),
		).toBe('main')
		expect(
			windows.evaluate({
				id: 2,
				method: 'Runtime.evaluate',
				params: { expression: 'globalThis.frame', contextId: 92 },
				sessionId: 'session-child',
			}),
		).toBeUndefined()
	})

	it('installs an observer as often as asked, dispatches the submissions, and reads it with the listeners left', () => {
		const observer =
			"addEventListener('submit', () => { globalThis.count = (globalThis.count ?? 0) + 1 })"
		const read = 'globalThis.count ?? 0'
		expect(evaluateBrowserSubmit(observer, read)).toEqual([0, 1])
		expect(evaluateBrowserSubmit(observer, read, [{ prevented: false, form: {} }], 2)).toEqual([
			2, 2,
		])
		expect(evaluateBrowserSubmit(observer, read, [], 0)).toEqual([0, 0])
	})

	it('reads the token a compiled observer or read embeds and tells the two apart, alone or guarded', () => {
		const observer = compileSubmitObserverExpression(12)
		const read = compileSubmitReadExpression(12)
		expect(readBrowserSubmitToken(observer)).toBe(12)
		expect(readBrowserSubmitToken(compileGuardedEvaluateExpression(read, 100))).toBe(12)
		expect(readBrowserSubmitToken('document.title')).toBeUndefined()
		expect([matchesBrowserSubmitObserver(observer), matchesBrowserSubmitRead(observer)]).toEqual([
			true,
			false,
		])
		expect([matchesBrowserSubmitObserver(read), matchesBrowserSubmitRead(read)]).toEqual([
			false,
			true,
		])
		expect(matchesBrowserSubmitRead(read.replace('const token = 12', 'const token = 13'))).toBe(
			true,
		)
		expect(matchesBrowserSubmitRead(read.replace('delete globalThis', 'void globalThis'))).toBe(
			false,
		)
	})

	it('answers an evaluation with the value its expression returns in the window it names', async () => {
		const { client, transport } = await createConnectedCDPClient()
		try {
			const windows = new BrowserSubmitWindows()
			windows.window('session-child', 92).evaluate('(globalThis.answer = 42)')
			transport.onSend('Runtime.evaluate', (message) =>
				answerBrowserEvaluation(transport, windows, message),
			)
			expect(
				await client.send(
					'Runtime.evaluate',
					{ expression: 'globalThis.answer', contextId: 92 },
					{ session: 'session-child' },
				),
			).toEqual({ result: { value: 42 } })
		} finally {
			await client.close()
		}
	})
})

describe('navigation settlement fixtures', () => {
	it('emits each stage of a navigation in protocol order on the session it names', () => {
		const transport = createCDPTestTransport()
		const frames = createRecorder<[data: string]>()
		transport.emitter.on('message', frames.handler)
		emitBrowserNavigation(
			transport,
			'session-child',
			'child',
			'https://example.test/done',
			'loader-done',
		)
		const events = frames.calls.map(([data]) => JSON.parse(data))
		expect(events.map((event) => [event.method, event.sessionId])).toEqual([
			['Page.frameRequestedNavigation', 'session-child'],
			['Page.frameStartedNavigating', 'session-child'],
			['Page.frameNavigated', 'session-child'],
			['Page.lifecycleEvent', 'session-child'],
			['Page.lifecycleEvent', 'session-child'],
		])
		expect(events.map((event) => event.params)).toEqual([
			{
				frameId: 'child',
				reason: 'formSubmissionPost',
				url: 'https://example.test/done',
				disposition: 'currentTab',
			},
			{
				frameId: 'child',
				url: 'https://example.test/done',
				loaderId: 'loader-done',
				navigationType: 'differentDocument',
			},
			{ frame: { id: 'child', url: 'https://example.test/done', loaderId: 'loader-done' } },
			{ frameId: 'child', loaderId: 'loader-done', name: 'DOMContentLoaded' },
			{ frameId: 'child', loaderId: 'loader-done', name: 'load' },
		])
		frames.clear()
		emitBrowserNavigation(
			transport,
			'session-main',
			'main',
			'https://example.test/next',
			'loader-next',
			['commit'],
		)
		expect(frames.calls.map(([data]) => JSON.parse(data).method)).toEqual(['Page.frameNavigated'])
		frames.clear()
		emitBrowserNavigation(
			transport,
			'session-main',
			'main',
			'https://example.test/next',
			'loader-next',
			['request'],
			'anchorClick',
		)
		expect(frames.calls.map(([data]) => JSON.parse(data).params.reason)).toEqual(['anchorClick'])
	})

	it('attaches the child frame on its own session under the main frame and waits for its publication', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserElements(transport)
		const page = new BrowserPage(
			client,
			'main',
			'session-main',
			undefined,
			'https://example.test/cart',
		)
		try {
			const attaches = createRecorder<[data: string]>()
			transport.emitter.on('message', attaches.handler)
			await attachBrowserElementChild(transport, page)
			expect(
				attaches.calls
					.map(([data]) => JSON.parse(data))
					.find((frame) => frame.method === 'Target.attachedToTarget'),
			).toEqual({
				method: 'Target.attachedToTarget',
				params: {
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://example.test/checkout',
						parentFrameId: 'main',
					},
				},
				sessionId: 'session-main',
			})
			expect((await page.frames()).find((frame) => frame.id === 'child')?.parent).toBe('main')
		} finally {
			await client.close()
		}
	})

	it('builds the page tree with the nested frame only when asked, and answers a named root, a tree hook, the resume of a paused target, and an insertion hook', async () => {
		expect(JSON.stringify(buildBrowserElementTree())).not.toContain('nested')
		expect(JSON.stringify(buildBrowserElementTree({ nested: true }))).toContain(
			'"id":"nested","parentId":"child"',
		)
		const inserted: CDPSentMessage[] = []
		const { client, transport, recording } = await createBrowserElementFixture({
			roots: new Map([['session-other', { id: 'other', url: 'https://example.test/other' }]]),
			insert: (message) => inserted.push(message),
		})
		try {
			expect(
				await client.send('Page.getFrameTree', undefined, { session: 'session-other' }),
			).toEqual({ frameTree: { frame: { id: 'other', url: 'https://example.test/other' } } })
			expect(
				await client.send('Page.getFrameTree', undefined, { session: 'session-main' }),
			).toEqual(buildBrowserElementTree())
			expect(
				await client.send('Runtime.runIfWaitingForDebugger', undefined, {
					session: 'session-other',
				}),
			).toEqual({})
			const insertion = client.send(
				'Input.insertText',
				{ text: 'sam' },
				{ session: 'session-main' },
			)
			await waitForCondition('the insertion is withheld', () => inserted.length === 1)
			transport.reply(requireValue(inserted[0]).id, { held: true })
			await expect(insertion).resolves.toEqual({ held: true })
			expect(recording.registrations()).toBeGreaterThan(0)
		} finally {
			await client.close()
		}
		const hooked = createRecorder<[message: CDPSentMessage]>()
		const tree = await createBrowserElementFixture({ local: true, tree: hooked.handler })
		try {
			const pending = tree.client.send('Page.getFrameTree', undefined, { session: 'session-main' })
			await waitForCondition('the tree hook receives the read', () => hooked.count === 1)
			tree.transport.reply(requireValue(hooked.calls[0])[0].id, {
				frameTree: { frame: { id: 'hooked', url: 'about:blank' } },
			})
			await expect(pending).resolves.toEqual({
				frameTree: { frame: { id: 'hooked', url: 'about:blank' } },
			})
		} finally {
			await tree.client.close()
		}
	})

	it('holds an in-process child tree whose backends the main tree does not use', () => {
		const framed = BROWSER_ELEMENT_FRAMED_FIXTURE.nodes.map((node) => node.backendDOMNodeId)
		const main = new Set(BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) => node.backendDOMNodeId))
		expect(framed).toEqual([22, 23])
		expect(framed.filter((backend) => main.has(backend))).toEqual([])
	})

	it('opens a record over the steps a test emits, the main frame, and the fixture parents', async () => {
		expect([...BROWSER_RECORD_PARENTS]).toEqual([
			['child', 'main'],
			['side', 'main'],
			['nested', 'child'],
		])
		const { steps, lifetime, record } = openBrowserNavigationRecord('nested')
		expect(steps.count()).toBe(4)
		const started = record.wait({ timeout: 1_000 })
		steps.emit('request', 'child', 'https://example.test/applied', undefined, undefined)
		await expect(started).resolves.toBeUndefined()
		lifetime.abort(new Error('closed'))
		await expect(record.settle()).rejects.toThrow('closed')
		const shared = openBrowserNavigationRecord('main', steps)
		expect(shared.steps).toBe(steps)
		shared.record.destroy()
	})
})

describe('RecordingCDPClient', () => {
	it('delegates every call and counts each live registration by method and session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const recording = new RecordingCDPClient(client)
		try {
			expect(recording.connected).toBe(true)
			expect(recording.emitter).toBe(client.emitter)
			replyOk(transport, 'Page.enable', { enabled: true })
			await expect(
				recording.send('Page.enable', undefined, { session: 'session-1' }),
			).resolves.toEqual({
				enabled: true,
			})
			const events = createRecorder<[params: Readonly<Record<string, unknown>>]>()
			recording.subscribe('Page.frameNavigated', events.handler, 'session-1')
			recording.subscribe('Page.frameNavigated', events.handler, 'session-1')
			recording.subscribe('Page.frameNavigated', ignoreCall, 'session-2')
			recording.subscribe('Target.targetCreated', ignoreCall)
			expect(recording.registrations()).toBe(3)
			expect(recording.registrations('Page.frameNavigated')).toBe(2)
			expect(recording.registrations(undefined, 'session-1')).toBe(1)
			expect(recording.registrations('Page.frameNavigated', 'session-2')).toBe(1)
			transport.event('Page.frameNavigated', { frame: { id: 'main' } }, 'session-1')
			expect(events.count).toBe(1)
			recording.unsubscribe('Page.frameNavigated', events.handler, 'session-1')
			transport.event('Page.frameNavigated', { frame: { id: 'main' } }, 'session-1')
			expect(events.count).toBe(1)
			expect(recording.registrations()).toBe(2)
			recording.unsubscribe('Page.frameNavigated', ignoreCall, 'session-1')
			expect(recording.registrations()).toBe(2)
		} finally {
			await recording.close()
		}
		expect(client.connected).toBe(false)
	})
})

// === Compiled journey modules

describe('instrumentBrowserJourneyModule', () => {
	it('exports an actions array before execute and hooks the toolset the module constructs, leaving every step call as written', () => {
		const lines = instrumentBrowserJourneyModule(BROWSER_JOURNEY_MODULE_JAVASCRIPT).split('\n')

		expect(lines.slice(0, 6)).toStrictEqual([
			"import { createBrowserToolset, performBrowserStep } from '@orkestrel/browser'",
			'',
			'export const actions = []',
			'',
			'export async function execute(page, inputs = {}) {',
			'\tconst toolset = createBrowserToolset(page, { on: { action: (action) => actions.push(action) } })',
		])
		expect(lines.slice(6)).toStrictEqual(BROWSER_JOURNEY_MODULE_JAVASCRIPT.split('\n').slice(4))
	})

	it('refuses a module that constructs no toolset over its page', () => {
		expect(() =>
			instrumentBrowserJourneyModule(
				BROWSER_JOURNEY_MODULE_JAVASCRIPT.replace(
					'createBrowserToolset(page)',
					'createBrowserToolset(view)',
				),
			),
		).toThrow('The module declares no execute that constructs a toolset over its page')
	})
})
