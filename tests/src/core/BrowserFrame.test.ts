import type { BrowserWaitState } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BrowserFrame,
	BrowserSelectorError,
	createCDPClient,
	isBrowserError,
	isBrowserResultLimitError,
	isBrowserSelectorError,
	isCDPTimeoutError,
} from '@src/core'
import { createRecorder } from '@orkestrel/test'
import {
	createCDPTransport,
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

	it('reads title and content from the frame document and refreshes its url', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression === 'document.title', 'Frame title')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('document.documentElement.outerHTML'),
			'<html><body>Frame body</body></html>',
		)
		scriptEvaluate(
			transport,
			(expression) => expression.includes('document.body ? document.body.innerText'),
			'Frame body',
		)
		scriptEvaluate(
			transport,
			(expression) => expression === 'location.href',
			'https://example.com/updated',
		)
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		expect(await frame.title()).toBe('Frame title')
		expect(await frame.content()).toEqual({
			url: 'https://example.com/updated',
			title: 'Frame title',
			html: '<html><body>Frame body</body></html>',
			text: 'Frame body',
		})
		expect(frame.url).toBe('https://example.com/updated')
	})

	it('distills article content while pruning boilerplate and preserving structure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const html =
			'<html><body><nav>Site navigation</nav><aside class="cookie-banner">Cookie choices</aside><main><article><h1>Research Notes</h1><p>The load-bearing article text.</p><table><tr><th>Topic</th><th>Result</th></tr><tr><td>Distillation</td><td>Clean</td></tr></table></article></main><p hidden>Hidden distraction</p><footer>Footer links</footer></body></html>'
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression === 'document.title', 'Research Notes')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('document.documentElement.outerHTML'),
			html,
		)
		scriptEvaluate(
			transport,
			(expression) => expression.includes('document.body ? document.body.innerText'),
			'Site navigation\nResearch Notes\nThe load-bearing article text.\nFooter links',
		)
		scriptEvaluate(
			transport,
			(expression) => expression === 'location.href',
			'https://example.com/article',
		)
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		const article = await frame.article()

		expect(article).toContain('The load-bearing article text.')
		expect(article).not.toContain('Site navigation')
		expect(article).not.toContain('Footer links')
		expect(article).not.toContain('Hidden distraction')
		expect(article).not.toContain('Cookie choices')
		expect(article).toContain('Topic\tResult')
	})

	it('distills article HTML when discarded body text exceeds the result limit', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 42 })
		scriptEvaluate(transport, (expression) => expression === 'document.title', 'Article')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('document.documentElement.outerHTML'),
			'<html><body><main><article><p>Readable article.</p></article></main></body></html>',
		)
		scriptEvaluate(
			transport,
			(expression) => expression === 'location.href',
			'https://example.com/article',
		)
		transport.onSend('Runtime.evaluate', (message) => {
			const expression = message.params?.['expression']
			if (
				typeof expression === 'string' &&
				expression.includes('document.body ? document.body.innerText')
			) {
				transport.reply(message.id, {
					exceptionDetails: {
						exception: {
							description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000`,
						},
					},
				})
			}
		})
		const frame = new BrowserFrame(
			client,
			'session-child',
			'frame-child',
			'https://example.com/frame',
		)

		await expect(frame.content()).rejects.toSatisfy(isBrowserResultLimitError)
		await expect(frame.article()).resolves.toBe('Readable article.')
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
		const transport = createCDPTransport()
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

		await expect(frame.send('DOM.getDocument', undefined, 20)).rejects.toSatisfy(isCDPTimeoutError)
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
})
