import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk, waitForCondition } from '../../setup.js'

describe('BrowserClock', () => {
	it('installs, advances by a budget event, pauses, resumes, and uninstalls virtual time', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Emulation.setVirtualTimePolicy', (message) => {
			transport.reply(message.id, {})
			if (message.params?.['budget'] !== undefined) {
				transport.event('Emulation.virtualTimeBudgetExpired', {}, 'session-1')
			}
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.clock.install(1_000)
		expect(page.clock.installed).toBe(true)
		await page.clock.advance(50)
		await page.clock.pause()
		await page.clock.resume()
		await page.clock.uninstall()

		expect(page.clock.installed).toBe(false)
		expect(transport.sent[0]?.params).toEqual({
			policy: 'pause',
			initialVirtualTime: 1,
		})
		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Emulation.setVirtualTimePolicy' && message.params?.['budget'] === 50,
			),
		).toBe(true)
	})

	it('treats a zero budget as an immediate pause without waiting for an event', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Emulation.setVirtualTimePolicy')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.clock.install(1_000)

		await expect(page.clock.advance(0)).resolves.toBeUndefined()

		expect(transport.sent.some((message) => message.params?.['budget'] !== undefined)).toBe(false)
	})

	it('rejects invalid lifecycle and budget boundaries before protocol traffic', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.clock.advance(1)).rejects.toSatisfy(isBrowserError)
		await expect(page.clock.install(-1)).rejects.toSatisfy(isBrowserError)
		expect(transport.sent).toEqual([])
	})

	it('preserves an advance failure while restoring the paused clock policy', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Emulation.setVirtualTimePolicy', (message) => {
			if (message.params?.['budget'] !== undefined) {
				transport.fail(message.id, 'budget failed')
				return
			}
			transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.clock.install(1_000)

		await expect(page.clock.advance(10)).rejects.toThrow('budget failed')

		const policies = transport.sent.filter(
			(message) => message.method === 'Emulation.setVirtualTimePolicy',
		)
		expect(policies.at(-1)?.params).toEqual({ policy: 'pause' })
	})

	it('rejects overlapping policy changes while an advance budget is active', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Emulation.setVirtualTimePolicy')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.clock.install(1_000)

		const active = page.clock.advance(10)
		await waitForCondition(() =>
			transport.sent.some((message) => message.params?.['budget'] === 10),
		)

		await expect(page.clock.advance(1)).rejects.toThrow('already active')
		await expect(page.clock.pause()).rejects.toThrow('already active')
		await expect(page.clock.uninstall()).rejects.toThrow('already active')

		transport.event('Emulation.virtualTimeBudgetExpired', {}, 'session-1')
		await expect(active).resolves.toBeUndefined()
	})
})
