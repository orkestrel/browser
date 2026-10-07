import type { ToolInterface } from '@orkestrel/tool'
import { renderBrowserLine } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_JOURNEY_TOOL_NAMES,
	createMemoryBrowserJourneyStore,
	createBrowserToolset,
	isBrowserError,
} from '@src/core'
import {
	BrowserDOMView,
	createBrowserDOMView,
	createSocketCDPTransport,
	SocketCDPTransport,
} from '@src/browser'
import { createTool, createToolManager } from '@orkestrel/tool'
import { createModelContext, isWebMCPDocument } from '@orkestrel/mcp/browser'
import {
	captureError,
	createRecorder,
	readProperty,
	requireValue,
	waitForCondition,
} from '@orkestrel/test'
import {
	createProbeBridge,
	createProbeDocument,
	createProbeElements,
	recordProbeSubscriptions,
} from '../../setupBrowser.js'

const VIEW_TOOLS = ['read', 'click', 'type', 'wait']

describe('createBrowserDOMView', () => {
	it('creates an untrusted view over a probe document', async () => {
		const probe = createProbeDocument('<title>Cart</title><button>Pay</button>')
		const view = createBrowserDOMView({ document: probe })
		expect(view).toBeInstanceOf(BrowserDOMView)
		expect(view.trusted).toBe(false)
		expect(await view.title()).toBe('Cart')
		expect((await view.elements.outline()).lines.map(renderBrowserLine).join('\n')).toContain(
			'e1 button "Pay"',
		)
	})

	it('refuses the realm own document unless own is true', () => {
		const refusal = captureError(() => createBrowserDOMView({ document: globalThis.document }))
		expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_OWN')
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

describe('createBrowserToolset over a document', () => {
	it('refuses globalThis.document unless own is true, and drives the iframe document', async () => {
		const refusal = captureError(() =>
			createBrowserToolset(createBrowserDOMView({ document: globalThis.document })),
		)
		expect(isBrowserError(refusal) && refusal.code).toBe('DOCUMENT_OWN')
		const ownView = createBrowserDOMView({ document: globalThis.document, own: true })
		const own = createBrowserToolset(ownView)
		expect(own.view.url).toBe(globalThis.document.URL)
		await own.destroy()
		ownView.destroy()
		const probe = await createProbeElements()
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView)
		expect(toolset.view).toBeInstanceOf(BrowserDOMView)
		expect(toolset.view.url).toBe(probe.document.URL)
		expect(toolset.view.trusted).toBe(false)
		await toolset.destroy()
		toolsetView.destroy()
	})

	it('keeps the caller-owned view alive after teardown and construction refusal', async () => {
		const probe = await createProbeElements()
		const window = requireValue(probe.document.defaultView, 'probe window')
		const subscriptions = recordProbeSubscriptions(window, 'pagehide')
		const view = createBrowserDOMView({ document: probe.document })
		try {
			for (let round = 0; round < 3; round += 1) {
				const toolset = createBrowserToolset(view)
				await toolset.start()
				const closing = toolset.destroy()
				expect(toolset.destroy()).toBe(closing)
				await closing
				expect((await view.read()).url).toBe(view.url)
			}
			const refusal = captureError(() => createBrowserToolset(view, { limit: 0 }))
			expect(isBrowserError(refusal) && refusal.code).toBe('TOOLSET_ARGUMENT')
			expect((await view.read()).url).toBe(view.url)
			expect(subscriptions.calls.map(([signal]) => signal?.aborted)).toEqual([false])
		} finally {
			view.destroy()
		}
		expect(subscriptions.calls.map(([signal]) => signal?.aborted)).toEqual([true])
		const ended = await view.read().catch((error: unknown) => error)
		expect(isBrowserError(ended) && ended.code).toBe('DOCUMENT_DESTROYED')
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
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView)
		await toolset.start()
		const signal = new AbortController().signal
		const reading = requireValue(toolset.tools.tool('read'), 'reading')
		const click = requireValue(toolset.tools.tool('click'), 'click')
		const type = requireValue(toolset.tools.tool('type'), 'type')
		await reading.execute({ from: 1 }, { signal })
		const [gift] = await toolset.view.elements.find({ role: 'checkbox', name: 'Gift wrap' })
		const [label] = await toolset.view.elements.find({ role: 'button', name: 'Terms' })
		const [note] = await toolset.view.elements.find({ role: 'textbox', name: 'Note' })
		const clicked = await click.execute({ ref: gift?.reference }, { signal })
		expect(Reflect.get(box ?? {}, 'checked')).toBe(true)
		expect(trusted.calls).toEqual([[false]])
		expect(clicked).toBe(
			`Clicked ${gift?.reference} checkbox "Gift wrap". (untrusted event)\n\n${String(await reading.execute({ from: 1 }, { signal }))}`,
		)
		const labelled = await click.execute({ ref: label?.reference }, { signal })
		expect(Reflect.get(terms ?? {}, 'checked')).toBe(true)
		expect(labelled).toBe(
			`Clicked ${label?.reference} button "Terms". (untrusted event)\n\n${String(await reading.execute({ from: 1 }, { signal }))}`,
		)
		const typed = await type.execute(
			{ ref: note?.reference, text: 'sam', submit: true },
			{ signal },
		)
		expect(submits.calls).toEqual([[true]])
		expect(typed).toBe(
			`Typed "sam" into ${note?.reference} textbox "Note" and submitted the form. (untrusted event)\n\n${String(await reading.execute({ from: 1 }, { signal }))}`,
		)
		await toolset.destroy()
		toolsetView.destroy()
	})

	it('refuses a button that claims the textbox role UNKNOWN without naming a reference refresh', async () => {
		const probe = createProbeDocument('<button role="textbox" aria-label="Search">Search</button>')
		const toolsetView = createBrowserDOMView({ document: probe })
		const toolset = createBrowserToolset(toolsetView)
		await toolset.start()
		const signal = new AbortController().signal
		const reading = String(
			await requireValue(toolset.tools.tool('read'), 'reading').execute(
				{ from: 1, search: 'search' },
				{ signal },
			),
		)
		const [search] = await toolset.view.elements.find({ role: 'textbox', name: 'Search' })
		expect(reading).toContain(`${search?.reference} textbox "Search"`)
		const refused = await Promise.resolve(
			requireValue(toolset.tools.tool('type'), 'type').execute(
				{ ref: search?.reference, text: 'kettle' },
				{ signal },
			),
		).catch((error: unknown) => error)
		expect(
			isBrowserError(refused) &&
				refused.code === 'ELEMENT' && { message: refused.message, context: refused.context },
		).toEqual({
			message: `Element ${search?.reference} is not a text control.`,
			context: { reference: search?.reference, reason: 'UNKNOWN' },
		})
		await toolset.destroy()
		toolsetView.destroy()
	})

	it('lists exactly the five view tools, reports GONE for a removed element, and wakes within 100 ms of a late element', async () => {
		const probe = await createProbeElements()
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView)
		await toolset.start()
		expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(VIEW_TOOLS)
		expect(toolset.native.map((tool) => tool.name)).toEqual(VIEW_TOOLS)
		const signal = new AbortController().signal
		await requireValue(toolset.tools.tool('read'), 'reading').execute(
			{ from: 1, search: 'save' },
			{ signal },
		)
		const [save] = await toolset.view.elements.find({ role: 'button', name: 'Save' })
		probe.save.remove()
		const gone = await Promise.resolve(
			requireValue(toolset.tools.tool('click'), 'click').execute(
				{ ref: save?.reference },
				{ signal },
			),
		).catch((error: unknown) => error)
		expect(isBrowserError(gone) && gone.code === 'ELEMENT' && gone.context).toEqual({
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
		expect(waited).toContain('"Late arrival" is on the page.\n\npage ')
		probe.late.textContent = ''
		expect(
			await requireValue(toolset.tools.tool('wait')).execute(
				{ text: 'Late arrival', absent: true },
				{ signal },
			),
		).toContain('"Late arrival" is not on the page.\n\npage ')
		const [[at] = [Number.NaN]] = appended.calls
		expect(resolved - at).toBeLessThan(100)
		await toolset.destroy()
		toolsetView.destroy()
	})

	it('adopts the source tools, re-adopts on change, keeps them out of native, and publishes native beside the registry own tools', async () => {
		const probe = await createProbeElements()
		const { registry, bridge } = createProbeBridge(probe.document)
		await registry.registry.registerTool({
			name: 'lookup',
			description: 'Looks up a car',
			annotations: { readOnlyHint: true },
			execute: async () => 'found',
		})
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView, { source: bridge })
		const adopted = createRecorder<[ToolInterface]>()
		toolset.emitter.on('adopt', adopted.handler)
		await toolset.start()
		expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([...VIEW_TOOLS, 'lookup'])
		expect(toolset.tools.tool('lookup')?.annotations).toMatchObject({ pure: true, untrusted: true })
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
		for (const native of toolset.native) {
			const descriptor = requireValue(
				registrations.find((entry) => entry.tool.name === native.name),
			).tool
			expect(descriptor.annotations?.readOnlyHint).toBe(native.annotations?.pure)
			expect(descriptor.annotations?.untrustedContentHint).toBe(native.annotations?.untrusted)
			expect(descriptor.annotations?.consequentialHint).toBe(native.annotations?.consequential)
		}
		bridge.destroy()
		await toolset.destroy()
		toolsetView.destroy()
		expect(registry.registrations()).toEqual(own)
	})

	it('constructs the journey tools with journeys, replays a recorded click untrusted, and destroys the view when they cannot be added', async () => {
		const probe = await createProbeElements()
		const clicks = createRecorder<[boolean]>()
		probe.save.addEventListener('click', (event) => clicks.handler(event.isTrusted))
		const store = createMemoryBrowserJourneyStore()
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView, { journeys: { store } })
		// The core toolset suite pins the journey vocabulary's members and order.
		expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(BROWSER_JOURNEY_TOOL_NAMES)
		await toolset.start()
		try {
			await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'save-draft' } })
			const [save] = await toolset.view.elements.find({ role: 'button', name: 'Save' })
			const reference = requireValue(save, 'save button').reference
			await toolset.tools.execute({ id: '2', name: 'click', arguments: { ref: reference } })
			expect(
				await toolset.tools.execute({
					id: '3',
					name: 'save',
					arguments: { description: 'Save the draft' },
				}),
			).toMatchObject({
				success: true,
				value:
					'Saved save-draft with 1 step.\n1: save-draft "Save the draft"\n2: s1 click button "Save"\n[lines 1–2 of 2; the whole listing]',
			})
			const replayed = await toolset.tools.execute({
				id: '4',
				name: 'replay',
				arguments: { journey: 'save-draft' },
			})
			expect(readProperty<string>(replayed, 'value').split('\n\n')[0]).toBe(
				`Replayed save-draft: 1 of 1 steps.\ns1 Clicked ${reference} button "Save". (untrusted event)`,
			)
			expect(clicks.calls).toEqual([[false], [false]])
		} finally {
			await toolset.destroy()
			toolsetView.destroy()
		}
		const window = requireValue(probe.document.defaultView, 'probe window')
		const subscriptions = recordProbeSubscriptions(window, 'pagehide')
		const tools = createToolManager()
		const held = createTool({ name: 'journeys', execute: () => 'held' })
		tools.add(held)
		const refusedView = createBrowserDOMView({ document: probe.document })
		const refusal = captureError(() =>
			createBrowserToolset(refusedView, { tools, journeys: { store } }),
		)
		expect(isBrowserError(refusal) && refusal.code).toBe('TOOLSET_RESERVED')
		expect(tools.tools()).toEqual([held])
		expect(subscriptions.calls.map(([signal]) => signal?.aborted)).toEqual([false])
		expect((await refusedView.read()).url).toBe(refusedView.url)
		refusedView.destroy()
		expect(subscriptions.calls.map(([signal]) => signal?.aborted)).toEqual([true])
	})
})

