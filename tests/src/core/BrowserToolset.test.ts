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
	BROWSER_TOOL_NAMES,
	BrowserContext,
	BrowserToolset,
	createBrowserToolset,
	createMemoryBrowserJourneyStore,
	createMemoryBrowserRunStore,
	BrowserError,
	isBrowserError,
	isBrowserStepError,
} from '@src/core'
import {
	BROWSER_SELECT_SECRET,
	BROWSER_JOURNEY_SECRET,
	createBrowserSecretSelectFixture,
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_CHILD_FIXTURE,
	emitBrowserNavigation,
	createBrowserElementFixture,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
	createBrowserPendingToolsetFixture,
	ignoreCall,
	readBrowserCompiledTimers,
	runBrowserCompiledTimers,
	replyOk,
	buildBrowserReferenceTree,
	BROWSER_STABLE_REFERENCE_ELEMENTS,
} from '../../setup.js'

describe('BrowserToolset', () => {
	it('small copy: advertises click, type, and the words to enter exactly', () => {
		expect
			.soft(BROWSER_TOOL_COPY.click.description)
			.toBe('Clicks the referenced element, settles its action, and returns the page.')
		expect
			.soft(BROWSER_TOOL_COPY.type.description)
			.toBe(
				'Types into a field such as a search box, optionally submits its form, and returns the page.',
			)
		expect(
			readProperty(
				readProperty(readProperty(BROWSER_TOOL_COPY.type.parameters, 'properties'), 'text'),
				'description',
			),
		).toBe('The text to type or the option to choose.')
	})
	it('small copy: type refusal names one field, two fields in view order, or click with no fields', async () => {
		let count = 2
		const fixture = await createBrowserElementFixture({
			local: true,
			accessibility: (message) =>
				fixture.transport.reply(
					message.id,
					buildBrowserReferenceTree(
						[
							{ role: 'link', name: 'Checkout' },
							{ role: 'button', name: 'Add to cart' },
							{ role: 'textbox', name: 'Full name' },
							{ role: 'searchbox', name: 'Address' },
						].slice(0, count),
					),
				),
		})
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			await toolset.read()
			const type = requireValue(toolset.tools.tool('type'))
			const context = { signal: new AbortController().signal }
			await expect(type.execute({ ref: 'e2', text: 'Sam' }, context)).rejects.toMatchObject({
				code: 'TOOLSET_ROLE',
				message: 'Element button "Add to cart" [ref=e2] takes no text; call click for a button.',
				context: { reference: 'e2', role: 'button' },
			})
			count = 3
			await toolset.read()
			const sent = fixture.transport.sent.length
			await expect.soft(type.execute({ ref: 'e1', text: 'Sam' }, context)).rejects.toMatchObject({
				code: 'TOOLSET_ROLE',
				message:
					'Element link "Checkout" [ref=e1] takes no text; to type, use textbox "Full name" [ref=e3].',
				context: { reference: 'e1', role: 'link' },
			})
			expect(fixture.transport.sent.slice(sent)).toEqual([])
			count = 4
			await toolset.read()
			await expect.soft(type.execute({ ref: 'e2', text: 'Sam' }, context)).rejects.toMatchObject({
				code: 'TOOLSET_ROLE',
				message:
					'Element button "Add to cart" [ref=e2] takes no text; to type, use textbox "Full name" [ref=e3] or searchbox "Address" [ref=e4].',
				context: { reference: 'e2', role: 'button' },
			})
			count = 2
			await toolset.read()
			await expect(type.execute({ ref: 'e2', text: 'Sam' }, context)).rejects.toMatchObject({
				code: 'TOOLSET_ROLE',
				message: 'Element button "Add to cart" [ref=e2] takes no text; call click for a button.',
			})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('stable links: carries listed links and names a gone reference while preserving unknown refusals', async () => {
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
		const toolset = createBrowserToolset(fixture.page)
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
			const context = { signal: new AbortController().signal }
			const click = requireValue(toolset.tools.tool('click'))
			expect(await click.execute({ ref: 'e3' }, context)).toContain(
				'Clicked link "Checkout" [ref=e3].',
			)
			await expect(click.execute({ ref: 'e4' }, context)).rejects.toMatchObject({
				message:
					'Element e4 (searchbox "Search products") is not on this page; use a reference from the latest result.',
			})
			await expect(click.execute({ ref: 'e99' }, context)).rejects.toMatchObject({
				message: 'Element [ref=e99] is not in the current view; call read for fresh refs.',
			})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('small refusals: read requires from and parses decimal coordinates', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			const tool = requireValue(toolset.tools.tool('read'))
			const context = { signal: new AbortController().signal }
			await expect(tool.execute({}, context)).rejects.toMatchObject({
				code: 'ARGUMENT',
				message: 'Read requires an integer from, an optional integer to, and optional search text.',
			})
			expect(await tool.execute({ from: 1 }, context)).toContain('\n1: ')
			expect(await tool.execute({ from: '7', to: '7' }, context)).toBe(
				await tool.execute({ from: 7, to: 7 }, context),
			)
			expect(await tool.execute({ from: '7', to: '7' }, context)).toContain('\n7: ')
			for (const key of ['from', 'to'])
				for (const value of ['7a', '1.5', '-1', '', '07', null])
					await expect(tool.execute({ from: 1, [key]: value }, context)).rejects.toMatchObject({
						code: 'ARGUMENT',
						message:
							'Read requires an integer from, an optional integer to, and optional search text.',
					})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('small refusals: definitions require read from and retain the journeys default', () => {
		for (const name of ['read', 'journeys'] as const) {
			const definition = BROWSER_TOOL_COPY[name]
			expect(readProperty(definition.parameters, 'required')).toEqual(
				name === 'read' ? ['from'] : [],
			)
			expect(
				readProperty(
					readProperty(readProperty(definition.parameters, 'properties'), 'from'),
					'description',
				),
			).toBe(
				name === 'read'
					? "The first line to show: 1 for the top, or the line a reply's footer names."
					: 'The first line: 1 for the top. Default: 1.',
			)
		}
	})
	it('reports absence receipts and outcomes, validates absence, and keeps appearance waits', async () => {
		for (const waited of [true, false]) {
			const view = createBrowserViewDouble({ waited })
			const toolset = new BrowserToolset(view)
			try {
				await toolset.start()
				const result = await toolset.execute({
					id: 'gone',
					name: 'wait',
					arguments: { text: 'Saved', absent: true, timeout: 0.01 },
				})
				expect(result.action?.outcome).toBe(waited ? 'done' : 'timeout')
				expect(result.action?.receipt).toBe(
					waited ? '"Saved" is not on the page.' : '"Saved" is still on the page after 0.01 s.',
				)
				expect(view.calls).toContain('wait Saved absent')
				await toolset.execute({
					id: 'present',
					name: 'wait',
					arguments: { text: 'Saved', absent: false },
				})
				expect(view.calls).toContain('wait Saved')
				const calls = view.calls.length
				await expect(
					requireValue(toolset.tools.tool('wait')).execute(
						{ text: 'Saved', absent: 'yes' },
						{ signal: new AbortController().signal },
					),
				).rejects.toMatchObject({
					code: 'ARGUMENT',
					context: { key: 'absent' },
					message: 'The absent parameter must be a boolean.',
				})
				expect(view.calls).toHaveLength(calls)
			} finally {
				await toolset.destroy()
			}
		}
	})
	it('passes absence through the page into the compiled predicate', async () => {
		const fixture = await createBrowserElementFixture({
			evaluation: async (message) => {
				const run = await runBrowserCompiledTimers(String(message.params?.['expression']))
				fixture.transport.reply(message.id, { result: { value: run.result } })
			},
		})
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			const performed = await toolset.execute({
				id: 'gone',
				name: 'wait',
				arguments: { text: 'Saved', absent: true },
			})
			expect(performed.action?.outcome).toBe('done')
			expect(performed.action?.receipt).toBe('"Saved" is not on the page.')
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('labels an absent wait interrupted by a dialog', async () => {
		const waits: CDPSentMessage[] = []
		const fixture = await createBrowserElementFixture({
			evaluation: (message) => {
				if (String(message.params?.['expression']).includes('Order placed')) waits.push(message)
				else fixture.transport.reply(message.id, { result: { value: true } })
			},
		})
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			let settled = false
			const waited = toolset.tools
				.execute({ id: 'gone', name: 'wait', arguments: { text: 'Order placed', absent: true } })
				.then((result) => {
					settled = true
					return result
				})
			await waitForCondition(
				'the absent wait is pending or refused',
				() => waits.length === 1 || settled,
			)
			expect(waits).toHaveLength(1)
			fixture.transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Leave?' },
				'session-main',
			)
			expect(await waited).toMatchObject({
				success: true,
				value:
					'Waited for "Order placed" to leave. A confirm dialog is open: "Leave?"; call dialog.',
			})
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('strips synthetic purpose before calling a parameterless page tool', async () => {
		const inputs = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
		const source: BrowserToolSourceInterface = {
			emitter: new Emitter<BrowserToolSourceEventMap>(),
			adopt: async () => [
				createTool({ name: 'checkout', execute: (args) => inputs.handler(args) }),
			],
		}
		const toolset = new BrowserToolset(createBrowserViewDouble(), { source })
		try {
			await toolset.start()
			const tool = requireValue(toolset.tools.tool('checkout'))
			const context = { signal: new AbortController().signal }
			expect(tool.parameters?.['required']).toEqual(['purpose'])
			await tool.execute({ purpose: 'place the order' }, context)
			expect(inputs.calls).toEqual([[{}]])
		} finally {
			await toolset.destroy()
		}
	})
	it('refuses the former what argument and names search', async () => {
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			for (const name of ['read']) {
				await expect(
					requireValue(toolset.tools.tool(name)).execute(
						{ what: 'cart' },
						{ signal: new AbortController().signal },
					),
				).rejects.toThrow(
					`The ${name} tool takes no what parameter; call ${name} with from, to, and search.`,
				)
			}
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('skips a page tool named unresolved as reserved', async () => {
		const source: BrowserToolSourceInterface = {
			emitter: new Emitter<BrowserToolSourceEventMap>(),
			adopt: async () => [createTool({ name: 'unresolved', execute: ignoreCall })],
		}
		const toolset = new BrowserToolset(createBrowserViewDouble(), { source })
		const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
		toolset.emitter.on('skip', skips.handler)
		try {
			await toolset.start()
			expect(skips.calls).toEqual([['unresolved', 'reserved']])
			expect(toolset.tools.tool('unresolved')).toBeUndefined()
		} finally {
			await toolset.destroy()
		}
	})
	describe('journey actions', () => {
		it('preserves the supplied manager surface and returns bounded batch execution results', async () => {
			const manager = createToolManager()
			const toolset = new BrowserToolset(createBrowserViewDouble(), { tools: manager })
			try {
				await toolset.start()
				expect(toolset.tools.emitter).toBe(manager.emitter)
				expect(toolset.tools.count).toBe(manager.count)
				expect(toolset.tools.tools()).toEqual(manager.tools())
				expect(toolset.tools.definitions()).toEqual(manager.definitions())
				expect(toolset.tools.tool('read')).toBe(manager.tool('read'))
				const call = { id: 'read', name: 'read', arguments: { from: 1 } }
				const missing = { id: 'missing', name: 'missing', arguments: {} }
				expect(await toolset.tools.execute([call, missing])).toEqual([
					await manager.execute(call),
					await manager.execute(missing),
				])
				expect(await toolset.tools.execute([])).toEqual([])
				const secret = {
					id: 'secret',
					name: 'type',
					arguments: { ref: 'e1', text: BROWSER_SELECT_SECRET, secret: true },
				}
				const signal = AbortSignal.abort(`Rejected ${JSON.stringify(BROWSER_SELECT_SECRET)}`)
				expect(await toolset.tools.execute([secret, call], { signal })).toEqual([
					{ id: 'secret', name: 'type', success: false, error: 'Rejected [redacted]' },
					await manager.execute(call, { signal }),
				])
				const extra = createTool({ name: 'extra', execute: ignoreCall })
				toolset.tools.add(extra)
				expect(manager.tool('extra')).toBe(extra)
				expect(toolset.tools.remove('extra')).toBe(true)
				expect(manager.tool('extra')).toBeUndefined()
			} finally {
				await toolset.destroy()
			}
		})

		it('waits for the first hold to release before granting the second hold', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const events: string[] = []
			toolset.emitter.on('hold', (name) => events.push(`hold ${name}`))
			toolset.emitter.on('release', (name) => events.push(`release ${name}`))
			try {
				const first = await toolset.hold('first')
				const second = toolset.hold('second').catch((error: unknown) => error)
				await waitForDelay()
				expect(toolset.held, 'h1c: the second hold waits for release').toBe('first')
				expect(events).toEqual(['hold first'])
				first.destroy()
				await second
				expect(toolset.held).toBe('second')
				expect(events).toEqual(['hold first', 'release first', 'hold second'])
			} finally {
				await toolset.destroy()
			}
		})

		it('aborts a second hold while the first remains held and admits a later hold', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const controller = new AbortController()
			const reason = new Error('The waiting hold was aborted')
			try {
				const first = await toolset.hold('first')
				const second = toolset
					.hold('second', { signal: controller.signal })
					.catch((error: unknown) => error)
				controller.abort(reason)
				expect(await second).toBe(reason)
				expect(toolset.held).toBe('first')
				const third = toolset.hold('third')
				first.destroy()
				const held = await third
				expect(toolset.held).toBe('third')
				held.destroy()
				expect(toolset.held).toBeUndefined()
			} finally {
				await toolset.destroy()
			}
		})

		it('reports its configured limit', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble(), { limit: 10 })
			try {
				expect(toolset.limit).toBe(10)
			} finally {
				await toolset.destroy()
			}
		})

		it('redacts a secret abort reason before admission and keeps ordinary refusal text', async () => {
			const message = `Rejected ${JSON.stringify(BROWSER_SELECT_SECRET)}`
			const fixture = await createBrowserSecretSelectFixture(message)
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				await fixture.page.elements.outline()
				const call = {
					id: 'aborted',
					name: 'type',
					arguments: { ref: 'e2', text: BROWSER_SELECT_SECRET, secret: true },
				}
				const signal = AbortSignal.abort(message)
				const performed = await toolset.execute(call, { signal })
				expect(performed.result.success).toBe(false)
				expect(performed.action).toBeUndefined()
				expect(performed.result).toMatchObject({ success: false, error: 'Rejected [redacted]' })
				const managed = await toolset.tools.execute(call, { signal })
				expect(managed, 'h1a: managed pre-abort redacts the complete secret').toEqual(
					performed.result,
				)
				expect(
					await toolset.tools.execute(call, { signal: AbortSignal.abort(new Error(message)) }),
				).toMatchObject({ success: false, error: 'Error: Rejected [redacted]' })
				const error = await Promise.resolve(
					requireValue(toolset.tools.tool('type')).execute(call.arguments, { signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(error, 'message')).toBe('Rejected [redacted]')
				const ordinary = await toolset.execute({
					...call,
					arguments: { ...call.arguments, secret: false },
				})
				expect(ordinary.result).toMatchObject({ success: false, error: message })
				const ordinaryAbort = { ...call, arguments: { ...call.arguments, secret: false } }
				expect(await toolset.tools.execute(ordinaryAbort, { signal })).toEqual(
					(await toolset.execute(ordinaryAbort, { signal })).result,
				)
				expect(await toolset.tools.execute(ordinaryAbort, { signal })).toMatchObject({
					success: false,
					error: message,
				})
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('redacts raw and JSON-quoted secret refusals before clipping results, actions, and direct errors', async () => {
			const message = `Rejected ${JSON.stringify(BROWSER_SELECT_SECRET)} and ${BROWSER_SELECT_SECRET}.`
			const fixture = await createBrowserSecretSelectFixture(message)
			try {
				for (const limit of [48, 4096]) {
					const toolset = createBrowserToolset(fixture.page, { limit })
					const actions = createRecorder<readonly [BrowserAction]>()
					toolset.emitter.on('action', actions.handler)
					try {
						await toolset.start()
						await fixture.page.elements.outline()
						const call = {
							id: 'secret-select',
							name: 'type',
							arguments: { ref: 'e2', text: BROWSER_SELECT_SECRET, secret: true },
						}
						const performed = await toolset.execute(call)
						expect(performed.result.success).toBe(false)
						expect(performed.action).toMatchObject({ secret: true, outcome: 'refused' })
						expect(performed.action?.arguments).not.toHaveProperty('text')
						expect(
							performed.result,
							'h1b: redaction removes the suffix before clipping',
						).toMatchObject({
							success: false,
							error: 'Rejected [redacted] and [redacted].',
						})
						expect(performed.action?.receipt).toBe('Rejected [redacted] and [redacted].')
						const managed = await toolset.tools.execute(call)
						expect(managed.success).toBe(false)
						expect(managed).toEqual(performed.result)
						const error = await Promise.resolve(
							requireValue(toolset.tools.tool('type')).execute(call.arguments, {
								signal: new AbortController().signal,
							}),
						).catch((caught: unknown) => caught)
						expect(isBrowserError(error)).toBe(true)
						expect(readProperty(error, 'message')).toBe('Rejected [redacted] and [redacted].')
						expect(actions.count).toBe(3)
						expect(actions.calls.map(([action]) => action.receipt)).toEqual([
							'Rejected [redacted] and [redacted].',
							'Rejected [redacted] and [redacted].',
							'Rejected [redacted] and [redacted].',
						])
					} finally {
						await toolset.destroy()
					}
				}
			} finally {
				await fixture.client.close()
			}
		})

		it('redacts secret text in successful selection receipts and emits Selected a secret', async () => {
			const fixture = await createBrowserSecretSelectFixture(undefined, BROWSER_JOURNEY_SECRET)
			const toolset = createBrowserToolset(fixture.page)
			const actions = createRecorder<readonly [BrowserAction]>()
			toolset.emitter.on('action', actions.handler)
			try {
				await toolset.start()
				await fixture.page.elements.outline()
				const result = await toolset.tools.execute({
					id: 'select',
					name: 'type',
					arguments: { ref: 'e2', text: BROWSER_JOURNEY_SECRET, secret: true },
				})
				expect(result.success).toBe(true)
				expect(result.success && result.value).toMatch(/^Selected a secret in/)
				expect(actions.calls[0]?.[0].receipt).toMatch(/^Selected a secret in/)
				for (const fragment of [
					BROWSER_JOURNEY_SECRET.slice(0, 4),
					BROWSER_JOURNEY_SECRET.slice(4),
				]) {
					expect(JSON.stringify(result)).not.toContain(fragment)
					expect(JSON.stringify(actions.calls.map(([action]) => action.receipt))).not.toContain(
						fragment,
					)
					expect(JSON.stringify(result)).not.toContain(JSON.stringify(fragment).slice(1, -1))
					expect(JSON.stringify(actions.calls.map(([action]) => action.receipt))).not.toContain(
						JSON.stringify(fragment).slice(1, -1),
					)
				}
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('refuses a hold while an already admitted dialog answer is pending', async () => {
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
				const answering = toolset.execute({
					id: 'answer',
					name: 'dialog',
					arguments: { accept: true },
				})
				await waitForCondition('the dialog answer is pending', () => answers.length === 1)
				await expect(toolset.hold('add-kettle')).rejects.toMatchObject({
					code: 'TOOLSET_DIALOG',
				})
				expect(order).toEqual([])
				fixture.transport.reply(requireValue(answers[0]).id, {})
				expect((await answering).action?.outcome).toBe('done')
				const hold = await toolset.hold('add-kettle')
				expect(order).toEqual(['answer', 'hold'])
				hold.destroy()
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('refuses a hold after an interrupted click and leaves the dialog answer admissible', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				released: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			const abort = new AbortController()
			try {
				replyOk(fixture.transport, 'Page.handleJavaScriptDialog')
				await toolset.start()
				await fixture.page.elements.outline()
				const acting = toolset.execute({ id: 'click', name: 'click', arguments: { ref: 'e4' } })
				await waitForCondition('input release withheld', () => withheld.length === 1)
				fixture.transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Continue?' },
					'session-main',
				)
				expect((await acting).action?.outcome).toBe('interrupted')
				const holding = toolset
					.hold('add-kettle', { signal: abort.signal })
					.catch((error: unknown) => error)
				// A turn of the host loop bounds the refusal without waiting on the blocked input.
				const refusal = await Promise.race([holding, waitForDelay().then(() => undefined)])
				expect(refusal, 'g5a1: hold refuses before waiting on the dialog input').toMatchObject({
					code: 'TOOLSET_DIALOG',
					message: 'A confirm dialog is open: "Continue?"; call dialog.',
				})
				const answered = await toolset.execute({
					id: 'answer',
					name: 'dialog',
					arguments: { accept: true },
				})
				expect(answered.result.success, 'the refused hold leaves dialog admissible').toBe(true)
				const pending = await Promise.race([
					toolset.hold('still-pending', { signal: abort.signal }).catch((error: unknown) => error),
					waitForDelay().then(() => undefined),
				])
				expect(pending, 'a closed dialog still leaves its input pending').toMatchObject({
					code: 'TOOLSET_DIALOG',
					message: 'An earlier input is still pending; call read.',
				})
				fixture.transport.reply(requireValue(withheld[0]).id, {})
				await waitForDelay()
				const hold = await toolset.hold('after-input')
				hold.destroy()
			} finally {
				abort.abort('cleanup')
				for (const message of withheld) fixture.transport.reply(message.id, {})
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
				const [first, second] = await Promise.all([toolset.execute(call), toolset.execute(call)])
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
					(await toolset.execute({ id: 'read', name: 'read', arguments: { from: 1 } })).action,
				).toBeUndefined()
				expect(
					(await toolset.execute({ id: 'missing', name: 'missing', arguments: {} })).action,
				).toBeUndefined()
				expect(
					(await toolset.execute({ id: 'refused', name: 'click', arguments: { ref: 'e99' } }))
						.action?.outcome,
				).toBe('refused')
			} finally {
				await toolset.destroy()
			}
		})

		it('captures the main-frame target without a frame before input replaces the document', async () => {
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
				const performed = await toolset.execute({
					id: 's1',
					name: 'click',
					arguments: { ref: 'e4' },
				})
				expect(performed.action?.target).toEqual({
					role: 'button',
					name: 'Place order',
					reference: 'e4',
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
					const performed = await toolset.execute({
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
					expect(performed.action?.receipt).toMatch(
						/^Typed a secret into textbox "Email" \[ref=e2\]/,
					)
					for (const fragment of ['priv', 'ate-value'])
						expect(JSON.stringify(performed)).not.toContain(fragment)
				}
				const pressed = await toolset.execute({
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
				for (const fragment of ['priv', 'ate-value'])
					expect(JSON.stringify([actions.calls, pressed, direct])).not.toContain(fragment)
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
				const performed = await toolset.execute({
					id: 's3',
					name: 'wait',
					arguments: { text: 'Added to cart', timeout: 0.01 },
				})
				expect(performed.result).toMatchObject({
					success: true,
					value: expect.stringContaining('"Added to cart" did not appear within 0.01 s.\n\npage '),
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
				const refused = await toolset.execute({
					id: 'foreign',
					name: 'checkout',
					arguments: { search: 'cart' },
				})
				expect(refused.result).toMatchObject({
					success: false,
					error: 'The toolset is replaying add-kettle until it finishes; call read.',
				})
				expect(invoked.count).toBe(0)
				const denied = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: new AbortController().signal },
					),
				).catch((error: unknown) => error)
				expect(readProperty(denied, 'code')).toBe('TOOLSET_BUSY')
				for (const call of [
					{ id: 'read', name: 'read', arguments: { from: 1 } },
					{ id: 'read', name: 'read', arguments: { from: 1 } },
					{ id: 'plain', name: 'read', arguments: { from: 1 } },
					{ id: 'wait', name: 'wait', arguments: { text: 'Form' } },
				])
					expect((await toolset.execute(call)).result.success).toBe(true)
				expect(
					(
						await toolset.execute(
							{ id: 'owner', name: 'checkout', arguments: { search: 'cart' } },
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

		it('reserves admission while a hold waits for an earlier adopted action', async () => {
			const { toolset, view, pending, invoked } = createBrowserPendingToolsetFixture()
			const order: string[] = []
			toolset.emitter.on('action', (action) => {
				if (action.outcome === 'done') order.push(action.action)
			})
			toolset.emitter.on('hold', () => order.push('hold'))
			await toolset.start()
			try {
				const acting = toolset.execute({
					id: 'before',
					name: 'checkout',
					arguments: { search: 'cart' },
				})
				await waitForCondition('adopted input started', () => invoked.count === 1)
				const holding = toolset.hold('add-kettle')
				const foreign = Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(
						{ ref: 'e1' },
						{ signal: new AbortController().signal },
					),
				).catch((error: unknown) => error)
				expect(order).toEqual([])
				pending.resolve('checked out')
				expect((await acting).result.success).toBe(true)
				const hold = await holding
				const denied = await foreign
				expect(denied).toMatchObject({
					code: 'TOOLSET_BUSY',
					message: 'The toolset is replaying add-kettle until it finishes; call read.',
				})
				expect(order).toEqual(['checkout', 'hold'])
				expect(view.calls).not.toContain('click e1')
				hold.destroy()
				expect(
					(await toolset.execute({ id: 'after', name: 'click', arguments: { ref: 'e1' } })).result
						.success,
				).toBe(true)
			} finally {
				pending.resolve('cleanup')
				await toolset.destroy()
			}
		})

		it('waits for admitted actions before holding and cancels a queued hold without blocking the queue', async () => {
			const { toolset, pending, invoked } = createBrowserPendingToolsetFixture()
			await toolset.start()
			try {
				const acting = toolset.execute({
					id: 'before',
					name: 'checkout',
					arguments: { search: 'cart' },
				})
				await waitForCondition('adopted input started', () => invoked.count === 1)
				const abort = new AbortController()
				const abandoned = toolset
					.hold('cancelled', { signal: abort.signal })
					.catch((error: unknown) => error)
				abort.abort('cancelled')
				expect(await abandoned).toBe('cancelled')
				const foreign = toolset.execute({ id: 'foreign', name: 'click', arguments: { ref: 'e1' } })
				const order: string[] = []
				toolset.emitter.on('action', () => order.push('action'))
				toolset.emitter.on('hold', () => order.push('hold'))
				const holding = toolset.hold('add-kettle')
				expect(order).toEqual([])
				pending.resolve('checked out')
				await acting
				expect((await foreign).result.success).toBe(true)
				const hold = await holding
				expect(order).toEqual(['action', 'action', 'hold'])
				hold.destroy()
				expect(
					(await toolset.execute({ id: 'after', name: 'click', arguments: { ref: 'e1' } })).result
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
				const acting = toolset.execute(
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
				const refused = await toolset.execute({
					id: 'foreign',
					name: 'dialog',
					arguments: { accept: true },
				})
				expect(refused.result).toMatchObject({
					success: false,
					error: 'The toolset is replaying add-kettle until it finishes; call read.',
				})
				expect(
					fixture.transport.sent.filter(
						(message) => message.method === 'Page.handleJavaScriptDialog',
					),
				).toHaveLength(0)
				const answered = await toolset.execute(
					{ id: 's2', name: 'dialog', arguments: { accept: true } },
					context,
				)
				expect(answered.action?.outcome).toBe('done')
				fixture.transport.reply(requireValue(withheld[0]).id, {})
				expect(
					(
						await toolset.execute(
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
		it('bounds the serialized journey and full tool copy', () => {
			// Count compact JSON UTF-16 code units as a tokenizer-independent proxy: models read
			// name, description, and parameters (the input schema), not title or annotations.
			const definitions = Object.values(BROWSER_TOOL_COPY).map(
				({ name, description, parameters }) => ({ name, description, parameters }),
			)
			const journeys = definitions.filter(({ name }) =>
				BROWSER_JOURNEY_TOOL_NAMES.some((journey) => journey === name),
			)
			const secret = {
				secret: readProperty<object>(
					readProperty<object>(BROWSER_TOOL_COPY.type.parameters, 'properties'),
					'secret',
				),
			}
			// Round the compact copy's bound to the next multiple of 50.
			// Include the secret property's name and schema without charging for the rest of type.
			expect
				.soft(JSON.stringify(journeys).length + JSON.stringify(secret).length, 'journey copy')
				.toBeLessThanOrEqual(3400)
			expect.soft(JSON.stringify(definitions).length, 'full tool copy').toBeLessThanOrEqual(6050)
		})

		it('catches a tool outside the vocabulary, a native extra, a missing required parameter, a stray annotation, or a long parameter description', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = new BrowserToolset(page)
				expect(toolset.tools.count).toBe(0)
				await toolset.start()
				const names = ['read', 'click', 'type', 'press', 'navigate', 'wait']
				expect(toolset.tools.tools().map((tool) => tool.name)).toEqual(names)
				expect(toolset.native.map((tool) => tool.name)).toEqual(names)
				expect(toolset.native).toEqual(toolset.tools.tools())
				expect(toolset.view).toBe(page)
				expect(
					Object.fromEntries(toolset.native.map((tool) => [tool.name, tool.annotations])),
				).toEqual({
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
					expect(required.length).toBe(name === 'type' ? 2 : 1)
					for (const key of required) expect(Object.keys(properties)).toContain(key)
					for (const property of Object.values(properties))
						expect(readProperty<string>(property, 'description').length).toBeLessThanOrEqual(100)
				}
				expect(BROWSER_TOOL_NAMES).not.toContain('tabs')
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
				read: 'Shows numbered lines of the page, with references like e4 to act on. Call it to learn a fact or to find an element.',
				click: 'Clicks the referenced element, settles its action, and returns the page.',
				type: 'Types into a field such as a search box, optionally submits its form, and returns the page.',
				press: 'Presses a key or chord, settles its action, and returns the page.',
				navigate: 'Opens an absolute web address in the current tab and returns the loaded page.',
				wait: 'Waits for text to appear or leave, then returns the page.',
				dialog: 'Answers the open dialog, settles the interrupted action, and returns the page.',
				switch: 'Selects an open tab that read lists and returns its page.',
			})
			expect(
				readProperty<object>(
					readProperty<object>(BROWSER_TOOL_COPY.type.parameters, 'properties'),
					'submit',
				),
			).toEqual({ type: 'boolean', description: 'True to submit its form after typing.' })
			expect(
				readProperty(
					readProperty<object>(BROWSER_TOOL_COPY.wait.parameters, 'properties'),
					'absent',
				),
			).toEqual({ type: 'boolean', description: 'True to wait for the text to leave the page.' })
		})

		it('catches a read that advertises or accepts ref, or a tool that runs with a parameter it does not advertise', async () => {
			expect(
				Object.keys(readProperty<object>(BROWSER_TOOL_COPY.read.parameters, 'properties')),
			).toEqual(['from', 'to', 'search'])
			expect(
				Object.keys(readProperty<object>(BROWSER_TOOL_COPY.read.parameters, 'properties')),
			).toEqual(['from', 'to', 'search'])
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const results = await toolset.tools.execute([
				{ id: '1', name: 'read', arguments: { from: 1, search: 'the cart', ref: 'e1' } },
				{ id: '2', name: 'read', arguments: { from: 1, search: 'the cart', ref: 'e1' } },
				{ id: '3', name: 'type', arguments: { ref: 'e2', text: 'sam', search: 'the email' } },
			])
			expect(results.map((result) => readProperty(result, 'error'))).toEqual([
				'The read tool takes no ref parameter; call read with from, to, and search.',
				'The read tool takes no ref parameter; call read with from, to, and search.',
				'The type tool takes no search parameter; call type with ref, text, submit, and secret.',
			])
			expect(view.calls).toEqual([])
			const refused = await Promise.resolve(
				requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'the cart', ref: 'e1' },
					{ signal: new AbortController().signal },
				),
			).catch((caught: unknown) => caught)
			expect(readProperty(refused, 'code')).toBe('ARGUMENT')
			expect(readProperty(refused, 'context')).toEqual({ subject: 'toolset', key: 'ref' })
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
					expect(readProperty(error, 'code')).toBe('TOOLSET_RESERVED')
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
				for (const limit of [0, -1, 1.5, Number.NaN]) {
					expect(() => createBrowserToolset(page, { limit })).toThrow(
						'Browser toolset limit must be a positive integer',
					)
					expect(captureError(() => createBrowserToolset(page, { limit }))).toMatchObject({
						code: 'ARGUMENT',
						context: { subject: 'toolset', limit },
					})
				}
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'order' },
					{ signal },
				)
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
					'Clicked button "Place order" [ref=e4]. A confirm dialog is open: "Delete the draft?"; call dialog.',
				)
				expect(toolset.tools.tool('dialog')?.name).toBe('dialog')
				const refusals = await toolset.tools.execute([
					{ id: '1', name: 'read', arguments: { from: 1, search: 'cart' } },
					{ id: '2', name: 'read', arguments: { from: 1, search: 'cart' } },
					{ id: 'plain', name: 'read', arguments: { from: 1, search: 'cart' } },
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
				expect(next.startsWith('Clicked link "Home" [ref=e1].\n\npage "Cart"')).toBe(true)
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'size' },
					{ signal },
				)
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
					'Selected "Large" in combobox "Size" [ref=e2] (programmatic). An alert dialog is open: "Pick one"; call dialog.',
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
					await toolset.tools.execute({
						id: '1',
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					}),
				).toMatchObject({ success: false, error: 'An alert dialog is open: "Saved"; call dialog.' })
				transport.event('Page.javascriptDialogClosed', { result: true }, 'session-main')
				expect(toolset.tools.tool('dialog')).toBeUndefined()
				expect(
					await toolset.tools.execute({
						id: '2',
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					}),
				).toMatchObject({ success: true })
				const refused = await Promise.resolve(
					staged.execute({ accept: true }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(refused, 'message')).toBe('No dialog is open; call read.')
				expect(readProperty(refused, 'code')).toBe('TOOLSET_DIALOG')
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'email' },
					{ signal },
				)
				const sent = transport.sent.length
				const typed = String(
					await requireValue(toolset.tools.tool('type')).execute(
						{ ref: '[ref=e2]', text: 'sam', submit: true },
						{ signal },
					),
				)
				expect(
					typed.startsWith('Typed "sam" into textbox "Email" [ref=e2] and pressed Enter.\n\n'),
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
					error: 'Reference "x12" is not a reference such as e12; call read for fresh refs.',
				})
				expect(
					await toolset.tools.execute({ id: '2', name: 'click', arguments: { ref: 'e99' } }),
				).toMatchObject({
					success: false,
					error: 'Element [ref=e99] is not in the current view; call read for fresh refs.',
				})
			} finally {
				await client.close()
			}
		})

		it('catches a copied failed perform that drops its coded fault or a tool that rejects without the code', async () => {
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				const call = { id: 'refused', name: 'click', arguments: { ref: 'x12' } }
				const performed = await toolset.execute(call)
				const copy = { ...performed }
				expect(copy.result).toMatchObject({
					success: false,
					error: 'Reference "x12" is not a reference such as e12; call read for fresh refs.',
				})
				expect(isBrowserError(copy.fault) && copy.fault.code === 'ELEMENT' && copy.fault.code).toBe(
					'ELEMENT',
				)
				expect(copy.fault).toBe(performed.fault)
				expect(JSON.parse(JSON.stringify(copy))).toHaveProperty('fault', {
					name: 'BrowserError',
					code: 'ELEMENT',
					context: { subject: 'Reference "x12"', reason: 'UNKNOWN' },
				})
				const rejected = await Promise.resolve(
					requireValue(toolset.tools.tool('click')).execute(call.arguments, {
						signal: new AbortController().signal,
					}),
				).catch((error: unknown) => error)
				expect(isBrowserError(rejected) && rejected.code === 'ELEMENT' && rejected.code).toBe(
					'ELEMENT',
				)
				const reading = await toolset.execute({ id: 'read', name: 'read', arguments: { from: 1 } })
				expect(reading.result.success).toBe(true)
				expect(reading).not.toHaveProperty('fault')
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
				message:
					'Element button "Save" [ref=e1] takes no text; to type, use textbox "Email" [ref=e2] or combobox "Size" [ref=e3].',
				code: 'TOOLSET_ROLE',
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
				await requireValue(trusted.tools.tool('read')).execute(
					{ from: 1, search: 'size' },
					{ signal },
				)
				const sent = transport.sent.length
				expect(
					await trusted.tools.execute({
						id: 'type',
						name: 'type',
						arguments: { ref: 'e2', text: 'Small' },
					}),
				).toMatchObject({
					success: false,
					error: 'Element option "Small" [ref=e2] takes no text; call click for an option.',
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'email' },
					{ signal: new AbortController().signal },
				)
				expect(
					await toolset.tools.execute({
						id: 'type',
						name: 'type',
						arguments: { ref: 'e2', text: 'x', submit: true },
					}),
				).toMatchObject({
					success: false,
					error: 'Element textbox "Email" [ref=e2] is not editable.',
				})
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
						{ signal },
					)
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
				/^Clicked link "Home" \[ref=e1\]\.\n\npage "Cart" https:\/\/example\.test\/next \(9 lines\)\n/,
			)
			expect(reads).toBe(1)
			expect(changed).toEqual([
				'Clicked link "Home" [ref=e1].\n\n(The page changed before the view could be read; call read.)',
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
						{ signal },
					)
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
				/^Clicked link "Home" \[ref=e1\]\.\n\npage "Next" https:\/\/example\.test\/next \(9 lines\)\n/,
			)
			expect(reads).toBe(2)
			expect(failed).toEqual([
				'Clicked link "Home" [ref=e1].\n\n(The view could not be read: Cannot find context with specified id; call read.)',
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
						'Navigated to https://example.test/next.\n\npage "Cart" https://example.test/next (9 lines)\n1: # Your cart',
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
						{ signal },
					)
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(3_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(
						result.startsWith(
							'Clicked link "Home" [ref=e1]; it requested https://example.test/next and the page did not change.\n\npage "Cart" https://example.test/cart (9 lines)\n1: # Your cart',
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
						{ signal },
					)
					const started = performance.now()
					const result = String(
						await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
					)
					const elapsed = performance.now() - started
					expect(elapsed).toBeGreaterThanOrEqual(3_900)
					expect(elapsed).toBeLessThan(6_000)
					expect(
						result.startsWith(
							'Clicked link "Home" [ref=e1]; the page is still loading https://example.test/next.\n\npage "Cart" https://example.test/next (9 lines)\n1: # Your cart',
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
						{ signal },
					)
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
						'Clicked link "Home" [ref=e1]; the page is still loading https://example.test/next.\n\n(The view could not be read before the deadline; call read.)',
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'home' },
					{ signal },
				)
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
						'Clicked link "Home" [ref=e1].\n\npage "Cart" https://example.test/next (9 lines)\n1: # Your cart',
					),
				).toBe(true)
			} finally {
				await client.close()
			}
		})
	})

	describe('page tools', () => {
		it('catches a page tool added under a reserved, held, malformed, optional-purpose, or debugging name, or a destroy that removes the consumer tool', async () => {
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
								description: 'Optional purpose',
								frameId: 'main',
								inputSchema: { type: 'object', properties: { purpose: { type: 'string' } } },
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
					await tools.execute({ id: 'search', name: 'search', arguments: { purpose: 'boots' } }),
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
				expect(toolset.tools.tool('click')).toBe(
					toolset.native.find((tool) => tool.name === 'click'),
				)
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

	describe('destroy', () => {
		it('catches a destroyed toolset that still runs a tool, keeps a queued action, or leaves its tools', async () => {
			const releases: CDPSentMessage[] = []
			const { client, page, transport } = await createBrowserElementFixture({
				released: (message) => releases.push(message),
			})
			try {
				const toolset = createBrowserToolset(page)
				await toolset.start()
				await toolset.tools.execute({
					id: 'read',
					name: 'read',
					arguments: { from: 1, search: 'cart' },
				})
				const click = requireValue(toolset.tools.tool('click'))
				const read = requireValue(toolset.tools.tool('read'))
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
					read.execute({ from: 1, search: 'cart' }, { signal: new AbortController().signal }),
				).catch((caught: unknown) => caught)
				expect(readProperty(after, 'message')).toBe('the browser session ended')
				expect(readProperty(after, 'code')).toBe('CLOSED')
				expect(
					readProperty(await toolset.start().catch((caught: unknown) => caught), 'message'),
				).toBe('the browser session ended')
				expect(toolset.emitter.destroyed).toBe(true)
			} finally {
				await client.close()
			}
		})

		it('leaves its caller-owned view usable after repeated teardown', async () => {
			const view = createBrowserViewDouble()
			const toolset = createBrowserToolset(view)
			await toolset.start()
			const closing = toolset.destroy()
			expect(toolset.destroy()).toBe(closing)
			await closing
			expect(toolset.tools.count).toBe(0)
			expect((await view.elements.outline()).url).toBe(view.url)
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
				expect(readProperty(first, 'code')).toBe('TOOLSET_RESERVED')
				tools.remove('wait')
				const starts = [toolset.start(), toolset.start()]
				expect(starts[0]).toBe(starts[1])
				await waitForCondition('the enable is withheld', () => enables.length === 1)
				expect(toolset.tools.count).toBe(0)
				transport.reply(requireValue(enables[0]).id, {})
				await Promise.all(starts)
				expect(toolset.tools.count).toBe(6)
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

		it('catches a census-free tool advertised without the synthetic purpose, one that receives it, or an optional purpose that is adopted', async () => {
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
								parameters: { type: 'object', properties: { purpose: { type: 'string' } } },
								execute: ignoreCall,
							}),
						]),
				}
				const toolset = createBrowserToolset(page, { source })
				const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
				toolset.emitter.on('skip', skips.handler)
				await toolset.start()
				expect(skips.calls).toEqual([['maybe', 'schema']])
				expect(readProperty(toolset.tools.tool('extra')?.parameters, 'required')).toEqual([
					'purpose',
				])
				await toolset.tools.execute({
					id: 'extra',
					name: 'extra',
					arguments: { purpose: 'find boots', query: 'boots' },
				})
				expect(inputs.calls.map(([input]) => input)).toEqual([{ query: 'boots' }])
			} finally {
				await client.close()
			}
		})

		it('catches a registry tool whose read-only hint is lost, whose untrusted mark follows the page, or whose synthetic purpose reaches the page', async () => {
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
				expect(readProperty(tool.parameters, 'required')).toEqual(['purpose'])
				expect(
					await tool.execute(
						{ purpose: 'Find the book', query: 'dune' },
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'size' },
						{ signal },
					)
					const typed = String(
						await requireValue(toolset.tools.tool('type')).execute(
							{ ref: 'e2', text: 'Large' },
							{ signal },
						),
					)
					const inserted = transport.sent.some((message) => message.method === 'Input.insertText')
					expect([typed.split('\n')[0], inserted]).toEqual(
						select
							? ['Selected "Large" in combobox "Size" [ref=e2] (programmatic).', false]
							: ['Typed "Large" into combobox "Size" [ref=e2].', true],
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
				expect(await wait.execute({ text: 'Done', timeout: 60 }, { signal })).toContain(
					'"Done" is on the page.\n\npage ',
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
				await requireValue(toolset.tools.tool('read')).execute(
					{ from: 1, search: 'home' },
					{ signal },
				)
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
					'Clicked link "Home" [ref=e1]. An alert dialog is open: "Wait"; call dialog.',
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
					await requireValue(toolset.tools.tool('read')).execute(
						{ from: 1, search: 'home' },
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

	describe('startup reentry', () => {
		it('catches a start from an add listener that begins a second startup', async () => {
			const tools = createToolManager()
			const toolset = new BrowserToolset(createBrowserViewDouble(), { tools })
			const nested: Array<Promise<void>> = []
			tools.emitter.on('add', (tool) => {
				if (tool.name === 'read' && nested.length === 0) nested.push(toolset.start())
			})
			const outer = toolset.start()
			await outer
			expect(nested[0]).toBe(outer)
			expect(tools.tools().map((tool) => tool.name)).toEqual(['read', 'click', 'type', 'wait'])
			await toolset.destroy()
			expect(tools.count).toBe(0)
		})
	})

	describe('trust marker', () => {
		it('catches an untrusted view whose click or type receipt omits the marker, or a read or wait that gains it', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const signal = new AbortController().signal
			const outline =
				'page "Form" https://example.test/form (3 lines)\n1: button "Save" [ref=e1]\n2: textbox "Email" [ref=e2]\n3: combobox "Size" [ref=e3]\n[lines 1–3 of 3; the whole page]'
			expect(await requireValue(toolset.tools.tool('read')).execute({ from: 1 }, { signal })).toBe(
				outline,
			)
			expect(await requireValue(toolset.tools.tool('read')).execute({ from: 1 }, { signal })).toBe(
				outline,
			)
			expect(
				await requireValue(toolset.tools.tool('wait')).execute({ text: 'Form body' }, { signal }),
			).toBe(`"Form body" is on the page.\n\n${outline}`)
			expect(
				await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
			).toBe(`Clicked button "Save" [ref=e1]. (untrusted event)\n\n${outline}`)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam' },
					{ signal },
				),
			).toBe(`Typed "sam" into textbox "Email" [ref=e2]. (untrusted event)\n\n${outline}`)
			expect(
				await requireValue(toolset.tools.tool('type')).execute(
					{ ref: 'e2', text: 'sam', submit: true },
					{ signal },
				),
			).toBe(
				`Typed "sam" into textbox "Email" [ref=e2] and submitted the form. (untrusted event)\n\n${outline}`,
			)
		})

		it('catches a click receipt on a textbox that omits the type call or on a button that gains it', async () => {
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view)
			await toolset.start()
			const signal = new AbortController().signal
			const click = requireValue(toolset.tools.tool('click'))
			const outline =
				'page "Form" https://example.test/form (3 lines)\n1: button "Save" [ref=e1]\n2: textbox "Email" [ref=e2]\n3: combobox "Size" [ref=e3]\n[lines 1–3 of 3; the whole page]'
			expect(await click.execute({ ref: 'e2' }, { signal })).toBe(
				`Clicked textbox "Email" [ref=e2]; call type with e2 to enter text. (untrusted event)\n\n${outline}`,
			)
			expect(await click.execute({ ref: 'e1' }, { signal })).toBe(
				`Clicked button "Save" [ref=e1]. (untrusted event)\n\n${outline}`,
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
					await requireValue(toolset.tools.tool('read')).execute({ from: 1 }, { signal }),
				)
				expect(
					await requireValue(toolset.tools.tool('click')).execute({ ref: 'e1' }, { signal }),
				).toBe(`Clicked link "Home" [ref=e1].\n\n${outline}`)
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

	describe('follow', () => {
		it('throws a BrowserStepError that carries the performed action when a step times out', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble({ waited: false }))
			const performed = createRecorder<readonly [BrowserAction]>()
			toolset.emitter.on('action', performed.handler)
			await toolset.start()
			try {
				const error = await toolset
					.follow('s1', { action: 'wait', arguments: { text: 'Saved', timeout: 0.01 } })
					.then(
						() => undefined,
						(caught: unknown) => caught,
					)
				expect(isBrowserStepError(error)).toBe(true)
				expect(isBrowserError(error)).toBe(true)
				expect(error).toMatchObject({
					name: 'BrowserStepError',
					code: 'STEP',
					message: 's1: "Saved" did not appear within 0.01 s.',
					context: { step: 's1' },
					action: {
						action: 'wait',
						arguments: { text: 'Saved', timeout: 0.01 },
						outcome: 'timeout',
						receipt: '"Saved" did not appear within 0.01 s.',
					},
				})
				expect(performed.calls).toHaveLength(1)
				expect(isBrowserStepError(error) ? error.action : undefined).toEqual(
					performed.calls[0]?.[0],
				)
				expect(isBrowserStepError(new BrowserError('ARGUMENT', 's1: refused'))).toBe(false)
				expect(isBrowserStepError(performed.calls[0]?.[0])).toBe(false)
			} finally {
				await toolset.destroy()
			}
		})

		it('throws a plain BrowserError with no action when the manager refuses the call before any handler', async () => {
			const toolset = new BrowserToolset(createBrowserViewDouble())
			await toolset.start()
			try {
				const error = await toolset.follow('s5', { action: 'missing', arguments: {} }).then(
					() => undefined,
					(caught: unknown) => caught,
				)
				expect(error).toMatchObject({
					name: 'BrowserError',
					message: 's5: tool not found: missing',
				})
				expect(isBrowserStepError(error)).toBe(false)
			} finally {
				await toolset.destroy()
			}
		})

		it('passes a page tool its literal arguments unchanged without resolving an element target', async () => {
			const invoked = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
			const tool = createTool({
				name: 'checkout',
				parameters: {
					type: 'object',
					properties: { basket: { type: 'object' } },
					required: ['basket'],
				},
				execute: invoked.handler,
			})
			const view = createBrowserViewDouble()
			const toolset = new BrowserToolset(view, {
				source: { adopt: async () => [tool], emitter: new Emitter<BrowserToolSourceEventMap>() },
			})
			await toolset.start()
			try {
				const args = {
					basket: { items: ['kettle'], quantity: 1 },
					value: { parameter: 'customer' },
				}
				const action = await toolset.follow('s1', {
					action: 'checkout',
					arguments: args,
					target: { role: 'button', name: 'irrelevant' },
				})
				expect(invoked.calls.map(([input]) => input)).toEqual([args])
				expect(action.arguments).toEqual(args)
				expect(action.outcome).toBe('done')
				expect(view.calls).toEqual([])
			} finally {
				await toolset.destroy()
			}
		})

		it('returns an interrupted action, answers the dialog, and continues the pending input', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				released: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			try {
				replyOk(fixture.transport, 'Page.handleJavaScriptDialog')
				await toolset.start()
				const clicking = toolset.follow('s1', {
					action: 'click',
					arguments: {},
					target: { role: 'button', name: 'Place order' },
				})
				await waitForCondition('the followed input is pending', () => withheld.length === 1)
				fixture.transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'confirm', message: 'Continue?' },
					'session-main',
				)
				expect(await clicking).toMatchObject({
					outcome: 'interrupted',
					receipt:
						'Clicked button "Place order" [ref=e4]. A confirm dialog is open: "Continue?"; call dialog.',
				})
				const answered = await toolset.follow('s2', {
					action: 'dialog',
					arguments: { accept: true },
					target: { role: 'button', name: 'irrelevant' },
				})
				expect(answered.arguments).toEqual({ accept: true })
				expect(answered.outcome).toBe('done')
				fixture.transport.reply(requireValue(withheld[0]).id, {})
				expect(
					(await toolset.follow('s3', { action: 'press', arguments: { key: 'Escape' } })).outcome,
				).toBe('done')
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('runs under a hold with its token, releases the hold after aborting its input, and sends no suffix action', async () => {
			const withheld: CDPSentMessage[] = []
			const fixture = await createBrowserElementFixture({
				insert: (message) => withheld.push(message),
			})
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				const controller = new AbortController()
				const hold = await toolset.hold('add-kettle')
				const released = createRecorder<readonly [string]>()
				toolset.emitter.on('release', released.handler)
				await expect(
					toolset.follow('s0', { action: 'press', arguments: { key: 'Escape' } }),
				).rejects.toMatchObject({
					code: 'STEP',
					message: 's0: The toolset is replaying add-kettle until it finishes; call read.',
					action: { action: 'press', outcome: 'refused' },
				})
				const typing = toolset
					.follow(
						's1',
						{
							action: 'type',
							arguments: { text: 'Harbor' },
							target: { role: 'textbox', name: 'Email' },
						},
						{ signal: controller.signal, caller: hold.token },
					)
					.then(() => toolset.follow('s2', { action: 'press', arguments: { key: 'Escape' } }))
					.finally(() => hold.destroy())
					.catch((error: unknown) => error)
				await waitForCondition('the held input is pending', () => withheld.length === 1)
				controller.abort(new Error('caller left'))
				expect(await typing).toMatchObject({ message: 's1: caller left' })
				expect(released.calls).toEqual([['add-kettle']])
				expect(
					fixture.transport.sent.some(
						(message) =>
							message.method === 'Input.dispatchKeyEvent' && message.params?.['key'] === 'Escape',
					),
				).toBe(false)
				expect(
					(await toolset.execute({ id: 'after', name: 'press', arguments: { key: 'Escape' } }))
						.action?.outcome,
				).toBe('done')
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('resolves a unique target on its own view and refuses a missing target or a bound name without sending input', async () => {
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				expect(toolset.view).toBe(fixture.page)
				await expect(
					toolset.follow('s3', {
						action: 'click',
						arguments: {},
						target: { role: 'button', name: 'Add to cart' },
					}),
				).rejects.toMatchObject({
					code: 'JOURNEY_TARGET',
					message:
						'Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.',
				})
				await expect(
					toolset.follow('s6', {
						action: 'click',
						arguments: {},
						target: { role: 'button', name: { parameter: 'label' } },
					}),
				).rejects.toMatchObject({
					code: 'JOURNEY_INPUT',
					message: 'Step s6 binds its target name to parameter "label"; pass the name itself.',
					context: { step: 's6', parameter: 'label' },
				})
				expect(
					fixture.transport.sent.filter((message) => message.method.startsWith('Input.')),
				).toEqual([])
				const typed = await toolset.follow('s2', {
					action: 'type',
					arguments: { text: 'ada@example.test' },
					target: { role: 'textbox', name: 'Email' },
				})
				expect(typed).toMatchObject({
					arguments: { text: 'ada@example.test', ref: 'e2' },
					target: { role: 'textbox', name: 'Email', reference: 'e2' },
					outcome: 'done',
				})
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('refuses ambiguity without trusting a stored reference or selector', async () => {
			const fixture = await createBrowserElementFixture({
				accessibility: (message) =>
					fixture.transport.reply(message.id, {
						nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
							node.nodeId === 'link' || node.nodeId === 'button'
								? { ...node, role: { value: 'button' }, name: { value: 'Delete' } }
								: node,
						),
					}),
			})
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				const target = { role: 'button', name: 'Delete', reference: 'e1', css: '#delete' }
				await expect(
					toolset.follow('s3', { action: 'click', arguments: {}, target }),
				).rejects.toMatchObject({
					code: 'JOURNEY_AMBIGUOUS',
					message:
						'Step s3 names button "Delete", which 2 elements carry; call edit to remove or replace s3.',
				})
				expect(
					fixture.transport.sent.filter((message) => message.method.startsWith('Input.')),
				).toEqual([])
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('builds ref only for element actions and forwards a secret through the action boundary', async () => {
			const fixture = await createBrowserElementFixture()
			const toolset = createBrowserToolset(fixture.page)
			try {
				await toolset.start()
				const typed = await toolset.follow(
					's1',
					{
						action: 'type',
						target: { role: 'textbox', name: 'Email' },
						arguments: { text: 'private-value' },
					},
					{ secret: true },
				)
				expect(typed).toMatchObject({
					secret: true,
					arguments: { ref: 'e2', secret: true },
					outcome: 'done',
				})
				expect(typed.arguments).not.toHaveProperty('text')
				expect(typed.receipt).toContain('Typed a secret into')
				const pressed = await toolset.follow('s2', {
					action: 'press',
					target: { role: 'textbox', name: 'Email' },
					arguments: { key: 'Escape' },
				})
				expect(pressed.arguments).toEqual({ key: 'Escape' })
				const clicked = await toolset.follow('s3', {
					action: 'click',
					target: { role: 'button', name: 'Place order' },
					arguments: {},
				})
				expect(clicked.arguments).toEqual({ ref: 'e4' })
				const kept = await toolset.follow(
					's4',
					{ action: 'click', target: { role: 'button', name: 'Place order' }, arguments: {} },
					{ secret: true },
				)
				expect(kept.arguments).toEqual({ ref: 'e4' })
			} finally {
				await toolset.destroy()
				await fixture.client.close()
			}
		})

		it('builds no ref for wait and stops a sequence at its unchanged timeout receipt', async () => {
			const view = createBrowserViewDouble({ waited: false })
			const toolset = new BrowserToolset(view)
			await toolset.start()
			try {
				await expect(
					toolset
						.follow('s3', {
							action: 'wait',
							target: { role: 'textbox', name: 'Email' },
							arguments: { text: 'Added to cart', timeout: 0.01 },
						})
						.then(() => toolset.follow('s4', { action: 'click', arguments: { ref: 'e1' } })),
				).rejects.toThrow('s3: "Added to cart" did not appear within 0.01 s.')
				expect(view.calls).toEqual(['wait Added to cart', 'outline'])
			} finally {
				await toolset.destroy()
			}
		})

		it('lists the context tabs as data, resolves a switch tab from that data where the cut tabs listing omits it, and refuses a missing or ambiguous tab before switching', async () => {
			const titles: Readonly<Record<string, string>> = {
				'session-tab-1': 'Cart',
				'session-tab-2': 'Orders',
				'session-tab-3': 'Cart',
				'session-tab-4': 'Returns',
			}
			const fixture = await createBrowserElementFixture({
				title: (message) =>
					fixture.transport.reply(message.id, {
						result: { value: titles[message.sessionId ?? ''] ?? 'Cart' },
					}),
			})
			const { client, transport } = fixture
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
				await context.create()
				const fourth = await context.create()
				// The limit cuts the tabs tool's text inside the second line, so a resolution that read
				// the text back would find only the first tab.
				const toolset = createBrowserToolset(first, { context })
				await toolset.start()
				expect(await toolset.tabs()).toStrictEqual([
					{ id: 't1', title: 'Cart', url: 'about:blank', current: true },
					{ id: 't2', title: 'Orders', url: 'about:blank', current: false },
					{ id: 't3', title: 'Cart', url: 'about:blank', current: false },
					{ id: 't4', title: 'Returns', url: 'about:blank', current: false },
				])
				expect(await toolset.read()).toContain('tabs: t1')
				const fronted = (): number =>
					transport.sent.filter((message) => message.method === 'Page.bringToFront').length
				await expect(
					toolset.follow('s3', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Cart', url: 'about:blank' },
					}),
				).rejects.toMatchObject({
					code: 'JOURNEY_AMBIGUOUS',
					message: 's3: The tab "Cart" at about:blank is ambiguous; call read.',
				})
				for (const tab of [
					{ title: 'Help', url: 'about:blank' },
					{ title: 'Orders', url: 'https://shop.example.test/orders' },
				])
					await expect(
						toolset.follow('s4', { action: 'switch', arguments: {}, tab }),
					).rejects.toMatchObject({
						code: 'JOURNEY_TARGET',
						message: `s4: The tab ${JSON.stringify(tab.title)} at ${tab.url} is not open; call read.`,
					})
				expect(fronted()).toBe(0)
				const switched = await toolset.follow('s5', {
					action: 'switch',
					arguments: {},
					tab: { title: 'Orders', url: 'about:blank' },
				})
				expect(switched).toMatchObject({
					action: 'switch',
					arguments: { tab: 't2' },
					tab: { title: 'Orders', url: 'about:blank' },
					outcome: 'done',
				})
				expect(toolset.view).toBe(second)
				expect(fronted()).toBe(1)
				expect(
					await toolset.follow('s6', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Returns', url: 'about:blank' },
					}),
				).toMatchObject({ arguments: { tab: 't4' }, outcome: 'done' })
				expect(toolset.view).toBe(fourth)
				expect((await toolset.tabs()).map((tab) => tab.current)).toEqual([
					false,
					false,
					false,
					true,
				])
				const reason = new Error('the caller left')
				await expect(toolset.tabs({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
				transport.event(
					'Page.javascriptDialogOpening',
					{ type: 'alert', message: 'Saved' },
					'session-tab-4',
				)
				await expect(toolset.tabs()).rejects.toMatchObject({ code: 'TOOLSET_DIALOG' })
				await expect(
					toolset.follow('s7', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Orders', url: 'about:blank' },
					}),
				).rejects.toMatchObject({ code: 'TOOLSET_DIALOG' })
				expect(fronted()).toBe(2)
				await toolset.destroy()
				await expect(toolset.tabs()).rejects.toMatchObject({ code: 'CLOSED' })
				const viewless = createBrowserToolset(first)
				await viewless.start()
				expect(await viewless.tabs()).toStrictEqual([])
				await expect(
					viewless.follow('s8', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Orders', url: 'about:blank' },
					}),
				).rejects.toMatchObject({ message: 's8: tool not found: switch' })
				await viewless.destroy()
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
			expect(isBrowserError(refusal) && refusal.code).toBe('TOOLSET_RESERVED')
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
