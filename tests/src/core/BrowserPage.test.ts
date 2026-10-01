import type {
	BrowserConsoleMessage,
	BrowserDialogInterface,
	BrowserDownloadInterface,
	BrowserFileChooserInterface,
	BrowserFrameInterface,
	BrowserPageInterface,
	BrowserPageError,
	BrowserRequest,
	BrowserRequestFailure,
	BrowserResponse,
	BrowserWebSocketInterface,
	BrowserWorkerInterface,
} from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { describe, it, expect } from 'vitest'
import {
	BrowserPage,
	createCDPClient,
	isBrowserError,
	isBrowserElementError,
	isBrowserResultLimitError,
	isCDPTimeoutError,
	BrowserResultLimitError,
	BROWSER_RESULT_LIMIT,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_STOP_LOADING_TIMEOUT_MS,
	compileGuardedEvaluateExpression,
	compileReadFunction,
} from '@src/core'
import {
	captureError,
	createRecorder,
	requireValue,
	waitForCondition,
	waitForDelay,
} from '@orkestrel/test'
import {
	createBrowserElementFixture,
	emitDocumentReady,
	createCDPTestTransport,
	createConnectedCDPClient,
	createDOMSnapshotResult,
	createRecordingWriter,
	createReferenceSequence,
	emitBrowserNavigation,
	readCDPExpression,
	readCDPParams,
	readCDPSessionMethods,
	replyOk,
	scriptCDPAttach,
	scriptEvaluate,
	scriptBrowserHistory,
	scriptFrameTree,
	FRAME_TREE_FIXTURE,
	BROWSER_HISTORY_DIRECTIONS,
	BROWSER_HISTORY_RESTORE_CASES,
	BROWSER_NAVIGATION_COMMANDS,
	BROWSER_PENDING_REQUEST_CASES,
	JPEG_BASE64,
	PNG_BASE64,
	throwListenerError,
} from '../../setup.js'

// === BrowserPage

