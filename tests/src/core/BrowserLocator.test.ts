import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError, isBrowserSelectorError } from '@src/core'
import { waitForCondition } from '@orkestrel/test'
import {
	createConnectedCDPClient,
	createRecordingWriter,
	PNG_BASE64,
	replyOk,
	scriptEvaluate,
	scriptTrustedSelector,
} from '../../setup.js'

describe('BrowserLocator', () => {
	it('creates semantic, chained, filtered, and indexed queries without protocol traffic', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const locator = page.selectors
			.role('button', { name: 'Save', exact: true })
			.locator('span')
			.filter({ text: 'Ready', visible: true })
			.last()

		expect(locator.query).toEqual({
			selector: 'css',
			value: 'span',
			parent: {
				selector: 'role',
				value: 'button',
				name: 'Save',
				exact: true,
			},
			filter: { text: 'Ready', visible: true },
			index: -1,
		})
		expect(transport.sent).toEqual([])
	})

	it('uses actionability, content quads, and trusted mouse events for click', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#save')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#save').click()

		expect(transport.sent.some((message) => message.method === 'Runtime.callFunctionOn')).toBe(true)
		expect(transport.sent.some((message) => message.method === 'DOM.getContentQuads')).toBe(true)
		const events = transport.sent.filter((message) => message.method === 'Input.dispatchMouseEvent')
		expect(events.map((message) => message.params?.['type'])).toEqual([
			'mouseMoved',
			'mousePressed',
			'mouseReleased',
		])
		expect(events[0]?.params).toMatchObject({ x: 50, y: 20 })
	})

	it('supports force and trial without synthesizing a click', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#save')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#save').click({ force: true, trial: true })

		expect(transport.sent.some((message) => message.method === 'Runtime.callFunctionOn')).toBe(
			false,
		)
		expect(transport.sent.some((message) => message.method === 'Input.dispatchMouseEvent')).toBe(
			false,
		)
	})

	it('fills through Input.insertText after focusing the remote element', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#name')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#name').fill('Ada')

		const insert = transport.sent.find((message) => message.method === 'Input.insertText')
		expect(insert?.params).toEqual({ text: 'Ada' })
		expect(
			transport.sent.some(
				(message) =>
					message.method === 'Runtime.callFunctionOn' &&
					typeof message.params?.['functionDeclaration'] === 'string' &&
					message.params['functionDeclaration'].includes('this.focus()'),
			),
		).toBe(true)
	})

	it('drags between two strict locators through interpolated mouse events', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#source')
		scriptTrustedSelector(transport, '#target')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#source').drag(page.selectors.css('#target'), { steps: 3 })

		const events = transport.sent.filter((message) => message.method === 'Input.dispatchMouseEvent')
		expect(events.filter((message) => message.params?.['type'] === 'mouseMoved')).toHaveLength(4)
		expect(events.filter((message) => message.params?.['type'] === 'mousePressed')).toHaveLength(1)
		expect(events.filter((message) => message.params?.['type'] === 'mouseReleased')).toHaveLength(1)
		expect(events[0]?.params?.['buttons']).toBe(0)
		expect(events[1]?.params?.['buttons']).toBe(1)
		expect(events.at(-1)?.params?.['buttons']).toBe(0)
	})

	it('checks and dispatches a caller-supplied position relative to the element', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#positioned')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#positioned').click({ position: { x: 10, y: 5 } })

		const actionability = transport.sent.find(
			(message) =>
				message.method === 'Runtime.callFunctionOn' &&
				typeof message.params?.['functionDeclaration'] === 'string' &&
				message.params['functionDeclaration'].includes('elementFromPoint'),
		)
		expect(actionability?.params?.['functionDeclaration']).toContain('{"x":10,"y":5}')
		const moved = transport.sent.find(
			(message) =>
				message.method === 'Input.dispatchMouseEvent' && message.params?.['type'] === 'mouseMoved',
		)
		expect(moved?.params).toMatchObject({ x: 10, y: 5 })
	})

	it('sets file input paths through DOM.setFileInputFiles', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptTrustedSelector(transport, '#upload')
		replyOk(transport, 'DOM.setFileInputFiles')
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await page.selectors.css('#upload').upload({ files: ['C:\\tmp\\one.txt'] })

		const sent = transport.sent.find((message) => message.method === 'DOM.setFileInputFiles')
		expect(sent?.params).toEqual({
			objectId: 'object-1',
			files: ['C:\\tmp\\one.txt'],
		})
	})

	it('returns locator counts and a stable locator for every index', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(
			transport,
			(expression) => expression.includes(').length') && expression.includes('"value":".row"'),
			3,
		)
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const locator = page.selectors.css('.row')

		expect(await locator.count()).toBe(3)
		expect((await locator.all()).map((entry) => entry.query.index)).toEqual([0, 1, 2])
	})

	it('maps strict in-page failures to BrowserSelectorError with query context', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Runtime.evaluate', (message) => {
			transport.reply(message.id, {
				exceptionDetails: {
					exception: { description: 'Error: Strict locator matched 2 elements' },
				},
			})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')

		const thrown: unknown = await page.selectors
			.css('.duplicate')
			.wait()
			.catch((error: unknown) => error)

		expect(isBrowserSelectorError(thrown)).toBe(true)
	})

	it('persists element screenshots through the page writer and cleans up handles', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const writer = createRecordingWriter()
		scriptTrustedSelector(transport, '#card')
		replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
		const page = new BrowserPage(client, 'target-1', 'session-1', writer)

		const result = await page.selectors.css('#card').screenshot({ path: 'card.png' })

		expect(result.path).toBe('card.png')
		expect(writer.calls).toHaveLength(1)
		expect(Array.from(writer.calls[0]?.data ?? [])).toEqual([137, 80, 78, 71, 13])
		await waitForCondition('the resolved object was released', () =>
			transport.sent.some((message) => message.method === 'Runtime.releaseObject'),
		)
	})

	it('reads one element through text() and every match through texts()', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(transport, (expression) => expression.includes('?.innerText'), 'Save')
		scriptEvaluate(transport, (expression) => expression.includes('=> element.innerText'), [
			'Save',
			'Cancel',
		])
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.selectors.css('button').text()).resolves.toBe('Save')
		await expect(page.selectors.css('button').texts()).resolves.toEqual(['Save', 'Cancel'])
	})

	it('refuses a malformed text list rather than returning a partial one', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptEvaluate(transport, (expression) => expression.includes('=> element.innerText'), [
			'Save',
			7,
		])
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.selectors.css('button').texts()).rejects.toSatisfy(isBrowserError)
	})

	it('rejects invalid indexes and input option boundaries before trusted dispatch', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		expect(() => page.selectors.css('button').item(1.5)).toThrow('must be an integer')
		await expect(page.mouse.click({ x: 0, y: 0 }, { count: 0 })).rejects.toSatisfy(isBrowserError)
		await expect(page.keyboard.press('A', { delay: Number.NaN })).rejects.toSatisfy(isBrowserError)
		expect(transport.sent).toEqual([])
	})

	it('cancels an active touch when Chromium rejects the touch end event', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Input.dispatchTouchEvent', (message) => {
			if (message.params?.['type'] === 'touchEnd') {
				transport.fail(message.id, 'touch end failed')
			} else {
				transport.reply(message.id, {})
			}
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.touch.tap({ x: 10, y: 20 })).rejects.toThrow('touch end failed')

		expect(
			transport.sent
				.filter((message) => message.method === 'Input.dispatchTouchEvent')
				.map((message) => message.params?.['type']),
		).toEqual(['touchStart', 'touchEnd', 'touchCancel'])
	})
})
