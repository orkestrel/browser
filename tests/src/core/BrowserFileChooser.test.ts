/**
 * src/core/BrowserFileChooser.ts tests.
 *
 * `BrowserFileChooser` is interned rather than barrelled, so it is imported by path. Each
 * case drives the real class over a real `BrowserPage` on the in-memory CDP transport and
 * asserts on the `DOM.setFileInputFiles` frames it produced.
 */

import { describe, expect, it } from 'vitest'
import { BrowserFileChooser } from '../../../src/core/BrowserFileChooser.js'
import { createAttachedPage, readCDPParams, replyOk } from '../../setup.js'

describe('BrowserFileChooser', () => {
	it('reports whether the intercepted input accepts several files', async () => {
		const { page } = await createAttachedPage()

		expect(new BrowserFileChooser(page, 7, true).multiple).toBe(true)
		expect(new BrowserFileChooser(page, 7, false).multiple).toBe(false)
	})

	it('uploads the named files against the intercepted backend node', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'DOM.setFileInputFiles')
		const chooser = new BrowserFileChooser(page, 42, true)

		await chooser.upload(['one.txt', 'two.txt'])

		expect(readCDPParams(transport, 'DOM.setFileInputFiles')).toStrictEqual([
			{ backendNodeId: 42, files: ['one.txt', 'two.txt'] },
		])
	})

	it('cancels by clearing the input selection', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'DOM.setFileInputFiles')
		const chooser = new BrowserFileChooser(page, 42, false)

		await chooser.cancel()

		expect(readCDPParams(transport, 'DOM.setFileInputFiles')).toStrictEqual([
			{ backendNodeId: 42, files: [] },
		])
	})

	it('accepts one file and an empty list on a single-file chooser but refuses several', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'DOM.setFileInputFiles')

		await expect(
			new BrowserFileChooser(page, 1, false).upload(['one.txt']),
		).resolves.toBeUndefined()
		await expect(new BrowserFileChooser(page, 1, false).upload([])).resolves.toBeUndefined()
		await expect(
			new BrowserFileChooser(page, 1, false).upload(['one.txt', 'two.txt']),
		).rejects.toThrow('Single file chooser cannot accept multiple files')

		expect(readCDPParams(transport, 'DOM.setFileInputFiles')).toHaveLength(2)
	})

	it('refuses a second decision after an upload or a cancel', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'DOM.setFileInputFiles')
		const uploaded = new BrowserFileChooser(page, 1, true)
		const cancelled = new BrowserFileChooser(page, 1, true)

		await uploaded.upload(['one.txt'])
		await cancelled.cancel()

		await expect(uploaded.cancel()).rejects.toThrow('Browser file chooser is already handled')
		await expect(cancelled.upload(['one.txt'])).rejects.toThrow(
			'Browser file chooser is already handled',
		)
	})

	it('stays unhandled when its frame fails, so it can be decided again', async () => {
		const { page, transport } = await createAttachedPage()
		let attempts = 0
		transport.onSend('DOM.setFileInputFiles', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'input detached')
			else transport.reply(message.id, {})
		})
		const chooser = new BrowserFileChooser(page, 1, true)

		await expect(chooser.upload(['one.txt'])).rejects.toThrow('input detached')
		await expect(chooser.cancel()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})
})