describe('BrowserPage', () => {
	it('catches poisoning a loaderless readiness seed with the first caller signal', async () => {
		let evaluation: number | undefined
		let attempts = 0
		const fixture = await createBrowserElementFixture({
			loaderless: true,
			readiness: (message) => {
				evaluation = message.id
				attempts += 1
			},
		})
		const controller = new AbortController()
		const reason = new Error('First caller stopped')
		try {
			const first = fixture.page.elements.outline({ signal: controller.signal, timeout: 500 })
			const rejected = first.catch((error: unknown) => error)
			await waitForCondition('pending readiness seed', () => evaluation !== undefined)
			const seed = requireValue(evaluation)
			controller.abort(reason)
			expect(await rejected).toBe(reason)
			const second = fixture.page.elements.outline({ timeout: 200 })
			const outcome = second.catch((error: unknown) => error)
			fixture.transport.reply(seed, { result: { value: 'complete' } })
			expect(await outcome).toHaveProperty('count', 6)
			expect(attempts).toBe(1)
		} finally {
			await fixture.client.close()
		}
	})

	it('catches retaining a rejected readiness seed instead of retrying', async () => {
		let attempts = 0
		const fixture = await createBrowserElementFixture({
			loaderless: true,
			readiness: (message) => {
				attempts += 1
				if (attempts === 1) fixture.transport.fail(message.id, 'Readiness unavailable')
				else fixture.transport.reply(message.id, { result: { value: 'complete' } })
			},
		})
		try {
			await expect(fixture.page.elements.outline()).rejects.toThrow('Readiness unavailable')
			await expect(fixture.page.elements.outline()).resolves.toHaveProperty('count', 6)
			expect(attempts).toBe(2)
		} finally {
			await fixture.client.close()
		}
	})

	it('catches parking a back-forward cache restore on a lifecycle event that never arrives', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		const controller = new AbortController()
		try {
			transport.event(
				'Page.frameNavigated',
				{
					type: 'BackForwardCacheRestore',
					frame: { id: 'main', url: page.url, loaderId: 'restored' },
				},
				'session-main',
			)
			const pending = page.elements
				.outline({ signal: controller.signal, timeout: 200 })
				.catch((error: unknown) => error)
			await waitForDelay(50)
			const captured = transport.sent.some(
				(message) => message.method === 'Accessibility.getFullAXTree',
			)
			controller.abort()
			await pending
			expect(captured).toBe(true)
		} finally {
			await client.close()
		}
	})
	it('catches a text wait that never evaluates in the shared isolated world', async () => {
		const { client, transport, page } = await createBrowserElementFixture()
		try {
			await expect(page.wait('Order placed')).resolves.toBeUndefined()
			const evaluation = requireValue(
				transport.sent.find((message) =>
					String(message.params?.['expression']).includes('Order placed'),
				),
			)
			expect(evaluation.params).toMatchObject({
				contextId: 91,
				awaitPromise: true,
				returnByValue: true,
			})
			expect(page.trusted).toBe(true)
			expect(page.keyboard).toBe(page.keyboard)
			expect(page.mouse).toBe(page.mouse)
			expect(page.touch).toBe(page.touch)
		} finally {
			await client.close()
		}
	})

	it('catches a navigation aborted during its load that rejects with a timeout instead of the reason', async () => {
		const { client, transport, page } = await createBrowserElementFixture()
		try {
			replyOk(transport, 'Page.stopLoading')
			transport.onSend('Page.navigate', (message) =>
				transport.reply(message.id, { frameId: 'main', loaderId: 'loader-next' }),
			)
			const controller = new AbortController()
			const navigation = page
				.navigate('https://example.test/next', { signal: controller.signal, timeout: 20_000 })
				.catch((caught: unknown) => caught)
			await waitForCondition('the navigation replied', () =>
				transport.sent.some((message) => message.method === 'Page.navigate'),
			)
			await waitForDelay(10)
			controller.abort('the caller left')
			expect(await navigation).toBe('the caller left')
			expect(transport.sent.some((message) => message.method === 'Page.stopLoading')).toBe(true)
		} finally {
			await client.close()
		}
	})

	it('catches a reload aborted during its load that rejects with a timeout instead of the reason', async () => {
		const { client, transport, page } = await createBrowserElementFixture()
		try {
			replyOk(transport, 'Page.stopLoading')
			replyOk(transport, 'Page.reload')
			const controller = new AbortController()
			const reload = page
				.reload({ signal: controller.signal, timeout: 20_000 })
				.catch((caught: unknown) => caught)
			await waitForCondition('the reload replied', () =>
				transport.sent.some((message) => message.method === 'Page.reload'),
			)
			await waitForDelay(10)
			controller.abort('the caller left')
			expect(await reload).toBe('the caller left')
		} finally {
			await client.close()
		}
	})

	it('catches a readiness seed that a same-document navigation discards', async () => {
		const seeds: number[] = []
		const fixture = await createBrowserElementFixture({
			loaderless: true,
			readiness: (message) => seeds.push(message.id),
			evaluation: (message) =>
				fixture.transport.reply(message.id, {
					result: {
						value: String(message.params?.['expression']).includes('outerHTML')
							? { url: 'https://example.test/cart', title: 'Cart', html: '<p>Loaded</p>' }
							: true,
					},
				}),
		})
		const { client, transport, page } = fixture
		try {
			const first = page.read({ timeout: 500 })
			await waitForCondition('the seed is withheld', () => seeds.length === 1)
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'main', url: 'https://example.test/cart#details' },
				'session-main',
			)
			transport.reply(requireValue(seeds[0]), { result: { value: 'complete' } })
			expect((await first).text().text).toBe('Loaded')
			expect((await page.read({ timeout: 500 })).text().text).toBe('Loaded')
			expect(seeds).toHaveLength(1)
		} finally {
			await client.close()
		}
	})

	it('catches a page read that captures before the loading document is ready', async () => {
		const fixture = await createBrowserElementFixture({
			evaluation: (message) =>
				fixture.transport.reply(message.id, {
					result: {
						value: String(message.params?.['expression']).includes('outerHTML')
							? { url: 'https://example.test/cart', title: 'Cart', html: '<p>Loaded</p>' }
							: true,
					},
				}),
		})
		const { client, transport, page } = fixture
		try {
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: page.url, loaderId: 'loading' } },
				'session-main',
			)
			const before = transport.sent.length
			const started = performance.now()
			const pending = page.read({ timeout: 500 })
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
			expect((await pending).text().text).toBe('Loaded')
			expect(performance.now() - started).toBeGreaterThanOrEqual(20)
			transport.event(
				'Page.frameNavigated',
				{
					type: 'BackForwardCacheRestore',
					frame: { id: 'main', url: page.url, loaderId: 'restored' },
				},
				'session-main',
			)
			const restored = performance.now()
			expect((await page.read({ timeout: 500 })).text().text).toBe('Loaded')
			expect(performance.now() - restored).toBeLessThan(200)
		} finally {
			await client.close()
		}
	})

	it('catches page input that leaves the page session or lives on a child frame', async () => {
		const { client, transport, page } = await createBrowserElementFixture()
		try {
			replyOk(transport, 'Input.dispatchTouchEvent')
			await page.keyboard.press('a')
			await page.mouse.click({ x: 5, y: 6 })
			await page.touch.tap({ x: 7, y: 8 })
			const input = transport.sent.filter((message) => message.method.startsWith('Input.'))
			expect(new Set(input.map((message) => message.method))).toEqual(
				new Set(['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'Input.dispatchTouchEvent']),
			)
			expect(new Set(input.map((message) => message.sessionId))).toEqual(new Set(['session-main']))
			const children = (await page.frames()).filter((frame) => frame.id !== page.id)
			expect(children.length).toBeGreaterThan(0)
			expect(children.some((frame) => 'keyboard' in frame)).toBe(false)
		} finally {
			await client.close()
		}
	})

	it('catches interpreting a false text-wait result as success', async () => {
		const fixture = await createBrowserElementFixture({
			evaluation: (message) => fixture.transport.reply(message.id, { result: { value: false } }),
		})
		try {
			await expect(fixture.page.wait('missing')).rejects.toMatchObject({
				code: 'BROWSER_WAIT_TIMEOUT',
			})
		} finally {
			await fixture.client.close()
		}
	})

	it.each(['Execution context was destroyed', 'Cannot find context with specified id'])(
		'catches failing to re-arm after %s or re-arming before DOMContentLoaded',
		async (failure) => {
			let attempts = 0
			const fixture = await createBrowserElementFixture({
				evaluation: (message) => {
					attempts += 1
					if (attempts === 1) {
						fixture.transport.event('Runtime.executionContextsCleared', {}, 'session-main')
						fixture.transport.fail(message.id, failure)
					} else fixture.transport.reply(message.id, { result: { value: true } })
				},
			})
			try {
				const pending = fixture.page
					.wait('ready', { timeout: 500 })
					.catch((error: unknown) => error)
				await waitForCondition('first text evaluation', () => attempts === 1)
				await waitForDelay(20)
				expect(attempts).toBe(1)
				fixture.transport.event(
					'Page.lifecycleEvent',
					{ frameId: 'main', loaderId: 'loader-main', name: 'DOMContentLoaded' },
					'session-main',
				)
				expect(await pending).toBeUndefined()
				expect(attempts).toBe(2)
				expect(
					fixture.transport.sent.filter((message) => message.method === 'Page.createIsolatedWorld'),
				).toHaveLength(2)
			} finally {
				await fixture.client.close()
			}
		},
	)

	it('catches omitting observer disconnect when an in-flight text wait aborts', async () => {
		const controller = new AbortController()
		const reason = new Error('Stop text wait')
		const fixture = await createBrowserElementFixture({
			evaluation: (message) => {
				if (String(message.params?.['expression']).includes('new Promise')) controller.abort(reason)
				else fixture.transport.reply(message.id, { result: { value: false } })
			},
		})
		try {
			await expect(fixture.page.wait('missing', { signal: controller.signal })).rejects.toBe(reason)
			expect(
				fixture.transport.sent
					.filter((message) => message.method === 'Runtime.evaluate')
					.map((message) => message.params?.['expression']),
			).toContain('globalThis["__browserTextWait1"]?.()')
		} finally {
			await fixture.client.close()
		}
	})

	it('owns a lazy registry and destroys it before detaching the page', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')
		try {
			expect(transport.sent).toEqual([])
			const registry = page.registry
			expect(page.registry).toBe(registry)
			expect(transport.sent).toEqual([])
			for (const method of ['WebMCP.enable', 'WebMCP.disable', 'Target.detachFromTarget'])
				replyOk(transport, method)
			await registry.start()
			await page.destroy()
			expect(registry.emitter.destroyed).toBe(true)
			expect(transport.sent.map((message) => message.method)).toEqual([
				'WebMCP.enable',
				'WebMCP.disable',
				'Target.detachFromTarget',
			])
		} finally {
			await client.close()
		}
	})

	describe('url seeding', () => {
		it('reports a seeded url immediately, before any navigate() or read() call', async () => {
			const { client } = await createConnectedCDPClient()

			const page = new BrowserPage(
				client,
				'target-1',
				'session-1',
				undefined,
				'https://example.com/reattached',
			)

			expect(page.url).toBe('https://example.com/reattached')
		})

		it('defaults to about:blank when no url is seeded', async () => {
			const { client } = await createConnectedCDPClient()

			const page = new BrowserPage(client, 'target-1', 'session-1')

			expect(page.url).toBe('about:blank')
		})
	})

	describe('title()', () => {
		it('returns the document title', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Test Title')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.title()).toBe('Test Title')
		})

		it('rejects a malformed non-string title result', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.title()).rejects.toSatisfy(isBrowserError)
		})
	})

	describe('navigate()', () => {
		it('updates the page url on success', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Page.navigate', (message) => {
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			scriptEvaluate(
				transport,
				(expression) => expression.includes('location.href'),
				'https://example.com/',
			)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.navigate('https://example.com')

			expect(page.url).toBe('https://example.com/')
		})

		it('rejects a malformed post-navigation url instead of substituting the requested url', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Page.navigate', (message) => {
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			scriptEvaluate(transport, (expression) => expression.includes('location.href'), undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.navigate('https://example.com')).rejects.toSatisfy(isBrowserError)
			expect(page.url).toBe('about:blank')
		})

		it('throws a BrowserError when navigation returns errorText', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })
			replyOk(transport, 'Page.stopLoading', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.navigate('https://bad.example')).rejects.toSatisfy(isBrowserError)
		})

		it('rejects with a timeout error when the load event never fires', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', {})
			replyOk(transport, 'Page.stopLoading', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.navigate('https://slow.example', { timeout: 20 })).rejects.toThrow(
				'Navigation timeout',
			)
		})

		it('subscribes to Page.domContentEventFired and resolves for the domcontentloaded condition', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Page.navigate', (message) => {
				transport.reply(message.id, {})
				transport.event('Page.domContentEventFired', {}, message.sessionId)
			})
			scriptEvaluate(
				transport,
				(expression) => expression.includes('location.href'),
				'https://example.com/',
			)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.navigate('https://example.com', { condition: 'domcontentloaded' })

			expect(page.url).toBe('https://example.com/')
		})

		it('resolves navigate() when loadEventFired arrives BEFORE the Page.navigate reply', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Page.navigate', (message) => {
				// Fire the load event first, then reply to the navigate request —
				// exercises the pre-subscription guarantee (subscribe before send).
				transport.event('Page.loadEventFired', {}, message.sessionId)
				transport.reply(message.id, {})
			})
			scriptEvaluate(
				transport,
				(expression) => expression.includes('location.href'),
				'https://example.com/',
			)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.navigate('https://example.com')).resolves.toMatchObject({
				url: 'https://example.com/',
				same: false,
			})
			expect(page.url).toBe('https://example.com/')
		})

		it('bounds the Page.navigate send itself with the per-call timeout, not the client default', async () => {
			const transport = createCDPTestTransport()
			// Client-wide default is large — only the per-call navigate timeout
			// bounds this request.
			const client = createCDPClient({ transport, timeout: 10_000 })
			await client.connect()
			// Page.navigate is never replied to — the send itself must time out.
			replyOk(transport, 'Page.stopLoading', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const started = performance.now()
			const thrown: unknown = await page
				.navigate('https://slow.example', { timeout: 20 })
				.catch((caught: unknown) => caught)
			const elapsed = performance.now() - started

			expect(isCDPTimeoutError(thrown)).toBe(true)
			// The 10s client-wide default never bounded this send.
			expect(elapsed).toBeLessThan(1_000)
		})

		it('sends a best-effort Page.stopLoading after a load-wait timeout, and a subsequent evaluate() still works', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', {})
			replyOk(transport, 'Page.stopLoading', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.navigate('https://slow.example', { timeout: 20 })).rejects.toThrow(
				'Navigation timeout',
			)

			expect(transport.sent.some((m) => m.method === 'Page.stopLoading')).toBe(true)

			scriptEvaluate(transport, (expression) => expression.includes('1 + 1'), 2)
			expect(await page.evaluate('1 + 1')).toBe(2)
		})

		it('sends a best-effort Page.stopLoading when navigation returns errorText, and a subsequent evaluate() still works', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })
			replyOk(transport, 'Page.stopLoading', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.navigate('https://bad.example')).rejects.toSatisfy(isBrowserError)

			expect(transport.sent.some((m) => m.method === 'Page.stopLoading')).toBe(true)

			scriptEvaluate(transport, (expression) => expression.includes('1 + 1'), 2)
			expect(await page.evaluate('1 + 1')).toBe(2)
		})

		it('sends a best-effort Page.stopLoading when the Page.navigate send itself times out', async () => {
			const transport = createCDPTestTransport()
			const client = createCDPClient({ transport, timeout: 10_000 })
			await client.connect()
			replyOk(transport, 'Page.stopLoading', {})
			// Page.navigate is never replied to — the send itself must time out.

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const thrown: unknown = await page
				.navigate('https://slow.example', { timeout: 20 })
				.catch((caught: unknown) => caught)

			expect(isCDPTimeoutError(thrown)).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Page.stopLoading')).toBe(true)
		})

		it('does not let a failing Page.stopLoading mask the original navigate error', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })
			// Page.stopLoading is never replied to — its own send times out and
			// rejects, which must be swallowed rather than surfacing to the caller.
			transport.onSend('Page.stopLoading', () => {
				// intentionally no reply
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.navigate('https://bad.example', { timeout: 30 })).rejects.toSatisfy(
				isBrowserError,
			)
		}, 10_000)

		it('bounds the best-effort Page.stopLoading to a short cap instead of the full per-call timeout', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })
			// Page.stopLoading is never replied to — a wedged renderer must not
			// be able to stretch the failure path out to the full per-call timeout.
			transport.onSend('Page.stopLoading', () => {
				// intentionally no reply
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const started = performance.now()
			const thrown: unknown = await page
				.navigate('https://bad.example', { timeout: 30_000 })
				.catch((caught: unknown) => caught)
			const elapsed = performance.now() - started

			expect(isBrowserError(thrown)).toBe(true)
			// The wedged stopLoading was abandoned at the short cap, far short of
			// the 30s per-call timeout that would otherwise have bounded it.
			expect(elapsed).toBeGreaterThanOrEqual(BROWSER_STOP_LOADING_TIMEOUT_MS - 50)
			expect(elapsed).toBeLessThan(BROWSER_STOP_LOADING_TIMEOUT_MS * 3)
		}, 10_000)

		it('leaves no dangling timer and no unhandled rejection when Page.navigate fails', async () => {
			const unhandled = createRecorder<[reason: unknown]>()
			process.on('unhandledRejection', unhandled.handler)

			try {
				const { client, transport } = await createConnectedCDPClient()
				replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })
				replyOk(transport, 'Page.stopLoading', {})
				replyOk(transport, 'Page.reload', {})
				scriptEvaluate(
					transport,
					(expression) => expression.includes('location.href'),
					'https://example.com/',
				)

				const page = new BrowserPage(client, 'target-1', 'session-1')
				const started = performance.now()
				await expect(page.navigate('https://bad.example', { timeout: 20 })).rejects.toSatisfy(
					isBrowserError,
				)

				// A load-wait timer left armed by the failed navigate fires 20 ms after
				// that navigate began, and the next load wait is what it would reject.
				const reloaded = page.reload({ timeout: 1_000 })
				await waitForDelay(60)
				expect(performance.now() - started).toBeGreaterThan(20)

				transport.event('Page.loadEventFired', {}, 'session-1')
				await expect(reloaded).resolves.toMatchObject({ url: 'https://example.com/' })

				// Nothing fired or rejected unobserved across that window
				await waitForDelay(10)
				expect(unhandled.calls).toEqual([])
			} finally {
				process.off('unhandledRejection', unhandled.handler)
			}
		})
	})

	describe('read()', () => {
		it('captures in one cached isolated world while evaluate stays in the main world', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/page',
				title: 'Read Test',
				html: '<main><p>Hello World</p></main>',
			})
			scriptEvaluate(transport, (expression) => expression.includes('1 + 1'), 2)
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)

			const reading = await page.read()
			await page.read()
			expect(await page.evaluate('1 + 1')).toBe(2)

			expect(reading.title).toBe('Read Test')
			expect(reading.text().text).toBe('Hello World')
			expect(page.url).toBe('https://example.com/page')
			const worlds = transport.sent.filter(
				(message) => message.method === 'Page.createIsolatedWorld',
			)
			expect(worlds.map((message) => [message.sessionId, message.params?.['frameId']])).toEqual([
				['session-1', 'main-1'],
			])
			expect(
				transport.sent
					.filter((message) => message.method === 'Runtime.evaluate')
					.map((message) => message.params?.['contextId']),
			).toEqual([5, 5, undefined])
		})

		it('drops the cached world when its context is destroyed or every context is cleared', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const contexts = [5, 6, 7]
			transport.onSend('Page.createIsolatedWorld', (message) =>
				transport.reply(message.id, { executionContextId: contexts.shift() }),
			)
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/page',
				title: 'Worlds',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)

			await page.read()
			transport.event('Runtime.executionContextDestroyed', { executionContextId: 99 }, 'session-1')
			await page.read()
			transport.event('Runtime.executionContextDestroyed', { executionContextId: 5 }, 'session-1')
			await page.read()
			transport.event('Runtime.executionContextsCleared', {}, 'session-1')
			await page.read()

			expect(
				transport.sent
					.filter((message) => message.method === 'Runtime.evaluate')
					.map((message) => message.params?.['contextId']),
			).toEqual([5, 5, 6, 7])
		})

		it('marks a reading stale on a cross-document navigation of its frame and of no other frame', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Frames',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)
			const [, child, grandchild] = await page.frames()
			const main = await page.read()
			const childReading = await requireValue(child).read()
			const grandchildReading = await requireValue(grandchild).read()

			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child-1', url: 'https://example.com/child/next' } },
				'session-1',
			)

			expect(childReading.stale).toBe(true)
			expect(grandchildReading.stale).toBe(false)
			expect(main.stale).toBe(false)
		})

		it('marks a reading stale on a same-document navigation of its frame and of no other frame', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Frames',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)
			const [, child, grandchild] = await page.frames()
			const main = await page.read()
			const childReading = await requireValue(child).read()
			const grandchildReading = await requireValue(grandchild).read()

			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'grandchild-1', url: 'https://example.com/grandchild#part' },
				'session-1',
			)

			expect(grandchildReading.stale).toBe(true)
			expect(childReading.stale).toBe(false)
			expect(main.stale).toBe(false)
		})

		it('marks the page reading stale on both navigation kinds of the page frame', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Frames',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)
			const [, child] = await page.frames()
			const before = await page.read()
			const childReading = await requireValue(child).read()

			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'main-1', url: 'https://example.com/#pushed' },
				'session-1',
			)

			expect(before.stale).toBe(true)
			expect(childReading.stale).toBe(false)
			const after = await page.read()
			expect(after.stale).toBe(false)

			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main-1', url: 'https://example.com/next', loaderId: 'loader-next' } },
				'session-1',
			)

			expect(after.stale).toBe(true)
			expect(childReading.stale).toBe(true)
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main-1', loaderId: 'loader-next', name: 'DOMContentLoaded' },
				'session-1',
			)
			expect((await page.read()).stale).toBe(false)
		})

		it('marks a reading stale when its frame detaches or its page closes', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			replyOk(transport, 'Target.closeTarget')
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Frames',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)
			const [, child] = await page.frames()
			const main = await page.read()
			const childReading = await requireValue(child).read()

			transport.event('Page.frameDetached', { frameId: 'child-1' }, 'session-1')

			expect(childReading.stale).toBe(true)
			expect(main.stale).toBe(false)

			await page.close()

			expect(main.stale).toBe(true)
		})

		it('follows an out-of-process frame on its own session until it detaches', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Runtime.runIfWaitingForDebugger')
			const contexts = [84, 85]
			transport.onSend('Page.createIsolatedWorld', (message) =>
				transport.reply(message.id, { executionContextId: contexts.shift() }),
			)
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://other.example/embed',
				title: 'Embed',
				html: '<p>Embedded</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			const sessions = createRecorder<[frame: BrowserFrameInterface]>()
			page.emitter.on('session', sessions.handler)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-oopif',
					targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
				},
				'session-1',
			)
			await waitForCondition('the session event was delivered', () => sessions.count === 1)
			const frame = requireValue(sessions.calls[0]?.[0])

			const first = await frame.read()
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'oopif-7', url: 'https://other.example/embed#part' },
				'session-oopif',
			)
			const second = await frame.read()
			transport.event('Runtime.executionContextsCleared', {}, 'session-oopif')
			await frame.read()
			transport.event(
				'Target.detachedFromTarget',
				{ sessionId: 'session-oopif', targetId: 'oopif-7' },
				'session-1',
			)

			expect(first.stale).toBe(true)
			expect(second.stale).toBe(true)
			const evaluations = transport.sent.filter(
				(message) =>
					message.method === 'Runtime.evaluate' &&
					readCDPExpression(message)?.includes(compileReadFunction()) === true,
			)
			expect(evaluations.map((message) => message.sessionId)).toEqual([
				'session-oopif',
				'session-oopif',
				'session-oopif',
			])
			expect(evaluations.map((message) => message.params?.['contextId'])).toEqual([84, 84, 85])
		})

		it('marks a reading stale when frame detachment arrives on the iframe session', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Runtime.runIfWaitingForDebugger')
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://other.example/embed',
				title: 'Embed',
				html: '<p>Embedded</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			const sessions = createRecorder<[frame: BrowserFrameInterface]>()
			page.emitter.on('session', sessions.handler)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-oopif',
					targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
				},
				'session-1',
			)
			await waitForCondition('the session event was delivered', () => sessions.count === 1)
			const reading = await requireValue(sessions.calls[0]?.[0]).read()
			expect(reading.stale).toBe(false)

			transport.event('Page.frameDetached', { frameId: 'oopif-7' }, 'session-oopif')

			expect(reading.stale).toBe(true)
		})

		it('shares one pending world creation between concurrent reads', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const creations: number[] = []
			transport.onSend('Page.createIsolatedWorld', (message) => creations.push(message.id))
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Home',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1')
			emitDocumentReady(transport, page)

			const reads = Promise.all([page.read(), page.read()])
			await waitForCondition('the creation was sent', () => creations.length > 0)
			const first = creations[0]
			transport.reply(requireValue(first), { executionContextId: 61 })
			await reads

			expect(creations).toHaveLength(1)
			expect(
				transport.sent
					.filter((message) => message.method === 'Runtime.evaluate')
					.map((message) => message.params?.['contextId']),
			).toEqual([61, 61])
		})

		it('discards a world whose creation a context clear overtook', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const creations: number[] = []
			transport.onSend('Page.createIsolatedWorld', (message) => creations.push(message.id))
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Home',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1')
			emitDocumentReady(transport, page)

			const pending = page.read()
			await waitForCondition('the creation was sent', () => creations.length === 1)
			transport.event('Runtime.executionContextsCleared', {}, 'session-1')
			transport.reply(requireValue(creations[0]), { executionContextId: 61 })
			await pending
			const next = page.read()
			await waitForCondition('a fresh creation was sent', () => creations.length === 2)
			transport.reply(requireValue(creations[1]), { executionContextId: 62 })
			await next

			expect(creations).toHaveLength(2)
		})

		it('scopes a context clear to the session that emitted it', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Runtime.runIfWaitingForDebugger')
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
			scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
				url: 'https://example.com/',
				title: 'Home',
				html: '<p>Body</p>',
			})
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
			emitDocumentReady(transport, page)
			const sessions = createRecorder<[frame: BrowserFrameInterface]>()
			page.emitter.on('session', sessions.handler)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-oopif',
					targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
				},
				'session-1',
			)
			await waitForCondition('the session event was delivered', () => sessions.count === 1)
			const iframe = requireValue(sessions.calls[0]?.[0])
			await page.read()
			await iframe.read()
			expect(readCDPParams(transport, 'Page.createIsolatedWorld')).toHaveLength(2)

			transport.event('Runtime.executionContextsCleared', {}, 'session-oopif')
			await page.read()
			expect(readCDPParams(transport, 'Page.createIsolatedWorld')).toHaveLength(2)
			await iframe.read()
			expect(readCDPParams(transport, 'Page.createIsolatedWorld')).toHaveLength(3)
		})

		it('keeps the frame url of a navigation that overtook the capture', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			const captures: number[] = []
			transport.onSend('Runtime.evaluate', (message) => captures.push(message.id))
			const page = new BrowserPage(
				client,
				'target-1',
				'session-1',
				undefined,
				'https://example.com/a',
				'main-1',
			)
			emitDocumentReady(transport, page)

			const pending = page.read()
			await waitForCondition('the capture was sent', () => captures.length === 1)
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'main-1', url: 'https://example.com/b' },
				'session-1',
			)
			transport.reply(requireValue(captures[0]), {
				result: {
					value: { url: 'https://example.com/a', title: 'A', html: '<p>A</p>' },
				},
			})
			const reading = await pending

			expect(reading.url).toBe('https://example.com/a')
			expect(reading.stale).toBe(true)
			expect(page.url).toBe('https://example.com/b')
		})

		it('maps an oversized capture to a coded BrowserResultLimitError', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 5 })
			transport.onSend('Runtime.evaluate', (message) => {
				transport.reply(message.id, {
					exceptionDetails: {
						exception: {
							description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}3500000`,
						},
					},
				})
			})
			const page = new BrowserPage(client, 'target-1', 'session-1')
			emitDocumentReady(transport, page)

			const thrown: unknown = await page.read().catch((caught: unknown) => caught)
			const evaluation = transport.sent.find((message) => message.method === 'Runtime.evaluate')
			expect(evaluation?.params?.['expression']).toBe(
				compileGuardedEvaluateExpression(`(${compileReadFunction()})()`, BROWSER_RESULT_LIMIT),
			)

			expect(isBrowserResultLimitError(thrown)).toBe(true)
			expect(
				thrown instanceof BrowserResultLimitError ? thrown.context?.['length'] : undefined,
			).toBe(3500000)
		})

		it('rejects a read with an aborted signal with its reason and sends nothing', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')
			const reason = new Error('tool cancelled')
			const controller = new AbortController()
			controller.abort(reason)

			await expect(page.read({ signal: controller.signal })).rejects.toBe(reason)
			expect(transport.sent).toEqual([])
		})
	})

	describe('screenshot()', () => {
		it('decodes PNG bytes by default with no writer', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const result = await page.screenshot()

			expect(Array.from(result.bytes)).toEqual([137, 80, 78, 71, 13])
			expect(result.path).toBeUndefined()
		})

		it('decodes JPEG bytes and sends the requested format', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.captureScreenshot', { data: JPEG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const result = await page.screenshot({ format: 'jpeg', quality: 80 })

			expect(Array.from(result.bytes)).toEqual([255, 216, 255, 224])
			const sent = transport.sent.find((m) => m.method === 'Page.captureScreenshot')
			expect(sent?.params).toEqual({ format: 'jpeg', quality: 80, fromSurface: true })
		})

		it('writes to the injected writer only when path is provided', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
			const writer = createRecordingWriter()

			const page = new BrowserPage(client, 'target-1', 'session-1', writer)
			const result = await page.screenshot({ path: '/tmp/shot.png' })

			expect(writer.calls).toHaveLength(1)
			expect(writer.calls[0]?.path).toBe('/tmp/shot.png')
			expect(Array.from(requireValue(writer.calls[0]).data)).toEqual(Array.from(result.bytes))
			expect(result.path).toBe('/tmp/shot.png')
		})

		it('does not write when no path is given even with a writer', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
			const writer = createRecordingWriter()

			const page = new BrowserPage(client, 'target-1', 'session-1', writer)
			await page.screenshot()

			expect(writer.calls).toHaveLength(0)
		})

		it('requests a clip for full-page capture when dimensions resolve', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.getLayoutMetrics', { contentSize: { width: 1000, height: 2000 } })
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.screenshot({ full: true })

			const sent = transport.sent.find((m) => m.method === 'Page.captureScreenshot')
			expect(sent?.params?.['clip']).toEqual({ x: 0, y: 0, width: 1000, height: 2000, scale: 1 })
		})

		it('rejects malformed full-page metrics instead of silently capturing the viewport', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.getLayoutMetrics', {
				cssContentSize: { width: Number.NaN, height: 2000 },
			})
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.screenshot({ full: true })).rejects.toThrow(
				'full-page screenshot metrics are malformed',
			)
			expect(transport.sent.some((message) => message.method === 'Page.captureScreenshot')).toBe(
				false,
			)
		})

		it('throws a BrowserError when no data is returned', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.captureScreenshot', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.screenshot()).rejects.toSatisfy(isBrowserError)
		})
	})

	describe('advanced capture', () => {
		it('applies clip, transparency, animation, caret, and mask controls with cleanup', async () => {
			const { transport, page } = await createBrowserElementFixture({
				evaluation: (message) =>
					transport.reply(message.id, {
						result: {
							value: readCDPExpression(message)?.includes('__orkestrelScreenshotSequence')
								? 'token-1'
								: true,
						},
					}),
			})
			replyOk(transport, 'Emulation.setDefaultBackgroundColorOverride')
			await page.elements.outline()
			const secret = requireValue(page.elements.element('e1'))

			await page.screenshot({
				clip: [10, 20, 300, 200],
				transparent: true,
				animations: false,
				caret: false,
				mask: [secret],
				color: '#123456',
			})

			expect(
				transport.sent.some(
					(message) =>
						message.method === 'Runtime.evaluate' &&
						readCDPExpression(message)?.includes('const rects = [[10,20,20,20]]') === true,
				),
			).toBe(true)

			expect(
				transport.sent.find((message) => message.method === 'Page.captureScreenshot')?.params,
			).toMatchObject({
				format: 'png',
				fromSurface: true,
				captureBeyondViewport: true,
				clip: { x: 10, y: 20, width: 300, height: 200, scale: 1 },
			})
			const background = transport.sent.filter(
				(message) => message.method === 'Emulation.setDefaultBackgroundColorOverride',
			)
			expect(background).toHaveLength(2)
			expect(background[0]?.params).toEqual({ color: { r: 0, g: 0, b: 0, a: 0 } })
			expect(background[1]?.params).toBeUndefined()
		})

		it('rejects the screenshot with the element error when a masked element cannot report a box', async () => {
			const { client, transport, page } = await createBrowserElementFixture({ hidden: true })
			await page.elements.outline()
			const secret = requireValue(page.elements.element('e1'))

			await expect(page.screenshot({ mask: [secret] })).rejects.toSatisfy(isBrowserElementError)

			expect(transport.sent.some((message) => message.method === 'Page.captureScreenshot')).toBe(
				false,
			)
			await client.close()
		})

		it('removes temporary screenshot state when transparent background setup fails', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(
				transport,
				(expression) => expression.includes('__orkestrelScreenshotSequence'),
				'token-1',
			)
			scriptEvaluate(
				transport,
				(expression) => expression.includes('element.getAttribute(attribute)'),
				true,
			)
			transport.onSend('Emulation.setDefaultBackgroundColorOverride', (message) => {
				transport.fail(message.id, 'background failed')
			})
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.screenshot({ transparent: true, animations: false })).rejects.toThrow(
				'background failed',
			)

			expect(
				transport.sent.some(
					(message) =>
						message.method === 'Runtime.evaluate' &&
						typeof message.params?.['expression'] === 'string' &&
						message.params['expression'].includes('element.getAttribute(attribute)'),
				),
			).toBe(true)
			expect(transport.sent.some((message) => message.method === 'Page.captureScreenshot')).toBe(
				false,
			)
		})

		it('prints PDF with validated dimensions, margins, templates, tags, and persistence', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const writer = createRecordingWriter()
			replyOk(transport, 'Page.printToPDF', { data: 'JVBERg==' })
			const page = new BrowserPage(client, 'target-1', 'session-1', writer)

			const result = await page.pdf({
				path: 'report.pdf',
				landscape: true,
				background: true,
				scale: 1.25,
				width: 8.5,
				height: 11,
				margin: { top: 0.5, right: 0.25, bottom: 0.5, left: 0.25 },
				ranges: '1-2',
				header: '<span>Header</span>',
				footer: '<span>Footer</span>',
				tagged: true,
				outline: true,
			})

			expect(Array.from(result.bytes)).toEqual([37, 80, 68, 70])
			expect(writer.calls[0]?.path).toBe('report.pdf')
			expect(
				transport.sent.find((message) => message.method === 'Page.printToPDF')?.params,
			).toMatchObject({
				landscape: true,
				printBackground: true,
				displayHeaderFooter: true,
				scale: 1.25,
				paperWidth: 8.5,
				paperHeight: 11,
				marginTop: 0.5,
				marginRight: 0.25,
				marginBottom: 0.5,
				marginLeft: 0.25,
				pageRanges: '1-2',
				generateTaggedPDF: true,
				generateDocumentOutline: true,
			})
		})

		it('rejects invalid capture combinations and PDF bounds before CDP traffic', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.screenshot({ full: true, clip: [0, 0, 10, 10] })).rejects.toSatisfy(
				isBrowserError,
			)
			await expect(page.screenshot({ format: 'png', quality: 80 })).rejects.toSatisfy(
				isBrowserError,
			)
			await expect(page.pdf({ scale: 3 })).rejects.toSatisfy(isBrowserError)
			expect(transport.sent).toEqual([])
		})
	})

	describe('evaluate()', () => {
		it('returns the evaluated value', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression.includes('1 + 1'), 2)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.evaluate('1 + 1')).toBe(2)
		})

		it('throws a BrowserError when the page reports an exception', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Runtime.evaluate', (message) => {
				transport.reply(message.id, {
					exceptionDetails: { exception: { description: 'ReferenceError: x is not defined' } },
				})
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.evaluate('x')).rejects.toSatisfy(isBrowserError)
		})

		it('wraps the expression with the result-size guard using BROWSER_RESULT_LIMIT', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression.includes('1 + 1'), 2)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.evaluate('1 + 1')

			const sent = transport.sent.find(
				(m) => m.method === 'Runtime.evaluate' && readCDPExpression(m)?.includes('1 + 1') === true,
			)
			const expression = requireValue(readCDPExpression(sent))
			expect(expression).toContain('BROWSER_RESULT_LIMIT')
			expect(expression).toContain(String(BROWSER_RESULT_LIMIT))
		})

		it('maps an oversized result exception to a coded BrowserResultLimitError with length/limit context', async () => {
			const { client, transport } = await createConnectedCDPClient()
			transport.onSend('Runtime.evaluate', (message) => {
				transport.reply(message.id, {
					exceptionDetails: {
						exception: {
							description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000\n    at <anonymous>:1:100`,
						},
					},
				})
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const thrown: unknown = await page.evaluate('bigObject').catch((caught: unknown) => caught)

			expect(isBrowserResultLimitError(thrown)).toBe(true)
			expect(
				thrown instanceof BrowserResultLimitError ? thrown.context?.['length'] : undefined,
			).toBe(4200000)
			expect(
				thrown instanceof BrowserResultLimitError ? thrown.context?.['limit'] : undefined,
			).toBe(BROWSER_RESULT_LIMIT)
		})
	})

	describe('frame() / frames()', () => {
		it('flattens the frame tree main-first with parent/name/url mapping', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const frames = await page.frames()

			expect(frames.map(({ id, parent, name, url }) => ({ id, parent, name, url }))).toEqual([
				{
					id: 'main-1',
					parent: undefined,
					name: undefined,
					url: 'https://example.com/',
				},
				{ id: 'child-1', parent: 'main-1', name: 'child-frame', url: 'https://example.com/child' },
				{
					id: 'grandchild-1',
					parent: 'child-1',
					name: undefined,
					url: 'https://example.com/grandchild',
				},
			])
		})

		it('finds a frame by name', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const frame = await page.frame('child-frame')

			expect(frame?.id).toBe('child-1')
		})

		it('finds a frame by url', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const frame = await page.frame('https://example.com/grandchild')

			expect(frame?.id).toBe('grandchild-1')
		})

		it('returns undefined when no frame matches', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.frame('does-not-exist')).toBeUndefined()
		})

		it('returns an empty frame list on a malformed reply', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Page.getFrameTree', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.frames()).toEqual([])
		})

		it('routes out-of-process iframe operations through the attached child session', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Runtime.runIfWaitingForDebugger')
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
			scriptEvaluate(transport, (expression) => expression.includes('40 + 2'), 42)
			const page = new BrowserPage(client, 'target-1', 'session-1')

			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-oopif',
					targetInfo: { type: 'iframe', targetId: 'child-1' },
				},
				'session-1',
			)
			const frame = await page.frame('child-frame')
			if (frame === undefined) throw new Error('Expected child frame')

			expect(await frame.evaluate('40 + 2')).toBe(42)
			const world = transport.sent.find((message) => message.method === 'Page.createIsolatedWorld')
			expect(world?.sessionId).toBe('session-oopif')
			expect(world?.params?.['frameId']).toBe('child-1')
			expect(
				transport.sent.some(
					(message) => message.method === 'Page.enable' && message.sessionId === 'session-oopif',
				),
			).toBe(true)
		})

		it('falls back to the page session after an iframe child target detaches', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptFrameTree(transport)
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Runtime.runIfWaitingForDebugger')
			replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
			scriptEvaluate(transport, (expression) => expression.includes('6 * 7'), 42)
			const page = new BrowserPage(client, 'target-1', 'session-1')

			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-oopif',
					targetInfo: { type: 'iframe', targetId: 'child-1' },
				},
				'session-1',
			)
			await waitForCondition('the out-of-process frame session enabled Runtime', () =>
				transport.sent.some(
					(message) => message.method === 'Runtime.enable' && message.sessionId === 'session-oopif',
				),
			)
			transport.event(
				'Target.detachedFromTarget',
				{ sessionId: 'session-oopif', targetId: 'child-1' },
				'session-1',
			)
			const frame = await page.frame('child-frame')
			if (frame === undefined) throw new Error('Expected child frame')
			await frame.evaluate('6 * 7')

			const worlds = transport.sent.filter(
				(message) => message.method === 'Page.createIsolatedWorld',
			)
			expect(worlds.at(-1)?.sessionId).toBe('session-1')
		})
	})

	describe('snapshot()', () => {
		it('captures and decodes every document with the requested details', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'DOMSnapshot.captureSnapshot', createDOMSnapshotResult())
			const page = new BrowserPage(client, 'target-1', 'session-1')

			const snapshot = await page.snapshot({
				styles: ['color'],
				paint: true,
				rects: true,
			})

			expect(snapshot.documents).toHaveLength(2)
			expect(snapshot.documents[1]?.frame).toBe('frame-child')
			const div = snapshot.find({ name: 'div' })
			expect(div).toBeDefined()
			if (div === undefined) throw new Error('Snapshot fixture is malformed')
			expect(snapshot.path(div)).toBe('frame("frame-main") > #document:0 > html:1 > body:1 > div:1')
			const request = transport.sent.find(
				(message) => message.method === 'DOMSnapshot.captureSnapshot',
			)
			expect(request?.sessionId).toBe('session-1')
			expect(request?.params).toEqual({
				computedStyles: ['color'],
				includePaintOrder: true,
				includeDOMRects: true,
			})
		})

		it('enforces a caller-provided aggregate node limit', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'DOMSnapshot.captureSnapshot', createDOMSnapshotResult())
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.snapshot({ limit: 8 })).rejects.toBeInstanceOf(BrowserResultLimitError)
		})

		it('rejects malformed protocol results instead of returning partial data', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'DOMSnapshot.captureSnapshot', {})
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.snapshot()).rejects.toThrow('Malformed DOMSnapshot.captureSnapshot result')
		})
	})

	describe('codegen()', () => {
		it('starts a recorder and returns the same instance on repeat calls', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const first = await page.codegen()
			const second = await page.codegen()

			expect(first.started).toBe(true)
			expect(second).toBe(first)
		})
	})

	describe('close()', () => {
		it('marks the page closed and requests target closure', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.closeTarget')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(page.closed).toBe(false)
			await page.close()

			expect(page.closed).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Target.closeTarget')).toBe(true)
		})

		it('is marked closed when the target is externally destroyed', async () => {
			const { client, transport } = await createConnectedCDPClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')

			transport.event('Target.targetDestroyed', { targetId: 'target-1' })

			expect(page.closed).toBe(true)
		})

		it('releases an active recorder when the target is externally destroyed', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')
			replyOk(transport, 'Runtime.removeBinding')
			const page = new BrowserPage(client, 'target-1', 'session-1')
			const codegen = await page.codegen()

			transport.event('Target.targetDestroyed', { targetId: 'target-1' })
			await waitForCondition('the codegen recorder stopped', () => !codegen.started)
			await page.close()

			expect(codegen.started).toBe(false)
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(false)
		})

		it('tears down an active codegen recorder before closing', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Target.setAutoAttach')
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')
			replyOk(transport, 'Runtime.removeBinding')
			replyOk(transport, 'Target.closeTarget')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const codegen = await page.codegen()
			await page.close()

			expect(codegen.started).toBe(false)
		})

		it('shares one target closure across concurrent callers', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.closeTarget')
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await Promise.all([page.close(), page.close()])

			expect(
				transport.sent.filter((message) => message.method === 'Target.closeTarget'),
			).toHaveLength(1)
		})
	})

	describe('destroy()', () => {
		it('detaches the local session without closing the remote target', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.detachFromTarget')
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await page.destroy()

			expect(page.closed).toBe(true)
			expect(transport.sent.some((message) => message.method === 'Target.detachFromTarget')).toBe(
				true,
			)
			expect(transport.sent.some((message) => message.method === 'Target.closeTarget')).toBe(false)
		})

		it('rejects later operations without sending them to a detached session', async () => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.detachFromTarget')
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await page.destroy()
			const sent = transport.sent.length

			await expect(page.title()).rejects.toSatisfy(isBrowserError)
			await expect(page.codegen()).rejects.toSatisfy(isBrowserError)
			expect(transport.sent).toHaveLength(sent)
		})
	})
})

