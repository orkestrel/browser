/**
 * src/core/BrowserMouse.ts tests.
 *
 * Every case drives a real `BrowserMouse` over a real `BrowserPage` attached to the
 * in-memory CDP transport, and asserts on the `Input.dispatchMouseEvent` frames the
 * transport recorded — the protocol the class exists to produce.
 */

import { describe, expect, it } from 'vitest'
import { BrowserMouse, BrowserPage, isBrowserError } from '@src/core'
import {
	createAttachedPage,
	createConnectedCDPClient,
	readCDPParams,
	replyOk,
} from '../../setup.js'

describe('BrowserMouse', () => {
	it('moves to a point with no button held', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await mouse.move({ x: 50, y: 20 })

		expect(readCDPParams(transport, 'Input.dispatchMouseEvent')).toStrictEqual([
			{ type: 'mouseMoved', x: 50, y: 20, button: 'none', buttons: 0 },
		])
	})

	it('accumulates the pressed-button mask across down and clears it on up', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await mouse.down('left')
		await mouse.down('right')
		await mouse.move({ x: 1, y: 2 })
		await mouse.up('right')
		await mouse.up('left')

		expect(
			readCDPParams(transport, 'Input.dispatchMouseEvent').map((params) => [
				params['type'],
				params['buttons'],
			]),
		).toStrictEqual([
			['mousePressed', 1],
			['mousePressed', 3],
			['mouseMoved', 3],
			['mouseReleased', 1],
			['mouseReleased', 0],
		])
	})

	it('clicks as a move, a press, and a release carrying the button and count', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await mouse.click({ x: 10, y: 12 }, { button: 'middle', count: 2 })

		expect(readCDPParams(transport, 'Input.dispatchMouseEvent')).toStrictEqual([
			{ type: 'mouseMoved', x: 10, y: 12, button: 'none', buttons: 0 },
			{ type: 'mousePressed', x: 10, y: 12, button: 'middle', buttons: 4, clickCount: 2 },
			{ type: 'mouseReleased', x: 10, y: 12, button: 'middle', buttons: 0, clickCount: 2 },
		])
	})

	it('drags in the requested number of steps, landing exactly on the end point', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await mouse.drag({ x: 0, y: 0 }, { x: 100, y: 50 }, { steps: 4 })

		const frames = readCDPParams(transport, 'Input.dispatchMouseEvent')
		expect(
			frames
				.filter((params) => params['type'] === 'mouseMoved')
				.map((params) => [params['x'], params['y']]),
		).toStrictEqual([
			[0, 0],
			[25, 12.5],
			[50, 25],
			[75, 37.5],
			[100, 50],
		])
		expect(frames.at(-1)?.['type']).toBe('mouseReleased')
	})

	it('sends wheel deltas at the last moved point', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await mouse.move({ x: 7, y: 9 })
		await mouse.wheel({ x: 0, y: -120 })

		expect(readCDPParams(transport, 'Input.dispatchMouseEvent').at(-1)).toStrictEqual({
			type: 'mouseWheel',
			x: 7,
			y: 9,
			deltaX: 0,
			deltaY: -120,
			buttons: 0,
		})
	})

	it('refuses a non-finite coordinate and a non-positive count or step before dispatching', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchMouseEvent')
		const mouse = new BrowserMouse(page)

		await expect(mouse.move({ x: Number.NaN, y: 0 })).rejects.toSatisfy(isBrowserError)
		await expect(mouse.wheel({ x: 0, y: Number.POSITIVE_INFINITY })).rejects.toSatisfy(
			isBrowserError,
		)
		await expect(mouse.click({ x: 0, y: 0 }, { count: 0 })).rejects.toSatisfy(isBrowserError)
		await expect(mouse.drag({ x: 0, y: 0 }, { x: 1, y: 1 }, { steps: 0 })).rejects.toSatisfy(
			isBrowserError,
		)

		expect(readCDPParams(transport, 'Input.dispatchMouseEvent')).toStrictEqual([])
	})

	it('drops a button from the mask even when its release frame fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Input.dispatchMouseEvent', (message) => {
			if (message.params?.['type'] === 'mouseReleased') transport.fail(message.id, 'release failed')
			else transport.reply(message.id, {})
		})
		const mouse = new BrowserMouse(new BrowserPage(client, 'target-1', 'session-1'))

		await mouse.down('left')
		await expect(mouse.up('left')).rejects.toThrow('release failed')
		await mouse.move({ x: 3, y: 4 })

		expect(readCDPParams(transport, 'Input.dispatchMouseEvent').at(-1)?.['buttons']).toBe(0)
	})
})
