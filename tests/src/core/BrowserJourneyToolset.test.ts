import type {
	BrowserJourney,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
} from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { BrowserJourneyToolset } from '../../../src/core/BrowserJourneyToolset.js'
import { describe, expect, it } from 'vitest'
import { createContract, schemaToShape } from '@orkestrel/contract'
import { createTool, createToolManager } from '@orkestrel/tool'
import {
	captureError,
	createRecorder,
	readProperty,
	requireValue,
	waitForAbort,
	waitForCondition,
} from '@orkestrel/test'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BrowserError,
	BrowserReplay,
	BrowserToolset,
	MemoryBrowserRunStore,
	createBrowserToolset,
	createMemoryBrowserJourneyStore,
} from '@src/core'
import {
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_JOURNEY_EDIT_SHAPES,
	BROWSER_STORE_FAULT_FIXTURE,
	BROWSER_PREPARATION_CASES,
	BROWSER_JOURNEY_LISTING,
	BROWSER_RUN_FIXTURE,
	createBrowserActionFixture,
	createBrowserElementFixture,
	emitBrowserNavigation,
	createBrowserFailingJourneyStore,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
	createBrowserPendingToolsetFixture,
	ignoreCall,
	buildBrowserReferenceTree,
	BROWSER_STABLE_REFERENCE_ELEMENTS,
} from '../../setup.js'