// === BrowserPage emitter options

describe('BrowserPage emitter options', () => {
	it('wires the initial listeners named by on and reports a throwing listener to error', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const messages = createRecorder<[message: BrowserConsoleMessage]>()
		const failures = createRecorder<[error: unknown, event: string]>()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ on: { console: messages.handler }, error: failures.handler },
		)
		page.emitter.on('console', throwListenerError)

		transport.event(
			'Runtime.consoleAPICalled',
			{ type: 'log', timestamp: 1, args: [{ value: 'hello' }] },
			'session-1',
		)

		expect(messages.calls[0]?.[0]).toMatchObject({ level: 'log', text: 'hello' })
		expect(failures.calls.map(([, event]) => event)).toEqual(['console'])
	})
})

// === BrowserPage events

describe('BrowserPage events', () => {
	it('emits typed dialogs that can be accepted exactly once', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.handleJavaScriptDialog')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const dialogs = createRecorder<[dialog: BrowserDialogInterface]>()
		page.emitter.on('dialog', dialogs.handler)

		transport.event(
			'Page.javascriptDialogOpening',
			{ type: 'prompt', message: 'Name?', defaultPrompt: 'Ada' },
			'session-1',
		)
		const dialog = dialogs.calls[0]?.[0]
		expect(dialog).toMatchObject({ category: 'prompt', message: 'Name?', default: 'Ada' })
		await dialog?.accept('Grace')

		expect(
			transport.sent.find((message) => message.method === 'Page.handleJavaScriptDialog')?.params,
		).toEqual({ accept: true, promptText: 'Grace' })
	})

	it('allows a dialog response to be retried after protocol failure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let attempts = 0
		transport.onSend('Page.handleJavaScriptDialog', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'dialog failed')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const dialogs = createRecorder<[dialog: BrowserDialogInterface]>()
		page.emitter.on('dialog', dialogs.handler)
		transport.event(
			'Page.javascriptDialogOpening',
			{ type: 'confirm', message: 'Continue?' },
			'session-1',
		)
		const dialog = dialogs.calls[0]?.[0]

		await expect(dialog?.accept()).rejects.toThrow('dialog failed')
		await expect(dialog?.dismiss()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})

	it('emits file choosers that set selected paths by backend node id', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'DOM.setFileInputFiles')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const choosers = createRecorder<[chooser: BrowserFileChooserInterface]>()
		page.emitter.on('chooser', choosers.handler)

		transport.event(
			'Page.fileChooserOpened',
			{ backendNodeId: 9, mode: 'selectMultiple' },
			'session-1',
		)
		const chooser = choosers.calls[0]?.[0]
		expect(chooser?.multiple).toBe(true)
		await chooser?.upload(['one.txt', 'two.txt'])

		expect(
			transport.sent.find((message) => message.method === 'DOM.setFileInputFiles')?.params,
		).toEqual({ backendNodeId: 9, files: ['one.txt', 'two.txt'] })
	})

	it('allows a file chooser response to be retried after protocol failure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let attempts = 0
		transport.onSend('DOM.setFileInputFiles', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'chooser failed')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const choosers = createRecorder<[chooser: BrowserFileChooserInterface]>()
		page.emitter.on('chooser', choosers.handler)
		transport.event(
			'Page.fileChooserOpened',
			{ backendNodeId: 9, mode: 'selectSingle' },
			'session-1',
		)
		const chooser = choosers.calls[0]?.[0]

		await expect(chooser?.upload(['one.txt'])).rejects.toThrow('chooser failed')
		await expect(chooser?.dismiss()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})

	it('decodes console calls and uncaught page errors', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const messages = createRecorder<[message: BrowserConsoleMessage]>()
		const errors = createRecorder<[error: BrowserPageError]>()
		page.emitter.on('console', messages.handler)
		page.emitter.on('error', errors.handler)

		transport.event(
			'Runtime.consoleAPICalled',
			{
				type: 'log',
				timestamp: 1,
				args: [{ value: 'hello' }, { value: 2 }],
				stackTrace: {
					callFrames: [
						{
							url: 'https://example.com/app.js',
							functionName: 'main',
							lineNumber: 1,
							columnNumber: 2,
						},
					],
				},
			},
			'session-1',
		)
		transport.event(
			'Runtime.exceptionThrown',
			{
				timestamp: 2,
				exceptionDetails: {
					text: 'Uncaught',
					exception: { description: 'Error: boom' },
					stackTrace: { callFrames: [] },
				},
			},
			'session-1',
		)

		expect(messages.calls[0]?.[0]).toMatchObject({
			level: 'log',
			text: 'hello 2',
			values: ['hello', 2],
		})
		expect(errors.calls[0]?.[0]).toMatchObject({ message: 'Error: boom', timestamp: 2 })
	})

	it('tracks download progress and completion by guid', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			'frame-1',
			'context-1',
		)
		const downloads = createRecorder<[download: BrowserDownloadInterface]>()
		page.emitter.on('download', downloads.handler)

		transport.event('Browser.downloadWillBegin', {
			guid: 'download-1',
			url: 'https://example.com/file',
			suggestedFilename: 'file.txt',
			frameId: 'frame-1',
		})
		const download = downloads.calls[0]?.[0]
		transport.event('Browser.downloadProgress', {
			guid: 'download-1',
			state: 'inProgress',
			receivedBytes: Number.NaN,
			totalBytes: 10,
		})
		expect(download?.status).toBe('pending')
		transport.event('Browser.downloadProgress', {
			guid: 'download-1',
			state: 'completed',
			receivedBytes: 10,
			totalBytes: 10,
			filePath: 'C:\\downloads\\file.txt',
		})

		expect(download).toMatchObject({
			id: 'download-1',
			name: 'file.txt',
			status: 'complete',
			received: 10,
			total: 10,
			path: 'C:\\downloads\\file.txt',
		})
	})

	it('turns a protocol download cancel into aborted with one abort event and no complete', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			'frame-1',
			'context-1',
		)
		const downloads = createRecorder<[download: BrowserDownloadInterface]>()
		page.emitter.on('download', downloads.handler)

		transport.event('Browser.downloadWillBegin', {
			guid: 'download-2',
			url: 'https://example.com/report',
			suggestedFilename: 'report.txt',
			frameId: 'frame-1',
		})
		const download = requireValue(downloads.calls[0]?.[0])
		const aborts = createRecorder<[]>()
		const completes = createRecorder<[path: string | undefined]>()
		download.emitter.on('abort', aborts.handler)
		download.emitter.on('complete', completes.handler)
		expect(download.status).toBe('pending')

		transport.event('Browser.downloadProgress', {
			guid: 'download-2',
			state: 'canceled',
			receivedBytes: 3,
			totalBytes: 10,
		})

		expect(download.status).toBe('aborted')
		expect(aborts.calls).toHaveLength(1)
		expect(completes.calls).toHaveLength(0)
	})

	it('promotes and resumes attached worker targets after enabling their Runtime session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const workers = createRecorder<[worker: BrowserWorkerInterface]>()
		page.emitter.on('worker', workers.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'worker-session',
				targetInfo: {
					targetId: 'worker-1',
					type: 'worker',
					url: 'https://example.com/worker.js',
				},
			},
			'session-1',
		)
		await waitForCondition('the worker event was delivered', () => workers.count === 1)
		expect(readCDPSessionMethods(transport, 'worker-session')).toEqual([
			'Runtime.enable',
			'Runtime.runIfWaitingForDebugger',
		])

		expect(workers.calls[0]?.[0]).toMatchObject({
			id: 'worker-1',
			category: 'worker',
			url: 'https://example.com/worker.js',
		})

		transport.event(
			'Target.detachedFromTarget',
			{ targetId: 'worker-1', sessionId: 'worker-session' },
			'session-1',
		)
		await expect(workers.calls[0]?.[0].evaluate('1')).rejects.toThrow('Browser worker is closed')
	})

	it('creates popup pages with opener identity and initialized protocol domains, and resumes them after the domains', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'popup-frame', url: 'https://example.com/popup' } },
		})
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Page.setInterceptFileChooserDialog')
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const popups = createRecorder<[page: BrowserPageInterface]>()
		page.emitter.on('popup', popups.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'popup-session',
				targetInfo: {
					targetId: 'popup-1',
					type: 'page',
					url: 'https://example.com/popup',
				},
			},
			'session-1',
		)
		await waitForCondition('the popup event was delivered', () => popups.count === 1)

		const popup = popups.calls[0]?.[0]
		expect(popup).toMatchObject({
			target: 'popup-1',
			url: 'https://example.com/popup',
		})
		expect(popup?.opener).toBe(page)
		expect(readCDPSessionMethods(transport, 'popup-session')).toEqual([
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Page.getFrameTree',
			'Target.setAutoAttach',
			'Page.setInterceptFileChooserDialog',
			'Network.enable',
			'Runtime.runIfWaitingForDebugger',
		])
		expect(readCDPParams(transport, 'Target.setAutoAttach').at(-1)).toEqual({
			autoAttach: true,
			waitForDebuggerOnStart: true,
			flatten: true,
		})
		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Page.setLifecycleEventsEnabled' &&
					message.sessionId === 'popup-session' &&
					message.params?.['enabled'] === true,
			),
		).toBe(true)
	})

	it('attaches a page it opened that discovery reports on the browser session and reads the committed URL from its frame tree', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Target.attachToTarget', { sessionId: 'popup-session' })
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'popup-frame', url: 'https://example.com/popup' } },
		})
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Page.setInterceptFileChooserDialog')
		replyOk(transport, 'Network.enable')
		replyOk(transport, 'Target.setDiscoverTargets')
		let sequence = 0
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => `e${++sequence}`,
		)
		const popups = createRecorder<[page: BrowserPageInterface]>()
		page.emitter.on('popup', popups.handler)

		transport.event('Target.targetCreated', {
			targetInfo: {
				targetId: 'popup-1',
				type: 'page',
				url: '',
				openerId: 'target-1',
				browserContextId: 'default',
			},
		})
		await waitForCondition('the popup event was delivered', () => popups.count === 1)

		expect(popups.calls[0]?.[0]).toMatchObject({
			target: 'popup-1',
			url: 'https://example.com/popup',
			opener: page,
		})
		expect(
			transport.sent
				.filter((message) => message.method === 'Target.attachToTarget')
				.map((message) => [message.params, message.sessionId]),
		).toEqual([[{ targetId: 'popup-1', flatten: true }, undefined]])
	})

	it('refuses a second live page for a held target on the same session, and forgets held targets and waiting reports when the connection ends', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(transport)
		const reference = createReferenceSequence()
		const held = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			reference,
		)
		const refusal = captureError(
			() =>
				new BrowserPage(
					client,
					'target-1',
					'session-1',
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					reference,
				),
		)
		expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_TARGET_HELD')
		transport.event('Target.targetCreated', {
			targetInfo: { targetId: 'popup', type: 'page', url: '', attached: false, openerId: 'later' },
		})

		await client.close()
		const replacement = new BrowserPage(
			client,
			'target-1',
			'session-2',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			reference,
		)
		await client.connect()
		const later = new BrowserPage(
			client,
			'later',
			'session-3',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			reference,
		)
		await waitForDelay(20)

		expect([held.closed, replacement.closed, later.closed]).toEqual([false, false, false])
		expect(transport.sent.filter((message) => message.method === 'Target.attachToTarget')).toEqual(
			[],
		)
	})

	it('publishes the popup of a page constructed directly with an opener and no ready', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
			'Page.setInterceptFileChooserDialog',
			'Network.enable',
		])
			replyOk(transport, method)
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'frame-c', url: 'https://example.com/c' } },
		})
		const opener = new BrowserPage(client, 'a', 'session-a')
		const page = new BrowserPage(
			client,
			'b',
			'session-b',
			undefined,
			undefined,
			undefined,
			undefined,
			opener,
		)
		const popups = createRecorder<[page: BrowserPageInterface]>()
		page.emitter.on('popup', popups.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-c',
				targetInfo: { targetId: 'c', type: 'page', url: 'https://example.com/c' },
			},
			'session-b',
		)
		await waitForCondition('the page emits its popup', () => popups.count === 1)

		expect(popups.calls[0]?.[0]).toMatchObject({ target: 'c', opener: page })
		expect(page.opener).toBe(opener)
	})

	it.each([
		['answered', false],
		['refused', true],
	] as const)(
		'destroys a popup whose setup fails only after its resume is %s',
		async (_reply, refused) => {
			const { client, transport } = await createConnectedCDPClient()
			const resumes: CDPSentMessage[] = []
			replyOk(transport, 'Page.enable')
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Page.setLifecycleEventsEnabled')
			replyOk(transport, 'Page.getFrameTree', {
				frameTree: { frame: { id: 'popup-frame', url: 'https://example.com/popup' } },
			})
			transport.onSend('Target.setAutoAttach', (message) =>
				transport.fail(message.id, 'Target closed'),
			)
			replyOk(transport, 'Target.detachFromTarget')
			transport.onSend('Runtime.runIfWaitingForDebugger', (message) => resumes.push(message))
			const page = new BrowserPage(client, 'target-1', 'session-1')
			const popups = createRecorder<[page: BrowserPageInterface]>()
			page.emitter.on('popup', popups.handler)
			try {
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-child',
						targetInfo: { targetId: 'popup-1', type: 'page', url: 'https://example.com/popup' },
					},
					'session-1',
				)
				await waitForCondition('the popup resume is withheld', () => resumes.length === 1)
				await waitForDelay(20)
				const resume = requireValue(resumes[0])
				expect(transport.sent.slice(transport.sent.indexOf(resume) + 1)).toEqual([])
				if (refused) transport.fail(resume.id, 'Target closed')
				else transport.reply(resume.id, {})
				await waitForCondition('the popup session detaches', () =>
					transport.sent.some((message) => message.method === 'Target.detachFromTarget'),
				)
				expect([
					popups.count,
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId]),
					readCDPSessionMethods(transport, 'popup-child').slice(-2),
				]).toEqual([
					0,
					[['popup-child', 'session-1']],
					['Runtime.runIfWaitingForDebugger', 'Target.detachFromTarget'],
				])
			} finally {
				await client.close()
			}
		},
	)

	it.each([
		['answered', false],
		['refused', true],
	] as const)(
		'detaches through the page session a child frame or worker session whose setup fails only after its resume is %s, and enables it no further',
		async (_reply, refused) => {
			const { client, transport } = await createConnectedCDPClient()
			const resumes: CDPSentMessage[] = []
			transport.onSend('Page.enable', (message) => {
				if (message.sessionId === 'frame-child') transport.fail(message.id, 'Target closed')
				else transport.reply(message.id, {})
			})
			transport.onSend('Runtime.enable', (message) => {
				if (message.sessionId === 'worker-child') transport.fail(message.id, 'Target closed')
				else transport.reply(message.id, {})
			})
			replyOk(transport, 'Target.detachFromTarget')
			transport.onSend('Runtime.runIfWaitingForDebugger', (message) => resumes.push(message))
			const page = new BrowserPage(client, 'target-1', 'session-1')
			try {
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'frame-child',
						targetInfo: { targetId: 'frame-1', type: 'iframe', url: 'https://example.com/frame' },
					},
					'session-1',
				)
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'worker-child',
						targetInfo: { targetId: 'worker-1', type: 'worker', url: 'https://example.com/w.js' },
					},
					'session-1',
				)
				await waitForCondition('both resumes are withheld', () => resumes.length === 2)
				await waitForDelay(20)
				expect(
					transport.sent.filter((message) => message.method === 'Target.detachFromTarget'),
				).toEqual([])
				for (const resume of resumes)
					if (refused) transport.fail(resume.id, 'Target closed')
					else transport.reply(resume.id, {})
				await waitForCondition(
					'both child sessions detach',
					() =>
						transport.sent.filter((message) => message.method === 'Target.detachFromTarget')
							.length === 2,
				)
				await waitForDelay(20)
				expect([
					transport.sent
						.filter((message) => message.method === 'Target.detachFromTarget')
						.map((message) => [message.params?.['sessionId'], message.sessionId])
						.sort(),
					['frame-child', 'worker-child'].map((session) =>
						readCDPSessionMethods(transport, session),
					),
					page.closed,
				]).toEqual([
					[
						['frame-child', 'session-1'],
						['worker-child', 'session-1'],
					],
					[
						['Page.enable', 'Runtime.runIfWaitingForDebugger', 'Target.detachFromTarget'],
						['Runtime.enable', 'Runtime.runIfWaitingForDebugger', 'Target.detachFromTarget'],
					],
					false,
				])
			} finally {
				await client.close()
			}
		},
	)

	it('emits frame attach/detach and crash lifecycle events', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const attached = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		const crashed = createRecorder<[]>()
		page.emitter.on('attach', attached.handler)
		page.emitter.on('detach', detached.handler)
		page.emitter.on('crash', crashed.handler)

		transport.event(
			'Page.frameAttached',
			{ frameId: 'frame-2', parentFrameId: 'frame-1' },
			'session-1',
		)
		transport.event('Page.frameDetached', { frameId: 'frame-2' }, 'session-1')
		transport.event('Inspector.targetCrashed', {}, 'session-1')

		expect(attached.calls[0]?.[0]).toMatchObject({ id: 'frame-2', parent: 'frame-1' })
		expect(detached.calls).toEqual([['frame-2']])
		expect(crashed.count).toBe(1)
	})

	it('forwards request, response, failure, and WebSocket entities onto the page emitter', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const requests = createRecorder<[request: BrowserRequest]>()
		const responses = createRecorder<[response: BrowserResponse]>()
		const failures = createRecorder<[failure: BrowserRequestFailure]>()
		const sockets = createRecorder<[socket: BrowserWebSocketInterface]>()
		page.emitter.on('request', requests.handler)
		page.emitter.on('response', responses.handler)
		page.emitter.on('failure', failures.handler)
		page.emitter.on('socket', sockets.handler)
		await page.network.start()

		transport.event(
			'Network.requestWillBeSent',
			{
				requestId: 'request-1',
				request: { url: 'https://example.com/', method: 'GET', headers: {} },
			},
			'session-1',
		)
		transport.event(
			'Network.responseReceived',
			{
				requestId: 'request-1',
				loaderId: 'loader-1',
				timestamp: 1,
				response: {
					url: 'https://example.com/',
					status: 200,
					statusText: 'OK',
					headers: {},
					mimeType: 'text/html',
					protocol: 'h2',
				},
			},
			'session-1',
		)
		transport.event(
			'Network.loadingFailed',
			{ requestId: 'request-2', errorText: 'net::ERR_FAILED' },
			'session-1',
		)
		transport.event(
			'Network.webSocketCreated',
			{ requestId: 'socket-1', url: 'wss://example.com/socket' },
			'session-1',
		)

		expect(requests.calls[0]?.[0]).toMatchObject({ id: 'request-1', method: 'GET' })
		expect(responses.calls[0]?.[0]).toMatchObject({ id: 'request-1', status: 200 })
		expect(failures.calls[0]?.[0]).toMatchObject({
			id: 'request-2',
			error: 'net::ERR_FAILED',
		})
		expect(sockets.calls[0]?.[0]).toMatchObject({
			id: 'socket-1',
			url: 'wss://example.com/socket',
		})
	})
})

