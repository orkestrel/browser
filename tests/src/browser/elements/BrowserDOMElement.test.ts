import type { BrowserAction } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_RESULT_LIMIT,
	BrowserReplay,
	BrowserToolset,
	renderBrowserRun,
	isBrowserElementError,
	isBrowserError,
	isBrowserResultLimitError,
} from '@src/core'
import { BrowserDOMElement, createBrowserDOMView } from '@src/browser'
import { createRecorder, readProperty, requireValue } from '@orkestrel/test'
import {
	BROWSER_SECRET_SELECT_HTML,
	BROWSER_SELECT_SECRET,
	BROWSER_JOURNEY_SECRET,
	RecordingBrowserRunStore,
	createBrowserJourneyFixture,
} from '../../../setup.js'
import {
	CollectedReference,
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

		it('refuses a disabled button DISABLED, and a target="_blank" link and a file chooser UNTRUSTED', async () => {
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
			expect(isBrowserElementError(popup) && popup.context).toEqual({
				reference: link.reference,
				reason: 'UNTRUSTED',
			})
			expect(isBrowserElementError(popup) && popup.message).toBe(
				`Element ${link.reference} opens another browsing context, which an untrusted click cannot do.`,
			)
			expect(isBrowserElementError(chooser) && chooser.context).toEqual({
				reference: file.reference,
				reason: 'UNTRUSTED',
			})
			expect(isBrowserElementError(chooser) && chooser.message).toBe(
				`Element ${file.reference} opens a file chooser, which an untrusted click cannot do.`,
			)
			expect(clicks.calls).toEqual([])
		})

		it('judges a label by its control: a file chooser refuses UNTRUSTED and a disabled control DISABLED', async () => {
			const probe = await loadProbeDocument(
				'<label role="button">Photo<input type="file"></label><label role="button">Gift<input type="checkbox" disabled></label>',
			)
			const clicks = createRecorder<[string]>()
			probe.addEventListener('click', (event) => clicks.handler(event.type))
			const view = createBrowserDOMView({ document: probe })
			const [photo, gift] = await view.elements.find({ role: 'button' })
			const chooser = await photo?.click().catch((error: unknown) => error)
			const disabled = await gift?.click().catch((error: unknown) => error)
			expect(isBrowserElementError(chooser) && chooser.message).toMatch(/opens a file chooser/)
			expect(isBrowserElementError(chooser) && chooser.context).toMatchObject({
				reason: 'UNTRUSTED',
			})
			expect(isBrowserElementError(disabled) && disabled.context).toMatchObject({
				reason: 'DISABLED',
			})
			expect(clicks.calls).toEqual([])
		})

		it('refuses UNTRUSTED through a file input label for a non-interactive descendant', async () => {
			const probe = await loadProbeDocument(
				'<label for="upload"><span>Choose a photo</span></label><input id="upload" type="file">',
			)
			const clicks = createRecorder<[string]>()
			probe.addEventListener('click', (event) => clicks.handler(event.type))
			const view = createBrowserDOMView({ document: probe })
			const text = await findProbeElement(view, 'span')
			const refusal = await text.click().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toEqual({
				reference: text.reference,
				reason: 'UNTRUSTED',
			})
			expect(isBrowserElementError(refusal) && refusal.message).toBe(
				`Element ${text.reference} opens a file chooser, which an untrusted click cannot do.`,
			)
			expect(clicks.calls).toEqual([])
		})

		it('keeps only the target own checks for a click on an interactive descendant of a label', async () => {
			const probe = await loadProbeDocument(
				[
					'<label for="upload"><a href="#help">Help</a> Photo</label><input id="upload" type="file">',
					'<label>Gift <input type="checkbox" disabled><a href="#terms">Terms</a></label>',
				].join(''),
			)
			const clicks = createRecorder<[unknown]>()
			probe.addEventListener('click', (event) => {
				event.preventDefault()
				clicks.handler(Reflect.get(event.target ?? {}, 'localName'))
			})
			const view = createBrowserDOMView({ document: probe })
			const [help, terms] = await view.elements.find({ css: 'a' })
			await help?.click()
			await terms?.click()
			expect(clicks.calls).toEqual([['a'], ['a']])
		})

		it('clicks an image with controls inside a file input label without the chooser refusal', async () => {
			const probe = await loadProbeDocument(
				'<label for="upload"><img controls src="animation.gif"></label><input id="upload" type="file">',
			)
			const clicks = createRecorder<[unknown]>()
			probe.addEventListener('click', (event) => {
				event.preventDefault()
				clicks.handler(Reflect.get(event.target ?? {}, 'localName'))
			})
			const view = createBrowserDOMView({ document: probe })
			await (await findProbeElement(view, 'img')).click()
			expect(clicks.calls).toEqual([['img']])
		})

		it('activates a label for a checkbox and toggles the checkbox', async () => {
			const probe = await loadProbeDocument(
				'<label role="button">Gift wrap<input type="checkbox"></label>',
			)
			const box = requireValue(probe.querySelector('input'), 'checkbox')
			const view = createBrowserDOMView({ document: probe })
			const [label] = await view.elements.find({ role: 'button' })
			await label?.click()
			expect(box.checked).toBe(true)
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

	describe('binding', () => {
		it('acts on the node its weak reference dereferences, and reports GONE when it does not', async () => {
			const probe = await createProbeElements()
			const clicks = createRecorder<[boolean]>()
			probe.save.addEventListener('click', (event) => clicks.handler(event.isTrusted))
			const node = new WeakRef<Element>(probe.save)
			expect(node.deref()).toBe(probe.save)
			const bound = new BrowserDOMElement({
				reference: 'e7',
				description: () => ({ role: 'button', name: 'Save' }),
				node,
				current: () => true,
				navigation: () => 0,
			})
			await bound.click()
			expect(clicks.calls).toEqual([[false]])
			const collected = new BrowserDOMElement({
				reference: 'e8',
				description: () => ({ role: 'button', name: 'Save' }),
				node: new CollectedReference(probe.save),
				current: () => true,
				navigation: () => 0,
			})
			const refusals = await Promise.all(
				[
					collected.click(),
					collected.fill('x'),
					collected.select(['x']),
					collected.focus(),
					collected.read(),
					collected.submit(),
				].map((action) =>
					action.then(
						() => undefined,
						(error: unknown) => error,
					),
				),
			)
			for (const refusal of refusals) {
				expect(isBrowserElementError(refusal) && refusal.context).toEqual({
					reference: 'e8',
					reason: 'GONE',
				})
			}
			expect(clicks.count).toBe(1)
		})

		it('reports the latest captured role and name, refreshed by a recapture and kept after removal', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const save = requireValue(
				(await view.elements.find({ role: 'button', name: 'Save' }))[0],
				'save element',
			)
			probe.save.setAttribute('aria-label', 'Store')
			expect([save.role, save.name]).toEqual(['button', 'Save'])
			const outline = await view.elements.outline()
			expect(outline.text).toContain(`${save.reference} button "Store"`)
			expect([save.role, save.name]).toEqual(['button', 'Store'])
			expect(view.elements.element(save.reference)?.name).toBe('Store')
			probe.save.setAttribute('role', 'link')
			probe.save.setAttribute('aria-label', 'Keep')
			expect(await view.elements.find({ role: 'link', name: 'Keep' })).toEqual([save])
			expect([save.role, save.name]).toEqual(['link', 'Keep'])
			probe.save.remove()
			await view.elements.outline()
			view.elements.clear()
			expect(view.elements.element(save.reference)).toBeUndefined()
			expect([save.role, save.name]).toEqual(['link', 'Keep'])
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
			const bubbled = createRecorder<[string]>()
			for (const type of ['input', 'change']) {
				probe.document.body.addEventListener(type, (event) => bubbled.handler(event.type))
			}
			const view = createBrowserDOMView({ document: probe.document })
			await (await findProbeElement(view, 'input')).fill('sam@example.test')
			expect(own.calls).toEqual([])
			expect(events.calls).toEqual([
				['input', 'sam@example.test', false],
				['change', 'sam@example.test', false],
			])
			expect(bubbled.calls).toEqual([['input'], ['change']])
		})

		it('refuses typing into a contenteditable element, a non-text control, and a read-only field', async () => {
			const probe = await loadProbeDocument(
				'<div contenteditable role="textbox" aria-label="Notes"></div><input type="checkbox"><button>Search</button><input aria-label="Code" readonly>',
			)
			const view = createBrowserDOMView({ document: probe })
			const editable = await findProbeElement(view, 'div')
			const checkbox = await findProbeElement(view, 'input')
			const search = await findProbeElement(view, 'button')
			const code = await findProbeElement(view, 'input[readonly]')
			const notes = await editable.fill('Hello').catch((error: unknown) => error)
			const box = await checkbox.fill('on').catch((error: unknown) => error)
			const button = await search.fill('kettle').catch((error: unknown) => error)
			const fixed = await code.fill('SPRING').catch((error: unknown) => error)
			expect(isBrowserElementError(notes) && notes.message).toBe(
				`Element ${editable.reference} is contenteditable, which an untrusted event cannot type into.`,
			)
			expect(isBrowserElementError(notes) && notes.context).toMatchObject({ reason: 'UNTRUSTED' })
			expect(probe.querySelector('div')?.textContent).toBe('')
			expect(isBrowserElementError(box) && box.message).toBe(
				`Element ${checkbox.reference} is not a text control.`,
			)
			expect(isBrowserElementError(button) && button.message).toBe(
				`Element ${search.reference} is not a text control.`,
			)
			expect(isBrowserElementError(button) && button.context).toMatchObject({ reason: 'UNKNOWN' })
			expect(isBrowserElementError(fixed) && fixed.message).toBe(
				`Element ${code.reference} is not editable.`,
			)
			expect(isBrowserElementError(box) && box.context).toMatchObject({ reason: 'UNKNOWN' })
		})
	})

	describe('select', () => {
		it('keeps a missing secret option out of DOM results, actions, stored runs, and renders', async () => {
			const probe = await loadProbeDocument(BROWSER_SECRET_SELECT_HTML)
			const view = createBrowserDOMView({ document: probe })
			const element = await findProbeElement(view, 'select')
			const refusal = await element.select([BROWSER_SELECT_SECRET]).catch((error: unknown) => error)
			expect(
				isBrowserElementError(refusal) && refusal.message,
				'the element must not quote the missing option',
			).toBe(`Element ${element.reference} has no such option.`)
			const toolset = new BrowserToolset(view)
			const actions = createRecorder<readonly [BrowserAction]>()
			toolset.emitter.on('action', actions.handler)
			const runs = new RecordingBrowserRunStore()
			try {
				await toolset.start()
				const performed = await toolset.perform({
					id: 'missing',
					name: 'type',
					arguments: { ref: element.reference, text: BROWSER_SELECT_SECRET, secret: true },
				})
				expect(performed.result.success).toBe(false)
				expect(performed.action).toMatchObject({ outcome: 'refused', secret: true })
				expect(performed.action?.receipt).toBe(`Element ${element.reference} has no such option.`)
				expect(JSON.stringify(performed)).not.toContain('Zq7#')
				const journey = createBrowserJourneyFixture(
					[
						{
							action: 'type',
							arguments: { text: { parameter: 'password' } },
							target: { role: 'combobox', name: 'Access level' },
						},
					],
					{ parameters: { password: { secret: true } } },
				)
				const run = await new BrowserReplay(
					toolset,
					{ journey },
					{
						inputs: { password: BROWSER_SELECT_SECRET },
						runs,
					},
				).execute()
				expect(run.outcome).toBe('stopped')
				expect(run.steps[0]?.result).toBe(`Element ${element.reference} has no such option.`)
				expect(runs.writes.count).toBeGreaterThan(0)
				expect(actions.count).toBe(2)
				expect(JSON.stringify(actions.calls)).not.toContain('Zq7#')
				expect(JSON.stringify(runs.writes.calls)).not.toContain('Zq7#')
				expect(JSON.stringify(run)).not.toContain('Zq7#')
				expect(renderBrowserRun(run)).not.toContain('Zq7#')
				expect(await runs.get(journey.name, run.id)).toEqual(run)
			} finally {
				await toolset.destroy()
			}
		})

		it('reports Selected a secret for a direct type into a DOM select with the option', async () => {
			const probe = await loadProbeDocument(BROWSER_SECRET_SELECT_HTML)
			const select = requireValue(probe.querySelector('select'))
			const option = requireValue(select.options[0])
			option.value = BROWSER_JOURNEY_SECRET
			const view = createBrowserDOMView({ document: probe })
			const element = await findProbeElement(view, 'select')
			const toolset = new BrowserToolset(view)
			try {
				await toolset.start()
				const result = await requireValue(toolset.tools.tool('type')).execute(
					{
						ref: element.reference,
						text: BROWSER_JOURNEY_SECRET,
						secret: true,
					},
					{ signal: new AbortController().signal },
				)
				expect(String(result).split('\n')[0]).toBe(
					`Selected a secret in ${element.reference} combobox "Access level" (programmatic). (untrusted event)`,
				)
				expect(select.value).toBe(BROWSER_JOURNEY_SECRET)
				expect(String(result)).not.toContain('Zq7#')
			} finally {
				await toolset.destroy()
			}
		})

		it('selects by value or label and refuses a missing option and a non-select', async () => {
			const probe = await loadProbeDocument(
				'<select aria-label="Size"><option value="s">Small</option><option value="l">Large</option></select><input>',
			)
			const select = requireValue(probe.querySelector('select'), 'select')
			const changes = createRecorder<[string]>()
			select.addEventListener('change', () => changes.handler(select.value))
			const bubbled = createRecorder<[string]>()
			for (const type of ['input', 'change']) {
				probe.body.addEventListener(type, (event) => bubbled.handler(event.type))
			}
			const view = createBrowserDOMView({ document: probe })
			const size = await findProbeElement(view, 'select')
			await size.select(['Large'])
			await size.select(['s'])
			expect(changes.calls).toEqual([['l'], ['s']])
			expect(bubbled.calls).toEqual([['input'], ['change'], ['input'], ['change']])
			const missing = await size.select(['Huge']).catch((error: unknown) => error)
			const field = await findProbeElement(view, 'input')
			const text = await field.select(['x']).catch((error: unknown) => error)
			expect(isBrowserElementError(missing) && missing.message).toBe(
				`Element ${size.reference} has no such option.`,
			)
			expect(isBrowserError(text) && text.message).toMatch(/not a select control/)
			expect(isBrowserElementError(missing) && missing.context).toMatchObject({ reason: 'UNKNOWN' })
			expect(isBrowserElementError(text) && text.context).toMatchObject({ reason: 'UNKNOWN' })
		})

		it('refuses a disabled select DISABLED, a hidden one HIDDEN, and a removed one GONE', async () => {
			const probe = await loadProbeDocument(
				[
					'<select id="off" aria-label="Off" disabled><option>Small</option></select>',
					'<select id="shut" aria-label="Shut"><option>Small</option></select>',
					'<select id="gone" aria-label="Gone"><option>Small</option></select>',
				].join(''),
			)
			const view = createBrowserDOMView({ document: probe })
			const off = await findProbeElement(view, '#off')
			const shut = await findProbeElement(view, '#shut')
			const gone = await findProbeElement(view, '#gone')
			requireValue(probe.getElementById('shut'), 'shut').style.display = 'none'
			requireValue(probe.getElementById('gone'), 'gone').remove()
			const refusals = await Promise.all(
				[off, shut, gone].map((element) =>
					element.select(['Small']).then(
						() => undefined,
						(error: unknown) => error,
					),
				),
			)
			expect(refusals.map((refusal) => isBrowserElementError(refusal) && refusal.context)).toEqual([
				{ reference: off.reference, reason: 'DISABLED' },
				{ reference: shut.reference, reason: 'HIDDEN' },
				{ reference: gone.reference, reason: 'GONE' },
			])
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
			expect(isBrowserElementError(loose) && loose.context).toMatchObject({ reason: 'UNKNOWN' })
			expect(isBrowserElementError(popup) && popup.message).toBe(
				`Element ${button.reference} submits into another browsing context, which an untrusted submission cannot open.`,
			)
			expect(isBrowserElementError(popup) && popup.context).toMatchObject({ reason: 'UNTRUSTED' })
		})

		it('refuses a removed form control GONE and fires no submit', async () => {
			const probe = await loadProbeDocument(
				'<form><input name="email" aria-label="Email" value="sam@example.test"></form>',
			)
			const form = requireValue(probe.querySelector('form'), 'form')
			const submits = createRecorder<[]>()
			form.addEventListener('submit', (event) => {
				event.preventDefault()
				submits.handler()
			})
			const view = createBrowserDOMView({ document: probe })
			const email = await findProbeElement(view, 'input')
			requireValue(probe.querySelector('input'), 'input').remove()
			const refusal = await email.submit().catch((error: unknown) => error)
			expect(isBrowserElementError(refusal) && refusal.context).toEqual({
				reference: email.reference,
				reason: 'GONE',
			})
			expect(submits.count).toBe(0)
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

		it('catches an element over BROWSER_RESULT_LIMIT that is parsed, or a smaller read after the refusal that stays refused', async () => {
			const probe = await createProbeElements()
			const view = createBrowserDOMView({ document: probe.document })
			const save = await findProbeElement(view, 'button')
			const filler = probe.document.createTextNode('x'.repeat(BROWSER_RESULT_LIMIT))
			probe.save.append(filler)
			const refusal = await save.read().catch((error: unknown) => error)
			expect(isBrowserResultLimitError(refusal) && refusal.context).toEqual({
				length: expect.any(Number),
				limit: BROWSER_RESULT_LIMIT,
			})
			expect(
				readProperty<number>(readProperty<object>(refusal, 'context'), 'length'),
			).toBeGreaterThan(BROWSER_RESULT_LIMIT)
			filler.remove()
			expect((await save.read()).text({ distill: false }).text).toContain('Save')
		})
	})
})
