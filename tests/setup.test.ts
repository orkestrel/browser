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
import { createRecorder, readProperty, requireValue } from '@orkestrel/test'
import {
	createCDPTransport,
	createCodegenBindingPayload,
	createConnectedCDPClient,
	createDOMSnapshotResult,
	createScreenshotWriter,
	createStartedCodegen,
	createTarget,
	evaluateJavaScript,
	ignoreAsyncCall,
	ignoreCall,
	JPEG_BASE64,
	PNG_BASE64,
	readCDPExpression,
	replyOk,
	scriptCDPAttach,
	scriptEvaluate,
	scriptFrameTree,
	scriptSelectorPresent,
	scriptTrustedSelector,
	throwListenerError,
} from './setup.js'

// === Fake CDP transport

describe('createCDPTransport', () => {
	it('decomposes a request frame into the recorded message and skips a frame carrying no request', async () => {
		const transport = createCDPTransport()

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
		const transport = createCDPTransport()

		expect([transport.started, transport.closed]).toStrictEqual([false, false])

		await transport.start()
		expect([transport.started, transport.closed]).toStrictEqual([true, false])

		await transport.close()
		expect([transport.started, transport.closed]).toStrictEqual([false, true])

		await transport.start()
		expect([transport.started, transport.closed]).toStrictEqual([true, false])
	})

	it('invokes every handler registered for the sent method in registration order and no other', async () => {
		const transport = createCDPTransport()
		const order: string[] = []

		transport.onSend('Page.enable', () => order.push('enable-first'))
		transport.onSend('Page.enable', () => order.push('enable-second'))
		transport.onSend('Page.close', () => order.push('close'))

		await transport.send(JSON.stringify({ id: 1, method: 'Page.enable' }))

		expect(order).toStrictEqual(['enable-first', 'enable-second'])
	})

	it('hands the sent message to its handler', async () => {
		const transport = createCDPTransport()
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
		const transport = createCDPTransport()
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
		const transport = createCDPTransport()
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
		const transport = createCDPTransport()
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

describe('replyOk', () => {
	it('answers every send of the scripted method with an empty result and leaves another method unanswered', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.enable')

		await expect(client.send('Page.enable')).resolves.toStrictEqual({})
		await expect(client.send('Page.enable')).resolves.toStrictEqual({})
		await expect(client.send('Page.close', undefined, undefined, 50)).rejects.toThrow(
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
		await expect(named.client.send('Page.enable', undefined, 'session-7')).resolves.toStrictEqual(
			{},
		)
		await expect(
			named.client.send('Runtime.enable', undefined, 'session-7'),
		).resolves.toStrictEqual({})
		await expect(
			named.client.send('Page.getFrameTree', undefined, 'session-7'),
		).resolves.toStrictEqual({
			frameTree: { frame: { id: 'frame-session-7', url: 'about:blank' } },
		})

		const defaulted = await createConnectedCDPClient()
		scriptCDPAttach(defaulted.transport)

		await expect(
			defaulted.client.send('Target.attachToTarget', { targetId: 'target-1' }),
		).resolves.toStrictEqual({ sessionId: 'session-1' })
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
			client.send('Runtime.evaluate', { expression: 'document.title' }, undefined, 50),
		).rejects.toThrow('CDP request timed out: Runtime.evaluate')
	})
})

describe('scriptSelectorPresent', () => {
	it('resolves the presence poll for its own selector and refuses a prefix lookalike or a non-poll expression', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptSelectorPresent(transport, '#hero')

		const poll = `new Promise((resolve) => { const query = ${JSON.stringify('#hero')}; resolve(document.querySelector(query) !== null) })`
		const lookalike = `new Promise((resolve) => { const query = ${JSON.stringify('#heroic')}; resolve(document.querySelector(query) !== null) })`
		const direct = `const query = ${JSON.stringify('#hero')}; document.querySelector(query) !== null`

		await expect(client.send('Runtime.evaluate', { expression: poll })).resolves.toStrictEqual({
			result: { value: true },
		})
		await expect(
			client.send('Runtime.evaluate', { expression: lookalike }, undefined, 50),
		).rejects.toThrow('CDP request timed out: Runtime.evaluate')
		await expect(
			client.send('Runtime.evaluate', { expression: direct }, undefined, 50),
		).rejects.toThrow('CDP request timed out: Runtime.evaluate')
	})
})

describe('scriptTrustedSelector', () => {
	it('answers the presence poll, the object handle, the content quads, and the input dispatches for its selector', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#btn')

		const poll = `new Promise((resolve) => { const query = ${JSON.stringify('#btn')}; resolve(document.querySelector(query) !== null) })`
		await expect(client.send('Runtime.evaluate', { expression: poll })).resolves.toStrictEqual({
			result: { value: true },
		})

		await expect(
			client.send('Runtime.evaluate', {
				expression: `document.querySelector(${JSON.stringify('#btn')})`,
				returnByValue: false,
			}),
		).resolves.toStrictEqual({ result: { objectId: 'object-1' } })
		await expect(
			client.send('Runtime.callFunctionOn', { objectId: 'object-1' }),
		).resolves.toStrictEqual({ result: { value: true } })
		await expect(
			client.send('DOM.getContentQuads', { objectId: 'object-1' }),
		).resolves.toStrictEqual({ quads: [[0, 0, 100, 0, 100, 40, 0, 40]] })
		await expect(
			client.send('Input.dispatchMouseEvent', { type: 'mousePressed' }),
		).resolves.toStrictEqual({})
		await expect(client.send('Input.insertText', { text: 'hello' })).resolves.toStrictEqual({})
		await expect(
			client.send('Runtime.releaseObject', { objectId: 'object-1' }),
		).resolves.toStrictEqual({})

		await expect(
			client.send(
				'Runtime.evaluate',
				{
					expression: `document.querySelector(${JSON.stringify('#other')})`,
					returnByValue: false,
				},
				undefined,
				50,
			),
		).rejects.toThrow('CDP request timed out: Runtime.evaluate')
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
			type: 'page',
			title: 'Test Page',
			url: 'about:blank',
		})
		expect(createTarget({ id: 'target-2', url: 'https://example.com/' })).toStrictEqual({
			id: 'target-2',
			type: 'page',
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

describe('createScreenshotWriter', () => {
	it('records the path and the exact bytes of every write in call order', async () => {
		const writer = createScreenshotWriter()
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
