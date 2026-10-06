import { describe, expect, it } from 'vitest'
import {
	BROWSER_SUBMIT_KEY,
	compileSubmitObserverExpression,
	compileSubmitReadExpression,
	compileSubmitWaitExpression,
	compileSubmitReleaseExpression,
} from '@src/core'
import { BROWSER_SUBMIT_CASES, BROWSER_SUBMIT_FOCUS_CASES } from '../../setup.js'
import { evaluateProbeDocument, loadProbeDocument } from '../../setupBrowser.js'

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
