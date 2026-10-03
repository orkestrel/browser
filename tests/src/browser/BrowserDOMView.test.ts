import { describe, expect, it } from 'vitest'
import {
	BROWSER_RESULT_LIMIT,
	createBrowserReading,
	isBrowserElementError,
	isBrowserError,
	isBrowserResultLimitError,
} from '@src/core'
import { createBrowserDOMView } from '@src/browser'
import { readProperty, requireValue, waitForEvent } from '@orkestrel/test'
import {
	createProbeDocument,
	createProbeElements,
	findProbeElement,
	loadProbeFrame,
} from '../../setupBrowser.js'
import { RENDERED_PAGE } from '../../setup.js'

describe('BrowserDOMView', () => {
	describe('read', () => {
		it('reads live fields and a direct lowered element without outside prose', async () => {
			const document = createProbeDocument(
				'<p>Outside prose</p><form><input value="Stale default"></form><button>Inside button</button>',
			)
			requireValue(document.querySelector('input')).value = 'Live field'
			const view = createBrowserDOMView({ document })
			try {
				expect((await view.read()).text().text).toContain('Live field')
				expect((await view.read()).text().text).not.toContain('Stale default')
				const button = requireValue((await view.elements.find({ css: 'button' }))[0])
				expect((await button.read()).text().text.trim()).toBe('Inside button')
			} finally {
				view.destroy()
			}
		})
		it('rendered read omits inactive panels and keeps shown text', async () => {
			const view = createBrowserDOMView({ document: createProbeDocument(RENDERED_PAGE) })
			try {
				const text = (await view.read()).markdown().text
				expect(text).toContain('Order summary shown')
				expect(text).not.toContain('Notes pane inactive')
			} finally {
				view.destroy()
			}
		})
		it('captures the document address, title, and markup', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			expect(view.url).toBe('about:srcdoc')
			expect(await view.title()).toBe('Probe')
			const reading = await view.read()
			expect(reading).toMatchObject({ url: 'about:srcdoc', title: 'Probe', stale: false })
			expect(reading.text().text).toContain('A paragraph the reader wants.')
			expect(reading.text().text).not.toContain('Footer chrome')
			expect(reading.text({ distill: false }).text).toContain('Footer chrome nobody reads')
		})

		it('catches a document over BROWSER_RESULT_LIMIT that is parsed, a smaller read after the refusal that stays refused, or a caller-created reading that is limited', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const filler = probe.document.createElement('p')
			filler.textContent = 'x'.repeat(BROWSER_RESULT_LIMIT)
			probe.document.body.append(filler)
			const html = probe.document.documentElement.outerHTML
			const refusal = await view.read().catch((error: unknown) => error)
			expect(isBrowserResultLimitError(refusal) && refusal.context).toEqual({
				length: expect.any(Number),
				limit: BROWSER_RESULT_LIMIT,
			})
			expect(
				readProperty<number>(readProperty<object>(refusal, 'context'), 'length'),
			).toBeGreaterThan(BROWSER_RESULT_LIMIT)
			expect(createBrowserReading({ url: view.url, title: 'Probe', html }).title).toBe('Probe')
			filler.remove()
			expect((await view.read()).text().text).toContain('A paragraph the reader wants.')
		})
	})

	describe('destroy', () => {
		it('refuses read after destroy with BROWSER_DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.read().catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('refuses title after destroy with BROWSER_DOCUMENT_DESTROYED', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.title().catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('refuses a text wait after destroy with BROWSER_DOCUMENT_DESTROYED, even for present text', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const refusal = await view.wait('Probe page').catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('stays destroyed through a second destroy with the same refusal', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			view.destroy()
			const first = await view.read().catch((error: unknown) => error)
			view.destroy()
			const second = await view.read().catch((error: unknown) => error)
			expect(isBrowserError(second) && second.code).toBe('BROWSER_DOCUMENT_DESTROYED')
			expect(second).toBe(first)
			expect(view.elements.elements()).toEqual([])
		})
	})

	describe('navigation', () => {
		it('marks a reading stale after a pushState on a window with the Navigation API', async () => {
			const probe = await createProbeElements()
			const window = probe.document.defaultView
			expect(window !== null && Reflect.has(window, 'navigation')).toBe(true)
			const view = createBrowserDOMView({ document: probe.document })
			const reading = await view.read()
			const save = await findProbeElement(view, 'button')
			const navigated = waitForEvent<[Event]>((listener) => {
				window?.navigation.addEventListener('navigatesuccess', listener, { once: true })
				return () => window?.navigation.removeEventListener('navigatesuccess', listener)
			}, 'navigatesuccess')
			window?.history.pushState(null, '', 'about:srcdoc#cart')
			await navigated
			expect(reading.stale).toBe(true)
			expect((await view.read()).stale).toBe(false)
			expect(view.url).toBe('about:srcdoc#cart')
			expect(view.elements.element(save.reference)).toBe(save)
			await save.focus()
		})

		it('marks a child frame element reading stale on the child pushState and keeps the main reading fresh', async () => {
			const probe = await createProbeElements()
			const child = await loadProbeFrame(probe.document, probe.late, '<button>Inner</button>')
			const view = createBrowserDOMView({ document: probe.document })
			const main = await view.read()
			const [inner] = await view.elements.find({ role: 'button', name: 'Inner' })
			const reading = await requireValue(inner, 'inner button').read()
			expect(reading.stale).toBe(false)
			const window = requireValue(child.defaultView, 'child window')
			const navigated = waitForEvent<[Event]>((listener) => {
				window.navigation.addEventListener('navigatesuccess', listener, { once: true })
				return () => window.navigation.removeEventListener('navigatesuccess', listener)
			}, 'child navigatesuccess')
			window.history.pushState(null, '', 'about:srcdoc#inner')
			await navigated
			expect(reading.stale).toBe(true)
			expect(main.stale).toBe(false)
			expect(view.elements.element(inner?.reference ?? '')).toBe(inner)
		})

		it('drops a child frame document references when that document unloads', async () => {
			const probe = await createProbeElements()
			const child = await loadProbeFrame(probe.document, probe.late, '<button>Inner</button>')
			const view = createBrowserDOMView({ document: probe.document })
			const [inner] = await view.elements.find({ role: 'button', name: 'Inner' })
			const reading = await requireValue(inner, 'inner button').read()
			requireValue(child.defaultView?.frameElement, 'child frame').remove()
			expect(reading.stale).toBe(true)
			expect(view.elements.element(inner?.reference ?? '')).toBeUndefined()
			expect(view.elements.element('e3')?.name).toBe('Save')
		})

		it('keeps a reading current while nothing navigates', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const reading = await view.read()
			probe.late.textContent = 'Changed without navigating'
			expect(reading.stale).toBe(false)
		})

		it('follows the window to its next document and drops every reference', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const reading = await view.read()
			const save = await findProbeElement(view, 'button')
			const frame = probe.frame
			const loaded = waitForEvent<[Event]>((listener) => {
				frame.addEventListener('load', listener, { once: true })
				return () => frame.removeEventListener('load', listener)
			}, 'next document load')
			frame.setAttribute('srcdoc', '<title>Next</title><button>Next</button>')
			await loaded
			expect(reading.stale).toBe(true)
			expect(await view.title()).toBe('Next')
			expect(view.elements.elements()).toEqual([])
			const refusal = await save.click().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({ reason: 'GONE' })
			const outline = await view.elements.outline()
			expect(outline.text).toContain('e5 button "Next"')
		})

		it('stops following the window after destroy', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await view.elements.outline()
			const reading = await view.read()
			view.destroy()
			expect(view.elements.elements()).toEqual([])
			probe.document.defaultView?.history.pushState(null, '', 'about:srcdoc#after')
			expect(reading.stale).toBe(false)
		})
	})

	describe('wait', () => {
		it('resolves within 100 ms of text appended 30 ms later', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const started = performance.now()
			const pending = view.wait('Two items in the cart', { timeout: 1_000 })
			setTimeout(() => {
				probe.late.textContent = 'Two items in the cart'
			}, 30)
			await pending
			const elapsed = performance.now() - started
			expect(elapsed).toBeGreaterThanOrEqual(29)
			expect(elapsed).toBeLessThan(130)
		})

		it('resolves at once for present text and fails at its deadline for absent text', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			await view.wait('Probe page', { timeout: 0 })
			const expired = await view.wait('Never', { timeout: 20 }).catch((error: unknown) => error)
			expect(isBrowserError(expired) && expired.code).toBe('BROWSER_WAIT_TIMEOUT')
			await expect(view.wait('Never', { timeout: -1 })).rejects.toThrow(/non-negative/)
		})

		it('rejects a pending wait when the view is destroyed, and later text does not resolve it', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.wait('Arrived', { timeout: 1_000 })
			view.destroy()
			probe.late.textContent = 'Arrived'
			const refusal = await pending.catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		})

		it('rejects with GONE when the document is unloaded mid-wait', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const pending = view.wait('Never', { timeout: 1_000 })
			probe.frame.remove()
			const refusal = await pending.catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({ reason: 'GONE' })
		})
	})
})
