import type { BrowserViewInterface } from '@src/core'
import type { ToolInterface } from '@orkestrel/tool'
import { describe, expect, it } from 'vitest'
import { isBrowserElementError, isBrowserError } from '@src/core'
import {
	BrowserDOMView,
	createBrowserDOMView,
	createDocumentToolset,
	createSocketCDPTransport,
	SocketCDPTransport,
} from '@src/browser'
import { createToolManager } from '@orkestrel/tool'
import { captureError, createRecorder, requireValue, waitForCondition } from '@orkestrel/test'
import {
	createProbeBridge,
	createProbeDocument,
	createProbeElements,
	recordProbeSubscriptions,
} from '../../setupBrowser.js'

const VIEW_TOOLS = ['look', 'read', 'click', 'type', 'wait']

describe('createBrowserDOMView', () => {
	it('creates an untrusted view over a probe document', async () => {
		const probe = createProbeDocument('<title>Cart</title><button>Pay</button>')
		const view = createBrowserDOMView({ document: probe })
		expect(view).toBeInstanceOf(BrowserDOMView)
		expect(view.trusted).toBe(false)
		expect(await view.title()).toBe('Cart')
		expect((await view.elements.outline()).text).toContain('e1 button "Pay"')
	})

	it('refuses the realm own document unless own is true', () => {
		const refusal = captureError(() => createBrowserDOMView({ document: globalThis.document }))
		expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_OWN')
		const own = createBrowserDOMView({ document: globalThis.document, own: true })
		expect(own.url).toBe(globalThis.document.URL)
		own.destroy()
	})

	it('refuses a document without a window', () => {
		const detached = document.implementation.createHTMLDocument('detached')
		expect(() => createBrowserDOMView({ document: detached })).toThrow(
			/requires a document attached to a window/,
		)
	})
})