describe('BrowserJourneyToolset', () => {
	it('stable links: edits with a carried link and refuses a gone reference by its last name', async () => {
		let navigated = false
		const fixture = await createBrowserElementFixture({
			local: true,
			accessibility: (message) =>
				fixture.transport.reply(
					message.id,
					buildBrowserReferenceTree(
						navigated
							? BROWSER_STABLE_REFERENCE_ELEMENTS.slice(0, 3)
							: BROWSER_STABLE_REFERENCE_ELEMENTS,
					),
				),
		})
		const store = createMemoryBrowserJourneyStore()
		await store.set(
			createBrowserJourneyFixture([
				{ action: 'click', arguments: {}, target: { role: 'link', name: 'Checkout' } },
			]),
		)
		const toolset = createBrowserToolset(fixture.page, { journeys: { store } })
		try {
			await toolset.start()
			expect(await toolset.read()).toContain('searchbox "Search products" [ref=e4]')
			navigated = true
			emitBrowserNavigation(
				fixture.transport,
				'session-main',
				'main',
				'https://example.test/product',
				'product',
			)
			expect(await toolset.read()).toContain('link "Checkout" [ref=e3]')
			const edit = requireValue(toolset.tools.tool('edit'))
			const context = { signal: new AbortController().signal }
			await edit.execute(
				{ journey: 'check-ready', edits: [{ operation: 'update', id: 's1', ref: 'e3' }] },
				context,
			)
			expect((await store.get('check-ready'))?.journey.steps[0]?.target).toEqual({
				role: 'link',
				name: 'Checkout',
				reference: 'e3',
			})
			await expect(
				edit.execute(
					{ journey: 'check-ready', edits: [{ operation: 'update', id: 's1', ref: 'e4' }] },
					context,
				),
			).rejects.toMatchObject({
				message:
					'Element e4 (searchbox "Search products") is not on this page; use a reference from the latest result.',
			})
			await expect(
				edit.execute(
					{ journey: 'check-ready', edits: [{ operation: 'update', id: 's1', ref: 'e99' }] },
					context,
				),
			).rejects.toMatchObject({
				message: 'Element [ref=e99] is not in the current view; call read for fresh refs.',
			})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('small refusals: keeps the recording through empty save and repeated record calls', async () => {
		const store = createMemoryBrowserJourneyStore()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			const context = { signal: new AbortController().signal }
			const record = requireValue(toolset.tools.tool('record'))
			const save = requireValue(toolset.tools.tool('save'))
			await record.execute({ journey: 'check-ready' }, context)
			await expect(save.execute({ description: 'Check readiness' }, context)).rejects.toMatchObject(
				{
					code: 'JOURNEY_EMPTY',
					message:
						"Nothing is recorded for check-ready yet, and it is still recording. Click and type the flow's steps now, then call save.",
				},
			)
			await expect(record.execute({ journey: 'check-ready' }, context)).rejects.toMatchObject({
				code: 'JOURNEY_RECORDING',
				message:
					"check-ready is already recording and has no steps yet. Click and type the flow's steps now, then call save.",
			})
			expect(journeys.recording).toBe('check-ready')
			expect(await store.get('check-ready')).toBeUndefined()
			for (const count of [1, 2]) {
				await toolset.execute({ id: String(count), name: 'wait', arguments: { text: 'Ready' } })
				await expect(record.execute({ journey: 'check-ready' }, context)).rejects.toMatchObject({
					code: 'JOURNEY_RECORDING',
					message: `check-ready is already recording with ${count} ${count === 1 ? 'step' : 'steps'}; call save when the flow is done.`,
				})
			}
			await expect(record.execute({ journey: 'other-flow' }, context)).rejects.toMatchObject({
				code: 'JOURNEY_RECORDING',
				message: 'check-ready is recording; call save before you record another.',
			})
			await save.execute({ description: 'Check readiness' }, context)
			expect((await store.get('check-ready'))?.journey.steps).toHaveLength(2)
			expect(await store.get('other-flow')).toBeUndefined()
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('small model: edit without journey refuses with none saved', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble(), {
			journeys: { store: createMemoryBrowserJourneyStore() },
		})
		await toolset.start()
		try {
			const context = { signal: new AbortController().signal }
			const edit = requireValue(toolset.tools.tool('edit'))
			await expect(edit.execute({ edits: [] }, context)).rejects.toMatchObject({
				code: 'ARGUMENT',
				message: 'No journey is saved, so there is nothing to edit; call record to start one.',
				context: { subject: 'toolset', key: 'journey' },
			})
		} finally {
			await toolset.destroy()
		}
	})
	it('small model: edit without journey edits the only saved journey', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble(), { journeys: { store } })
		await toolset.start()
		try {
			const context = { signal: new AbortController().signal }
			const edit = requireValue(toolset.tools.tool('edit'))
			for (const args of [{}, { journey: undefined }]) {
				const results = await toolset.tools.execute([
					{
						id: 'edit-only',
						name: 'edit',
						arguments: {
							...args,
							edits: [{ operation: 'update', id: 's1', arguments: { text: 'Changed' } }],
						},
					},
				])
				expect(readProperty(results[0], 'value')).toContain('Edited check-ready.')
				expect((await store.get('check-ready'))?.journey.steps[0]?.arguments).toEqual({
					text: 'Changed',
				})
			}
			for (const journey of [null, 7, false])
				await expect(edit.execute({ journey, edits: [] }, context)).rejects.toMatchObject({
					code: 'ARGUMENT',
					message: 'The journey parameter must be a string.',
				})
		} finally {
			await toolset.destroy()
		}
	})
	it('small model: edit without journey refuses naming both saved journeys', async () => {
		const store = createMemoryBrowserJourneyStore()
		for (const name of ['first-flow', 'last-flow'])
			await store.set({ ...createBrowserJourneyFixture(), name })
		const toolset = new BrowserToolset(createBrowserViewDouble(), { journeys: { store } })
		await toolset.start()
		try {
			await expect(
				requireValue(toolset.tools.tool('edit')).execute(
					{ edits: [{ operation: 'update', id: 's1', arguments: { text: 'Changed' } }] },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({
				code: 'ARGUMENT',
				message:
					'Edit requires journey, one of "first-flow", "last-flow"; call edit with that name beside edits.',
				context: { subject: 'toolset', key: 'journey' },
			})
			for (const name of ['first-flow', 'last-flow'])
				expect((await store.get(name))?.revision).toBe(1)
		} finally {
			await toolset.destroy()
		}
	})
	it('small refusals: journeys defaults to line 1 and parses decimal coordinates', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(
			createBrowserJourneyFixture(
				Array.from({ length: 8 }, () => ({ action: 'wait', arguments: { text: 'Ready' } })),
			),
		)
		const toolset = new BrowserToolset(createBrowserViewDouble(), { journeys: { store } })
		try {
			const tool = requireValue(toolset.tools.tool('journeys'))
			const context = { signal: new AbortController().signal }
			expect(await tool.execute({}, context)).toBe(await tool.execute({ from: 1 }, context))
			expect(await tool.execute({}, context)).toContain('\n1: ')
			expect(await tool.execute({ from: '7', to: '7' }, context)).toBe(
				await tool.execute({ from: 7, to: 7 }, context),
			)
			expect(await tool.execute({ from: '7', to: '7' }, context)).toContain('\n7: ')
			for (const key of ['from', 'to'])
				for (const value of ['7a', '1.5', '-1', '', '07', null])
					await expect(tool.execute({ [key]: value }, context)).rejects.toMatchObject({
						code: 'ARGUMENT',
						message:
							'Journeys requires an integer from, an optional integer to, and optional search text.',
					})
		} finally {
			await toolset.destroy()
		}
	})
	it('journey start: records the first action page, not the record or destination page', async () => {
		const fixture = await createBrowserElementFixture({
			evaluation: (message) =>
				fixture.transport.reply(message.id, { result: { value: fixture.page.url } }),
		})
		const store = createMemoryBrowserJourneyStore()
		const toolset = createBrowserToolset(fixture.page, { journeys: { store } })
		try {
			await toolset.start()
			await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'open-cart' },
			})
			emitBrowserNavigation(
				fixture.transport,
				'session-main',
				'main',
				'https://example.test/catalogue',
				'catalogue',
			)
			await toolset.read()
			fixture.transport.onSend('Page.navigate', (message) => {
				fixture.transport.reply(message.id, { frameId: 'main', loaderId: 'checkout' })
				emitBrowserNavigation(
					fixture.transport,
					'session-main',
					'main',
					'https://example.test/checkout',
					'checkout',
				)
				fixture.transport.event('Page.loadEventFired', { timestamp: 1 }, 'session-main')
			})
			const action = await toolset.execute({
				id: 'go',
				name: 'navigate',
				arguments: { url: 'https://example.test/checkout' },
			})
			expect(action.action?.outcome).toBe('done')
			const saved = await toolset.tools.execute({
				id: 'save',
				name: 'save',
				arguments: { description: 'Open the cart' },
			})
			expect(saved.success).toBe(true)
			expect((await store.get('open-cart'))?.journey.start).toBe('https://example.test/catalogue')
			expect(readProperty(saved, 'value')).toContain(
				'1: open-cart "Open the cart" starts at https://example.test/catalogue',
			)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('journey start: omits an about: page and redacts a secret before storage', async () => {
		const secret = 'https://example.test/?token=journey-secret'
		const recorded = new Map<
			string,
			{ readonly journey: BrowserJourney; readonly redacted: string }
		>()
		for (const url of ['about:blank', 'about:srcdoc', secret]) {
			const store = createMemoryBrowserJourneyStore()
			const toolset = createBrowserToolset(createBrowserViewDouble({ url }), {
				journeys: { store },
			})
			try {
				await toolset.start()
				await toolset.tools.execute({
					id: 'record',
					name: 'record',
					arguments: { journey: 'sign-in' },
				})
				await toolset.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
				const typed = await toolset.execute({
					id: 'secret',
					name: 'type',
					arguments: { ref: 42, text: 'journey-secret', secret: true },
				})
				expect(typed.result.success).toBe(false)
				expect(JSON.stringify(typed.action)).not.toContain('journey-secret')
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Sign in' },
				})
				const journey = requireValue(await store.get('sign-in')).journey
				recorded.set(url, { journey, redacted: toolset.redact(url) })
			} finally {
				await toolset.destroy()
			}
		}
		expect(requireValue(recorded.get('about:blank')).journey).not.toHaveProperty('start')
		expect(requireValue(recorded.get('about:srcdoc')).journey).not.toHaveProperty('start')
		const redacted = requireValue(recorded.get(secret))
		expect(redacted.journey.start).toBe(redacted.redacted)
		expect(JSON.stringify(redacted.journey)).not.toContain('journey-secret')
	})
	it('audit repair 11: listing search shares singular, capped matches and ranged misses with read', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture([{ action: 'wait', arguments: { text: 'Ready' } }]))
		const toolset = new BrowserToolset(createBrowserViewDouble(), { journeys: { store } })
		try {
			const tool = requireValue(toolset.tools.tool('journeys'))
			const context = { signal: new AbortController().signal }
			const hit = await tool.execute({ from: 1, search: 'check' }, context)
			expect(hit).toContain('1 line matches "check": 1')
			expect(hit).toContain('the whole listing]')
			const miss = await tool.execute({ from: 2, search: 'Missing' }, context)
			expect(miss).toContain('No line from 2 on matches "Missing".')
			expect(miss).toContain('end of listing]')
			for (let index = 0; index < 60; index += 1)
				await store.set({
					...createBrowserJourneyFixture([{ action: 'wait', arguments: { text: 'Ready' } }]),
					name: 'cedar-' + index,
				})
			const many = await tool.execute({ from: 1, search: 'cedar' }, context)
			expect(many).toContain('60 lines match "cedar"')
			expect(many).toContain('and 10 more; add words to narrow')
		} finally {
			await toolset.destroy()
		}
	})
	it('capture refuses an untrusted view with a coded error', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble(), {
			journeys: { store: createMemoryBrowserJourneyStore(), runs: new MemoryBrowserRunStore() },
		})
		try {
			await expect(
				requireValue(toolset.tools.tool('capture')).execute(
					{ full: false },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({ code: 'CAPTURE_UNTRUSTED' })
		} finally {
			await toolset.destroy()
		}
	})
	it('capture requires a boolean and refuses stores without standalone storage before requesting a screenshot', async () => {
		const fixture = await createBrowserElementFixture()
		try {
			for (const runs of [undefined, new MemoryBrowserRunStore()]) {
				const toolset = createBrowserToolset(fixture.page, {
					journeys: {
						store: createMemoryBrowserJourneyStore(),
						...(runs === undefined ? {} : { runs }),
					},
				})
				try {
					const tool = requireValue(toolset.tools.tool('capture'))
					const context = { signal: new AbortController().signal }
					for (const args of [{}, { full: 'false' }, { full: 0 }])
						await expect(tool.execute(args, context)).rejects.toMatchObject({
							code: 'ARGUMENT',
						})
					await expect(tool.execute({ full: false }, context)).rejects.toMatchObject({
						code: 'CAPTURE_UNAVAILABLE',
					})
					const reason = new Error('Capture aborted')
					await expect(
						tool.execute({ full: false }, { signal: AbortSignal.abort(reason) }),
					).rejects.toBe(reason)
					const hold = await toolset.hold('check-ready')
					try {
						await expect(tool.execute({ full: false }, context)).rejects.toMatchObject({
							code: 'TOOLSET_BUSY',
						})
					} finally {
						hold.destroy()
					}
					expect(
						fixture.transport.sent.some((message) => message.method === 'Page.captureScreenshot'),
					).toBe(false)
				} finally {
					await toolset.destroy()
				}
			}
		} finally {
			await fixture.client.close()
		}
	})
	it('adds and lists an absent wait and refuses malformed absence', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			const edited = await toolset.tools.execute({
				id: 'add',
				name: 'edit',
				arguments: {
					journey: 'check-ready',
					edits: [
						{
							operation: 'add',
							step: { action: 'wait', arguments: { text: 'Saved', absent: true } },
						},
					],
				},
			})
			expect(readProperty(edited, 'value')).toContain('s2 wait "Saved", absent')
			const refused = await toolset.tools.execute({
				id: 'bad',
				name: 'edit',
				arguments: {
					journey: 'check-ready',
					edits: [
						{
							operation: 'add',
							step: { action: 'wait', arguments: { text: 'Saved', absent: 'yes' } },
						},
					],
				},
			})
			expect(readProperty(refused, 'success')).toBe(false)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('searches numbered journey lines and respects the requested start', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(
			createBrowserJourneyFixture(undefined, { name: 'alpha', description: 'Ordinary route' }),
		)
		await store.set(
			createBrowserJourneyFixture(undefined, {
				name: 'delivery',
				description: 'Delivery schedule',
			}),
		)
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			const tool = requireValue(toolset.tools.tool('journeys'))
			const context = { signal: new AbortController().signal }
			expect(await tool.execute({ from: 1, search: 'deliver schedule' }, context)).toContain(
				'1 line matches "deliver schedule": 3',
			)
			const result = String(await tool.execute({ from: 3, to: 3 }, context))
			expect(result).toContain('3: delivery "Delivery schedule"')
			expect(result).toContain('call journeys with from 4 for more')
			expect(result).not.toContain('2: ')
			expect(await tool.execute({ from: 1, search: 'Ready' }, context)).toContain(
				'2 lines match "Ready": 2, 4',
			)
			await expect(tool.execute({ from: 0 }, context)).rejects.toMatchObject({
				code: 'ARGUMENT',
			})
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})

	it('l2a refuses forget on read-only journeys before touching the saved journey or runs', async () => {
		const store = createMemoryBrowserJourneyStore()
		const runs = new MemoryBrowserRunStore()
		const saved = await store.set(BROWSER_JOURNEY_FIXTURE)
		const slot = await runs.create(saved.journey.name)
		await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store, runs, readonly: true })
		try {
			expect(
				await toolset.tools.execute({
					id: 'forget',
					name: 'forget',
					arguments: { journey: saved.journey.name },
				}),
				'l2a: read-only forget is refused',
			).toMatchObject({ success: false, error: 'The journeys are read-only; call replay.' })
			await expect(
				requireValue(toolset.tools.tool('forget')).execute(
					{ journey: saved.journey.name },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({ code: 'JOURNEY_READONLY' })
			expect(await store.get(saved.journey.name)).toEqual(saved)
			expect((await runs.list(saved.journey.name)).entries.map((run) => run.id)).toEqual([slot.id])
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('l2b forget removes every run and preserves other journeys', async () => {
		const store = createMemoryBrowserJourneyStore()
		const runs = new MemoryBrowserRunStore()
		await store.set(BROWSER_JOURNEY_FIXTURE)
		const sibling = await store.set(createBrowserJourneyFixture())
		const first = await runs.create('add-kettle')
		await runs.set({ ...BROWSER_RUN_FIXTURE, id: first.id })
		const unsaved = await runs.create('add-kettle')
		const other = await runs.create('check-ready')
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store, runs })
		try {
			const result = await toolset.tools.execute({
				id: 'forget',
				name: 'forget',
				arguments: { journey: 'add-kettle' },
			})
			expect((await runs.list('add-kettle')).entries, 'l2b: forget leaves no runs').toEqual([])
			expect(result).toMatchObject({
				success: true,
				value: 'Forgot add-kettle and its 2 runs; the name is free to record again.',
			})
			expect(await store.get('add-kettle')).toBeUndefined()
			await expect(runs.set({ ...BROWSER_RUN_FIXTURE, id: unsaved.id })).rejects.toMatchObject({
				code: 'STORE_PATH',
			})
			expect(await store.get('check-ready')).toEqual(sibling)
			await expect(runs.capture(other, 's1.png', new Uint8Array())).resolves.toBeUndefined()
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('l2c record succeeds after forget and save continues the revision counter', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			expect(
				await toolset.tools.execute({
					id: 'forget',
					name: 'forget',
					arguments: { journey: 'check-ready' },
				}),
			).toMatchObject({
				success: true,
				value: 'Forgot check-ready and its 0 runs; the name is free to record again.',
			})
			expect(
				await toolset.tools.execute({
					id: 'record',
					name: 'record',
					arguments: { journey: 'check-ready' },
				}),
				'l2c: record after forget starts a recording',
			).toMatchObject({ success: true, value: expect.stringContaining('Recording check-ready;') })
			expect(journeys.recording).toBe('check-ready')
			await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
			await toolset.tools.execute({
				id: 'save',
				name: 'save',
				arguments: { description: 'Check again' },
			})
			expect((await store.get('check-ready'))?.revision).toBe(2)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('forget refuses missing and recording names with coded errors and rendered sentences', async () => {
		const store = createMemoryBrowserJourneyStore()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			const forget = requireValue(toolset.tools.tool('forget'))
			await expect(
				forget.execute({ journey: 'check-ready' }, { signal: new AbortController().signal }),
			).rejects.toMatchObject({ code: 'JOURNEY_MISSING' })
			expect(
				await toolset.tools.execute({
					id: 'missing',
					name: 'forget',
					arguments: { journey: 'check-ready' },
				}),
			).toMatchObject({
				success: false,
				error: 'No journey is named "check-ready"; call journeys.',
			})
			await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'check-ready' },
			})
			await expect(
				forget.execute({ journey: 'check-ready' }, { signal: new AbortController().signal }),
			).rejects.toMatchObject({ code: 'JOURNEY_RECORDING' })
			expect(
				await toolset.tools.execute({
					id: 'recording',
					name: 'forget',
					arguments: { journey: 'check-ready' },
				}),
			).toMatchObject({
				success: false,
				error: 'Journey "check-ready" is recording; call save first, or record another name.',
			})
			expect(journeys.recording).toBe('check-ready')
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('forget refuses while a replay holds the toolset', async () => {
		const store = createMemoryBrowserJourneyStore()
		const saved = await store.set(
			createBrowserJourneyFixture([{ action: 'checkout', arguments: {} }]),
		)
		const { toolset, pending } = createBrowserPendingToolsetFixture()
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		const replay = toolset.tools.execute({
			id: 'replay',
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		try {
			await waitForCondition('replay holds the toolset', () => toolset.held === 'check-ready')
			await expect(
				requireValue(toolset.tools.tool('forget')).execute(
					{ journey: 'check-ready' },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({ code: 'TOOLSET_BUSY' })
			expect(
				await toolset.tools.execute({
					id: 'forget',
					name: 'forget',
					arguments: { journey: 'check-ready' },
				}),
			).toMatchObject({
				success: false,
				error: 'The toolset is replaying check-ready until it finishes; call read.',
			})
			expect(await store.get('check-ready')).toEqual(saved)
		} finally {
			pending.resolve('Checked out.')
			await replay
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('k3b advertises edits as an array with an item schema or a JSON string', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, {
			store: createMemoryBrowserJourneyStore(),
		})
		try {
			const parameters = requireValue(toolset.tools.tool('edit')?.parameters)
			const edits = readProperty(readProperty(parameters, 'properties'), 'edits')
			expect(
				edits,
				'k3b: edits advertises anyOf and preserves its array item schema',
			).toMatchObject({
				description:
					'The changes, as an array or its JSON string, applied in order; one invalid change refuses them all.',
				anyOf: [
					{
						type: 'array',
						items: {
							type: 'object',
							properties: {
								operation: { type: 'string', enum: ['add', 'remove', 'update', 'declare'] },
								id: { type: 'string' },
								step: { type: 'object' },
								before: { type: 'string' },
								after: { type: 'string' },
								ref: { type: 'string' },
								arguments: { type: 'object' },
								name: { type: 'string' },
								parameter: { type: 'object' },
							},
							required: ['operation'],
						},
					},
					{ type: 'string' },
				],
			})
			expect(edits).not.toHaveProperty('type')
			const contract = createContract(schemaToShape(parameters))
			expect(
				contract.is({ edits: [{ operation: 'update', id: 's1', arguments: { text: 'Changed' } }] }),
			).toBe(true)
			expect(contract.is({})).toBe(false)
			expect(readProperty(readProperty(parameters, 'properties'), 'journey')).toEqual({
				type: 'string',
				description: 'The journey name, such as add-kettle. Default: the only saved journey.',
			})
			expect(
				contract.is({ journey: 'check-ready', edits: [{ operation: 'remove', id: 's1' }] }),
			).toBe(true)
			expect(
				contract.is({ journey: 'check-ready', edits: '[{"operation":"remove","id":"s1"}]' }),
			).toBe(true)
			expect(contract.is({ journey: 'check-ready', edits: 3 })).toBe(false)
			expect(contract.is({ journey: 'check-ready', edits: [{ id: 's1' }] })).toBe(false)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it.each(BROWSER_JOURNEY_EDIT_SHAPES)(
		'names the malformed edit field for %j',
		async (edit, reason) => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(createBrowserJourneyFixture())
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			try {
				expect(
					await toolset.tools.execute({
						id: 'edit',
						name: 'edit',
						arguments: { journey: 'check-ready', edits: [edit] },
					}),
				).toMatchObject({
					success: false,
					error: `Edit 1 is refused: ${reason.startsWith('its ') ? reason : `it ${reason}`}; call journeys.`,
				})
				expect((await store.get('check-ready'))?.revision).toBe(1)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		},
	)
	it('k1a refuses an empty save, keeps recording, and directs calls after saving', async () => {
		const store = createMemoryBrowserJourneyStore()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'check-ready' },
			})
			expect(
				await toolset.tools.execute({
					id: 'empty-save',
					name: 'save',
					arguments: { description: 'Check readiness' },
				}),
				'k1a: empty recordings are refused before a store write',
			).toMatchObject({
				success: false,
				error:
					"Nothing is recorded for check-ready yet, and it is still recording. Click and type the flow's steps now, then call save.",
			})
			expect(journeys.recording).toBe('check-ready')
			expect(await store.get('check-ready')).toBeUndefined()
			await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
			expect(
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Check readiness' },
				}),
			).toMatchObject({
				success: true,
				value: expect.stringContaining('Saved check-ready with 1 step.'),
			})
			const results = await toolset.tools.execute([
				{ id: 'record', name: 'record', arguments: { journey: 'check-ready' } },
				{ id: 'save', name: 'save', arguments: { description: 'Check readiness' } },
			])
			expect(results.map((result) => readProperty(result, 'error'))).toEqual([
				'Journey "check-ready" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.',
				'Nothing is recording, so there is nothing to save; "check-ready" is already saved. Answer the user.',
			])
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('k1b omits a timed-out wait so the saved journey replays', async () => {
		const store = createMemoryBrowserJourneyStore()
		const { toolset, pending } = createBrowserPendingToolsetFixture({
			waited: false,
			url: 'about:blank',
		})
		pending.resolve('Checked out.')
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'check-form' },
			})
			const waited = await toolset.execute({
				id: 'wait',
				name: 'wait',
				arguments: { text: 'Never appears', timeout: 1 },
			})
			expect(waited.action?.outcome).toBe('timeout')
			await toolset.tools.execute({ id: 'checkout', name: 'checkout', arguments: {} })
			expect(
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Check the form' },
				}),
			).toMatchObject({ success: true })
			expect(
				(await store.get('check-form'))?.journey.steps.map((step) => step.action),
				'k1b: a timeout contributes no step',
			).toEqual(['checkout'])
			expect(
				await toolset.tools.execute({
					id: 'replay',
					name: 'replay',
					arguments: { journey: 'check-form' },
				}),
			).toMatchObject({
				success: true,
				value: expect.stringContaining('Replayed check-form: 1 of 1 steps.'),
			})
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('k1c parses a JSON edits string and names a JSON parse error', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			expect(
				await toolset.tools.execute({
					id: 'edit',
					name: 'edit',
					arguments: {
						journey: 'check-ready',
						edits: '[{"operation":"update","id":"s1","arguments":{"text":"Saved"}}]',
					},
				}),
				'k1c: edits accepts a JSON string of the array',
			).toMatchObject({ success: true, value: expect.stringContaining('s1 wait "Saved"') })
			const refused = await toolset.tools.execute({
				id: 'edit',
				name: 'edit',
				arguments: { journey: 'check-ready', edits: '[' },
			})
			expect(readProperty(refused, 'error')).toBe(
				'The edits parameter is not valid JSON: Unexpected end of JSON input; pass an array or a JSON string of the array.',
			)
			expect((await store.get('check-ready'))?.revision).toBe(2)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('h2c renders structured faults without scraping the reason and deduplicates names', async () => {
		const memory = createMemoryBrowserJourneyStore()
		const store: BrowserJourneyStoreInterface = {
			get: memory.get.bind(memory),
			set: memory.set.bind(memory),
			delete: memory.delete.bind(memory),
			list: async () => ({
				entries: [],
				truncated: false,
				faults: [BROWSER_STORE_FAULT_FIXTURE, BROWSER_STORE_FAULT_FIXTURE],
			}),
		}
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			expect(
				await toolset.tools.execute({
					id: 'listing',
					name: 'journeys',
					arguments: { from: 1 },
				}),
				'h2c: the store reason is rendered verbatim once',
			).toMatchObject({
				success: true,
				value:
					'journeys (1 lines)\n1: broken-journey cannot be read: The read/write mode is unsupported\n[lines 1–1 of 1; the whole listing]',
			})
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('releases a refused recording reservation before another name starts', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			const record = requireValue(toolset.tools.tool('record'))
			const context = { signal: new AbortController().signal }
			await expect(record.execute({ journey: 'check-ready' }, context)).rejects.toMatchObject({
				code: 'JOURNEY_SAVED',
			})
			expect(journeys.recording).toBeUndefined()
			await expect(record.execute({ journey: 'another-name' }, context)).resolves.toContain(
				'Recording another-name;',
			)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('releases an aborted recording reservation without leaving subscriptions', async () => {
		const store = createMemoryBrowserJourneyStore()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		const listeners = toolset.emitter.count('action')
		try {
			const record = requireValue(toolset.tools.tool('record'))
			const controller = new AbortController()
			const starting = record.execute(
				{ journey: 'aborted-recording' },
				{ signal: controller.signal },
			)
			controller.abort(new Error('recording aborted'))
			await expect(starting).rejects.toThrow('recording aborted')
			expect(journeys.recording).toBeUndefined()
			expect(toolset.emitter.count('action')).toBe(listeners)
			await expect(
				record.execute({ journey: 'next-recording' }, { signal: new AbortController().signal }),
			).resolves.toContain('Recording next-recording;')
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('h2a reserves concurrent records and retains the first recorder', async () => {
		const store = createMemoryBrowserJourneyStore()
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		const listeners = toolset.emitter.count('action')
		try {
			const record = requireValue(toolset.tools.tool('record'))
			const context = { signal: new AbortController().signal }
			const results = await Promise.allSettled([
				record.execute({ journey: 'first-recording' }, context),
				record.execute({ journey: 'second-recording' }, context),
			])
			expect(results, 'h2a: one recording wins and the second is refused').toMatchObject([
				{ status: 'fulfilled' },
				{ status: 'rejected', reason: { code: 'JOURNEY_RECORDING' } },
			])
			expect(journeys.recording, 'h2a: the first recorder remains owned').toBe('first-recording')
			expect(toolset.emitter.count('action')).toBe(listeners + 1)
			await toolset.execute({ id: 'step', name: 'wait', arguments: { text: 'Ready' } })
			expect(
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Keep the first recording' },
				}),
			).toMatchObject({ success: true })
			expect(
				(await store.get('first-recording'))?.journey.steps.map((step) => step.action),
			).toEqual(['wait'])
			expect(await store.get('second-recording')).toBeUndefined()
			expect(toolset.emitter.count('action'), 'h2a: no recorder subscription leaks').toBe(listeners)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('refuses record under a foreign hold with the busy sentence', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, {
			store: createMemoryBrowserJourneyStore(),
		})
		await toolset.start()
		const hold = await toolset.hold('foreign-journey')
		try {
			await expect(
				requireValue(toolset.tools.tool('record')).execute(
					{ journey: 'during-hold' },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({
				code: 'TOOLSET_BUSY',
				message: 'The toolset is replaying foreign-journey until it finishes; call read.',
			})
			expect(journeys.recording).toBeUndefined()
		} finally {
			hold.destroy()
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('h2b inherits the owner cap when constructed directly', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const toolset = new BrowserToolset(createBrowserViewDouble(), { limit: 10 })
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			expect(
				await toolset.tools.execute({
					id: 'listing',
					name: 'journeys',
					arguments: { from: 1 },
				}),
				'h2b: direct construction lists at the owner cap of 10',
			).toMatchObject({
				success: false,
				error: 'The resul…',
			})
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('inherits the toolset cap and accepts a journey-specific override', async () => {
		const store = createMemoryBrowserJourneyStore()
		await store.set(createBrowserJourneyFixture())
		const inherited = new BrowserToolset(createBrowserViewDouble(), {
			limit: 10,
			journeys: { store },
		})
		const overridden = new BrowserToolset(createBrowserViewDouble(), {
			limit: 10,
			journeys: { store, limit: 200 },
		})
		try {
			expect(
				await inherited.tools.execute({
					id: 'inherited',
					name: 'journeys',
					arguments: { from: 1 },
				}),
			).toMatchObject({
				success: false,
				error: 'The resul…',
			})
			expect(
				await overridden.tools.execute({
					id: 'overridden',
					name: 'journeys',
					arguments: { from: 1 },
				}),
			).toMatchObject({
				value:
					'journeys (2 lines)\n1: check-ready "Check readiness"\n2: s1 wait "Ready"\n[lines 1–2 of 2; the whole listing]',
			})
			await expect(
				requireValue(overridden.tools.tool('journeys')).execute(
					{ from: -1 },
					{ signal: new AbortController().signal },
				),
			).rejects.toMatchObject({ code: 'ARGUMENT' })
		} finally {
			await inherited.destroy()
			await overridden.destroy()
		}
	})
	it('refuses a zero listing cap through its options', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		try {
			expect(
				() =>
					new BrowserJourneyToolset(toolset, {
						store: createMemoryBrowserJourneyStore(),
						limit: 0,
					}),
			).toThrow(
				expect.objectContaining({
					code: 'ARGUMENT',
					message: 'The journeys limit must be a positive integer',
				}),
			)
		} finally {
			await toolset.destroy()
		}
	})
	it('refuses record while a blocked replay holds the toolset', async () => {
		const { toolset, pending, invoked } = createBrowserPendingToolsetFixture()
		const store = createMemoryBrowserJourneyStore()
		await store.set(
			createBrowserJourneyFixture([{ action: 'checkout', arguments: { search: 'cart' } }]),
		)
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		const replaying = toolset.tools.execute({
			id: 'replay',
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		try {
			await waitForCondition('replay input is blocked', () => invoked.count === 1)
			const recorded = await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'during-replay' },
			})
			expect(recorded, 'g5a2: recording cannot begin during replay').toMatchObject({
				success: false,
				error: 'The toolset is replaying check-ready until it finishes; call read.',
			})
			expect(journeys.recording).toBeUndefined()
		} finally {
			pending.resolve('checked out')
			await replaying
			await journeys.destroy()
			await toolset.destroy()
		}
	})

	it('keeps recording actions after a refused save and saves them on retry', async () => {
		const memory = createMemoryBrowserJourneyStore()
		const store = createBrowserFailingJourneyStore(memory, [new Error('the disk is full')])
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		await toolset.start()
		try {
			await toolset.tools.execute({
				id: 'record',
				name: 'record',
				arguments: { journey: 'check-form' },
			})
			await toolset.execute({ id: 'before', name: 'wait', arguments: { text: 'Ready' } })
			const save = { id: 'save', name: 'save', arguments: { description: 'Check the form' } }
			expect(await toolset.tools.execute(save)).toMatchObject({ success: false })
			expect(journeys.recording).toBe('check-form')
			expect(
				(await toolset.execute({ id: 'after', name: 'click', arguments: { ref: 'e1' } })).result
					.success,
			).toBe(true)
			expect(await toolset.tools.execute(save)).toMatchObject({ success: true })
			expect(
				(await memory.get('check-form'))?.journey.steps.map((step) => step.action),
				'g5a3: retry retains actions recorded after the refusal',
			).toEqual(['wait', 'click'])
			expect(journeys.recording).toBeUndefined()
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	describe('tools', () => {
		it('registers the journey tools with their copy, a required parameter each, and journeys pure and untrusted', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, {
				store: createMemoryBrowserJourneyStore(),
			})
			expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([
				'record',
				'save',
				'journeys',
				'edit',
				'replay',
				'forget',
				'capture',
			])
			expect(
				Object.fromEntries(
					BROWSER_JOURNEY_TOOL_NAMES.map((name) => [
						name,
						requireValue(toolset.tools.tool(name)).description,
					]),
				),
			).toEqual({
				record:
					'Starts recording your next actions as a journey with that name; call save when it is done.',
				save: 'Stops recording and saves the journey; describe what it achieves in one sentence.',
				journeys: 'Shows saved journeys as numbered lines.',
				edit: 'Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.',
				forget: 'Removes a saved journey and all its runs; the name is free to record again.',
				capture: 'Saves the current view as a PNG in the runs directory and returns its path.',
				replay: "Replays a saved journey step by step; give each parameter's value under inputs.",
			})
			expect(
				Object.fromEntries(
					BROWSER_JOURNEY_TOOL_NAMES.map((name) => [
						name,
						readProperty<readonly string[]>(
							requireValue(toolset.tools.tool(name)).parameters,
							'required',
						),
					]),
				),
			).toEqual({
				record: ['journey'],
				save: ['description'],
				journeys: [],
				edit: ['edits'],
				replay: ['journey'],
				forget: ['journey'],
				capture: ['full'],
			})
			for (const name of BROWSER_JOURNEY_TOOL_NAMES) {
				expect(requireValue(toolset.tools.tool(name)).parameters).toEqual(
					BROWSER_TOOL_COPY[name].parameters,
				)
				expect(
					requireValue(BROWSER_TOOL_COPY[name].description).split(/\s+/u).length,
				).toBeLessThanOrEqual(25)
				const properties = readProperty<Readonly<Record<string, unknown>>>(
					BROWSER_TOOL_COPY[name].parameters,
					'properties',
				)
				for (const property of Object.values(properties))
					expect(readProperty<string>(property, 'description').length).toBeLessThanOrEqual(100)
			}
			expect(
				Object.fromEntries(
					BROWSER_JOURNEY_TOOL_NAMES.map((name) => [
						name,
						requireValue(toolset.tools.tool(name)).annotations,
					]),
				),
			).toEqual({
				record: undefined,
				save: undefined,
				journeys: { pure: true, untrusted: true },
				edit: undefined,
				replay: undefined,
				forget: undefined,
				capture: undefined,
			})
			const refused = await toolset.tools.execute({
				id: '1',
				name: 'journeys',
				arguments: { from: 1, ref: 'e1' },
			})
			expect(readProperty(refused, 'error')).toBe(
				'The journeys tool takes no ref parameter; call journeys with search, from, and to.',
			)
			await journeys.destroy()
			expect(toolset.tools.tools()).toEqual([])
		})

		it('refuses a manager that already holds a journey tool name and adds nothing', () => {
			const tools = createToolManager()
			const toolset = new BrowserToolset(createBrowserViewDouble(), { tools })
			const held = createTool({ name: 'edit', execute: ignoreCall })
			tools.add(held)
			const error = captureError(
				() => new BrowserJourneyToolset(toolset, { store: createMemoryBrowserJourneyStore() }),
			)
			expect(readProperty(error, 'code')).toBe('TOOLSET_RESERVED')
			expect(readProperty(error, 'context')).toEqual({ name: 'edit' })
			expect(tools.tools()).toEqual([held])
		})
	})

	describe('record and save', () => {
		it('refuses save when the recorded name was saved in the meantime', async () => {
			const store = createMemoryBrowserJourneyStore()
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				expect(
					await toolset.tools.execute({
						id: '1',
						name: 'record',
						arguments: { journey: 'check-ready' },
					}),
				).toMatchObject({ success: true })
				const saved = await store.set(createBrowserJourneyFixture())
				await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
				expect(
					await toolset.tools.execute({
						id: '2',
						name: 'save',
						arguments: { description: 'Replacement' },
					}),
				).toMatchObject({
					success: false,
					error: 'A journey named "check-ready" is saved; call journeys, or record another name.',
				})
				expect(await store.get('check-ready')).toEqual(saved)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})
		it('records the actions, saves before it publishes, and returns the receipts verbatim', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			const store = createMemoryBrowserJourneyStore()
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const recorded = await toolset.tools.execute({
					id: '1',
					name: 'record',
					arguments: { journey: 'check-form' },
				})
				expect(recorded).toMatchObject({
					success: true,
					value:
						'Recording check-form; each action you take is a step; call save when it is done.\n\npage "Form" https://example.test/form (3 lines)\n1: button "Save" [ref=e1]\n2: textbox "Email" [ref=e2]\n3: combobox "Size" [ref=e3]\n[lines 1–3 of 3; the whole page]',
				})
				expect(journeys.recording).toBe('check-form')
				await toolset.tools.execute({
					id: '2',
					name: 'wait',
					arguments: { text: 'Ready', timeout: 2 },
				})
				await toolset.tools.execute({ id: '3', name: 'click', arguments: { ref: 'e1' } })
				const saved = await toolset.tools.execute({
					id: '4',
					name: 'save',
					arguments: { description: 'Check the form' },
				})
				expect(saved).toMatchObject({
					success: true,
					value:
						'Saved check-form with 2 steps.\n1: check-form "Check the form" starts at https://example.test/form\n2: s1 wait "Ready"\n3: s2 click button "Save"\n[lines 1–3 of 3; the whole listing]',
				})
				expect(journeys.recording).toBeUndefined()
				expect((await store.get('check-form'))?.revision).toBe(1)
				expect((await store.get('check-form'))?.journey.steps[0]?.arguments).toEqual({
					text: 'Ready',
					timeout: 2,
				})
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('k3a directs an idle save to answer the user and refuses invalid, saved, and recording names', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const store = createMemoryBrowserJourneyStore()
			await store.set(BROWSER_JOURNEY_FIXTURE)
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const results = await toolset.tools.execute([
					{ id: '1', name: 'save', arguments: { description: 'Nothing' } },
					{ id: '2', name: 'record', arguments: { journey: 'Add kettle' } },
					{ id: '3', name: 'record', arguments: { journey: 'add-kettle' } },
				])
				expect(results.map((result) => readProperty(result, 'error'))).toEqual([
					'No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.',
					'"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.',
					'Journey "add-kettle" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.',
				])
				await toolset.tools.execute({ id: '4', name: 'record', arguments: { journey: 'brew-tea' } })
				const again = await toolset.tools.execute({
					id: '5',
					name: 'record',
					arguments: { journey: 'check-ready' },
				})
				expect(readProperty(again, 'error')).toBe(
					'brew-tea is recording; call save before you record another.',
				)
				expect(journeys.recording).toBe('brew-tea')
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('keeps recording when the write fails or is locked and saves the interrupted gap', async () => {
			const memory = createMemoryBrowserJourneyStore()
			const store = createBrowserFailingJourneyStore(memory, [
				new Error('the disk is full.'),
				new BrowserError('STORE_LOCKED', 'Journey check-form is locked.'),
			])
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				await toolset.tools.execute({
					id: '1',
					name: 'record',
					arguments: { journey: 'check-form' },
				})
				await toolset.tools.execute({ id: '2', name: 'wait', arguments: { text: 'Ready' } })
				// The snapshot includes an unanswered click as a gap without stopping the recorder.
				toolset.emitter.emit('action', createBrowserActionFixture({ outcome: 'interrupted' }))
				const failed = await toolset.tools.execute({
					id: '3',
					name: 'save',
					arguments: { description: 'Check the form' },
				})
				expect(readProperty(failed, 'error')).toBe(
					'Saving check-form failed: the disk is full; call save again.',
				)
				expect(journeys.recording).toBe('check-form')
				expect(
					await toolset.tools.execute({ id: '4', name: 'journeys', arguments: { from: 1 } }),
				).toMatchObject({ value: BROWSER_JOURNEY_EMPTY_LISTING })
				const locked = await toolset.tools.execute({
					id: '6',
					name: 'save',
					arguments: { description: 'Check the form' },
				})
				expect(readProperty(locked, 'error')).toBe('Journey check-form is locked; call save again.')
				expect(journeys.recording).toBe('check-form')
				const saved = await toolset.tools.execute({
					id: '7',
					name: 'save',
					arguments: { description: 'Check the form' },
				})
				expect(saved).toMatchObject({
					success: true,
					value:
						'Saved check-form with 2 steps.\n1: check-form "Check the form" starts at https://example.test/form\n2: s1 wait "Ready"\n3: s2 unresolved: interrupted click\n[lines 1–3 of 3; the whole listing]',
				})
				expect(journeys.recording).toBeUndefined()
				expect((await memory.get('check-form'))?.revision).toBe(1)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})
	})

	describe('readonly', () => {
		it('refuses record, save, and edit before any store access, and lets replay write its run', async () => {
			const memory = createMemoryBrowserJourneyStore()
			await memory.set(createBrowserJourneyFixture())
			const calls = createRecorder<readonly [string]>()
			const store: BrowserJourneyStoreInterface = {
				get: (name, options) => {
					calls.handler('get')
					return memory.get(name, options)
				},
				set: (journey, options) => {
					calls.handler('set')
					return memory.set(journey, options)
				},
				delete: memory.delete.bind(memory),
				list: (options) => {
					calls.handler('list')
					return memory.list(options)
				},
			}
			const runs = new MemoryBrowserRunStore()
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store, runs, readonly: true })
			await toolset.start()
			try {
				const results = await toolset.tools.execute([
					{ id: '1', name: 'record', arguments: { journey: 'check-ready' } },
					{ id: '2', name: 'save', arguments: { description: 'Check readiness' } },
					{
						id: '3',
						name: 'edit',
						arguments: { journey: 'check-ready', edits: [{ operation: 'remove', id: 's1' }] },
					},
				])
				expect(results.map((result) => readProperty(result, 'error'))).toEqual([
					'The journeys are read-only; call replay.',
					'The journeys are read-only; call replay.',
					'The journeys are read-only; call replay.',
				])
				expect(calls.calls).toEqual([])
				const replayed = await toolset.tools.execute({
					id: '4',
					name: 'replay',
					arguments: { journey: 'check-ready' },
				})
				expect(replayed).toMatchObject({ success: true })
				expect(calls.calls).toEqual([['get']])
				expect((await runs.list('check-ready')).entries.map((run) => run.outcome)).toEqual([
					'complete',
				])
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})
	})

	describe('journeys', () => {
		it('lists the design fence, joins journeys with one blank line, and returns the empty sentence', async () => {
			const store = createMemoryBrowserJourneyStore()
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			try {
				expect(
					await toolset.tools.execute({ id: '1', name: 'journeys', arguments: { from: 1 } }),
				).toMatchObject({ value: 'No journeys are saved; call record to start one.' })
				await store.set(BROWSER_JOURNEY_FIXTURE)
				expect(
					await toolset.tools.execute({ id: '2', name: 'journeys', arguments: { from: 1 } }),
				).toMatchObject({
					value: `journeys (6 lines)\n${BROWSER_JOURNEY_LISTING.split('\n')
						.map((line, index) => `${index + 1}: ${line}`)
						.join('\n')}\n[lines 1–6 of 6; the whole listing]`,
				})
				await store.set(createBrowserJourneyFixture())
				expect(
					await toolset.tools.execute({ id: '3', name: 'journeys', arguments: { from: 1 } }),
				).toMatchObject({
					value: `journeys (8 lines)
${BROWSER_JOURNEY_LISTING.split('\n')
	.map((line, index) => `${index + 1}: ${line}`)
	.join('\n')}
7: check-ready "Check readiness"
8: s1 wait "Ready"
[lines 1–8 of 8; the whole listing]`,
				})
			} finally {
				await journeys.destroy()
			}
		})

		it('continues the numbered listing with exact inclusive ranges', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(undefined, { name: 'brew-tea', description: 'Brew thé' }),
			)
			await store.set(createBrowserJourneyFixture())
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store, limit: 150 })
			try {
				const tool = requireValue(toolset.tools.tool('journeys'))
				const context = { signal: new AbortController().signal }
				const first = String(await tool.execute({ from: 1, to: 2 }, context))
				expect(first).toBe(
					'journeys (4 lines)\n1: brew-tea "Brew thé"\n2: s1 wait "Ready"\n[lines 1–2 of 4; 2 below; call journeys with from 3 for more]',
				)
				expect(first.length).toBeLessThanOrEqual(150)
				expect(await tool.execute({ from: 3 }, context)).toBe(
					'journeys (4 lines)\n3: check-ready "Check readiness"\n4: s1 wait "Ready"\n[lines 3–4 of 4; 2 above; end of listing]',
				)
				await expect(tool.execute({ from: 5 }, context)).rejects.toMatchObject({
					code: 'ARGUMENT',
				})
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('preserves Unicode in complete lines and bounds refusals at tiny limits', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(undefined, { name: 'brew-tea', description: 'Brew 🍵' }),
			)
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			const narrow = new BrowserToolset(createBrowserViewDouble())
			const single = new BrowserJourneyToolset(narrow, { store, limit: 1 })
			try {
				expect(
					await requireValue(toolset.tools.tool('journeys')).execute(
						{ from: 1 },
						{ signal: new AbortController().signal },
					),
				).toContain('Brew 🍵')
				const result = await narrow.tools.execute({
					id: 'tiny',
					name: 'journeys',
					arguments: { from: 1 },
				})
				expect(result).toMatchObject({ success: false, error: '…' })
				await expect(
					requireValue(narrow.tools.tool('journeys')).execute(
						{ from: 1 },
						{ signal: new AbortController().signal },
					),
				).rejects.toMatchObject({ code: 'TOOLSET_LIMIT' })
			} finally {
				await single.destroy()
				await journeys.destroy()
				await toolset.destroy()
				await narrow.destroy()
			}
		})

		it('lists the memory store in name order', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(createBrowserJourneyFixture())
			await store.set(createBrowserJourneyFixture(undefined, { name: 'brew-tea' }))
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			try {
				expect(
					await toolset.tools.execute({ id: '1', name: 'journeys', arguments: { from: 1 } }),
				).toMatchObject({
					value:
						'journeys (4 lines)\n1: brew-tea "Check readiness"\n2: s1 wait "Ready"\n3: check-ready "Check readiness"\n4: s1 wait "Ready"\n[lines 1–4 of 4; the whole listing]',
				})
			} finally {
				await journeys.destroy()
			}
		})
	})

	describe('edit', () => {
		it('converts each ref through the current view, writes with the read revision, and lists the result', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture([
					{ action: 'wait', arguments: { text: 'Ready' } },
					{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save' } },
				]),
			)
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				await toolset.tools.execute({
					id: '1',
					name: 'read',
					arguments: { from: 1, search: 'form' },
				})
				const edited = await toolset.tools.execute({
					id: '2',
					name: 'edit',
					arguments: {
						journey: 'check-ready',
						edits: [
							{ operation: 'update', id: 's2', ref: 'e3' },
							{
								operation: 'add',
								step: { action: 'type', arguments: { text: { parameter: 'email' } }, ref: 'e2' },
								after: 's1',
							},
							{ operation: 'declare', name: 'email', parameter: { default: 'sam@example.test' } },
						],
					},
				})
				expect(edited).toMatchObject({
					success: true,
					value:
						'Edited check-ready.\n1: check-ready "Check readiness" (parameters: email)\n2: s1 wait "Ready"\n3: s3 type "sam@example.test" as email into textbox "Email"\n4: s2 click combobox "Size"\n[lines 1–4 of 4; the whole listing]',
				})
				const saved = requireValue(await store.get('check-ready'))
				expect(saved.revision).toBe(2)
				expect(saved.journey.steps.map((step) => step.target)).toEqual([
					undefined,
					{ role: 'textbox', name: 'Email', reference: 'e2' },
					{ role: 'combobox', name: 'Size', reference: 'e3' },
				])
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('refuses a missing journey, a stale ref, an invalid edit, a stale revision, and a held lock verbatim', async () => {
			const memory = createMemoryBrowserJourneyStore()
			await memory.set(createBrowserJourneyFixture())
			const scripted: Array<'stale' | 'locked'> = []
			const store: BrowserJourneyStoreInterface = {
				get: async (name, options) => {
					const read = await memory.get(name, options)
					// Another writer saves the journey between this read and the edit's write.
					if (read !== undefined && scripted[0] === 'stale') await memory.set(read.journey)
					return read
				},
				set: async (journey, options) => {
					if (scripted.shift() === 'locked')
						throw new BrowserError('STORE_LOCKED', 'Journey check-ready is locked.')
					return memory.set(journey, options)
				},
				delete: memory.delete.bind(memory),
				list: memory.list.bind(memory),
			}
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const results = await toolset.tools.execute(
					[
						['checkout', [{ operation: 'remove', id: 's1' }]],
						['check-ready', [{ operation: 'update', id: 's1', ref: 'e9' }]],
						[
							'check-ready',
							[
								{ operation: 'update', id: 's1', arguments: { text: 'Done' } },
								{ operation: 'remove', id: 's9' },
							],
						],
						[
							'check-ready',
							[{ operation: 'declare', name: 'email', parameter: { default: 'sam@example.test' } }],
						],
						['check-ready', [{ operation: 'remove' }]],
					].map(([journey, edits]) => ({
						id: 'edit',
						name: 'edit',
						arguments: { journey, edits },
					})),
				)
				expect(results.map((result) => readProperty(result, 'error'))).toEqual([
					'No journey is named "checkout"; call journeys.',
					'Element [ref=e9] is not in the current view; call read for fresh refs.',
					'Edit 2 is refused: it names unknown step "s9"; call journeys.',
					'Edit 1 is refused: it declares "email" but no step binds it; call journeys.',
					'Edit 1 is refused: its "remove" names no step in "id"; call journeys.',
				])
				expect((await memory.get('check-ready'))?.revision).toBe(1)
				scripted.push('stale')
				const update = {
					id: 'edit',
					name: 'edit',
					arguments: {
						journey: 'check-ready',
						edits: [{ operation: 'update', id: 's1', arguments: { text: 'Done' } }],
					},
				}
				const stale = await toolset.tools.execute(update)
				expect(readProperty(stale, 'error')).toBe(
					'Journey check-ready changed since you read it; call journeys, then edit again.',
				)
				scripted.push('locked')
				const locked = await toolset.tools.execute(update)
				expect(readProperty(locked, 'error')).toBe(
					'Journey check-ready is locked; call edit again.',
				)
				expect((await memory.get('check-ready'))?.journey.steps[0]?.arguments).toEqual({
					text: 'Ready',
				})
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})
	})

	describe('replay', () => {
		it('replays a journey and returns the run render followed by the view after the run', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(
					[
						{ action: 'wait', arguments: { text: 'Ready' } },
						{ action: 'wait', arguments: { text: { parameter: 'status' } } },
					],
					{ parameters: { status: { default: 'Saved' } } },
				),
			)
			const runs = new MemoryBrowserRunStore()
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			const journeys = new BrowserJourneyToolset(toolset, { store, runs })
			await toolset.start()
			try {
				const replayed = await toolset.tools.execute({
					id: '1',
					name: 'replay',
					arguments: { journey: 'check-ready', inputs: { status: 'Shipped' } },
				})
				expect(replayed).toMatchObject({
					success: true,
					value:
						'Replayed check-ready: 2 of 2 steps.\ns1 "Ready" is on the page.\ns2 "Shipped" is on the page.\n\npage "Form" https://example.test/form (3 lines)\n1: button "Save" [ref=e1]\n2: textbox "Email" [ref=e2]\n3: combobox "Size" [ref=e3]\n[lines 1–3 of 3; the whole page]',
				})
				expect(view.calls).toEqual(['wait Ready', 'outline', 'wait Shipped', 'outline', 'outline'])
				const [run] = (await runs.list('check-ready')).entries
				expect(run).toMatchObject({
					outcome: 'complete',
					revision: 1,
					inputs: { status: 'Shipped' },
				})
				expect(journeys.replaying).toBeUndefined()
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it.each(BROWSER_PREPARATION_CASES)(
			'reads $name preparation context and renders its sentence',
			async (candidate) => {
				const memory = createMemoryBrowserJourneyStore()
				const journey = structuredClone(candidate.journey)
				if (candidate.corrupt !== undefined) Reflect.set(journey, ...candidate.corrupt)
				const store: BrowserJourneyStoreInterface = {
					get: async () => ({ journey }),
					set: memory.set.bind(memory),
					list: memory.list.bind(memory),
					delete: memory.delete.bind(memory),
				}
				const view = createBrowserViewDouble()
				const toolset = new BrowserToolset(view)
				const journeys = new BrowserJourneyToolset(toolset, { store })
				const holds = createRecorder<readonly [string]>()
				toolset.emitter.on('hold', holds.handler)
				await toolset.start()
				try {
					await expect(
						new BrowserReplay(toolset, { journey }, { inputs: candidate.inputs }).execute(),
					).rejects.toMatchObject({
						code: candidate.code,
						context: candidate.context,
					})
					const result = await toolset.tools.execute({
						id: 'preparation',
						name: 'replay',
						arguments: { journey: journey.name, inputs: { ...candidate.inputs } },
					})
					expect(result).toMatchObject({ success: false, error: candidate.sentence })
					expect(holds.count).toBe(0)
					expect(view.calls).toEqual([])
				} finally {
					await journeys.destroy()
					await toolset.destroy()
				}
			},
		)

		it('maps every preparation refusal and a missing journey to its sentence', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(
					[{ action: 'wait', arguments: { text: { parameter: 'email' } } }],
					{
						name: 'add-kettle',
						parameters: { email: {} },
					},
				),
			)
			await store.set(
				createBrowserJourneyFixture(
					[
						{ action: 'wait', arguments: { text: 'Ready' } },
						{ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
					],
					{ name: 'gap-kettle' },
				),
			)
			await store.set(
				createBrowserJourneyFixture(
					[
						{ action: 'wait', arguments: { text: 'Ready' } },
						{ action: 'press', arguments: { key: 'Enter' } },
					],
					{ name: 'press-kettle' },
				),
			)
			await store.set(
				createBrowserJourneyFixture(
					[
						{ action: 'wait', arguments: { text: 'Ready' } },
						{
							action: 'switch',
							arguments: {},
							tab: { url: 'https://shop.example.test/cart', title: 'Cart' },
						},
					],
					{ name: 'switch-kettle' },
				),
			)
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			const journeys = new BrowserJourneyToolset(toolset, { store })
			const holds = createRecorder<readonly [string]>()
			toolset.emitter.on('hold', holds.handler)
			await toolset.start()
			try {
				// The calls run one at a time, because a replay claims the toolset until it finishes.
				const errors: unknown[] = []
				for (const args of [
					{ journey: 'checkout' },
					{ journey: 'add-kettle' },
					{ journey: 'add-kettle', inputs: { emial: 'ada@example.test' } },
					{ journey: 'gap-kettle' },
					{ journey: 'press-kettle' },
					{ journey: 'switch-kettle' },
				])
					errors.push(
						readProperty(
							await toolset.tools.execute({ id: 'replay', name: 'replay', arguments: args }),
							'error',
						),
					)
				expect(errors).toEqual([
					'No journey is named "checkout"; call journeys.',
					'Journey add-kettle needs the input "email"; call replay with inputs.',
					'Journey add-kettle has no parameter named "emial"; call journeys.',
					'Journey gap-kettle has a gap at s2 (the element is in a child frame); call edit to remove or replace s2.',
					'Journey press-kettle cannot run here: s2 press is not available in a page toolset; call journeys.',
					'Journey switch-kettle cannot run here: s2 switch needs a browser context; call journeys.',
				])
				expect(holds.count).toBe(0)
				expect(view.calls).toEqual([])
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('refuses while recording, while another replay holds, and when the journey cannot be read', async () => {
			const memory = createMemoryBrowserJourneyStore()
			await memory.set(createBrowserJourneyFixture())
			const pending = Promise.withResolvers<void>()
			let mode: 'block' | 'file' | 'format' | undefined
			const store: BrowserJourneyStoreInterface = {
				get: async (name, options): Promise<BrowserJourneyRevision | undefined> => {
					const read = await memory.get(name, options)
					if (mode === 'block') await pending.promise
					if (mode === 'file')
						throw new BrowserError(
							'STORE_FILE',
							'The journey file tmp/browsers/check-ready/journey.json is malformed.',
						)
					if (mode === 'format' && read !== undefined)
						return { ...read, journey: { ...read.journey, format: 1, next: 0 } }
					return read
				},
				set: memory.set.bind(memory),
				delete: memory.delete.bind(memory),
				list: memory.list.bind(memory),
			}
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			const replay = { id: 'r', name: 'replay', arguments: { journey: 'check-ready' } }
			try {
				await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'brew-tea' } })
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'Journey brew-tea is recording; call save before you replay another.',
				)
				await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
				await toolset.tools.execute({ id: '2', name: 'save', arguments: { description: 'Brew' } })
				const hold = await toolset.hold('add-kettle')
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'The toolset is replaying add-kettle until it finishes; call read.',
				)
				hold.destroy()
				mode = 'block'
				const first = toolset.tools.execute(replay)
				await waitForCondition(
					'the first replay claims the toolset',
					() => journeys.replaying !== undefined,
				)
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'The toolset is replaying check-ready until it finishes; call read.',
				)
				pending.resolve()
				expect(await first).toMatchObject({ success: true })
				mode = 'file'
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'Journey check-ready cannot be read: The journey file tmp/browsers/check-ready/journey.json is malformed; call journeys.',
				)
				mode = 'format'
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'Journey check-ready cannot be read: has an invalid next counter; call journeys.',
				)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('stops at a resolution refusal and renders it without its directive', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture([
					{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save' } },
					{ action: 'wait', arguments: { text: 'Saved' } },
				]),
			)
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const replayed = await toolset.tools.execute({
					id: '1',
					name: 'replay',
					arguments: { journey: 'check-ready' },
				})
				expect(readProperty<string>(replayed, 'value').split('\n\n')[0]).toBe(
					'Replay of check-ready stopped at s1 of 2: Step s1 names button "Save", which 3 elements carry.\ns1 Step s1 names button "Save", which 3 elements carry.',
				)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('stops at a target no element carries and renders it without its directive', async () => {
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture([
					{ action: 'click', arguments: {}, target: { role: 'button', name: 'Delete' } },
					{ action: 'wait', arguments: { text: 'Deleted' } },
				]),
			)
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const replayed = await toolset.tools.execute({
					id: '1',
					name: 'replay',
					arguments: { journey: 'check-ready' },
				})
				expect(readProperty<string>(replayed, 'value').split('\n\n')[0]).toBe(
					'Replay of check-ready stopped at s1 of 2: Step s1 names button "Delete", which no element carries.\ns1 Step s1 names button "Delete", which no element carries.',
				)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})

	describe('signal', () => {
		it('reaches the store calls of every tool', async () => {
			const memory = createMemoryBrowserJourneyStore()
			await memory.set(createBrowserJourneyFixture())
			const reached = createRecorder<readonly [string]>()
			const store: BrowserJourneyStoreInterface = {
				get: async (_name, options) => {
					reached.handler('get')
					await waitForAbort(requireValue(options?.signal))
					throw requireValue(options?.signal).reason
				},
				set: async (_journey, options) => {
					reached.handler('set')
					await waitForAbort(requireValue(options?.signal))
					throw requireValue(options?.signal).reason
				},
				delete: memory.delete.bind(memory),
				list: async (options) => {
					reached.handler('list')
					await waitForAbort(requireValue(options?.signal))
					throw requireValue(options?.signal).reason
				},
			}
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				const calls = [
					{ id: '1', name: 'record', arguments: { journey: 'brew-tea' } },
					{ id: '2', name: 'journeys', arguments: { from: 1 } },
					{
						id: '3',
						name: 'edit',
						arguments: { journey: 'check-ready', edits: [{ operation: 'remove', id: 's1' }] },
					},
					{ id: '4', name: 'replay', arguments: { journey: 'check-ready' } },
				]
				for (const [index, call] of calls.entries()) {
					const controller = new AbortController()
					const result = toolset.tools.execute(call, { signal: controller.signal })
					await waitForCondition('the store call starts', () => reached.count === index + 1)
					controller.abort(new Error(`stop ${call.name}`))
					expect(readProperty(await result, 'error')).toBe(`stop ${call.name}`)
				}
				expect(reached.calls.map(([method]) => method)).toEqual(['get', 'list', 'get', 'get'])
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('reaches a save write and a replayed step', async () => {
			const memory = createMemoryBrowserJourneyStore()
			const writes = createRecorder<readonly [boolean]>()
			const store: BrowserJourneyStoreInterface = {
				get: memory.get.bind(memory),
				set: async (_journey, options) => {
					writes.handler(options?.signal?.aborted ?? true)
					await waitForAbort(requireValue(options?.signal))
					throw requireValue(options?.signal).reason
				},
				delete: memory.delete.bind(memory),
				list: memory.list.bind(memory),
			}
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				insert: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			const runs = new MemoryBrowserRunStore()
			const journeys = new BrowserJourneyToolset(toolset, { store, runs })
			await toolset.start()
			await memory.set(
				createBrowserJourneyFixture([
					{
						action: 'type',
						arguments: { text: 'Harbor' },
						target: { role: 'textbox', name: 'Email' },
					},
					{ action: 'press', arguments: { key: 'Escape' } },
				]),
			)
			try {
				await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'brew-tea' } })
				const saving = new AbortController()
				await toolset.tools.execute({ id: 'press', name: 'press', arguments: { key: 'Escape' } })
				const saved = toolset.tools.execute(
					{ id: '2', name: 'save', arguments: { description: 'Brew' } },
					{ signal: saving.signal },
				)
				await waitForCondition('the write starts', () => writes.count === 1)
				saving.abort(new Error('stop save'))
				expect(readProperty(await saved, 'error')).toBe('stop save')
				expect(writes.calls).toEqual([[false]])
				expect(journeys.recording).toBe('brew-tea')
				await journeys.destroy()
				const replaying = new BrowserJourneyToolset(toolset, { store: memory, runs })
				const inputs = fixture.transport.sent.filter(
					(message) => message.method === 'Input.dispatchKeyEvent',
				)
				const controller = new AbortController()
				const replayed = toolset.tools.execute(
					{ id: '3', name: 'replay', arguments: { journey: 'check-ready' } },
					{ signal: controller.signal },
				)
				await waitForCondition(
					'the replayed input reaches the protocol',
					() => withheld.length === 1,
				)
				controller.abort(new Error('stop replay'))
				expect(await replayed).toMatchObject({
					success: true,
					value: 'Replay of check-ready aborted at s1 of 2.\ns1 stop replay',
				})
				expect((await runs.list('check-ready')).entries.map((run) => run.outcome)).toEqual([
					'aborted',
				])
				expect(
					fixture.transport.sent.filter((message) => message.method === 'Input.dispatchKeyEvent'),
				).toEqual(inputs)
				await replaying.destroy()
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})

	describe('destroy', () => {
		it('aborts the active replay, waits for it, and removes the six tools', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				insert: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			const store = createMemoryBrowserJourneyStore()
			const runs = new MemoryBrowserRunStore()
			await store.set(
				createBrowserJourneyFixture([
					{
						action: 'type',
						arguments: { text: 'Harbor' },
						target: { role: 'textbox', name: 'Email' },
					},
					{ action: 'press', arguments: { key: 'Escape' } },
				]),
			)
			const journeys = new BrowserJourneyToolset(toolset, { store, runs })
			const released = createRecorder<readonly [string]>()
			toolset.emitter.on('release', released.handler)
			await toolset.start()
			try {
				const replayed = toolset.tools.execute({
					id: '1',
					name: 'replay',
					arguments: { journey: 'check-ready' },
				})
				await waitForCondition(
					'the replayed input reaches the protocol',
					() => withheld.length === 1,
				)
				expect(journeys.replaying).toBe('check-ready')
				await journeys.destroy()
				// The replay finished, released its hold, and wrote its run before destroy resolved.
				expect(journeys.replaying).toBeUndefined()
				expect(released.calls).toEqual([['check-ready']])
				expect((await runs.list('check-ready')).entries.map((run) => run.outcome)).toEqual([
					'aborted',
				])
				expect(readProperty<string>(await replayed, 'value')).toMatch(
					/^Replay of check-ready aborted at s1 of 2\./,
				)
				for (const name of BROWSER_JOURNEY_TOOL_NAMES)
					expect(toolset.tools.tool(name)).toBeUndefined()
				expect(toolset.tools.tool('read')).toBeDefined()
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('stops a recording without saving it and refuses a retained tool afterwards', async () => {
			const store = createMemoryBrowserJourneyStore()
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'brew-tea' } })
				await toolset.tools.execute({ id: '2', name: 'wait', arguments: { text: 'Ready' } })
				const save = requireValue(toolset.tools.tool('save'))
				await journeys.destroy()
				expect(journeys.recording).toBeUndefined()
				expect((await store.list()).entries).toEqual([])
				const refused = await Promise.resolve(
					save.execute({ description: 'Brew' }, { signal: new AbortController().signal }),
				).catch((error: unknown) => error)
				expect(readProperty(refused, 'message')).toBe('the browser session ended')
				expect((await store.list()).entries).toEqual([])
			} finally {
				await toolset.destroy()
			}
		})
	})

	describe('secrets', () => {
		it('keeps a secret out of the listing and the run render', async () => {
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, { result: { value: fixture.page.url } }),
			})
			const toolset = createBrowserToolset(fixture.page)
			const store = createMemoryBrowserJourneyStore()
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
				fixture.transport.onSend('Page.navigate', (message) => {
					fixture.transport.reply(message.id, { frameId: 'main', loaderId: 'sign-in' })
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						fixture.page.url,
						'sign-in',
					)
					fixture.transport.event('Page.loadEventFired', { timestamp: 1 }, 'session-main')
				})
				await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'sign-in' } })
				const email = requireValue(
					toolset.view.elements
						.elements()
						.find((element) => element.role === 'textbox' && element.name === 'Email'),
				)
				const typed = await toolset.tools.execute({
					id: '2',
					name: 'type',
					arguments: { ref: email.reference, text: 'private-recorded-value', secret: true },
				})
				expect(typed).toMatchObject({ success: true })
				const saved = await toolset.tools.execute({
					id: '3',
					name: 'save',
					arguments: { description: 'Sign in' },
				})
				expect(saved).toMatchObject({
					success: true,
					value: `Saved sign-in with 1 step.
1: sign-in "Sign in" starts at https://example.test/cart (parameters: email (secret))
2: s1 type (secret) as email into textbox "Email"
[lines 1–2 of 2; the whole listing]`,
				})
				const listed = await toolset.tools.execute({
					id: '4',
					name: 'journeys',
					arguments: { from: 1 },
				})
				const replayed = await toolset.tools.execute({
					id: '5',
					name: 'replay',
					arguments: { journey: 'sign-in', inputs: { email: 'private-replay-value' } },
				})
				expect(readProperty<string>(replayed, 'value')).toMatch(
					new RegExp(
						'^Replayed sign-in: 1 of 1 steps\\.\\ns1 Typed a secret into textbox "Email" \\[ref=e[1-9][0-9]*\\]',
					),
				)
				for (const result of [saved, listed, replayed]) {
					expect(JSON.stringify(result)).not.toContain('private-recorded-value')
					expect(JSON.stringify(result)).not.toContain('private-replay-value')
				}
				expect(JSON.stringify(await store.get('sign-in'))).not.toContain('private')
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})
})
