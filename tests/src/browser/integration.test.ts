/**
 * Integration proofs within the browser environment: core expressions the page placement sends
 * into a document, run in a real Chromium document through the browser project.
 *
 * The submit observer of `compileSubmitObserverExpression` is installed in this document's own
 * window, the way `Runtime.evaluate` installs it in an isolated world that shares the DOM, and its
 * read runs through `compileSubmitReadExpression`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { compileSubmitObserverExpression, compileSubmitReadExpression } from '@src/core'
import { evaluateJavaScript } from '../../setup.js'

describe('the submit observer in a real document', () => {
	afterEach(() => {
		evaluateJavaScript(compileSubmitReadExpression(41))
		document.body.replaceChildren()
	})

	it("records the Enter an input a form owns received, before the input's handler stops the event and moves the focus", () => {
		document.body.innerHTML =
			'<form action="#sent"><input id="code" name="code"><textarea id="notes"></textarea></form>'
		const input = document.getElementById('code')
		const notes = document.getElementById('notes')
		if (!(input instanceof HTMLInputElement) || !(notes instanceof HTMLTextAreaElement))
			throw new Error('precondition: the form holds the input and the textarea')
		input.addEventListener('keydown', (event) => {
			event.stopPropagation()
			event.preventDefault()
			notes.focus()
		})
		input.focus()
		expect(evaluateJavaScript(compileSubmitObserverExpression(41))).toBe(true)
		input.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		)
		expect(document.activeElement).toBe(notes)
		expect(evaluateJavaScript(compileSubmitReadExpression(41))).toEqual({
			destinations: [],
			prevented: false,
			submitted: false,
			implicit: true,
		})
	})
})