describe('BrowserPage navigation and session events', () => {
	it('emits a cross-document payload for the page frame and nothing for a child frame', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const navigations = createRecorder<[url: string, same: boolean]>()
		page.emitter.on('navigate', navigations.handler)

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'child-9', url: 'https://example.com/child' } },
			'session-1',
		)
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'frame-1', url: 'https://example.com/next' } },
			'session-1',
		)

		expect(navigations.calls).toEqual([['https://example.com/next', false]])
		expect(page.url).toBe('https://example.com/next')
	})

	it('updates the url and emits a same-document payload outside a navigation wait', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const navigations = createRecorder<[url: string, same: boolean]>()
		page.emitter.on('navigate', navigations.handler)

		transport.event(
			'Page.navigatedWithinDocument',
			{ frameId: 'child-9', url: 'https://example.com/#child' },
			'session-1',
		)
		transport.event(
			'Page.navigatedWithinDocument',
			{ frameId: 'frame-1', url: 'https://example.com/#pushed' },
			'session-1',
		)

		expect(navigations.calls).toEqual([['https://example.com/#pushed', true]])
		expect(page.url).toBe('https://example.com/#pushed')
	})

	it('emits session after both domains enable, lists the frame beside the tree, and drops it on detach', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
		scriptEvaluate(transport, (expression) => expression.includes('40 + 2'), 42)
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-oopif',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
			},
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		expect(readCDPSessionMethods(transport, 'session-oopif')).toEqual([
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
			'Page.getFrameTree',
		])
		expect(readCDPParams(transport, 'Target.setAutoAttach').at(-1)).toEqual({
			autoAttach: true,
			waitForDebuggerOnStart: true,
			flatten: true,
			filter: [{ type: 'iframe' }],
		})
		const frame = requireValue(sessions.calls[0]?.[0])
		expect(frame.id).toBe('oopif-7')
		expect(frame.url).toBe('https://other.example/embed')
		expect(await frame.evaluate('40 + 2')).toBe(42)
		expect(
			transport.sent.findLast((message) => message.method === 'Runtime.evaluate')?.sessionId,
		).toBe('session-oopif')
		const listed = (await page.frames()).map((entry) => entry.id)
		expect(listed).toContain('oopif-7')
		expect(listed.length).toBeGreaterThan(1)

		transport.event(
			'Target.detachedFromTarget',
			{ sessionId: 'session-oopif', targetId: 'oopif-7' },
			'session-1',
		)
		expect((await page.frames()).map((entry) => entry.id)).not.toContain('oopif-7')
	})

	it('emits no session when the iframe domain enable fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		transport.onSend('Page.enable', (message) => transport.fail(message.id, 'enable failed'))
		replyOk(transport, 'Target.detachFromTarget')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7' } },
			'session-1',
		)
		await waitForCondition('the failed session detached', () =>
			transport.sent.some((message) => message.method === 'Target.detachFromTarget'),
		)

		expect(sessions.count).toBe(0)
		expect((await page.frames()).map((entry) => entry.id)).not.toContain('oopif-7')
	})
})

