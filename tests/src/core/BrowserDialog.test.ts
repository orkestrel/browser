/**
 * src/core/BrowserDialog.ts tests.
 *
 * `BrowserDialog` is interned rather than barrelled, so it is imported by path the way
 * `BrowserHandle.test.ts` imports its subject. Each case drives the real class over a
 * real `BrowserPage` on the in-memory CDP transport.
 */

import { describe, expect, it } from 'vitest'
import { BrowserDialog } from '../../../src/core/BrowserDialog.js'
import { createAttachedPage, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserDialog', () => {
	it('reports the category, message, and default it was constructed with', async () => {
		const { page } = await createAttachedPage()
		const dialog = new BrowserDialog(page, 'prompt', 'Your name?', 'Ada')

		expect([dialog.category, dialog.message, dialog.default]).toStrictEqual([
			'prompt',
			'Your name?',
			'Ada',
		])
	})

	it('accepts with the supplied prompt text', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Page.handleJavaScriptDialog')
		const dialog = new BrowserDialog(page, 'prompt', 'Your name?', '')

		await dialog.accept('Grace')

		expect(readCDPParams(transport, 'Page.handleJavaScriptDialog')).toStrictEqual([
			{ accept: true, promptText: 'Grace' },
		])
	})

	it('accepts with no prompt text and dismisses without one', async () => {
		const accepted = await createAttachedPage()
		replyOk(accepted.transport, 'Page.handleJavaScriptDialog')
		await new BrowserDialog(accepted.page, 'alert', 'Saved', '').accept()

		const dismissed = await createAttachedPage()
		replyOk(dismissed.transport, 'Page.handleJavaScriptDialog')
		await new BrowserDialog(dismissed.page, 'confirm', 'Sure?', '').dismiss()

		expect(readCDPParams(accepted.transport, 'Page.handleJavaScriptDialog')).toStrictEqual([
			{ accept: true },
		])
		expect(readCDPParams(dismissed.transport, 'Page.handleJavaScriptDialog')).toStrictEqual([
			{ accept: false },
		])
	})

	it('refuses a second decision after an accept or a dismiss', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Page.handleJavaScriptDialog')
		const accepted = new BrowserDialog(page, 'confirm', 'Sure?', '')
		const dismissed = new BrowserDialog(page, 'confirm', 'Sure?', '')

		await accepted.accept()
		await dismissed.dismiss()

		await expect(accepted.dismiss()).rejects.toThrow('Browser dialog is already handled')
		await expect(dismissed.accept()).rejects.toThrow('Browser dialog is already handled')
	})

	it('stays unhandled when its decision frame fails, so it can be decided again', async () => {
		const { page, transport } = await createAttachedPage()
		let attempts = 0
		transport.onSend('Page.handleJavaScriptDialog', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'dialog gone')
			else transport.reply(message.id, {})
		})
		const dialog = new BrowserDialog(page, 'alert', 'Saved', '')

		await expect(dialog.accept()).rejects.toThrow('dialog gone')
		await expect(dialog.dismiss()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})
})
