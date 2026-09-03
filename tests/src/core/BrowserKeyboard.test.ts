/**
 * src/core/BrowserKeyboard.ts tests.
 *
 * Every case drives a real `BrowserKeyboard` over a real `BrowserPage` attached to the
 * in-memory CDP transport, and asserts on the `Input.dispatchKeyEvent` and
 * `Input.insertText` frames the transport recorded. The chord split and the key
 * normalization the class composes are covered here too, because no other suite drives
 * `extractBrowserChord` or `keyToBrowserInput`.
 */

import { describe, expect, it } from 'vitest'
import {
	BrowserKeyboard,
	BrowserPage,
	extractBrowserChord,
	isBrowserError,
	keyToBrowserInput,
} from '@src/core'
import {
	createAttachedPage,
	createConnectedCDPClient,
	readCDPParams,
	replyOk,
} from '../../setup.js'

describe('extractBrowserChord', () => {
	it('splits modifiers from the terminal key and canonicalizes Ctrl, Cmd, and Command', () => {
		expect(extractBrowserChord('Enter')).toStrictEqual({ modifiers: [], key: 'Enter' })
		expect(extractBrowserChord('Control+Shift+P')).toStrictEqual({
			modifiers: ['Control', 'Shift'],
			key: 'P',
		})
		expect(extractBrowserChord('Ctrl+A')).toStrictEqual({ modifiers: ['Control'], key: 'A' })
		expect(extractBrowserChord('Cmd+K')).toStrictEqual({ modifiers: ['Meta'], key: 'K' })
		expect(extractBrowserChord('Command+K')).toStrictEqual({ modifiers: ['Meta'], key: 'K' })
	})

	it('throws on an empty chord and on an unsupported modifier', () => {
		expect(() => extractBrowserChord('')).toThrow('Browser key chord is empty')
		expect(() => extractBrowserChord('+++')).toThrow('Browser key chord is empty')
		expect(() => extractBrowserChord('Hyper+P')).toThrow('Unsupported browser key modifier: Hyper')
	})
})

describe('keyToBrowserInput', () => {
	it('resolves a named key, a letter, a digit, and a symbol to CDP key data', () => {
		expect(keyToBrowserInput('Enter')).toStrictEqual({
			key: 'Enter',
			code: 'Enter',
			text: '\r',
			number: 13,
		})
		expect(keyToBrowserInput('a')).toStrictEqual({
			key: 'a',
			code: 'KeyA',
			text: 'a',
			number: 65,
		})
		expect(keyToBrowserInput('7')).toStrictEqual({
			key: '7',
			code: 'Digit7',
			text: '7',
			number: 55,
		})
		expect(keyToBrowserInput('-')).toStrictEqual({
			key: '-',
			code: '',
			text: '-',
			number: 45,
		})
	})

	it('throws on a multi-character value that names no key', () => {
		expect(() => keyToBrowserInput('Control+Enter')).toThrow(
			'Unsupported browser key: Control+Enter',
		)
	})
})

describe('BrowserKeyboard', () => {
	it('sends a key down carrying its code, text, and virtual key number', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.down('a')

		expect(readCDPParams(transport, 'Input.dispatchKeyEvent')).toStrictEqual([
			{
				type: 'keyDown',
				key: 'a',
				code: 'KeyA',
				text: 'a',
				unmodifiedText: 'a',
				windowsVirtualKeyCode: 65,
				nativeVirtualKeyCode: 65,
				modifiers: 0,
			},
		])
	})

	it('holds a modifier across later keys and drops it on release', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.down('Control')
		await keyboard.down('a')
		await keyboard.up('a')
		await keyboard.up('Control')
		await keyboard.down('b')

		expect(
			readCDPParams(transport, 'Input.dispatchKeyEvent').map((params) => [
				params['type'],
				params['key'],
				params['modifiers'],
			]),
		).toStrictEqual([
			['keyDown', 'Control', 2],
			['keyDown', 'a', 2],
			['keyUp', 'a', 2],
			['keyUp', 'Control', 2],
			['keyDown', 'b', 0],
		])
	})

	it('suppresses the typed text while a non-shift modifier is held', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.down('Control')
		await keyboard.down('a')
		await keyboard.up('Control')
		await keyboard.down('Shift')
		await keyboard.down('b')

		const downs = readCDPParams(transport, 'Input.dispatchKeyEvent').filter(
			(params) => params['type'] === 'keyDown',
		)
		expect(downs.map((params) => [params['key'], params['text']])).toStrictEqual([
			['Control', undefined],
			['a', undefined],
			['Shift', undefined],
			['b', 'b'],
		])
	})

	it('presses a chord as modifier downs, the key, then modifier ups in reverse order', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.press('Control+Shift+P')

		expect(
			readCDPParams(transport, 'Input.dispatchKeyEvent').map((params) => [
				params['type'],
				params['key'],
			]),
		).toStrictEqual([
			['keyDown', 'Control'],
			['keyDown', 'Shift'],
			['keyDown', 'P'],
			['keyUp', 'P'],
			['keyUp', 'Shift'],
			['keyUp', 'Control'],
		])
	})

	it('types every character of a string as a down and an up pair', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.type('hi')

		expect(
			readCDPParams(transport, 'Input.dispatchKeyEvent').map((params) => [
				params['type'],
				params['key'],
			]),
		).toStrictEqual([
			['keyDown', 'h'],
			['keyUp', 'h'],
			['keyDown', 'i'],
			['keyUp', 'i'],
		])
	})

	it('inserts text as one composed insertion rather than per-key events', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.insertText')
		const keyboard = new BrowserKeyboard(page)

		await keyboard.insert('orkestrel')

		expect(readCDPParams(transport, 'Input.insertText')).toStrictEqual([{ text: 'orkestrel' }])
		expect(readCDPParams(transport, 'Input.dispatchKeyEvent')).toStrictEqual([])
	})

	it('refuses a negative delay before dispatching and refuses an unsupported key', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Input.dispatchKeyEvent')
		const keyboard = new BrowserKeyboard(page)

		await expect(keyboard.press('Enter', { delay: -1 })).rejects.toSatisfy(isBrowserError)
		await expect(keyboard.type('ok', { delay: Number.NaN })).rejects.toSatisfy(isBrowserError)
		await expect(keyboard.down('F13')).rejects.toThrow('Unsupported browser key: F13')

		expect(readCDPParams(transport, 'Input.dispatchKeyEvent')).toStrictEqual([])
	})

	it('releases every held modifier even when the terminal key fails', async () => {
		const { client, transport } = await createConnectedCDPClient()
		transport.onSend('Input.dispatchKeyEvent', (message) => {
			if (message.params?.['key'] === 'P') transport.fail(message.id, 'key failed')
			else transport.reply(message.id, {})
		})
		const keyboard = new BrowserKeyboard(new BrowserPage(client, 'target-1', 'session-1'))

		await expect(keyboard.press('Control+P')).rejects.toThrow('key failed')
		await keyboard.down('b')

		expect(readCDPParams(transport, 'Input.dispatchKeyEvent').at(-1)?.['modifiers']).toBe(0)
	})
})