describe('BrowserPage out-of-process frame sessions', () => {
	it('catches a swap detach between the attach and its enable completion dropping the frame session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		const enables: number[] = []
		transport.onSend('Page.enable', (message) => enables.push(message.id))
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
		scriptEvaluate(transport, (expression) => expression.includes('40 + 2'), 42)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		page.emitter.on('session', sessions.handler)
		page.emitter.on('detach', detached.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		transport.event('Page.frameDetached', { frameId: 'oopif-7', reason: 'swap' }, 'session-1')
		transport.reply(requireValue(enables[0]), {})
		await waitForCondition('the session event was delivered', () => sessions.count === 1)
		await waitForDelay(10)

		expect(sessions.count).toBe(1)
		expect(detached.count).toBe(0)
		expect((await page.frames()).map((entry) => entry.id)).toContain('oopif-7')
		expect(await requireValue(sessions.calls[0]?.[0]).evaluate('40 + 2')).toBe(42)
		expect(
			transport.sent.findLast((message) => message.method === 'Runtime.evaluate')?.sessionId,
		).toBe('session-oopif')
	})

	it('catches a swap detach before the attach emitting detach or dropping the frame session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
		scriptEvaluate(transport, (expression) => expression.includes('40 + 2'), 42)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		page.emitter.on('session', sessions.handler)
		page.emitter.on('detach', detached.handler)

		transport.event('Page.frameDetached', { frameId: 'oopif-7', reason: 'swap' }, 'session-1')
		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)
		await waitForDelay(10)

		expect(sessions.count).toBe(1)
		expect(detached.count).toBe(0)
		expect((await page.frames()).map((entry) => entry.id)).toContain('oopif-7')
		expect(await requireValue(sessions.calls[0]?.[0]).evaluate('40 + 2')).toBe(42)
		expect(
			transport.sent.findLast((message) => message.method === 'Runtime.evaluate')?.sessionId,
		).toBe('session-oopif')
	})

	it('catches a remove detach between the attach and its enable completion keeping the frame session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		const enables: number[] = []
		transport.onSend('Page.enable', (message) => enables.push(message.id))
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		page.emitter.on('session', sessions.handler)
		page.emitter.on('detach', detached.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		transport.event('Page.frameDetached', { frameId: 'oopif-7', reason: 'remove' }, 'session-1')
		transport.reply(requireValue(enables[0]), {})
		await waitForCondition('the frame session enabled Runtime', () =>
			transport.sent.some(
				(message) => message.method === 'Runtime.enable' && message.sessionId === 'session-oopif',
			),
		)
		await waitForDelay(10)

		expect(sessions.count).toBe(0)
		expect(detached.calls).toEqual([['oopif-7']])
		expect((await page.frames()).map((entry) => entry.id)).not.toContain('oopif-7')
	})

	it('catches a swap detach keeping the swapped frame references while dropping its session', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const main = requireValue(page.elements.element('e1'))
			const child = requireValue(page.elements.element('e6'))
			expect(child.name).toBe('Save')

			transport.event('Page.frameDetached', { frameId: 'child', reason: 'swap' }, 'session-main')

			expect(page.elements.element('e6')).toBeUndefined()
			await expect(child.click()).rejects.toMatchObject({
				code: 'BROWSER_ELEMENT_ERROR',
				context: { reference: 'e6', reason: 'GONE' },
				message: expect.stringContaining('look'),
			})
			expect(page.elements.element('e1')).toBe(main)
			const captures = transport.sent.length
			await page.elements.outline()
			expect(
				transport.sent
					.slice(captures)
					.filter(
						(message) =>
							message.method === 'Accessibility.getFullAXTree' &&
							message.params?.['frameId'] === 'child',
					)
					.map((message) => message.sessionId),
			).toEqual(['session-child'])
			expect(page.elements.elements().map((element) => element.name)).toContain('Save')
		} finally {
			await client.close()
		}
	})

	it('catches the frame list keeping the attach URL after the frame session navigates', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'oopif-7', parentId: 'main-1', url: 'https://other.example/embed' } },
			'session-oopif',
		)

		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/embed',
		)
		expect((await page.frame('https://other.example/embed'))?.id).toBe('oopif-7')
	})

	it('catches the attach continuation overwriting a navigation that preceded its enable completion', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(
			transport,
			new Map([
				[
					'session-oopif',
					{
						id: 'oopif-7',
						parentId: 'main-1',
						name: 'checkout',
						url: 'https://other.example/start',
					},
				],
			]),
		)
		const enables: number[] = []
		transport.onSend('Page.enable', (message) => enables.push(message.id))
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'oopif-7', parentId: 'main-1', url: 'https://other.example/embed' } },
			'session-oopif',
		)
		transport.reply(requireValue(enables[0]), {})
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		expect(
			transport.sent
				.filter((message) => message.method === 'Page.getFrameTree')
				.map((message) => message.sessionId),
		).toEqual(['session-oopif'])
		expect(requireValue(sessions.calls[0]?.[0]).url).toBe('https://other.example/embed')
		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/embed',
		)
	})

	it('catches a navigation of another frame overwriting the out-of-process frame URL', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-oopif',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
			},
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'nested-3', parentId: 'oopif-7', url: 'https://other.example/nested' } },
			'session-oopif',
		)
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'child-1', parentId: 'main-1', url: 'https://example.com/moved' } },
			'session-1',
		)

		const frames = await page.frames()
		expect(frames.find((entry) => entry.id === 'oopif-7')?.url).toBe('https://other.example/embed')
		expect(frames.map((entry) => entry.url)).not.toContain('https://other.example/nested')
	})

	it('catches the frame list keeping the attach URL when the first commit preceded the frame session enable', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.getFrameTree', (message) =>
			transport.reply(message.id, {
				frameTree: {
					frame:
						message.sessionId === 'session-oopif'
							? {
									id: 'oopif-7',
									parentId: 'main-1',
									name: 'checkout',
									url: 'https://other.example/embed',
								}
							: { id: 'main-1', url: 'https://example.com/' },
				},
			}),
		)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		expect(
			transport.sent
				.filter((message) => message.method === 'Page.getFrameTree')
				.map((message) => message.sessionId),
		).toEqual(['session-oopif'])
		const frame = requireValue(sessions.calls[0]?.[0])
		expect([frame.id, frame.name, frame.url]).toEqual([
			'oopif-7',
			'checkout',
			'https://other.example/embed',
		])
		expect((await page.frames()).map((entry) => [entry.id, entry.name, entry.url])).toEqual([
			['main-1', undefined, 'https://example.com/'],
			['oopif-7', 'checkout', 'https://other.example/embed'],
		])
	})

	it('catches a frame tree refusal between the enable and the read blocking publication', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.getFrameTree', (message) => {
			if (message.sessionId === 'session-oopif')
				transport.fail(message.id, 'Session with given id not found.')
			else
				transport.reply(message.id, {
					frameTree: { frame: { id: 'main-1', url: 'https://example.com/' } },
				})
		})
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-oopif',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/start' },
			},
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		expect(requireValue(sessions.calls[0]?.[0]).url).toBe('https://other.example/start')
		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/start',
		)
	})

	it('catches the frame tree snapshot overwriting a newer navigation delivered in the same read', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.getFrameTree', (message) => {
			if (message.sessionId !== 'session-oopif') {
				transport.reply(message.id, FRAME_TREE_FIXTURE)
				return
			}
			transport.reply(message.id, {
				frameTree: {
					frame: { id: 'oopif-7', parentId: 'main-1', url: 'https://other.example/start' },
				},
			})
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'oopif-7', parentId: 'main-1', url: 'https://other.example/next' } },
				'session-oopif',
			)
		})
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-oopif', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		expect(
			transport.sent
				.filter((message) => message.method === 'Page.getFrameTree')
				.map((message) => message.sessionId),
		).toEqual(['session-oopif'])
		expect(requireValue(sessions.calls[0]?.[0]).url).toBe('https://other.example/next')
		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/next',
		)
	})

	it('catches a superseded session detach deleting the frame its replacement owns', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		const held: number[] = []
		transport.onSend('Page.enable', (message) => {
			if (message.sessionId === 'session-first') held.push(message.id)
			else transport.reply(message.id, {})
		})
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Target.detachFromTarget')
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 84 })
		scriptEvaluate(transport, (expression) => expression.includes('40 + 2'), 42)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)

		transport.event(
			'Target.attachedToTarget',
			{ sessionId: 'session-first', targetInfo: { type: 'iframe', targetId: 'oopif-7', url: '' } },
			'session-1',
		)
		transport.event('Page.frameDetached', { frameId: 'oopif-7', reason: 'swap' }, 'session-1')
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-second',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
			},
			'session-1',
		)
		transport.event(
			'Target.detachedFromTarget',
			{ sessionId: 'session-first', targetId: 'oopif-7' },
			'session-1',
		)
		await waitForCondition(
			'the replacement session event was delivered',
			() => sessions.count === 1,
		)
		transport.reply(requireValue(held[0]), {})
		await waitForDelay(10)

		expect(sessions.count).toBe(1)
		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/embed',
		)
		expect(await requireValue(sessions.calls[0]?.[0]).evaluate('40 + 2')).toBe(42)
		expect(
			transport.sent.findLast((message) => message.method === 'Runtime.evaluate')?.sessionId,
		).toBe('session-second')
	})

	it('catches a superseded session navigation overwriting the URL its replacement owns', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-first',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/first' },
			},
			'session-1',
		)
		await waitForCondition('the first session event was delivered', () => sessions.count === 1)
		transport.event('Page.frameDetached', { frameId: 'oopif-7', reason: 'swap' }, 'session-1')
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-second',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/second' },
			},
			'session-1',
		)
		await waitForCondition('the second session event was delivered', () => sessions.count === 2)

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'oopif-7', url: 'https://other.example/stale' } },
			'session-first',
		)
		const stale = (await page.frames()).find((entry) => entry.id === 'oopif-7')?.url
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'oopif-7', url: 'https://other.example/fresh' } },
			'session-second',
		)
		const fresh = (await page.frames()).filter((entry) => entry.id === 'oopif-7')

		expect(stale).toBe('https://other.example/second')
		expect(fresh.map((entry) => entry.url)).toEqual(['https://other.example/fresh'])
	})

	it('catches a same-document navigation of the frame session leaving its listed URL stale', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptFrameTree(transport)
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'session-oopif',
				targetInfo: { type: 'iframe', targetId: 'oopif-7', url: 'https://other.example/embed' },
			},
			'session-1',
		)
		await waitForCondition('the session event was delivered', () => sessions.count === 1)

		transport.event(
			'Page.navigatedWithinDocument',
			{ frameId: 'oopif-7', url: 'https://other.example/embed#review' },
			'session-oopif',
		)

		expect((await page.frames()).find((entry) => entry.id === 'oopif-7')?.url).toBe(
			'https://other.example/embed#review',
		)
		expect((await page.frame('https://other.example/embed#review'))?.id).toBe('oopif-7')
	})
})

