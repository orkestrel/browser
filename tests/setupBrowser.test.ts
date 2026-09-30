import { describe, expect, it, inject } from 'vitest'
import { createBrowserDOMView } from '@src/browser'
import { createRecorder, requireValue, waitForEvent } from '@orkestrel/test'
import { createTool, createToolManager } from '@orkestrel/tool'
import { installModelContext } from './fixtures/modelContext.js'
import {
	createProbeBridge,
	createProbeDocument,
	createProbeElements,
	findProbeElement,
	loadProbeDocument,
	PROBE_PAGE,
	readBrowserFixtureBase,
	readNativeValue,
	readProbeCase,
} from './setupBrowser.js'

describe('readBrowserFixtureBase', () => {
	it('returns the origin the global setup injected', () => {
		expect(readBrowserFixtureBase()).toBe(inject('server'))
	})
})

describe('createProbeDocument', () => {
	let probe: Document | undefined

	it('builds a same-origin document holding the markup', () => {
		probe = createProbeDocument('<p id="mark">probe</p>')
		const frame = document.querySelector('iframe')
		expect(frame?.contentDocument).toBe(probe)
		expect(probe.getElementById('mark')?.textContent).toBe('probe')
		expect(probe.location.origin).toBe(window.location.origin)
	})

	it('removes the iframe after the test', () => {
		expect(probe).toBeDefined()
		expect(document.querySelector('iframe')).toBeNull()
	})
})

describe('loadProbeDocument', () => {
	it('loads the markup as a same-origin srcdoc document', async () => {
		const probe = await loadProbeDocument('<title>Loaded</title><p>ready</p>')
		expect(probe.URL).toBe('about:srcdoc')
		expect(probe.title).toBe('Loaded')
		expect(probe.defaultView?.origin).toBe(window.origin)
		expect(document.querySelectorAll('iframe')).toHaveLength(1)
	})

	it('removes the iframe after the test', () => {
		expect(document.querySelector('iframe')).toBeNull()
	})
})

describe('createProbeElements', () => {
	it('builds the probe page and returns its named elements', async () => {
		const probe = await createProbeElements()
		expect(probe.document.title).toBe('Probe')
		expect(probe.document.documentElement.outerHTML).toContain('Footer chrome nobody reads')
		expect(probe.frame).toBe(document.querySelector('iframe'))
		expect(probe.save.getAttribute('aria-label')).toBe('Save')
		expect(probe.email.name).toBe('email')
		expect(probe.one.textContent).toBe('One')
		expect(probe.late.id).toBe('late')
		expect(PROBE_PAGE).toContain('<button aria-label="Save">Save</button>')
	})
})

describe('readProbeCase', () => {
	it('returns the element the query names in a fresh probe document', () => {
		expect(readProbeCase('<b>x</b><i>y</i>', 'i').textContent).toBe('y')
		expect(() => readProbeCase('<b>x</b>', 'i')).toThrow('i')
	})
})

describe('findProbeElement', () => {
	it('returns the first element a CSS query matches and refuses a query matching nothing', async () => {
		const probe = await createProbeElements()
		const view = createBrowserDOMView({ document: probe.document })
		expect((await findProbeElement(view, 'nav a')).name).toBe('One')
		await expect(findProbeElement(view, 'table')).rejects.toThrow('element table')
	})
})

describe('readNativeValue', () => {
	it('reads the value past an own accessor on the element', async () => {
		const probe = await createProbeElements()
		probe.email.value = 'sam@example.test'
		Object.defineProperty(probe.email, 'value', { configurable: true, get: () => 'shadowed' })
		expect(probe.email.value).toBe('shadowed')
		expect(readNativeValue(probe.email)).toBe('sam@example.test')
	})
})

