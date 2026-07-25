import type { BrowserNavigationResult } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk, scriptEvaluate } from '../../setup.js'

describe('BrowserNavigationManager', () => {
	it('reloads and returns the correlated document response', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.reload', (message) => {
			transport.reply(message.id, {})
			transport.event(
				'Network.responseReceived',
				{
					requestId: 'request-1',
					loaderId: 'loader-1',
					frameId: 'frame-1',
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
			transport.event('Page.loadEventFired', {}, 'session-1')
		})
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/',
		)
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/',
			'frame-1',
		)
		replyOk(transport, 'Network.enable')
		await page.network.start()

		const result = await page.reload()

		expect(result).toMatchObject({
			url: 'https://example.com/',
			same: false,
			response: { status: 200, loader: 'loader-1' },
		})
	})

	it('navigates backward and forward through history entries', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let index = 1
		transport.onSend('Page.getNavigationHistory', (message) => {
			transport.reply(message.id, {
				currentIndex: index,
				entries: [{ id: 1 }, { id: 2 }, { id: 3 }],
			})
		})
		transport.onSend('Page.navigateToHistoryEntry', (message) => {
			index = message.params?.['entryId'] === 1 ? 0 : 2
			transport.reply(message.id, {})
			transport.event('Page.loadEventFired', {}, 'session-1')
		})
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/history',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.back()
		await page.forward()

		const entries = transport.sent
			.filter((message) => message.method === 'Page.navigateToHistoryEntry')
			.map((message) => message.params?.['entryId'])
		expect(entries).toEqual([1, 2])
	})

	it('supports commit and same-document completion without waiting for load', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let same = false
		transport.onSend('Page.navigate', (message) => {
			transport.reply(message.id, same ? {} : { loaderId: 'loader-1' })
			if (same) {
				transport.event(
					'Page.navigatedWithinDocument',
					{ frameId: 'frame-1', url: 'https://example.com/#next' },
					'session-1',
				)
			} else {
				transport.event(
					'Page.frameNavigated',
					{ frame: { id: 'frame-1', url: 'https://example.com/' } },
					'session-1',
				)
			}
		})
		let url = 'https://example.com/'
		transport.onSend('Runtime.evaluate', (message) => {
			transport.reply(message.id, { result: { value: url } })
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, url, 'frame-1')

		const committed = await page.navigate(url, { condition: 'commit' })
		same = true
		url = 'https://example.com/#next'
		const within = await page.navigate(url)

		expect(committed.same).toBe(false)
		expect(within.same).toBe(true)
	})

	it('waits for a matching URL glob and resolves immediately for the current URL', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/start',
			'frame-1',
		)

		await expect(page.navigation.wait('**/start')).resolves.toBe('https://example.com/start')
		const pending = page.navigation.wait('**/done')
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'frame-1', url: 'https://example.com/done' } },
			'session-1',
		)
		await expect(pending).resolves.toBe('https://example.com/done')
	})

	it('resolves concurrent URL waits independently and rejects remaining waits on close', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Target.closeTarget')
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/start',
			'frame-1',
		)
		const first = page.navigation.wait('**/first')
		const second = page.navigation.wait('**/second')

		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'frame-1', url: 'https://example.com/first' } },
			'session-1',
		)
		await expect(first).resolves.toBe('https://example.com/first')
		await page.close()

		await expect(second).rejects.toThrow('page closed')
	})

	it('waits on an in-page predicate and rejects invalid timeouts', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(transport, (expression) => expression.includes('document.readyState'), 'ready')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(
			page.navigation.until(`() => document.readyState === 'complete' && 'ready'`),
		).resolves.toBe('ready')
		await expect(page.navigation.wait('*', { timeout: -1 })).rejects.toSatisfy(isBrowserError)
	})

	it('returns a typed no-op result when history has no entry in that direction', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.getNavigationHistory', {
			currentIndex: 0,
			entries: [{ id: 1 }],
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, 'https://example.com/')

		const result: BrowserNavigationResult = await page.back()

		expect(result).toEqual({
			url: 'https://example.com/',
			response: undefined,
			same: false,
		})
	})

	it('rejects invalid command timeouts before protocol traffic', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.navigate('https://example.com', { timeout: Number.NaN })).rejects.toSatisfy(
			isBrowserError,
		)
		await expect(page.reload({ timeout: -1 })).rejects.toSatisfy(isBrowserError)
		await expect(page.back({ timeout: Number.POSITIVE_INFINITY })).rejects.toSatisfy(isBrowserError)
		expect(transport.sent).toEqual([])
	})

	it('removes its response correlation listener when final URL decoding fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.navigate', (message) => {
			transport.reply(message.id, { loaderId: 'loader-1' })
			transport.event('Page.loadEventFired', {}, 'session-1')
		})
		transport.onSend('Runtime.evaluate', (message) => {
			transport.reply(message.id, { result: { value: 42 } })
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const baseline = page.network.emitter.count('response')

		await expect(page.navigate('https://example.com')).rejects.toSatisfy(isBrowserError)

		expect(page.network.emitter.count('response')).toBe(baseline)
	})
})
