import { scanBrowserLines } from '@src/core'
import { renderBrowserLine } from '@src/core'
import { describe, expect, it } from 'vitest'
import { isBrowserError } from '@src/core'
import { createBrowserDOMView } from '@src/browser'
import { requireValue, waitForDelay, waitForEvent } from '@orkestrel/test'
import {
	BROWSER_ELEMENT_NAME_CASES,
	BROWSER_ELEMENT_NAME_FIXTURE,
	BROWSER_READING_HTML,
	BROWSER_READING_STRUCTURE_HTML,
} from '../../../setup.js'
import {
	createProbeElements,
	loadProbeDocument,
	loadProbeFrame,
	readBrowserFixtureBase,
} from '../../../setupBrowser.js'

describe('BrowserDOMElementManager', () => {
	describe('outline', () => {
		it('keeps distinct heading links, table references, escaped images and clamped levels', async () => {
			const probe = await loadProbeDocument(BROWSER_READING_STRUCTURE_HTML)
			const view = createBrowserDOMView({ document: probe })
			expect((await view.elements.outline()).lines.map(renderBrowserLine)).toEqual([
				'## Menu Tea Elsewhere',
				`e1 link "Tea" ${new URL('/tea', document.baseURI).href}`,
				'e2 link "Elsewhere" https://else.example/',
				'###### End',
				`Before e3 link "Buy" ${new URL('/buy', document.baseURI).href} after | 9`,
				'image "A \\"quote\\""',
			])
		})
		it('projects the shared control, heading, link, list, table and image fixture', async () => {
			const probe = await loadProbeDocument(BROWSER_READING_HTML)
			const view = createBrowserDOMView({ document: probe })
			const lines = (await view.elements.outline()).lines.map(renderBrowserLine)
			expect(lines).toEqual([
				`### e1 link "Cedar Tea" ${new URL('/tea?q=1#cup', document.baseURI).href}`,
				'- A list entry',
				'Product | Price',
				'Cedar | 41',
				'image "Named image"',
				'Account',
				'e2 textbox "Account" value="••••••"',
				'Account',
				'e3 textbox "Account" value="••••••"',
			])
			expect(lines.join('\n')).not.toContain('sample')
		})
		it('renders veneer toggle states with a plain-button control', async () => {
			const probe = await loadProbeDocument(
				'<button aria-pressed="true">On</button><button aria-pressed="false">Off</button><button>Plain</button>',
			)
			const view = createBrowserDOMView({ document: probe })
			expect((await view.elements.outline()).lines.map(renderBrowserLine)).toEqual([
				'e1 button "On" pressed=true',
				'e2 button "Off" pressed=false',
				'e3 button "Plain"',
			])
		})

		it('names the probe page button, text field, and link, and renders headings and text', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const outline = await view.elements.outline()
			expect(outline.lines.map(renderBrowserLine).join('\n')).toBe(
				[
					`e1 link "One" ${new URL('/one', document.baseURI).href}`,
					`e2 link "Two" ${new URL('/two', document.baseURI).href}`,
					'# Probe page',
					'A paragraph the reader wants.',
					'e3 button "Save"',
					'Email',
					'e4 textbox "Email"',
					'Footer chrome nobody reads',
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
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
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
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
			expect(text.split('\n').slice(3)).toEqual([
				'A paragraph the reader wants.',
				'e3 button "Save"',
				'Email',
				'e4 textbox "Email"',
				'e5 button "Inner"',
				'iframe "Fixture" (cross-origin, not readable)',
				'Footer chrome nobody reads',
			])
		})

		it('marks a declarative tool form after its role and name', async () => {
			const probe = await loadProbeDocument(
				'<form toolname="search-cars" aria-label="Search cars"><input aria-label="Make"></form>',
			)
			const view = createBrowserDOMView({ document: probe })
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
			expect(text.split('\n')).toEqual([
				'e1 form "Search cars" [tool=search-cars]',
				'e2 textbox "Make"',
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
			const rows = (await view.elements.outline()).lines.map(renderBrowserLine)
			expect(rows).toContain('e1 textbox "Email" value="sam@example.test"')
			expect(rows).toContain('e2 textbox "Secret" value="•••••••"')
			expect(rows).toContain('e3 checkbox "Gift wrap" [checked]')
			expect(rows).toContain('e4 button "Place order" [disabled]')
			expect(rows).toContain('e5 combobox "Size" value="Large" expanded=false')
			expect(rows.join('\n')).not.toContain('hunter2')
		})

		it('lists a select row followed by one option row per option, named by its label', async () => {
			const probe = await loadProbeDocument(
				[
					'<select aria-label="Size">',
					'<option value="s">Small</option>',
					'<option value="m" selected> Medium  size </option>',
					'<option value="l" label="Large" disabled>L</option>',
					'</select>',
					'<button>Next</button>',
				].join('\n'),
			)
			const view = createBrowserDOMView({ document: probe })
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
			expect(text.split('\n')).toEqual([
				'e1 combobox "Size" value="Medium size" expanded=false',
				'e2 option "Small" selected=false',
				'e3 option "Medium size" selected=true',
				'e4 option "Large" selected=false [disabled]',
				'e5 button "Next"',
			])
			const options = await view.elements.find({ role: 'option' })
			expect(options.map((option) => [option.reference, option.name])).toEqual([
				['e2', 'Small'],
				['e3', 'Medium size'],
				['e4', 'Large'],
			])
			const [size] = await view.elements.find({ role: 'combobox', name: 'Size' })
			await requireValue(size, 'select').select(['s'])
			expect(requireValue(probe.querySelector('select'), 'select').value).toBe('s')
		})

		it('separates adjacent texts by the whitespace or visible break between them and keeps a fragment without either joined', async () => {
			const probe = await loadProbeDocument(
				[
					'<div><label>Gift wrap</label>\n  <label>Message</label></div>',
					'<p><label>Gift<b>wrap</b></label> <span> for  </span><i>two</i></p>',
					'<p>Gift<br>wrap</p>',
					'<p>Card<br style="display: none">note</p>',
					'<p>Map<br style="visibility: hidden">pin</p>',
				].join(''),
			)
			const view = createBrowserDOMView({ document: probe })
			const rows = (await view.elements.outline()).lines.map(renderBrowserLine)
			expect(rows).toEqual([
				'Gift wrap Message',
				'Giftwrap for two',
				'Gift wrap',
				'Cardnote',
				'Map pin',
			])
		})

		it('separates text in different blocks and joins text within one', async () => {
			const probe = await loadProbeDocument(
				'<p>Two items, <b>48.00</b> total.</p><div><p>First</p>Second</div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const rows = (await view.elements.outline()).lines.map(renderBrowserLine)
			expect(rows).toEqual(['Two items, 48.00 total.', 'First', 'Second'])
		})

		it('bounds the referenced rows by limit and scopes them by within', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const bounded = await view.elements.outline({ limit: 1 })
			expect(bounded).toMatchObject({ count: 1, total: 4 })
			expect(bounded.lines.map(renderBrowserLine).join('\n')).not.toContain('e2 link')
			const nav = probe.document.querySelector('nav')
			nav?.setAttribute('role', 'button')
			const scoped = await view.elements.outline()
			const reference = scoped.lines
				.map(renderBrowserLine)
				.find((row) => row.endsWith('button "Site"'))
			nav?.removeAttribute('role')
			const within = reference?.split(' ')[0] ?? ''
			expect(within).toMatch(/^e\d+$/)
			const inside = await view.elements.outline({ within })
			expect(inside.lines.map(renderBrowserLine)).toEqual([
				`e1 link "One" ${new URL('/one', document.baseURI).href}`,
				`e2 link "Two" ${new URL('/two', document.baseURI).href}`,
			])
		})

		it('yields no row for a scope root that is hidden or sits under a hidden ancestor', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await view.elements.outline()
			const empty: readonly string[] = []
			expect(
				(await view.elements.outline({ within: 'e3' })).lines.map(renderBrowserLine).join('\n'),
			).toContain('e3 button "Save"')
			probe.save.hidden = true
			expect((await view.elements.outline({ within: 'e3' })).lines.map(renderBrowserLine)).toEqual(
				empty,
			)
			probe.save.hidden = false
			requireValue(probe.document.querySelector('main'), 'main').setAttribute('aria-hidden', 'true')
			expect((await view.elements.outline({ within: 'e3' })).lines.map(renderBrowserLine)).toEqual(
				empty,
			)
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
			expect((await view.elements.outline()).lines.map(renderBrowserLine).join('\n')).not.toContain(
				'Save',
			)
			expect((await view.elements.outline({ within })).lines.map(renderBrowserLine)).toEqual([])
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
			const rows = (await view.elements.outline()).lines.map(renderBrowserLine)
			expect(rows.slice(rows.indexOf('e4 textbox "Email"') + 1)).toEqual([
				'e5 button "Fallback"',
				`e6 link "Deep" ${new URL('/deep', document.baseURI).href}`,
				'e7 button "Framed"',
				'Footer chrome nobody reads',
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
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
			expect(text.split('\n')).toEqual([
				'Before',
				'e1 button "Save"',
				`e2 link "Slotted" ${new URL('/cars', document.baseURI).href}`,
				'After',
			])
		})

		it('omits a visibility: hidden element and keeps its visible descendant', async () => {
			const probe = await loadProbeDocument(
				'<button style="visibility: hidden">Ghost</button><div style="visibility: hidden">Faded<button style="visibility: visible">Seen</button></div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const text = (await view.elements.outline()).lines.map(renderBrowserLine).join('\n')
			expect(text.split('\n')).toEqual(['e1 button "Seen"'])
		})

		it('lists the rows that best match a search past the limit', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const outline = await view.elements.outline({ limit: 150 })
			expect(
				scanBrowserLines(outline.lines, 'Email')
					.map((number) => outline.lines[number - 1])
					.filter((line) => line !== undefined)
					.map(renderBrowserLine),
			).toEqual(['Email', 'e4 textbox "Email"'])
			expect(
				scanBrowserLines((await view.elements.outline({ limit: 1 })).lines, 'Email').length,
			).toBeGreaterThan(0)
		})

		it('names the focused element and none after it loses focus', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			probe.save.focus()
			expect((await view.elements.outline({ limit: 0 })).focus).toBe('e3 button "Save"')
			probe.save.blur()
			expect((await view.elements.outline()).focus).toBeUndefined()
		})

		it('names an element focused inside an open shadow root', async () => {
			const probe = await loadProbeDocument(
				'<button>Outer</button><div><template shadowrootmode="open"><button>Inner</button></template></div>',
			)
			const view = createBrowserDOMView({ document: probe })
			const host = requireValue(probe.querySelector('div'), 'shadow host')
			requireValue(host.shadowRoot?.querySelector('button'), 'inner button').focus()
			expect(probe.activeElement).toBe(host)
			expect((await view.elements.outline()).focus).toBe('e2 button "Inner"')
		})

		it('discards stale focus in a frame after focus returns to the parent', async () => {
			const probe = await loadProbeDocument('<button>Parent</button>')
			const child = await loadProbeFrame(probe, probe.body, '<input aria-label="Child">')
			const input = requireValue(child.querySelector('input'))
			const button = requireValue(probe.querySelector('button'))
			const view = createBrowserDOMView({ document: probe })
			input.focus()
			expect((await view.elements.outline()).focus).toBe('e2 textbox "Child"')
			button.focus()
			expect(child.activeElement).toBe(child.body)
			expect((await view.elements.outline()).focus).toBe('e1 button "Parent"')
			button.blur()
			expect((await view.elements.outline()).focus).toBeUndefined()
		})

		it('refuses a negative or fractional limit and an unknown within reference', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await expect(view.elements.outline({ limit: -1 })).rejects.toThrow(/nonnegative integer/)
			await expect(view.elements.outline({ limit: 1.5 })).rejects.toThrow(/nonnegative integer/)
			const refusal = await view.elements
				.outline({ within: 'e99' })
				.catch((error: unknown) => error)
			expect(
				isBrowserError(refusal) && refusal.code === 'ELEMENT' && refusal.context?.['reason'],
			).toBe('GONE')
		})
	})

	describe('destroyed view', () => {
		it('refuses outline after its view is destroyed with DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements.outline().catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_DESTROYED')
		})

		it('refuses find after its view is destroyed with DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements
				.find({ role: 'button', name: 'Save' })
				.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_DESTROYED')
		})

		it('refuses wait after its view is destroyed with DOCUMENT_DESTROYED, even for a present match', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.elements
				.wait({ role: 'button', name: 'Save' })
				.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_DESTROYED')
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
			expect(second.lines.map(renderBrowserLine).join('\n')).toContain('e3 button "Save"')
			expect(second.lines.map(renderBrowserLine).join('\n')).toContain('e5 button "Added"')
			view.elements.clear()
			expect(view.elements.elements()).toEqual([])
			expect(view.elements.element('e3')).toBeUndefined()
			const third = await view.elements.outline()
			expect(third.lines.map(renderBrowserLine).join('\n')).toContain('e6 link "One"')
			expect(third.lines.map(renderBrowserLine).join('\n')).not.toMatch(/\be[1-5] /)
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
			expect(
				isBrowserError(refusal) && refusal.code === 'ELEMENT' && refusal.context,
			).toMatchObject({
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
			expect((await view.elements.outline()).lines.map(renderBrowserLine).join('\n')).not.toContain(
				'Draft',
			)
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
		it.each(BROWSER_ELEMENT_NAME_CASES)('$title', async ({ query, expected }) => {
			const document = await loadProbeDocument(
				BROWSER_ELEMENT_NAME_FIXTURE.map((name) => `<button>${name}</button>`).join(''),
			)
			const view = createBrowserDOMView({ document })
			try {
				expect((await view.elements.find(query)).map((element) => element.name)).toEqual(expected)
			} finally {
				view.destroy()
			}
		})

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
			expect(isBrowserError(refusal) && refusal.code).toBe('ELEMENT_QUERY')
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
			expect(isBrowserError(expired) && expired.code).toBe('WAIT_TIMEOUT')
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
			expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_DESTROYED')
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
			expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_DESTROYED')
		})
	})
})
