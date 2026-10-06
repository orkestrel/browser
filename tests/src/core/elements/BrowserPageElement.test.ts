import type { BrowserPageInterface } from '@src/core'
import type { BrowserInterface } from '@src/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserElementError, isBrowserElementError, isCDPError } from '@src/core'
import { requireValue, waitForCondition } from '@orkestrel/test'
import { createBrowserElementFixture } from '../../../setup.js'
import { readFileSync } from 'node:fs'
import { createBrowser } from '@src/server'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../../../setupService.js'

describe('real Chromium pointer settling', () => {
	let browser: BrowserInterface
	let page: BrowserPageInterface

	beforeEach(async () => {
		browser = createBrowser({
			executable: requireSystemBrowser().executable,
			headless: true,
			args: [...SERVICE_BROWSER_ARGS],
		})
		await browser.connect()
		page = await browser.create()
		await page.evaluate(
			`(document.write(${JSON.stringify(readFileSync(new URL('../../../fixtures/smooth-scroll.html', import.meta.url), 'utf8'))}), document.close())`,
		)
	})

	afterEach(async () => {
		await browser?.destroy()
	})

	it('lands a scrolling click and the immediately following distant click', async () => {
		const start = requireValue(
			(await page.elements.find({ role: 'link', name: 'Scroll to top' }))[0],
		)
		const finish = requireValue((await page.elements.find({ role: 'button', name: 'Finish' }))[0])
		await start.click()
		await finish.click()
		expect(await page.evaluate("document.getElementById('start').dataset.clicked")).toBe('true')
		expect(await page.evaluate("document.getElementById('finish').dataset.clicked")).toBe('true')
		expect(await page.evaluate("document.getElementById('finish').dataset.scroll")).toBe('0')
	})

	it('codes a real protocol location refusal as OCCLUDED', async () => {
		const element = requireValue(
			(await page.elements.find({ role: 'button', name: 'Outside the viewport' }))[0],
		)
		await expect(element.click()).rejects.toMatchObject({
			code: 'BROWSER_ELEMENT_ERROR',
			context: { reference: element.reference, reason: 'OCCLUDED' },
			message: expect.stringContaining('location held no node'),
		})
	})

	it('bounds a continuously scrolling document by the existing call timeout', async () => {
		const element = requireValue((await page.elements.find({ role: 'button', name: 'Finish' }))[0])
		await page.evaluate(
			"requestAnimationFrame(function move() { window.scrollTo({ top: window.scrollY === 0 ? 500 : 0, behavior: 'instant' }); requestAnimationFrame(move) })",
		)
		await expect(element.click({ timeout: 100 })).rejects.toMatchObject({
			code: 'BROWSER_CDP_TIMEOUT_ERROR',
			context: { timeout: 100 },
		})
		expect(await page.evaluate("document.getElementById('finish').dataset.clicked")).toBeUndefined()
	})

	it('aborts a scroll settle through the existing call signal', async () => {
		const element = requireValue((await page.elements.find({ role: 'button', name: 'Finish' }))[0])
		await page.evaluate(
			"requestAnimationFrame(function move() { window.scrollTo({ top: window.scrollY === 0 ? 500 : 0, behavior: 'instant' }); document.body.dataset.frames = String(Number(document.body.dataset.frames ?? 0) + 1); requestAnimationFrame(move) })",
		)
		const controller = new AbortController()
		const reason = new Error('Stop scroll settling')
		const clicking = element.click({ signal: controller.signal }).catch((error: unknown) => error)
		await waitForCondition(
			'scroll frames during the pending click',
			async () => Number(await page.evaluate('document.body.dataset.frames')) >= 10,
		)
		controller.abort(reason)
		expect(await clicking).toBe(reason)
		expect(await page.evaluate("document.getElementById('finish').dataset.clicked")).toBeUndefined()
	})
})

