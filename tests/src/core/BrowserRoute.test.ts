/**
 * src/core/BrowserRoute.ts tests.
 *
 * `BrowserRoute` is interned rather than barrelled, so it is imported by path. Each case
 * drives the real class over a real `BrowserPage` on the in-memory CDP transport and
 * asserts on the Fetch-domain frames it produced, decoding the base64 bodies it encodes.
 */

import type { BrowserRequest } from '@src/core'
import { describe, expect, it } from 'vitest'
import { decodeBase64, isBrowserError } from '@src/core'
import { BrowserRoute } from '../../../src/core/BrowserRoute.js'
import { createAttachedPage, readCDPParams, replyOk } from '../../setup.js'

const REQUEST: BrowserRequest = {
	id: 'request-1',
	loader: undefined,
	frame: undefined,
	url: 'https://example.com/api',
	method: 'GET',
	headers: {},
	post: undefined,
	resource: undefined,
	timestamp: undefined,
	walltime: undefined,
	redirect: undefined,
}

describe('BrowserRoute', () => {
	it('reports its identity, its paused request, and an unhandled state', async () => {
		const { page } = await createAttachedPage()
		const route = new BrowserRoute(page, 'request-1', REQUEST)

		expect([route.id, route.handled]).toStrictEqual(['request-1', false])
		expect(route.request).toBe(REQUEST)
	})

	it('aborts with the default reason and with an explicit one', async () => {
		const defaulted = await createAttachedPage()
		replyOk(defaulted.transport, 'Fetch.failRequest')
		await new BrowserRoute(defaulted.page, 'request-1', REQUEST).abort()

		const named = await createAttachedPage()
		replyOk(named.transport, 'Fetch.failRequest')
		await new BrowserRoute(named.page, 'request-1', REQUEST).abort('AccessDenied')

		expect(readCDPParams(defaulted.transport, 'Fetch.failRequest')).toStrictEqual([
			{ requestId: 'request-1', errorReason: 'Failed' },
		])
		expect(readCDPParams(named.transport, 'Fetch.failRequest')).toStrictEqual([
			{ requestId: 'request-1', errorReason: 'AccessDenied' },
		])
	})

	it('continues untouched and continues with each override applied', async () => {
		const bare = await createAttachedPage()
		replyOk(bare.transport, 'Fetch.continueRequest')
		await new BrowserRoute(bare.page, 'request-1', REQUEST).continue()

		const overridden = await createAttachedPage()
		replyOk(overridden.transport, 'Fetch.continueRequest')
		await new BrowserRoute(overridden.page, 'request-1', REQUEST).continue({
			url: 'https://example.com/other',
			method: 'POST',
			headers: { 'x-test': 'one' },
			post: 'body',
		})

		expect(readCDPParams(bare.transport, 'Fetch.continueRequest')).toStrictEqual([
			{ requestId: 'request-1' },
		])
		const params = readCDPParams(overridden.transport, 'Fetch.continueRequest')[0] ?? {}
		expect(params['url']).toBe('https://example.com/other')
		expect(params['method']).toBe('POST')
		expect(params['headers']).toStrictEqual([{ name: 'x-test', value: 'one' }])
		expect(new TextDecoder().decode(decodeBase64(String(params['postData'])))).toBe('body')
	})

	it('fulfills with the default status and with an explicit status, phrase, headers, and body', async () => {
		const defaulted = await createAttachedPage()
		replyOk(defaulted.transport, 'Fetch.fulfillRequest')
		await new BrowserRoute(defaulted.page, 'request-1', REQUEST).fulfill({})

		const explicit = await createAttachedPage()
		replyOk(explicit.transport, 'Fetch.fulfillRequest')
		await new BrowserRoute(explicit.page, 'request-1', REQUEST).fulfill({
			status: 404,
			phrase: 'Not Found',
			headers: { 'content-type': 'text/plain' },
			body: 'missing',
		})

		expect(readCDPParams(defaulted.transport, 'Fetch.fulfillRequest')).toStrictEqual([
			{ requestId: 'request-1', responseCode: 200 },
		])
		const params = readCDPParams(explicit.transport, 'Fetch.fulfillRequest')[0] ?? {}
		expect(params['responseCode']).toBe(404)
		expect(params['responsePhrase']).toBe('Not Found')
		expect(params['responseHeaders']).toStrictEqual([{ name: 'content-type', value: 'text/plain' }])
		expect(new TextDecoder().decode(decodeBase64(String(params['body'])))).toBe('missing')
	})

	it('fulfills a byte body without re-encoding it as text', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Fetch.fulfillRequest')

		await new BrowserRoute(page, 'request-1', REQUEST).fulfill({
			body: Uint8Array.from([0, 1, 254]),
		})

		const params = readCDPParams(transport, 'Fetch.fulfillRequest')[0] ?? {}
		expect([...decodeBase64(String(params['body']))]).toStrictEqual([0, 1, 254])
	})

	it('accepts the status boundaries and refuses anything outside them', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Fetch.fulfillRequest')

		await new BrowserRoute(page, 'request-1', REQUEST).fulfill({ status: 100 })
		await new BrowserRoute(page, 'request-1', REQUEST).fulfill({ status: 999 })
		await expect(
			new BrowserRoute(page, 'request-1', REQUEST).fulfill({ status: 99 }),
		).rejects.toSatisfy(isBrowserError)
		await expect(
			new BrowserRoute(page, 'request-1', REQUEST).fulfill({ status: 1000 }),
		).rejects.toSatisfy(isBrowserError)
		await expect(
			new BrowserRoute(page, 'request-1', REQUEST).fulfill({ status: 200.5 }),
		).rejects.toSatisfy(isBrowserError)

		expect(readCDPParams(transport, 'Fetch.fulfillRequest')).toHaveLength(2)
	})

	it('refuses a second decision and reports itself handled after the first', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Fetch.continueRequest')
		replyOk(transport, 'Fetch.failRequest')
		replyOk(transport, 'Fetch.fulfillRequest')
		const route = new BrowserRoute(page, 'request-1', REQUEST)

		await route.continue()

		expect(route.handled).toBe(true)
		await expect(route.continue()).rejects.toThrow('Browser route is already handled')
		await expect(route.abort()).rejects.toThrow('Browser route is already handled')
		await expect(route.fulfill({})).rejects.toThrow('Browser route is already handled')
	})

	it('stays unhandled when its decision frame fails, so it can be decided again', async () => {
		const { page, transport } = await createAttachedPage()
		transport.onSend('Fetch.continueRequest', (message) => {
			transport.fail(message.id, 'request gone')
		})
		replyOk(transport, 'Fetch.failRequest')
		const route = new BrowserRoute(page, 'request-1', REQUEST)

		await expect(route.continue()).rejects.toThrow('request gone')
		expect(route.handled).toBe(false)

		await route.abort()
		expect(route.handled).toBe(true)
	})
})
