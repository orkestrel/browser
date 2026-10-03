import type { BrowserViewInterface } from '@src/core'
import { createRecorder, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	BrowserRecorder,
	BrowserToolset,
	createBrowserToolset,
	validateBrowserJourney,
	validateBrowserJourneyStep,
} from '@src/core'
import {
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_FRAMED_FIXTURE,
	createBrowserActionFixture,
	createBrowserElementFixture,
	createBrowserPopupFixture,
	createBrowserViewDouble,
	createCodegenBindingPayload,
	createCodegenGesture,
	createStartedCodegen,
} from '../../../setup.js'

describe('BrowserRecorder', () => {
	it('item 12 keeps done absence arguments and drops a timed out absence wait', async () => {
		for (const waited of [true, false]) {
			const toolset = new BrowserToolset(createBrowserViewDouble({ waited }))
			const recorder = new BrowserRecorder(toolset)
			try {
				await toolset.start()
				await recorder.start()
				await toolset.perform({
					id: 'gone',
					name: 'wait',
					arguments: { text: 'Saved', absent: true },
				})
				expect(recorder.steps().map((step) => step.arguments)).toEqual(
					waited ? [{ text: 'Saved', absent: true }] : [],
				)
			} finally {
				await recorder.destroy()
				await toolset.destroy()
			}
		}
	})
	it('starts with a gap when constructed after a hold was acquired', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const hold = await toolset.hold('add-kettle')
		const recorder = new BrowserRecorder(toolset)
		try {
			await recorder.start()
			await toolset.perform(
				{ id: 'held', name: 'click', arguments: { ref: 'e1' } },
				{ caller: hold.token, signal: new AbortController().signal },
			)
			expect(recorder.steps().map((step) => step.gap ?? step.action)).toEqual([
				'replayed add-kettle',
			])
			hold.destroy()
			await toolset.perform({ id: 'after', name: 'click', arguments: { ref: 'e1' } })
			expect(recorder.steps().map((step) => step.gap ?? step.action)).toEqual([
				'replayed add-kettle',
				'click',
			])
		} finally {
			hold.destroy()
			await recorder.destroy()
			await toolset.destroy()
		}
	})
	it('shares non-step membership between recording and step validation', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		try {
			await recorder.start()
			toolset.emitter.emit('action', createBrowserActionFixture({ action: 'look' }))
			expect.soft(recorder.steps(), 'recorder reads the non-step home').toEqual([])
			expect
				.soft(
					() => validateBrowserJourneyStep({ id: 's1', action: 'look', arguments: {} }),
					'validator reads the non-step home',
				)
				.toThrow('uses an observation or journey tool as a step')
			toolset.emitter.emit('action', createBrowserActionFixture())
			expect(recorder.steps().some((step) => step.action === 'click')).toBe(true)
			expect(() =>
				validateBrowserJourneyStep({
					id: 's1',
					action: 'click',
					arguments: {},
					target: { role: 'button', name: 'Save' },
				}),
			).not.toThrow()
		} finally {
			await recorder.destroy()
			await toolset.destroy()
		}
	})

	it('shares taken secret names between toolset and page recording', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		const { transport, client, codegen } = await createStartedCodegen('session-1', {
			role: 'textbox',
			name: 'Confirm Password',
		})
		try {
			await recorder.start()
			for (const index of [0, 1]) {
				toolset.emitter.emit(
					'action',
					createBrowserActionFixture({
						action: 'type',
						arguments: {},
						secret: true,
						target: { role: 'textbox', name: 'Confirm Password', reference: `e${index + 1}` },
					}),
				)
				transport.event(
					'Runtime.bindingCalled',
					createCodegenBindingPayload(
						createCodegenGesture({
							index,
							control: 'password',
							secret: true,
							value: undefined,
						}),
					),
					'session-1',
				)
			}
			expect
				.soft(
					recorder.steps().map((step) => step.arguments['text']),
					'toolset recorder reads taken names',
				)
				.toEqual([{ parameter: 'confirmPassword' }, { parameter: 'secret1' }])
			expect
				.soft(
					(await codegen.stop()).map((step) => step.arguments['text']),
					'page recorder reads taken names',
				)
				.toEqual([{ parameter: 'confirmPassword' }, { parameter: 'secret1' }])
		} finally {
			await recorder.destroy()
			await toolset.destroy()
			await codegen.destroy()
			await client.close()
		}
	})
	it('records completed actions with semantic targets and portable tab evidence', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		toolset.emitter.emit('action', createBrowserActionFixture())
		toolset.emitter.emit('action', {
			action: 'switch',
			arguments: { tab: 't2' },
			tab: { title: 'Cart', url: 'https://shop.test/cart' },
			outcome: 'done',
			receipt: 'Switched.',
			elapsed: 2,
		})
		expect(recorder.steps()).toEqual([
			{
				id: 's1',
				action: 'click',
				arguments: {},
				target: { role: 'button', name: 'Save', reference: 'e1' },
			},
			{
				id: 's2',
				action: 'switch',
				arguments: {},
				tab: { title: 'Cart', url: 'https://shop.test/cart' },
			},
		])
		await recorder.destroy()
		await toolset.destroy()
	})

	it('records the opener click after settlement moves the view to the popup', async () => {
		const fixture = await createBrowserPopupFixture()
		const toolset = createBrowserToolset(fixture.page)
		const recorder = new BrowserRecorder(toolset)
		const views = createRecorder<readonly [BrowserViewInterface]>()
		toolset.emitter.on('action', () => views.handler(toolset.view))
		try {
			await toolset.start()
			await fixture.page.elements.outline()
			await recorder.start()
			const performed = await toolset.perform({
				id: 's1',
				name: 'click',
				arguments: { ref: 'e4' },
			})
			expect(performed.action?.outcome).toBe('done')
			expect(performed.action?.tab).toEqual({ title: 'Details', url: 'https://example.test/popup' })
			expect(views.calls[0]?.[0]).toBe(toolset.view)
			expect(views.calls[0]?.[0]).not.toBe(fixture.page)
			expect(toolset.view.url).toBe('https://example.test/popup')
			expect(recorder.steps(), 'popup settlement preserves the opener click').toEqual([
				{
					id: 's1',
					action: 'click',
					arguments: {},
					target: { role: 'button', name: 'Place order', reference: 'e4' },
				},
			])
			expect(
				recorder.journey({ name: 'open-details', description: 'Open the details' }).steps,
			).toHaveLength(1)
			// The marker describes the dispatch, even when its id matches the later view.
			toolset.emitter.emit(
				'action',
				createBrowserActionFixture({
					target: { role: 'button', name: 'Save', reference: 'e1', frame: 'popup-1' },
				}),
			)
			expect(recorder.steps()[1], 'a present frame remains a gap after the popup move').toEqual({
				id: 's2',
				action: 'unresolved',
				arguments: {},
				gap: 'the element is in a child frame',
			})
		} finally {
			await recorder.destroy()
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('never records refused actions', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		toolset.emitter.emit('action', createBrowserActionFixture({ outcome: 'refused' }))
		expect(recorder.steps()).toEqual([])
		await recorder.destroy()
		await toolset.destroy()
	})

	it.each(['look', 'read', 'tabs', 'record', 'save', 'journeys', 'edit', 'replay'])(
		'never records %s',
		async (action) => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const recorder = new BrowserRecorder(toolset)
			await recorder.start()
			toolset.emitter.emit('action', createBrowserActionFixture({ action }))
			expect(recorder.steps()).toEqual([])
			await recorder.destroy()
			await toolset.destroy()
		},
	)

	it('records an interrupted action only with its immediately completed dialog', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		toolset.emitter.emit('action', createBrowserActionFixture({ outcome: 'interrupted' }))
		expect(recorder.steps()).toEqual([])
		expect(recorder.journey({ name: 'save', description: 'Save' }).steps).toEqual([
			{ id: 's1', action: 'unresolved', arguments: {}, gap: 'interrupted click' },
		])
		expect(recorder.started).toBe(true)
		expect(recorder.steps(), 'a snapshot preserves the pending dialog continuation').toEqual([])
		toolset.emitter.emit('action', {
			action: 'dialog',
			arguments: { accept: true },
			outcome: 'done',
			receipt: 'Accepted.',
			elapsed: 1,
		})
		expect((await recorder.stop()).map((step) => step.action)).toEqual(['click', 'dialog'])
		expect(() =>
			validateBrowserJourney(recorder.journey({ name: 'save', description: 'Save' })),
		).not.toThrow()
		await recorder.destroy()
		await toolset.destroy()
	})

	it.each(['click', 'look', 'refused', 'stop'])(
		'turns interruption into a gap before %s',
		async (next) => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const recorder = new BrowserRecorder(toolset)
			await recorder.start()
			toolset.emitter.emit('action', createBrowserActionFixture({ outcome: 'interrupted' }))
			if (next !== 'stop')
				toolset.emitter.emit(
					'action',
					createBrowserActionFixture(
						next === 'refused' ? { outcome: 'refused' } : { action: next },
					),
				)
			const steps = await recorder.stop()
			expect(steps[0]).toMatchObject({ id: 's1', action: 'unresolved', gap: 'interrupted click' })
			expect(steps.length).toBe(next === 'click' ? 2 : 1)
			await recorder.destroy()
			await toolset.destroy()
		},
	)

	it('records a same-origin child-frame click as a gap', async () => {
		const fixture = await createBrowserElementFixture({
			local: true,
			accessibility: (message) =>
				fixture.transport.reply(
					message.id,
					message.params?.['frameId'] === 'child'
						? BROWSER_ELEMENT_FRAMED_FIXTURE
						: BROWSER_ELEMENT_AX_FIXTURE,
				),
		})
		const toolset = createBrowserToolset(fixture.page)
		const recorder = new BrowserRecorder(toolset)
		try {
			await toolset.start()
			await fixture.page.elements.outline()
			const element = requireValue(
				(await fixture.page.elements.find({ role: 'button', name: 'Save' }))[0],
			)
			await recorder.start()
			const performed = await toolset.perform({
				id: 's1',
				name: 'click',
				arguments: { ref: element.reference },
			})
			expect(performed.action?.outcome).toBe('done')
			expect(performed.action?.target?.frame).toBe('child')
			expect(recorder.steps()).toEqual([
				{
					id: 's1',
					action: 'unresolved',
					arguments: {},
					gap: 'the element is in a child frame',
				},
			])
		} finally {
			await recorder.destroy()
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('derives secret bindings without copying values and uses collision and invalid-name fallbacks', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		for (const name of ['Confirm Password', 'Confirm Password', '123'])
			toolset.emitter.emit(
				'action',
				createBrowserActionFixture({
					action: 'type',
					arguments: { ref: 'e1', text: 'never-record-this', secret: true, submit: true },
					secret: true,
					target: { role: 'textbox', name, reference: 'e1' },
				}),
			)
		const journey = recorder.journey({ name: 'sign-in', description: 'Sign in' })
		expect(journey.parameters).toEqual({
			confirmPassword: { secret: true },
			secret1: { secret: true },
			secret2: { secret: true },
		})
		expect(journey.steps.map((step) => step.arguments)).toEqual([
			{ text: { parameter: 'confirmPassword' }, submit: true },
			{ text: { parameter: 'secret1' }, submit: true },
			{ text: { parameter: 'secret2' }, submit: true },
		])
		expect(JSON.stringify(journey)).not.toContain('never-record-this')
		expect(journey.next).toBe(4)
		await recorder.destroy()
		await toolset.destroy()
	})

	it('preserves literal adopted-tool arguments and omits timeout actions', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		toolset.emitter.emit('action', {
			action: 'quote',
			arguments: { ref: 'literal', value: { parameter: 'literal' } },
			outcome: 'done',
			receipt: 'Quoted.',
			elapsed: 1,
		})
		toolset.emitter.emit('action', {
			action: 'wait',
			arguments: { text: 'Done' },
			outcome: 'timeout',
			receipt: 'Timed out.',
			elapsed: 1,
		})
		expect(recorder.steps()[0]?.arguments).toEqual({
			ref: 'literal',
			value: { parameter: 'literal' },
		})
		expect(recorder.steps()).toHaveLength(1)
		await recorder.destroy()
		await toolset.destroy()
	})

	it('collapses held actions to one named gap and resumes after release', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		const hold = await toolset.hold('add-kettle')
		toolset.emitter.emit('action', createBrowserActionFixture())
		toolset.emitter.emit('action', createBrowserActionFixture())
		hold.destroy()
		toolset.emitter.emit('action', createBrowserActionFixture())
		expect(recorder.steps().map((step) => step.gap ?? step.action)).toEqual([
			'replayed add-kettle',
			'click',
		])
		await recorder.destroy()
		await toolset.destroy()
	})

	it('clears on start, returns owned snapshots, emits lifecycle events, and unsubscribes', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const events: string[] = []
		const recorder = new BrowserRecorder(toolset, {
			on: {
				start: () => events.push('start'),
				clear: () => events.push('clear'),
				step: (step) => {
					events.push(step.id)
					Reflect.set(step, 'action', 'mutated')
				},
				stop: () => events.push('stop'),
			},
		})
		toolset.emitter.emit('action', createBrowserActionFixture())
		expect(recorder.steps()).toEqual([])
		await recorder.start()
		toolset.emitter.emit('action', createBrowserActionFixture())
		const snapshot = recorder.steps()[0]
		if (snapshot !== undefined) Reflect.set(snapshot, 'action', 'mutated')
		expect((await recorder.stop())[0]?.action).toBe('click')
		expect(recorder.started).toBe(false)
		toolset.emitter.emit('action', createBrowserActionFixture())
		expect(recorder.steps()).toHaveLength(1)
		await recorder.start()
		expect(recorder.steps()).toEqual([])
		expect(events).toEqual(['clear', 'start', 's1', 'stop', 'clear', 'start'])
		await recorder.destroy()
		expect(toolset.emitter.count('action')).toBe(0)
		expect(toolset.emitter.count('hold')).toBe(0)
		expect(toolset.emitter.count('release')).toBe(0)
		await expect(recorder.start()).rejects.toThrow('destroyed')
		await toolset.destroy()
	})
})
