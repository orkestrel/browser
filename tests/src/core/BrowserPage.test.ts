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
import { describe, it, expect } from 'vitest'
import {
	BrowserPage,
	createCDPClient,
	isBrowserError,
	isBrowserSelectorError,
	isBrowserResultLimitError,
	isCDPTimeoutError,
	BrowserResultLimitError,
	BROWSER_RESULT_LIMIT,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_STOP_LOADING_TIMEOUT_MS,
} from '@src/core'
import { createRecorder, requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import {
	createCDPTransport,
	createConnectedCDPClient,
	createDOMSnapshotResult,
	createRecordingWriter,
	readCDPExpression,
	replyOk,
	scriptEvaluate,
	scriptFrameTree,
	scriptSelectorPresent,
	scriptTrustedSelector,
	JPEG_BASE64,
	PNG_BASE64,
	throwListenerError,
} from '../../setup.js'

// === BrowserPage

describe('BrowserPage', () => {
	describe('url seeding', () => {
		it('reports a seeded url immediately, before any navigate()/content() call', async () => {
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
			const transport = createCDPTransport()
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
			const transport = createCDPTransport()
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

	describe('content()', () => {
		it('returns url, title, html, and text', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Content Test')
			scriptEvaluate(
				transport,
				(expression) => expression.includes('outerHTML'),
				'<p>Hello World</p>',
			)
			scriptEvaluate(transport, (expression) => expression.includes('innerText'), 'Hello World')
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/page',
			)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const result = await page.content()

			expect(result.title).toBe('Content Test')
			expect(result.html).toBe('<p>Hello World</p>')
			expect(result.text).toBe('Hello World')
			expect(result.url).toBe('https://example.com/page')
		})

		it.each([{ field: 'title' }, { field: 'html' }, { field: 'text' }, { field: 'url' }])(
			'rejects a malformed $field result instead of substituting a sentinel',
			async ({ field }) => {
				const { client, transport } = await createConnectedCDPClient()
				scriptEvaluate(
					transport,
					(expression) => expression === 'document.title',
					field === 'title' ? undefined : 'Title',
				)
				scriptEvaluate(
					transport,
					(expression) => expression.includes('outerHTML'),
					field === 'html' ? undefined : '<p>Text</p>',
				)
				scriptEvaluate(
					transport,
					(expression) => expression.includes('innerText'),
					field === 'text' ? undefined : 'Text',
				)
				scriptEvaluate(
					transport,
					(expression) => expression === 'location.href',
					field === 'url' ? undefined : 'https://example.com/',
				)

				const page = new BrowserPage(client, 'target-1', 'session-1')

				await expect(page.content()).rejects.toSatisfy(isBrowserError)
			},
		)

		it('maps an oversized outerHTML result to a coded BrowserResultLimitError', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Test')
			scriptEvaluate(transport, (expression) => expression.includes('innerText'), 'text')
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/',
			)
			transport.onSend('Runtime.evaluate', (message) => {
				const expression = message.params?.['expression']
				if (typeof expression === 'string' && expression.includes('outerHTML')) {
					transport.reply(message.id, {
						exceptionDetails: {
							exception: {
								description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}3500000`,
							},
						},
					})
				}
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const thrown: unknown = await page.content().catch((caught: unknown) => caught)

			expect(isBrowserResultLimitError(thrown)).toBe(true)
			expect(
				thrown instanceof BrowserResultLimitError ? thrown.context?.['length'] : undefined,
			).toBe(3500000)
		})

		it('maps an oversized innerText result to a coded BrowserResultLimitError', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Test')
			scriptEvaluate(transport, (expression) => expression.includes('outerHTML'), '<p></p>')
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/',
			)
			transport.onSend('Runtime.evaluate', (message) => {
				const expression = message.params?.['expression']
				if (typeof expression === 'string' && expression.includes('innerText')) {
					transport.reply(message.id, {
						exceptionDetails: {
							exception: {
								description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000`,
							},
						},
					})
				}
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const thrown: unknown = await page.content().catch((caught: unknown) => caught)

			expect(isBrowserResultLimitError(thrown)).toBe(true)
			expect(
				thrown instanceof BrowserResultLimitError ? thrown.context?.['length'] : undefined,
			).toBe(4200000)
		})

		it('sends the innerText expression wrapped in the result-limit guard', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Test')
			scriptEvaluate(transport, (expression) => expression.includes('outerHTML'), '<p></p>')
			scriptEvaluate(transport, (expression) => expression.includes('innerText'), 'text')
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/',
			)

			let sentTextExpression: string | undefined
			transport.onSend('Runtime.evaluate', (message) => {
				const expression = message.params?.['expression']
				if (typeof expression === 'string' && expression.includes('innerText')) {
					sentTextExpression = expression
				}
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.content()

			expect(sentTextExpression).toContain(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)
		})

		it('serves inherited article distillation through the page', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Article')
			scriptEvaluate(
				transport,
				(expression) => expression.includes('outerHTML'),
				'<html><body><nav>Navigation</nav><main><article><h1>Article</h1><p>Page body.</p></article></main><footer>Footer</footer></body></html>',
			)
			scriptEvaluate(
				transport,
				(expression) => expression.includes('innerText'),
				'Navigation\nArticle\nPage body.\nFooter',
			)
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/article',
			)
			const page = new BrowserPage(client, 'target-1', 'session-1')

			const content = await page.content()
			const article = await page.article()

			expect(article).toBe('Article\nPage body.')
			expect(article).not.toBe(content.text)
			expect(article).not.toContain('Navigation')
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
			replyOk(transport, 'Emulation.setDefaultBackgroundColorOverride')
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
			const page = new BrowserPage(client, 'target-1', 'session-1')

			await page.screenshot({
				clip: [10, 20, 300, 200],
				transparent: true,
				animations: false,
				caret: false,
				mask: [page.selectors.css('.secret')],
				color: '#123456',
			})

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

	describe('click()', () => {
		it('clicks a present element', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptTrustedSelector(transport, '#btn')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.click('#btn')).resolves.toBeUndefined()
		})

		it('throws BrowserSelectorError when the selector never appears', async () => {
			const { client, transport } = await createConnectedCDPClient()
			// The retry loop runs in the page, so the scripted false is the whole
			// wait: the locator must turn it into a selector error.
			scriptEvaluate(transport, (expression) => expression.includes('new Promise'), false)

			const page = new BrowserPage(client, 'target-1', 'session-1')

			await expect(page.click('#missing', { timeout: 20 })).rejects.toSatisfy(
				isBrowserSelectorError,
			)
		})
	})

	describe('fill()', () => {
		it('sets an input value', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptTrustedSelector(transport, '#name')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.fill('#name', 'hello world')).resolves.toBeUndefined()
		})

		it('sends a contenteditable-aware expression that sets textContent when isContentEditable', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptTrustedSelector(transport, '#editable')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.fill('#editable', 'hello world')

			const focusCall = transport.sent.find(
				(message) => message.method === 'Runtime.callFunctionOn',
			)
			expect(focusCall?.params?.['functionDeclaration']).toContain('this.isContentEditable')
			expect(transport.sent.some((message) => message.method === 'Input.insertText')).toBe(true)
		})
	})

	describe('select()', () => {
		it('selects the given values', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptTrustedSelector(transport, '#sel')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.select('#sel', ['b'])).resolves.toBeUndefined()
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

	describe('wait()', () => {
		it('resolves once the selector appears', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptSelectorPresent(transport, '#target')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.wait('#target')).resolves.toBeUndefined()
		})
	})

	describe('selector escaping', () => {
		it('safely embeds a selector with embedded quotes and backslashes into the evaluate expression', async () => {
			const { client, transport } = await createConnectedCDPClient()
			scriptTrustedSelector(transport, String.raw`div[data-x='a"b\c']`)

			const selector = String.raw`div[data-x='a"b\c']`
			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.click(selector)).resolves.toBeUndefined()

			const clickCall = transport.sent.find(
				(m) =>
					m.method === 'Runtime.evaluate' &&
					m.params?.['returnByValue'] === false &&
					readCDPExpression(m)?.includes(JSON.stringify(selector)) === true,
			)
			expect(clickCall).toBeDefined()
			const expression = requireValue(readCDPExpression(clickCall))
			expect(expression).toContain(JSON.stringify(selector))
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
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')
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
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')
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
		await expect(chooser?.cancel()).resolves.toBeUndefined()
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

	it('promotes attached worker targets after enabling their Runtime session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.enable')
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

	it('creates popup pages with opener identity and initialized protocol domains', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'popup-frame', url: 'https://example.com/popup' } },
		})
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Page.setInterceptFileChooserDialog')
		replyOk(transport, 'Network.enable')
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
	})

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
