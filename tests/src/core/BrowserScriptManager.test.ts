import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { waitForCondition } from '@orkestrel/test'
import { createConnectedCDPClient, replyOk } from '../../setup.js'

describe('BrowserScriptManager', () => {
	it('installs a script for future documents and evaluates it in the current document', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument', { identifier: 'script-1' })
		replyOk(transport, 'Runtime.evaluate', { result: { value: undefined } })
		const page = new BrowserPage(client, 'target-1', 'session-1')

		expect(await page.scripts.add('globalThis.flag = 1')).toBe('script-1')

		expect(transport.sent[0]?.params).toEqual({ source: 'globalThis.flag = 1' })
		expect(transport.sent[1]?.params?.['expression']).toContain('globalThis.flag = 1')
	})

	it('removes a new-document script when current-document installation fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument', { identifier: 'script-1' })
		transport.onSend('Runtime.evaluate', (message) => transport.fail(message.id, 'install failed'))
		replyOk(transport, 'Page.removeScriptToEvaluateOnNewDocument')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.scripts.add('throw new Error("failed")')).rejects.toThrow('install failed')

		expect(
			transport.sent.find(
				(message) => message.method === 'Page.removeScriptToEvaluateOnNewDocument',
			)?.params,
		).toEqual({ identifier: 'script-1' })
	})

	it('exposes a promise-based host function and resolves calls in their execution context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.addBinding')
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument', { identifier: 'binding-1' })
		replyOk(transport, 'Runtime.evaluate', { result: { value: undefined } })
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.scripts.expose('sum', (...args) => {
			const values = args.filter((value) => typeof value === 'number')
			return values.reduce((total, value) => total + value, 0)
		})

		transport.event(
			'Runtime.bindingCalled',
			{
				name: 'sum',
				payload: JSON.stringify({ id: 'call-1', name: 'sum', args: [2, 3] }),
				executionContextId: 9,
			},
			'session-1',
		)
		await waitForCondition('the script was evaluated in context 9', () =>
			transport.sent.some(
				(message) => message.method === 'Runtime.evaluate' && message.params?.['contextId'] === 9,
			),
		)

		const resolution = transport.sent.find(
			(message) => message.method === 'Runtime.evaluate' && message.params?.['contextId'] === 9,
		)
		expect(resolution?.params?.['expression']).toContain('"call-1", true, 5')
	})

	it('rejects invalid names before registering a runtime binding', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.scripts.expose('not-valid!', () => undefined)).rejects.toSatisfy(
			isBrowserError,
		)
		expect(transport.sent).toEqual([])
	})

	it('removes bindings and their new-document scripts during revocation', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.addBinding')
		replyOk(transport, 'Runtime.removeBinding')
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument', { identifier: 'binding-1' })
		replyOk(transport, 'Page.removeScriptToEvaluateOnNewDocument')
		replyOk(transport, 'Runtime.evaluate', { result: { value: undefined } })
		const page = new BrowserPage(client, 'target-1', 'session-1')
		await page.scripts.expose('bridge', () => true)

		await page.scripts.revoke('bridge')

		expect(
			transport.sent.find((message) => message.method === 'Runtime.removeBinding')?.params,
		).toEqual({ name: 'bridge' })
		expect(
			transport.sent.find(
				(message) => message.method === 'Page.removeScriptToEvaluateOnNewDocument',
			)?.params,
		).toEqual({ identifier: 'binding-1' })
		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Runtime.evaluate' &&
					typeof message.params?.['expression'] === 'string' &&
					message.params['expression'].includes('delete globalThis'),
			),
		).toBe(true)
	})

	it('rolls back the Runtime binding when facade installation fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.addBinding')
		replyOk(transport, 'Runtime.removeBinding')
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument', { identifier: 'binding-1' })
		replyOk(transport, 'Page.removeScriptToEvaluateOnNewDocument')
		transport.onSend('Runtime.evaluate', (message) => transport.fail(message.id, 'facade failed'))
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.scripts.expose('bridge', () => true)).rejects.toThrow('facade failed')

		expect(transport.sent.some((message) => message.method === 'Runtime.removeBinding')).toBe(true)
		expect(
			transport.sent.some(
				(message) => message.method === 'Page.removeScriptToEvaluateOnNewDocument',
			),
		).toBe(true)
	})
})
