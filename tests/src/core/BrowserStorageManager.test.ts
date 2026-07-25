import { describe, expect, it } from 'vitest'
import { BrowserCookieManager, BrowserPage, BrowserStorageManager, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk, scriptEvaluate } from '../../setup.js'

describe('BrowserStorageManager', () => {
	it('exports cookies plus local and session storage for attached origins', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.getCookies', { cookies: [] })
		scriptEvaluate(transport, (expression) => expression.includes('localStorage.length'), {
			local: [{ name: 'theme', value: 'dark' }],
			session: [{ name: 'nonce', value: 'one' }],
		})
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			'https://example.com/app',
		)
		const storage = new BrowserStorageManager(new BrowserCookieManager(client), () => [page])

		await expect(storage.state()).resolves.toEqual({
			cookies: [],
			origins: [
				{
					origin: 'https://example.com',
					local: [{ name: 'theme', value: 'dark' }],
					session: [{ name: 'nonce', value: 'one' }],
				},
			],
		})
	})

	it('restores web storage only through a matching attached origin', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.setCookies')
		scriptEvaluate(transport, (expression) => expression.includes('localStorage.setItem'), true)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, 'https://example.com/')
		const storage = new BrowserStorageManager(new BrowserCookieManager(client), () => [page])

		await storage.restore({
			cookies: [{ name: 'token', value: 'x', domain: 'example.com', path: '/' }],
			origins: [
				{
					origin: 'https://example.com',
					local: [{ name: 'theme', value: 'light' }],
					session: [],
				},
			],
		})

		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Runtime.evaluate' &&
					typeof message.params?.['expression'] === 'string' &&
					message.params['expression'].includes('"theme"'),
			),
		).toBe(true)
	})

	it('rejects an origin that has no attached page without mutating storage', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.getCookies', { cookies: [] })
		const storage = new BrowserStorageManager(new BrowserCookieManager(client), () => [])

		await expect(storage.state({ origins: ['https://missing.test'] })).rejects.toSatisfy(
			isBrowserError,
		)
		expect(transport.sent).toEqual([])
	})

	it('rejects non-HTTP origins before mutating cookies or page storage', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const storage = new BrowserStorageManager(new BrowserCookieManager(client), () => [])

		await expect(
			storage.restore({
				cookies: [{ name: 'token', value: 'x', domain: 'example.com', path: '/' }],
				origins: [{ origin: 'ftp://example.com', local: [], session: [] }],
			}),
		).rejects.toSatisfy(isBrowserError)

		expect(transport.sent).toEqual([])
	})

	it('clears cookies and both web-storage families', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.clearCookies')
		scriptEvaluate(transport, (expression) => expression.includes('sessionStorage.clear()'), true)
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, 'https://example.com/')
		const storage = new BrowserStorageManager(new BrowserCookieManager(client), () => [page])

		await storage.clear('https://example.com')

		expect(transport.sent.some((message) => message.method === 'Storage.clearCookies')).toBe(true)
		expect(transport.sent.some((message) => message.method === 'Runtime.evaluate')).toBe(true)
	})
})
