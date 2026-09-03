import { describe, expect, it } from 'vitest'
import { BrowserEmulationManager, BrowserPage, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk } from '../../setup.js'

describe('BrowserEmulationManager', () => {
	it('applies rendering, locale, location, media, network, and header overrides', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Emulation.setDeviceMetricsOverride',
			'Emulation.setTouchEmulationEnabled',
			'Emulation.setUserAgentOverride',
			'Emulation.setLocaleOverride',
			'Emulation.setTimezoneOverride',
			'Emulation.setGeolocationOverride',
			'Emulation.setEmulatedMedia',
			'Network.enable',
			'Network.emulateNetworkConditions',
			'Network.setExtraHTTPHeaders',
		]) {
			replyOk(transport, method)
		}
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])

		await emulation.apply({
			viewport: {
				width: 800,
				height: 600,
				scale: 2,
				mobile: true,
				touch: true,
				landscape: true,
			},
			user: { value: 'Agent', language: 'fr-FR', platform: 'Linux' },
			locale: 'fr-FR',
			timezone: 'Europe/Paris',
			geolocation: { latitude: 1, longitude: 2, accuracy: 3 },
			media: { output: 'print', scheme: 'dark', motion: 'reduce' },
			offline: true,
			headers: { 'x-test': 'one' },
		})

		expect(
			transport.sent.find((message) => message.method === 'Emulation.setDeviceMetricsOverride')
				?.params,
		).toMatchObject({
			width: 800,
			height: 600,
			deviceScaleFactor: 2,
			mobile: true,
			screenOrientation: { type: 'landscapePrimary', angle: 90 },
		})
		expect(
			transport.sent.find((message) => message.method === 'Emulation.setEmulatedMedia')?.params,
		).toEqual({
			media: 'print',
			features: [
				{ name: 'prefers-color-scheme', value: 'dark' },
				{ name: 'prefers-reduced-motion', value: 'reduce' },
			],
		})
	})

	it('enables the Network domain before overriding offline state and extra headers', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Network.enable',
			'Network.emulateNetworkConditions',
			'Network.setExtraHTTPHeaders',
		]) {
			replyOk(transport, method)
		}
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])

		await emulation.apply({ offline: true, headers: { 'x-test': 'one' } })

		const methods = transport.sent.map((message) => message.method)
		expect(methods.indexOf('Network.enable')).toBeGreaterThanOrEqual(0)
		expect(methods.indexOf('Network.enable')).toBeLessThan(
			methods.indexOf('Network.emulateNetworkConditions'),
		)
		expect(methods.indexOf('Network.enable')).toBeLessThan(
			methods.indexOf('Network.setExtraHTTPHeaders'),
		)
	})

	it('clears the offline state and extra headers through the page network manager', async () => {
		const { client, transport } = await createConnectedCDPClient()
		for (const method of [
			'Network.enable',
			'Network.emulateNetworkConditions',
			'Network.setExtraHTTPHeaders',
			'Emulation.setLocaleOverride',
		]) {
			replyOk(transport, method)
		}
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])

		await emulation.apply({ offline: true, headers: { 'x-test': 'one' } })
		await emulation.apply({ locale: 'fr-FR' })

		expect(
			transport.sent
				.filter((message) => message.method === 'Network.emulateNetworkConditions')
				.map((message) => message.params?.['offline']),
		).toEqual([true, false])
		expect(
			transport.sent
				.filter((message) => message.method === 'Network.setExtraHTTPHeaders')
				.map((message) => message.params?.['headers']),
		).toEqual([{ 'x-test': 'one' }, {}])
	})

	it('inherits saved options when a later page is attached', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Emulation.setLocaleOverride')
		const pages: BrowserPage[] = []
		const emulation = new BrowserEmulationManager(() => pages, { locale: 'de-DE' })
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await emulation.attach(page)

		expect(transport.sent[0]?.params).toEqual({ locale: 'de-DE' })
	})

	it('clears partial overrides when attaching inherited emulation fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Emulation.setLocaleOverride', (message) => {
			if (message.params?.['locale'] === 'fr-FR') transport.fail(message.id, 'locale failed')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [], { locale: 'fr-FR' })

		await expect(emulation.attach(page)).rejects.toThrow('locale failed')

		expect(
			transport.sent
				.filter((message) => message.method === 'Emulation.setLocaleOverride')
				.map((message) => message.params?.['locale']),
		).toEqual(['fr-FR', ''])
	})

	it('rejects invalid viewport and geolocation bounds before partial application', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])

		await expect(emulation.apply({ viewport: { width: 0, height: 600 } })).rejects.toSatisfy(
			isBrowserError,
		)
		await expect(
			emulation.apply({ geolocation: { latitude: 91, longitude: 0 } }),
		).rejects.toSatisfy(isBrowserError)

		expect(transport.sent).toEqual([])
	})

	it('clears superseded overrides before applying replacement options', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Emulation.setLocaleOverride')
		replyOk(transport, 'Emulation.setTimezoneOverride')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])

		await emulation.apply({ timezone: 'Europe/Paris' })
		await emulation.apply({ locale: 'fr-FR' })

		expect(
			transport.sent
				.filter((message) => message.method === 'Emulation.setTimezoneOverride')
				.map((message) => message.params?.['timezoneId']),
		).toEqual(['Europe/Paris', ''])
		expect(
			transport.sent
				.filter((message) => message.method === 'Emulation.setLocaleOverride')
				.map((message) => message.params?.['locale']),
		).toEqual(['fr-FR'])
	})

	it('rolls back page overrides and saved inheritance when replacement fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Emulation.setLocaleOverride', (message) => {
			if (message.params?.['locale'] === 'fr-FR') {
				transport.fail(message.id, 'locale failed')
				return
			}
			transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const emulation = new BrowserEmulationManager(() => [page])
		await emulation.apply({ locale: 'de-DE' })

		await expect(emulation.apply({ locale: 'fr-FR' })).rejects.toThrow('locale failed')
		await emulation.attach(page)

		const locales = transport.sent
			.filter((message) => message.method === 'Emulation.setLocaleOverride')
			.map((message) => message.params?.['locale'])
		expect(locales).toEqual(['de-DE', '', 'fr-FR', '', 'de-DE', 'de-DE'])
	})
})
