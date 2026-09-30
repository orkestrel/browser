import { describe, expect, it } from 'vitest'
import { isBrowserElementError, isBrowserError } from '@src/core'
import { createBrowserDOMView } from '@src/browser'
import { requireValue, waitForDelay, waitForEvent } from '@orkestrel/test'
import {
	createProbeElements,
	loadProbeDocument,
	loadProbeFrame,
	readBrowserFixtureBase,
} from '../../../setupBrowser.js'

describe('BrowserDOMElementManager', () => {
	describe('outline', () => {
		it('names the probe page button, text field, and link, and renders headings and text', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const outline = await view.elements.outline()
			expect(outline.text).toBe(
				[
					'page "Probe" about:srcdoc',
					'e1 link "One"',
					'e2 link "Two"',
					'# Probe page',
					'A paragraph the reader wants.',
					'e3 button "Save"',
					'Email',
					'e4 textbox "Email"',
					'Footer chrome nobody reads',
					'(4 of 4 elements)',
				].join('\n'),
			)
			expect(outline).toMatchObject({ url: 'about:srcdoc', title: 'Probe', count: 4, total: 4 })
		})

		it('omits hidden, aria-hidden, and display: none elements with their subtrees', async () => {
			const probe = await createProbeElements()
			probe.late.innerHTML = [
				'<button hidden>Hidden</button>',
				'<div aria-hidden="true"><button>Muted</button></div>',
				'<div style="display: none"><a href="/gone">Gone</a></div>',
				'<button>Shown</button>',
			].join('')
			const view = createBrowserDOMView({ document: probe.document })
			const { text } = await view.elements.outline()
			expect(text).toContain('button "Shown"')
			expect(text).not.toContain('Hidden')
			expect(text).not.toContain('Muted')
			expect(text).not.toContain('Gone')
		})

		it('inlines a srcdoc frame and marks a cross-origin frame unreadable', async () => {
			const probe = await createProbeElements()
			const inner = probe.document.createElement('iframe')
			const outer = probe.document.createElement('iframe')
			outer.title = 'Fixture'
			const loads = [inner, outer].map((frame) =>
				waitForEvent<[Event]>((listener) => {
					frame.addEventListener('load', listener, { once: true })
					return () => frame.removeEventListener('load', listener)
				}, 'frame load'),
			)
			inner.srcdoc = '<button>Inner</button>'
			outer.src = `${readBrowserFixtureBase()}/`
			probe.late.append(inner, outer)
			await Promise.all(loads)
			const view = createBrowserDOMView({ document: probe.document })
			const { text } = await view.elements.outline()
			expect(text.split('\n').slice(4)).toEqual([
				'A paragraph the reader wants.',
				'e3 button "Save"',
				'Email',
				'e4 textbox "Email"',
				'e5 button "Inner"',
				'iframe "Fixture" (cross-origin, not readable)',
				'Footer chrome nobody reads',
				'(5 of 5 elements)',
			])
		})

		it('marks a declarative tool form after its role and name', async () => {
			const probe = await loadProbeDocument(
				'<form toolname="search-cars" aria-label="Search cars"><input aria-label="Make"></form>',
			)
			const view = createBrowserDOMView({ document: probe })
			const { text } = await view.elements.outline()
			expect(text.split('\n')).toEqual([
				'page "" about:srcdoc',
				'e1 form "Search cars" [tool=search-cars]',
				'e2 textbox "Make"',
				'(2 of 2 elements)',
			])
		})

		it('renders values, checked and disabled states, and never a password value', async () => {
			const probe = await loadProbeDocument(
				[
					'<input aria-label="Email" value="sam@example.test">',
					'<input type="password" aria-label="Secret" value="hunter2">',
					'<label><input type="checkbox" checked> Gift wrap</label>',
					'<button disabled>Place order</button>',
					'<select aria-label="Size"><option>Small</option><option selected>Large</option></select>',
				].join(''),
			)
			const view = createBrowserDOMView({ document: probe })
			const rows = (await view.elements.outline()).text.split('\n')
			expect(rows).toContain('e1 textbox "Email" value="sam@example.test"')
			expect(rows).toContain('e2 textbox "Secret"')
			expect(rows).toContain('e3 checkbox "Gift wrap" [checked]')
			expect(rows).toContain('e4 button "Place order" [disabled]')
			expect(rows).toContain('e5 combobox "Size" value="Large"')
			expect(rows.join('\n')).not.toContain('hunter2')
			expect(rows.join('\n')).not.toContain('Small')
		})

		it('separates text in different blocks and joins text within one', async () => {
			const probe = await loadProbeDocument(
				'<p>Two items, <b>48.00</b> total.</p><div><p>First</p>Second</div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const rows = (await view.elements.outline()).text.split('\n')
			expect(rows.slice(1, -1)).toEqual(['Two items, 48.00 total.', 'First', 'Second'])
		})

		it('bounds the referenced rows by limit and scopes them by within', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const bounded = await view.elements.outline({ limit: 1 })
			expect(bounded).toMatchObject({ count: 1, total: 4 })
			expect(bounded.text).not.toContain('e2 link')
			const nav = probe.document.querySelector('nav')
			nav?.setAttribute('role', 'button')
			const scoped = await view.elements.outline()
			const reference = scoped.text.split('\n').find((row) => row.endsWith('button "Site"'))
			nav?.removeAttribute('role')
			const within = reference?.split(' ')[0] ?? ''
			expect(within).toMatch(/^e\d+$/)
			const inside = await view.elements.outline({ within })
			expect(inside.text.split('\n').slice(1)).toEqual([
				'e1 link "One"',
				'e2 link "Two"',
				'(2 of 2 elements)',
			])
		})

		it('yields no row for a scope root that is hidden or sits under a hidden ancestor', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await view.elements.outline()
			const empty = ['page "Probe" about:srcdoc', '(0 of 0 elements)']
			expect((await view.elements.outline({ within: 'e3' })).text).toContain('e3 button "Save"')
			probe.save.hidden = true
			expect((await view.elements.outline({ within: 'e3' })).text.split('\n')).toEqual(empty)
			probe.save.hidden = false
			requireValue(probe.document.querySelector('main'), 'main').setAttribute('aria-hidden', 'true')
			expect((await view.elements.outline({ within: 'e3' })).text.split('\n')).toEqual(empty)
			expect(await view.elements.find({ role: 'button', within: 'e3' })).toEqual([])
		})

		it('yields no row for a slotted scope root under a hidden shadow ancestor', async () => {
			const probe = await loadProbeDocument(
				'<div><template shadowrootmode="open"><section><slot></slot></section></template><button>Save</button></div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const [save] = await view.elements.find({ role: 'button' })
			const within = requireValue(save, 'slotted button').reference
			const host = requireValue(probe.querySelector('div'), 'host')
			requireValue(host.shadowRoot?.querySelector('section'), 'section').setAttribute(
				'aria-hidden',
				'true',
			)
			expect((await view.elements.outline()).text).not.toContain('Save')
			expect((await view.elements.outline({ within })).text.split('\n').slice(1)).toEqual([
				'(0 of 0 elements)',
			])
			expect(await view.elements.find({ role: 'button', within })).toEqual([])
		})

		it('walks nested open roots, fallback slot text, and a frame inside a shadow root', async () => {
			const probe = await createProbeElements()
			const outer = probe.document.createElement('div')
			probe.late.append(outer)
			const shadow = outer.attachShadow({ mode: 'open' })
			shadow.innerHTML = '<button><slot>Fallback</slot></button><div id="inner"></div>'
			const inner = requireValue(shadow.getElementById('inner'), 'inner host').attachShadow({
				mode: 'open',
			})
			inner.innerHTML = '<a href="/deep">Deep</a>'
			await loadProbeFrame(probe.document, shadow, '<button>Framed</button>')
			const view = createBrowserDOMView({ document: probe.document })
			const rows = (await view.elements.outline()).text.split('\n')
			expect(rows.slice(rows.indexOf('e4 textbox "Email"') + 1)).toEqual([
				'e5 button "Fallback"',
				'e6 link "Deep"',
				'e7 button "Framed"',
				'Footer chrome nobody reads',
				'(7 of 7 elements)',
			])
		})

		it('contributes the rows of open shadow roots and slotted nodes in document order', async () => {
			const probe = await loadProbeDocument(
				[
					'<p>Before</p>',
					'<div><template shadowrootmode="open"><button>Save</button></template>Unrendered</div>',
					'<div><template shadowrootmode="open"><nav><slot></slot></nav></template><a href="/cars">Slotted</a></div>',
					'<p>After</p>',
				].join(''),
			)
			const view = createBrowserDOMView({ document: probe })
			const { text } = await view.elements.outline()
			expect(text.split('\n').slice(1)).toEqual([
				'Before',
				'e1 button "Save"',
				'e2 link "Slotted"',
				'After',
				'(2 of 2 elements)',
			])
		})

		it('omits a visibility: hidden element and keeps its visible descendant', async () => {
			const probe = await loadProbeDocument(
				'<button style="visibility: hidden">Ghost</button><div style="visibility: hidden">Faded<button style="visibility: visible">Seen</button></div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const { text } = await view.elements.outline()
			expect(text.split('\n').slice(1)).toEqual(['e1 button "Seen"', '(1 of 1 elements)'])
		})

		it('refuses a negative or fractional limit and an unknown within reference', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await expect(view.elements.outline({ limit: -1 })).rejects.toThrow(/nonnegative integer/)
			await expect(view.elements.outline({ limit: 1.5 })).rejects.toThrow(/nonnegative integer/)
			const refusal = await view.elements
				.outline({ within: 'e99' })
				.catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context?.['reason']).toBe('GONE')
		})
	})

	describe('destroyed view', () => {
		it('refuses outline after its view is destroyed with BROWSER_DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements.outline().catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('refuses find after its view is destroyed with BROWSER_DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements
				.find({ role: 'button', name: 'Save' })
				.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('refuses wait after its view is destroyed with BROWSER_DOCUMENT_DESTROYED, even for a present match', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements
				.wait({ role: 'button', name: 'Save' })
				.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})
	})

	describe('references', () => {
		it('keeps an element reference across outlines and never reuses a cleared number', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await view.elements.outline()
			const save = view.elements.element('e3')
			probe.late.innerHTML = '<button>Added</button>'
			const second = await view.elements.outline()
			expect(view.elements.element('[ref=e3]')).toBe(save)
			expect(second.text).toContain('e3 button "Save"')
			expect(second.text).toContain('e5 button "Added"')
			view.elements.clear()
			expect(view.elements.elements()).toEqual([])
			expect(view.elements.element('e3')).toBeUndefined()
			const third = await view.elements.outline()
			expect(third.text).toContain('e6 link "One"')
			expect(third.text).not.toMatch(/\be[1-5] /)
		})
	})

	describe('bindings', () => {
		it('reports GONE for a removed node and mints the next number for its replacement', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const [save] = await view.elements.find({ role: 'button' })
			const replacement = probe.document.createElement('button')
			replacement.textContent = 'Save'
			probe.save.replaceWith(replacement)
			const refusal = await save?.click().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({
				reference: 'e3',
				reason: 'GONE',
			})
			const [next] = await view.elements.find({ role: 'button' })
			expect(next?.reference).toBe('e5')
			expect(view.elements.element('e3')).toBe(save)
		})

		it('refreshes the description of an element only a CSS query binds, keeping the reference', async () => {
			const probe = await createProbeElements()
			probe.late.innerHTML = '<div id="note" aria-label="Draft">Note</div>'
			const view = createBrowserDOMView({ document: probe.document })
			expect((await view.elements.outline()).text).not.toContain('Draft')
			const [note] = await view.elements.find({ css: '#note' })
			expect([note?.role, note?.name]).toEqual(['generic', 'Draft'])
			requireValue(probe.document.getElementById('note'), 'note').setAttribute(
				'aria-label',
				'Final',
			)
			expect(note?.name).toBe('Draft')
			expect(await view.elements.find({ css: '#note' })).toEqual([note])
			expect(note?.name).toBe('Final')
			expect(view.elements.element(note?.reference ?? '')?.name).toBe('Final')
		})
	})

	describe('find', () => {
		it('matches by role and case-insensitive name, and by CSS alone or combined', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const [save] = await view.elements.find({ role: 'button', name: 'save' })
			expect(save?.reference).toBe('e3')
			expect(save?.name).toBe('Save')
			const links = await view.elements.find({ css: 'nav a' })
			expect(links.map((link) => link.name)).toEqual(['One', 'Two'])
			const combined = await view.elements.find({ role: 'link', name: 'two', css: 'a' })
			expect(combined.map((link) => link.reference)).toEqual(['e2'])
			const paragraph = await view.elements.find({ css: 'p' })
			expect(paragraph.map((element) => element.role)).toEqual(['paragraph'])
		})

		it('refuses an invalid CSS query with a coded error', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const refusal = await view.elements.find({ css: 'a[' }).catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_ELEMENT_QUERY')
		})
	})

	describe('wait', () => {
		it('resolves within 100 ms of an element appended 30 ms later', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const started = performance.now()
			const pending = view.elements.wait({ role: 'button', name: 'Late' }, { timeout: 1_000 })
			setTimeout(() => {
				probe.late.innerHTML = '<button>Late</button>'
			}, 30)
			const [late] = await pending
			const elapsed = performance.now() - started
			expect(late?.name).toBe('Late')
			expect(elapsed).toBeGreaterThanOrEqual(29)
			expect(elapsed).toBeLessThan(130)
		})

		it('resolves on absence after the element is removed', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.elements.wait({ css: 'button' }, { absent: true, timeout: 1_000 })
			setTimeout(() => probe.save.remove(), 10)
			expect(await pending).toEqual([])
		})

		it('fails at its deadline and on abort with the signal reason', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const expired = await view.elements
				.wait({ name: 'Never' }, { timeout: 20 })
				.catch((error: unknown) => error)
			expect(isBrowserError(expired) && expired.code).toBe('BROWSER_WAIT_TIMEOUT')
			const controller = new AbortController()
			const pending = view.elements.wait({ name: 'Never' }, { signal: controller.signal })
			controller.abort(new Error('stopped'))
			await expect(pending).rejects.toThrow('stopped')
		})

		it('wakes on a match inside a frame inserted after the wait began', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.elements.wait({ role: 'button', name: 'Inner' }, { timeout: 2_000 })
			const inner = await loadProbeFrame(probe.document, probe.late, '<main></main>')
			inner.body.insertAdjacentHTML('beforeend', '<button>Inner</button>')
			const [found] = await pending
			expect(found?.name).toBe('Inner')
		})

		it('runs no check after destroy, even for a mutation queued in the same task', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.elements.wait({ name: 'Late' }, { timeout: 1_000 })
			probe.late.innerHTML = '<button>Late</button>'
			view.destroy()
			const refusal = await pending.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
			await waitForDelay(10)
			expect(view.elements.elements()).toEqual([])
		})

		it('rejects a pending wait when its view is destroyed, and a later match does not resolve it', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.elements.wait({ name: 'Late' }, { timeout: 1_000 })
			view.destroy()
			probe.late.innerHTML = '<button>Late</button>'
			const refusal = await pending.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})
	})
})
