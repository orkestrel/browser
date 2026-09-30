import { describe, expect, it } from 'vitest'
import { isBrowserElementError, isBrowserError } from '@src/core'
import { createBrowserDOMView } from '@src/browser'
import { createRecorder, requireValue } from '@orkestrel/test'
import {
	createProbeElements,
	findProbeElement,
	loadProbeDocument,
	readNativeValue,
} from '../../../setupBrowser.js'

describe('BrowserDOMElement', () => {
	describe('click', () => {
		it('toggles a checkbox with an untrusted click event', async () => {
			const probe = await loadProbeDocument('<label><input type="checkbox"> Gift wrap</label>')
			const box = requireValue(probe.querySelector('input'), 'checkbox')
			const trusted = createRecorder<[boolean]>()
			box.addEventListener('click', (event) => trusted.handler(event.isTrusted))
			const view = createBrowserDOMView({ document: probe })
			const element = await findProbeElement(view, 'input')
			await element.click()
			expect(box.checked).toBe(true)
			expect(trusted.calls).toEqual([[false]])
			expect(view.trusted).toBe(false)
		})

		it('refuses a disabled button, a target="_blank" link, and a file chooser', async () => {
			const probe = await loadProbeDocument(
				[
					'<button disabled>Place order</button>',
					'<a href="/cars" target="_blank">Cars</a>',
					'<input type="file" aria-label="Photo">',
				].join(''),
			)
			const clicks = createRecorder<[string]>()
			probe.addEventListener('click', (event) => clicks.handler(event.type))
			const view = createBrowserDOMView({ document: probe })
			const button = await findProbeElement(view, 'button')
			const link = await findProbeElement(view, 'a')
			const file = await findProbeElement(view, 'input')
			const disabled = await button.click().catch((error: unknown) => error)
			const popup = await link.click().catch((error: unknown) => error)
			const chooser = await file.click().catch((error: unknown) => error)
			expect(isBrowserElementError(disabled) && disabled.context).toMatchObject({
				reason: 'DISABLED',
			})
			expect(isBrowserElementError(popup) && popup.message).toMatch(
				/opens another browsing context, which an untrusted click cannot do/,
			)
			expect(isBrowserElementError(chooser) && chooser.message).toMatch(/opens a file chooser/)
			expect(clicks.calls).toEqual([])
		})

		it('clicks a link whose target names a frame in the page', async () => {
			const probe = await loadProbeDocument(
				'<a href="#next" target="panel">Next</a><iframe name="panel"></iframe>',
			)
			const clicks = createRecorder<[boolean]>()
			probe.addEventListener('click', (event) => {
				event.preventDefault()
				clicks.handler(event.isTrusted)
			})
			const view = createBrowserDOMView({ document: probe })
			await (await findProbeElement(view, 'a')).click()
			expect(clicks.calls).toEqual([[false]])
		})

		it('refuses a hidden element', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const save = await findProbeElement(view, 'button')
			probe.save.style.display = 'none'
			const refusal = await save.click().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({ reason: 'HIDDEN' })
		})

		it('reports GONE for an element removed from its document', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const save = await findProbeElement(view, 'button')
			probe.save.remove()
			const refusal = await save.click().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({
				reference: save.reference,
				reason: 'GONE',
			})
		})
	})

	describe('fill', () => {
		it('sets the value through the prototype setter and dispatches input then change', async () => {
			const probe = await createProbeElements()
			const own = createRecorder<[unknown]>()
			const events = createRecorder<[string, unknown, boolean]>()
			// A framework's value tracker defines an own accessor over the prototype's.
			Object.defineProperty(probe.email, 'value', {
				configurable: true,
				get: () => '',
				set: own.handler,
			})
			for (const type of ['input', 'change']) {
				probe.email.addEventListener(type, (event) => {
					events.handler(event.type, readNativeValue(probe.email), event.isTrusted)
				})
			}
			const view = createBrowserDOMView({ document: probe.document })
			await (await findProbeElement(view, 'input')).fill('sam@example.test')
			expect(own.calls).toEqual([])
			expect(events.calls).toEqual([
				['input', 'sam@example.test', false],
				['change', 'sam@example.test', false],
			])
		})

		it('refuses typing into a contenteditable element and a non-text control', async () => {
			const probe = await loadProbeDocument(
				'<div contenteditable role="textbox" aria-label="Notes"></div><input type="checkbox">',
			)
			const view = createBrowserDOMView({ document: probe })
			const editable = await findProbeElement(view, 'div')
			const checkbox = await findProbeElement(view, 'input')
			const notes = await editable.fill('Hello').catch((error: unknown) => error)
			const box = await checkbox.fill('on').catch((error: unknown) => error)
			expect(isBrowserElementError(notes) && notes.message).toMatch(
				/is contenteditable, which an untrusted event cannot type into/,
			)
			expect(probe.querySelector('div')?.textContent).toBe('')
			expect(isBrowserElementError(box) && box.message).toMatch(/is not editable/)
		})
	})

	describe('select', () => {
		it('selects by value or label and refuses a missing option and a non-select', async () => {
			const probe = await loadProbeDocument(
				'<select aria-label="Size"><option value="s">Small</option><option value="l">Large</option></select><input>',
			)
			const select = requireValue(probe.querySelector('select'), 'select')
			const changes = createRecorder<[string]>()
			select.addEventListener('change', () => changes.handler(select.value))
			const view = createBrowserDOMView({ document: probe })
			const size = await findProbeElement(view, 'select')
			await size.select(['Large'])
			await size.select(['s'])
			expect(changes.calls).toEqual([['l'], ['s']])
			const missing = await size.select(['Huge']).catch((error: unknown) => error)
			const field = await findProbeElement(view, 'input')
			const text = await field.select(['x']).catch((error: unknown) => error)
			expect(isBrowserElementError(missing) && missing.message).toMatch(/has no option "Huge"/)
			expect(isBrowserError(text) && text.message).toMatch(/not a select control/)
		})
	})

	describe('submit', () => {
		it('fires one submit event for a valid form', async () => {
			const probe = await loadProbeDocument(
				'<form><input name="email" aria-label="Email" required value="sam@example.test"></form>',
			)
			const form = requireValue(probe.querySelector('form'), 'form')
			const submits = createRecorder<[]>()
			form.addEventListener('submit', (event) => {
				event.preventDefault()
				submits.handler()
			})
			const view = createBrowserDOMView({ document: probe })
			await (await findProbeElement(view, 'input')).submit()
			expect(submits.count).toBe(1)
		})

		it('fires none for an empty required field and reports its validation message', async () => {
			const probe = await loadProbeDocument(
				'<form><input name="email" aria-label="Email" required></form>',
			)
			const form = requireValue(probe.querySelector('form'), 'form')
			const input = requireValue(probe.querySelector('input'), 'input')
			const submits = createRecorder<[]>()
			form.addEventListener('submit', () => submits.handler())
			const view = createBrowserDOMView({ document: probe })
			const email = await findProbeElement(view, 'input')
			const refusal = await email.submit().catch((error: unknown) => error)
			expect(submits.count).toBe(0)
			expect(input.validationMessage).not.toBe('')
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_SUBMIT')
			expect(isBrowserError(refusal) && refusal.message).toBe(
				`did not submit: Email — ${input.validationMessage}`,
			)
			expect(isBrowserError(refusal) && refusal.context).toMatchObject({
				field: 'Email',
				message: input.validationMessage,
			})
		})

		it('refuses an element outside any form and a form that targets a new context', async () => {
			const probe = await loadProbeDocument(
				'<input aria-label="Loose"><form target="_blank"><button>Go</button></form>',
			)
			const view = createBrowserDOMView({ document: probe })
			const field = await findProbeElement(view, 'input')
			const button = await findProbeElement(view, 'button')
			const loose = await field.submit().catch((error: unknown) => error)
			const popup = await button.submit().catch((error: unknown) => error)
			expect(isBrowserElementError(loose) && loose.message).toMatch(/is not in a form/)
			expect(isBrowserElementError(popup) && popup.message).toMatch(/another browsing context/)
		})
	})

	describe('focus and read', () => {
		it('focuses the element and reads its markup with the document address', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const save = await findProbeElement(view, 'button')
			await save.focus()
			expect(probe.document.activeElement).toBe(probe.save)
			const reading = await save.read()
			expect(reading.url).toBe('about:srcdoc')
			expect(reading.title).toBe('Probe')
			expect(reading.text({ distill: false }).text).toContain('Save')
			expect(save.role).toBe('button')
		})
	})
})