describe('document registry conformance', () => {
	it('asserts the document presence path and refuses a navigator registry', () => {
		const bridge = createModelContext({ document })
		try {
			expect(bridge !== undefined).toBe('modelContext' in document)
			expect('modelContext' in navigator).toBe(false)
		} finally {
			bridge?.destroy()
		}
	})

	it('marks a declarative form with a stable e5 reference and no autosubmit mark', async () => {
		const probe = await createProbeElements()
		probe.document.body.innerHTML =
			'<button>One</button><button>Two</button><button>Three</button><button>Four</button><form aria-label="Search cars" toolname="search-cars" toolautosubmit></form>'
		const toolsetView = createBrowserDOMView({ document: probe.document })
		const toolset = createBrowserToolset(toolsetView)
		try {
			const outline = await toolset.view.elements.outline()
			expect(outline.lines.map(renderBrowserLine).join('\n').split('\n')).toContain(
				'e5 form "Search cars" [tool=search-cars]',
			)
			expect(outline.lines.map(renderBrowserLine).join('\n')).not.toContain('autosubmit')
			expect((await toolset.view.elements.outline()).lines.map(renderBrowserLine).join('\n')).toBe(
				outline.lines.map(renderBrowserLine).join('\n'),
			)
		} finally {
			await toolset.destroy()
			toolsetView.destroy()
		}
	})
})