describe('createProbeBridge', () => {
	it('publishes a manager beside the registry own registrations and releases only its own', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const { registry, bridge } = createProbeBridge(probe)
		await registry.registry.registerTool({
			name: 'page-search',
			description: 'Searches the page',
			execute: async () => 'found',
		})
		const tools = createToolManager()
		tools.add(createTool({ name: 'cart-total', description: 'Totals the cart', execute: () => 48 }))
		await bridge.publish(tools)
		expect(registry.registrations().map((entry) => entry.tool.name)).toEqual([
			'page-search',
			'cart-total',
		])
		bridge.destroy()
		expect(registry.registrations().map((entry) => entry.tool.name)).toEqual(['page-search'])
	})

	it('adopts registered tools, filters debugging ones, and republishes toolchange', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const { registry, bridge } = createProbeBridge(probe)
		const changes = createRecorder<[]>()
		bridge.emitter.on('change', changes.handler)
		await registry.registry.registerTool({
			name: 'lookup',
			description: 'Looks up a car',
			annotations: { readOnlyHint: true },
			execute: async (input) => ({ make: input['make'] }),
		})
		await registry.registry.registerTool({
			name: 'quote',
			description: 'Quotes a price from page content',
			annotations: { untrustedContentHint: true, consequentialHint: true },
			execute: async () => 'quote',
		})
		await registry.registry.registerTool({
			name: 'inspect',
			description: 'Inspects the page state',
			annotations: { debugging: true },
			execute: async () => 'state',
		})
		expect(changes.count).toBe(3)
		const adopted = await bridge.adopt()
		expect(adopted.map((tool) => tool.name)).toEqual(['lookup', 'quote'])
		expect(adopted.map((tool) => tool.annotations)).toEqual([
			{ pure: true, untrusted: false, consequential: false },
			{ pure: false, untrusted: true, consequential: true },
		])
		expect((await bridge.adopt({ debugging: true })).map((tool) => tool.name)).toEqual([
			'inspect',
			'lookup',
			'quote',
		])
		bridge.destroy()
	})

	it('executes an adopted tool and republishes activation and cancellation', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const { registry, bridge } = createProbeBridge(probe)
		const activations = createRecorder<[string]>()
		const aborts = createRecorder<[string]>()
		bridge.emitter.on('activate', activations.handler)
		bridge.emitter.on('abort', aborts.handler)
		await registry.registry.registerTool({
			name: 'lookup',
			description: 'Looks up a car',
			execute: async (input) => ({ make: input['make'] }),
		})
		await registry.registry.registerTool({
			name: 'slow',
			description: 'Waits until aborted',
			execute: (_input, options) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener('abort', () => reject(options.signal.reason))
				}),
		})
		const [lookup, slow] = await bridge.adopt()
		const controller = new AbortController()
		expect(await lookup?.execute({ make: 'Volvo' }, { signal: controller.signal })).toBe(
			'{"make":"Volvo"}',
		)
		const pending = slow?.execute({}, { signal: controller.signal })
		controller.abort(new Error('stopped'))
		await expect(pending).rejects.toThrow('stopped')
		expect(activations.calls).toEqual([['lookup'], ['slow']])
		expect(aborts.calls).toEqual([['slow']])
		bridge.destroy()
	})
	it('adopts across a registration and a removal as each queued toolchange reports it', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const { registry, bridge } = createProbeBridge(probe)
		const controller = new AbortController()
		const registered = waitForEvent<[]>((listener) => {
			bridge.emitter.on('change', listener)
			return () => bridge.emitter.off('change', listener)
		}, 'bridge change on registration')
		await registry.registry.registerTool(
			{ name: 'lookup', description: 'Looks up a car', execute: async () => 'found' },
			{ signal: controller.signal },
		)
		await registered
		expect((await bridge.adopt()).map((tool) => tool.name)).toEqual(['lookup'])
		const removed = waitForEvent<[]>((listener) => {
			bridge.emitter.on('change', listener)
			return () => bridge.emitter.off('change', listener)
		}, 'bridge change on removal')
		controller.abort()
		await removed
		expect(await bridge.adopt()).toEqual([])
		bridge.destroy()
	})
})

