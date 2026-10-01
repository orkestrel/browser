/**
 * Proof for `src/core/BrowserToolset.ts`.
 *
 * The element fixture's page runs over a recording client, so the release of the toolset's one
 * protocol subscription, `Page.javascriptDialogClosed`, and the absence of any per-action
 * subscription are proven by the registrations the client holds; the emitter subscriptions (the
 * page's `dialog`, `popup`, and `close`, and the registry's `change`) are proven by their
 * listener counts.
 */

import type {
	BrowserAction,
	BrowserFrameInterface,
	BrowserToolSourceEventMap,
	BrowserToolSourceInterface,
	BrowserToolsetReason,
	BrowserViewInterface,
} from '@src/core'
import type { ToolInterface } from '@orkestrel/tool'
import type { CDPSentMessage } from '../../setup.js'
import { describe, expect, it } from 'vitest'
import { Emitter } from '@orkestrel/emitter'
import { createTool, createToolManager } from '@orkestrel/tool'
import {
	captureError,
	createRecorder,
	readProperty,
	requireValue,
	waitForCondition,
	waitForDelay,
	waitForEvent,
} from '@orkestrel/test'
import {
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_HANDLED_STATUS,
	BROWSER_TOOL_NAMES,
	BrowserContext,
	BrowserPage,
	BrowserToolset,
	createBrowserReading,
	createBrowserToolset,
	createMemoryBrowserJourneyStore,
	createMemoryBrowserRunStore,
	performBrowserStep,
	isBrowserElementError,
	isBrowserError,
} from '@src/core'
import {
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_APPLIED_FIXTURE,
	BROWSER_ELEMENT_CHILD_FIXTURE,
	BROWSER_ELEMENT_FRAMED_FIXTURE,
	BROWSER_CHILD_ARRANGEMENTS,
	BROWSER_ELEMENT_WORLDS,
	BROWSER_SESSION_MOVES,
	answerBrowserEvaluation,
	buildBrowserElementTree,
	emitBrowserNavigation,
	matchesBrowserSubmitObserver,
	matchesBrowserSubmitRead,
	BROWSER_SUBMIT_ACTIONS,
	BROWSER_SUBMIT_EARLY_CASES,
	BROWSER_SUBMIT_FOCUS_STEPS,
	BROWSER_SUBMIT_MALFORMED_READS,
	BROWSER_SUBMIT_NEGATIVE_CASES,
	BROWSER_SUBMIT_UNREAD_CASES,
	createBrowserElementFixture,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
	createConnectedCDPClient,
	emitBrowserWindowOpen,
	ignoreCall,
	readCDPExpression,
	readBrowserCompiledTimers,
	replyOk,
} from '../../setup.js'

