import { describe, it, expect } from 'vitest'
import { createRecorder, waitForCondition } from '@orkestrel/test'
import { BrowserCodegen, BrowserPage, compileBrowserJourney, createCDPClient } from '@src/core'
import {
	captureCodegenSource,
	createCDPTestTransport,
	createCodegenBindingPayload,
	createCodegenGesture,
	createStartedCodegen,
	replyOk,
} from '../../../setup.js'

describe('BrowserCodegen', () => {
	it('records exact accessible targets and ignores malformed binding payloads', async () => {
		const { transport, codegen } = await createStartedCodegen('session-1', {
			role: 'button',
			name: 'Add note',
		})
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'other',
				index: 0,
				top: true,
				form: false,
				detail: 1,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			{ name: '__orkestrelBrowserCodegen', executionContextId: 1, payload: 'invalid' },
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			{ name: 'elsewhere', executionContextId: 1, payload: 'invalid' },
			'session-1',
		)
		const steps = await codegen.stop()
		expect(steps).toEqual([
			{ id: 's1', action: 'click', arguments: {}, target: { role: 'button', name: 'Add note' } },
		])
		expect(codegen.journey({ name: 'add-note', description: 'Add a note' }).next).toBe(2)
	})
	it('folds a text-control click and open edits into one committed type', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'text',
				index: 0,
				top: true,
				form: true,
				detail: 1,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'a' })),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'ab' })),
			'session-1',
		)
		const steps = await codegen.stop()
		expect(steps).toEqual([
			{
				id: 's1',
				action: 'type',
				arguments: { text: 'ab' },
				target: { role: 'textbox', name: 'Title' },
			},
		])
	})
	it('drops the implicit click between Enter and submit', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture()),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'keydown',
				key: 'Enter',
				index: 0,
				top: true,
				control: 'text',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'change',
				index: 0,
				top: true,
				control: 'text',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				detail: 0,
				index: 1,
				top: true,
				control: 'other',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'submit',
				index: 2,
				top: true,
				control: 'other',
				form: false,
			}),
			'session-1',
		)
		expect(await codegen.stop()).toEqual([
			{
				id: 's1',
				action: 'type',
				arguments: { text: 'Title text', submit: true },
				target: { role: 'textbox', name: 'Title' },
			},
		])
	})
	it('never collapses edits across a submission', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'first' })),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'keydown',
				key: 'Enter',
				index: 0,
				top: true,
				control: 'text',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'submit',
				index: 2,
				top: true,
				control: 'other',
				form: false,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'second' })),
			'session-1',
		)
		expect((await codegen.stop()).map((step) => step.arguments)).toEqual([
			{ text: 'first', submit: true },
			{ text: 'second' },
		])
	})
	it('closes edits on focus departure and navigation without recording navigation', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'first' })),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'focusout',
				index: 0,
				top: true,
				control: 'text',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'second' })),
			'session-1',
		)
		transport.event(
			'Page.frameNavigated',
			{ frame: { id: 'main', url: 'https://example.test/next' } },
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'third' })),
			'session-1',
		)
		expect((await codegen.stop()).map((step) => step.arguments)).toEqual([
			{ text: 'first' },
			{ text: 'second' },
			{ text: 'third' },
		])
	})
	it('records Enter on an unedited field as press and separates Enter outside a form', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'keydown',
				key: 'Enter',
				index: 0,
				top: true,
				control: 'text',
				form: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ form: false })),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'keydown',
				key: 'Enter',
				index: 0,
				top: true,
				control: 'text',
				form: false,
			}),
			'session-1',
		)
		expect((await codegen.stop()).map((step) => [step.action, step.arguments])).toEqual([
			['press', { key: 'Enter' }],
			['type', { text: 'Title text' }],
			['press', { key: 'Enter' }],
		])
	})
	it('records select values and gaps for non-round-tripping and multiple selections', async () => {
		const { transport, codegen } = await createStartedCodegen('session-1', {
			role: 'combobox',
			name: 'Speed',
		})
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'change',
				control: 'select',
				index: 0,
				top: true,
				form: false,
				value: 'express',
				roundtrip: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'change',
				control: 'select',
				index: 0,
				top: true,
				form: false,
				value: 'm',
				roundtrip: false,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'input',
				control: 'multiple',
				index: 1,
				top: true,
				form: false,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'change',
				control: 'multiple',
				index: 1,
				top: true,
				form: false,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'option',
				index: 2,
				top: true,
				form: false,
				detail: 1,
			}),
			'session-1',
		)
		expect(await codegen.stop()).toEqual([
			{
				id: 's1',
				action: 'type',
				arguments: { text: 'express' },
				target: { role: 'combobox', name: 'Speed' },
			},
			{ id: 's2', action: 'unresolved', arguments: {}, gap: 'the option does not round-trip' },
			{ id: 's3', action: 'unresolved', arguments: {}, gap: 'a multiple selection' },
		])
	})
	it('records child-frame, native-dialog, and unsupported gaps without the answer', async () => {
		const { transport, codegen } = await createStartedCodegen()
		await codegen.attach('frame-session')
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'other',
				index: 0,
				top: false,
				form: false,
				detail: 1,
			}),
			'frame-session',
		)
		transport.event(
			'Page.javascriptDialogClosed',
			{ result: true, userInput: 'never record this answer' },
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'unsupported',
				control: 'other',
				index: 0,
				top: true,
				form: false,
				gap: 'an unsupported gesture',
			}),
			'session-1',
		)
		const steps = await codegen.stop()
		expect(steps.map((step) => step.gap)).toEqual([
			'the element is in a child frame',
			'a native dialog answer',
			'an unsupported gesture',
		])
		expect(JSON.stringify(steps)).not.toContain('never record')
	})
	it('binds password markers to secret parameters and emits no secret value', async () => {
		const { transport, codegen } = await createStartedCodegen('session-1', {
			role: 'textbox',
			name: 'Confirm Password',
		})
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'input',
				control: 'password',
				index: 0,
				top: true,
				form: true,
				secret: true,
			}),
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'input',
				control: 'password',
				index: 0,
				top: true,
				form: true,
				secret: true,
			}),
			'session-1',
		)
		await codegen.stop()
		const journey = codegen.journey({ name: 'sign-in', description: 'Sign in' })
		expect(journey.steps[0]?.arguments).toEqual({ text: { parameter: 'confirmPassword' } })
		expect(journey.parameters).toEqual({ confirmPassword: { secret: true } })
		expect(codegen.script({ ...journey, language: 'typescript' })).toEqual(
			compileBrowserJourney(journey, { language: 'typescript' }),
		)
	})
	it('the shipped listener never sends password text or non-Enter keys', () => {
		const payloads = captureCodegenSource([
			{ type: 'input' },
			{ type: 'keydown', key: 't' },
			{ type: 'keydown', key: 'Enter' },
		])
		expect(payloads).toHaveLength(2)
		expect(payloads.join('\n')).not.toContain('teal-Heron-42')
		expect(JSON.parse(payloads[0] ?? 'null')).toMatchObject({
			event: 'input',
			control: 'password',
			secret: true,
		})
		expect(JSON.parse(payloads[1] ?? 'null')).toMatchObject({ event: 'keydown', key: 'Enter' })
		const control = captureCodegenSource([
			{ type: 'input', element: { type: 'text', value: 'ordinary' } },
		])
		expect(control.join('\n')).toContain('ordinary')
	})
	it('resolves targets in their execution context and retains binding order', async () => {
		const { transport, codegen } = await createStartedCodegen()
		transport.event(
			'Runtime.bindingCalled',
			{
				...createCodegenBindingPayload(createCodegenGesture({ value: 'main' })),
				executionContextId: 1,
			},
			'session-1',
		)
		transport.event(
			'Runtime.bindingCalled',
			{
				...createCodegenBindingPayload(createCodegenGesture({ value: 'other' })),
				executionContextId: 2,
			},
			'session-1',
		)
		expect((await codegen.stop()).map((step) => step.arguments)).toEqual([
			{ text: 'main' },
			{ text: 'other' },
		])
		expect(
			transport.sent
				.filter(
					(message) =>
						message.method === 'Runtime.evaluate' &&
						typeof message.params?.['contextId'] === 'number' &&
						String(message.params?.['expression']).includes('nodes[0]'),
				)
				.map((message) => message.params?.['contextId']),
		).toEqual([1, 2])
	})
	it('installs on every attached frame before resume', async () => {
		const { transport, client, codegen } = await createStartedCodegen()
		await codegen.destroy()
		replyOk(transport, 'Page.setLifecycleEventsEnabled')
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Runtime.runIfWaitingForDebugger')
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'remote', url: 'https://remote.test/' } },
		})
		const page = new BrowserPage(client, 'main', 'session-1')
		const recorder = await page.codegen()
		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'frame-session',
				targetInfo: {
					targetId: 'remote',
					type: 'iframe',
					url: 'https://remote.test/',
					parentFrameId: 'main',
				},
			},
			'session-1',
		)
		await waitForCondition('the child session resumes', () =>
			transport.sent.some(
				(message) =>
					message.sessionId === 'frame-session' &&
					message.method === 'Runtime.runIfWaitingForDebugger',
			),
		)
		const methods = transport.sent
			.filter((message) => message.sessionId === 'frame-session')
			.map((message) => message.method)
		expect(methods).toContain('Page.addScriptToEvaluateOnNewDocument')
		expect(methods.indexOf('Page.enable')).toBeLessThan(
			methods.indexOf('Page.addScriptToEvaluateOnNewDocument'),
		)
		expect(methods.indexOf('Page.addScriptToEvaluateOnNewDocument')).toBeLessThan(
			methods.indexOf('Runtime.runIfWaitingForDebugger'),
		)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'other',
				index: 0,
				top: false,
				form: false,
				detail: 1,
			}),
			'frame-session',
		)
		expect((await recorder.stop())[0]?.gap).toBe('the element is in a child frame')
		await client.close()
	})
	it('installs existing frame sessions on start and reinstalls the live set after stop', async () => {
		const { transport, client, codegen: fixture } = await createStartedCodegen()
		await fixture.destroy()
		let frames = ['existing-frame']
		const codegen = new BrowserCodegen(client, 'session-1', undefined, () => frames)
		await codegen.start()
		expect(
			transport.sent.filter(
				(message) =>
					message.sessionId === 'existing-frame' &&
					message.method === 'Page.addScriptToEvaluateOnNewDocument',
			),
		).toHaveLength(1)
		await codegen.stop()
		frames = ['replacement-frame']
		await codegen.start()
		expect(
			transport.sent.filter(
				(message) =>
					message.sessionId === 'existing-frame' &&
					message.method === 'Page.addScriptToEvaluateOnNewDocument',
			),
		).toHaveLength(1)
		expect(
			transport.sent.filter(
				(message) =>
					message.sessionId === 'replacement-frame' &&
					message.method === 'Page.addScriptToEvaluateOnNewDocument',
			),
		).toHaveLength(1)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload({
				event: 'click',
				control: 'other',
				index: 0,
				top: false,
				form: false,
				detail: 1,
			}),
			'replacement-frame',
		)
		expect((await codegen.stop())[0]?.gap).toBe('the element is in a child frame')
		await codegen.destroy()
		await client.close()
	})
	it('owns snapshots, clears pending edits, restarts fresh, and stops receiving events', async () => {
		const { transport, codegen } = await createStartedCodegen()
		const events = createRecorder<[unknown]>()
		codegen.emitter.on('step', events.handler)
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'discard' })),
			'session-1',
		)
		codegen.clear()
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture({ value: 'keep' })),
			'session-1',
		)
		const stopped = await codegen.stop()
		expect(events.count).toBe(1)
		expect(stopped[0]?.arguments).toEqual({ text: 'keep' })
		Reflect.set(stopped[0]?.arguments ?? {}, 'text', 'changed')
		expect(codegen.steps()[0]?.arguments).toEqual({ text: 'keep' })
		transport.event(
			'Runtime.bindingCalled',
			createCodegenBindingPayload(createCodegenGesture()),
			'session-1',
		)
		expect(codegen.steps()).toHaveLength(1)
		await codegen.start()
		expect(codegen.steps()).toEqual([])
		await codegen.destroy()
		await codegen.destroy()
		await expect(codegen.start()).rejects.toThrow('destroyed')
	})
	it('shares concurrent starts and cleans up a failed installation before retry', async () => {
		const transport = createCDPTestTransport()
		const client = createCDPClient({ transport })
		await client.connect()
		let attempts = 0
		transport.onSend('Page.enable', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'installation failed')
			else transport.reply(message.id, {})
		})
		replyOk(transport, 'Runtime.removeBinding')
		replyOk(transport, 'Runtime.evaluate')
		const codegen = new BrowserCodegen(client, 'session-1')
		await expect(codegen.start()).rejects.toThrow('installation failed')
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Runtime.addBinding')
		replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
		const starts = createRecorder<[]>()
		codegen.emitter.on('start', starts.handler)
		await Promise.all([codegen.start(), codegen.start()])
		expect(starts.count).toBe(1)
		await Promise.all([codegen.stop(), codegen.stop()])
		expect(codegen.started).toBe(false)
	})
})
