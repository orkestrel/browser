import { evaluateProbeDocument, loadProbeDocument } from '../../setupBrowser.js'
import { BROWSER_SUBMIT_CASES, BROWSER_SUBMIT_FOCUS_CASES } from '../../setup.js'
import {
	BROWSER_SUBMIT_KEY,
	compileSubmitWaitExpression,
	compileSubmitReleaseExpression,
} from '@src/core'
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

describe('submission compilers in real Chromium documents', () => {
	it.each(BROWSER_SUBMIT_CASES)(
		'reads %s without releasing the observer',
		async (_name, submits, destinations, prevented) => {
			const document = await loadProbeDocument('<form><input><button>Submit</button></form>')
			evaluateProbeDocument(document, compileSubmitObserverExpression(7))
			for (const submit of submits)
				evaluateProbeDocument(
					document,
					`(() => {
			const data = ${JSON.stringify(submit)}
			const form = document.createElement('form')
			for (const [name, value] of Object.entries(data.form)) form.setAttribute(name, value)
			const button = document.createElement('button')
			for (const [name, value] of Object.entries(data.submitter ?? {})) button.setAttribute(name, value)
			form.append(button); document.body.append(form)
			if (data.base !== undefined) { const base = document.createElement('base'); base.target = data.base; document.head.append(base) }
			form.addEventListener('submit', event => { if(data.prevented) event.preventDefault() })
			form.dispatchEvent(new SubmitEvent('submit', { bubbles:true, cancelable:true, submitter:data.submitter === undefined ? null : button }))
		})()`,
				)
			expect(evaluateProbeDocument(document, compileSubmitReadExpression(7))).toEqual({
				destinations,
				prevented,
				submitted: true,
				implicit: false,
			})
			expect(evaluateProbeDocument(document, compileSubmitReadExpression(7))).toEqual({
				destinations,
				prevented,
				submitted: true,
				implicit: false,
			})
			expect(evaluateProbeDocument(document, compileSubmitReleaseExpression(7))).toBe(true)
			expect(evaluateProbeDocument(document, compileSubmitReadExpression(7))).toBeNull()
		},
	)

	it.each(BROWSER_SUBMIT_FOCUS_CASES)(
		'recognizes %s at capture time',
		async (_name, focus, key, implicit) => {
			const document = await loadProbeDocument(
				'<form><input><textarea></textarea><button>Submit</button></form>',
			)
			evaluateProbeDocument(document, compileSubmitObserverExpression(3))
			evaluateProbeDocument(
				document,
				`(() => {
			const data = ${JSON.stringify(focus ?? null)}
			if(data === null) return
			const element = document.createElement(data.name)
			if(data.form !== undefined) document.querySelector('form').append(element); else document.body.append(element)
			element.focus()
			element.addEventListener('keydown', () => { if(data.moves !== undefined) document.querySelector(data.moves.name).focus() })
			element.dispatchEvent(new KeyboardEvent('keydown', { key:${JSON.stringify(key)}, bubbles:true }))
		})()`,
			)
			expect(evaluateProbeDocument(document, compileSubmitReadExpression(3))).toMatchObject({
				implicit,
			})
			evaluateProbeDocument(document, compileSubmitReleaseExpression(3))
		},
	)

	it('keeps replacement ownership, ignores earlier input, and releases a pending wait', async () => {
		const document = await loadProbeDocument('<form><input><button>Submit</button></form>')
		expect(evaluateProbeDocument(document, compileSubmitReadExpression(1))).toBeNull()
		evaluateProbeDocument(document, compileSubmitObserverExpression(1))
		evaluateProbeDocument(document, compileSubmitObserverExpression(2))
		expect(evaluateProbeDocument(document, compileSubmitReleaseExpression(1))).toBe(false)
		expect(evaluateProbeDocument(document, compileSubmitReadExpression(1))).toBeNull()
		evaluateProbeDocument(
			document,
			`document.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles:true, cancelable:true }))`,
		)
		const pending = evaluateProbeDocument(document, compileSubmitWaitExpression(2, 1000))
		evaluateProbeDocument(document, compileSubmitReleaseExpression(2))
		await expect(pending).resolves.toBe(false)
		expect(
			evaluateProbeDocument(document, `globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}]`),
		).toBeUndefined()
	})
})
