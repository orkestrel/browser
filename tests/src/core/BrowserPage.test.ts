import { describe, it, expect, vi, afterEach } from 'vitest'
import { BrowserPage, createCDPClient, isBrowserError, isBrowserSelectorError } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import {
	createCDPTransport,
	createScreenshotWriter,
	replyOk,
	scriptEvaluate,
	JPEG_BASE64,
	PNG_BASE64,
} from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

// === Helpers

async function createConnectedClient(): Promise<{
	client: CDPClientInterface
	transport: CDPTestTransportInterface
}> {
	const transport = createCDPTransport()
	const client = createCDPClient({ transport })
	await client.connect()
	return { client, transport }
}

function scriptSelectorPresent(transport: CDPTestTransportInterface, selector: string): void {
	scriptEvaluate(
		transport,
		(expression) => expression.includes('querySelector') && expression.includes('!== null'),
		true,
	)
	void selector
}

// === BrowserPage

describe('BrowserPage', () => {
	describe('title()', () => {
		it('returns the document title', async () => {
			const { client, transport } = await createConnectedClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', 'Test Title')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.title()).toBe('Test Title')
		})

		it('returns empty string when the value is not a string', async () => {
			const { client, transport } = await createConnectedClient()
			scriptEvaluate(transport, (expression) => expression === 'document.title', undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.title()).toBe('')
		})
	})

	describe('navigate()', () => {
		it('updates the page url on success', async () => {
			const { client, transport } = await createConnectedClient()
			transport.onSend('Page.navigate', (message) => {
				transport.reply(message.id, {})
				transport.event('Page.loadEventFired', {}, message.sessionId)
			})
			scriptEvaluate(
				transport,
				(expression) => expression === 'location.href',
				'https://example.com/',
			)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.navigate('https://example.com')

			expect(page.url).toBe('https://example.com/')
		})

		it('throws a BrowserError when navigation returns errorText', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.navigate('https://bad.example')).rejects.toSatisfy(isBrowserError)
		})

		it('rejects with a timeout error when the load event never fires', async () => {
			vi.useFakeTimers()
			try {
				const { client, transport } = await createConnectedClient()
				replyOk(transport, 'Page.navigate', {})

				const page = new BrowserPage(client, 'target-1', 'session-1')
				const pending = page.navigate('https://slow.example', { timeout: 20 })
				await Promise.all([
					expect(pending).rejects.toThrow('Navigation timeout'),
					vi.advanceTimersByTimeAsync(25),
				])
			} finally {
				vi.useRealTimers()
			}
		})

		it('leaves no dangling timer and no unhandled rejection when Page.navigate fails', async () => {
			vi.useFakeTimers()
			const unhandled: unknown[] = []
			const onUnhandled = (reason: unknown): void => {
				unhandled.push(reason)
			}
			process.on('unhandledRejection', onUnhandled)

			try {
				const { client, transport } = await createConnectedClient()
				replyOk(transport, 'Page.navigate', { errorText: 'net::ERR_FAILED' })

				const page = new BrowserPage(client, 'target-1', 'session-1')
				await expect(
					page.navigate('https://bad.example', { timeout: 20 }),
				).rejects.toSatisfy(isBrowserError)

				// The load-wait timer must be cancelled, not left armed
				expect(vi.getTimerCount()).toBe(0)

				// Advance well past the original timeout — nothing should fire/reject unobserved
				await vi.advanceTimersByTimeAsync(50)
				await Promise.resolve()
				expect(unhandled).toEqual([])
			} finally {
				process.off('unhandledRejection', onUnhandled)
				vi.useRealTimers()
			}
		})
	})

	describe('content()', () => {
		it('returns url, title, html, and text', async () => {
			const { client, transport } = await createConnectedClient()
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
	})

	describe('screenshot()', () => {
		it('decodes PNG bytes by default with no writer', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const result = await page.screenshot()

			expect(Array.from(result.bytes)).toEqual([137, 80, 78, 71, 13])
			expect(result.path).toBeUndefined()
		})

		it('decodes JPEG bytes and sends the requested format', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.captureScreenshot', { data: JPEG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			const result = await page.screenshot({ type: 'jpeg', quality: 80 })

			expect(Array.from(result.bytes)).toEqual([255, 216, 255, 224])
			const sent = transport.sent.find((m) => m.method === 'Page.captureScreenshot')
			expect(sent?.params).toEqual({ format: 'jpeg', quality: 80 })
		})

		it('writes to the injected writer only when path is provided', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
			const writer = createScreenshotWriter()

			const page = new BrowserPage(client, 'target-1', 'session-1', writer)
			const result = await page.screenshot({ path: '/tmp/shot.png' })

			expect(writer.calls).toHaveLength(1)
			expect(writer.calls[0]?.path).toBe('/tmp/shot.png')
			expect(Array.from(writer.calls[0]?.data ?? [])).toEqual(Array.from(result.bytes))
			expect(result.path).toBe('/tmp/shot.png')
		})

		it('does not write when no path is given even with a writer', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
			const writer = createScreenshotWriter()

			const page = new BrowserPage(client, 'target-1', 'session-1', writer)
			await page.screenshot()

			expect(writer.calls).toHaveLength(0)
		})

		it('requests a clip for full-page capture when dimensions resolve', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.getLayoutMetrics', { contentSize: { width: 1000, height: 2000 } })
			replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await page.screenshot({ full: true })

			const sent = transport.sent.find((m) => m.method === 'Page.captureScreenshot')
			expect(sent?.params?.['clip']).toEqual({ x: 0, y: 0, width: 1000, height: 2000, scale: 1 })
		})

		it('throws a BrowserError when no data is returned', async () => {
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Page.captureScreenshot', {})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.screenshot()).rejects.toSatisfy(isBrowserError)
		})
	})

	describe('click()', () => {
		it('clicks a present element', async () => {
			const { client, transport } = await createConnectedClient()
			scriptSelectorPresent(transport, '#btn')
			scriptEvaluate(transport, (expression) => expression.includes('el.click()'), undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.click('#btn')).resolves.toBeUndefined()
		})

		it('throws BrowserSelectorError when the selector never appears', async () => {
			vi.useFakeTimers()
			try {
				const { client, transport } = await createConnectedClient()
				scriptEvaluate(transport, (expression) => expression.includes('!== null'), false)

				const page = new BrowserPage(client, 'target-1', 'session-1')
				const pending = page.click('#missing', { timeout: 20 })
				await Promise.all([
					expect(pending).rejects.toSatisfy(isBrowserSelectorError),
					vi.advanceTimersByTimeAsync(150),
				])
			} finally {
				vi.useRealTimers()
			}
		})
	})

	describe('fill()', () => {
		it('sets an input value', async () => {
			const { client, transport } = await createConnectedClient()
			scriptSelectorPresent(transport, '#name')
			scriptEvaluate(transport, (expression) => expression.includes('el.value ='), undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.fill('#name', 'hello world')).resolves.toBeUndefined()
		})
	})

	describe('select()', () => {
		it('selects the given values', async () => {
			const { client, transport } = await createConnectedClient()
			scriptSelectorPresent(transport, '#sel')
			scriptEvaluate(transport, (expression) => expression.includes('opt.selected'), undefined)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.select('#sel', ['b'])).resolves.toBeUndefined()
		})
	})

	describe('evaluate()', () => {
		it('returns the evaluated value', async () => {
			const { client, transport } = await createConnectedClient()
			scriptEvaluate(transport, (expression) => expression === '1 + 1', 2)

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(await page.evaluate('1 + 1')).toBe(2)
		})

		it('throws a BrowserError when the page reports an exception', async () => {
			const { client, transport } = await createConnectedClient()
			transport.onSend('Runtime.evaluate', (message) => {
				transport.reply(message.id, {
					exceptionDetails: { exception: { description: 'ReferenceError: x is not defined' } },
				})
			})

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.evaluate('x')).rejects.toSatisfy(isBrowserError)
		})
	})

	describe('wait()', () => {
		it('resolves once the selector appears', async () => {
			const { client, transport } = await createConnectedClient()
			scriptSelectorPresent(transport, '#target')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.wait('#target')).resolves.toBeUndefined()
		})
	})

	describe('selector escaping', () => {
		it('safely embeds a selector with embedded quotes and backslashes into the evaluate expression', async () => {
			const { client, transport } = await createConnectedClient()
			scriptEvaluate(transport, (expression) => expression.includes('!== null'), true)
			scriptEvaluate(transport, (expression) => expression.includes('el.click()'), undefined)

			const selector = String.raw`div[data-x='a"b\c']`
			const page = new BrowserPage(client, 'target-1', 'session-1')
			await expect(page.click(selector)).resolves.toBeUndefined()

			const clickCall = transport.sent.find(
				(m) =>
					m.method === 'Runtime.evaluate' &&
					typeof m.params?.['expression'] === 'string' &&
					(m.params['expression'] as string).includes('el.click()'),
			)
			expect(clickCall).toBeDefined()
			const expression = clickCall?.params?.['expression']
			expect(typeof expression).toBe('string')
			expect(expression as string).toContain(JSON.stringify(selector))
		})
	})

	describe('frame() / frames()', () => {
		it('returns undefined for any frame name', async () => {
			const { client } = await createConnectedClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(page.frame('does-not-exist')).toBeUndefined()
		})

		it('returns an empty frame list', async () => {
			const { client } = await createConnectedClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(page.frames()).toEqual([])
		})
	})

	describe('codegen()', () => {
		it('starts a recorder and returns the same instance on repeat calls', async () => {
			const { client, transport } = await createConnectedClient()
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
			const { client, transport } = await createConnectedClient()
			replyOk(transport, 'Target.closeTarget')

			const page = new BrowserPage(client, 'target-1', 'session-1')
			expect(page.closed).toBe(false)
			await page.close()

			expect(page.closed).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Target.closeTarget')).toBe(true)
		})

		it('is marked closed when the target is externally destroyed', async () => {
			const { client, transport } = await createConnectedClient()
			const page = new BrowserPage(client, 'target-1', 'session-1')

			transport.event('Target.targetDestroyed', { targetId: 'target-1' })

			expect(page.closed).toBe(true)
		})

		it('tears down an active codegen recorder before closing', async () => {
			const { client, transport } = await createConnectedClient()
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
	})
})

afterEach(() => {
	vi.useRealTimers()
})