describe('BrowserToolset', () => {
	describe('journey actions', () => {
		it('takes its hold after an already admitted dialog answer finishes', async () => {
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			const answers: CDPSentMessage[] = []
			fixture.transport.onSend('Page.handleJavaScriptDialog', (message) => answers.push(message))
			try {
				await toolset.start()
				fixture.transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Continue?' },
					'session-main',
				)
				const order: string[] = []
				toolset.emitter.on('action', () => order.push('answer'))
				toolset.emitter.on('hold', () => order.push('hold'))
				const answering = toolset.perform({
					id: 'answer',
					name: 'dialog',
					arguments: { accept: true },
				})
				await waitForCondition('the dialog answer is pending', () => answers.length === 1)
				const holding = toolset.hold('add-kettle')
				expect(order).toEqual([])
				fixture.transport.reply(requireValue(answers[0]).id, {})
				expect((await answering).action?.outcome).toBe('done')
				const hold = await holding
				expect(order).toEqual(['answer', 'hold'])
				hold.destroy()
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('returns distinct actions for concurrent identical calls and emits the returned values', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			const actions = createRecorder<readonly [BrowserAction]>()
			toolset.emitter.on('action', actions.handler)
			await toolset.start()
			try {
				const call = { id: 'same', name: 'click', arguments: { ref: 'e1' } }
				const [first, second] = await Promise.all([toolset.perform(call), toolset.perform(call)])
				expect(first.action).toMatchObject({
					action: 'click',
					arguments: { ref: 'e1' },
					outcome: 'done',
					target: { role: 'button', name: 'Save', reference: 'e1' },
				})
				expect(second.action).toBeDefined()
				expect(first.action).not.toBe(second.action)
				expect(actions.calls[0]?.[0]).toBe(first.action)
				expect(actions.calls[1]?.[0]).toBe(second.action)
				expect(first.result).toEqual(second.result)
				expect(first.action?.elapsed).toBeGreaterThanOrEqual(0)
				const direct = await toolset.tools.execute(call)
				expect(direct).toEqual(first.result)
				expect(actions.calls[2]?.[0].receipt).toBe(first.action?.receipt)
				expect(
					(await toolset.perform({ id: 'look', name: 'look', arguments: { what: 'form' } })).action,
				).toBeUndefined()
				expect(
					(await toolset.perform({ id: 'missing', name: 'missing', arguments: {} })).action,
				).toBeUndefined()
				expect(
					(await toolset.perform({ id: 'refused', name: 'click', arguments: { ref: 'e99' } }))
						.action?.outcome,
				).toBe('refused')
			} finally {
				await toolset.destroy()
			}
		})

		it('captures the target before input replaces the document', async () => {
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'journey-loader',
					)
					fixture.transport.reply(message.id, {})
				},
			})
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				await fixture.page.elements.outline()
				const performed = await toolset.perform({
					id: 's1',
					name: 'click',
					arguments: { ref: 'e4' },
				})
				expect(performed.action?.target).toEqual({
					role: 'button',
					name: 'Place order',
					reference: 'e4',
					frame: 'main',
				})
				expect(performed.action).toMatchObject({
					outcome: 'done',
					stage: 'loaded',
					reason: 'formSubmissionPost',
				})
				expect(fixture.page.elements.element('e4')).toBeUndefined()
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('keeps secret text out of direct and structured receipts and action arguments', async () => {
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			const actions = createRecorder<readonly [BrowserAction]>()
			toolset.emitter.on('action', actions.handler)
			try {
				await toolset.start()
				await fixture.page.elements.outline()
				for (const submit of [false, true]) {
					const performed = await toolset.perform({
						id: 'secret',
						name: 'type',
						arguments: { ref: 'e2', text: 'private-value', secret: true, submit },
					})
					expect(performed.action).toMatchObject({
						secret: true,
						arguments: { ref: 'e2', secret: true, submit },
						outcome: 'done',
					})
					expect(performed.action?.arguments).not.toHaveProperty('text')
					expect(performed.action?.receipt).toMatch(/^Typed a secret into e2 textbox "Email"/)
					expect(JSON.stringify(performed)).not.toContain('private-value')
				}
				const pressed = await toolset.perform({
					id: 'enter',
					name: 'press',
					arguments: { key: 'Enter' },
				})
				expect(pressed.action).toMatchObject({
					action: 'press',
					arguments: { key: 'Enter' },
					outcome: 'done',
				})
				const direct = await toolset.tools.execute({
					id: 'direct',
					name: 'type',
					arguments: { ref: 'e2', text: 'private-value', secret: true },
				})
				expect(String(readProperty(direct, 'value'))).toMatch(/^Typed a secret into/)
				expect(JSON.stringify([actions.calls, pressed, direct])).not.toContain('private-value')
				expect(
					fixture.transport.sent.some(
						(message) =>
							message.method === 'Input.insertText' && message.params?.['text'] === 'private-value',
					),
				).toBe(true)
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('reports a wait timeout without changing its receipt', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble({ waited: false }))
			await toolset.start()
			try {
				const performed = await toolset.perform({
					id: 's3',
					name: 'wait',
					arguments: { text: 'Added to cart', timeout: 0.01 },
				})
				expect(performed.result).toMatchObject({
					success: true,
					value: '"Added to cart" did not appear within 0.01 s.',
				})
				expect(performed.action).toMatchObject({
					outcome: 'timeout',
					receipt: '"Added to cart" did not appear within 0.01 s.',
				})
			} finally {
				await toolset.destroy()
			}
		})

		it('refuses an adopted action under a hold, lets observations and its owner pass, and releases on destroy', async () => {
			const invoked = createRecorder<[]>()
			const source = createToolManager()
			source.add(createTool({ name: 'checkout', execute: invoked.handler }))
			const toolset = new BrowserToolset(createBrowserViewDouble(), {
				source: {
					adopt: async () => source.tools(),
					emitter: new Emitter<BrowserToolSourceEventMap>(),
				},
			})
			const held = createRecorder<readonly [string]>()
			const released = createRecorder<readonly [string]>()
			toolset.emitter.on('hold', held.handler)
			toolset.emitter.on('release', released.handler)
			await toolset.start()
			const hold = await toolset.hold('add-kettle')
			try {
				const refused = await toolset.perform({
					id: 'foreign',
					name: 'checkout',
					arguments: { what: 'cart' },
				})
				expect(refused.result).toMatchObject({
					success: false,
					error: 'The toolset is replaying add-kettle until it finishes; call look.',
				})
				expect(invoked.count).toBe(0)
				const denied = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: new AbortController().signal },
					),
				).catch((error: unknown) => error)
				expect(readProperty(denied, 'code')).toBe('BROWSER_TOOLSET_BUSY')
				for (const call of [
					{ id: 'look', name: 'look', arguments: { what: 'form' } },
					{ id: 'read', name: 'read', arguments: { what: 'form' } },
					{ id: 'wait', name: 'wait', arguments: { text: 'Form' } },
				])
					expect((await toolset.perform(call)).result.success).toBe(true)
				expect(
					(
						await toolset.perform(
							{ id: 'owner', name: 'checkout', arguments: { what: 'cart' } },
							{ caller: hold.token, signal: new AbortController().signal },
						)
					).result.success,
				).toBe(true)
				expect(invoked.count).toBe(1)
				expect(held.calls).toEqual([['add-kettle']])
				await toolset.destroy()
				hold.destroy()
				expect(released.calls).toEqual([['add-kettle']])
			} finally {
				hold.destroy()
				await toolset.destroy()
			}
		})

		it('waits for admitted actions before holding and cancels a queued hold without blocking the queue', async () => {
			const pending = Promise.withResolvers<string>()
			const invoked = createRecorder<[]>()
			const source = createToolManager()
			source.add(
				createTool({
					name: 'checkout',
					execute: () => {
						invoked.handler()
						return pending.promise
					},
				}),
			)
			const toolset = new BrowserToolset(createBrowserViewDouble(), {
				source: {
					adopt: async () => source.tools(),
					emitter: new Emitter<BrowserToolSourceEventMap>(),
				},
			})
			await toolset.start()
			try {
				const acting = toolset.perform({
					id: 'before',
					name: 'checkout',
					arguments: { what: 'cart' },
				})
				await waitForCondition('adopted input started', () => invoked.count === 1)
				const abort = new AbortController()
				const abandoned = toolset
					.hold('cancelled', { signal: abort.signal })
					.catch((error: unknown) => error)
				abort.abort('cancelled')
				expect(await abandoned).toBe('cancelled')
				const order: string[] = []
				toolset.emitter.on('action', () => order.push('action'))
				toolset.emitter.on('hold', () => order.push('hold'))
				const holding = toolset.hold('add-kettle')
				expect(order).toEqual([])
				pending.resolve('checked out')
				await acting
				const hold = await holding
				expect(order).toEqual(['action', 'hold'])
				hold.destroy()
				expect(
					(await toolset.perform({ id: 'after', name: 'click', arguments: { ref: 'e1' } })).result
						.success,
				).toBe(true)
			} finally {
				pending.resolve('cleanup')
				await toolset.destroy()
			}
		})

		it('returns an interrupted action immediately and admits only the hold owner to its dialog continuation', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				released: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			try {
				replyOk(fixture.transport, 'Page.handleJavaScriptDialog')
				await toolset.start()
				await fixture.page.elements.outline()
				const hold = await toolset.hold('add-kettle')
				const context = { signal: new AbortController().signal, caller: hold.token }
				const acting = toolset.perform(
					{ id: 's1', name: 'click', arguments: { ref: 'e4' } },
					context,
				)
				await waitForCondition('input release withheld', () => withheld.length === 1)
				fixture.transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Continue?' },
					'session-main',
				)
				const interrupted = await acting
				expect(interrupted.action?.outcome).toBe('interrupted')
				expect(interrupted.action?.receipt).toContain('A confirm dialog is open')
				const refused = await toolset.perform({
					id: 'foreign',
					name: 'dialog',
					arguments: { accept: true },
				})
				expect(refused.result).toMatchObject({
					success: false,
					error: 'The toolset is replaying add-kettle until it finishes; call look.',
				})
				expect(
					fixture.transport.sent.filter(
						(message) => message.method === 'Page.handleJavaScriptDialog',
					),
				).toHaveLength(0)
				const answered = await toolset.perform(
					{ id: 's2', name: 'dialog', arguments: { accept: true } },
					context,
				)
				expect(answered.action?.outcome).toBe('done')
				fixture.transport.reply(requireValue(withheld[0]).id, {})
				expect(
					(
						await toolset.perform(
							{ id: 's3', name: 'press', arguments: { key: 'Escape' } },
							context,
						)
					).action?.outcome,
				).toBe('done')
				hold.destroy()
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})
	describe('vocabulary', () => {
		it('catches a tool outside the seven, a native extra, a missing required parameter, a stray annotation, or a long parameter description', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = new BrowserToolset(page, { page })
				expect(toolset.tools.count).toBe(0)
				await toolset.start()
				const seven = ['look', 'read', 'click', 'type', 'press', 'navigate', 'wait']
				expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(seven)
				expect(toolset.native.map((tool) => tool.name)).toEqual(seven)
				expect(toolset.native).toEqual(toolset.tools.tools())
				expect(toolset.view).toBe(page)
				expect(
					Object.fromEntries(toolset.native.map((tool) => [tool.name, tool.annotations])),
				).toEqual({
					look: { pure: true, untrusted: true },
					read: { pure: true, untrusted: true },
					click: undefined,
					type: undefined,
					press: undefined,
					navigate: undefined,
					wait: { pure: true },
				})
				for (const name of BROWSER_TOOL_NAMES) {
					const definition = BROWSER_TOOL_COPY[name]
					expect(definition.name).toBe(name)
					const required = readProperty<readonly string[]>(definition.parameters, 'required')
					const properties = readProperty<Readonly<Record<string, unknown>>>(
						definition.parameters,
						'properties',
					)
					expect(required.length).toBeGreaterThan(0)
					for (const key of required) expect(Object.keys(properties)).toContain(key)
					for (const property of Object.values(properties))
						expect(readProperty<string>(property, 'description').length).toBeLessThanOrEqual(100)
				}
				expect(BROWSER_TOOL_COPY.tabs.annotations).toEqual({ pure: true })
				expect(BROWSER_TOOL_COPY.dialog.annotations).toBeUndefined()
				expect(BROWSER_TOOL_COPY.switch.annotations).toBeUndefined()
			} finally {
				await client.close()
			}
		})

		it('catches a tool description over 25 words, one outside the third-person indicative, or one that does not say when to call the tool', () => {
			for (const name of BROWSER_TOOL_NAMES)
				expect(
					requireValue(BROWSER_TOOL_COPY[name].description).split(/\s+/).length,
				).toBeLessThanOrEqual(25)
			expect(
				Object.fromEntries(
					BROWSER_TOOL_NAMES.map((name) => [name, BROWSER_TOOL_COPY[name].description]),
				),
			).toEqual({
				look: "Shows the page's text and the elements you can act on, each with a reference like e4. Call it first and after the page changes.",
				read: "Reads the page's text for what you name. Call it to learn a fact; continue with the offset a cut result names.",
				click: 'Clicks the element with that reference.',
				type: 'Types into the text control with that reference; set submit to true to submit its form.',
				press: 'Presses that key or chord, such as Enter or Control+a.',
				navigate: 'Opens that absolute web address in the current tab.',
				wait: 'Waits for that text to appear on the page.',
				dialog: 'Accepts or dismisses the open dialog.',
				tabs: 'Lists the open tabs; the current one is marked.',
				switch: 'Switches to a tab from tabs, such as t2.',
			})
			expect(
				readProperty<object>(
					readProperty<object>(BROWSER_TOOL_COPY.type.parameters, 'properties'),
					'submit',
				),
			).toEqual({ type: 'boolean', description: 'True to submit its form after typing.' })
		})

		it('catches a look or read that advertises or accepts ref, or a tool that runs with a parameter it does not advertise', async () => {
			expect(
				Object.keys(readProperty<object>(BROWSER_TOOL_COPY.look.parameters, 'properties')),
			).toEqual(['what'])
			expect(
				Object.keys(readProperty<object>(BROWSER_TOOL_COPY.read.parameters, 'properties')),
			).toEqual(['what', 'offset'])
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const results = await toolset.tools.execute([
				{ id: '1', name: 'look', arguments: { what: 'the cart', ref: 'e1' } },
				{ id: '2', name: 'read', arguments: { what: 'the cart', ref: 'e1' } },
				{ id: '3', name: 'type', arguments: { ref: 'e2', text: 'sam', what: 'the email' } },
			])
			expect(results.map((result) => readProperty(result, 'error'))).toEqual([
				'The look tool takes no ref parameter; call look with what.',
				'The read tool takes no ref parameter; call read with what and offset.',
				'The type tool takes no what parameter; call type with ref, text, submit, and secret.',
			])
			expect(view.calls).toEqual([])
			const refused = await Promise.resolve(
				requireValue(toolset.tools.tool('look')).execute(
					{ what: 'the cart', ref: 'e1' },
					{ signal: new AbortController().signal },
				),
			).catch((caught: unknown) => caught)
			expect(readProperty(refused, 'code')).toBe('BROWSER_TOOLSET_ARGUMENT')
			expect(readProperty(refused, 'context')).toEqual({ key: 'ref' })
			await toolset.destroy()
		})

		it('catches a start that overwrites a foreign reserved tool or adds tools before refusing', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				for (const name of ['dialog', 'read']) {
					const tools = createToolManager()
					const foreign = createTool({ name, execute: ignoreCall })
					tools.add(foreign)
					const toolset = createBrowserToolset(page, { tools })
					const error = await toolset.start().catch((caught: unknown) => caught)
					expect(isBrowserError(error)).toBe(true)
					expect(readProperty(error, 'code')).toBe('BROWSER_TOOLSET_RESERVED')
					expect(readProperty(error, 'context')).toEqual({ name })
					expect(tools.tools()).toEqual([foreign])
				}
			} finally {
				await client.close()
			}
		})

		it('catches a limit that is not a positive integer', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				for (const limit of [0, -1, 1.5, Number.NaN])
					expect(() => createBrowserToolset(page, { limit })).toThrow(
						'Browser toolset limit must be a positive integer',
					)
			} finally {
				await client.close()
			}
		})
	})

	describe('dialogs', () => {
		it('catches a click receipt that waits for a withheld release, stages no dialog, or answers twice', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					if (withheld.length === 0) withheld.push(message)
					else fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'Page.handleJavaScriptDialog')
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'order' }, { signal })
				const click = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e4' }, { signal }),
				)
				await waitForCondition('the release is withheld', () => withheld.length === 1)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Delete the draft?' },
					'session-main',
				)
				const receipt = await click
				expect(performance.now() - opened).toBeLessThan(100)
				expect(receipt).toBe(
					'Clicked e4 button "Place order". A confirm dialog is open: "Delete the draft?"; call dialog.',
				)
				expect(toolset.tools.tool('dialog')?.name).toBe('dialog')
				const refusals = await toolset.tools.execute([
					{ id: '1', name: 'look', arguments: { what: 'cart' } },
					{ id: '2', name: 'read', arguments: { what: 'cart' } },
					{ id: '3', name: 'click', arguments: { ref: 'e1' } },
					{ id: '4', name: 'type', arguments: { ref: 'e2', text: 'sam' } },
					{ id: '5', name: 'press', arguments: { key: 'Enter' } },
					{ id: '6', name: 'navigate', arguments: { url: 'https://example.test/' } },
					{ id: '7', name: 'wait', arguments: { text: 'cart' } },
				])
				for (const refusal of refusals)
					expect(refusal).toMatchObject({
						success: false,
						error: 'A confirm dialog is open: "Delete the draft?"; call dialog.',
					})
				const captures = transport.sent.filter(
					(message) => message.method === 'Accessibility.getFullAXTree',
				).length
				const answer = String(
					await requireValue(toolset.tools.tool('dialog')).execute({ accept: true }, { signal }),
				)
				expect(withheld).toHaveLength(1)
				expect(answer).toMatch(/^Accepted the confirm dialog "Delete the draft\?"\.\n\npage "Cart"/)
				expect(toolset.tools.tool('dialog')).toBeUndefined()
				const answered = transport.sent.filter(
					(message) => message.method === 'Accessibility.getFullAXTree',
				).length
				expect(answered).toBeGreaterThan(captures)
				transport.reply(requireValue(withheld[0]).id, {})
				await waitForDelay(20)
				expect(
					transport.sent.filter((message) => message.method === 'Accessibility.getFullAXTree'),
				).toHaveLength(answered)
				const next = String(
					await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				)
				expect(next.startsWith('Clicked e1 link "Home".\n\npage "Cart"')).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('catches a type on a select whose withheld option call hides the dialog', async () => {
			const selects: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				accessibility: (message) =>
					fixture.transport.reply(
						message.id,
						message.params?.['frameId'] === 'child'
							? BROWSER_ELEMENT_CHILD_FIXTURE
							: {
									nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
										node.nodeId === 'email'
											? { ...node, role: { value: 'combobox' }, name: { value: 'Size' } }
											: node,
									),
								},
					),
				select: (message) => selects.push(message),
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'size' }, { signal })
				const typed = Promise.resolve(
					requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'Large' },
						{ signal },
					),
				)
				await waitForCondition('the option call is withheld', () => selects.length === 1)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Pick one' },
					'session-main',
				)
				expect(await typed).toBe(
					'Selected "Large" in e2 combobox "Size" (programmatic). An alert dialog is open: "Pick one"; call dialog.',
				)
				expect(performance.now() - opened).toBeLessThan(100)
				expect(toolset.tools.tool('dialog')?.name).toBe('dialog')
			} finally {
				await client.close()
			}
		})

		it('catches a wait whose blocked expression hides the dialog', async () => {
			const waits: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				evaluation: (message) => {
					if (String(message.params?.['expression']).includes('Order placed')) waits.push(message)
					else fixture.transport.reply(message.id, { result: { value: true } })
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const waited = Promise.resolve(
					requireValue(toolset.tools.tool('wait')).execute(
						{ text: 'Order placed' },
						{ signal: new AbortController().signal },
					),
				)
				await waitForCondition('the text wait is pending', () => waits.length === 1)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Leave?' },
					'session-main',
				)
				expect(await waited).toBe(
					'Waited for "Order placed". A confirm dialog is open: "Leave?"; call dialog.',
				)
				expect(performance.now() - opened).toBeLessThan(100)
			} finally {
				await client.close()
			}
		})

		it('catches a navigate whose missing load hides the dialog', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			// The held navigation's load wait keeps a 30 s timer until the signal ends it, and a later
			// case counts the process's timers.
			const controller = new AbortController()
			try {
				transport.onSend('Page.navigate', (message) =>
					transport.reply(message.id, { frameId: 'main', loaderId: 'loader-next' }),
				)
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const navigated = Promise.resolve(
					requireValue(toolset.tools.tool('navigate')).execute(
						{ url: 'https://example.test/next' },
						{ signal: controller.signal },
					),
				)
				await waitForCondition('the navigation is sent', () =>
					transport.sent.some((message) => message.method === 'Page.navigate'),
				)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Loading' },
					'session-main',
				)
				expect(await navigated).toBe(
					'Navigating to https://example.test/next. An alert dialog is open: "Loading"; call dialog.',
				)
				expect(performance.now() - opened).toBeLessThan(100)
			} finally {
				controller.abort(new Error('The case ended'))
				await client.close()
			}
		})

		it('catches a navigate that stages the leave prompt it requested instead of answering it', async () => {
			const { client, page, transport } = await createBrowserElementFixture({
				evaluation: (message) =>
					transport.reply(message.id, { result: { value: 'https://example.test/next' } }),
			})
			try {
				transport.onSend('Page.navigate', () => {
					transport.event(
						'Page.javascriptDialogOpening',
						{ type: 'beforeunload', message: 'Leave site?' },
						'session-main',
					)
				})
				transport.onSend('Page.handleJavaScriptDialog', (message) => {
					transport.reply(message.id, {})
					const navigation = requireValue(
						transport.sent.find((sent) => sent.method === 'Page.navigate'),
					)
					transport.reply(navigation.id, { frameId: 'main', loaderId: 'loader-next' })
					transport.event(
						'Page.frameNavigated',
						{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' } },
						'session-main',
					)
					transport.event(
						'Page.lifecycleEvent',
						{ frameId: 'main', loaderId: 'loader-next', name: 'DOMContentLoaded' },
						'session-main',
					)
					transport.event('Page.loadEventFired', { timestamp: 1 }, 'session-main')
				})
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const result = String(
					await requireValue(toolset.tools.tool('navigate')).execute(
						{ url: 'https://example.test/next' },
						{ signal: new AbortController().signal },
					),
				)
				expect(result).toMatch(
					/^Navigated to https:\/\/example\.test\/next\.\n\npage "Cart" https:\/\/example\.test\/next/,
				)
				expect(
					transport.sent.find((message) => message.method === 'Page.handleJavaScriptDialog')
						?.params,
				).toEqual({ accept: true })
				expect(toolset.tools.tool('dialog')).toBeUndefined()
			} finally {
				await client.close()
			}
		})

		it('catches a dialog tool that answers when no dialog is open or a dialog closed elsewhere that stays staged', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Saved' },
					'session-main',
				)
				const staged = requireValue(toolset.tools.tool('dialog'))
				expect(
					await toolset.tools.execute({ id: '1', name: 'look', arguments: { what: 'cart' } }),
				).toMatchObject({ success: false, error: 'An alert dialog is open: "Saved"; call dialog.' })
				transport.event('Page.javascriptDialogClosed', { result: true }, 'session-main')
				expect(toolset.tools.tool('dialog')).toBeUndefined()
				expect(
					await toolset.tools.execute({ id: '2', name: 'look', arguments: { what: 'cart' } }),
				).toMatchObject({ success: true })
				const refused = await Promise.resolve(
					staged.execute({ accept: true }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(refused, 'message')).toBe('No dialog is open; call look.')
				expect(readProperty(refused, 'code')).toBe('BROWSER_TOOLSET_DIALOG')
			} finally {
				await client.close()
			}
		})
	})

	describe('actions', () => {
		it('catches a type that skips the selection, the insert, or the Enter it was asked for', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'email' }, { signal })
				const sent = transport.sent.length
				const typed = String(
					await requireValue(toolset.tools.tool('type')).execute(
						{ ref: '[ref=e2]', text: 'sam', submit: true },
						{ signal },
					),
				)
				expect(
					typed.startsWith(
						'Typed "sam" into e2 textbox "Email" and pressed Enter; no form received the submission.\n\n',
					),
				).toBe(true)
				const methods = transport.sent.slice(sent).map((message) => message.method)
				expect(methods).toContain('DOM.focus')
				const selection = transport.sent
					.slice(sent)
					.findIndex(
						(message) =>
							message.method === 'Runtime.callFunctionOn' &&
							String(message.params?.['functionDeclaration']).includes('this.select()'),
					)
				expect(selection).toBeGreaterThanOrEqual(0)
				expect(selection).toBeLessThan(methods.indexOf('Input.insertText'))
				expect(methods.indexOf('Input.insertText')).toBeLessThan(
					methods.indexOf('Input.dispatchKeyEvent'),
				)
				expect(
					transport.sent
						.slice(sent)
						.filter((message) => message.method === 'Input.dispatchKeyEvent')
						.map((message) => [message.params?.['type'], message.params?.['key']]),
				).toEqual([
					['keyDown', 'Enter'],
					['keyUp', 'Enter'],
				])
				expect(
					transport.sent.find((message) => message.method === 'Input.insertText')?.params,
				).toEqual({ text: 'sam' })
			} finally {
				await client.close()
			}
		})

		it('catches a press that skips key normalization or reports an unknown key without the accepted names', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const pressed = await toolset.tools.execute({
					id: '1',
					name: 'press',
					arguments: { key: 'ctrl+a' },
				})
				expect(String(readProperty(pressed, 'value')).startsWith('Pressed Control+a.\n\n')).toBe(
					true,
				)
				expect(
					transport.sent
						.filter((message) => message.method === 'Input.dispatchKeyEvent')
						.map((message) => [message.params?.['type'], message.params?.['key']]),
				).toEqual([
					['keyDown', 'Control'],
					['keyDown', 'a'],
					['keyUp', 'a'],
					['keyUp', 'Control'],
				])
				const unknown = await toolset.tools.execute({
					id: '2',
					name: 'press',
					arguments: { key: 'Hyper' },
				})
				expect(unknown).toMatchObject({ success: false })
				expect(String(readProperty(unknown, 'error'))).toContain('Accepted names: Backspace')
			} finally {
				await client.close()
			}
		})

		it('catches a reference refusal that names no next call', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				expect(
					await toolset.tools.execute({ id: '1', name: 'click', arguments: { ref: 'x12' } }),
				).toMatchObject({
					success: false,
					error: 'Reference "x12" is not a reference such as e12; call look for fresh refs.',
				})
				expect(
					await toolset.tools.execute({ id: '2', name: 'click', arguments: { ref: 'e99' } }),
				).toMatchObject({
					success: false,
					error: 'Element e99 is not in the current view; call look for fresh refs.',
				})
			} finally {
				await client.close()
			}
		})

		it('catches a type on a control that takes no text that dispatches the edit or names no next call', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const refused = await Promise.resolve(
				requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e1', text: 'Search', submit: true },
					{ signal: new AbortController().signal },
				),
			).catch((caught: unknown) => caught)
			expect(
				isBrowserError(refused) && {
					message: refused.message,
					code: refused.code,
					context: refused.context,
				},
			).toEqual({
				message: 'Element e1 button "Save" takes no text; call click for a button.',
				code: 'BROWSER_TOOLSET_ROLE',
				context: { reference: 'e1', role: 'button' },
			})
			expect(view.calls).toEqual([])
			await toolset.destroy()
			const tree = {
				nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
					node.nodeId === 'email'
						? { ...node, role: { value: 'option' }, name: { value: 'Small' } }
						: node,
				),
			}
			const fixture = await createBrowserElementFixture({
				accessibility: (message) =>
					fixture.transport.reply(
						message.id,
						message.params?.['frameId'] === 'child' ? BROWSER_ELEMENT_CHILD_FIXTURE : tree,
					),
			})
			const { client, page, transport } = fixture
			try {
				const trusted = createBrowserToolset(page)
				await trusted.start()
				const signal = new AbortController().signal
				await requireValue(trusted.tools.tool('look')).execute({ what: 'size' }, { signal })
				const sent = transport.sent.length
				expect(
					await trusted.tools.execute({
						id: 'type',
						name: 'type',
						arguments: { ref: 'e2', text: 'Small' },
					}),
				).toMatchObject({
					success: false,
					error: 'Element e2 option "Small" takes no text; call click for an option.',
				})
				expect(transport.sent.slice(sent)).toEqual([])
			} finally {
				await client.close()
			}
		})

		it('catches a type on a captured read-only textbox whose refusal carries the in-page stack or a refresh directive', async () => {
			const fixture = await createBrowserElementFixture({
				actionability:
					'Error: Element is not editable\n    at HTMLInputElement.<anonymous> (<anonymous>:12:3)\n    at <anonymous>:30:4',
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await requireValue(toolset.tools.tool('look')).execute(
					{ what: 'email' },
					{ signal: new AbortController().signal },
				)
				expect(
					await toolset.tools.execute({
						id: 'type',
						name: 'type',
						arguments: { ref: 'e2', text: 'x', submit: true },
					}),
				).toMatchObject({ success: false, error: 'Element e2 is not editable.' })
				expect(transport.sent.some((message) => message.method === 'Input.insertText')).toBe(false)
			} finally {
				await client.close()
			}
		})

		it('catches a view capture that a navigation interrupts and that reports the change instead of reading the page again', async () => {
			const outcomes: Array<readonly [string, number]> = []
			for (const persistent of [false, true]) {
				let capturing = false
				let changes = 0
				const fixture = await createBrowserElementFixture({
					accessibility: (message) => {
						const child = message.params?.['frameId'] === 'child'
						if (!child && capturing && (persistent || changes === 0)) {
							changes += 1
							const loaderId = `loader-next-${changes}`
							fixture.transport.event(
								'Page.frameNavigated',
								{ frame: { id: 'main', url: 'https://example.test/next', loaderId } },
								'session-main',
							)
							fixture.transport.event(
								'Page.lifecycleEvent',
								{ frameId: 'main', loaderId, name: 'DOMContentLoaded' },
								'session-main',
							)
						}
						fixture.transport.reply(
							message.id,
							child ? BROWSER_ELEMENT_CHILD_FIXTURE : BROWSER_ELEMENT_AX_FIXTURE,
						)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					capturing = true
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					outcomes.push([result, changes])
				} finally {
					await client.close()
				}
			}
			const [[recovered = '', reads = 0] = [], changed] = outcomes
			expect(recovered).toMatch(
				/^Clicked e1 link "Home"\.\n\npage "Cart" https:\/\/example\.test\/next\n/,
			)
			expect(reads).toBe(1)
			expect(changed).toEqual([
				'Clicked e1 link "Home".\n\n(The page changed before the view could be read; call look.)',
				2,
			])
		})

		it('catches a view capture whose title read a navigation rejects that reports the failure instead of reading the page again, or one that retries a rejection no navigation caused', async () => {
			const outcomes: Array<readonly [string, number]> = []
			for (const navigating of [true, false]) {
				let capturing = false
				let titles = 0
				const fixture = await createBrowserElementFixture({
					title: (message) => {
						if (!capturing) {
							fixture.transport.reply(message.id, { result: { value: 'Cart' } })
							return
						}
						titles += 1
						if (titles > 1) {
							fixture.transport.reply(message.id, { result: { value: 'Next' } })
							return
						}
						if (navigating) {
							fixture.transport.event(
								'Page.frameNavigated',
								{
									frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' },
								},
								'session-main',
							)
							fixture.transport.event(
								'Page.lifecycleEvent',
								{ frameId: 'main', loaderId: 'loader-next', name: 'DOMContentLoaded' },
								'session-main',
							)
						}
						fixture.transport.fail(message.id, 'Cannot find context with specified id')
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					capturing = true
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					outcomes.push([result, titles])
				} finally {
					await client.close()
				}
			}
			const [[recovered = '', reads = 0] = [], failed] = outcomes
			expect(recovered).toMatch(
				/^Clicked e1 link "Home"\.\n\npage "Next" https:\/\/example\.test\/next\n/,
			)
			expect(reads).toBe(2)
			expect(failed).toEqual([
				'Clicked e1 link "Home".\n\n(The view could not be read: Cannot find context with specified id; call look.)',
				1,
			])
		})

		it('catches a navigate that sends a refused scheme or returns before the load with no view', async () => {
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, { result: { value: 'https://example.test/next' } }),
			})
			const { client, page, transport } = fixture
			try {
				transport.onSend('Page.navigate', (message) => {
					transport.reply(message.id, { frameId: 'main', loaderId: 'loader-next' })
					transport.event(
						'Page.frameNavigated',
						{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' } },
						'session-main',
					)
					transport.event(
						'Page.lifecycleEvent',
						{ frameId: 'main', loaderId: 'loader-next', name: 'DOMContentLoaded' },
						'session-main',
					)
				})
				const toolset = createBrowserToolset(page, { schemes: ['https:'] })
				await toolset.start()
				for (const [url, error] of [
					['file:///etc/hosts', 'Navigation refused: the file: scheme is not allowed; use https:.'],
					[
						'http://example.test/',
						'Navigation refused: the http: scheme is not allowed; use https:.',
					],
					['example.test', 'Navigation refused: "example.test" is not an absolute URL.'],
				] as const)
					expect(
						await toolset.tools.execute({ id: url, name: 'navigate', arguments: { url } }),
					).toMatchObject({ success: false, error })
				expect(transport.sent.some((message) => message.method === 'Page.navigate')).toBe(false)
				let settled = false
				const navigating = toolset.tools
					.execute({
						id: 'next',
						name: 'navigate',
						arguments: { url: 'https://example.test/next' },
					})
					.finally(() => {
						settled = true
					})
				await waitForCondition('the navigation replied', () =>
					transport.sent.some((message) => message.method === 'Page.navigate'),
				)
				await waitForDelay(50)
				expect(settled).toBe(false)
				transport.event('Page.loadEventFired', { timestamp: 1 }, 'session-main')
				const navigated = await navigating
				expect(
					String(readProperty(navigated, 'value')).startsWith(
						'Navigated to https://example.test/next.\n\npage "Cart" https://example.test/next\n# Your cart',
					),
				).toBe(true)
				expect(
					transport.sent.find((message) => message.method === 'Page.navigate')?.params,
				).toEqual({ url: 'https://example.test/next' })
			} finally {
				await client.close()
			}
		})

		it(
			'catches a click receipt that waits unbounded for a requested navigation that never commits',
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
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(3_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(
						result.startsWith(
							'Clicked e1 link "Home"; it requested https://example.test/next and the page did not change.\n\npage "Cart" https://example.test/cart\n# Your cart',
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it(
			'catches a still-loading receipt that leaves no reserve for the view it could read',
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
						fixture.transport.event(
							'Page.frameNavigated',
							{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' } },
							'session-main',
						)
						fixture.transport.event(
							'Page.lifecycleEvent',
							{ frameId: 'main', loaderId: 'loader-next', name: 'DOMContentLoaded' },
							'session-main',
						)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(3_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(
						result.startsWith(
							'Clicked e1 link "Home"; the page is still loading https://example.test/next.\n\npage "Cart" https://example.test/next\n# Your cart',
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it(
			'catches a click receipt whose load wait or view capture outlasts the one receipt deadline',
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
						fixture.transport.event(
							'Page.frameNavigated',
							{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' } },
							'session-main',
						)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					// Setup helpers leave one-second budget timers behind; the baseline waits them out.
					await waitForDelay(1_100)
					const timers = process
						.getActiveResourcesInfo()
						.filter((resource) => resource === 'Timeout').length
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(4_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(result).toBe(
						'Clicked e1 link "Home"; the page is still loading https://example.test/next.\n\n(The view could not be read before the deadline; call look.)',
					)
					// Settling the receipt aborted the capture's readiness wait with its timer.
					expect(
						process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length,
					).toBe(timers)
				} finally {
					await client.close()
				}
			},
		)

		it('follows the load of the loader it committed and ignores another loader', async () => {
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['request', 'start'],
					)
					fixture.transport.reply(message.id, {})
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['commit'],
					)
					for (const [loaderId, name] of [
						['loader-next', 'DOMContentLoaded'],
						['loader-other', 'load'],
					])
						fixture.transport.event(
							'Page.lifecycleEvent',
							{ frameId: 'main', loaderId, name },
							'session-main',
						)
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const settled = createRecorder<[]>()
				const clicked = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the release is sent', () =>
					transport.sent.some((message) => message.params?.['type'] === 'mouseReleased'),
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				const loaded = performance.now()
				transport.event(
					'Page.lifecycleEvent',
					{ frameId: 'main', loaderId: 'loader-next', name: 'load' },
					'session-main',
				)
				const result = String(await clicked)
				expect(performance.now() - loaded).toBeLessThan(1_000)
				expect(
					result.startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n# Your cart',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})
	})

	describe('navigation settlement', () => {
		it.each(BROWSER_SUBMIT_ACTIONS)(
			'waits for the navigation a %s submission starts after its input settles, with the observer installed before the first input',
			async (name, args, action, input, observed) => {
				const reads = createRecorder<[message: CDPSentMessage]>()
				const fixture = await createBrowserElementFixture({
					submit: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['main'])
							reads.handler(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page, transport, windows } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'the form' }, { signal })
					const settled = createRecorder<[]>()
					const acting = Promise.resolve(
						requireValue(toolset.tools.tool(name)).execute(args, { signal }),
					).finally(settled.handler)
					await waitForCondition(
						'the input settles and the main observer is read',
						() => reads.count === 1,
					)
					windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
					answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					for (const stages of [['request', 'start'], ['commit']] as const) {
						emitBrowserNavigation(
							transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
							stages,
						)
						await waitForDelay(50)
						expect(settled.count).toBe(0)
					}
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['load'],
					)
					expect(
						String(await acting).startsWith(
							`${action}.\n\npage "Cart" https://example.test/next\n# Your cart`,
						),
					).toBe(true)
					const installs = transport.sent.filter((message) =>
						matchesBrowserSubmitObserver(readCDPExpression(message) ?? ''),
					)
					expect(installs.map((message) => message.sessionId)).toEqual(observed)
					expect(transport.sent.indexOf(requireValue(installs[0]))).toBeLessThan(
						transport.sent.findIndex((message) => message.method === input),
					)
					expect(windows.listeners).toBe(0)
				} finally {
					await client.close()
				}
			},
		)

		it('follows a navigation that a handler of the inserted text starts, with the record opened before the edit', async () => {
			const fixture = await createBrowserElementFixture({
				insert: (message) => {
					fixture.windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['request', 'start'],
					)
					fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'the form' }, { signal })
				const settled = createRecorder<[]>()
				const typing = Promise.resolve(
					requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'sam', submit: true },
						{ signal },
					),
				).finally(settled.handler)
				await waitForCondition('the text is inserted', () =>
					transport.sent.some((message) => message.method === 'Input.insertText'),
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['commit'],
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				const loaded = performance.now()
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['load'],
				)
				const receipt = String(await typing)
				expect(receipt.slice(receipt.indexOf('\n\n'))).toMatch(
					/^\n\npage "Cart" https:\/\/example\.test\/next\n/,
				)
				expect(performance.now() - loaded).toBeLessThan(1_000)
			} finally {
				await client.close()
			}
		})

		it('settles a navigation the edit starts while its input is still pending, holding the edit as the queue barrier', async () => {
			const held: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				insert: (message) => {
					held.push(message)
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
					)
				},
			})
			const { client, page, transport } = fixture
			const answered = new Set<number>()
			// Each outstanding action settles to its result or its error, so teardown can await it.
			const actions: Array<Promise<unknown>> = []
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'the form' }, { signal })
				const settled = createRecorder<[]>()
				const typing = Promise.resolve(
					requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'sam', submit: true },
						{ signal },
					),
				)
					.catch((error: unknown) => error)
					.finally(settled.handler)
				actions.push(typing)
				await waitForCondition(
					'the receipt settles while the insertion is withheld',
					() => settled.count === 1,
					{ budget: 3_000 },
				)
				expect(held).toHaveLength(1)
				expect(
					String(await typing).startsWith(
						'Typed "sam" into e2 textbox "Email".\n\npage "Cart" https://example.test/next\n',
					),
				).toBe(true)
				expect(transport.sent.some((message) => message.method === 'Input.dispatchKeyEvent')).toBe(
					false,
				)
				const pressed = createRecorder<[]>()
				const pressing = Promise.resolve(
					requireValue(toolset.tools.tool('press')).execute({ key: 'Escape' }, { signal }),
				)
					.catch((error: unknown) => error)
					.finally(pressed.handler)
				actions.push(pressing)
				await waitForDelay(50)
				expect(pressed.count).toBe(0)
				answered.add(requireValue(held[0]).id)
				transport.reply(requireValue(held[0]).id, {})
				expect(String(await pressing).split('\n', 1)[0]).toBe('Pressed Escape.')
			} finally {
				for (const message of held) if (!answered.has(message.id)) transport.reply(message.id, {})
				await Promise.all(actions)
				await client.close()
			}
		})

		it.each(BROWSER_CHILD_ARRANGEMENTS)(
			'waits for an %s child frame navigation that its submission starts after the input settles',
			async (_arrangement, local, session) => {
				const reads = createRecorder<[message: CDPSentMessage]>()
				let applied = false
				const fixture = await createBrowserElementFixture({
					local,
					submit: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
							reads.handler(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
					accessibility: (message) =>
						fixture.transport.reply(
							message.id,
							message.params?.['frameId'] !== 'child'
								? BROWSER_ELEMENT_AX_FIXTURE
								: applied
									? BROWSER_ELEMENT_APPLIED_FIXTURE
									: local
										? BROWSER_ELEMENT_FRAMED_FIXTURE
										: BROWSER_ELEMENT_CHILD_FIXTURE,
						),
				})
				const { client, page, transport, windows } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					const look = String(
						await requireValue(toolset.tools.tool('look')).execute(
							{ what: 'the voucher' },
							{ signal },
						),
					)
					const save = requireValue(
						/(e\d+) button "Save"/.exec(look)?.[1],
						'the framed Save reference',
					)
					const settled = createRecorder<[]>()
					const clicking = Promise.resolve(
						requireValue(toolset.tools.tool('click')).execute({ ref: save }, { signal }),
					).finally(settled.handler)
					await waitForCondition(
						'the input settles and the child observer is read',
						() => reads.count === 1,
					)
					const read = requireValue(reads.calls[0])[0]
					expect(read.sessionId).toBe(session)
					windows.window(session, 92).dispatch({ prevented: false, form: {} })
					answerBrowserEvaluation(transport, windows, read)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					for (const stages of [['request', 'start'], ['commit']] as const) {
						emitBrowserNavigation(
							transport,
							session,
							'child',
							'https://example.test/done',
							'loader-done',
							stages,
						)
						await waitForDelay(50)
						expect(settled.count).toBe(0)
					}
					applied = true
					emitBrowserNavigation(
						transport,
						session,
						'child',
						'https://example.test/done',
						'loader-done',
						['load'],
					)
					const result = String(await clicking)
					expect(
						result.startsWith(
							`Clicked ${save} button "Save".\n\npage "Cart" https://example.test/cart\n`,
						),
					).toBe(true)
					expect(result).toContain('# Voucher applied')
					expect(result.slice(result.indexOf('\n\n'))).not.toContain('button "Save"')
					expect(windows.listeners).toBe(0)
				} finally {
					await client.close()
				}
			},
		)

		it('waits for the main frame navigation when a child frame submits a form targeting _top', async () => {
			const reads = createRecorder<[message: CDPSentMessage]>()
			const fixture = await createBrowserElementFixture({
				submit: (message) => {
					if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
						reads.handler(message)
					else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				const look = String(
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'the voucher' },
						{ signal },
					),
				)
				const save = requireValue(
					/(e\d+) button "Save"/.exec(look)?.[1],
					'the framed Save reference',
				)
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: save }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the child observer is read', () => reads.count === 1)
				windows.window('session-child', 92).dispatch({ prevented: false, form: { target: '_top' } })
				answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				for (const stages of [['request', 'start'], ['commit']] as const) {
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						stages,
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
				}
				const loaded = performance.now()
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['load'],
				)
				expect(
					String(await clicking).startsWith(
						`Clicked ${save} button "Save".\n\npage "Cart" https://example.test/next\n`,
					),
				).toBe(true)
				expect(performance.now() - loaded).toBeLessThan(1_000)
			} finally {
				await client.close()
			}
		})

		it('waits for the parent frame navigation when Enter submits a nested form targeting _parent', async () => {
			const reads = createRecorder<[message: CDPSentMessage]>()
			let applied = false
			const fixture = await createBrowserElementFixture({
				local: true,
				nested: true,
				submit: (message) => {
					if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['nested'])
						reads.handler(message)
					else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
				accessibility: (message) =>
					fixture.transport.reply(
						message.id,
						message.params?.['frameId'] !== 'child'
							? BROWSER_ELEMENT_AX_FIXTURE
							: applied
								? BROWSER_ELEMENT_APPLIED_FIXTURE
								: BROWSER_ELEMENT_CHILD_FIXTURE,
					),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'the voucher' }, { signal })
				const settled = createRecorder<[]>()
				const pressing = Promise.resolve(
					requireValue(toolset.tools.tool('press')).execute({ key: 'Enter' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the nested observer is read', () => reads.count === 1)
				windows
					.window('session-main', 93)
					.dispatch({ prevented: false, form: { target: '_parent' } })
				answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				for (const stages of [['request', 'start'], ['commit']] as const) {
					emitBrowserNavigation(
						transport,
						'session-main',
						'child',
						'https://example.test/done',
						'loader-done',
						stages,
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
				}
				applied = true
				const loaded = performance.now()
				emitBrowserNavigation(
					transport,
					'session-main',
					'child',
					'https://example.test/done',
					'loader-done',
					['load'],
				)
				expect(String(await pressing)).toContain('# Voucher applied')
				expect(performance.now() - loaded).toBeLessThan(1_000)
			} finally {
				await client.close()
			}
		})

		it('refuses a click before any input when the document that receives it cannot be observed', async () => {
			const fixture = await createBrowserElementFixture({
				observe: (message) =>
					fixture.transport.fail(message.id, 'Cannot find context with specified id', -32000),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const refusal = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).catch((error: unknown) => error)
				expect(isBrowserError(refusal) && [refusal.code, refusal.context]).toEqual([
					'BROWSER_TOOLSET_OBSERVE',
					{ frame: 'main' },
				])
				expect(
					transport.sent.some((message) => message.method === 'Input.dispatchMouseEvent'),
				).toBe(false)
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it('presses the key when a child document installation fails', async () => {
			const fixture = await createBrowserElementFixture({
				observe: (message) => {
					if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
						fixture.transport.fail(message.id, 'Cannot find context with specified id', -32000)
					else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const result = String(
					await requireValue(toolset.tools.tool('press')).execute({ key: 'Enter' }, { signal }),
				)
				expect(result.startsWith('Pressed Enter.\n\npage "Cart" https://example.test/cart')).toBe(
					true,
				)
				expect(transport.sent.some((message) => message.method === 'Input.dispatchKeyEvent')).toBe(
					true,
				)
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it('installs in no frame attached after the census for a click in the main frame', async () => {
			const fixture = await createBrowserElementFixture({
				observe: (message) => {
					if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['main'])
						fixture.transport.event(
							'Page.frameAttached',
							{ frameId: 'late', parentFrameId: 'main' },
							'session-main',
						)
					answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal })
				expect(
					transport.sent
						.filter((message) => matchesBrowserSubmitObserver(readCDPExpression(message) ?? ''))
						.map((message) => [message.sessionId, message.params?.['contextId']]),
				).toEqual([['session-main', BROWSER_ELEMENT_WORLDS['main']]])
			} finally {
				await client.close()
			}
		})
		it.each(BROWSER_SESSION_MOVES)(
			'settles a child navigation whose commit and load arrive after the frame moves %s, and leaves no registration behind',
			async (_move, local, first, second) => {
				const reads = createRecorder<[message: CDPSentMessage]>()
				let applied = false
				const fixture = await createBrowserElementFixture({
					local,
					submit: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
							reads.handler(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
					accessibility: (message) =>
						fixture.transport.reply(
							message.id,
							message.params?.['frameId'] !== 'child'
								? BROWSER_ELEMENT_AX_FIXTURE
								: applied
									? BROWSER_ELEMENT_APPLIED_FIXTURE
									: local
										? BROWSER_ELEMENT_FRAMED_FIXTURE
										: BROWSER_ELEMENT_CHILD_FIXTURE,
						),
				})
				const { client, page, transport, windows, recording } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					const look = String(
						await requireValue(toolset.tools.tool('look')).execute(
							{ what: 'the voucher' },
							{ signal },
						),
					)
					const save = requireValue(
						/(e\d+) button "Save"/.exec(look)?.[1],
						'the framed Save reference',
					)
					const held = recording.registrations(undefined, 'session-main')
					const settled = createRecorder<[]>()
					const clicking = Promise.resolve(
						requireValue(toolset.tools.tool('click')).execute({ ref: save }, { signal }),
					).finally(settled.handler)
					await waitForCondition('the child observer is read', () => reads.count === 1)
					const read = requireValue(reads.calls[0])[0]
					windows.window(requireValue(read.sessionId), 92).dispatch({ prevented: false, form: {} })
					answerBrowserEvaluation(transport, windows, read)
					emitBrowserNavigation(
						transport,
						first,
						'child',
						'https://example.test/done',
						'loader-done',
						['request', 'start'],
					)
					if (local) {
						const published = waitForEvent<readonly [BrowserFrameInterface]>((handler) => {
							page.emitter.on('session', handler)
							return () => page.emitter.off('session', handler)
						}, 'the replacement session is published')
						transport.event(
							'Target.attachedToTarget',
							{
								sessionId: second,
								targetInfo: {
									targetId: 'child',
									type: 'iframe',
									url: 'https://example.test/done',
									parentFrameId: 'main',
								},
							},
							'session-main',
						)
						transport.event(
							'Page.frameDetached',
							{ frameId: 'child', reason: 'swap' },
							'session-main',
						)
						await published
					} else
						transport.event(
							'Target.detachedFromTarget',
							{ sessionId: first, targetId: 'child' },
							'session-main',
						)
					emitBrowserNavigation(
						transport,
						second,
						'child',
						'https://example.test/done',
						'loader-done',
						['commit'],
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					applied = true
					emitBrowserNavigation(
						transport,
						second,
						'child',
						'https://example.test/done',
						'loader-done',
						['load'],
					)
					const result = String(await clicking)
					expect(result).toContain('# Voucher applied')
					expect(result.split('\n', 1)[0]).toBe(`Clicked ${save} button "Save".`)
					expect(recording.registrations(undefined, 'session-main')).toBe(held)
					// The page holds one handler per step on a session it follows and none on a session
					// the frame left; the action holds none on either.
					const steps = [
						'Page.frameRequestedNavigation',
						'Page.frameStartedNavigating',
						'Page.frameNavigated',
						'Page.lifecycleEvent',
						'Page.frameStoppedLoading',
					]
					expect(
						local
							? steps.map((method) => recording.registrations(method, second))
							: [recording.registrations(undefined, first)],
					).toEqual(local ? steps.map(() => 1) : [0])
				} finally {
					await client.close()
				}
			},
		)

		it(
			'does not settle an action on its predecessor commit and load that arrive after its input',
			{ timeout: 15_000 },
			async () => {
				const reads = createRecorder<[message: CDPSentMessage]>()
				let pressing = false
				const fixture = await createBrowserElementFixture({
					released: (message) => {
						emitBrowserNavigation(
							fixture.transport,
							'session-main',
							'main',
							'https://example.test/a',
							'loader-a',
							['request', 'start'],
						)
						fixture.transport.reply(message.id, {})
					},
					submit: (message) => {
						if (pressing && message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['main'])
							reads.handler(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page, transport, windows } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const first = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					expect(first.split('\n', 1)[0]).toBe(
						'Clicked e1 link "Home"; it requested https://example.test/a and the page did not change.',
					)
					pressing = true
					const settled = createRecorder<[]>()
					const pressed = Promise.resolve(
						requireValue(toolset.tools.tool('press')).execute({ key: 'Enter' }, { signal }),
					).finally(settled.handler)
					await waitForCondition(
						'the press settles and the main observer is read',
						() => reads.count === 1,
					)
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/a',
						'loader-a',
						['commit', 'load'],
					)
					windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
					answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/b',
						'loader-b',
						['request', 'start'],
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/b',
						'loader-b',
						['commit', 'load'],
					)
					expect(
						String(await pressed).startsWith(
							'Pressed Enter.\n\npage "Cart" https://example.test/b\n',
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it('does not select a predecessor request that arrives while the next action installs its observer', async () => {
			const reads = createRecorder<[message: CDPSentMessage]>()
			let installs = 0
			const fixture = await createBrowserElementFixture({
				observe: (message) => {
					installs += 1
					if (installs === 2)
						emitBrowserNavigation(
							fixture.transport,
							'session-main',
							'main',
							'https://example.test/a',
							'loader-a',
							['request', 'start'],
						)
					answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
				submit: (message) => {
					if (installs === 2) reads.handler(message)
					else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
				},
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal })
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the second observer is read', () => reads.count === 1)
				windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
				answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/b',
					'loader-b',
					['request', 'start'],
				)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/a',
					'loader-a',
					['commit', 'load'],
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/b',
					'loader-b',
					['commit', 'load'],
				)
				expect(
					String(await clicking).startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/b\n',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('returns the same-page receipt without a navigation wait when every listener prevented the submission', async () => {
			const fixture = await createBrowserElementFixture({
				pressed: () =>
					fixture.windows.window('session-main', 91).dispatch({ prevented: true, form: {} }),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const started = performance.now()
				const result = String(
					await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				)
				expect(performance.now() - started).toBeLessThan(1_000)
				expect(
					result.startsWith(
						'Clicked e1 link "Home"; the page handled the submission without navigating; call wait for the text you expect.\n\npage "Cart" https://example.test/cart\n',
					),
				).toBe(true)
				expect(
					transport.sent
						.filter((message) => matchesBrowserSubmitRead(readCDPExpression(message) ?? ''))
						.map((message) => message.sessionId),
				).toEqual(['session-main'])
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it(
			'bounds a submission that produces no navigation request without a still-loading claim',
			{ timeout: 15_000 },
			async () => {
				const fixture = await createBrowserElementFixture({
					pressed: () =>
						fixture.windows.window('session-main', 91).dispatch({ prevented: false, form: {} }),
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(3_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(
						result.startsWith('Clicked e1 link "Home".\n\npage "Cart" https://example.test/cart\n'),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it('keeps the receipt pending until commit and load when the observer read fails after the input frame navigation started', async () => {
			const failed = createRecorder<[]>()
			const fixture = await createBrowserElementFixture({
				submit: (message) => {
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['request', 'start'],
					)
					fixture.transport.fail(message.id, 'Execution context was destroyed.', -32000)
					failed.handler()
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the main observer read fails', () => failed.count === 1)
				for (const stages of [[], ['commit']] as const) {
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						stages,
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
				}
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['load'],
				)
				expect(
					String(await clicking).startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it.each(['before the input command replies', 'between the input reply and the observer read'])(
			'settles a submission whose navigation starts %s',
			async (moment) => {
				const early = moment === 'before the input command replies'
				const fixture = await createBrowserElementFixture({
					released: (message) => {
						if (early)
							emitBrowserNavigation(
								fixture.transport,
								'session-main',
								'main',
								'https://example.test/next',
								'loader-next',
								['request', 'start'],
							)
						fixture.transport.reply(message.id, {})
					},
					submit: (message) => {
						if (!early)
							emitBrowserNavigation(
								fixture.transport,
								'session-main',
								'main',
								'https://example.test/next',
								'loader-next',
								['request', 'start'],
							)
						answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page, transport } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const settled = createRecorder<[]>()
					const clicking = Promise.resolve(
						requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					).finally(settled.handler)
					await waitForCondition('the navigation starts', () =>
						transport.sent.some((message) => message.params?.['type'] === 'mouseReleased'),
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['commit'],
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['load'],
					)
					expect(
						String(await clicking).startsWith(
							'Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n',
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it('settles a submission whose navigation stays within the document without a load', async () => {
			const reads = createRecorder<[message: CDPSentMessage]>()
			const fixture = await createBrowserElementFixture({
				submit: (message) => reads.handler(message),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the main observer is read', () => reads.count === 1)
				windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
				answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/cart?q=1#placed',
					'loader-main',
					['request'],
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				const navigated = performance.now()
				transport.event(
					'Page.navigatedWithinDocument',
					{
						frameId: 'main',
						url: 'https://example.test/cart?q=1#placed',
						navigationType: 'fragment',
					},
					'session-main',
				)
				const result = String(await clicking)
				expect(performance.now() - navigated).toBeLessThan(1_000)
				expect(
					result.startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/cart?q=1#placed\n',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('ignores a noncandidate child frame navigation while the destination is pending', async () => {
			const reads = createRecorder<[message: CDPSentMessage]>()
			const fixture = await createBrowserElementFixture({
				submit: (message) => reads.handler(message),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the main observer is read', () => reads.count === 1)
				windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
				answerBrowserEvaluation(transport, windows, requireValue(reads.calls[0])[0])
				emitBrowserNavigation(
					transport,
					'session-child',
					'child',
					'https://example.test/done',
					'loader-done',
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
				)
				expect(
					String(await clicking).startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('settles the one destination that requests among several positive ones', async () => {
			let applied = false
			const fixture = await createBrowserElementFixture({
				accessibility: (message) =>
					fixture.transport.reply(
						message.id,
						message.params?.['frameId'] !== 'child'
							? BROWSER_ELEMENT_AX_FIXTURE
							: applied
								? BROWSER_ELEMENT_APPLIED_FIXTURE
								: BROWSER_ELEMENT_CHILD_FIXTURE,
					),
			})
			const { client, page, transport, windows } = fixture
			try {
				transport.onSend('Input.dispatchKeyEvent', (message) => {
					if (message.params?.['type'] !== 'keyDown') return
					windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
					windows.window('session-child', 92).dispatch({ prevented: false, form: {} })
				})
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const settled = createRecorder<[]>()
				const pressing = Promise.resolve(
					requireValue(toolset.tools.tool('press')).execute({ key: 'Enter' }, { signal }),
				).finally(settled.handler)
				await waitForCondition(
					'both observers are read',
					() =>
						transport.sent.filter((message) =>
							matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
						).length === 2,
				)
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				for (const stages of [['request', 'start'], ['commit']] as const) {
					emitBrowserNavigation(
						transport,
						'session-child',
						'child',
						'https://example.test/done',
						'loader-done',
						stages,
					)
					await waitForDelay(50)
					expect(settled.count).toBe(0)
				}
				applied = true
				const loaded = performance.now()
				emitBrowserNavigation(
					transport,
					'session-child',
					'child',
					'https://example.test/done',
					'loader-done',
					['load'],
				)
				expect(String(await pressing)).toContain('# Voucher applied')
				expect(performance.now() - loaded).toBeLessThan(1_000)
			} finally {
				await client.close()
			}
		})

		it('refuses a click whose document was replaced after the observer installed', async () => {
			const fixture = await createBrowserElementFixture({
				observe: (message) => {
					if (message.params?.['contextId'] !== BROWSER_ELEMENT_WORLDS['child']) {
						answerBrowserEvaluation(fixture.transport, fixture.windows, message)
						return
					}
					const published = waitForEvent<readonly [BrowserFrameInterface]>((handler) => {
						fixture.page.emitter.on('session', handler)
						return () => fixture.page.emitter.off('session', handler)
					}, 'the replacement session is published')
					fixture.transport.event(
						'Target.attachedToTarget',
						{
							sessionId: 'session-child-again',
							targetInfo: {
								targetId: 'child',
								type: 'iframe',
								url: 'https://example.test/checkout',
								parentFrameId: 'main',
							},
						},
						'session-main',
					)
					void published.then(() => {
						fixture.transport.event(
							'Page.frameNavigated',
							{
								frame: {
									id: 'child',
									parentId: 'main',
									url: 'https://example.test/checkout',
									loaderId: 'loader-again',
								},
							},
							'session-child-again',
						)
						answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					})
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				const look = String(
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'the voucher' },
						{ signal },
					),
				)
				const save = requireValue(
					/(e\d+) button "Save"/.exec(look)?.[1],
					'the framed Save reference',
				)
				const refusal = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: save }, { signal }),
				).catch((error: unknown) => error)
				expect(isBrowserElementError(refusal) && refusal.context?.['reason']).toBe('GONE')
				expect(
					transport.sent.some((message) => message.method === 'Input.dispatchMouseEvent'),
				).toBe(false)
			} finally {
				await client.close()
			}
		})
	})

	describe('submission outcomes', () => {
		it('names wait as the next call in the status of a submission the page handled', () => {
			expect(BROWSER_TOOL_HANDLED_STATUS).toBe(
				'the page handled the submission without navigating; call wait for the text you expect',
			)
			expect(BROWSER_TOOL_HANDLED_STATUS.endsWith('; call wait for the text you expect')).toBe(true)
		})

		it.each(BROWSER_SUBMIT_ACTIONS)(
			'names the page handling of a %s submission a listener prevented, without a navigation wait',
			async (name, args, action) => {
				const fixture = await createBrowserElementFixture({
					submit: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['main'])
							fixture.windows
								.window('session-main', 91)
								.dispatch({ prevented: true, form: { method: 'post' } })
						answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'the form' }, { signal })
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool(name)).execute(args, { signal }),
					)
					expect(performance.now() - started).toBeLessThan(1_000)
					expect(result.split('\n\n', 1)[0]).toBe(
						`${action}; the page handled the submission without navigating; call wait for the text you expect.`,
					)
					expect(result).toContain('\n\npage "Cart" https://example.test/cart\n')
				} finally {
					await client.close()
				}
			},
		)

		it.each(BROWSER_SUBMIT_FOCUS_STEPS)(
			'returns the receipt line of %s when the observer records no submission',
			async (_label, main, child, name, args, line) => {
				const { client, page, windows } = await createBrowserElementFixture()
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'the form' }, { signal })
					windows.window('session-main', 91).focus(main)
					windows.window('session-child', 92).focus(child)
					const result = String(
						await requireValue(toolset.tools.tool(name)).execute(args, { signal }),
					)
					expect(result.split('\n\n', 1)[0]).toBe(line)
				} finally {
					await client.close()
				}
			},
		)

		it('keeps the destination view without a handled status when a surviving submission accompanies a prevented one', async () => {
			const fixture = await createBrowserElementFixture({
				submit: (message) => {
					const window = fixture.windows.window('session-main', 91)
					window.dispatch({ prevented: true, form: {} })
					window.dispatch({ prevented: false, form: {} })
					answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
					)
				},
			})
			const { client, page } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const result = String(
					await requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'sam', submit: true },
						{ signal },
					),
				)
				expect(
					result.startsWith(
						'Typed "sam" into e2 textbox "Email" and submitted the form.\n\npage "Cart" https://example.test/next\n',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it.each(BROWSER_SUBMIT_EARLY_CASES)(
			'names the clause of a type whose Enter %s outran before any read by the reason, with the destination view',
			async (_name, stages, reason, clause) => {
				const fixture = await createBrowserElementFixture()
				const { client, page, transport } = fixture
				transport.onSend('Input.dispatchKeyEvent', (message) => {
					if (message.params?.['type'] === 'keyDown')
						emitBrowserNavigation(
							transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
							stages,
							reason,
						)
				})
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const typing = requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'sam', submit: true },
						{ signal },
					)
					await waitForCondition('the Enter is released', () =>
						transport.sent.some(
							(message) =>
								message.method === 'Input.dispatchKeyEvent' && message.params?.['type'] === 'keyUp',
						),
					)
					emitBrowserNavigation(
						transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['commit', 'load'],
					)
					expect(
						String(await typing).startsWith(
							`Typed "sam" into e2 textbox "Email" ${clause}.\n\npage "Cart" https://example.test/next\n`,
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it.each(BROWSER_SUBMIT_NEGATIVE_CASES)(
			'names the submitted form of a type whose read answered no submission, with %s under a form reason',
			async (_name, first) => {
				const answered = createRecorder<[]>()
				const fixture = await createBrowserElementFixture({
					submit: (message) => {
						if (first)
							emitBrowserNavigation(
								fixture.transport,
								'session-main',
								'main',
								'https://example.test/next',
								'loader-next',
							)
						answerBrowserEvaluation(fixture.transport, fixture.windows, message)
						if (!first)
							emitBrowserNavigation(
								fixture.transport,
								'session-main',
								'main',
								'https://example.test/next',
								'loader-next',
								['request', 'start'],
							)
						answered.handler()
					},
				})
				const { client, page, transport, windows } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					windows.window('session-main', 91).focus({ name: 'input', form: { method: 'post' } })
					const typing = requireValue(toolset.tools.tool('type')).execute(
						{ ref: 'e2', text: 'sam', submit: true },
						{ signal },
					)
					await waitForCondition('the observer read answered', () => answered.count === 1)
					if (!first)
						emitBrowserNavigation(
							transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
							['commit', 'load'],
						)
					expect(
						String(await typing).startsWith(
							'Typed "sam" into e2 textbox "Email" and submitted the form.\n\npage "Cart" https://example.test/next\n',
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it.each(BROWSER_SUBMIT_UNREAD_CASES)(
			'names the clause of a type whose observer read failed and %s by its reason, with the view it reached',
			async (_name, stages, reason, url, clause) => {
				const fixture = await createBrowserElementFixture({
					submit: (message) => {
						emitBrowserNavigation(
							fixture.transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
							stages,
							reason,
						)
						fixture.transport.fail(message.id, 'Execution context was destroyed.', -32000)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const result = String(
						await requireValue(toolset.tools.tool('type')).execute(
							{ ref: 'e2', text: 'sam', submit: true },
							{ signal },
						),
					)
					expect(
						result.startsWith(
							`Typed "sam" into e2 textbox "Email" ${clause}.\n\npage "Cart" ${url}\n`,
						),
					).toBe(true)
				} finally {
					await client.close()
				}
			},
		)

		it.each(BROWSER_SUBMIT_MALFORMED_READS)(
			'takes %s from the observer read as an unknown outcome',
			async (_name, value) => {
				const fixture = await createBrowserElementFixture({
					submit: (message) => fixture.transport.reply(message.id, { result: { value } }),
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const result = String(
						await requireValue(toolset.tools.tool('type')).execute(
							{ ref: 'e2', text: 'sam', submit: true },
							{ signal },
						),
					)
					expect(result.split('\n\n', 1)[0]).toBe(
						'Typed "sam" into e2 textbox "Email" and pressed Enter.',
					)
				} finally {
					await client.close()
				}
			},
		)
	})

	describe('observer cleanup', () => {
		it('removes the observer when the click refuses before the read', async () => {
			const fixture = await createBrowserElementFixture({ actionability: 'Element is not visible' })
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const refusal = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).catch((error: unknown) => error)
				expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_ELEMENT_ERROR')
				expect(
					transport.sent.filter((message) =>
						matchesBrowserSubmitObserver(readCDPExpression(message) ?? ''),
					),
				).toHaveLength(1)
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it('removes the observer when a navigation that won the input race is abandoned', async () => {
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					emitBrowserNavigation(
						fixture.transport,
						'session-main',
						'main',
						'https://example.test/next',
						'loader-next',
						['request', 'start'],
					)
					fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await requireValue(toolset.tools.tool('look')).execute(
					{ what: 'home' },
					{ signal: new AbortController().signal },
				)
				const controller = new AbortController()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: controller.signal },
					),
				).catch((error: unknown) => error)
				await waitForCondition('the release is sent', () =>
					transport.sent.some((message) => message.params?.['type'] === 'mouseReleased'),
				)
				await waitForDelay(50)
				const reason = new Error('The caller left')
				controller.abort(reason)
				expect(await clicking).toBe(reason)
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it.each(['an abort', 'a dialog'])(
			'releases a partial installation after %s',
			async (interruption) => {
				const held: CDPSentMessage[] = []
				const fixture = await createBrowserElementFixture({
					observe: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
							held.push(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
					submit: (message) => {
						if (message.params?.['contextId'] === BROWSER_ELEMENT_WORLDS['child'])
							held.push(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page, transport, windows } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'home' },
						{ signal: new AbortController().signal },
					)
					const controller = new AbortController()
					const pressing = Promise.resolve(
						requireValue(toolset.tools.tool('press')).execute(
							{ key: 'Enter' },
							{ signal: controller.signal },
						),
					).catch((error: unknown) => error)
					await waitForCondition('the child installation is withheld', () => held.length === 1)
					await waitForCondition('the main observer installed', () => windows.listeners === 2)
					const reason = new Error('The caller left')
					if (interruption === 'an abort') controller.abort(reason)
					else
						transport.event(
							'Page.javascriptDialogOpening',
							{ type: 'alert', message: 'Coupon expired' },
							'session-main',
						)
					expect(await pressing).toBe(
						interruption === 'an abort'
							? reason
							: 'An alert dialog is open: "Coupon expired"; call dialog.',
					)
					expect(
						transport.sent.some((message) => message.method === 'Input.dispatchKeyEvent'),
					).toBe(false)
					await waitForCondition('the child removal is sent', () => held.length === 2)
					for (const message of held) answerBrowserEvaluation(transport, windows, message)
					expect(windows.listeners).toBe(0)
				} finally {
					await client.close()
				}
			},
		)

		it('keeps a reinstalled observer when an earlier action removal lands after it', async () => {
			const reads: CDPSentMessage[] = []
			let releases = 0
			const fixture = await createBrowserElementFixture({
				released: (message) => {
					releases += 1
					if (releases === 1) fixture.transport.fail(message.id, 'Input was refused')
					else fixture.transport.reply(message.id, {})
				},
				submit: (message) => reads.push(message),
			})
			const { client, page, transport, windows } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const refused = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).catch((error: unknown) => error)
				expect(String(readProperty(refused, 'message'))).toContain('Input was refused')
				expect(reads).toHaveLength(1)
				const settled = createRecorder<[]>()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).finally(settled.handler)
				await waitForCondition('the second action reads its observer', () => reads.length === 2)
				const [removal, read] = reads
				answerBrowserEvaluation(transport, windows, requireValue(removal))
				expect(windows.listeners).toBe(2)
				windows.window('session-main', 91).dispatch({ prevented: false, form: {} })
				answerBrowserEvaluation(transport, windows, requireValue(read))
				await waitForDelay(50)
				expect(settled.count).toBe(0)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
				)
				expect(
					String(await clicking).startsWith(
						'Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n',
					),
				).toBe(true)
				expect(windows.listeners).toBe(0)
			} finally {
				await client.close()
			}
		})

		it('returns the dialog receipt while the observer read is withheld', async () => {
			const reads: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				submit: (message) => reads.push(message),
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'Page.handleJavaScriptDialog')
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				)
				await waitForCondition('the observer read is withheld', () => reads.length === 1)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Leave the cart?' },
					'session-main',
				)
				expect(await clicking).toBe(
					'Clicked e1 link "Home". A confirm dialog is open: "Leave the cart?"; call dialog.',
				)
				expect(performance.now() - opened).toBeLessThan(1_000)
			} finally {
				await client.close()
			}
		})

		it(
			'returns the receipt at its deadline while an observer removal is withheld',
			{ timeout: 15_000 },
			async () => {
				const fixture = await createBrowserElementFixture({
					released: (message) => {
						emitBrowserNavigation(
							fixture.transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
						)
						fixture.transport.reply(message.id, {})
					},
					submit: () => undefined,
				})
				const { client, page, transport } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					expect(performance.now() - started).toBeLessThan(6_000)
					expect(
						result.startsWith('Clicked e1 link "Home".\n\npage "Cart" https://example.test/next\n'),
					).toBe(true)
					expect(
						transport.sent.filter((message) =>
							matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
						),
					).toHaveLength(1)
				} finally {
					await client.close()
				}
			},
		)

		it(
			'rejects with the abort reason and releases the queue when the action aborts while it waits for a withheld observer removal',
			{ timeout: 15_000 },
			async () => {
				const removals: CDPSentMessage[] = []
				const fixture = await createBrowserElementFixture({
					released: (message) => {
						emitBrowserNavigation(
							fixture.transport,
							'session-main',
							'main',
							'https://example.test/next',
							'loader-next',
						)
						fixture.transport.reply(message.id, {})
					},
					submit: (message) => {
						if (removals.length === 0) removals.push(message)
						else answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'home' },
						{ signal: new AbortController().signal },
					)
					const controller = new AbortController()
					const clicking = Promise.resolve(
						requireValue(toolset.tools.tool('click')).execute(
							{ ref: 'e1' },
							{ signal: controller.signal },
						),
					).catch((error: unknown) => error)
					await waitForCondition('the observer removal is withheld', () => removals.length === 1, {
						budget: 3_000,
					})
					const reason = new Error('The caller left')
					const aborted = performance.now()
					controller.abort(reason)
					expect(await clicking).toBe(reason)
					const pressed = String(
						await requireValue(toolset.tools.tool('press')).execute(
							{ key: 'Escape' },
							{ signal: new AbortController().signal },
						),
					)
					expect(pressed.split('\n', 1)[0]).toBe('Pressed Escape.')
					// The withheld removal's own 1 000 ms command timeout would release an unabortable wait.
					expect(performance.now() - aborted).toBeLessThan(500)
				} finally {
					await client.close()
				}
			},
		)

		it.each(['census', 'installation', 'read'])(
			'interrupts a withheld %s at an abort',
			async (step) => {
				let holding = false
				const fixture = await createBrowserElementFixture({
					tree: (message) => {
						if (!holding) fixture.transport.reply(message.id, buildBrowserElementTree())
					},
					observe: (message) => {
						if (step !== 'installation')
							answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
					submit: (message) => {
						if (step !== 'read')
							answerBrowserEvaluation(fixture.transport, fixture.windows, message)
					},
				})
				const { client, page, transport } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'home' },
						{ signal: new AbortController().signal },
					)
					const censuses = transport.sent.filter(
						(message) => message.method === 'Page.getFrameTree',
					).length
					holding = step === 'census'
					const controller = new AbortController()
					const pressing = Promise.resolve(
						requireValue(toolset.tools.tool('press')).execute(
							{ key: 'Enter' },
							{ signal: controller.signal },
						),
					).catch((error: unknown) => error)
					await waitForCondition(`the ${step} is sent`, () =>
						step === 'census'
							? transport.sent.filter((message) => message.method === 'Page.getFrameTree').length >
								censuses
							: transport.sent.some((message) =>
									(step === 'read' ? matchesBrowserSubmitRead : matchesBrowserSubmitObserver)(
										readCDPExpression(message) ?? '',
									),
								),
					)
					const reason = new Error('The caller left')
					const aborted = performance.now()
					controller.abort(reason)
					expect(await pressing).toBe(reason)
					expect(performance.now() - aborted).toBeLessThan(1_100)
				} finally {
					await client.close()
				}
			},
		)

		it('honours a cancellation that lands in the same turn as the completing load', async () => {
			const fixture = await createBrowserElementFixture({
				pressed: () =>
					fixture.windows.window('session-main', 91).dispatch({ prevented: false, form: {} }),
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await requireValue(toolset.tools.tool('look')).execute(
					{ what: 'home' },
					{ signal: new AbortController().signal },
				)
				const controller = new AbortController()
				const clicking = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: controller.signal },
					),
				).catch((error: unknown) => error)
				await waitForCondition('the observer is read', () =>
					transport.sent.some((message) =>
						matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
					),
				)
				await waitForDelay(20)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['request', 'start', 'commit'],
				)
				await waitForDelay(20)
				const reason = new Error('The caller left')
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
					['load'],
				)
				controller.abort(reason)
				expect(await clicking).toBe(reason)
			} finally {
				await client.close()
			}
		})

		it('releases its navigation waits when the navigation completes and when the action aborts', async () => {
			const fixture = await createBrowserElementFixture({
				pressed: () =>
					fixture.windows.window('session-main', 91).dispatch({ prevented: false, form: {} }),
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await requireValue(toolset.tools.tool('look')).execute(
					{ what: 'home' },
					{ signal: new AbortController().signal },
				)
				// Setup helpers leave one-second budget timers behind; the baseline waits them out.
				await waitForDelay(1_100)
				const timers = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length
				const completing = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: new AbortController().signal },
					),
				)
				await waitForCondition('the first observer is read', () =>
					transport.sent.some((message) =>
						matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
					),
				)
				emitBrowserNavigation(
					transport,
					'session-main',
					'main',
					'https://example.test/next',
					'loader-next',
				)
				await completing
				expect(process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length).toBe(
					timers,
				)
				const look = String(
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'home' },
						{ signal: new AbortController().signal },
					),
				)
				const home = requireValue(/(e\d+) link "Home"/.exec(look)?.[1], 'the fresh Home reference')
				const controller = new AbortController()
				const reads = transport.sent.filter((message) =>
					matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
				).length
				const aborting = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: home },
						{ signal: controller.signal },
					),
				).catch((error: unknown) => error)
				await waitForCondition(
					'the second observer is read',
					() =>
						transport.sent.filter((message) =>
							matchesBrowserSubmitRead(readCDPExpression(message) ?? ''),
						).length > reads,
				)
				await waitForDelay(20)
				controller.abort(new Error('The caller left'))
				await aborting
				expect(process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length).toBe(
					timers,
				)
			} finally {
				await client.close()
			}
		})
	})

	describe('queue', () => {
		it('catches concurrent clicks whose pointer pairs interleave', async () => {
			const releases: CDPSentMessage[] = []
			const { client, page, transport } = await createBrowserElementFixture({
				released: (message) => releases.push(message),
			})
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'cart' } })
				const start = transport.sent.length
				const batch = toolset.tools.execute([
					{ id: 'a', name: 'click', arguments: { ref: 'e1' } },
					{ id: 'b', name: 'click', arguments: { ref: 'e4' } },
				])
				await waitForCondition('the first release', () => releases.length === 1)
				await waitForDelay(20)
				expect(
					transport.sent
						.slice(start)
						.filter((message) => message.method === 'Input.dispatchMouseEvent')
						.map((message) => message.params?.['type']),
				).toEqual(['mousePressed', 'mouseReleased'])
				transport.reply(requireValue(releases[0]).id, {})
				await waitForCondition('the second release', () => releases.length === 2)
				transport.reply(requireValue(releases[1]).id, {})
				expect((await batch).map((result) => result.success)).toEqual([true, true])
				const mouse = transport.sent
					.slice(start)
					.filter(
						(message) =>
							message.method === 'Input.dispatchMouseEvent' ||
							message.method === 'DOM.scrollIntoViewIfNeeded',
					)
					.map((message) => message.params?.['type'] ?? message.params?.['backendNodeId'])
				expect(mouse).toEqual([
					3,
					'mousePressed',
					'mouseReleased',
					7,
					'mousePressed',
					'mouseReleased',
				])
			} finally {
				await client.close()
			}
		})

		it('catches a queued action that sends after its signal aborts', async () => {
			const releases: CDPSentMessage[] = []
			const { client, page, transport } = await createBrowserElementFixture({
				released: (message) => releases.push(message),
			})
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'cart' } })
				const click = requireValue(toolset.tools.tool('click'))
				const first = Promise.resolve(
					click.execute({ ref: 'e1' }, { signal: new AbortController().signal }),
				)
				await waitForCondition('the first release', () => releases.length === 1)
				const controller = new AbortController()
				const queued = Promise.resolve(
					click.execute({ ref: 'e4' }, { signal: controller.signal }),
				).catch((caught: unknown) => caught)
				await waitForDelay(10)
				const sent = transport.sent.length
				controller.abort('left the queue')
				expect(await queued).toBe('left the queue')
				transport.reply(requireValue(releases[0]).id, {})
				expect(String(await first).startsWith('Clicked e1 link "Home".')).toBe(true)
				expect(
					transport.sent
						.slice(sent)
						.filter(
							(message) =>
								message.method === 'Input.dispatchMouseEvent' ||
								message.params?.['backendNodeId'] === 7,
						),
				).toEqual([])
			} finally {
				await client.close()
			}
		})

		it('catches an abort after the press that skips the release or lets the next press overtake it', async () => {
			const controller = new AbortController()
			const releases: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				pressed: () => controller.abort('stopped'),
				released: (message) => {
					if (releases.length === 0) releases.push(message)
					else fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'cart' } })
				const start = transport.sent.length
				const click = requireValue(toolset.tools.tool('click'))
				const aborted = Promise.resolve(
					click.execute({ ref: 'e1' }, { signal: controller.signal }),
				).catch((caught: unknown) => caught)
				const next = Promise.resolve(
					click.execute({ ref: 'e4' }, { signal: new AbortController().signal }),
				)
				await waitForCondition('the release is withheld', () => releases.length === 1)
				await waitForDelay(20)
				expect(
					transport.sent
						.slice(start)
						.filter((message) => message.method === 'Input.dispatchMouseEvent')
						.map((message) => message.params?.['type']),
				).toEqual(['mousePressed', 'mouseReleased'])
				transport.reply(requireValue(releases[0]).id, {})
				expect(await aborted).toBe('stopped')
				expect(String(await next).startsWith('Clicked e4 button "Place order".')).toBe(true)
				expect(
					transport.sent
						.slice(start)
						.filter((message) => message.method === 'Input.dispatchMouseEvent')
						.map((message) => message.params?.['type']),
				).toEqual(['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'])
			} finally {
				await client.close()
			}
		})

		it('catches a tool signal that never reaches the protocol command', async () => {
			const trees: CDPSentMessage[] = []
			const { client, page, transport } = await createBrowserElementFixture({
				accessibility: (message) => trees.push(message),
			})
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const controller = new AbortController()
				const reason = new Error('the model stopped')
				const looked = Promise.resolve(
					requireValue(toolset.tools.tool('look')).execute(
						{ what: 'cart' },
						{ signal: controller.signal },
					),
				).catch((caught: unknown) => caught)
				await waitForCondition('the tree request', () => trees.length === 1)
				controller.abort(reason)
				expect(await looked).toBe(reason)
				// `look` does not race the signal itself, so the reason it rejects with is the one its
				// pending protocol entry rejected with.
				const tree = requireValue(trees[0])
				expect(tree.sessionId).toBe('session-main')
				// The aborted request's reply lands on no pending command, so the outline sends
				// nothing after it; an outline that never received the signal would continue.
				const sent = transport.sent.length
				transport.reply(tree.id, BROWSER_ELEMENT_AX_FIXTURE)
				await waitForDelay(20)
				expect(transport.sent.slice(sent)).toEqual([])
			} finally {
				await client.close()
			}
		})
	})

	describe('views', () => {
		it('catches tabs or switch advertised without a context, a switch that skips bringing the tab forward, or a tab list without the current mark', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				let created = 0
				transport.onSend('Target.createTarget', (message) => {
					created += 1
					transport.reply(message.id, { targetId: `tab-${created}` })
				})
				transport.onSend('Target.attachToTarget', (message) =>
					transport.reply(message.id, {
						sessionId: `session-${String(message.params?.['targetId'])}`,
					}),
				)
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Browser.setDownloadBehavior',
					'Network.enable',
					'Page.bringToFront',
				])
					replyOk(transport, method)
				const context = new BrowserContext(client)
				const first = await context.create()
				const second = await context.create()
				expect(
					createBrowserToolset(page)
						.tools.tools()
						.map((tool) => tool.name),
				).not.toContain('tabs')
				const toolset = createBrowserToolset(first, { context })
				await toolset.start()
				const actions = createRecorder<readonly [BrowserAction]>()
				toolset.emitter.on('action', actions.handler)
				await expect(
					performBrowserStep(toolset, 's3', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Cart', url: 'about:blank' },
					}),
				).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_AMBIGUOUS' })
				expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([
					'look',
					'read',
					'click',
					'type',
					'press',
					'navigate',
					'wait',
					'tabs',
					'switch',
				])
				expect(toolset.native.map((tool) => tool.name)).not.toContain('tabs')
				const signal = new AbortController().signal
				expect(
					await requireValue(toolset.tools.tool('tabs')).execute({ what: 'tabs' }, { signal }),
				).toBe('t1 "Cart" about:blank (current)\nt2 "Cart" about:blank')
				const selected = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the switch selects the second tab')
				const switched = String(
					await requireValue(toolset.tools.tool('switch')).execute({ tab: 't2' }, { signal }),
				)
				expect((await selected)[0]).toBe(second)
				expect(toolset.view).toBe(second)
				expect(actions.calls[0]?.[0]).toMatchObject({
					action: 'switch',
					tab: { title: 'Cart', url: 'about:blank' },
					outcome: 'done',
					arguments: { tab: 't2' },
				})
				expect(switched.startsWith('Switched to t2 about:blank.\n\npage "Cart" about:blank')).toBe(
					true,
				)
				expect(
					transport.sent.find((message) => message.method === 'Page.bringToFront')?.sessionId,
				).toBe('session-tab-2')
				expect(
					await requireValue(toolset.tools.tool('tabs')).execute({ what: 'tabs' }, { signal }),
				).toBe('t1 "Cart" about:blank\nt2 "Cart" about:blank (current)')
				expect(
					await toolset.tools.execute({ id: 'nine', name: 'switch', arguments: { tab: 't9' } }),
				).toMatchObject({ success: false, error: 'Tab "t9" is not open; call tabs.' })
			} finally {
				await client.close()
			}
		})

		it('keeps the view on the opener when a popup that already closed reaches it', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const selected = createRecorder<[view: BrowserViewInterface]>()
				toolset.emitter.on('select', selected.handler)
				const closed = new BrowserPage(client, 'gone', 'session-gone')
				void closed.destroy()

				page.emitter.emit('popup', closed)
				await waitForDelay(20)

				expect(closed.closed).toBe(true)
				expect(selected.count).toBe(0)
				expect(toolset.view).toBe(page)
				await toolset.destroy()
			} finally {
				await client.close()
			}
		})

		it('catches a popup that leaves the view behind, a receipt that omits the move, a close that strands the view, or a continuation read across the move', async () => {
			const html = `<main><h1>Guide</h1>${Array.from(
				{ length: 12 },
				(_, index) => `<p>Paragraph ${index} carries enough words to fill one line of text.</p>`,
			).join('')}</main>`
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, {
						result: {
							value: String(message.params?.['expression']).includes('outerHTML')
								? {
										url:
											message.sessionId === 'popup-session'
												? 'https://example.test/popup'
												: 'https://example.test/cart',
										title: 'Cart',
										html,
									}
								: true,
						},
					}),
			})
			const { client, page, transport } = fixture
			try {
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Network.enable',
					'Network.disable',
					'Target.detachFromTarget',
				])
					replyOk(transport, method)
				const toolset = createBrowserToolset(page, { limit: 200 })
				await toolset.start()
				const signal = new AbortController().signal
				const read = requireValue(toolset.tools.tool('read'))
				const first = String(await read.execute({ what: 'guide' }, { signal }))
				const end = Number(requireValue(/call read with offset (\d+) for more\]$/.exec(first))[1])
				const moved = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view follows the popup')
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-session',
						targetInfo: {
							targetId: 'popup-1',
							type: 'page',
							url: 'https://example.test/popup',
						},
					},
					'session-main',
				)
				const [popup] = await moved
				expect(popup.url).toBe('https://example.test/popup')
				expect(toolset.view).toBe(popup)
				const looked = String(
					await requireValue(toolset.tools.tool('look')).execute({ what: 'popup' }, { signal }),
				)
				expect(
					looked.startsWith(
						'The view moved to a new tab: https://example.test/popup.\n\npage "Cart" https://example.test/popup',
					),
				).toBe(true)
				const continued = String(await read.execute({ what: 'guide', offset: end }, { signal }))
				expect(continued).toMatch(
					/\n\n\[characters 0–\d+ of \d+; call read with offset \d+ for more\]$/,
				)
				const captures = transport.sent.filter((message) =>
					String(message.params?.['expression']).includes('outerHTML'),
				)
				expect(captures.map((message) => message.sessionId)).toEqual([
					'session-main',
					'popup-session',
				])
				const returned = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view returns to the opener')
				transport.event(
					'Target.detachedFromTarget',
					{ sessionId: 'popup-session', targetId: 'popup-1' },
					'session-main',
				)
				expect((await returned)[0]).toBe(page)
				const back = String(
					await requireValue(toolset.tools.tool('look')).execute({ what: 'cart' }, { signal }),
				)
				expect(
					back.startsWith(
						'The tab https://example.test/popup closed; the view returned to https://example.test/cart.\n\npage "Cart" https://example.test/cart',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})

		it.each(['tools.execute', 'perform'] as const)(
			'settles a click that opens a popup on the popup through %s: the result carries the move and the popup view, and the action the popup as its tab',
			async (path) => {
				const fixture = await createBrowserElementFixture({
					held: true,
					title: (message) =>
						fixture.transport.reply(message.id, {
							result: { value: message.sessionId === 'popup-session' ? 'Details' : 'Cart' },
						}),
					// Chromium 141 reports the window on the opener's session before it answers the
					// release; the popup's attach comes before the reply here too.
					released: (message) => {
						emitBrowserWindowOpen(fixture.transport, 'session-main', 'https://example.test/popup')
						fixture.transport.event(
							'Target.attachedToTarget',
							{
								sessionId: 'popup-session',
								targetInfo: {
									targetId: 'popup-1',
									type: 'page',
									url: 'https://example.test/popup',
								},
							},
							'session-main',
						)
						fixture.transport.reply(message.id, {})
					},
				})
				const { client, page, transport } = fixture
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Network.enable',
					'Network.disable',
					'Target.detachFromTarget',
				])
					replyOk(transport, method)
				const toolset = createBrowserToolset(page)
				try {
					await toolset.start()
					await page.elements.outline()
					const selected = createRecorder<[view: BrowserViewInterface]>()
					toolset.emitter.on('select', selected.handler)
					const actions = createRecorder<[action: BrowserAction]>()
					toolset.emitter.on('action', actions.handler)
					const call = { id: 's1', name: 'click', arguments: { ref: 'e4' } }
					const result =
						path === 'perform'
							? (await toolset.perform(call)).result
							: await toolset.tools.execute(call)

					const text = result.success ? String(result.value) : result.error
					expect(
						text.startsWith(
							'The view moved to a new tab: https://example.test/popup.\n\nClicked e4 button "Place order".\n\npage "Details" https://example.test/popup',
						),
					).toBe(true)
					expect(toolset.view).not.toBe(page)
					expect(toolset.view.url).toBe('https://example.test/popup')
					expect(actions.calls.map(([action]) => action)).toMatchObject([
						{
							action: 'click',
							outcome: 'done',
							receipt: 'Clicked e4 button "Place order".',
							tab: { url: 'https://example.test/popup', title: 'Details' },
						},
					])
					// The popup event reached the toolset during the click, which moved the view once.
					expect(selected.calls.map(([view]) => view)).toStrictEqual([toolset.view])
					const looked = await toolset.tools.execute({
						id: 'look',
						name: 'look',
						arguments: { what: 'the details' },
					})
					expect(
						looked.success &&
							String(looked.value).startsWith('page "Details" https://example.test/popup'),
					).toBe(true)
				} finally {
					await toolset.destroy()
					await client.close()
				}
			},
		)
	})

	describe('page tools', () => {
		it('catches a page tool added under a reserved, held, malformed, optional-what, or debugging name, or a destroy that removes the consumer tool', async () => {
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'WebMCP.disable')
				const tools = createToolManager()
				const notes = createTool({ name: 'notes', execute: ignoreCall })
				tools.add(notes)
				const toolset = createBrowserToolset(page, { tools })
				const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
				const adopted = createRecorder<readonly [ToolInterface]>()
				toolset.emitter.on('skip', skips.handler)
				toolset.emitter.on('adopt', adopted.handler)
				await toolset.start()
				const native = requireValue(tools.tool('click'))
				transport.event(
					'WebMCP.toolsAdded',
					{
						tools: [
							{ name: 'click', description: 'Page click', frameId: 'main' },
							{ name: 'notes', description: 'Page notes', frameId: 'main' },
							{ name: 'a.b', description: 'Dotted', frameId: 'main' },
							{
								name: 'lookup',
								description: 'Optional what',
								frameId: 'main',
								inputSchema: { type: 'object', properties: { what: { type: 'string' } } },
							},
							{
								name: 'debug',
								description: 'Developer',
								frameId: 'main',
								annotations: { debugging: true },
							},
							{
								name: 'search',
								description: 'Search the catalog',
								frameId: 'main',
								annotations: { readOnly: true },
							},
							{ name: 'cart', description: 'Show the cart', frameId: 'main' },
						],
					},
					'session-main',
				)
				await waitForCondition('the page tools are adopted', () => adopted.count === 2)
				expect(skips.calls).toEqual([
					['click', 'reserved'],
					['notes', 'held'],
					['a.b', 'pattern'],
					['lookup', 'schema'],
					['debug', 'debugging'],
				])
				expect(adopted.calls.map(([tool]) => tool.name)).toEqual(['search', 'cart'])
				expect(tools.tool('click')).toBe(native)
				expect(tools.tool('notes')).toBe(notes)
				expect(tools.tool('search')?.annotations).toEqual({ pure: true, untrusted: true })
				expect(tools.tool('search')?.description).toBe('Search the catalog')
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Hold on' },
					'session-main',
				)
				expect(
					await tools.execute({ id: 'search', name: 'search', arguments: { what: 'boots' } }),
				).toMatchObject({
					success: false,
					error: 'An alert dialog is open: "Hold on"; call dialog.',
				})
				const search = createTool({ name: 'search', execute: ignoreCall })
				tools.add(search)
				await toolset.destroy()
				expect(tools.tools()).toEqual([notes, search])
			} finally {
				await client.close()
			}
		})

		it('catches a source without a census whose reserved tool is added', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const click = createTool({ name: 'click', description: 'Page click', execute: ignoreCall })
				const extra = createTool({ name: 'extra', description: 'Page extra', execute: ignoreCall })
				const source: BrowserToolSourceInterface = {
					emitter: new Emitter<BrowserToolSourceEventMap>(),
					adopt: () => Promise.resolve([click, extra]),
				}
				const toolset = createBrowserToolset(page, { source })
				const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
				toolset.emitter.on('skip', skips.handler)
				await toolset.start()
				expect(skips.calls).toEqual([['click', 'reserved']])
				expect(toolset.tools.tool('click')).toBe(toolset.native[2])
				expect(toolset.tools.tool('extra')?.annotations).toEqual({ untrusted: true })
				expect(toolset.tools.tool('extra')?.description).toBe('Page extra')
			} finally {
				await client.close()
			}
		})

		it('catches an adoption that lands after a newer change, a view move, a move and return, or destroy', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Network.enable',
					'Network.disable',
					'Target.detachFromTarget',
				])
					replyOk(transport, method)
				const adoptions = Array.from({ length: 8 }, () =>
					Promise.withResolvers<readonly ToolInterface[]>(),
				)
				let calls = 0
				const emitter = new Emitter<BrowserToolSourceEventMap>()
				const source: BrowserToolSourceInterface = {
					emitter,
					tools: () => [],
					adopt: () => {
						calls += 1
						return requireValue(adoptions[calls - 1]).promise
					},
				}
				requireValue(adoptions[0]).resolve([])
				const toolset = createBrowserToolset(page, { source })
				await toolset.start()
				emitter.emit('change')
				emitter.emit('change')
				requireValue(adoptions[2]).resolve([createTool({ name: 'fresh', execute: ignoreCall })])
				await waitForCondition(
					'the newer adoption',
					() => toolset.tools.tool('fresh') !== undefined,
				)
				requireValue(adoptions[1]).resolve([createTool({ name: 'stale', execute: ignoreCall })])
				await waitForDelay(10)
				expect(toolset.tools.tool('stale')).toBeUndefined()
				emitter.emit('change')
				const moved = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view follows the popup')
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-session',
						targetInfo: { targetId: 'popup-1', type: 'page', url: 'https://example.test/popup' },
					},
					'session-main',
				)
				await moved
				await waitForCondition('the move adopts again', () => calls === 5)
				requireValue(adoptions[3]).resolve([createTool({ name: 'moved', execute: ignoreCall })])
				await waitForDelay(10)
				expect(toolset.tools.tool('moved')).toBeUndefined()
				requireValue(adoptions[4]).resolve([])
				emitter.emit('change')
				const back = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view returns to the opener')
				transport.event(
					'Target.detachedFromTarget',
					{ sessionId: 'popup-session', targetId: 'popup-1' },
					'session-main',
				)
				expect((await back)[0]).toBe(page)
				await waitForCondition('the return adopts again', () => calls === 7)
				requireValue(adoptions[5]).resolve([createTool({ name: 'round', execute: ignoreCall })])
				await waitForDelay(10)
				expect(toolset.tools.tool('round')).toBeUndefined()
				requireValue(adoptions[6]).resolve([])
				emitter.emit('change')
				await toolset.destroy()
				requireValue(adoptions[7]).resolve([createTool({ name: 'late', execute: ignoreCall })])
				await waitForDelay(10)
				expect(toolset.tools.tools()).toEqual([])
			} finally {
				await client.close()
			}
		})
	})

	describe('bounds', () => {
		it('catches a view, a slice, a page tool output or error, a dialog message, or a tab title that escapes the limit', async () => {
			const huge = 'm'.repeat(1_000_000)
			const html = `<main><h1>Guide</h1>${Array.from(
				{ length: 12 },
				(_, index) => `<p>Paragraph ${index} carries enough words to fill one line of text.</p>`,
			).join('')}</main>`
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
				title: (message) =>
					fixture.transport.reply(message.id, {
						result: { value: message.sessionId === 'session-tab' ? huge : 'Cart' },
					}),
				evaluation: (message) =>
					fixture.transport.reply(message.id, {
						result: {
							value: String(message.params?.['expression']).includes('outerHTML')
								? { url: 'https://example.test/cart', title: 'Cart', html }
								: true,
						},
					}),
			})
			const { client, page, transport } = fixture
			try {
				for (const method of [
					'WebMCP.disable',
					'Page.handleJavaScriptDialog',
					'Page.setInterceptFileChooserDialog',
					'Browser.setDownloadBehavior',
					'Network.enable',
					'Target.createTarget',
				])
					replyOk(transport, method, method === 'Target.createTarget' ? { targetId: 'tab-1' } : {})
				replyOk(transport, 'Target.attachToTarget', { sessionId: 'session-tab' })
				transport.onSend('WebMCP.invokeTool', (message) => {
					const tool = String(message.params?.['toolName'])
					transport.reply(message.id, { invocationId: tool })
					transport.event(
						'WebMCP.toolResponded',
						tool === 'big'
							? { invocationId: tool, status: 'Completed', output: huge }
							: { invocationId: tool, status: 'Error', errorText: huge },
						'session-main',
					)
				})
				const context = new BrowserContext(client)
				const tab = await context.create()
				const cut = /^[\s\S]{63,64}\n\[characters 0–6[34] of \d+; the rest was cut\]$/
				const viewed =
					/^[\s\S]{63,64}\n\[characters 0–6[34] of \d+; the rest was cut; call read for the page's text\]$/
				const refused = await Promise.resolve(
					requireValue(
						createBrowserToolset(page, { limit: 64, tools: createToolManager() }).native[2],
					).execute({ ref: huge }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(refused, 'message')).toMatch(cut)
				expect(readProperty(refused, 'code')).toBe('BROWSER_ELEMENT_ERROR')
				expect(readProperty(refused, 'context')).toEqual({
					subject: `Reference ${JSON.stringify(huge)}`,
					reason: 'UNKNOWN',
				})
				const toolset = createBrowserToolset(page, { limit: 64, context })
				await toolset.start()
				const signal = new AbortController().signal
				expect(
					await requireValue(toolset.tools.tool('look')).execute({ what: 'cart' }, { signal }),
				).toMatch(viewed)
				const slice = String(
					await requireValue(toolset.tools.tool('read')).execute({ what: 'guide' }, { signal }),
				)
				const [body = '', footer = ''] = slice.split('\n\n[characters ')
				expect(body.length).toBeLessThanOrEqual(64)
				expect(footer).toMatch(/^0–\d+ of \d+; call read with offset \d+ for more\]$/)
				transport.event(
					'WebMCP.toolsAdded',
					{
						tools: [
							{ name: 'big', description: 'Large output', frameId: 'main' },
							{ name: 'broken', description: 'Large error', frameId: 'main' },
						],
					},
					'session-main',
				)
				await waitForCondition(
					'the page tools are adopted',
					() => toolset.tools.tool('broken') !== undefined,
				)
				const [big, broken] = await toolset.tools.execute([
					{ id: '1', name: 'big', arguments: { what: 'output' } },
					{ id: '2', name: 'broken', arguments: { what: 'error' } },
				])
				expect(readProperty(big, 'value')).toMatch(cut)
				expect(readProperty(broken, 'error')).toMatch(cut)
				expect(String(readProperty(broken, 'error')).startsWith('Browser tool Error: mmm')).toBe(
					true,
				)
				expect(tab.url).toBe('about:blank')
				const tabs = await toolset.tools.execute({
					id: 't',
					name: 'tabs',
					arguments: { what: 'x' },
				})
				expect(readProperty(tabs, 'value')).toMatch(cut)
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'prompt', message: huge },
					'session-main',
				)
				const refusal = await toolset.tools.execute({
					id: 'r',
					name: 'look',
					arguments: { what: 'x' },
				})
				expect(readProperty(refusal, 'error')).toMatch(cut)
				expect(
					await requireValue(toolset.tools.tool('dialog')).execute({ accept: false }, { signal }),
				).toMatch(viewed)
			} finally {
				await client.close()
			}
		})

		it('catches a continuation read that recaptures a current reading or reuses a stale one', async () => {
			const html = `<main><h1>Guide</h1>${Array.from(
				{ length: 12 },
				(_, index) => `<p>Paragraph ${index} carries enough words to fill one line of text.</p>`,
			).join('')}</main>`
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, {
						result: {
							value: String(message.params?.['expression']).includes('outerHTML')
								? { url: 'https://example.test/cart', title: 'Cart', html }
								: true,
						},
					}),
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page, { limit: 120 })
				await toolset.start()
				const signal = new AbortController().signal
				const read = requireValue(toolset.tools.tool('read'))
				const first = String(await read.execute({ what: 'guide' }, { signal }))
				const end = Number(requireValue(/call read with offset (\d+) for more\]$/.exec(first))[1])
				const second = String(await read.execute({ what: 'guide', offset: end }, { signal }))
				expect(second).toMatch(new RegExp(`\\n\\n\\[characters ${end}–\\d+ of \\d+`))
				expect(
					transport.sent.filter((message) =>
						String(message.params?.['expression']).includes('outerHTML'),
					),
				).toHaveLength(1)
				transport.event(
					'Page.navigatedWithinDocument',
					{ frameId: 'main', url: 'https://example.test/cart#next' },
					'session-main',
				)
				const stale = String(await read.execute({ what: 'guide', offset: end }, { signal }))
				expect(stale).toMatch(
					/\n\n\[characters 0–\d+ of \d+; call read with offset \d+ for more\]$/,
				)
				expect(
					transport.sent.filter((message) =>
						String(message.params?.['expression']).includes('outerHTML'),
					),
				).toHaveLength(2)
			} finally {
				await client.close()
			}
		})

		it('restarts the retained reading at 0 for an offset at or past its end after a DOM edit without a navigation, and continues one inside it', async () => {
			let html = `<main><h1>Guide</h1>${Array.from(
				{ length: 12 },
				(_, index) => `<p>Paragraph ${index} carries enough words to fill one line of text.</p>`,
			).join('')}</main>`
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, {
						result: {
							value: String(message.params?.['expression']).includes('outerHTML')
								? { url: 'https://example.test/cart', title: 'Cart', html }
								: true,
						},
					}),
			})
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page, { limit: 120 })
				await toolset.start()
				const signal = new AbortController().signal
				const read = requireValue(toolset.tools.tool('read'))
				const first = String(await read.execute({ what: 'guide' }, { signal }))
				const [, end = '', total = ''] = requireValue(
					/\n\n\[characters 0–(\d+) of (\d+); call read with offset \d+ for more\]$/.exec(first),
				)
				expect(Number(end)).toBeLessThan(Number(total))
				// The edit leaves the reading current, because only a navigation makes it stale.
				html = '<main><h1>Edited</h1><p>The page changed its text in place.</p></main>'
				for (const offset of [Number(total), Number(total) + 1_000]) {
					expect(await read.execute({ what: 'guide', offset }, { signal })).toBe(first)
				}
				const last = Number(total) - 1
				expect(await read.execute({ what: 'guide', offset: last }, { signal })).toMatch(
					new RegExp(`^[\\s\\S]\\n\\n\\[characters ${last}–${total} of ${total}\\]$`),
				)
				expect(
					transport.sent.filter((message) =>
						String(message.params?.['expression']).includes('outerHTML'),
					),
				).toHaveLength(1)
				expect(await read.execute({ what: 'guide' }, { signal })).toBe(
					'# Edited\n\nThe page changed its text in place.',
				)
			} finally {
				await client.close()
			}
		})
	})

	describe('destroy', () => {
		it('catches a destroyed toolset that still runs a tool, keeps a queued action, or leaves its tools', async () => {
			const releases: CDPSentMessage[] = []
			const { client, page, transport } = await createBrowserElementFixture({
				released: (message) => releases.push(message),
			})
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'cart' } })
				const click = requireValue(toolset.tools.tool('click'))
				const look = requireValue(toolset.tools.tool('look'))
				const holding = Promise.resolve(
					click.execute({ ref: 'e1' }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				await waitForCondition('the release is withheld', () => releases.length === 1)
				const queued = Promise.resolve(
					click.execute({ ref: 'e4' }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				await Promise.all([toolset.destroy(), toolset.destroy()])
				expect(readProperty(await queued, 'message')).toBe('the browser session ended')
				expect(toolset.tools.tools()).toEqual([])
				transport.reply(requireValue(releases[0]).id, {})
				expect(readProperty(await holding, 'message')).toBe('the browser session ended')
				const after = await Promise.resolve(
					look.execute({ what: 'cart' }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(after, 'message')).toBe('the browser session ended')
				expect(readProperty(after, 'code')).toBe('BROWSER_TOOLSET_ENDED')
				expect(
					readProperty(await toolset.start().catch((caught: unknown) => caught), 'message'),
				).toBe('the browser session ended')
				expect(toolset.emitter.destroyed).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('catches a release the toolset skips, calls twice, calls before its own teardown, or swallows', async () => {
			const tools = createToolManager()
			const releases = createRecorder<[number]>()
			const toolset = new BrowserToolset(createBrowserViewDouble(), {
				tools,
				release: () => releases.handler(tools.count),
			})
			await toolset.start()
			await Promise.all([toolset.destroy(), toolset.destroy()])
			await toolset.destroy()
			expect(releases.calls).toEqual([[0]])
			const failure = new Error('the view did not release')
			const refused = createRecorder<[]>()
			const failing = new BrowserToolset(createBrowserViewDouble(), {
				release: async () => {
					refused.handler()
					throw failure
				},
			})
			await failing.start()
			expect(await failing.destroy().catch((error: unknown) => error)).toBe(failure)
			expect(failing.tools.tools()).toEqual([])
			expect(await failing.destroy().catch((error: unknown) => error)).toBe(failure)
			expect(refused.count).toBe(1)
		})

		it('catches a destroyed toolset whose registry, dialog, or navigation subscription outlives it', async () => {
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			const { client, page, transport, recording } = fixture
			try {
				expect(recording.registrations('Page.javascriptDialogClosed')).toBe(0)
				const listeners = ['dialog', 'popup', 'close'] as const
				const before = listeners.map((event) => page.emitter.count(event))
				const changes = page.registry.emitter.count('change')
				const tools = createToolManager()
				const toolset = createBrowserToolset(page, { tools })
				await toolset.start()
				expect(listeners.map((event) => page.emitter.count(event))).toEqual(
					before.map((count) => count + 1),
				)
				expect(page.registry.emitter.count('change')).toBe(changes + 1)
				expect(recording.registrations('Page.javascriptDialogClosed', 'session-main')).toBe(1)
				await toolset.destroy()
				expect(recording.registrations('Page.javascriptDialogClosed')).toBe(0)
				expect(tools.tools()).toEqual([])
				expect(listeners.map((event) => page.emitter.count(event))).toEqual(before)
				expect(page.registry.emitter.count('change')).toBe(changes)
				const sent = transport.sent.length
				transport.event(
					'WebMCP.toolsAdded',
					{ tools: [{ name: 'cart', description: 'Show the cart', frameId: 'main' }] },
					'session-main',
				)
				transport.event(
					'Page.javascriptDialogOpening',
					{ url: page.url, type: 'confirm', message: 'Leave the cart?', hasBrowserHandler: false },
					'session-main',
				)
				transport.event(
					'Page.frameRequestedNavigation',
					{
						frameId: 'main',
						reason: 'anchorClick',
						url: 'https://example.test/next',
						disposition: 'currentTab',
					},
					'session-main',
				)
				await waitForDelay(10)
				expect(page.registry.tools().map((tool) => tool.name)).toEqual(['cart'])
				expect(tools.tools()).toEqual([])
				expect(transport.sent.slice(sent)).toEqual([])
			} finally {
				await client.close()
			}
		})
	})

	describe('placements', () => {
		it('catches a view-backed toolset that advertises page tools, subscribes a protocol, or skips the boundary', async () => {
			const html = `<main><h1>Form</h1>${Array.from(
				{ length: 8 },
				(_, index) => `<p>Line ${index} of the form carries enough words to fill a line.</p>`,
			).join('')}</main>`
			const view = createBrowserViewDouble({ html })
			const toolset = new BrowserToolset(view, { limit: 60 })
			const five = ['look', 'read', 'click', 'type', 'wait']
			expect(toolset.native.map((tool) => tool.name)).toEqual(five)
			await toolset.start()
			expect(view.calls).toEqual([])
			expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(five)
			expect(toolset.view).toBe(view)
			const signal = new AbortController().signal
			const cut = /\n\[characters 0–60 of \d+; the rest was cut; call read for the page's text\]$/
			expect(
				await requireValue(toolset.tools.tool('look')).execute({ what: 'form' }, { signal }),
			).toMatch(cut)
			const read = String(
				await requireValue(toolset.tools.tool('read')).execute({ what: 'form' }, { signal }),
			)
			expect(read).toMatch(/\n\n\[characters 0–\d+ of \d+; call read with offset \d+ for more\]$/)
			expect(
				await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
			).toMatch(/^Clicked e1 button "Save"\. \(untrusted event\)\n\npage "Form"/)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam' },
					{ signal },
				),
			).toMatch(/^Typed "sam" into e2 textbox "Email"\. \(untrusted event\)\n\n/)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e3', text: 'Large' },
					{ signal },
				),
			).toMatch(/^Selected "Large" in e3 combobox "Size" \(programmatic\)\. \(unt/)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam', submit: true },
					{ signal },
				),
			).toMatch(/^Typed "sam" into e2 textbox "Email" and submitted the form\./)
			expect(
				await requireValue(toolset.tools.tool('wait')).execute({ text: 'Form' }, { signal }),
			).toBe('"Form" is on the page.')
			expect(view.calls).toEqual([
				'outline',
				'read',
				'click e1',
				'outline',
				'fill e2 sam',
				'outline',
				'select e3 Large',
				'outline',
				'fill e2 sam',
				'submit e2',
				'outline',
				'wait Form',
			])
			await toolset.destroy()
			expect(toolset.tools.count).toBe(0)
		})

		it('catches a context accepted without the page it lists tabs for', async () => {
			const { client } = await createConnectedCDPClient()
			try {
				const context = new BrowserContext(client)
				const error = captureError(() => new BrowserToolset(createBrowserViewDouble(), { context }))
				expect(readProperty(error, 'code')).toBe('BROWSER_TOOLSET_CONTEXT')
			} finally {
				await client.close()
			}
		})
	})

	describe('startup', () => {
		it('catches a startup that registers after destroy() ran while the registry was enabling', async () => {
			const enables: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				registry: (message) => {
					if (message.sessionId === 'session-main') enables.push(message)
					else fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'WebMCP.disable')
				const toolset = createBrowserToolset(page)
				const starting = toolset.start().catch((caught: unknown) => caught)
				await waitForCondition('the enable is withheld', () => enables.length === 1)
				await toolset.destroy()
				transport.reply(requireValue(enables[0]).id, {})
				expect(readProperty(await starting, 'message')).toBe('the browser session ended')
				await waitForDelay(10)
				expect(toolset.tools.count).toBe(0)
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'After' },
					'session-main',
				)
				expect(toolset.tools.count).toBe(0)
			} finally {
				await client.close()
			}
		})

		it('catches concurrent starts that settle apart or a refused start that cannot be retried', async () => {
			const enables: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				registry: (message) => {
					if (message.sessionId === 'session-main') enables.push(message)
					else fixture.transport.reply(message.id, {})
				},
			})
			const { client, page, transport } = fixture
			try {
				const tools = createToolManager()
				tools.add(createTool({ name: 'wait', execute: ignoreCall }))
				const toolset = createBrowserToolset(page, { tools })
				const refusals = [toolset.start(), toolset.start()]
				expect(refusals[0]).toBe(refusals[1])
				const [first, second] = await Promise.all(
					refusals.map((start) => start.catch((caught: unknown) => caught)),
				)
				expect(first).toBe(second)
				expect(readProperty(first, 'code')).toBe('BROWSER_TOOLSET_RESERVED')
				tools.remove('wait')
				const starts = [toolset.start(), toolset.start()]
				expect(starts[0]).toBe(starts[1])
				await waitForCondition('the enable is withheld', () => enables.length === 1)
				expect(toolset.tools.count).toBe(0)
				transport.reply(requireValue(enables[0]).id, {})
				await Promise.all(starts)
				expect(toolset.tools.count).toBe(7)
			} finally {
				await client.close()
			}
		})

		it('catches a startup that keeps adding after a manager listener destroyed the toolset', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const tools = createToolManager()
				const toolset = createBrowserToolset(page, { tools })
				tools.emitter.on('add', (tool) => {
					if (tool.name === 'read') void toolset.destroy()
				})
				const error = await toolset.start().catch((caught: unknown) => caught)
				expect(readProperty(error, 'message')).toBe('the browser session ended')
				expect(tools.count).toBe(0)
			} finally {
				await client.close()
			}
		})
	})

	describe('signals', () => {
		it('catches a dialog answered under an aborted signal', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				replyOk(transport, 'Page.handleJavaScriptDialog')
				const toolset = createBrowserToolset(page)
				await toolset.start()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Delete?' },
					'session-main',
				)
				const controller = new AbortController()
				controller.abort('declined')
				const answer = await Promise.resolve(
					requireValue(toolset.tools.tool('dialog')).execute(
						{ accept: true },
						{ signal: controller.signal },
					),
				).catch((caught: unknown) => caught)
				expect(answer).toBe('declined')
				expect(
					transport.sent.some((message) => message.method === 'Page.handleJavaScriptDialog'),
				).toBe(false)
				expect(toolset.tools.tool('dialog')?.name).toBe('dialog')
			} finally {
				await client.close()
			}
		})

		it('catches a navigate aborted during its load that reports a timeout instead of the reason', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				replyOk(transport, 'Page.stopLoading')
				transport.onSend('Page.navigate', (message) =>
					transport.reply(message.id, { frameId: 'main', loaderId: 'loader-next' }),
				)
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const controller = new AbortController()
				const navigated = Promise.resolve(
					requireValue(toolset.tools.tool('navigate')).execute(
						{ url: 'https://example.test/next' },
						{ signal: controller.signal },
					),
				).catch((caught: unknown) => caught)
				await waitForCondition('the navigation replied', () =>
					transport.sent.some((message) => message.method === 'Page.navigate'),
				)
				await waitForDelay(10)
				const aborted = performance.now()
				controller.abort('the model stopped')
				expect(await navigated).toBe('the model stopped')
				expect(performance.now() - aborted).toBeLessThan(1_000)
				expect(transport.sent.some((message) => message.method === 'Page.stopLoading')).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('catches a tabs call whose pending title hides the dialog', async () => {
			const titles: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				title: (message) => {
					if (message.sessionId === 'session-tab') titles.push(message)
					else fixture.transport.reply(message.id, { result: { value: 'Cart' } })
				},
			})
			const { client, page, transport } = fixture
			try {
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Browser.setDownloadBehavior',
					'Network.enable',
				])
					replyOk(transport, method)
				replyOk(transport, 'Target.createTarget', { targetId: 'tab-1' })
				replyOk(transport, 'Target.attachToTarget', { sessionId: 'session-tab' })
				const context = new BrowserContext(client)
				await context.create()
				const toolset = createBrowserToolset(page, { context })
				await toolset.start()
				const listed = Promise.resolve(
					requireValue(toolset.tools.tool('tabs')).execute(
						{ what: 'tabs' },
						{ signal: new AbortController().signal },
					),
				)
				await waitForCondition('the title is withheld', () => titles.length === 1)
				const opened = performance.now()
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Stay?' },
					'session-main',
				)
				expect(await listed).toBe('A confirm dialog is open: "Stay?"; call dialog.')
				expect(performance.now() - opened).toBeLessThan(100)
			} finally {
				await client.close()
			}
		})
	})

	describe('adoption policy', () => {
		it('catches an adoption that overwrites a consumer tool installed by a synchronous add listener', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const tools = createToolManager()
				const consumer = createTool({ name: 'search', execute: ignoreCall })
				tools.emitter.on('add', (tool) => {
					if (tool.name === 'extra') tools.add(consumer)
				})
				const source: BrowserToolSourceInterface = {
					emitter: new Emitter<BrowserToolSourceEventMap>(),
					adopt: () =>
						Promise.resolve([
							createTool({ name: 'extra', execute: ignoreCall }),
							createTool({ name: 'search', execute: ignoreCall }),
						]),
				}
				const toolset = createBrowserToolset(page, { tools, source })
				const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
				toolset.emitter.on('skip', skips.handler)
				await toolset.start()
				expect(tools.tool('search')).toBe(consumer)
				expect(skips.calls).toEqual([['search', 'held']])
				await toolset.destroy()
				expect(tools.tools()).toEqual([consumer])
			} finally {
				await client.close()
			}
		})

		it('catches a census-free tool advertised without the synthetic what, one that receives it, or an optional what that is adopted', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const inputs = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
				const source: BrowserToolSourceInterface = {
					emitter: new Emitter<BrowserToolSourceEventMap>(),
					adopt: () =>
						Promise.resolve([
							createTool({ name: 'extra', execute: inputs.handler }),
							createTool({
								name: 'maybe',
								parameters: { type: 'object', properties: { what: { type: 'string' } } },
								execute: ignoreCall,
							}),
						]),
				}
				const toolset = createBrowserToolset(page, { source })
				const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
				toolset.emitter.on('skip', skips.handler)
				await toolset.start()
				expect(skips.calls).toEqual([['maybe', 'schema']])
				expect(readProperty(toolset.tools.tool('extra')?.parameters, 'required')).toEqual(['what'])
				await toolset.tools.execute({
					id: 'extra',
					name: 'extra',
					arguments: { what: 'find boots', query: 'boots' },
				})
				expect(inputs.calls.map(([input]) => input)).toEqual([{ query: 'boots' }])
			} finally {
				await client.close()
			}
		})

		it('catches a registry tool whose read-only hint is lost, whose untrusted mark follows the page, or whose synthetic what reaches the page', async () => {
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'WebMCP.disable')
				transport.onSend('WebMCP.invokeTool', (message) => {
					transport.reply(message.id, { invocationId: 'lookup' })
					transport.event(
						'WebMCP.toolResponded',
						{ invocationId: 'lookup', status: 'Completed', output: 'found' },
						'session-main',
					)
				})
				const toolset = createBrowserToolset(page)
				await toolset.start()
				transport.event(
					'WebMCP.toolsAdded',
					{
						tools: [
							{
								name: 'lookup',
								description: 'Look up a book',
								frameId: 'main',
								annotations: { readOnly: true, untrustedContent: false },
							},
						],
					},
					'session-main',
				)
				await waitForCondition(
					'the tool is adopted',
					() => toolset.tools.tool('lookup') !== undefined,
				)
				const tool = requireValue(toolset.tools.tool('lookup'))
				expect(tool.annotations).toEqual({ pure: true, untrusted: true })
				expect(readProperty(tool.parameters, 'required')).toEqual(['what'])
				expect(
					await tool.execute(
						{ what: 'Find the book', query: 'dune' },
						{ signal: new AbortController().signal },
					),
				).toBe('found')
				expect(
					transport.sent.find((message) => message.method === 'WebMCP.invokeTool')?.params?.[
						'input'
					],
				).toEqual({ query: 'dune' })
			} finally {
				await client.close()
			}
		})

		it('catches a shadowed frame registration that vetoes the main-frame winner', async () => {
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			const { client, page, transport } = fixture
			try {
				replyOk(transport, 'WebMCP.disable')
				const toolset = createBrowserToolset(page)
				const adopted = createRecorder<readonly [ToolInterface]>()
				toolset.emitter.on('adopt', adopted.handler)
				await toolset.start()
				transport.event(
					'WebMCP.toolsAdded',
					{
						tools: [
							{
								name: 'search',
								description: 'Main search',
								frameId: 'child',
								annotations: { debugging: true },
							},
							{ name: 'search', description: 'Main search', frameId: 'main' },
						],
					},
					'session-main',
				)
				await waitForCondition('the main search is adopted', () => adopted.count === 1)
				expect(toolset.tools.tool('search')?.description).toBe('Main search')
			} finally {
				await client.close()
			}
		})

		it('catches registry tools that stay behind when the view moves to a popup', async () => {
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			const { client, page, transport } = fixture
			try {
				for (const method of [
					'WebMCP.disable',
					'Page.setInterceptFileChooserDialog',
					'Network.enable',
				])
					replyOk(transport, method)
				const toolset = createBrowserToolset(page)
				await toolset.start()
				transport.event(
					'WebMCP.toolsAdded',
					{ tools: [{ name: 'search', description: 'Opener search', frameId: 'main' }] },
					'session-main',
				)
				await waitForCondition('the opener tool', () => toolset.tools.tool('search') !== undefined)
				const moved = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view follows the popup')
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-session',
						targetInfo: { targetId: 'popup-1', type: 'page', url: 'https://example.test/popup' },
					},
					'session-main',
				)
				await moved
				expect(toolset.tools.tool('search')).toBeUndefined()
				await waitForCondition('the popup registry is enabled', () =>
					transport.sent.some(
						(message) =>
							message.method === 'WebMCP.enable' && message.sessionId === 'popup-session',
					),
				)
				transport.event(
					'WebMCP.toolsAdded',
					{ tools: [{ name: 'cart', description: 'Popup cart', frameId: 'main' }] },
					'popup-session',
				)
				await waitForCondition('the popup tool', () => toolset.tools.tool('cart') !== undefined)
				expect(toolset.tools.tool('search')).toBeUndefined()
			} finally {
				await client.close()
			}
		})
	})

	describe('design choices', () => {
		it('catches a combobox that is always filled or never falls back when it is a text input', async () => {
			const tree = {
				nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
					node.nodeId === 'email'
						? { ...node, role: { value: 'combobox' }, name: { value: 'Size' } }
						: node,
				),
			}
			for (const select of [true, false]) {
				const fixture = await createBrowserElementFixture({
					accessibility: (message) =>
						fixture.transport.reply(
							message.id,
							message.params?.['frameId'] === 'child' ? BROWSER_ELEMENT_CHILD_FIXTURE : tree,
						),
					select: (message) =>
						fixture.transport.reply(
							message.id,
							select
								? { result: { value: true } }
								: {
										exceptionDetails: {
											exception: { description: 'Error: Element is not a select control' },
										},
									},
						),
				})
				const { client, page, transport } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					const signal = new AbortController().signal
					await requireValue(toolset.tools.tool('look')).execute({ what: 'size' }, { signal })
					const typed = String(
						await requireValue(toolset.tools.tool('type')).execute(
							{ ref: 'e2', text: 'Large' },
							{ signal },
						),
					)
					const inserted = transport.sent.some((message) => message.method === 'Input.insertText')
					expect([typed.split('\n')[0], inserted]).toEqual(
						select
							? ['Selected "Large" in e2 combobox "Size" (programmatic).', false]
							: ['Typed "Large" into e2 combobox "Size".', true],
					)
				} finally {
					await client.close()
				}
			}
		})

		it('catches a wait whose timeout passes the 30 s cap or ignores the default', async () => {
			const waits: string[] = []
			const fixture = await createBrowserElementFixture({
				evaluation: (message) => {
					waits.push(String(message.params?.['expression']))
					fixture.transport.reply(message.id, { result: { value: true } })
				},
			})
			const { client, page } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				const wait = requireValue(toolset.tools.tool('wait'))
				expect(await wait.execute({ text: 'Done', timeout: 60 }, { signal })).toBe(
					'"Done" is on the page.',
				)
				await wait.execute({ text: 'Done' }, { signal })
				const [capped, defaulted] = waits.map((expression) =>
					Number(requireValue(readBrowserCompiledTimers(expression)[0]).delay),
				)
				expect(capped).toBeGreaterThan(29_000)
				expect(capped).toBeLessThanOrEqual(30_000)
				expect(defaulted).toBeGreaterThan(4_000)
				expect(defaulted).toBeLessThanOrEqual(5_000)
			} finally {
				await client.close()
			}
		})

		it('catches a tab list that fails when one tab does not answer its title', async () => {
			const fixture = await createBrowserElementFixture({
				title: (message) =>
					message.sessionId === 'session-tab'
						? fixture.transport.fail(message.id, 'Target closed')
						: fixture.transport.reply(message.id, { result: { value: 'Cart' } }),
			})
			const { client, page, transport } = fixture
			try {
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Browser.setDownloadBehavior',
					'Network.enable',
				])
					replyOk(transport, method)
				replyOk(transport, 'Target.createTarget', { targetId: 'tab-1' })
				replyOk(transport, 'Target.attachToTarget', { sessionId: 'session-tab' })
				const context = new BrowserContext(client)
				await context.create()
				const toolset = createBrowserToolset(page, { context })
				await toolset.start()
				expect(
					await requireValue(toolset.tools.tool('tabs')).execute(
						{ what: 'tabs' },
						{ signal: new AbortController().signal },
					),
				).toBe('t1 "" about:blank')
			} finally {
				await client.close()
			}
		})

		it('catches a continuation offset that counts the move note instead of the reading', async () => {
			const html = `<main><h1>Guide</h1>${Array.from(
				{ length: 12 },
				(_, index) => `<p>Paragraph ${index} carries enough words to fill one line of text.</p>`,
			).join('')}</main>`
			const fixture = await createBrowserElementFixture({
				evaluation: (message) =>
					fixture.transport.reply(message.id, {
						result: {
							value: String(message.params?.['expression']).includes('outerHTML')
								? { url: 'https://example.test/popup', title: 'Guide', html }
								: true,
						},
					}),
			})
			const { client, page, transport } = fixture
			try {
				for (const method of ['Page.setInterceptFileChooserDialog', 'Network.enable'])
					replyOk(transport, method)
				const toolset = createBrowserToolset(page, { limit: 200 })
				await toolset.start()
				const moved = waitForEvent<readonly [BrowserViewInterface]>((handler) => {
					toolset.emitter.on('select', handler)
					return () => toolset.emitter.off('select', handler)
				}, 'the view follows the popup')
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-session',
						targetInfo: { targetId: 'popup-1', type: 'page', url: 'https://example.test/popup' },
					},
					'session-main',
				)
				await moved
				const signal = new AbortController().signal
				const read = requireValue(toolset.tools.tool('read'))
				const note = 'The view moved to a new tab: https://example.test/popup.\n\n'
				const first = String(await read.execute({ what: 'guide' }, { signal }))
				expect(first.startsWith(note)).toBe(true)
				const [head = '', tail = ''] = first.slice(note.length).split('\n\n[characters ')
				const end = Number(requireValue(/call read with offset (\d+) for more\]$/.exec(tail))[1])
				expect(end).toBe(head.length)
				expect(first.length - tail.length - '\n\n[characters '.length).toBeLessThanOrEqual(200)
				const second = String(await read.execute({ what: 'guide', offset: end }, { signal }))
				const [next = ''] = second.split('\n\n[characters ')
				const whole = createBrowserReading({
					url: 'https://example.test/popup',
					title: 'Guide',
					html,
				}).markdown().text
				expect(`${head}${next}`).toBe(whole.slice(0, head.length + next.length))
			} finally {
				await client.close()
			}
		})
	})

	describe('receipt timers', () => {
		it('catches a deadline timer that outlives a receipt a dialog ended', async () => {
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
			const { client, page, transport } = fixture
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal })
				// Setup helpers leave one-second budget timers behind; the baseline waits them out.
				await waitForDelay(1_100)
				const timers = process
					.getActiveResourcesInfo()
					.filter((resource) => resource === 'Timeout').length
				const clicked = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				)
				await waitForCondition('the release is sent', () =>
					transport.sent.some((message) => message.params?.['type'] === 'mouseReleased'),
				)
				await waitForDelay(20)
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Wait' },
					'session-main',
				)
				expect(await clicked).toBe(
					'Clicked e1 link "Home". An alert dialog is open: "Wait"; call dialog.',
				)
				expect(
					process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length,
				).toBe(timers)
			} finally {
				await client.close()
			}
		})

		it(
			'catches a capture that keeps its protocol call or timer after an abort in the capture reserve',
			{ timeout: 15_000 },
			async () => {
				let holding = false
				const trees: CDPSentMessage[] = []
				const fixture = await createBrowserElementFixture({
					accessibility: (message) => {
						if (holding) trees.push(message)
						else
							fixture.transport.reply(
								message.id,
								message.params?.['frameId'] === 'child'
									? BROWSER_ELEMENT_CHILD_FIXTURE
									: BROWSER_ELEMENT_AX_FIXTURE,
							)
					},
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
						fixture.transport.event(
							'Page.frameNavigated',
							{ frame: { id: 'main', url: 'https://example.test/next', loaderId: 'loader-next' } },
							'session-main',
						)
						fixture.transport.event(
							'Page.lifecycleEvent',
							{ frameId: 'main', loaderId: 'loader-next', name: 'DOMContentLoaded' },
							'session-main',
						)
					},
				})
				const { client, page, transport } = fixture
				try {
					const toolset = createBrowserToolset(page)
					await toolset.start()
					await requireValue(toolset.tools.tool('look')).execute(
						{ what: 'home' },
						{ signal: new AbortController().signal },
					)
					holding = true
					// Setup helpers leave one-second budget timers behind; the baseline waits them out.
					await waitForDelay(1_100)
					const timers = process
						.getActiveResourcesInfo()
						.filter((resource) => resource === 'Timeout').length
					const controller = new AbortController()
					const reason = new Error('the model stopped during the capture')
					const clicked = Promise.resolve(
						requireValue(toolset.tools.tool('click')).execute(
							{ ref: 'e1' },
							{ signal: controller.signal },
						),
					).catch((caught: unknown) => caught)
					await waitForCondition('the capture requests the tree', () => trees.length === 1, {
						budget: 6_000,
					})
					controller.abort(reason)
					expect(await clicked).toBe(reason)
					// The observer removal the abort sent lands before the held capture is answered.
					await waitForDelay(20)
					const sent = transport.sent.length
					transport.reply(requireValue(trees[0]).id, BROWSER_ELEMENT_AX_FIXTURE)
					await waitForDelay(20)
					expect(transport.sent.slice(sent)).toEqual([])
					expect(
						process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length,
					).toBe(timers)
				} finally {
					await client.close()
				}
			},
		)
	})

	describe('reading limits', () => {
		it('catches a read that returns half a surrogate pair or never advances at a tiny limit', async () => {
			const view = createBrowserViewDouble({ html: '<main><p>\u{1F600}\u{1F600}</p></main>' })
			const whole = createBrowserReading({
				url: view.url,
				title: 'Form',
				html: '<main><p>\u{1F600}\u{1F600}</p></main>',
			}).markdown().text
			expect(whole.startsWith('\u{1F600}\u{1F600}')).toBe(true)
			const narrow = new BrowserToolset(view, { limit: 1 })
			await narrow.start()
			const refused = await Promise.resolve(
				requireValue(narrow.tools.tool('read')).execute(
					{ what: 'faces' },
					{ signal: new AbortController().signal },
				),
			).catch((caught: unknown) => caught)
			expect(readProperty(refused, 'code')).toBe('BROWSER_TOOLSET_LIMIT')
			expect(readProperty(refused, 'context')).toEqual({ limit: 1, offset: 0 })
			const pair = new BrowserToolset(view, { limit: 2 })
			await pair.start()
			expect(
				await requireValue(pair.tools.tool('read')).execute(
					{ what: 'faces' },
					{ signal: new AbortController().signal },
				),
			).toBe(`\u{1F600}\n\n[characters 0–2 of ${whole.length}; call read with offset 2 for more]`)
		})
	})

	describe('startup reentry', () => {
		it('catches a start from an add listener that begins a second startup', async () => {
			const tools = createToolManager()
			const toolset = new BrowserToolset(createBrowserViewDouble(), { tools })
			const nested: Array<Promise<void>> = []
			tools.emitter.on('add', (tool) => {
				if (tool.name === 'look' && nested.length === 0) nested.push(toolset.start())
			})
			const outer = toolset.start()
			await outer
			expect(nested[0]).toBe(outer)
			expect(tools.tools().map((tool) => tool.name)).toEqual([
				'look',
				'read',
				'click',
				'type',
				'wait',
			])
			await toolset.destroy()
			expect(tools.count).toBe(0)
		})
	})

	describe('trust marker', () => {
		it('catches an untrusted view whose click or type receipt omits the marker, or a look, read, or wait that gains it', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const signal = new AbortController().signal
			const outline =
				'page "Form" https://example.test/form\ne1 button "Save"\ne2 textbox "Email"\ne3 combobox "Size"\n(3 of 3 elements)'
			expect(
				await requireValue(toolset.tools.tool('look')).execute({ what: 'form' }, { signal }),
			).toBe(outline)
			expect(
				await requireValue(toolset.tools.tool('read')).execute({ what: 'form' }, { signal }),
			).toBe('Form body')
			expect(
				await requireValue(toolset.tools.tool('wait')).execute({ text: 'Form body' }, { signal }),
			).toBe('"Form body" is on the page.')
			expect(
				await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
			).toBe(`Clicked e1 button "Save". (untrusted event)\n\n${outline}`)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam' },
					{ signal },
				),
			).toBe(`Typed "sam" into e2 textbox "Email". (untrusted event)\n\n${outline}`)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam', submit: true },
					{ signal },
				),
			).toBe(
				`Typed "sam" into e2 textbox "Email" and submitted the form. (untrusted event)\n\n${outline}`,
			)
		})

		it('catches a click receipt on a textbox that omits the type call or on a button that gains it', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const signal = new AbortController().signal
			const click = requireValue(toolset.tools.tool('click'))
			const outline =
				'page "Form" https://example.test/form\ne1 button "Save"\ne2 textbox "Email"\ne3 combobox "Size"\n(3 of 3 elements)'
			expect(await click.execute({ ref: 'e2' }, { signal })).toBe(
				`Clicked e2 textbox "Email"; call type with e2 to enter text. (untrusted event)\n\n${outline}`,
			)
			expect(await click.execute({ ref: 'e1' }, { signal })).toBe(
				`Clicked e1 button "Save". (untrusted event)\n\n${outline}`,
			)
			await toolset.destroy()
		})

		it('catches a trusted page click receipt that gains the marker', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const signal = new AbortController().signal
				const outline = String(
					await requireValue(toolset.tools.tool('look')).execute({ what: 'home' }, { signal }),
				)
				expect(
					await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).toBe(`Clicked e1 link "Home".\n\n${outline}`)
			} finally {
				await client.close()
			}
		})
	})

	describe('generation round trip', () => {
		it('catches an adoption begun on the opener that lands after a move to a popup and back', async () => {
			const { client, page, transport } = await createBrowserElementFixture()
			try {
				for (const method of [
					'Page.setInterceptFileChooserDialog',
					'Network.enable',
					'Network.disable',
					'Target.detachFromTarget',
				])
					replyOk(transport, method)
				const adoptions = Array.from({ length: 4 }, () =>
					Promise.withResolvers<readonly ToolInterface[]>(),
				)
				let calls = 0
				const emitter = new Emitter<BrowserToolSourceEventMap>()
				const source: BrowserToolSourceInterface = {
					emitter,
					tools: () => [],
					adopt: () => {
						calls += 1
						return requireValue(adoptions[calls - 1]).promise
					},
				}
				requireValue(adoptions[0]).resolve([])
				const toolset = createBrowserToolset(page, { source })
				await toolset.start()
				emitter.emit('change')
				const selections = createRecorder<readonly [BrowserViewInterface]>()
				toolset.emitter.on('select', selections.handler)
				transport.event(
					'Target.attachedToTarget',
					{
						sessionId: 'popup-session',
						targetInfo: { targetId: 'popup-1', type: 'page', url: 'https://example.test/popup' },
					},
					'session-main',
				)
				await waitForCondition('the view moves to the popup', () => selections.count === 1)
				transport.event(
					'Target.detachedFromTarget',
					{ sessionId: 'popup-session', targetId: 'popup-1' },
					'session-main',
				)
				await waitForCondition('the view returns to the opener', () => selections.count === 2)
				expect(toolset.view).toBe(page)
				requireValue(adoptions[1]).resolve([createTool({ name: 'roundtrip', execute: ignoreCall })])
				await waitForDelay(10)
				expect(toolset.tools.tool('roundtrip')).toBeUndefined()
			} finally {
				await client.close()
			}
		})
	})

	describe('journeys', () => {
		it('constructs the journey tools with journeys, reserves their names from page tools, and destroys them first', async () => {
			const record = createTool({ name: 'record', description: 'Page record', execute: ignoreCall })
			const extra = createTool({ name: 'extra', description: 'Page extra', execute: ignoreCall })
			const source: BrowserToolSourceInterface = {
				emitter: new Emitter<BrowserToolSourceEventMap>(),
				adopt: () => Promise.resolve([record, extra]),
			}
			const plain = new BrowserToolset(createBrowserViewDouble(), { source })
			await plain.start()
			expect(plain.tools.tool('record')?.description).toBe('Page record')
			await plain.destroy()
			const tools = createToolManager()
			const removed = createRecorder<readonly [ToolInterface]>()
			tools.emitter.on('remove', removed.handler)
			const store = createMemoryBrowserJourneyStore()
			const toolset = new BrowserToolset(createBrowserViewDouble(), {
				tools,
				source,
				journeys: { store },
			})
			expect(tools.tools().map((tool) => tool.name)).toEqual([...BROWSER_JOURNEY_TOOL_NAMES])
			const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
			toolset.emitter.on('skip', skips.handler)
			await toolset.start()
			expect(skips.calls).toEqual([['record', 'reserved']])
			expect(tools.tool('extra')?.description).toBe('Page extra')
			expect(tools.tool('record')?.description).toBe(BROWSER_TOOL_COPY.record.description)
			await tools.execute({ id: '1', name: 'record', arguments: { journey: 'brew-tea' } })
			await tools.execute({ id: '2', name: 'wait', arguments: { text: 'Ready' } })
			await toolset.destroy()
			expect(removed.calls.map(([tool]) => tool.name)).toEqual([
				...BROWSER_JOURNEY_TOOL_NAMES,
				'look',
				'read',
				'click',
				'type',
				'wait',
				'extra',
			])
			expect((await store.list()).entries).toEqual([])
		})

		it('refuses a manager that holds a journey tool name and adds nothing', () => {
			const tools = createToolManager()
			const held = createTool({ name: 'replay', execute: ignoreCall })
			tools.add(held)
			const refusal = captureError(
				() =>
					new BrowserToolset(createBrowserViewDouble(), {
						tools,
						journeys: { store: createMemoryBrowserJourneyStore() },
					}),
			)
			expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_TOOLSET_RESERVED')
			expect(readProperty(refusal, 'context')).toEqual({ name: 'replay' })
			expect(tools.tools()).toEqual([held])
		})

		it('ends an active replay with an aborted run before its own teardown', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				insert: (message) => withheld.push(message),
			})
			const store = createMemoryBrowserJourneyStore()
			const runs = createMemoryBrowserRunStore()
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
			const toolset = createBrowserToolset(fixture.page, { journeys: { store, runs } })
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
				await toolset.destroy()
				expect(released.calls).toEqual([['check-ready']])
				expect((await runs.list('check-ready')).entries.map((run) => run.outcome)).toEqual([
					'aborted',
				])
				expect(readProperty<string>(await replayed, 'value')).toMatch(
					/^Replay of check-ready aborted at s1 of 2\./,
				)
				expect(
					fixture.transport.sent.filter((message) => message.method === 'Input.dispatchKeyEvent'),
				).toEqual([])
				expect(toolset.tools.tools()).toEqual([])
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})
	})
})
