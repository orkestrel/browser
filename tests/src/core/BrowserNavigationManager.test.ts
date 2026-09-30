import type { BrowserNavigationResult } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { waitForDelay } from '@orkestrel/test'
import {
	RecordingCDPClient,
	createConnectedCDPClient,
	emitBrowserNavigation,
	replyOk,
	scriptEvaluate,
} from '../../setup.js'

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

	it('rejects an invalid wait timeout', async () => {
		const { client } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.navigation.wait('*', { timeout: -1 })).rejects.toSatisfy(isBrowserError)
		await expect(page.navigation.idle({ timeout: -1 })).rejects.toSatisfy(isBrowserError)
	})

	it('resolves a URL wait on a same-document navigation', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/start',
			'frame-1',
		)
		const pending = page.navigation.wait('**#pushed')

		transport.event(
			'Page.navigatedWithinDocument',
			{ frameId: 'frame-1', url: 'https://example.com/start#pushed' },
			'session-1',
		)

		await expect(pending).resolves.toBe('https://example.com/start#pushed')
	})

	it('rejects a parked wait with the abort reason and releases its listener', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/start',
			'frame-1',
		)
		const reason = new Error('stop waiting')
		const controller = new AbortController()
		const pending = page.navigation.wait('**/never', { signal: controller.signal })
		const idling = page.navigation.idle({ signal: controller.signal })

		controller.abort(reason)

		await expect(pending).rejects.toBe(reason)
		await expect(idling).rejects.toBe(reason)
		await expect(page.navigation.wait('**/never', { signal: controller.signal })).rejects.toBe(
			reason,
		)
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'frame-1', url: 'https://example.com/never' } },
			'session-1',
		)
	})

	it('resolves idle on networkIdle for the current loader and ignores a stale loader', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'frame-1', url: 'https://example.com/', loaderId: 'loader-2' } },
			'session-1',
		)
		let settled = false
		const idling = page.navigation.idle().then(() => {
			settled = true
		})

		transport.event(
			'Page.lifecycleEvent',
			{ frameId: 'frame-1', loaderId: 'loader-1', name: 'networkIdle', timestamp: 1 },
			'session-1',
		)
		transport.event(
			'Page.lifecycleEvent',
			{ frameId: 'frame-1', loaderId: 'loader-2', name: 'load', timestamp: 1 },
			'session-1',
		)
		await waitForDelay(20)
		expect(settled).toBe(false)

		transport.event(
			'Page.lifecycleEvent',
			{ frameId: 'frame-1', loaderId: 'loader-2', name: 'networkIdle', timestamp: 2 },
			'session-1',
		)
		await idling
		expect(settled).toBe(true)
	})

	it('completes navigate with the idle condition on the loader the reply names', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Page.navigate', (message) => {
			transport.reply(message.id, { loaderId: 'loader-5' })
			transport.event(
				'Page.lifecycleEvent',
				{ frameId: 'frame-1', loaderId: 'loader-4', name: 'networkIdle', timestamp: 1 },
				'session-1',
			)
		})
		scriptEvaluate(
			transport,
			(expression) => expression.includes('location.href'),
			'https://example.com/',
		)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		let settled = false
		const navigating = page
			.navigate('https://example.com/', { condition: 'idle' })
			.then((result) => {
				settled = true
				return result
			})

		await waitForDelay(20)
		expect(settled).toBe(false)
		transport.event(
			'Page.lifecycleEvent',
			{ frameId: 'frame-1', loaderId: 'loader-5', name: 'networkIdle', timestamp: 2 },
			'session-1',
		)

		await expect(navigating).resolves.toMatchObject({ url: 'https://example.com/', same: false })
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

	it('opens a record that adds no client registration while it settles or after it ends', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const recording = new RecordingCDPClient(client)
		const page = new BrowserPage(recording, 'main', 'session-main', undefined, undefined, 'main')
		try {
			const before = recording.registrations()
			expect(before).toBeGreaterThan(0)
			const record = page.navigation.record('main')
			expect(recording.registrations()).toBe(before)
			const settling = record.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
			emitBrowserNavigation(
				transport,
				'session-main',
				'main',
				'https://example.test/next',
				'loader-next',
			)
			await expect(settling).resolves.toEqual({
				url: 'https://example.test/next',
				stage: 'loaded',
				reason: 'formSubmissionPost',
			})
			expect(recording.registrations()).toBe(before)
			record.destroy()
			expect(recording.registrations()).toBe(before)
		} finally {
			await client.close()
		}
	})

	it('refuses a record on a closed page and rejects a pending record when the page closes', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Target.closeTarget')
		const page = new BrowserPage(client, 'main', 'session-main', undefined, undefined, 'main')
		try {
			const record = page.navigation.record('main')
			const waiting = record.wait().catch((error: unknown) => error)
			const settling = record
				.settle({ destinations: [{ frame: 'main', relationship: 'self' }] })
				.catch((error: unknown) => error)
			await page.close()
			for (const error of [await waiting, await settling])
				expect(isBrowserError(error) && error.message).toBe(
					'Browser navigation wait ended because the page closed',
				)
			const refusal = await Promise.resolve()
				.then(() => page.navigation.record('main'))
				.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.message).toBe('Browser page is closed')
		} finally {
			await client.close()
		}
	})
})
