import type { BrowserJourneyRevision, BrowserJourneyStoreInterface } from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { describe, expect, it } from 'vitest'
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
	BrowserJourneyToolset,
	BrowserReplay,
	BrowserToolset,
	MemoryBrowserRunStore,
	createBrowserToolset,
	createMemoryBrowserJourneyStore,
} from '@src/core'
import {
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_PREPARATION_CASES,
	BROWSER_JOURNEY_LISTING,
	createBrowserActionFixture,
	createBrowserElementFixture,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
	ignoreCall,
} from '../../setup.js'

describe('BrowserJourneyToolset', () => {
	describe('tools', () => {
		it('registers the five tools with their copy, a required parameter each, and journeys pure and untrusted', async () => {
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
				journeys: 'Lists the saved journeys with their steps and the parameters each one takes.',
				edit: 'Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.',
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
				journeys: ['what'],
				edit: ['journey', 'edits'],
				replay: ['journey'],
			})
			for (const name of BROWSER_JOURNEY_TOOL_NAMES)
				expect(requireValue(toolset.tools.tool(name)).parameters).toEqual(
					BROWSER_TOOL_COPY[name].parameters,
				)
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
			})
			const refused = await toolset.tools.execute({
				id: '1',
				name: 'journeys',
				arguments: { what: 'all', ref: 'e1' },
			})
			expect(readProperty(refused, 'error')).toBe(
				'The journeys tool takes no ref parameter; call journeys with what and offset.',
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
			expect(readProperty(error, 'code')).toBe('BROWSER_TOOLSET_RESERVED')
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
					value: `Recording check-form; each action you take is a step; call save when it is done.

page "Form" https://example.test/form
e1 button "Save"
e2 textbox "Email"
e3 combobox "Size"
(3 of 3 elements)`,
				})
				expect(journeys.recording).toBe('check-form')
				await toolset.tools.execute({ id: '2', name: 'wait', arguments: { text: 'Ready' } })
				await toolset.tools.execute({ id: '3', name: 'click', arguments: { ref: 'e1' } })
				const saved = await toolset.tools.execute({
					id: '4',
					name: 'save',
					arguments: { description: 'Check the form' },
				})
				expect(saved).toMatchObject({
					success: true,
					value: `Saved check-form with 2 steps.

check-form "Check the form"
s1 wait "Ready"
s2 click button "Save"`,
				})
				expect(journeys.recording).toBeUndefined()
				expect((await store.get('check-form'))?.revision).toBe(1)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('refuses an invalid name, a saved name, a recording in progress, and a save with nothing recording', async () => {
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
					'No journey is recording; call record first.',
					'"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.',
					'A journey named "add-kettle" is saved; call journeys, or record another name.',
				])
				await toolset.tools.execute({ id: '4', name: 'record', arguments: { journey: 'brew-tea' } })
				const again = await toolset.tools.execute({
					id: '5',
					name: 'record',
					arguments: { journey: 'check-ready' },
				})
				expect(readProperty(again, 'error')).toBe('A journey is recording; call save first.')
				expect(journeys.recording).toBe('brew-tea')
			} finally {
				await journeys.destroy()
				await toolset.destroy()
			}
		})

		it('stops the recorder, keeps the recording open when the write fails or is locked, and saves its steps after', async () => {
			const memory = createMemoryBrowserJourneyStore()
			const failures: unknown[] = [
				new Error('the disk is full.'),
				new BrowserError('Journey check-form is locked.', 'BROWSER_JOURNEY_LOCKED'),
			]
			const store: BrowserJourneyStoreInterface = {
				get: memory.get.bind(memory),
				delete: memory.delete.bind(memory),
				list: memory.list.bind(memory),
				set: async (journey, expected, options) => {
					const failure = failures.shift()
					if (failure !== undefined) throw failure
					return memory.set(journey, expected, options)
				},
			}
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
				// A click no dialog answered stays pending in the recorder until it stops.
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
					await toolset.tools.execute({ id: '4', name: 'journeys', arguments: { what: 'all' } }),
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
					value: `Saved check-form with 2 steps.

check-form "Check the form"
s1 wait "Ready"
s2 unresolved: interrupted click`,
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
				set: (journey, expected, options) => {
					calls.handler('set')
					return memory.set(journey, expected, options)
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
					await toolset.tools.execute({ id: '1', name: 'journeys', arguments: { what: 'all' } }),
				).toMatchObject({ value: 'No journeys are saved; call record to start one.' })
				await store.set(BROWSER_JOURNEY_FIXTURE)
				expect(
					await toolset.tools.execute({ id: '2', name: 'journeys', arguments: { what: 'all' } }),
				).toMatchObject({ value: BROWSER_JOURNEY_LISTING })
				await store.set(createBrowserJourneyFixture())
				expect(
					await toolset.tools.execute({ id: '3', name: 'journeys', arguments: { what: 'all' } }),
				).toMatchObject({
					value: `${BROWSER_JOURNEY_LISTING}

check-ready "Check readiness"
s1 wait "Ready"`,
				})
			} finally {
				await journeys.destroy()
			}
		})

		it('cuts the listing over characters at the limit and continues from the offset it names', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(undefined, { name: 'brew-tea', description: 'Brew thé' }),
			)
			await store.set(createBrowserJourneyFixture())
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store }, 40)
			try {
				const results = await toolset.tools.execute([
					{ id: '1', name: 'journeys', arguments: { what: 'all' } },
					{ id: '2', name: 'journeys', arguments: { what: 'all', offset: 40 } },
					{ id: '3', name: 'journeys', arguments: { what: 'all', offset: 80 } },
					{ id: '4', name: 'journeys', arguments: { what: 'all', offset: 82 } },
					{ id: '5', name: 'journeys', arguments: { what: 'all', offset: -1 } },
				])
				expect(results.map((result) => readProperty(result, 'value'))).toEqual([
					'brew-tea "Brew thé"\ns1 wait "Ready"\n\nche\n\n[characters 0–40 of 82; call journeys with offset 40 for more]',
					'ck-ready "Check readiness"\ns1 wait "Read\n\n[characters 40–80 of 82; call journeys with offset 80 for more]',
					'y"\n\n[characters 80–82 of 82]',
					'brew-tea "Brew thé"\ns1 wait "Ready"\n\nche\n\n[characters 0–40 of 82; call journeys with offset 40 for more]',
					undefined,
				])
				expect(readProperty(results[4], 'error')).toBe(
					'The offset parameter must be a non-negative integer.',
				)
			} finally {
				await journeys.destroy()
			}
		})

		it('never cuts a surrogate pair in half, and refuses a limit that cannot hold the pair', async () => {
			const store = createMemoryBrowserJourneyStore()
			await store.set(
				createBrowserJourneyFixture(undefined, { name: 'brew-tea', description: 'Brew 🍵' }),
			)
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store }, 16)
			const narrow = new BrowserToolset(createBrowserViewDouble())
			const single = new BrowserJourneyToolset(narrow, { store }, 1)
			try {
				expect(
					await toolset.tools.execute({ id: '1', name: 'journeys', arguments: { what: 'all' } }),
				).toMatchObject({
					value:
						'brew-tea "Brew \n\n[characters 0–15 of 34; call journeys with offset 15 for more]',
				})
				const refused = await narrow.tools.execute({
					id: '2',
					name: 'journeys',
					arguments: { what: 'all', offset: 15 },
				})
				expect(readProperty(refused, 'error')).toBe(
					'The journeys limit of 1 characters cannot hold the next character at offset 15; raise the toolset limit.',
				)
			} finally {
				await single.destroy()
				await journeys.destroy()
			}
		})

		it('pages the store past the entries it could not read', async () => {
			const memory = createMemoryBrowserJourneyStore()
			await memory.set(createBrowserJourneyFixture(undefined, { name: 'brew-tea' }))
			await memory.set(createBrowserJourneyFixture())
			const [brew, check] = (await memory.list()).entries
			const offsets = createRecorder<readonly [number | undefined]>()
			const store: BrowserJourneyStoreInterface = {
				get: memory.get.bind(memory),
				set: memory.set.bind(memory),
				delete: memory.delete.bind(memory),
				// Two readable entries and one unreadable entry between them, two to a page.
				list: async (options) => {
					offsets.handler(options?.offset)
					return options?.offset === 2
						? { entries: [requireValue(check)], truncated: false, faults: [] }
						: {
								entries: [requireValue(brew)],
								truncated: true,
								faults: [{ path: 'tmp/browsers/broken/journey.json', message: 'malformed' }],
							}
				},
			}
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store })
			try {
				expect(
					await toolset.tools.execute({ id: '1', name: 'journeys', arguments: { what: 'all' } }),
				).toMatchObject({
					value: `brew-tea "Check readiness"
s1 wait "Ready"

check-ready "Check readiness"
s1 wait "Ready"`,
				})
				expect(offsets.calls).toEqual([[0], [2]])
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
				await toolset.tools.execute({ id: '1', name: 'look', arguments: { what: 'form' } })
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
					value: `Edited check-ready.

check-ready "Check readiness" (parameters: email)
s1 wait "Ready"
s3 type "sam@example.test" as email into textbox "Email"
s2 click combobox "Size"`,
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
				set: async (journey, expected, options) => {
					if (scripted.shift() === 'locked')
						throw new BrowserError('Journey check-ready is locked.', 'BROWSER_JOURNEY_LOCKED')
					return memory.set(journey, expected, options)
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
					'Element e9 is not in the current view; call look for fresh refs.',
					'Edit 2 is refused: it names unknown step "s9"; call journeys.',
					'Edit 1 is refused: it declares "email" but no step binds it; call journeys.',
					'Edit 1 is refused: it has a malformed edit or duplicate anchors; call journeys.',
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
					value: `Replayed check-ready: 2 of 2 steps.
s1 "Ready" is on the page.
s2 "Shipped" is on the page.

page "Form" https://example.test/form
e1 button "Save"
e2 textbox "Email"
e3 combobox "Size"
(3 of 3 elements)`,
				})
				expect(view.calls).toEqual(['wait Ready', 'wait Shipped', 'outline'])
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
					'Journey add-kettle has no parameter "emial"; call journeys.',
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
							'The journey file tmp/browsers/check-ready/journey.json is malformed.',
							'BROWSER_JOURNEY_FILE',
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
				await toolset.tools.execute({ id: '2', name: 'save', arguments: { description: 'Brew' } })
				const hold = await toolset.hold('add-kettle')
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'The toolset is replaying add-kettle until it finishes; call look.',
				)
				hold.destroy()
				mode = 'block'
				const first = toolset.tools.execute(replay)
				await waitForCondition(
					'the first replay claims the toolset',
					() => journeys.replaying !== undefined,
				)
				expect(readProperty(await toolset.tools.execute(replay), 'error')).toBe(
					'The toolset is replaying check-ready until it finishes; call look.',
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
				set: async (_journey, _expected, options) => {
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
					{ id: '2', name: 'journeys', arguments: { what: 'all' } },
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
				set: async (_journey, _expected, options) => {
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
				).toEqual([])
				await replaying.destroy()
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})

	describe('destroy', () => {
		it('aborts the active replay, waits for it, and removes the five tools', async () => {
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
				expect(toolset.tools.tool('look')).toBeDefined()
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
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			const store = createMemoryBrowserJourneyStore()
			const journeys = new BrowserJourneyToolset(toolset, { store })
			await toolset.start()
			try {
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

sign-in "Sign in" (parameters: email (secret))
s1 type (secret) as email into textbox "Email"`,
				})
				const listed = await toolset.tools.execute({
					id: '4',
					name: 'journeys',
					arguments: { what: 'all' },
				})
				const replayed = await toolset.tools.execute({
					id: '5',
					name: 'replay',
					arguments: { journey: 'sign-in', inputs: { email: 'private-replay-value' } },
				})
				expect(readProperty<string>(replayed, 'value')).toMatch(
					new RegExp(
						`^Replayed sign-in: 1 of 1 steps\\.\\ns1 Typed a secret into ${email.reference} textbox "Email"`,
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