describe('trusted element actions', () => {
	it('preserves a deadline that expires during node resolution', async () => {
		const { page, client, transport } = await createBrowserElementFixture({
			resolve: () => undefined,
		})
		try {
			await page.elements.outline()
			await expect(
				requireValue(page.elements.element('e1')).focus({ timeout: 1 }),
			).rejects.toMatchObject({
				code: 'BROWSER_CDP_TIMEOUT_ERROR',
				context: { method: 'DOM.resolveNode', timeout: 1 },
			})
			expect(transport.sent.some((message) => message.method === 'DOM.focus')).toBe(false)
		} finally {
			await client.close()
		}
	})

	it('preserves a connection failure during node resolution', async () => {
		const fixture = await createBrowserElementFixture({
			resolve: () => fixture.transport.errorRemote(new Error('Transport context not found')),
		})
		try {
			await fixture.page.elements.outline()
			await expect(requireValue(fixture.page.elements.element('e1')).focus()).rejects.toMatchObject(
				{
					code: 'BROWSER_CDP_CONNECTION_ERROR',
					context: { method: 'DOM.resolveNode' },
					message: 'CDP connection failed: Error: Transport context not found',
				},
			)
		} finally {
			await fixture.client.close()
		}
	})

	it('preserves the abort reason during node resolution', async () => {
		const controller = new AbortController()
		const reason = new Error('Abort context not found')
		const { page, client } = await createBrowserElementFixture({
			resolve: () => controller.abort(reason),
		})
		try {
			await page.elements.outline()
			await expect(
				requireValue(page.elements.element('e1')).focus({ signal: controller.signal }),
			).rejects.toBe(reason)
		} finally {
			await client.close()
		}
	})

	it('preserves an unrelated protocol refusal during node resolution', async () => {
		const fixture = await createBrowserElementFixture({
			resolve: (message) => fixture.transport.fail(message.id, 'Internal error', -32603),
		})
		try {
			await fixture.page.elements.outline()
			await expect(requireValue(fixture.page.elements.element('e1')).focus()).rejects.toMatchObject(
				{
					code: 'BROWSER_CDP_ERROR',
					context: { method: 'DOM.resolveNode', message: 'Internal error', code: -32603 },
				},
			)
		} finally {
			await fixture.client.close()
		}
	})

	it('preserves a connection failure containing context during an element function call', async () => {
		const fixture = await createBrowserElementFixture({
			select: () => fixture.transport.errorRemote(new Error('Transport context not found')),
		})
		try {
			await fixture.page.elements.outline()
			await expect(
				requireValue(fixture.page.elements.element('e1')).select(['Business']),
			).rejects.toMatchObject({
				code: 'BROWSER_CDP_CONNECTION_ERROR',
				context: { method: 'Runtime.callFunctionOn' },
				message: 'CDP connection failed: Error: Transport context not found',
			})
		} finally {
			await fixture.client.close()
		}
	})

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
							'Page.bringToFront',
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
				'Page.bringToFront',
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
				message: expect.stringContaining('read'),
			})
		} finally {
			await client.close()
		}
	})

	it('catches a collected node whose scroll refusal leaks instead of GONE naming look', async () => {
		const { page, client } = await createBrowserElementFixture({
			failure: {
				method: 'DOM.scrollIntoViewIfNeeded',
				message: 'No node found for given backend id',
			},
		})
		try {
			await page.elements.outline()
			const rejection = await requireValue(page.elements.element('e1'))
				.click()
				.catch((error: unknown) => error)
			expect(rejection).toSatisfy(isBrowserElementError)
			expect(rejection).toMatchObject({
				code: 'BROWSER_ELEMENT_ERROR',
				context: { reference: 'e1', reason: 'GONE' },
				message: 'Element e1 is gone because the page changed; call read for fresh refs.',
			})
		} finally {
			await client.close()
		}
	})

	it.each(['Internal error', 'No node found at given location'])(
		'catches classifying the unrelated protocol error %s as an element refusal',
		async (message) => {
			const { page, client } = await createBrowserElementFixture({
				failure: { method: 'DOM.scrollIntoViewIfNeeded', message },
			})
			try {
				await page.elements.outline()
				const rejection = await requireValue(page.elements.element('e1'))
					.click()
					.catch((error: unknown) => error)
				expect(rejection).toSatisfy(isCDPError)
				expect(rejection).not.toSatisfy(isBrowserElementError)
				expect(rejection).toMatchObject({
					message,
					context: { method: 'DOM.scrollIntoViewIfNeeded', message },
				})
			} finally {
				await client.close()
			}
		},
	)

	it('catches a collected frame owner whose box model refusal leaks instead of GONE naming look', async () => {
		const { page, client } = await createBrowserElementFixture({
			failure: { method: 'DOM.getBoxModel', message: 'No node found for given backend id' },
		})
		try {
			await page.elements.outline()
			const child = requireValue(page.elements.element('e6'))
			expect(child.name).toBe('Save')
			const rejection = await child.click().catch((error: unknown) => error)
			expect(rejection).toSatisfy(isBrowserElementError)
			expect(rejection).toMatchObject({
				code: 'BROWSER_ELEMENT_ERROR',
				context: { reference: 'e6', reason: 'GONE' },
				message: 'Element e6 is gone because the page changed; call read for fresh refs.',
			})
		} finally {
			await client.close()
		}
	})

	it('catches classifying an unrelated frame owner box model refusal as an element refusal', async () => {
		const { page, client } = await createBrowserElementFixture({
			failure: { method: 'DOM.getBoxModel', message: 'Internal error' },
		})
		try {
			await page.elements.outline()
			const rejection = await requireValue(page.elements.element('e6'))
				.click()
				.catch((error: unknown) => error)
			expect(rejection).toSatisfy(isCDPError)
			expect(rejection).not.toSatisfy(isBrowserElementError)
			expect(rejection).toMatchObject({
				message: 'Internal error',
				context: { method: 'DOM.getBoxModel', message: 'Internal error' },
			})
		} finally {
			await client.close()
		}
	})

	it('catches a multiline compiled refusal at the actionability or selection call that keeps its stack or loses its reason', async () => {
		const stack =
			'\n    at HTMLInputElement.<anonymous> (<anonymous>:12:3)\n    at <anonymous>:30:4'
		const outcomes: unknown[] = []
		for (const [description, answer] of [
			[`Error: Element is disabled${stack}`, 'actionability'],
			[`Error: Element is not editable${stack}`, 'actionability'],
			[`Error: Element is not visible${stack}`, 'actionability'],
			[`Error: Element is not editable${stack}`, 'text'],
		] as const) {
			const fixture = await createBrowserElementFixture(
				answer === 'actionability'
					? { actionability: description }
					: {
							text: (message) =>
								fixture.transport.reply(message.id, {
									exceptionDetails: { exception: { description } },
								}),
						},
			)
			try {
				await fixture.page.elements.outline()
				const refused = await requireValue(fixture.page.elements.element('e2'))
					.fill('ada@example.test')
					.catch((caught: unknown) => caught)
				outcomes.push(
					isBrowserElementError(refused) && {
						message: refused.message,
						reason: refused.context?.['reason'],
					},
				)
			} finally {
				await fixture.client.close()
			}
		}
		expect(outcomes).toEqual([
			{ message: 'Element e2 is disabled.', reason: 'DISABLED' },
			{ message: 'Element e2 is not editable.', reason: 'UNKNOWN' },
			{ message: 'Element e2 is not visible.', reason: 'HIDDEN' },
			{ message: 'Element e2 is not editable.', reason: 'UNKNOWN' },
		])
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

	it('catches a fill on a control that takes no text that leaks the in-page stack or inserts the text', async () => {
		const fixture = await createBrowserElementFixture({
			text: (message) =>
				fixture.transport.reply(message.id, {
					exceptionDetails: {
						exception: {
							description:
								'Error: Element is not a text control\n    at HTMLButtonElement.<anonymous> (<anonymous>:6:47)\n    at <anonymous>:9:4',
						},
					},
				}),
		})
		const { page, client, transport } = fixture
		try {
			await page.elements.outline()
			const refused = await requireValue(page.elements.element('e1'))
				.fill('Search')
				.catch((caught: unknown) => caught)
			expect(isBrowserElementError(refused)).toBe(true)
			expect(refused).toMatchObject({
				message: 'Element e1 is not a text control.',
				context: { reference: 'e1', reason: 'UNKNOWN' },
			})
			expect(transport.sent.some((message) => message.method === 'Input.insertText')).toBe(false)
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
			message: expect.stringContaining('is gone because the page changed; call read'),
		})
	})
})