describe('BrowserPage history under the back-forward cache', () => {
	it.each(BROWSER_HISTORY_RESTORE_CASES)(
		'catches %s() under its default load condition waiting past a restore that fires no load event',
		async (direction, current, restored) => {
			const { client, transport } = await createConnectedCDPClient()
			scriptBrowserHistory(transport, current)
			transport.onSend('Page.navigateToHistoryEntry', (message) => {
				transport.reply(message.id, {})
				transport.event(
					'Page.frameNavigated',
					{
						type: 'BackForwardCacheRestore',
						frame: { id: 'frame-1', url: restored, loaderId: 'restored' },
					},
					message.sessionId,
				)
			})
			scriptEvaluate(transport, (expression) => expression.includes('location.href'), restored)
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')

			await expect(page[direction]({ timeout: 500 })).resolves.toMatchObject({
				url: restored,
				same: false,
			})
			expect(page.url).toBe(restored)
		},
	)

	it('catches back() under the idle condition resolving on a restore before its network idles', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 1)
		replyOk(transport, 'Page.navigateToHistoryEntry')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/form',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const settled = createRecorder<[]>()
		const going = page.back({ condition: 'idle', timeout: 2_000 }).finally(settled.handler)
		await waitForCondition('the history entry was requested', () =>
			transport.sent.some((message) => message.method === 'Page.navigateToHistoryEntry'),
		)

		transport.event(
			'Page.frameNavigated',
			{
				type: 'BackForwardCacheRestore',
				frame: { id: 'frame-1', url: 'https://example.com/form', loaderId: 'restored' },
			},
			'session-1',
		)
		await waitForDelay(20)
		expect(settled.count).toBe(0)

		transport.event(
			'Page.lifecycleEvent',
			{ frameId: 'frame-1', loaderId: 'restored', name: 'networkIdle' },
			'session-1',
		)
		await expect(going).resolves.toMatchObject({ url: 'https://example.com/form' })
	})

	it('catches back() under its default load condition resolving at an ordinary commit', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 1)
		replyOk(transport, 'Page.navigateToHistoryEntry')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/form',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const settled = createRecorder<[]>()
		const going = page.back({ timeout: 2_000 }).finally(settled.handler)
		await waitForCondition('the history entry was requested', () =>
			transport.sent.some((message) => message.method === 'Page.navigateToHistoryEntry'),
		)

		transport.event(
			'Page.frameNavigated',
			{
				type: 'Navigation',
				frame: { id: 'frame-1', url: 'https://example.com/form', loaderId: 'loaded' },
			},
			'session-1',
		)
		await waitForDelay(20)
		expect(settled.count).toBe(0)

		transport.event('Page.loadEventFired', {}, 'session-1')
		await expect(going).resolves.toMatchObject({ url: 'https://example.com/form' })
	})

	it('catches reload() under its load condition resolving on a restore-typed commit', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.reload')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/form',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const settled = createRecorder<[]>()
		const going = page.reload({ condition: 'load', timeout: 2_000 }).finally(settled.handler)
		await waitForCondition('the reload was requested', () =>
			transport.sent.some((message) => message.method === 'Page.reload'),
		)

		transport.event(
			'Page.frameNavigated',
			{
				type: 'BackForwardCacheRestore',
				frame: { id: 'frame-1', url: 'https://example.com/form', loaderId: 'restored' },
			},
			'session-1',
		)
		await waitForDelay(20)
		expect(settled.count).toBe(0)

		transport.event('Page.loadEventFired', {}, 'session-1')
		await expect(going).resolves.toMatchObject({ url: 'https://example.com/form' })
	})
	it('catches forward() resolving on a restore after its signal aborted', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 0)
		replyOk(transport, 'Page.navigateToHistoryEntry')
		replyOk(transport, 'Page.stopLoading')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/article',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const controller = new AbortController()
		const reason = new Error('The caller left')
		const going = page
			.forward({ signal: controller.signal, timeout: 2_000 })
			.catch((error: unknown) => error)
		await waitForCondition('the history entry was acknowledged', () =>
			transport.sent.some((message) => message.method === 'Page.navigateToHistoryEntry'),
		)
		await waitForDelay(10)

		controller.abort(reason)
		transport.event(
			'Page.frameNavigated',
			{
				type: 'BackForwardCacheRestore',
				frame: { id: 'frame-1', url: 'https://example.com/article', loaderId: 'restored' },
			},
			'session-1',
		)

		expect(await going).toBe(reason)
		expect(transport.sent.filter((message) => message.method === 'Page.stopLoading')).toHaveLength(
			1,
		)
	})

	it('catches forward() resolving when its signal aborts in the tick its restore settles the load wait', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 0)
		replyOk(transport, 'Page.navigateToHistoryEntry')
		replyOk(transport, 'Page.stopLoading')
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/article',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const controller = new AbortController()
		const reason = new Error('The caller left after the restore')
		const going = page
			.forward({ signal: controller.signal, timeout: 2_000 })
			.catch((error: unknown) => error)
		await waitForCondition('the history entry was acknowledged', () =>
			transport.sent.some((message) => message.method === 'Page.navigateToHistoryEntry'),
		)
		await waitForDelay(10)

		transport.event(
			'Page.frameNavigated',
			{
				type: 'BackForwardCacheRestore',
				frame: { id: 'frame-1', url: 'https://example.com/article', loaderId: 'restored' },
			},
			'session-1',
		)
		controller.abort(reason)

		expect(await going).toBe(reason)
		expect(transport.sent.filter((message) => message.method === 'Page.stopLoading')).toHaveLength(
			1,
		)
	})

	it('catches forward() resolving when its signal aborts during the completion read', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptBrowserHistory(transport, 0)
		transport.onSend('Page.navigateToHistoryEntry', (message) => {
			transport.reply(message.id, {})
			transport.event(
				'Page.frameNavigated',
				{
					type: 'BackForwardCacheRestore',
					frame: { id: 'frame-1', url: 'https://example.com/article', loaderId: 'restored' },
				},
				'session-1',
			)
		})
		replyOk(transport, 'Page.stopLoading')
		const controller = new AbortController()
		const reason = new Error('The caller left during the read')
		transport.onSend('Runtime.evaluate', (message) => {
			controller.abort(reason)
			transport.reply(message.id, { result: { value: 'https://example.com/article' } })
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')

		await expect(page.forward({ signal: controller.signal, timeout: 2_000 })).rejects.toBe(reason)
		expect(transport.sent.filter((message) => message.method === 'Runtime.evaluate')).toHaveLength(
			1,
		)
		expect(transport.sent.filter((message) => message.method === 'Page.stopLoading')).toHaveLength(
			1,
		)
	})

	it('catches back() on an empty history resolving after its signal aborted with the reply', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const controller = new AbortController()
		const reason = new Error('The caller left with the reply')
		transport.onSend('Page.getNavigationHistory', (message) => {
			transport.reply(message.id, {
				currentIndex: 0,
				entries: [{ id: 1, url: 'https://example.com/form' }],
			})
			controller.abort(reason)
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')

		await expect(page.back({ signal: controller.signal, timeout: 500 })).rejects.toBe(reason)
		expect(transport.sent.map((message) => message.method)).toEqual(['Page.getNavigationHistory'])
	})

	it.each(BROWSER_HISTORY_DIRECTIONS)(
		'catches %s() sending a history command under an already-aborted signal',
		async (direction) => {
			const { client, transport } = await createConnectedCDPClient()
			const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
			const controller = new AbortController()
			const reason = new Error('The caller left first')
			controller.abort(reason)

			await expect(page[direction]({ signal: controller.signal, timeout: 500 })).rejects.toBe(
				reason,
			)
			expect(transport.sent.map((message) => message.method)).toEqual([])
		},
	)
})

