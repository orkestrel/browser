import type {
	BrowserRun,
	BrowserRunSlot,
	BrowserRunStep,
	BrowserStoreOptions,
	BrowserToolSourceEventMap,
} from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { describe, expect, it } from 'vitest'
import { Emitter } from '@orkestrel/emitter'
import { createTool } from '@orkestrel/tool'
import { createRecorder, requireValue, waitForCondition } from '@orkestrel/test'
import {
	BrowserContext,
	BrowserReplay,
	BrowserToolset,
	MemoryBrowserRunStore,
	createBrowserToolset,
	renderBrowserRun,
	validateBrowserRun,
} from '@src/core'
import {
	BROWSER_SELECT_SECRET,
	RecordingBrowserRunStore,
	createBrowserSecretSelectFixture,
	createBrowserElementFixture,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
	PNG_BASE64,
	replyOk,
} from '../../setup.js'

describe('BrowserReplay', () => {
	it('keeps an upstream secret select refusal out of the recorded run and render', async () => {
		const fixture = await createBrowserSecretSelectFixture(
			`No option ${JSON.stringify(BROWSER_SELECT_SECRET)} or ${BROWSER_SELECT_SECRET}`,
		)
		const toolset = createBrowserToolset(fixture.page)
		const runs = new RecordingBrowserRunStore()
		const steps = createRecorder<readonly [BrowserRunStep]>()
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
		try {
			await toolset.start()
			const run = await new BrowserReplay(
				toolset,
				{ journey },
				{
					inputs: { password: BROWSER_SELECT_SECRET },
					on: { step: steps.handler },
					runs,
				},
			).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps[0]).toMatchObject({ outcome: 'refused', arguments: { secret: true } })
			expect(run.steps[0]?.result).toContain('No option')
			expect(runs.writes.count).toBeGreaterThan(0)
			expect(steps.count).toBe(1)
			expect(JSON.stringify(runs.writes.calls)).not.toContain('Zq7#')
			expect(JSON.stringify(steps.calls)).not.toContain('Zq7#')
			expect(JSON.stringify(run)).not.toContain('Zq7#')
			expect(renderBrowserRun(run)).not.toContain('Zq7#')
			expect(await runs.get(journey.name, run.id)).toEqual(run)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('refuses a secret bound to wait.text before taking a hold or writing a run', async () => {
		const view = createBrowserViewDouble()
		const toolset = new BrowserToolset(view)
		const holds = createRecorder<readonly [string]>()
		toolset.emitter.on('hold', holds.handler)
		await toolset.start()
		const journey = createBrowserJourneyFixture(
			[{ action: 'wait', arguments: { text: { parameter: 'password' } } }],
			{ parameters: { password: { secret: true } } },
		)
		const runs = new MemoryBrowserRunStore()
		try {
			await expect(
				new BrowserReplay(toolset, { journey }, { runs, inputs: { password: 'Ready' } }).execute(),
			).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_INVALID',
				context: { action: 'replay', placement: 'dom' },
			})
			expect(holds.count).toBe(0)
			expect(view.calls).toEqual([])
			expect((await runs.list(journey.name)).entries).toEqual([])
		} finally {
			await toolset.destroy()
		}
	})
	it('validates before taking a hold or writing a run', async () => {
		const view = createBrowserViewDouble()
		const toolset = new BrowserToolset(view)
		const holds = createRecorder<readonly [string]>()
		toolset.emitter.on('hold', holds.handler)
		await toolset.start()
		const journey = createBrowserJourneyFixture()
		Reflect.set(journey, 'format', 9)
		const runs = new MemoryBrowserRunStore()
		try {
			await expect(
				new BrowserReplay(toolset, { journey }, { runs }).execute(),
			).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_FORMAT',
				context: { action: 'replay', placement: 'dom' },
			})
			expect(holds.count).toBe(0)
			expect(view.calls).toEqual([])
			expect((await runs.list(journey.name)).entries).toEqual([])
		} finally {
			await toolset.destroy()
		}
	})

	it('refuses missing and unknown inputs and gaps before any side effect', async () => {
		const view = createBrowserViewDouble()
		const toolset = new BrowserToolset(view)
		const holds = createRecorder<readonly [string]>()
		toolset.emitter.on('hold', holds.handler)
		await toolset.start()
		const runs = new MemoryBrowserRunStore()
		const journey = createBrowserJourneyFixture(
			[{ action: 'wait', arguments: { text: { parameter: 'status' } } }],
			{ parameters: { status: {} } },
		)
		try {
			await expect(
				new BrowserReplay(toolset, { journey }, { runs }).execute(),
			).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_INPUT', context: { parameter: 'status' } })
			expect(holds.count).toBe(0)
			expect(view.calls).toEqual([])
			await expect(
				new BrowserReplay(
					toolset,
					{ journey },
					{ runs, inputs: { status: 'Ready', extra: 'unknown' } },
				).execute(),
			).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_INPUT', context: { parameter: 'extra' } })
			expect(holds.count).toBe(0)
			expect(view.calls).toEqual([])
			const gap = createBrowserJourneyFixture([
				{ action: 'wait', arguments: { text: 'Ready' } },
				{ action: 'unresolved', arguments: {}, gap: 'child frame' },
			])
			await expect(
				new BrowserReplay(toolset, { journey: gap }, { runs }).execute(),
			).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_GAP', context: { step: 's2' } })
			expect(holds.count).toBe(0)
			expect(view.calls).toEqual([])
			expect((await runs.list(journey.name)).entries).toEqual([])
		} finally {
			await toolset.destroy()
		}
	})

	it.each(['press', 'navigate', 'dialog', 'switch'])(
		'refuses unsupported %s before a supported prefix',
		async (action) => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			const holds = createRecorder<readonly [string]>()
			toolset.emitter.on('hold', holds.handler)
			await toolset.start()
			const unsupported =
				action === 'press'
					? { action, arguments: { key: 'Enter' } }
					: action === 'navigate'
						? { action, arguments: { url: 'https://example.test/' } }
						: action === 'dialog'
							? { action, arguments: { accept: true } }
							: { action, arguments: {}, tab: { url: 'https://example.test/', title: 'Example' } }
			const journey = createBrowserJourneyFixture([
				{ action: 'wait', arguments: { text: 'Ready' } },
				unsupported,
			])
			try {
				await expect(new BrowserReplay(toolset, { journey }).execute()).rejects.toMatchObject({
					code: 'BROWSER_JOURNEY_PLACEMENT',
					context: { step: 's2', action, placement: 'dom' },
				})
				expect(holds.count).toBe(0)
				expect(view.calls).toEqual([])
			} finally {
				await toolset.destroy()
			}
		},
	)

	it('merges inputs over defaults, writes the run, and emits owned step snapshots', async () => {
		const view = createBrowserViewDouble()
		const toolset = new BrowserToolset(view)
		await toolset.start()
		const journey = createBrowserJourneyFixture(
			[{ action: 'wait', arguments: { text: { parameter: 'status' } } }],
			{ parameters: { status: { default: 'Default' } } },
		)
		const runs = new MemoryBrowserRunStore()
		const emitted: BrowserRunStep[] = []
		try {
			const run = await new BrowserReplay(
				toolset,
				{ journey, revision: 7 },
				{
					inputs: { status: 'Ready' },
					runs,
					on: {
						step: (step) => {
							emitted.push(structuredClone(step))
							Reflect.set(step, 'result', 'changed')
						},
					},
				},
			).execute()
			expect(view.calls).toEqual(['wait Ready'])
			expect(run).toMatchObject({
				revision: 7,
				inputs: { status: 'Ready' },
				outcome: 'complete',
				steps: [{ id: 's1', trigger: 'Ready', arguments: { text: 'Ready' }, outcome: 'done' }],
			})
			expect(run.steps).toEqual(emitted)
			expect(run).not.toHaveProperty('output')
			expect(await runs.get(journey.name, run.id)).toEqual(run)
			expect(journey.steps[0]?.arguments).toEqual({ text: { parameter: 'status' } })
			expect(() => validateBrowserRun(run)).not.toThrow()
			const defaults = await new BrowserReplay(toolset, { journey }).execute()
			expect(defaults.inputs).toEqual({ status: 'Default' })
		} finally {
			await toolset.destroy()
		}
	})

	it('stops after timeout without executing a suffix step', async () => {
		const view = createBrowserViewDouble({ waited: false })
		const toolset = new BrowserToolset(view)
		await toolset.start()
		const journey = createBrowserJourneyFixture([
			{ action: 'wait', arguments: { text: 'Absent' } },
			{ action: 'wait', arguments: { text: 'Forbidden suffix' } },
		])
		try {
			const run = await new BrowserReplay(toolset, { journey }).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps).toHaveLength(1)
			expect(run.steps[0]?.outcome).toBe('timeout')
			expect(view.calls).toEqual(['wait Absent'])
		} finally {
			await toolset.destroy()
		}
	})

	it('preserves the executed prefix when a later target refuses', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		const journey = createBrowserJourneyFixture([
			{ action: 'press', arguments: { key: 'Escape' } },
			{
				action: 'click',
				arguments: {},
				target: { role: 'button', name: 'Missing', css: '#save', reference: 'e4' },
			},
			{ action: 'press', arguments: { key: 'Enter' } },
		])
		try {
			const run = await new BrowserReplay(toolset, { journey }).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps.map((step) => step.outcome)).toEqual(['done', 'refused'])
			expect(run.steps[1]?.result).toContain('Step s2 names button "Missing"')
			expect(
				fixture.transport.sent.filter((message) => message.method === 'Input.dispatchMouseEvent'),
			).toEqual([])
			expect(
				fixture.transport.sent
					.filter((message) => message.method === 'Input.dispatchKeyEvent')
					.map((message) => message.params?.['key']),
			).toEqual(['Escape', 'Escape'])
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('judges manager refusal with no action and stops there', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const journey = createBrowserJourneyFixture([
			{ action: 'absent-tool', arguments: {} },
			{ action: 'wait', arguments: { text: 'Forbidden' } },
		])
		try {
			const run = await new BrowserReplay(toolset, { journey }).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps).toHaveLength(1)
			expect(run.steps[0]).toMatchObject({
				action: 'absent-tool',
				trigger: 'absent-tool',
				outcome: 'refused',
			})
			expect(run.steps[0]?.result).toContain('absent-tool')
		} finally {
			await toolset.destroy()
		}
	})

	it('passes adopted arguments literally through the held toolset', async () => {
		const called = createRecorder<readonly [unknown]>()
		const tool = createTool({
			name: 'quote',
			description: 'Quote a basket',
			parameters: {
				type: 'object',
				properties: { basket: { type: 'object' } },
				required: ['basket'],
			},
			execute: (args) => {
				called.handler(args)
				return 'Quoted'
			},
		})
		const toolset = new BrowserToolset(createBrowserViewDouble(), {
			source: { emitter: new Emitter<BrowserToolSourceEventMap>(), adopt: async () => [tool] },
		})
		await toolset.start()
		const args = { basket: { parameter: 'literal', values: ['kettle'] } }
		try {
			const run = await new BrowserReplay(toolset, {
				journey: createBrowserJourneyFixture([{ action: 'quote', arguments: args }]),
			}).execute()
			expect(run.outcome).toBe('complete')
			expect(called.calls).toEqual([[args]])
			expect(run.steps[0]?.arguments).toEqual(args)
		} finally {
			await toolset.destroy()
		}
	})

	it('continues interruption through exactly the next dialog and then the pending input', async () => {
		const withheld: CDPSentMessage[] = []
		const fixture = await createBrowserElementFixture({
			released: (message) => withheld.push(message),
		})
		const toolset = createBrowserToolset(fixture.page)
		replyOk(fixture.transport, 'Page.handleJavaScriptDialog')
		await toolset.start()
		const journey = createBrowserJourneyFixture([
			{ action: 'click', arguments: {}, target: { role: 'button', name: 'Place order' } },
			{ action: 'dialog', arguments: { accept: true } },
			{ action: 'press', arguments: { key: 'Escape' } },
		])
		const replay = new BrowserReplay(
			toolset,
			{ journey },
			{
				on: {
					step: (step) => {
						if (step.action === 'dialog') fixture.transport.reply(requireValue(withheld[0]).id, {})
					},
				},
			},
		)
		try {
			const pending = replay.execute()
			await waitForCondition('replay click awaits its release', () => withheld.length === 1)
			fixture.transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Continue?' },
				'session-main',
			)
			const run = await pending
			expect(run.outcome).toBe('complete')
			expect(run.steps.map((step) => step.outcome)).toEqual(['interrupted', 'done', 'done'])
			expect(run.steps.map((step) => step.trigger)).toEqual(['Place order', 'accept', 'Escape'])
			expect(
				fixture.transport.sent.filter(
					(message) => message.method === 'Page.handleJavaScriptDialog',
				),
			).toHaveLength(1)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('skips capture after an interrupted step and reaches its dialog', async () => {
		const withheld: CDPSentMessage[] = []
		const fixture = await createBrowserElementFixture({
			released: (message) => withheld.push(message),
		})
		const toolset = createBrowserToolset(fixture.page)
		const memory = new MemoryBrowserRunStore()
		const captures = createRecorder<readonly [string]>()
		const screenshots = createRecorder<readonly [boolean]>()
		let dialog = false
		fixture.transport.onSend('Page.handleJavaScriptDialog', (message) => {
			dialog = false
			fixture.transport.reply(message.id, {})
		})
		fixture.transport.onSend('Page.captureScreenshot', () => {
			screenshots.handler(dialog)
		})
		await toolset.start()
		try {
			const pending = new BrowserReplay(
				toolset,
				{
					journey: createBrowserJourneyFixture([
						{ action: 'click', arguments: {}, target: { role: 'button', name: 'Place order' } },
						{ action: 'dialog', arguments: { accept: true } },
						{ action: 'press', arguments: { key: 'Escape' } },
					]),
				},
				{
					runs: {
						open: async (name, options) => ({
							...(await memory.open(name, options)),
							directory: '/opened-run',
						}),
						capture: async (_slot, name) => {
							captures.handler(name)
							if (dialog) throw new Error('Dialog blocks capture')
							return name
						},
						get: memory.get.bind(memory),
						set: memory.set.bind(memory),
						list: memory.list.bind(memory),
						delete: memory.delete.bind(memory),
					},
					on: {
						step: (step) => {
							if (step.action === 'dialog')
								fixture.transport.reply(requireValue(withheld[0]).id, {})
						},
					},
				},
			).execute()
			await waitForCondition('click awaits release before dialog', () => withheld.length === 1)
			dialog = true
			fixture.transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Continue?' },
				'session-main',
			)
			const run = await pending
			expect(run.outcome).toBe('complete')
			expect(run.fault).toBeUndefined()
			expect(run.steps.map((step) => step.outcome)).toEqual(['interrupted', 'done', 'done'])
			expect(run.steps[0]).not.toHaveProperty('capture')
			expect(captures.calls).toEqual([['s2.png'], ['s3.png']])
			expect(screenshots.calls).toEqual([[false], [false]])
			expect(
				fixture.transport.sent.filter(
					(message) => message.method === 'Page.handleJavaScriptDialog',
				),
			).toHaveLength(1)
		} finally {
			for (const message of withheld) fixture.transport.reply(message.id, {})
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('stops an interruption when the next step is not a dialog', async () => {
		const withheld: CDPSentMessage[] = []
		const fixture = await createBrowserElementFixture({
			released: (message) => withheld.push(message),
		})
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		try {
			const journey = createBrowserJourneyFixture([
				{ action: 'click', arguments: {}, target: { role: 'button', name: 'Place order' } },
				{ action: 'press', arguments: { key: 'Escape' } },
			])
			const pending = new BrowserReplay(toolset, { journey }).execute()
			await waitForCondition('the interrupted input has begun', () => withheld.length === 1)
			fixture.transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Continue?' },
				'session-main',
			)
			const run = await pending
			expect(run.outcome).toBe('stopped')
			expect(run.steps).toHaveLength(1)
			expect(run.steps[0]?.outcome).toBe('interrupted')
			expect(
				fixture.transport.sent.filter((message) => message.method === 'Input.dispatchKeyEvent'),
			).toEqual([])
			fixture.transport.reply(requireValue(withheld[0]).id, {})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('admits a context switch at preparation and resolves its tab when reached', async () => {
		const fixture = await createBrowserElementFixture()
		const context = new BrowserContext(fixture.client)
		const toolset = createBrowserToolset(fixture.page, { context })
		await toolset.start()
		try {
			const journey = createBrowserJourneyFixture([
				{
					action: 'switch',
					arguments: {},
					tab: { title: 'Missing tab', url: 'https://example.test/missing' },
				},
			])
			const run = await new BrowserReplay(toolset, { journey }).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps[0]).toMatchObject({
				action: 'switch',
				trigger: 'Missing tab',
				outcome: 'refused',
			})
			expect(run.steps[0]?.result).toContain('not open')
		} finally {
			await toolset.destroy()
			await context.destroy()
			await fixture.client.close()
		}
	})

	it('refuses a dialog opened between steps without answering it', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		replyOk(fixture.transport, 'Page.handleJavaScriptDialog')
		await toolset.start()
		try {
			const run = await new BrowserReplay(
				toolset,
				{
					journey: createBrowserJourneyFixture([
						{ action: 'press', arguments: { key: 'Escape' } },
						{ action: 'dialog', arguments: { accept: true } },
					]),
				},
				{
					on: {
						step: (step) => {
							if (step.id === 's1')
								fixture.transport.event(
									'Page.javascriptDialogOpening',
									{
										type: 'confirm',
										message: 'Between steps',
									},
									'session-main',
								)
						},
					},
				},
			).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps.map((step) => step.outcome)).toEqual(['done', 'refused'])
			expect(run.steps[1]?.result).toBe('Step s2 answers no interrupted action.')
			expect(
				fixture.transport.sent.filter(
					(message) => message.method === 'Page.handleJavaScriptDialog',
				),
			).toEqual([])
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('destroys the hold on abort, writes under a fresh signal, and never runs the suffix', async () => {
		const withheld: CDPSentMessage[] = []
		const fixture = await createBrowserElementFixture({
			insert: (message) => withheld.push(message),
		})
		const toolset = createBrowserToolset(fixture.page)
		const release = createRecorder<readonly [string]>()
		toolset.emitter.on('release', release.handler)
		await toolset.start()
		const controller = new AbortController()
		const runs = new MemoryBrowserRunStore()
		const journey = createBrowserJourneyFixture([
			{ action: 'type', arguments: { text: 'Harbor' }, target: { role: 'textbox', name: 'Email' } },
			{ action: 'press', arguments: { key: 'Escape' } },
		])
		try {
			const pending = new BrowserReplay(toolset, { journey }, { runs }).execute({
				signal: controller.signal,
			})
			await waitForCondition('the held input reaches the protocol', () => withheld.length === 1)
			controller.abort(new Error('stop replay'))
			const run = await pending
			expect(run.outcome).toBe('aborted')
			expect(release.calls).toEqual([[journey.name]])
			expect(run.steps).toHaveLength(1)
			expect(
				fixture.transport.sent.filter((message) => message.method === 'Input.dispatchKeyEvent'),
			).toEqual([])
			expect(await runs.get(journey.name, run.id)).toEqual(run)
			fixture.transport.reply(requireValue(withheld[0]).id, {})
			const hold = await toolset.hold('after-abort')
			hold.destroy()
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('reports a run write failure in fault after releasing the hold', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const runs = new MemoryBrowserRunStore()
		const saved = createRecorder<readonly [BrowserRun, boolean]>()
		const releases = createRecorder<readonly [string]>()
		toolset.emitter.on('release', releases.handler)
		try {
			const run = await new BrowserReplay(
				toolset,
				{ journey: createBrowserJourneyFixture() },
				{
					runs: {
						open: runs.open.bind(runs),
						capture: runs.capture.bind(runs),
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: async (value, options) => {
							saved.handler(value, options?.signal?.aborted ?? true)
							expect(releases.count).toBe(1)
							throw new Error('disk full')
						},
					},
				},
			).execute()
			expect(run.outcome).toBe('complete')
			expect(run.fault).toBe('disk full')
			expect(saved.count).toBe(1)
			expect(saved.calls[0]?.[1]).toBe(false)
		} finally {
			await toolset.destroy()
		}
	})

	it('collects page console and error output and releases its subscriptions', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		const consoles = fixture.page.emitter.count('console')
		const errors = fixture.page.emitter.count('error')
		try {
			const run = await new BrowserReplay(
				toolset,
				{
					journey: createBrowserJourneyFixture([{ action: 'press', arguments: { key: 'Escape' } }]),
				},
				{
					on: {
						step: () => {
							fixture.page.emitter.emit('console', {
								level: 'log',
								text: 'Submitted',
								values: [],
								timestamp: 1,
								stack: [],
							})
							fixture.page.emitter.emit('error', {
								message: 'Page warning',
								timestamp: 2,
								stack: [],
							})
						},
					},
				},
			).execute()
			expect(run.output).toEqual(['Submitted', 'Page warning'])
			expect(fixture.page.emitter.count('console')).toBe(consoles)
			expect(fixture.page.emitter.count('error')).toBe(errors)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('bounds a run write even when the store ignores its signal', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const runs = new MemoryBrowserRunStore()
		const pending = Promise.withResolvers<void>()
		let signal: AbortSignal | undefined
		try {
			const run = await new BrowserReplay(
				toolset,
				{ journey: createBrowserJourneyFixture() },
				{
					runs: {
						open: runs.open.bind(runs),
						capture: runs.capture.bind(runs),
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: (_value, options) => {
							signal = options?.signal
							return pending.promise
						},
					},
				},
			).execute()
			expect(run.outcome).toBe('complete')
			expect(run.fault).toBe('Writing the run timed out')
			expect(signal?.aborted).toBe(true)
		} finally {
			pending.resolve()
			await toolset.destroy()
		}
	})

	it('captures bytes through the opened store slot without passing a path to the page', async () => {
		const captures =
			createRecorder<
				readonly [BrowserRunSlot, string, Uint8Array, BrowserStoreOptions | undefined]
			>()
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		replyOk(fixture.transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
		const runs = new MemoryBrowserRunStore()
		const slot = { ...(await runs.open('check-ready')), directory: '/opened-run' }
		const signal = new AbortController().signal
		try {
			const run = await new BrowserReplay(
				toolset,
				{
					journey: createBrowserJourneyFixture([{ action: 'press', arguments: { key: 'Escape' } }]),
				},
				{
					runs: {
						open: async () => slot,
						capture: async (opened, name, bytes, options) => {
							captures.handler(opened, name, bytes, options)
							return 'stored.png'
						},
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: runs.set.bind(runs),
					},
				},
			).execute({ signal, timeout: 500 })
			expect(run.fault, 'the page receives no path requiring a file writer').toBeUndefined()
			expect(run.outcome).toBe('complete')
			expect(run.steps[0]?.capture).toBe('stored.png')
			expect(captures.calls).toEqual([
				[slot, 's1.png', new Uint8Array([137, 80, 78, 71, 13]), { signal }],
			])
			expect(captures.calls[0]?.[0]).toBe(slot)
			expect(await runs.get(run.journey.name, slot.id)).toEqual(run)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('omits capture names with a memory store and takes no screenshot without a run store', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		const journey = createBrowserJourneyFixture([{ action: 'press', arguments: { key: 'Escape' } }])
		try {
			const unstored = await new BrowserReplay(toolset, { journey }).execute()
			expect(unstored.outcome).toBe('complete')
			expect(unstored.steps[0]).not.toHaveProperty('capture')
			expect(
				fixture.transport.sent.filter((message) => message.method === 'Page.captureScreenshot'),
			).toEqual([])
			const runs = new MemoryBrowserRunStore()
			const stored = await new BrowserReplay(toolset, { journey }, { runs }).execute()
			expect(stored.outcome).toBe('complete')
			expect(stored.fault).toBeUndefined()
			expect(stored.steps[0]).not.toHaveProperty('capture')
			expect(
				fixture.transport.sent.filter((message) => message.method === 'Page.captureScreenshot'),
			).toHaveLength(1)
			expect(await runs.get(journey.name, stored.id)).toEqual(stored)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('omits captures for an untrusted view even when a store supplies a directory', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const runs = new MemoryBrowserRunStore()
		const captures = createRecorder<readonly [BrowserRunSlot, string, Uint8Array]>()
		try {
			const run = await new BrowserReplay(
				toolset,
				{ journey: createBrowserJourneyFixture() },
				{
					runs: {
						open: async (name, options) => ({
							...(await runs.open(name, options)),
							directory: '/opened-run',
						}),
						capture: async (slot, name, bytes) => {
							captures.handler(slot, name, bytes)
							return name
						},
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: runs.set.bind(runs),
					},
				},
			).execute()
			expect(run.outcome).toBe('complete')
			expect(run.steps[0]).not.toHaveProperty('capture')
			expect(captures.count).toBe(0)
		} finally {
			await toolset.destroy()
		}
	})

	it('retains the executed step and releases the hold when capture fails', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		replyOk(fixture.transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
		const runs = new MemoryBrowserRunStore()
		const emitted = createRecorder<readonly [BrowserRunStep]>()
		try {
			const run = await new BrowserReplay(
				toolset,
				{
					journey: createBrowserJourneyFixture([
						{ action: 'press', arguments: { key: 'Escape' } },
						{ action: 'press', arguments: { key: 'Enter' } },
					]),
				},
				{
					on: { step: emitted.handler },
					runs: {
						open: runs.open.bind(runs),
						capture: async () => {
							throw new Error('capture refused')
						},
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: runs.set.bind(runs),
					},
				},
			).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps).toHaveLength(1)
			expect(run.steps[0]?.outcome).toBe('done')
			expect(run.steps[0]).not.toHaveProperty('capture')
			expect(run.fault).toContain('capture refused')
			expect(emitted.count).toBe(1)
			expect(emitted.calls[0]?.[0]).toEqual(run.steps[0])
			expect(await runs.get(run.journey.name, run.id)).toEqual(run)
			const hold = await toolset.hold('after-capture')
			hold.destroy()
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it(
		'stops a requested navigation before the suffix even when the action reports done',
		{ timeout: 15_000 },
		async () => {
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					fixture.transport.event(
						'Page.frameRequestedNavigation',
						{
							frameId: 'main',
							reason: 'anchorClick',
							url: 'https://example.test/next',
							disposition: 'currentTab',
						},
						'session-main',
					)
					fixture.transport.reply(message.id, {})
				},
			})
			const toolset = createBrowserToolset(fixture.page)
			await toolset.start()
			try {
				const journey = createBrowserJourneyFixture([
					{ action: 'click', arguments: {}, target: { role: 'link', name: 'Home' } },
					{ action: 'press', arguments: { key: 'Escape' } },
				])
				const run = await new BrowserReplay(toolset, { journey }).execute()
				expect(run.outcome).toBe('stopped')
				expect(run.steps).toHaveLength(1)
				expect(run.steps[0]).toMatchObject({
					outcome: 'done',
					stage: 'requested',
					reason: 'anchorClick',
				})
				expect(
					fixture.transport.sent.filter((message) => message.method === 'Input.dispatchKeyEvent'),
				).toEqual([])
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		},
	)

	it('rejects a destroyed toolset before creating a run', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		await toolset.destroy()
		const runs = new MemoryBrowserRunStore()
		await expect(
			new BrowserReplay(toolset, { journey: createBrowserJourneyFixture() }, { runs }).execute(),
		).rejects.toThrow('session ended')
		expect((await runs.list('check-ready')).entries).toEqual([])
	})

	it('binds a secret, forwards its flag, and omits the value, output, and captures from the run', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		await toolset.start()
		const journey = createBrowserJourneyFixture(
			[
				{
					action: 'type',
					arguments: { text: { parameter: 'password' } },
					target: { role: 'textbox', name: 'Email' },
				},
			],
			{ parameters: { password: { secret: true } } },
		)
		const runs = new MemoryBrowserRunStore()
		try {
			const run = await new BrowserReplay(
				toolset,
				{ journey },
				{
					inputs: { password: 'private-replay-value' },
					runs: {
						open: async (name, options) => ({
							...(await runs.open(name, options)),
							directory: '/secret-run',
						}),
						capture: runs.capture.bind(runs),
						get: runs.get.bind(runs),
						list: runs.list.bind(runs),
						delete: runs.delete.bind(runs),
						set: runs.set.bind(runs),
					},
					on: {
						step: () => {
							fixture.page.emitter.emit('console', {
								level: 'log',
								text: 'private-replay-value',
								values: [],
								timestamp: 1,
								stack: [],
							})
						},
					},
				},
			).execute()
			expect(run.outcome).toBe('complete')
			expect(run.inputs).toEqual({})
			expect(run.steps[0]?.arguments).toMatchObject({ secret: true })
			expect(run.steps[0]?.result).toMatch(/^Typed a secret into/)
			expect(run).not.toHaveProperty('output')
			expect(run.steps[0]).not.toHaveProperty('capture')
			expect(JSON.stringify(run)).not.toContain('private-replay-value')
			expect(renderBrowserRun(run)).not.toContain('private-replay-value')
			expect(JSON.stringify(await runs.get(journey.name, run.id))).not.toContain(
				'private-replay-value',
			)
			expect(
				fixture.transport.sent.some(
					(message) =>
						message.method === 'Input.insertText' &&
						message.params?.['text'] === 'private-replay-value',
				),
			).toBe(true)
			expect(
				fixture.transport.sent.some((message) => message.method === 'Page.captureScreenshot'),
			).toBe(false)
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
})
