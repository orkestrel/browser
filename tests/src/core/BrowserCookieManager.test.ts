import { describe, expect, it } from 'vitest'
import { BrowserCookieManager, BrowserPermissionManager, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk } from '../../setup.js'

describe('BrowserCookieManager', () => {
	it('decodes context cookies and filters them by request URL', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.getCookies', {
			cookies: [
				{
					name: 'session',
					value: 'one',
					domain: '.example.com',
					path: '/app',
					expires: 100,
					httpOnly: true,
					secure: true,
					sameSite: 'Lax',
					partitionKey: {
						topLevelSite: 'https://example.com',
						hasCrossSiteAncestor: false,
					},
				},
				{
					name: 'other',
					value: 'two',
					domain: 'other.test',
					path: '/',
					expires: -1,
					httpOnly: false,
					secure: false,
					sameSite: 'None',
				},
			],
		})
		const cookies = new BrowserCookieManager(client, 'context-1')

		const result = await cookies.list(['https://www.example.com/app/page'])

		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({
			name: 'session',
			http: true,
			partition: { site: 'https://example.com', ancestor: false },
		})
		expect(transport.sent[0]?.params).toEqual({ browserContextId: 'context-1' })
	})

	it('maps cookie inputs to Storage.setCookies without inventing absent fields', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.setCookies')
		const cookies = new BrowserCookieManager(client, 'context-1')

		await cookies.set([
			{
				name: 'token',
				value: 'secret',
				url: 'https://example.com/',
				http: true,
				secure: true,
				site: 'Strict',
				priority: 'High',
			},
		])

		expect(transport.sent[0]?.params).toEqual({
			browserContextId: 'context-1',
			cookies: [
				{
					name: 'token',
					value: 'secret',
					url: 'https://example.com/',
					httpOnly: true,
					secure: true,
					sameSite: 'Strict',
					priority: 'High',
				},
			],
		})
	})

	it('honors cookie path boundaries and accepts an absent same-site value', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.getCookies', {
			cookies: [
				{
					name: 'path',
					value: 'one',
					domain: 'example.com',
					path: '/app',
					expires: -1,
					httpOnly: false,
					secure: false,
				},
			],
		})
		const cookies = new BrowserCookieManager(client)

		await expect(cookies.list(['https://example.com/application'])).resolves.toEqual([])
		await expect(cookies.list(['https://example.com/app/page'])).resolves.toMatchObject([
			{ name: 'path', site: undefined },
		])
	})

	it('rejects malformed cookies before sending protocol traffic', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const cookies = new BrowserCookieManager(client)

		await expect(cookies.set([{ name: '', value: 'x', domain: 'example.com' }])).rejects.toSatisfy(
			isBrowserError,
		)
		await expect(cookies.set([{ name: 'x', value: 'x' }])).rejects.toSatisfy(isBrowserError)
		expect(transport.sent).toEqual([])
	})

	it('clears all cookies directly when no filter is supplied', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Storage.clearCookies')
		const cookies = new BrowserCookieManager(client, 'context-1')

		await cookies.clear()

		expect(transport.sent[0]?.params).toEqual({ browserContextId: 'context-1' })
	})
})

describe('BrowserPermissionManager', () => {
	it('applies each permission with origin and context isolation', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.setPermission')
		const permissions = new BrowserPermissionManager(client, 'context-1')

		await permissions.grant(['geolocation', 'notifications'], 'https://example.com')
		await permissions.deny(['camera'])

		const sent = transport.sent.filter((message) => message.method === 'Browser.setPermission')
		expect(sent).toHaveLength(3)
		expect(sent[0]?.params).toEqual({
			permission: { name: 'geolocation' },
			setting: 'granted',
			origin: 'https://example.com',
			browserContextId: 'context-1',
		})
		expect(sent[2]?.params).toEqual({
			permission: { name: 'camera' },
			setting: 'denied',
			browserContextId: 'context-1',
		})
	})

	it('resets only its browser context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.resetPermissions')
		const permissions = new BrowserPermissionManager(client, 'context-1')

		await permissions.clear()

		expect(transport.sent[0]?.params).toEqual({ browserContextId: 'context-1' })
	})
})