describe('installModelContext', () => {
	it('refuses a duplicate, an invalid name, an empty description, and an untrustworthy origin', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const { registry } = installModelContext(probe)
		const execute = async (): Promise<string> => 'done'
		await registry.registerTool({ name: 'cars.search', description: 'Searches', execute })
		const refusals = await Promise.all(
			[
				registry.registerTool({ name: 'cars.search', description: 'Again', execute }),
				registry.registerTool({ name: 'cars search', description: 'Spaced', execute }),
				registry.registerTool({ name: 'x'.repeat(129), description: 'Long', execute }),
				registry.registerTool({ name: 'empty', description: '', execute }),
				registry.registerTool(
					{ name: 'exposed', description: 'Exposed', execute },
					{ exposedTo: ['http://example.test'] },
				),
				registry.registerTool(
					{ name: 'aborted', description: 'Aborted', execute },
					{ signal: AbortSignal.abort(new Error('early')) },
				),
			].map((attempt) =>
				attempt.then(
					() => 'registered',
					(error: unknown) => (error instanceof Error ? error.name : 'unknown'),
				),
			),
		)
		expect(refusals).toEqual([
			'InvalidStateError',
			'InvalidStateError',
			'InvalidStateError',
			'InvalidStateError',
			'SecurityError',
			'Error',
		])
	})

	it('reports registered tools sorted by name with the dictionary defaults', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		const execute = async (): Promise<string> => 'done'
		await fixture.registry.registerTool({
			name: 'zoom',
			description: 'Zooms',
			inputSchema: { type: 'object' },
			annotations: { debugging: true },
			execute,
		})
		await fixture.registry.registerTool({
			name: 'alpha',
			title: 'Alpha',
			description: 'First',
			execute,
		})
		const tools = await fixture.registry.getTools()
		expect(tools.map((tool) => tool.name)).toEqual(['alpha', 'zoom'])
		expect(tools[1]).toMatchObject({
			title: '',
			inputSchema: { type: 'object' },
			origin: fixture.origin,
			annotations: {
				readOnlyHint: false,
				untrustedContentHint: false,
				consequentialHint: false,
				debugging: true,
			},
		})
		expect(tools[1]?.window).toBe(probe.defaultView)
		expect(tools[0]?.annotations).toBeUndefined()
		expect(fixture.origin).toBe(window.origin)
		await expect(
			fixture.registry.getTools({ fromOrigins: ['http://example.test'] }),
		).rejects.toThrow(/potentially trustworthy/)
	})

	it('queues toolchange as a task: after registerTool returns and before its promise settles', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		const order = createRecorder<[string]>()
		fixture.registry.addEventListener('toolchange', () => order.handler('toolchange'))
		const registering = fixture.registry.registerTool({
			name: 'lookup',
			description: 'Looks up a car',
			execute: async () => 'found',
		})
		order.handler('returned')
		queueMicrotask(() => order.handler('microtask'))
		await registering
		order.handler('settled')
		expect(order.calls).toEqual([['returned'], ['microtask'], ['toolchange'], ['settled']])
	})

	it('rejects a pending registration aborted at once with the reason and unregisters it', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		const controller = new AbortController()
		const registering = fixture.registry.registerTool(
			{ name: 'lookup', description: 'Looks up a car', execute: async () => 'found' },
			{ signal: controller.signal },
		)
		controller.abort(new Error('withdrawn'))
		await expect(registering).rejects.toThrow('withdrawn')
		expect(fixture.registrations()).toEqual([])
	})

	it('rejects a pending registration aborted from the first toolchange listener', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		const controller = new AbortController()
		const withdrawn = new Error('withdrawn')
		fixture.registry.addEventListener('toolchange', () => controller.abort(withdrawn), {
			once: true,
		})
		const registering = fixture.registry.registerTool(
			{ name: 'lookup', description: 'Looks up a car', execute: async () => 'found' },
			{ signal: controller.signal },
		)
		await expect(registering).rejects.toThrow('withdrawn')
		expect(fixture.registrations()).toEqual([])
	})

	it('unregisters on the registration signal and dispatches toolchange to handler attributes', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		const changes = createRecorder<[string]>()
		fixture.registry.ontoolchange = (event) => changes.handler(event.type)
		const controller = new AbortController()
		await fixture.registry.registerTool(
			{ name: 'temporary', description: 'Temporary', execute: async () => 'done' },
			{ signal: controller.signal },
		)
		const removed = waitForEvent<[Event]>((listener) => {
			fixture.registry.addEventListener('toolchange', listener)
			return () => fixture.registry.removeEventListener('toolchange', listener)
		}, 'toolchange on removal')
		controller.abort()
		expect(fixture.registrations()).toEqual([])
		expect(changes.calls).toEqual([['toolchange']])
		await removed
		expect(changes.calls).toEqual([['toolchange'], ['toolchange']])
		const handler = fixture.registry.ontoolchange
		fixture.registry.ontoolchange = null
		expect(fixture.listeners()).not.toContain(handler)
	})

	it('dispatches toolactivated and rejects an unknown tool or an unserializable result', async () => {
		const probe = await loadProbeDocument('<p>host</p>')
		const fixture = installModelContext(probe)
		await fixture.registry.registerTool({
			name: 'nothing',
			description: 'Returns nothing',
			execute: async () => undefined,
		})
		const [nothing] = await fixture.registry.getTools()
		if (nothing === undefined) throw new Error('the registry reports no tool')
		const activated = waitForEvent<[Event]>((listener) => {
			fixture.registry.addEventListener('toolactivated', listener)
			return () => fixture.registry.removeEventListener('toolactivated', listener)
		}, 'toolactivated')
		await expect(fixture.registry.executeTool(nothing)).rejects.toThrow('did not complete')
		const [event] = await activated
		expect(Reflect.get(event, 'toolName')).toBe('nothing')
		await fixture.registry.registerTool({
			name: 'bigint',
			description: 'Returns a BigInt',
			execute: async () => 1n,
		})
		const bigint = (await fixture.registry.getTools()).find((tool) => tool.name === 'bigint')
		const unserializable = await fixture.registry
			.executeTool(requireValue(bigint, 'bigint tool'))
			.catch((error: unknown) => error)
		expect(unserializable instanceof DOMException && unserializable.name).toBe('UnknownError')
		await expect(fixture.registry.executeTool({ ...nothing, name: 'missing' })).rejects.toThrow(
			"No registered tool named 'missing'",
		)
		await expect(fixture.registry.executeTool({ ...nothing, origin: 'not a url' })).rejects.toThrow(
			'not a tuple origin',
		)
	})
})
