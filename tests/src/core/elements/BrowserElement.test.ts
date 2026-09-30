import { describe, expect, it } from 'vitest'
import { BrowserElementError, isBrowserElementError } from '@src/core'
import { requireValue } from '@orkestrel/test'
import { createBrowserElementFixture } from '../../../setup.js'

describe('trusted element actions', () => {
	it.each([
		['DOM.scrollIntoViewIfNeeded', 'Node does not have a layout object', 'HIDDEN'],
		['DOM.getContentQuads', 'Could not find node with given id', 'GONE'],
		['DOM.focus', 'Cannot find context with specified id', 'GONE'],
	])('catches unmapped %s failure', async (method, message, reason) => {
		const { page, client } = await createBrowserElementFixture({ failure: { method, message } })
		try {
			await page.elements.outline()
			const element = requireValue(page.elements.element('e1'))
			await expect(
				method === 'DOM.focus' ? element.focus() : element.click(),
			).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_ERROR', context: { reason } })
		} finally {
			await client.close()
		}
	})

	it.each(['cssLayoutViewport', 'cssVisualViewport'])(
		'catches missing document scroll for hits and screenshots with %s',
		async (viewport) => {
			const { page, client, transport } = await createBrowserElementFixture({
				metrics: { [viewport]: { pageX: 7, pageY: 2900 } },
			})
			try {
				await page.elements.outline()
				const element = requireValue(page.elements.element('e1'))
				await element.click()
				await element.screenshot()
				expect(
					transport.sent.find((message) => message.method === 'DOM.getNodeForLocation'),
				).toMatchObject({ sessionId: 'session-main', params: { x: 27, y: 2930 } })
				expect(
					transport.sent
						.filter((message) => message.method === 'Input.dispatchMouseEvent')
						.map((message) => [message.params?.['x'], message.params?.['y']]),
				).toEqual([
					[20, 30],
					[20, 30],
				])
				expect(
					transport.sent.find((message) => message.method === 'Page.captureScreenshot')?.params?.[
						'clip'
					],
				).toEqual({ x: 17, y: 2920, width: 20, height: 20, scale: 1 })
			} finally {
				await client.close()
			}
		},
	)
	it('catches missing select, reading invalidation, hover, drag translation, and screenshot clipping', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const source = requireValue(page.elements.element('e1'))
			const target = requireValue(page.elements.element('e6'))
			await source.select(['Business'])
			expect(
				transport.sent.some((message) =>
					String(message.params?.['functionDeclaration']).includes('const values = ["Business"]'),
				),
			).toBe(true)
			const reading = await source.read()
			expect(reading.url).toBe('https://example.test/cart')
			expect(reading.stale).toBe(false)
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: 'main', url: 'https://example.test/cart#saved' },
				'session-main',
			)
			expect(reading.stale).toBe(true)
			await source.hover()
			await source.drag(target)
			expect(
				transport.sent
					.filter((message) => message.method === 'Input.dispatchMouseEvent')
					.map((message) => [
						message.params?.['type'],
						message.params?.['x'],
						message.params?.['y'],
					]),
			).toEqual([
				['mouseMoved', 20, 30],
				['mousePressed', 20, 30],
				['mouseMoved', 250, 200],
				['mouseReleased', 250, 200],
			])
			expect((await target.screenshot()).bytes.length).toBeGreaterThan(0)
			expect(
				transport.sent.find((message) => message.method === 'Page.captureScreenshot')?.params?.[
					'clip'
				],
			).toEqual({ x: 240, y: 190, width: 20, height: 20, scale: 1 })
		} finally {
			await client.close()
		}
	})

	it('catches omitting keyUp when a signal aborts after keyDown', async () => {
		const controller = new AbortController()
		const reason = new Error('Stopped after key down')
		const { page, client, transport } = await createBrowserElementFixture()
		transport.onSend('Input.dispatchKeyEvent', (message) => {
			if (message.params?.['type'] === 'keyDown') controller.abort(reason)
		})
		try {
			await page.elements.outline()
			await expect(
				requireValue(page.elements.element('e2')).press('Enter', { signal: controller.signal }),
			).rejects.toBe(reason)
			expect(
				transport.sent
					.filter((message) => message.method === 'Input.dispatchKeyEvent')
					.map((message) => message.params?.['type']),
			).toEqual(['keyDown', 'keyUp'])
		} finally {
			await client.close()
		}
	})
	it('catches leaked remote objects from focus and upload', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const element = requireValue(page.elements.element('e2'))
			await element.focus()
			await element.upload(['attachment.txt'])
			expect(
				transport.sent
					.filter((message) => message.method === 'Runtime.releaseObject')
					.map((message) => message.params?.['objectId']),
			).toEqual(['object-5', 'object-5'])
		} finally {
			await client.close()
		}
	})
	it('catches reordered or omitted scroll, actionability, geometry, hit, and input steps', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const before = transport.sent.length
			await requireValue(page.elements.element('e1')).click()
			expect(
				transport.sent
					.slice(before)
					.filter((message) => message.method === 'Runtime.releaseObject')
					.map((message) => message.params?.['objectId']),
			).toEqual(['object-3'])
			expect(
				transport.sent.find((message) => message.method === 'DOM.getNodeForLocation')?.params,
			).not.toHaveProperty('includeUserAgentShadowDOM')
			expect(
				transport.sent
					.slice(before)
					.filter((message) =>
						[
							'DOM.scrollIntoViewIfNeeded',
							'Runtime.callFunctionOn',
							'DOM.getContentQuads',
							'DOM.getNodeForLocation',
							'Input.dispatchMouseEvent',
						].includes(message.method),
					)
					.map((message) =>
						message.method === 'Input.dispatchMouseEvent'
							? message.params?.['type']
							: message.method,
					),
			).toEqual([
				'DOM.scrollIntoViewIfNeeded',
				'Runtime.callFunctionOn',
				'DOM.getContentQuads',
				'DOM.getNodeForLocation',
				'mousePressed',
				'mouseReleased',
			])
			expect(
				transport.sent.find((message) => message.method === 'Runtime.callFunctionOn')?.params?.[
					'functionDeclaration'
				],
			).toContain('requestAnimationFrame')
		} finally {
			await client.close()
		}
	})

	it('catches accepting an empty quad list', async () => {
		const { page, client, transport } = await createBrowserElementFixture({ hidden: true })
		try {
			await page.elements.outline()
			await expect(requireValue(page.elements.element('e1')).click()).rejects.toMatchObject({
				context: { reason: 'HIDDEN' },
			})
			expect(transport.sent.some((message) => message.method === 'Input.dispatchMouseEvent')).toBe(
				false,
			)
		} finally {
			await client.close()
		}
	})

	it('catches accepting a hit on an unrelated covering node', async () => {
		const { page, client, transport } = await createBrowserElementFixture({ covered: true })
		try {
			await page.elements.outline()
			await expect(requireValue(page.elements.element('e1')).click()).rejects.toMatchObject({
				context: { reason: 'OCCLUDED' },
				message: expect.stringContaining('div#overlay'),
			})
			expect(transport.sent.some((message) => message.method === 'Input.dispatchMouseEvent')).toBe(
				false,
			)
		} finally {
			await client.close()
		}
	})

	it('catches treating failed DOM resolution as a successful action', async () => {
		const { page, client } = await createBrowserElementFixture({ gone: true })
		try {
			await page.elements.outline()
			await expect(requireValue(page.elements.element('e1')).click()).rejects.toMatchObject({
				context: { reason: 'GONE' },
				message: expect.stringContaining('look'),
			})
		} finally {
			await client.close()
		}
	})

	it('catches disabled actionability being ignored', async () => {
		const { page, client } = await createBrowserElementFixture({
			actionability: 'Element is disabled',
		})
		try {
			await page.elements.outline()
			await expect(requireValue(page.elements.element('e1')).click()).rejects.toMatchObject({
				context: { reason: 'DISABLED' },
			})
		} finally {
			await client.close()
		}
	})

	it('catches passing an aborted signal to mouseReleased or losing the abort reason', async () => {
		const controller = new AbortController()
		const reason = new Error('Stopped after press')
		const { page, client, transport } = await createBrowserElementFixture({
			pressed: () => controller.abort(reason),
		})
		try {
			await page.elements.outline()
			await expect(
				requireValue(page.elements.element('e1')).click({ signal: controller.signal }),
			).rejects.toBe(reason)
			expect(
				transport.sent
					.filter((message) => message.method === 'Input.dispatchMouseEvent')
					.map((message) => message.params?.['type']),
			).toEqual(['mousePressed', 'mouseReleased'])
		} finally {
			await client.close()
		}
	})

	it('catches appending instead of replacing text and missing key release', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const element = requireValue(page.elements.element('e2'))
			await element.fill('ada@example.test')
			const focus = transport.sent.findIndex((message) => message.method === 'DOM.focus')
			const select = transport.sent.findIndex(
				(message) =>
					message.method === 'Runtime.callFunctionOn' &&
					String(message.params?.['functionDeclaration']).includes('this.select()'),
			)
			const insert = transport.sent.findIndex((message) => message.method === 'Input.insertText')
			expect(focus).toBeGreaterThan(-1)
			expect(select).toBeGreaterThan(focus)
			expect(insert).toBeGreaterThan(select)
			expect(transport.sent[insert]?.params).toEqual({ text: 'ada@example.test' })
			await element.press('enter')
			expect(
				transport.sent
					.filter((message) => message.method === 'Input.dispatchKeyEvent')
					.map((message) => [message.params?.['type'], message.params?.['key']]),
			).toEqual([
				['keyDown', 'Enter'],
				['keyUp', 'Enter'],
			])
		} finally {
			await client.close()
		}
	})

	it('catches a submit that skips the focus, the Enter pair, or the page session', async () => {
		const { page, client, transport } = await createBrowserElementFixture()
		try {
			await page.elements.outline()
			const start = transport.sent.length
			await requireValue(page.elements.element('e2')).submit()
			const sent = transport.sent.slice(start)
			const focus = sent.findIndex((message) => message.method === 'DOM.focus')
			const keys = sent.filter((message) => message.method === 'Input.dispatchKeyEvent')
			expect(focus).toBeGreaterThan(-1)
			expect(sent.indexOf(requireValue(keys[0]))).toBeGreaterThan(focus)
			expect(keys.map((message) => [message.params?.['type'], message.params?.['key']])).toEqual([
				['keyDown', 'Enter'],
				['keyUp', 'Enter'],
			])
			expect(keys.map((message) => message.sessionId)).toEqual(['session-main', 'session-main'])
		} finally {
			await client.close()
		}
	})

	it('catches losing element error identity, code, reason, or recovery', () => {
		const error = new BrowserElementError('e12', 'GONE')
		expect(isBrowserElementError(error)).toBe(true)
		expect(isBrowserElementError(new Error('gone'))).toBe(false)
		expect(error).toMatchObject({
			code: 'BROWSER_ELEMENT_ERROR',
			context: { reason: 'GONE', reference: 'e12' },
			message: expect.stringContaining('is gone because the page changed; call look'),
		})
	})
})