describe('BrowserPage navigation completion under a signal', () => {
	it.each(BROWSER_NAVIGATION_COMMANDS)(
		'catches %s() whose completion read ignores the signal that aborts during it',
		async (operation, command) => {
			const { client, transport } = await createConnectedCDPClient()
			try {
				transport.onSend(command, (message) => {
					transport.reply(message.id, {})
					transport.event('Page.loadEventFired', {}, 'session-1')
				})
				replyOk(transport, 'Page.stopLoading')
				const reads = createRecorder<[message: CDPSentMessage]>()
				transport.onSend('Runtime.evaluate', reads.handler)
				const page = new BrowserPage(
					client,
					'target-1',
					'session-1',
					undefined,
					undefined,
					'frame-1',
				)
				const controller = new AbortController()
				const reason = new Error('The caller left during the read')
				const call = { signal: controller.signal, timeout: 2_000 }
				const settled = createRecorder<[]>()
				const going = (
					operation === 'navigate'
						? page.navigate('https://example.com/article', call)
						: page.reload(call)
				)
					.catch((error: unknown) => error)
					.finally(settled.handler)
				await waitForCondition('the completion read is sent', () => reads.count === 1)

				controller.abort(reason)
				await waitForCondition(
					'the operation settles before the read replies',
					() => settled.count === 1,
					{ budget: 500 },
				)
				transport.reply(requireValue(reads.calls[0])[0].id, {
					result: { value: 'https://example.com/article' },
				})

				expect(await going).toBe(reason)
				expect(
					transport.sent.filter((message) => message.method === 'Page.stopLoading'),
				).toHaveLength(1)
			} finally {
				await client.close()
			}
		},
	)

	it.each(BROWSER_NAVIGATION_COMMANDS)(
		'catches %s() resolving when its signal aborts in the turn its completion read replies',
		async (operation, command) => {
			const { client, transport } = await createConnectedCDPClient()
			try {
				transport.onSend(command, (message) => {
					transport.reply(message.id, {})
					transport.event('Page.loadEventFired', {}, 'session-1')
				})
				replyOk(transport, 'Page.stopLoading')
				const controller = new AbortController()
				const reason = new Error('The caller left with the read')
				transport.onSend('Runtime.evaluate', (message) => {
					transport.reply(message.id, { result: { value: 'https://example.com/article' } })
					controller.abort(reason)
				})
				const page = new BrowserPage(
					client,
					'target-1',
					'session-1',
					undefined,
					undefined,
					'frame-1',
				)
				const call = { signal: controller.signal, timeout: 2_000 }

				await expect(
					operation === 'navigate'
						? page.navigate('https://example.com/article', call)
						: page.reload(call),
				).rejects.toBe(reason)
				expect(
					transport.sent.filter((message) => message.method === 'Runtime.evaluate'),
				).toHaveLength(1)
			} finally {
				await client.close()
			}
		},
	)

	it.each(BROWSER_NAVIGATION_COMMANDS)(
		'catches %s() reading its completion when its signal aborts in the turn its load settles',
		async (operation, command) => {
			const { client, transport } = await createConnectedCDPClient()
			try {
				const controller = new AbortController()
				const reason = new Error('The caller left with the load')
				transport.onSend(command, (message) => {
					transport.reply(message.id, {})
					transport.event('Page.loadEventFired', {}, 'session-1')
					controller.abort(reason)
				})
				replyOk(transport, 'Page.stopLoading')
				scriptEvaluate(
					transport,
					(expression) => expression.includes('location.href'),
					'https://example.com/article',
				)
				const page = new BrowserPage(
					client,
					'target-1',
					'session-1',
					undefined,
					undefined,
					'frame-1',
				)
				const call = { signal: controller.signal, timeout: 2_000 }

				await expect(
					operation === 'navigate'
						? page.navigate('https://example.com/article', call)
						: page.reload(call),
				).rejects.toBe(reason)
				expect(
					transport.sent.filter((message) => message.method === 'Runtime.evaluate'),
				).toHaveLength(0)
			} finally {
				await client.close()
			}
		},
	)
})

