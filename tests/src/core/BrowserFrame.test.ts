import type { BrowserWaitState } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_RESULT_LIMIT,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BrowserFrame,
	BrowserSelectorError,
	compileGuardedEvaluateExpression,
	compileReadFunction,
	createCDPClient,
	isBrowserError,
	isBrowserResultLimitError,
	isBrowserSelectorError,
	isCDPTimeoutError,
} from '@src/core'
import { createRecorder } from '@orkestrel/test'
import {
	createCDPTestTransport,
	createConnectedCDPClient,
	readCDPExpression,
	replyOk,
	scriptEvaluate,
	scriptTrustedSelector,
} from '../../setup.js'

// === BrowserFrame

describe('BrowserFrame', () => {
	it('exposes stable frame metadata', async () => {
		const { client } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
			'frame-main',
			'checkout',
		)

		expect(frame.id).toBe('frame-child')
		expect(frame.parent).toBe('frame-main')
		expect(frame.name).toBe('checkout')
		expect(frame.url).toBe('https://example.com/frame')
	})

	it('evaluates in an isolated world bound to the frame and session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes('2 + 2'), 4)
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		expect(await frame.evaluate('2 + 2')).toBe(4)

		const world = transport.sent.find((message) => message.method === 'Page.createIsolatedWorld')
		expect(world?.sessionId).toBe('session-child')
		expect(world?.params?.['frameId']).toBe('frame-child')
		const evaluation = transport.sent.find((message) => message.method === 'Runtime.evaluate')
		expect(evaluation?.sessionId).toBe('session-child')
		expect(evaluation?.params?.['contextId']).toBe(42)
	})

	it('resolves a current session lazily before every operation', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const calls = createRecorder<[frame: string]>()
		let count = 0
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, () => true, 'ok')
		const frame = new BrowserFrame(
			client,
			async (id) => {
				calls.handler(id)
				count += 1
				return count === 1 ? 'session-one' : 'session-two'
			},
			'frame-child',
			'https://example.com/frame',
		)

		await frame.evaluate('"ok"')
		await frame.evaluate('"ok"')

		expect(calls.calls).toEqual([['frame-child'], ['frame-child']])
		expect(
			transport.sent
				.filter((message) => message.method === 'Page.createIsolatedWorld')
				.map((message) => message.sessionId),
		).toEqual(['session-one', 'session-two'])
	})

	it('throws a coded browser error when the isolated world is malformed', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', {})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.evaluate('1')).rejects.toSatisfy(isBrowserError)
	})

	it('reads title from the frame document', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression === 'document.title', 'Frame title')
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		expect(await frame.title()).toBe('Frame title')
	})

	it('captures a reading through one guarded evaluation in an isolated world', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://example.com/updated',
			title: 'Frame title',
			html: '<main><p>Frame body</p></main>',
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		const reading = await frame.read()

		expect(reading.url).toBe('https://example.com/updated')
		expect(reading.title).toBe('Frame title')
		expect(reading.markdown().text).toBe('Frame body')
		expect(reading.stale).toBe(false)
		expect(frame.url).toBe('https://example.com/updated')
		const world = transport.sent.find((message) => message.method === 'Page.createIsolatedWorld')
		expect(world?.params).toMatchObject({ frameId: 'frame-child' })
		const evaluations = transport.sent.filter((message) => message.method === 'Runtime.evaluate')
		expect(evaluations).toHaveLength(1)
		expect(evaluations[0]?.sessionId).toBe('session-child')
		expect(evaluations[0]?.params?.['contextId']).toBe(42)
		expect(readCDPExpression(evaluations[0])).toContain(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)
	})

	it('serves every slice of one reading from its single capture and handle', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://example.com/frame',
			title: 'Paragraphs',
			html: `<main>${'<p>One paragraph of the frame document.</p>'.repeat(40)}</main>`,
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		const reading = await frame.read()
		const handle = reading.html
		const first = reading.markdown({ limit: 200 })
		const second = reading.markdown({ offset: first.text.length, limit: 200 })

		expect(second.offset).toBe(first.text.length)
		expect(second.total).toBe(first.total)
		expect(reading.html).toBe(handle)
		expect(transport.sent.filter((message) => message.method === 'Runtime.evaluate')).toHaveLength(
			1,
		)
	})

	it('rejects an oversized capture with a result-limit error before any reading exists', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		transport.onSend('Runtime.evaluate', (message) => {
			transport.reply(message.id, {
				exceptionDetails: {
					exception: {
						description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000`,
					},
				},
			})
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.read()).rejects.toSatisfy(isBrowserResultLimitError)
		expect(frame.url).toBe('https://example.com/frame')
		const evaluation = transport.sent.find((message) => message.method === 'Runtime.evaluate')
		expect(evaluation?.params?.['expression']).toBe(
			compileGuardedEvaluateExpression(`(${compileReadFunction()})()`, BROWSER_RESULT_LIMIT),
		)
	})

	it('checks the signal before the session resolves', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const sessionError = new Error('session lookup failed')
		const reason = new Error('tool cancelled')
		const controller = new AbortController()
		controller.abort(reason)
		const rejected = Promise.reject(sessionError)
		rejected.catch(() => undefined)
		const frame = new BrowserFrame(
			client,
			() => rejected,
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.read({ signal: controller.signal })).rejects.toBe(reason)
		expect(transport.sent).toEqual([])
	})

	it('rejects a capture missing its url, title, or html with a browser error', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://example.com/frame',
			title: 'No html',
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.read()).rejects.toSatisfy(isBrowserError)
	})

	it('rejects a read with an aborted signal with its reason before any protocol work', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)
		const reason = new Error('tool cancelled')
		const controller = new AbortController()
		controller.abort(reason)

		await expect(frame.read({ signal: controller.signal })).rejects.toBe(reason)
		expect(transport.sent).toEqual([])
	})

	it('reads through the supplied world and reports stale when the supplied epoch advances', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://example.com/frame',
			title: 'Frame title',
			html: '<p>Frame body</p>',
		})
		const epochs = [0]
		const sessions = createRecorder<[session: string]>()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
			undefined,
			undefined,
			true,
			() => epochs[0] ?? 0,
			async (session) => {
				sessions.handler(session)
				return 77
			},
		)

		const reading = await frame.read()
		epochs[0] = 1

		expect(sessions.calls).toEqual([['session-child']])
		expect(transport.sent.map((message) => message.method)).toEqual(['Runtime.evaluate'])
		expect(transport.sent[0]?.params?.['contextId']).toBe(77)
		expect(reading.stale).toBe(true)
	})

	it('produces readings that never report stale without a supplied epoch', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://example.com/frame',
			title: 'Frame title',
			html: '<p>Frame body</p>',
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		const reading = await frame.read()
		frame.update('https://example.com/frame/next')

		expect(reading.stale).toBe(false)
	})

	it('waits and acts entirely through the frame execution context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptTrustedSelector(transport, '#submit')
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await frame.click('#submit')

		const evaluations = transport.sent.filter((message) => message.method === 'Runtime.evaluate')
		expect(evaluations).toHaveLength(2)
		expect(evaluations.every((message) => message.params?.['contextId'] === 42)).toBe(true)
	})

	it('passes strict false through waits and actions', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptTrustedSelector(transport, '.choice')
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await frame.click('.choice', { strict: false })

		const expressions = transport.sent
			.filter((message) => message.method === 'Runtime.evaluate')
			.map((message) => readCDPExpression(message))
		expect(expressions[0]).toContain('if (false && matches.length > 1)')
		expect(expressions[1]).toContain(JSON.stringify('.choice'))
	})

	it.each<BrowserWaitState>(['attached', 'detached', 'visible', 'hidden'])(
		'compiles the %s wait state',
		async (state) => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
			scriptEvaluate(transport, (expression) => expression.includes('new Promise'), true)
			const frame = new BrowserFrame(
				client,
				'session-child',
				'frame-child',
				'https://example.com/frame',
			)

			await expect(frame.wait('#target', { state })).resolves.toBeUndefined()
			const expression = readCDPExpression(
				transport.sent.find((message) => message.method === 'Runtime.evaluate'),
			)
			expect(expression?.includes('matches.length > 0 && visible(matches[0])')).toBe(
				state === 'visible',
			)
			expect(expression?.includes('matches.every((element) => !visible(element))')).toBe(
				state === 'hidden',
			)
			expect(expression?.includes('matches.length === 0')).toBe(
				state === 'detached' || state === 'hidden',
			)
		},
	)

	it('rejects invalid timeouts before sending a CDP request', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.wait('#target', { timeout: Number.NaN })).rejects.toSatisfy(isBrowserError)
		await expect(frame.wait('#target', { timeout: -1 })).rejects.toSatisfy(isBrowserError)
		expect(transport.sent).toEqual([])
	})

	it('maps an unmet state to a selector error with frame context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression.includes('new Promise'), false)
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		const thrown: unknown = await frame
			.wait('#missing', { timeout: 0 })
			.catch((error: unknown) => error)
		expect(isBrowserSelectorError(thrown)).toBe(true)
		expect(thrown instanceof BrowserSelectorError ? thrown.context : undefined).toMatchObject({
			frame: 'frame-child',
			state: 'attached',
			timeout: 0,
		})
	})

	it('sends arbitrary CDP methods through the resolved frame session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'DOM.getDocument', { root: { nodeId: 1 } })
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.send('DOM.getDocument', { depth: 1 })).resolves.toEqual({
			root: { nodeId: 1 },
		})
		const request = transport.sent.find((message) => message.method === 'DOM.getDocument')
		expect(request?.sessionId).toBe('session-child')
		expect(request?.params).toEqual({ depth: 1 })
	})

	it('bounds one send with its own timeout instead of the client default', async () => {
		const transport = createCDPTestTransport()
		// The client-wide default is far beyond the test timeout, so only the
		// per-call argument can settle this never-answered request.
		const client = createCDPClient({ transport, timeout: 600_000 })
		await client.connect()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.send('DOM.getDocument', undefined, { timeout: 20 })).rejects.toSatisfy(
			isCDPTimeoutError,
		)
	})

	it('rejects operations after the CDP client disconnects', async () => {
		const { client } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)
		await client.close()

		await expect(frame.evaluate('1')).rejects.toSatisfy(isBrowserError)
	})

	it('asserts a disconnected frame is unusable before any protocol work', async () => {
		const { client } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		expect(() => frame.assert()).not.toThrow()
		await client.close()
		expect(() => frame.assert()).toThrow('Browser frame is disconnected')
	})

	it('records an externally observed url as the frame url', async () => {
		const { client } = await createConnectedCDPClient()
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		frame.update('https://example.com/frame/next')

		expect(frame.url).toBe('https://example.com/frame/next')
	})
	it('forwards a signal from send, evaluate, and handle to the client', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)
		const reason = new Error('tool cancelled')
		const controller = new AbortController()
		const settled = [
			frame.send('DOM.getDocument', undefined, { signal: controller.signal }),
			frame.evaluate('1 + 1', { signal: controller.signal }),
			frame.handle('document', { signal: controller.signal }),
		].map((call) => call.catch((thrown: unknown) => thrown))
		await new Promise((resolve) => setTimeout(resolve, 10))
		controller.abort(reason)

		expect(await Promise.all(settled)).toEqual([reason, reason, reason])
	})

	it('keeps the evaluate timeout behavior', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.evaluate('1', { timeout: 20 })).rejects.toSatisfy(isCDPTimeoutError)
	})
})
