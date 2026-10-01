import { describe, expect, it } from 'vitest'
import { BrowserRecorder, BrowserToolset, validateBrowserJourney } from '@src/core'
import { createBrowserActionFixture, createBrowserViewDouble } from '../../../setup.js'

describe('BrowserRecorder', () => {
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

	it('marks child frames and preserves main-frame targets', async () => {
		const view = createBrowserViewDouble()
		Reflect.set(view, 'id', 'main')
		const toolset = new BrowserToolset(view)
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		for (const frame of ['main', 'child'])
			toolset.emitter.emit(
				'action',
				createBrowserActionFixture({
					target: { role: 'button', name: 'Save', reference: 'e1', frame },
				}),
			)
		expect(recorder.steps()[0]?.target).toEqual({ role: 'button', name: 'Save', reference: 'e1' })
		expect(recorder.steps()[1]).toEqual({
			id: 's2',
			action: 'unresolved',
			arguments: {},
			gap: 'the element is in a child frame',
		})
		await recorder.destroy()
		await toolset.destroy()
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

	it('preserves literal adopted-tool arguments and turns timeout into a gap', async () => {
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
		expect(recorder.steps()[1]?.gap).toBe('timeout wait')
		await recorder.destroy()
		await toolset.destroy()
	})

	it('collapses held actions to one named gap and resumes after release', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const recorder = new BrowserRecorder(toolset)
		await recorder.start()
		toolset.emitter.emit('hold', 'add-kettle')
		toolset.emitter.emit('action', createBrowserActionFixture())
		toolset.emitter.emit('action', createBrowserActionFixture())
		toolset.emitter.emit('release', 'add-kettle')
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
