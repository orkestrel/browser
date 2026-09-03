/**
 * src/core/BrowserPermissionManager.ts tests.
 *
 * Every case drives a real manager over a connected in-memory CDP client and asserts on
 * the `Browser.setPermission` and `Browser.resetPermissions` frames it produced, because
 * the parameter record is the whole contract the class carries.
 */

import { describe, expect, it } from 'vitest'
import { BrowserPermissionManager } from '@src/core'
import { createConnectedCDPClient, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserPermissionManager', () => {
	it('grants each permission as its own frame, in the given order', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.setPermission')
		const permissions = new BrowserPermissionManager(client)

		await permissions.grant(['geolocation', 'clipboardReadWrite'])

		expect(readCDPParams(transport, 'Browser.setPermission')).toStrictEqual([
			{ permission: { name: 'geolocation' }, setting: 'granted' },
			{ permission: { name: 'clipboardReadWrite' }, setting: 'granted' },
		])
	})

	it('denies with the same shape and the opposite setting', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.setPermission')
		const permissions = new BrowserPermissionManager(client)

		await permissions.deny(['notifications'])

		expect(readCDPParams(transport, 'Browser.setPermission')).toStrictEqual([
			{ permission: { name: 'notifications' }, setting: 'denied' },
		])
	})

	it('carries an explicit origin and the owning context into every frame', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.setPermission')
		const permissions = new BrowserPermissionManager(client, 'context-1')

		await permissions.grant(['geolocation'], 'https://example.com')

		expect(readCDPParams(transport, 'Browser.setPermission')).toStrictEqual([
			{
				permission: { name: 'geolocation' },
				setting: 'granted',
				origin: 'https://example.com',
				browserContextId: 'context-1',
			},
		])
	})

	it('sends nothing for an empty permission list', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Browser.setPermission')
		const permissions = new BrowserPermissionManager(client)

		await permissions.grant([])
		await permissions.deny([])

		expect(transport.sent).toStrictEqual([])
	})

	it('resets with the owning context and without one', async () => {
		const scoped = await createConnectedCDPClient()
		replyOk(scoped.transport, 'Browser.resetPermissions')
		await new BrowserPermissionManager(scoped.client, 'context-1').clear()

		const global = await createConnectedCDPClient()
		replyOk(global.transport, 'Browser.resetPermissions')
		await new BrowserPermissionManager(global.client).clear()

		expect(readCDPParams(scoped.transport, 'Browser.resetPermissions')).toStrictEqual([
			{ browserContextId: 'context-1' },
		])
		expect(readCDPParams(global.transport, 'Browser.resetPermissions')).toStrictEqual([{}])
	})

	it('stops at the first failing permission rather than continuing the list', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Browser.setPermission', (message) => {
			transport.fail(message.id, 'permission refused')
		})
		const permissions = new BrowserPermissionManager(client)

		await expect(permissions.grant(['geolocation', 'notifications'])).rejects.toThrow(
			'permission refused',
		)
		expect(readCDPParams(transport, 'Browser.setPermission')).toStrictEqual([
			{ permission: { name: 'geolocation' }, setting: 'granted' },
		])
	})
})