describe('createDocumentToolset', () => {
	it('refuses globalThis.document unless own is true, and drives the iframe document', async () => {
		const refusal = captureError(() => createDocumentToolset({ document: globalThis.document }))
		expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_OWN')
		const own = createDocumentToolset({ document: globalThis.document, own: true })
		expect(own.view.url).toBe(globalThis.document.URL)
		await own.destroy()
		const probe = await createProbeElements()
		const toolset = createDocumentToolset({ document: probe.document })
		expect(toolset.view).toBeInstanceOf(BrowserDOMView)
		expect(toolset.view.url).toBe(probe.document.URL)
		expect(toolset.view.trusted).toBe(false)
		await toolset.destroy()
	})

	it('destroys the view it created on destroy, each time over one document, and when construction throws', async () => {
		const probe = await createProbeElements()
		const window = requireValue(probe.document.defaultView, 'probe window')
		const subscriptions = recordProbeSubscriptions(window, 'pagehide')
		const views: BrowserViewInterface[] = []
		for (let round = 0; round < 3; round += 1) {
			const toolset = createDocumentToolset({ document: probe.document })
			views.push(toolset.view)
			await toolset.start()
			await toolset.destroy()
		}
		for (const view of views) {
			const refusal = await view.read().catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_DESTROYED')
		}
		const refusal = captureError(() =>
			createDocumentToolset({ document: probe.document, limit: 0 }),
		)
		expect(isBrowserError(refusal) && refusal.message).toMatch(/limit must be a positive integer/)
		expect(subscriptions.calls.map(([signal]) => signal?.aborted)).toEqual([true, true, true, true])
	})

	it('clicks a checkbox with an untrusted event and ends the click and type receipts with the marker', async () => {
		const probe = await createProbeElements()
		probe.late.innerHTML =
			'<form><label><input type="checkbox"> Gift wrap</label><label role="button">Terms<input type="checkbox"></label><input aria-label="Note"></form>'
		const [box, terms] = Array.from(probe.late.querySelectorAll('input[type="checkbox"]'))
		const form = requireValue(probe.late.querySelector('form'), 'form')
		const trusted = createRecorder<[boolean]>()
		box?.addEventListener('click', (event) => trusted.handler(event.isTrusted))
		const submits = createRecorder<[boolean]>()
		form.addEventListener('submit', (event) => {
			event.preventDefault()
			submits.handler(event.isTrusted)
		})
		const toolset = createDocumentToolset({ document: probe.document })
		await toolset.start()
		const signal = new AbortController().signal
		const look = requireValue(toolset.tools.tool('look'), 'look')
		const click = requireValue(toolset.tools.tool('click'), 'click')
		const type = requireValue(toolset.tools.tool('type'), 'type')
		await look.execute({ what: 'form' }, { signal })
		const [gift] = await toolset.view.elements.find({ role: 'checkbox', name: 'Gift wrap' })
		const [label] = await toolset.view.elements.find({ role: 'button', name: 'Terms' })
		const [note] = await toolset.view.elements.find({ role: 'textbox', name: 'Note' })
		const clicked = await click.execute({ ref: gift?.reference }, { signal })
		expect(Reflect.get(box ?? {}, 'checked')).toBe(true)
		expect(trusted.calls).toEqual([[false]])
		expect(clicked).toBe(
			`Clicked ${gift?.reference} checkbox "Gift wrap". (untrusted event)\n\n${String(await look.execute({ what: 'form' }, { signal }))}`,
		)
		const labelled = await click.execute({ ref: label?.reference }, { signal })
		expect(Reflect.get(terms ?? {}, 'checked')).toBe(true)
		expect(labelled).toBe(
			`Clicked ${label?.reference} button "Terms". (untrusted event)\n\n${String(await look.execute({ what: 'form' }, { signal }))}`,
		)
		const typed = await type.execute(
			{ ref: note?.reference, text: 'sam', submit: true },
			{ signal },
		)
		expect(submits.calls).toEqual([[true]])
		expect(typed).toBe(
			`Typed "sam" into ${note?.reference} textbox "Note" and submitted the form. (untrusted event)\n\n${String(await look.execute({ what: 'form' }, { signal }))}`,
		)
		await toolset.destroy()
	})

	it('lists exactly the five view tools, reports GONE for a removed element, and wakes within 100 ms of a late element', async () => {
		const probe = await createProbeElements()
		const toolset = createDocumentToolset({ document: probe.document })
		await toolset.start()
		expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(VIEW_TOOLS)
		expect(toolset.native.map((tool) => tool.name)).toEqual(VIEW_TOOLS)
		const signal = new AbortController().signal
		await requireValue(toolset.tools.tool('look'), 'look').execute({ what: 'save' }, { signal })
		const [save] = await toolset.view.elements.find({ role: 'button', name: 'Save' })
		probe.save.remove()
		const gone = await Promise.resolve(
			requireValue(toolset.tools.tool('click'), 'click').execute(
				{ ref: save?.reference },
				{ signal },
			),
		).catch((error: unknown) => error)
		expect(isBrowserElementError(gone) && gone.context).toEqual({
			reference: save?.reference,
			reason: 'GONE',
		})
		const appended = createRecorder<[number]>()
		setTimeout(() => {
			probe.late.append('Late arrival')
			appended.handler(performance.now())
		}, 30)
		const waited = await requireValue(toolset.tools.tool('wait'), 'wait').execute(
			{ text: 'Late arrival', timeout: 1 },
			{ signal },
		)
		const resolved = performance.now()
		expect(waited).toBe('"Late arrival" is on the page.')
		const [[at] = [Number.NaN]] = appended.calls
		expect(resolved - at).toBeLessThan(100)
		await toolset.destroy()
	})

	it('adopts the source tools, re-adopts on change, keeps them out of native, and publishes native beside the registry own tools', async () => {
		const probe = await createProbeElements()
		const { registry, bridge } = createProbeBridge(probe.document)
		await registry.registry.registerTool({
			name: 'lookup',
			description: 'Looks up a car',
			execute: async () => 'found',
		})
		const toolset = createDocumentToolset({ document: probe.document, source: bridge })
		const adopted = createRecorder<[ToolInterface]>()
		toolset.emitter.on('adopt', adopted.handler)
		await toolset.start()
		expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([...VIEW_TOOLS, 'lookup'])
		await registry.registry.registerTool({
			name: 'quote',
			description: 'Quotes a price',
			execute: async () => 'quote',
		})
		await waitForCondition('the toolset re-adopts on change', () =>
			adopted.calls.some(([tool]) => tool.name === 'quote'),
		)
		expect(toolset.tools.tool('quote')?.annotations).toMatchObject({ untrusted: true })
		expect(toolset.native.map((tool) => tool.name)).toEqual(VIEW_TOOLS)
		const own = registry.registrations()
		const published = createToolManager()
		for (const tool of toolset.native) published.add(tool)
		await bridge.publish(published)
		const registrations = registry.registrations()
		expect(registrations.map((entry) => entry.tool.name)).toEqual([
			'lookup',
			'quote',
			...VIEW_TOOLS,
		])
		expect(registrations.slice(0, 2)).toEqual(own)
		expect(registrations[0]).toBe(own[0])
		expect(registrations[1]).toBe(own[1])
		bridge.destroy()
		await toolset.destroy()
		expect(registry.registrations()).toEqual(own)
	})
})

describe('createSocketCDPTransport', () => {
	it('creates a socket transport that refuses to send before it starts', async () => {
		const transport = createSocketCDPTransport({ url: 'ws://127.0.0.1:9/devtools/browser/x' })
		expect(transport).toBeInstanceOf(SocketCDPTransport)
		await expect(transport.send('{}')).rejects.toThrow(/not open/)
	})
})