describe('BrowserPage navigation steps', () => {
	it('starts a record from the started step with its loader, else from a request in the current tab', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		try {
			const record = page.navigation.record('main')
			const started = createRecorder<[]>()
			void record.wait().then(started.handler)
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'anchorClick',
					url: 'https://example.test/help',
					disposition: 'newTab',
				},
				'session-main',
			)
			await waitForDelay()
			expect(started.count).toBe(0)
			transport.event(
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/cart',
					loaderId: 'loader-cart',
					navigationType: 'differentDocument',
				},
				'session-main',
			)
			await waitForDelay()
			expect(started.count).toBe(1)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: 'https://example.test/old', loaderId: 'loader-old' } },
				'session-main',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://example.test/cart',
				stage: 'requested',
			})
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: 'https://example.test/cart', loaderId: 'loader-cart' } },
				'session-main',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://example.test/cart',
				stage: 'committed',
			})
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'main', loaderId: 'loader-cart', name: 'load' },
				'session-main',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://example.test/cart',
				stage: 'loaded',
			})
			record.destroy()

			const fallback = page.navigation.record('main')
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/receipt',
					disposition: 'currentTab',
				},
				'session-main',
			)
			await fallback.wait({ timeout: 1_000 })
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'main', url: 'https://example.test/receipt', loaderId: 'loader-any' } },
				'session-main',
			)
			expect(await fallback.settle({ timeout: 0 })).toEqual({
				url: 'https://example.test/receipt',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			fallback.destroy()
		} finally {
			await client.close()
		}
	})

	it('carries the reason of a request in the current tab into the record, reads an unknown reason as undefined, and gives a start without a request none', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		try {
			const form = page.navigation.record('main')
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionGet',
					url: 'https://example.test/search?q=tray',
					disposition: 'currentTab',
				},
				'session-main',
			)
			expect(await form.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/search?q=tray',
				stage: 'requested',
				reason: 'formSubmissionGet',
			})
			form.destroy()
			const unknown = page.navigation.record('main')
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'prerenderActivation',
					url: 'https://example.test/next',
					disposition: 'currentTab',
				},
				'session-main',
			)
			expect(await unknown.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/next',
				stage: 'requested',
				reason: undefined,
			})
			unknown.destroy()
			const started = page.navigation.record('main')
			transport.event(
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/cart',
					loaderId: 'loader-cart',
					navigationType: 'differentDocument',
				},
				'session-main',
			)
			expect(await started.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/cart',
				stage: 'requested',
				reason: undefined,
			})
			started.destroy()
		} finally {
			await client.close()
		}
	})

	it('gives a start the reason of the current-tab request for its frame and URL that another known session reported, and none for another URL', async () => {
		const { client, page, transport } = await createBrowserElementFixture({ nested: true })
		try {
			const sessions = createRecorder<[frame: unknown]>()
			page.emitter.on('session', sessions.handler)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-nested',
					targetInfo: {
						targetId: 'nested',
						type: 'iframe',
						url: 'https://example.test/coupon',
						parentFrameId: 'child',
					},
				},
				'session-child',
			)
			await waitForCondition('the nested frame session is published', () => sessions.count === 1)
			const parent = page.navigation.record('nested')
			// The nested document submits into its parent, so its session reports the request for a
			// frame another session owns, and the owning session reports the start.
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'child',
					reason: 'formSubmissionGet',
					url: 'https://example.test/done?code=SPRING',
					disposition: 'currentTab',
				},
				'session-nested',
			)
			transport.event(
				'Page.frameStartedNavigating',
				{
					frameId: 'child',
					url: 'https://example.test/done?code=SPRING',
					loaderId: 'loader-done',
					navigationType: 'differentDocument',
				},
				'session-child',
			)
			expect(await parent.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/done?code=SPRING',
				stage: 'requested',
				reason: 'formSubmissionGet',
			})
			parent.destroy()
			const other = page.navigation.record('child')
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'child',
					reason: 'anchorClick',
					url: 'https://example.test/help',
					disposition: 'currentTab',
				},
				'session-nested',
			)
			transport.event(
				'Page.frameStartedNavigating',
				{
					frameId: 'child',
					url: 'https://example.test/cart',
					loaderId: 'loader-cart',
					navigationType: 'differentDocument',
				},
				'session-child',
			)
			expect(await other.settle({ timeout: 0 })).toStrictEqual({
				url: 'https://example.test/cart',
				stage: 'requested',
				reason: undefined,
			})
			other.destroy()
		} finally {
			await client.close()
		}
	})

	it.each(BROWSER_PENDING_REQUEST_CASES)(
		'holds a pending request for one start: %s',
		async (_name, frame, before, after, reason) => {
			const { client, transport } = await createConnectedCDPClient()
			const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
			try {
				for (const [method, params] of before) transport.event(method, params, 'session-main')
				const record = page.navigation.record(frame)
				for (const [method, params] of after) transport.event(method, params, 'session-main')
				expect(await record.settle({ timeout: 0 })).toStrictEqual({
					url: 'https://example.test/order',
					stage: 'requested',
					reason,
				})
				record.destroy()
			} finally {
				await client.close()
			}
		},
	)

	it('keeps no pending request of ten removed frames for a later start of their ids', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		try {
			const frames = Array.from({ length: 10 }, (_, index) => `removed-${index}`)
			for (const frame of frames) {
				transport.event(
					'Page.frameRequestedNavigation',
					{
						frameId: frame,
						reason: 'formSubmissionPost',
						url: `https://example.test/${frame}`,
						disposition: 'currentTab',
					},
					'session-main',
				)
				transport.event('Page.frameDetached', { frameId: frame, reason: 'remove' }, 'session-main')
			}
			const reasons: unknown[] = []
			for (const frame of frames) {
				const record = page.navigation.record(frame)
				transport.event(
					'Page.frameStartedNavigating',
					{
						frameId: frame,
						url: `https://example.test/${frame}`,
						loaderId: `loader-${frame}`,
						navigationType: 'differentDocument',
					},
					'session-main',
				)
				const settled = await record.settle({ timeout: 0 })
				reasons.push([settled?.stage, settled?.reason])
				record.destroy()
			}
			expect(reasons).toEqual(frames.map(() => ['requested', undefined]))
		} finally {
			await client.close()
		}
	})

	it('reports a frame session load by its loader and a stop only after a commit that named no loader', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		scriptFrameTree(
			transport,
			new Map([
				[
					'session-child',
					{
						id: 'child',
						parentId: 'main',
						url: 'https://other.test/field',
						loaderId: 'loader-field',
					},
				],
			]),
		)
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://other.test/field',
						parentFrameId: 'main',
					},
				},
				'session-main',
			)
			await waitForCondition('the frame session is published', () => sessions.count === 1)
			const record = page.navigation.record('child')
			for (const [method, params] of [
				[
					'Page.frameStartedNavigating',
					{ frameId: 'child', url: 'https://other.test/done', loaderId: 'loader-done' },
				],
				[
					'Page.frameNavigated',
					{ frame: { id: 'child', url: 'https://other.test/done', loaderId: 'loader-done' } },
				],
				['Page.frameStoppedLoading', { frameId: 'child' }],
				['Page.lifecycleEvent', { frameId: 'child', loaderId: 'loader-replay', name: 'load' }],
			] as const)
				transport.event(method, params, 'session-child')
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/done',
				stage: 'committed',
			})
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'child', loaderId: 'loader-done', name: 'load' },
				'session-child',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/done',
				stage: 'loaded',
			})
			record.destroy()

			const loaderless = page.navigation.record('child')
			transport.event(
				'Page.frameRequestedNavigation',
				{
					frameId: 'child',
					reason: 'formSubmissionGet',
					url: 'https://other.test/next',
					disposition: 'currentTab',
				},
				'session-child',
			)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://other.test/next' } },
				'session-child',
			)
			expect(await loaderless.settle({ timeout: 0 })).toHaveProperty('stage', 'committed')
			transport.event('Page.frameStoppedLoading', { frameId: 'child' }, 'session-child')
			expect(await loaderless.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/next',
				stage: 'loaded',
				reason: 'formSubmissionGet',
			})
			loaderless.destroy()
		} finally {
			await client.close()
		}
	})

	it('settles an out-of-process frame navigation from the commit and load its session reports after the page resumes it', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const enables: number[] = []
		transport.onSend('Page.enable', (message) => enables.push(message.id))
		for (const method of [
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		scriptFrameTree(transport)
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		page.emitter.on('session', sessions.handler)
		page.emitter.on('detach', detached.handler)
		try {
			transport.event(
				'Page.frameAttached',
				{ frameId: 'child', parentFrameId: 'main' },
				'session-main',
			)
			const record = page.navigation.record('child')
			emitBrowserNavigation(
				transport,
				'session-main',
				'child',
				'https://other.test/field',
				'loader-field',
				['request', 'start'],
			)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://other.test/field',
						parentFrameId: 'main',
					},
				},
				'session-main',
			)
			transport.event('Page.frameDetached', { frameId: 'child', reason: 'swap' }, 'session-main')
			await waitForCondition('the enable is withheld', () => enables.length === 1)
			expect([
				await record.settle({ timeout: 0 }),
				detached.count,
				readCDPSessionMethods(transport, 'session-child'),
			]).toEqual([
				{ url: 'https://other.test/field', stage: 'requested', reason: 'formSubmissionPost' },
				0,
				['Page.enable'],
			])
			transport.reply(requireValue(enables[0]), {})
			await waitForCondition('the frame session is published', () => sessions.count === 1)
			await waitForDelay(20)
			expect([
				await record.settle({ timeout: 0 }),
				readCDPSessionMethods(transport, 'session-child'),
			]).toEqual([
				{ url: 'https://other.test/field', stage: 'requested', reason: 'formSubmissionPost' },
				[
					'Page.enable',
					'Runtime.enable',
					'Page.setLifecycleEventsEnabled',
					'Target.setAutoAttach',
					'Runtime.runIfWaitingForDebugger',
				],
			])
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/field',
				'loader-field',
				['commit'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/field',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/field',
				'loader-field',
				['load'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/field',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			expect((await page.frames()).find((frame) => frame.id === 'child')?.parent).toBe('main')
			record.destroy()
		} finally {
			await client.close()
		}
	})

	it('ignores a commit and stop from the session a nested frame left for its own session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const held: number[] = []
		transport.onSend('Page.enable', (message) => {
			if (message.sessionId === 'session-nested') held.push(message.id)
			else transport.reply(message.id, {})
		})
		for (const method of [
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		replyOk(transport, 'Page.createIsolatedWorld', { executionContextId: 7 })
		scriptEvaluate(transport, (expression) => expression.includes(compileReadFunction()), {
			url: 'https://a.test/inner',
			title: 'Inner',
			html: '<p>Inner</p>',
		})
		scriptFrameTree(
			transport,
			new Map([
				[
					'session-child',
					{ id: 'child', parentId: 'main', url: 'https://b.test/middle', loaderId: 'loader-b' },
				],
				[
					'session-nested',
					{
						id: 'nested',
						parentId: 'child',
						url: 'https://a.test/inner',
						loaderId: 'loader-inner',
					},
				],
			]),
		)
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://b.test/middle',
						parentFrameId: 'main',
					},
				},
				'session-main',
			)
			await waitForCondition('the middle frame is published', () => sessions.count === 1)
			// The middle frame's session attaches the frames nested in it.
			expect(readCDPParams(transport, 'Target.setAutoAttach')).toHaveLength(1)
			transport.event(
				'Page.frameAttached',
				{ frameId: 'nested', parentFrameId: 'child' },
				'session-child',
			)
			const record = page.navigation.record('nested')
			transport.event(
				'Page.frameStartedNavigating',
				{ frameId: 'nested', url: 'https://a.test/inner', loaderId: 'loader-inner' },
				'session-child',
			)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-nested',
					targetInfo: {
						targetId: 'nested',
						type: 'iframe',
						url: 'https://a.test/inner',
						parentFrameId: 'child',
					},
				},
				'session-child',
			)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'nested', url: 'https://b.test/stale' } },
				'session-child',
			)
			transport.event('Page.frameStoppedLoading', { frameId: 'nested' }, 'session-child')
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://a.test/inner',
				stage: 'requested',
			})
			transport.reply(requireValue(held[0]), {})
			await waitForCondition('the nested frame is published', () => sessions.count === 2)
			expect(requireValue(sessions.calls[1])[0].parent).toBe('child')
			await waitForDelay(20)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://a.test/inner',
				stage: 'requested',
			})
			transport.event(
				'Page.frameNavigated',
				{
					frame: {
						id: 'nested',
						parentId: 'child',
						url: 'https://a.test/inner',
						loaderId: 'loader-inner',
					},
				},
				'session-nested',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://a.test/inner',
				stage: 'committed',
			})
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'nested', loaderId: 'loader-inner', name: 'load' },
				'session-nested',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://a.test/inner',
				stage: 'loaded',
			})
			record.destroy()
			// A stale report from the session the frame left changes nothing about its current
			// document, while a report from its own session replaces it.
			const reading = await requireValue(sessions.calls[1])[0].read()
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'nested', url: 'https://b.test/stale-again' } },
				'session-child',
			)
			transport.event(
				'Page.frameDetached',
				{ frameId: 'nested', reason: 'remove' },
				'session-child',
			)
			expect(reading.stale).toBe(false)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'nested', url: 'https://a.test/next', loaderId: 'loader-next' } },
				'session-nested',
			)
			expect(reading.stale).toBe(true)
		} finally {
			await client.close()
		}
	})

	it('keeps a navigation that starts while its frame publishes from completing on the document the frame already reported', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const trees: CDPSentMessage[] = []
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		transport.onSend('Page.getFrameTree', (message) => trees.push(message))
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://other.test/field',
					},
				},
				'session-main',
			)
			await waitForCondition('the frame tree read is withheld', () => trees.length === 1)
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/a',
				'loader-a',
				['request', 'start'],
			)
			const record = page.navigation.record('child')
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/a',
				'loader-a',
				['commit'],
			)
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['request', 'start'],
			)
			transport.reply(requireValue(trees[0]).id, {
				frameTree: {
					frame: {
						id: 'child',
						parentId: 'main',
						url: 'https://other.test/a',
						loaderId: 'loader-a',
					},
				},
			})
			await waitForCondition('the frame is published', () => sessions.count === 1)
			await waitForDelay(20)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'requested',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['commit'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['load'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			record.destroy()
		} finally {
			await client.close()
		}
	})

	it('publishes no commit for a document its session reported through a same-document navigation', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const trees: CDPSentMessage[] = []
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		transport.onSend('Page.getFrameTree', (message) => trees.push(message))
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://other.test/a',
					},
				},
				'session-main',
			)
			await waitForCondition('the frame tree read is withheld', () => trees.length === 1)
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'child', url: 'https://other.test/a#placed', navigationType: 'fragment' },
				'session-child',
			)
			const record = page.navigation.record('child')
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['request'],
			)
			transport.reply(requireValue(trees[0]).id, {
				frameTree: {
					frame: {
						id: 'child',
						parentId: 'main',
						url: 'https://other.test/a',
						loaderId: 'loader-a',
					},
				},
			})
			await waitForCondition('the frame is published', () => sessions.count === 1)
			await waitForDelay(20)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'requested',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['commit'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-child',
				'child',
				'https://other.test/b',
				'loader-b',
				['load'],
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/b',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			record.destroy()
		} finally {
			await client.close()
		}
	})

	it('reports no load for a reported document when its frame tree or a later start names a newer one', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const trees = new Map<string, CDPSentMessage>()
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		transport.onSend('Page.getFrameTree', (message) => trees.set(message.sessionId ?? '', message))
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			for (const frame of ['voucher', 'coupon'])
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: `session-${frame}`,
						targetInfo: {
							targetId: frame,
							type: 'iframe',
							url: 'about:blank',
						},
					},
					'session-main',
				)
			await waitForCondition('both frame tree reads are withheld', () => trees.size === 2)
			// The voucher frame's tree names a newer document at the same URL.
			const voucher = page.navigation.record('voucher')
			emitBrowserNavigation(
				transport,
				'session-voucher',
				'voucher',
				'https://other.test/voucher',
				'loader-a',
				['request', 'start', 'commit'],
			)
			const resubmitted = page.navigation.record('voucher')
			emitBrowserNavigation(
				transport,
				'session-voucher',
				'voucher',
				'https://other.test/voucher',
				'loader-b',
				['request', 'start'],
			)
			transport.reply(requireValue(trees.get('session-voucher')).id, {
				frameTree: {
					frame: {
						id: 'voucher',
						parentId: 'main',
						url: 'https://other.test/voucher',
						loaderId: 'loader-b',
					},
				},
			})
			// The coupon frame's tree names the reported document, and a newer one starts after publication.
			const coupon = page.navigation.record('coupon')
			emitBrowserNavigation(
				transport,
				'session-coupon',
				'coupon',
				'https://other.test/c',
				'loader-c',
				['request', 'start', 'commit'],
			)
			transport.reply(requireValue(trees.get('session-coupon')).id, {
				frameTree: {
					frame: {
						id: 'coupon',
						parentId: 'main',
						url: 'https://other.test/c',
						loaderId: 'loader-c',
					},
				},
			})
			await waitForCondition('both frames are published', () => sessions.count === 2)
			emitBrowserNavigation(
				transport,
				'session-coupon',
				'coupon',
				'https://other.test/d',
				'loader-d',
				['request', 'start'],
			)
			await waitForDelay(20)
			expect(
				await Promise.all(
					[voucher, coupon, resubmitted].map((record) => record.settle({ timeout: 0 })),
				),
			).toEqual([
				{ url: 'https://other.test/voucher', stage: 'committed', reason: 'formSubmissionPost' },
				{ url: 'https://other.test/c', stage: 'committed', reason: 'formSubmissionPost' },
				{ url: 'https://other.test/voucher', stage: 'requested', reason: 'formSubmissionPost' },
			])
			emitBrowserNavigation(
				transport,
				'session-voucher',
				'voucher',
				'https://other.test/voucher',
				'loader-b',
				['commit'],
			)
			expect(await resubmitted.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/voucher',
				stage: 'committed',
				reason: 'formSubmissionPost',
			})
			emitBrowserNavigation(
				transport,
				'session-voucher',
				'voucher',
				'https://other.test/voucher',
				'loader-b',
				['load'],
			)
			expect(await resubmitted.settle({ timeout: 0 })).toEqual({
				url: 'https://other.test/voucher',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			for (const record of [voucher, coupon, resubmitted]) record.destroy()
		} finally {
			await client.close()
		}
	})

	it('resumes a frame session and reads its frame tree only after its lifecycle events and auto-attach are in effect', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const held: CDPSentMessage[] = []
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		for (const method of ['Page.setLifecycleEventsEnabled', 'Target.setAutoAttach'])
			transport.onSend(method, (message) => held.push(message))
		scriptFrameTree(transport)
		const trees: CDPSentMessage[] = []
		transport.onSend('Page.getFrameTree', (message) => {
			if (message.sessionId === 'session-child') trees.push(message)
		})
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://other.test/field' },
				},
				'session-main',
			)
			await waitForCondition('lifecycle enablement is sent', () => held.length > 0)
			await waitForDelay(20)
			expect([held.map((message) => message.method), trees.length]).toEqual([
				['Page.setLifecycleEventsEnabled'],
				0,
			])
			transport.reply(requireValue(held[0]).id, {})
			await waitForCondition('auto-attach is sent', () => held.length === 2)
			await waitForDelay(20)
			expect(readCDPSessionMethods(transport, 'session-child')).toEqual([
				'Page.enable',
				'Runtime.enable',
				'Page.setLifecycleEventsEnabled',
				'Target.setAutoAttach',
			])
			transport.reply(requireValue(held[1]).id, {})
			await waitForCondition(
				'the frame is published after its tree read',
				() => sessions.count === 1,
			)
			expect(readCDPSessionMethods(transport, 'session-child').slice(-2)).toEqual([
				'Runtime.runIfWaitingForDebugger',
				'Page.getFrameTree',
			])
		} finally {
			await client.close()
		}
	})

	it('reads the frame tree and publishes a frame session without waiting for its resume reply, and sends nothing when the reply arrives', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const resumes: CDPSentMessage[] = []
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
		])
			replyOk(transport, method)
		transport.onSend('Runtime.runIfWaitingForDebugger', (message) => resumes.push(message))
		scriptFrameTree(
			transport,
			new Map([
				['session-child', { id: 'child', parentId: 'main', url: 'https://other.test/field' }],
			]),
		)
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://other.test/field' },
				},
				'session-main',
			)
			await waitForCondition(
				'the frame is published with its resume unanswered',
				() => sessions.count === 1,
			)
			expect([
				resumes.length,
				readCDPSessionMethods(transport, 'session-child'),
				requireValue(sessions.calls[0])[0].parent,
			]).toEqual([
				1,
				[
					'Page.enable',
					'Runtime.enable',
					'Page.setLifecycleEventsEnabled',
					'Target.setAutoAttach',
					'Runtime.runIfWaitingForDebugger',
					'Page.getFrameTree',
				],
				'main',
			])
			const sent = transport.sent.length
			transport.reply(requireValue(resumes[0]).id, {})
			await waitForDelay(20)
			expect(transport.sent).toHaveLength(sent)
		} finally {
			await client.close()
		}
	})

	it('publishes a nested frame that attaches through its parent session while the parent publication is pending', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const held: number[] = []
		transport.onSend('Page.enable', (message) => {
			if (message.sessionId === 'session-child') held.push(message.id)
			else transport.reply(message.id, {})
		})
		for (const method of [
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		scriptFrameTree(
			transport,
			new Map([
				[
					'session-child',
					{ id: 'child', parentId: 'main', url: 'https://b.test/middle', loaderId: 'loader-b' },
				],
				[
					'session-nested',
					{ id: 'nested', parentId: 'child', url: 'https://a.test/inner', loaderId: 'loader-a' },
				],
			]),
		)
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-child',
					targetInfo: {
						targetId: 'child',
						type: 'iframe',
						url: 'https://b.test/middle',
						parentFrameId: 'main',
					},
				},
				'session-main',
			)
			await waitForCondition('the middle enable is withheld', () => held.length === 1)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'session-nested',
					targetInfo: {
						targetId: 'nested',
						type: 'iframe',
						url: 'https://a.test/inner',
						parentFrameId: 'child',
					},
				},
				'session-child',
			)
			await waitForCondition('the nested frame is published', () => sessions.count === 1)
			expect([
				requireValue(sessions.calls[0])[0].id,
				requireValue(sessions.calls[0])[0].parent,
			]).toEqual(['nested', 'child'])
			const record = page.navigation.record('nested')
			emitBrowserNavigation(
				transport,
				'session-nested',
				'nested',
				'https://a.test/next',
				'loader-next',
			)
			expect(await record.settle({ timeout: 0 })).toEqual({
				url: 'https://a.test/next',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			record.destroy()
			transport.reply(requireValue(held[0]), {})
			await waitForCondition('the middle frame is published', () => sessions.count === 2)
			expect(requireValue(sessions.calls[1])[0].id).toBe('child')
		} finally {
			await client.close()
		}
	})

	it.each([
		['before', true],
		['after', false],
	] as const)(
		'finds a named-parent frame by the name its session commit reports %s publication',
		async (_order, early) => {
			const { client, transport } = await createConnectedCDPClient()
			const held: CDPSentMessage[] = []
			for (const method of [
				'Page.enable',
				'Runtime.enable',
				'Page.setLifecycleEventsEnabled',
				'Runtime.runIfWaitingForDebugger',
			])
				replyOk(transport, method)
			transport.onSend('Target.setAutoAttach', (message) => held.push(message))
			scriptFrameTree(transport)
			const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
			const sessions = createRecorder<[frame: BrowserFrameInterface]>()
			page.emitter.on('session', sessions.handler)
			const commit = {
				frame: {
					id: 'child',
					parentId: 'main',
					name: 'checkout',
					url: 'https://other.test/checkout',
					loaderId: 'loader-checkout',
				},
			}
			try {
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'session-child',
						targetInfo: {
							targetId: 'child',
							type: 'iframe',
							url: 'https://other.test/checkout',
							parentFrameId: 'main',
						},
					},
					'session-main',
				)
				await waitForCondition('the auto-attach is withheld', () => held.length === 1)
				if (early) transport.event('Page.frameNavigated', commit, 'session-child')
				transport.reply(requireValue(held[0]).id, {})
				await waitForCondition('the frame is published', () => sessions.count === 1)
				if (!early) transport.event('Page.frameNavigated', commit, 'session-child')
				const found = await page.frame('checkout')
				expect([found?.id, found?.url, found?.name]).toEqual([
					'child',
					'https://other.test/checkout',
					'checkout',
				])
			} finally {
				await client.close()
			}
		},
	)

	it('names a published frame parent from its target and leaves an unnamed parent unknown', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Page.enable',
			'Runtime.enable',
			'Page.setLifecycleEventsEnabled',
			'Target.setAutoAttach',
			'Runtime.runIfWaitingForDebugger',
		])
			replyOk(transport, method)
		scriptFrameTree(
			transport,
			new Map([['session-orphan', { id: 'orphan-9', url: 'https://other.example/orphan' }]]),
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'main-1')
		const sessions = createRecorder<[frame: BrowserFrameInterface]>()
		page.emitter.on('session', sessions.handler)
		try {
			for (const [session, target] of [
				[
					'session-oopif',
					{
						targetId: 'oopif-7',
						type: 'iframe',
						url: 'https://other.example/embed',
						parentFrameId: 'child-1',
					},
				],
				[
					'session-orphan',
					{ targetId: 'orphan-9', type: 'iframe', url: 'https://other.example/orphan' },
				],
			] as const)
				transport.event(
					'Target.attachedToTarget',
					{ sessionId: session, targetInfo: target },
					'session-1',
				)
			await waitForCondition('both frames are published', () => sessions.count === 2)
			const frames = await page.frames()
			expect(frames.find((frame) => frame.id === 'oopif-7')?.parent).toBe('child-1')
			expect(frames.find((frame) => frame.id === 'orphan-9')?.parent).toBeUndefined()
		} finally {
			await client.close()
		}
	})
})
