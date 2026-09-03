/**
 * src/core/BrowserTouch.ts tests.
 *
 * Drives a real `BrowserTouch` over a real `BrowserPage` on the in-memory CDP transport
 * and asserts on the `Input.dispatchTouchEvent` frames the transport recorded.
 */

import { describe, expect, it } from 'vitest'
import { BrowserPage, BrowserTouch, isBrowserError } from '@src/core'
import {
	createAttachedPage,
	createConnectedCDPClient,
	readCDPParams,
	replyOk,
} from '../../setup.js'

describe('BrowserTouch', () => {
	it('taps as a touch start at the point followed by an empty touch end', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchTouchEvent')
		const touch = new BrowserTouch(page)

		await touch.tap({ x: 120, y: 240 })

		expect(readCDPParams(transport, 'Input.dispatchTouchEvent')).toStrictEqual([
			{ type: 'touchStart', touchPoints: [{ x: 120, y: 240 }] },
			{ type: 'touchEnd', touchPoints: [] },
		])
	})

	it('taps at the origin, the boundary value a truthiness check would drop', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchTouchEvent')
		const touch = new BrowserTouch(page)

		await touch.tap({ x: 0, y: 0 })

		expect(readCDPParams(transport, 'Input.dispatchTouchEvent')[0]).toStrictEqual({
			type: 'touchStart',
			touchPoints: [{ x: 0, y: 0 }],
		})
	})

	it('refuses a non-finite coordinate before dispatching anything', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchTouchEvent')
		const touch = new BrowserTouch(page)

		await expect(touch.tap({ x: Number.NaN, y: 1 })).rejects.toSatisfy(isBrowserError)
		await expect(touch.tap({ x: 1, y: Number.POSITIVE_INFINITY })).rejects.toSatisfy(isBrowserError)

		expect(readCDPParams(transport, 'Input.dispatchTouchEvent')).toStrictEqual([])
	})

	it('cancels the started touch and rethrows when the touch end fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Input.dispatchTouchEvent', (message) => {
			if (message.params?.['type'] === 'touchEnd') transport.fail(message.id, 'end failed')
			else transport.reply(message.id, {})
		})
		const touch = new BrowserTouch(new BrowserPage(client, 'target-1', 'session-1'))

		await expect(touch.tap({ x: 5, y: 6 })).rejects.toThrow('end failed')

		expect(
			readCDPParams(transport, 'Input.dispatchTouchEvent').map((params) => params['type']),
		).toStrictEqual(['touchStart', 'touchEnd', 'touchCancel'])
	})
})