describe.runIf(isWebMCPDocument(document))('native document registry composition', () => {
	it('publishes the DOM descriptors, preserves page tools, adopts trusted hints, and re-adopts on toolchange', async () => {
		if (!isWebMCPDocument(document)) throw new Error('The native registry disappeared')
		const registry = document.modelContext
		const bridge = requireValue(createModelContext({ document }))
		const lifetime = new AbortController()
		const toolsetView = createBrowserDOMView({ document, own: true })
		const toolset = createBrowserToolset(toolsetView, { source: bridge })
		try {
			await registry.registerTool(
				{
					name: 'u17_lookup',
					description: 'Looks up a car',
					annotations: { readOnlyHint: true },
					execute: async () => 'found',
				},
				{ signal: lifetime.signal },
			)
			const existing = await registry.getTools()
			await toolset.start()
			expect(toolset.tools.tool('u17_lookup')?.annotations).toMatchObject({
				pure: true,
				untrusted: true,
			})
			const adopted = createRecorder<[ToolInterface]>()
			toolset.emitter.on('adopt', adopted.handler)
			await registry.registerTool(
				{ name: 'u17_quote', description: 'Quotes a car', execute: async () => 'quote' },
				{ signal: lifetime.signal },
			)
			await waitForCondition('native toolchange adoption', () =>
				adopted.calls.some(([tool]) => tool.name === 'u17_quote'),
			)
			const published = createToolManager()
			for (const tool of toolset.native) published.add(tool)
			expect(toolset.native.map((tool) => tool.name)).toEqual(VIEW_TOOLS)
			await bridge.publish(published)
			const registrations = await registry.getTools()
			expect(
				registrations
					.filter((tool) => VIEW_TOOLS.includes(tool.name))
					.map((tool) => tool.name)
					.sort(),
			).toEqual([...VIEW_TOOLS].sort())
			for (const native of toolset.native) {
				const registered = requireValue(registrations.find((tool) => tool.name === native.name))
				expect(registered.annotations?.readOnlyHint ?? false).toBe(
					native.annotations?.pure ?? false,
				)
				expect(registered.annotations?.untrustedContentHint ?? false).toBe(
					native.annotations?.untrusted ?? false,
				)
				expect(registered.annotations?.consequentialHint ?? false).toBe(
					native.annotations?.consequential ?? false,
				)
			}
			for (const tool of existing)
				expect(
					registrations.find((entry) => entry.name === tool.name && entry.origin === tool.origin),
				).toEqual(tool)
			bridge.destroy()
			const remaining = await registry.getTools()
			for (const tool of existing)
				expect(
					remaining.find((entry) => entry.name === tool.name && entry.origin === tool.origin),
				).toEqual(tool)
		} finally {
			bridge.destroy()
			await toolset.destroy()
			toolsetView.destroy()
			lifetime.abort()
		}
	})
})

describe('createSocketCDPTransport', () => {
	it('creates a socket transport that refuses to send before it starts', async () => {
		const transport = createSocketCDPTransport({ url: 'ws://127.0.0.1:9/devtools/browser/x' })
		expect(transport).toBeInstanceOf(SocketCDPTransport)
		await expect(transport.send('{}')).rejects.toThrow(/not open/)
	})
})
