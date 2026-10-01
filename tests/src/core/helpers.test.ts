/**
 * src/core/helpers.ts tests.
 */

import type { BrowserToolSourceEventMap } from '@src/core'
import type { CDPSentMessage } from '../../setup.js'
import { describe, it, expect } from 'vitest'
import { attempt } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createTool } from '@orkestrel/tool'
import {
	renderBrowserRun,
	renderBrowserRunResult,
	collectBrowserJourneyBindings,
	editBrowserJourney,
	renderBrowserJourney,
	deriveBrowserJourneyTrigger,
	deriveBrowserJourneySecret,
	generateBrowserRunId,
	resolveBrowserJourneyBinding,
	composeBrowserPoint,
	locateBrowserTarget,
	performBrowserStep,
	createBrowserToolset,
	BrowserToolset,
	filterBrowserOutline,
	normalizeBrowserKey,
	normalizeBrowserName,
	readBrowserAccessibility,
	renderBrowserOutline,
	BrowserError,
	renderBrowserToolOutput,
	deriveBrowserToolSchema,
	BROWSER_REGISTRY_OUTPUT_LIMIT,
	BrowserResultLimitError,
	decodeBase64,
	extractBrowserSlice,
	readBrowserAttributes,
	readBrowserSnapshot,
	readRareBooleanData,
	readRareIntegerData,
	readRareStringData,
	encodeBase64,
	isBrowserNodeQuery,
	isBrowserNodeVisible,
	isBrowserResultLimitError,
	matchesBrowserNode,
	settleBrowserTeardown,
	readBrowserFrames,
	readBrowserHeaders,
	readBrowserProfile,
	readBrowserWorld,
	readEvaluationResult,
	requireBrowserString,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BASE64_CHARS,
	boundBrowserText,
	requireBrowserReference,
	readBrowserToolString,
	renderBrowserElement,
	renderBrowserReceipt,
	isBrowserElementError,
} from '@src/core'
import { createRecorder, readProperty, requireValue, waitForCondition } from '@orkestrel/test'
import {
	BROWSER_RUN_FIXTURE,
	BROWSER_RUN_LISTING,
	BROWSER_RUN_VIEW,
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_JOURNEY_LISTING,
	BROWSER_JOURNEY_TEMPLATE_CASES,
	BROWSER_JOURNEY_EDIT_REFUSALS,
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_NAME_CASES,
	BROWSER_ELEMENT_NAME_AX_FIXTURE,
	createBrowserElementFixture,
	createBrowserViewDouble,
	replyOk,
	createDOMSnapshotResult,
	JPEG_BASE64,
	PNG_BASE64,
} from '../../setup.js'

describe('journey step helpers', () => {
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
		const toolset = new BrowserToolset(createBrowserViewDouble(), {
			source: { adopt: async () => [tool], emitter: new Emitter<BrowserToolSourceEventMap>() },
		})
		await toolset.start()
		try {
			const args = { basket: { items: ['kettle'], quantity: 1 } }
			const action = await performBrowserStep(toolset, 's1', {
				action: 'checkout',
				arguments: args,
				target: { role: 'button', name: 'irrelevant' },
			})
			expect(invoked.calls.map(([input]) => input)).toEqual([args])
			expect(action.arguments).toEqual(args)
			expect(action.outcome).toBe('done')
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
			const clicking = performBrowserStep(toolset, 's1', {
				action: 'click',
				arguments: {},
				target: { role: 'button', name: 'Place order' },
			})
			await waitForCondition('the helper input is pending', () => withheld.length === 1)
			fixture.transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Continue?' },
				'session-main',
			)
			expect(await clicking).toMatchObject({
				outcome: 'interrupted',
				receipt:
					'Clicked e4 button "Place order". A confirm dialog is open: "Continue?"; call dialog.',
			})
			const answered = await performBrowserStep(toolset, 's2', {
				action: 'dialog',
				arguments: { accept: true },
				target: { role: 'button', name: 'irrelevant' },
			})
			expect(answered.arguments).toEqual({ accept: true })
			expect(answered.outcome).toBe('done')
			fixture.transport.reply(requireValue(withheld[0]).id, {})
			expect(
				(await performBrowserStep(toolset, 's3', { action: 'press', arguments: { key: 'Escape' } }))
					.outcome,
			).toBe('done')
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})

	it('releases a hold after aborting its input and sends no suffix action', async () => {
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
			const typing = performBrowserStep(
				toolset,
				's1',
				{
					action: 'type',
					arguments: { text: 'Harbor' },
					target: { role: 'textbox', name: 'Email' },
				},
				{ signal: controller.signal, caller: hold.token },
			)
				.then(() =>
					performBrowserStep(toolset, 's2', { action: 'press', arguments: { key: 'Escape' } }),
				)
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
				(await toolset.perform({ id: 'after', name: 'press', arguments: { key: 'Escape' } })).action
					?.outcome,
			).toBe('done')
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('resolves a unique semantic target and refuses a missing target without sending input', async () => {
		const fixture = await createBrowserElementFixture()
		try {
			const target = await locateBrowserTarget(fixture.page, { role: 'textbox', name: 'Email' })
			expect(target.name).toBe('Email')
			expect(target.frame).toBe('main')
			await expect(
				locateBrowserTarget(fixture.page, { role: 'button', name: 'Add to cart' }, { id: 's3' }),
			).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_TARGET',
				message:
					'Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.',
			})
			expect(
				fixture.transport.sent.filter((message) => message.method.startsWith('Input.')),
			).toEqual([])
		} finally {
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
				performBrowserStep(toolset, 's3', { action: 'click', arguments: {}, target }),
			).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_AMBIGUOUS',
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
			const typed = await performBrowserStep(
				toolset,
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
			const pressed = await performBrowserStep(toolset, 's2', {
				action: 'press',
				target: { role: 'textbox', name: 'Email' },
				arguments: { key: 'Escape' },
			})
			expect(pressed.arguments).toEqual({ key: 'Escape' })
			const clicked = await performBrowserStep(toolset, 's3', {
				action: 'click',
				target: { role: 'button', name: 'Place order' },
				arguments: {},
			})
			expect(clicked.arguments).toEqual({ ref: 'e4' })
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
				performBrowserStep(toolset, 's3', {
					action: 'wait',
					target: { role: 'textbox', name: 'Email' },
					arguments: { text: 'Added to cart', timeout: 0.01 },
				}).then(() =>
					performBrowserStep(toolset, 's4', { action: 'click', arguments: { ref: 'e1' } }),
				),
			).rejects.toThrow('s3: "Added to cart" did not appear within 0.01 s.')
			expect(view.calls).toEqual(['wait Added to cart'])
			await expect(
				performBrowserStep(toolset, 's5', { action: 'missing', arguments: {} }),
			).rejects.toThrow('s5: tool not found: missing')
		} finally {
			await toolset.destroy()
		}
	})
})

describe('element helpers', () => {
	it.each(BROWSER_ELEMENT_NAME_CASES)('$title', ({ query, expected }) => {
		const rows = readBrowserAccessibility(BROWSER_ELEMENT_NAME_AX_FIXTURE).nodes.map((node) => ({
			...node,
			session: 'main',
			reference: undefined,
		}))
		expect(
			filterBrowserOutline(rows, query).map((node) => normalizeBrowserName(node.name ?? '')),
		).toEqual(expected)
	})

	it('catches helper alias, normalization, scope, and point composition errors', () => {
		expect(['enter', 'Return', 'ENTER', 'esc', 'ctrl+a'].map(normalizeBrowserKey)).toEqual([
			'Enter',
			'Enter',
			'Enter',
			'Escape',
			'Control+a',
		])
		expect(() => normalizeBrowserKey('unknown-key')).toThrow(
			'Accepted names: Backspace, Tab, Enter',
		)
		expect(normalizeBrowserName('  Save\n draft  ')).toBe('Save draft')
		expect(
			composeBrowserPoint({ x: 2, y: 3 }, [
				{ x: 10, y: 20 },
				{ x: 100, y: 200 },
			]),
		).toEqual({ x: 112, y: 223 })
		expect(() => composeBrowserPoint({ x: Number.NaN, y: 0 }, [])).toThrow(
			'coordinates must be finite',
		)
		const rows = readBrowserAccessibility(BROWSER_ELEMENT_AX_FIXTURE).nodes.map((node) => ({
			...node,
			session: 'main',
			reference: node.id === 'order' ? 'e1' : undefined,
		}))
		expect(
			filterBrowserOutline(rows, { role: 'button', name: 'order' }).map((node) => node.id),
		).toEqual(['order'])
		expect(renderBrowserOutline('url', 'title', rows, 0)).toMatchObject({ count: 0, total: 1 })
	})
})

describe('WebMCP adoption helpers', () => {
	it('renders an ordinary array as JSON rather than treating it as MCP content', () => {
		expect(renderBrowserToolOutput([1, 2])).toBe('[1,2]')
	})

	it('renders strings, content arrays, and bounded record output', () => {
		expect(renderBrowserToolOutput('result')).toBe('result')
		expect(
			renderBrowserToolOutput([
				{ type: 'text', text: 'first' },
				{ type: 'image', data: 'ignored' },
				{ type: 'text', text: 'second' },
			]),
		).toBe('first\nsecond')
		expect(renderBrowserToolOutput({ found: true })).toBe('{"found":true}')
		expect(renderBrowserToolOutput({ text: 'x'.repeat(1024 * 1024) })).toHaveLength(
			BROWSER_REGISTRY_OUTPUT_LIMIT,
		)
		expect(renderBrowserToolOutput(undefined)).toBe('undefined')
		const cycle: Record<string, unknown> = {}
		cycle['self'] = cycle
		expect(renderBrowserToolOutput(cycle)).toBe('[Unserializable tool output]')
	})

	it('adds a synthetic required what without mutating the authored schema', () => {
		expect(deriveBrowserToolSchema(undefined)?.['required']).toEqual(['what'])
		const schema = { type: 'object', properties: { query: { type: 'string' } }, required: [] }
		const result = deriveBrowserToolSchema(schema)
		expect(result?.['required']).toEqual(['what'])
		expect(result?.['properties']).toHaveProperty('query')
		expect(result?.['properties']).toHaveProperty('what')
		expect(schema.required).toEqual([])
		expect(schema.properties).not.toHaveProperty('what')
	})

	it('retains required parameters and refuses an optional authored what', () => {
		const schema = { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] }
		expect(deriveBrowserToolSchema(schema)).toBe(schema)
		expect(
			deriveBrowserToolSchema({ type: 'object', properties: { what: { type: 'string' } } }),
		).toBeUndefined()
		expect(
			deriveBrowserToolSchema({
				type: 'object',
				properties: { what: { type: 'string' } },
				required: ['query'],
			}),
		).toBeUndefined()
	})
})

describe('toolset helpers', () => {
	it('catches a bound that cuts a string within the limit, keeps more than the limit, splits a surrogate pair, or drops the footer it is given', () => {
		const footer = "the rest was cut; call read for the page's text"
		expect(boundBrowserText('abc', 3, footer)).toBe('abc')
		expect(boundBrowserText('abcdef', 4, footer)).toBe(
			"abcd\n[characters 0–4 of 6; the rest was cut; call read for the page's text]",
		)
		expect(boundBrowserText('abcdef', 4, 'the rest was cut')).toBe(
			'abcd\n[characters 0–4 of 6; the rest was cut]',
		)
		expect(boundBrowserText('ab\u{1F600}cd', 3, 'the rest was cut')).toBe(
			'ab\n[characters 0–2 of 6; the rest was cut]',
		)
		expect(boundBrowserText('\u{1F600}\u{1F600}', 1, 'the rest was cut')).toBe(
			'\n[characters 0–0 of 4; the rest was cut]',
		)
		for (const limit of [0, -1, 1.5, Number.NaN])
			expect(() => boundBrowserText('abc', limit, footer)).toThrow(
				'Browser tool limit must be a positive integer',
			)
	})

	it('catches a receipt that drops the status, the dialog article, or the blank line before the view', () => {
		expect(renderBrowserReceipt({ action: 'Clicked e4 button "Place order"', view: 'page' })).toBe(
			'Clicked e4 button "Place order".\n\npage',
		)
		expect(
			renderBrowserReceipt({
				action: 'Clicked e3 link "Next"',
				status: 'the page is still loading https://example.test/next',
			}),
		).toBe('Clicked e3 link "Next"; the page is still loading https://example.test/next.')
		expect(
			renderBrowserReceipt({
				action: 'Clicked e7 button "Delete"',
				dialog: { category: 'confirm', message: 'Delete the draft?' },
			}),
		).toBe(
			'Clicked e7 button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.',
		)
		expect(
			renderBrowserReceipt({ action: '', dialog: { category: 'alert', message: 'Line\n"two"' } }),
		).toBe('An alert dialog is open: "Line\\n\\"two\\""; call dialog.')
		expect(renderBrowserReceipt({ action: '', view: 'page' })).toBe('page')
	})

	it('catches an untrusted click or type receipt without its marker, or a trusted one with it', () => {
		for (const [action, status, line] of [
			['Clicked e1 button "Save"', undefined, 'Clicked e1 button "Save".'],
			['Typed "sam" into e2 textbox "Email"', undefined, 'Typed "sam" into e2 textbox "Email".'],
			[
				'Typed "sam" into e2 textbox "Email" and submitted the form',
				undefined,
				'Typed "sam" into e2 textbox "Email" and submitted the form.',
			],
			[
				'Selected "Large" in e3 combobox "Size" (programmatic)',
				undefined,
				'Selected "Large" in e3 combobox "Size" (programmatic).',
			],
			[
				'Clicked e3 link "Next"',
				'the page is still loading https://example.test/next',
				'Clicked e3 link "Next"; the page is still loading https://example.test/next.',
			],
		] as const) {
			expect(
				renderBrowserReceipt({
					action,
					...(status === undefined ? {} : { status }),
					trusted: false,
					view: 'page',
				}),
			).toBe(`${line} (untrusted event)\n\npage`)
			expect(
				renderBrowserReceipt({
					action,
					...(status === undefined ? {} : { status }),
					trusted: true,
					view: 'page',
				}),
			).toBe(`${line}\n\npage`)
			expect(
				renderBrowserReceipt({ action, ...(status === undefined ? {} : { status }), view: 'page' }),
			).toBe(`${line}\n\npage`)
		}
	})

	it('catches an element rendering that differs from its outline row', async () => {
		const { client, page } = await createBrowserElementFixture()
		try {
			const outline = await page.elements.outline()
			const rows = outline.text.split('\n')
			for (const reference of ['e1', 'e2', 'e4']) {
				const rendered = renderBrowserElement(requireValue(page.elements.element(reference)))
				expect(rows.some((row) => row.startsWith(rendered))).toBe(true)
			}
			expect(renderBrowserElement(requireValue(page.elements.element('e1')))).toBe('e1 link "Home"')
		} finally {
			await client.close()
		}
	})

	it('catches a reference reader that accepts a non-reference or names no next call', () => {
		for (const value of ['e12', 'E12', '12', '[e12]', 'ref=e12', '[ref=e12]'])
			expect(requireBrowserReference(value)).toBe('e12')
		for (const value of ['x12', 'e0', '', 12, undefined]) {
			const outcome = attempt(() => requireBrowserReference(value))
			expect(outcome.success).toBe(false)
			const error = readProperty(outcome, 'error')
			expect(isBrowserElementError(error)).toBe(true)
			expect(String(error)).toContain('is not a reference such as e12; call look')
		}
	})

	it('catches a string reader that accepts a non-string', () => {
		expect(readBrowserToolString({ url: 'https://example.test/' }, 'url')).toBe(
			'https://example.test/',
		)
		for (const args of [{}, { url: 1 }, { url: undefined }])
			expect(() => readBrowserToolString(args, 'url')).toThrow(
				'The url parameter must be a string.',
			)
	})
})

describe('decodeBase64', () => {
	it('decodes a small literal to its exact bytes', () => {
		expect(decodeBase64('AQID')).toEqual(new Uint8Array([1, 2, 3]))
	})

	it('decodes the documented example', () => {
		expect(decodeBase64('aGVsbG8=')).toEqual(new Uint8Array([104, 101, 108, 108, 111]))
	})

	it('returns an empty array for an empty string', () => {
		expect(decodeBase64('')).toEqual(new Uint8Array([]))
	})

	it('decodes padded and unpadded forms identically', () => {
		expect(decodeBase64('AQID')).toEqual(decodeBase64('AQID=='))
	})

	it('ignores whitespace interspersed in the input', () => {
		expect(decodeBase64('AQ ID\n')).toEqual(new Uint8Array([1, 2, 3]))
	})

	it('skips invalid characters rather than throwing', () => {
		expect(decodeBase64('AQ!ID')).toEqual(new Uint8Array([1, 2, 3]))
	})

	it('decodes the PNG fixture to its documented signature-prefixed bytes', () => {
		expect(decodeBase64(PNG_BASE64)).toEqual(new Uint8Array([137, 80, 78, 71, 13]))
	})

	it('decodes the JPEG fixture to its documented signature-prefixed bytes', () => {
		expect(decodeBase64(JPEG_BASE64)).toEqual(new Uint8Array([255, 216, 255, 224]))
	})

	// decodeBase64 reads BASE64_LOOKUP and encodeBase64 reads BASE64_CHARS, so decoding the whole
	// alphabet and re-encoding it fails on any single character where the two disagree.
	it('agrees with encodeBase64 across every character of the alphabet', () => {
		expect(encodeBase64(decodeBase64(BASE64_CHARS))).toBe(BASE64_CHARS)
	})
})

describe('frame helpers', () => {
	it('decodes a frame tree depth-first and normalizes absent metadata', () => {
		expect(
			readBrowserFrames({
				frameTree: {
					frame: { id: 'main', url: 'https://example.com' },
					childFrames: [
						{
							frame: {
								id: 'first',
								parentId: 'main',
								name: 'checkout',
								url: 'https://example.com/checkout',
							},
							childFrames: [
								{
									frame: {
										id: 'nested',
										parentId: 'first',
										name: '',
										url: 'about:blank',
									},
								},
							],
						},
						{ frame: { id: 'second', parentId: 'main', url: 'about:blank' } },
					],
				},
			}),
		).toEqual([
			{ id: 'main', parent: undefined, name: undefined, url: 'https://example.com' },
			{
				id: 'first',
				parent: 'main',
				name: 'checkout',
				url: 'https://example.com/checkout',
			},
			{ id: 'nested', parent: 'first', name: undefined, url: 'about:blank' },
			{ id: 'second', parent: 'main', name: undefined, url: 'about:blank' },
		])
	})

	it('appends attached iframe targets the tree does not list and skips one it lists', () => {
		const listed = { id: 'main', parent: undefined, name: undefined, url: 'https://example.com' }
		const target = {
			id: 'oopif-1',
			parent: undefined,
			name: undefined,
			url: 'https://other.example',
		}

		expect(
			readBrowserFrames({ frameTree: { frame: { id: 'main', url: 'https://example.com' } } }, [
				listed,
				target,
			]),
		).toEqual([listed, target])
		expect(readBrowserFrames(undefined, [target])).toEqual([target])
	})

	it('returns no frames for malformed trees and skips malformed children', () => {
		expect(readBrowserFrames(undefined)).toEqual([])
		expect(readBrowserFrames({ frameTree: [] })).toEqual([])
		expect(
			readBrowserFrames({
				frameTree: {
					frame: { id: 1, url: false },
					childFrames: [null, { frame: { id: 'valid', url: 'about:blank' } }],
				},
			}),
		).toEqual([{ id: 'valid', parent: undefined, name: undefined, url: 'about:blank' }])
	})
})

describe('contract-backed protocol decoding', () => {
	it('accepts only strings and finite numbers in header records', () => {
		expect(
			readBrowserHeaders({
				string: 'value',
				number: 42,
				infinite: Number.POSITIVE_INFINITY,
				nan: Number.NaN,
				boolean: true,
			}),
		).toEqual({ string: 'value', number: '42' })
	})

	it('keeps validated CPU profile arrays precisely numeric', () => {
		expect(
			readBrowserProfile({
				profile: {
					startTime: 1,
					endTime: 2,
					nodes: [
						{
							id: 1,
							callFrame: {
								functionName: 'work',
								scriptId: '1',
								url: 'https://example.com/app.js',
								lineNumber: 0,
								columnNumber: 0,
							},
							children: [2],
						},
					],
					samples: [1],
					timeDeltas: [0.5],
				},
			}),
		).toMatchObject({
			samples: [1],
			deltas: [0.5],
			nodes: [{ children: [2] }],
		})
	})

	it('rejects non-finite and non-integer CPU profile arrays', () => {
		const frame = {
			functionName: 'work',
			scriptId: '1',
			url: '',
			lineNumber: 0,
			columnNumber: 0,
		}

		expect(() =>
			readBrowserProfile({
				profile: {
					startTime: 1,
					endTime: 2,
					nodes: [{ id: 1, callFrame: frame, children: [1.5] }],
				},
			}),
		).toThrow('Browser CPU profile node is malformed')
		expect(() =>
			readBrowserProfile({
				profile: {
					startTime: 1,
					endTime: 2,
					nodes: [{ id: 1, callFrame: frame }],
					timeDeltas: [Number.POSITIVE_INFINITY],
				},
			}),
		).toThrow('Browser CPU profile deltas are malformed')
	})
})

describe('evaluation result helpers', () => {
	it('returns the by-value result and permits an explicit undefined value', () => {
		expect(readEvaluationResult({ result: { value: { ok: true } } })).toEqual({ ok: true })
		expect(readEvaluationResult({ result: {} })).toBeUndefined()
	})

	it('maps the result-limit sentinel to BrowserResultLimitError', () => {
		const result = attempt(() =>
			readEvaluationResult({
				exceptionDetails: {
					exception: {
						description: `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}1234`,
					},
				},
			}),
		)

		expect(result.success).toBe(false)
		if (result.success) return
		expect(isBrowserResultLimitError(result.error)).toBe(true)
		expect(
			isBrowserResultLimitError(result.error) ? result.error.context : undefined,
		).toMatchObject({
			length: 1234,
		})
	})

	it('rejects malformed and exceptional evaluation results', () => {
		expect(readEvaluationResult(undefined)).toBeUndefined()
		expect(() => readEvaluationResult({ exceptionDetails: { text: 'Evaluation failed' } })).toThrow(
			'JavaScript evaluation failed',
		)
	})

	it('requires string-shaped browser values', () => {
		expect(requireBrowserString('title', 'Document title')).toBe('title')
		expect(() => requireBrowserString(42, 'Document title')).toThrow(
			'Document title failed: no string value returned',
		)
	})
})

describe('readBrowserWorld', () => {
	it('returns the execution context id of a created isolated world', () => {
		expect(readBrowserWorld({ executionContextId: 42 }, 'frame-1')).toBe(42)
	})

	it.each([undefined, {}, { executionContextId: '42' }, { executionContextId: 4.2 }])(
		'throws a browser error naming the frame for the malformed reply %j',
		(reply) => {
			const result = attempt(() => readBrowserWorld(reply, 'frame-1'))

			expect(result.success).toBe(false)
			if (result.success) return
			expect(result.error).toBeInstanceOf(BrowserError)
			expect(result.error instanceof BrowserError ? result.error.context : undefined).toEqual({
				frame: 'frame-1',
			})
		},
	)
})

describe('extractBrowserSlice', () => {
	it('returns the whole text from offset 0 when no bound is given', () => {
		expect(extractBrowserSlice('alpha\nbeta')).toEqual({
			text: 'alpha\nbeta',
			offset: 0,
			total: 10,
		})
	})

	it('ends a bounded slice after the last line break inside its window', () => {
		expect(extractBrowserSlice('alpha\nbeta\ngamma', 0, 12)).toEqual({
			text: 'alpha\nbeta\n',
			offset: 0,
			total: 16,
		})
	})

	it('hard-cuts at the limit when no line break lies past the offset', () => {
		expect(extractBrowserSlice('abcdefgh', 0, 3)).toEqual({ text: 'abc', offset: 0, total: 8 })
		expect(extractBrowserSlice('\nabcdef', 0, 3)).toEqual({ text: '\nab', offset: 0, total: 7 })
	})

	it('returns the rest of the text when the window reaches its end', () => {
		expect(extractBrowserSlice('alpha\nbeta\ngamma', 11, 12)).toEqual({
			text: 'gamma',
			offset: 11,
			total: 16,
		})
	})

	it('returns an empty slice at or past the end of the text', () => {
		expect(extractBrowserSlice('alpha', 5, 3)).toEqual({ text: '', offset: 5, total: 5 })
		expect(extractBrowserSlice('alpha', 9)).toEqual({ text: '', offset: 9, total: 5 })
		expect(extractBrowserSlice('', 0, 4)).toEqual({ text: '', offset: 0, total: 0 })
	})

	it('keeps a surrogate pair whole at a hard cut, returning nothing at a limit of 1', () => {
		const faces = '\u{1F600}\u{1F600}'

		expect(extractBrowserSlice(faces, 0, 3).text).toBe('\u{1F600}')
		expect(extractBrowserSlice(faces, 0, 2).text).toBe('\u{1F600}')
		expect(extractBrowserSlice(faces, 0, 1)).toEqual({ text: '', offset: 0, total: 4 })
		expect(extractBrowserSlice(faces, 2, 1)).toEqual({ text: '', offset: 2, total: 4 })
	})

	it('keeps an unpaired high surrogate at a hard cut', () => {
		expect(extractBrowserSlice('a\uD800bc', 0, 2).text).toBe('a\uD800')
	})

	it('concatenates successive slices back into the text, each within the limit', () => {
		const source = ['a'.repeat(7), 'b'.repeat(2), 'c'.repeat(11), '', 'd'.repeat(3)].join('\n')
		const parts: string[] = []
		let offset = 0
		while (offset < source.length) {
			const slice = extractBrowserSlice(source, offset, 5)
			expect(slice.text.length).toBeGreaterThan(0)
			expect(slice.text.length).toBeLessThanOrEqual(5)
			expect(slice.total).toBe(source.length)
			parts.push(slice.text)
			offset += slice.text.length
		}

		expect(parts.join('')).toBe(source)
		expect(parts).toEqual(['aaaaa', 'aa\n', 'bb\n', 'ccccc', 'ccccc', 'c\n\n', 'ddd'])
	})

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'throws a browser error for the offset %s',
		(offset) => {
			expect(() => extractBrowserSlice('alpha', offset)).toThrow(BrowserError)
		},
	)

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'throws a browser error for the limit %s',
		(limit) => {
			expect(() => extractBrowserSlice('alpha', 0, limit)).toThrow(BrowserError)
		},
	)
})

describe('snapshot decoders', () => {
	it('reads flattened attributes into a frozen record', () => {
		const attributes = readBrowserAttributes([0, 1, 2, 3], ['id', 'hero', 'role', 'main'])
		expect(attributes).toEqual({ id: 'hero', role: 'main' })
		expect(Object.isFrozen(attributes)).toBe(true)
	})

	it('decodes sparse string, boolean, and integer records defensively', () => {
		expect([...readRareStringData({ index: [2, 4], value: [0, 1] }, ['open', 'closed'])]).toEqual([
			[2, 'open'],
			[4, 'closed'],
		])
		expect([...readRareBooleanData({ index: [1, 3] })]).toEqual([1, 3])
		expect([...readRareIntegerData({ index: [5], value: [9] })]).toEqual([[5, 9]])
		expect([...readRareStringData({ index: 'invalid' }, [])]).toEqual([])
		expect([...readRareBooleanData(undefined)]).toEqual([])
		expect([...readRareIntegerData({ index: [], value: 'invalid' })]).toEqual([])
	})

	it('decodes documents, sparse node state, iframe links, and requested layout data', () => {
		const snapshot = readBrowserSnapshot(createDOMSnapshotResult(), ['color'])

		expect(snapshot.styles).toEqual(['color'])
		expect(snapshot.documents).toHaveLength(2)
		expect(snapshot.documents[0]).toMatchObject({
			index: 0,
			frame: 'frame-main',
			url: 'https://example.com/',
			title: 'Main',
			scroll: [12, 34],
			width: 1200,
			height: 2400,
		})
		const node = snapshot.documents[0]?.nodes[3]
		expect(node).toMatchObject({
			document: 0,
			frame: 'frame-main',
			index: 3,
			id: 103,
			parent: 2,
			category: 1,
			name: 'DIV',
			attributes: { id: 'hero' },
			text: 'Hello world',
			clickable: true,
			shadow: 'open',
		})
		expect(node?.layout).toEqual({
			bounds: [10, 20, 300, 100],
			styles: { color: 'rgb(1, 2, 3)' },
			text: 'Hello world',
			paint: 2,
			offset: [10, 20, 300, 100],
			scroll: [0, 0, 300, 100],
			client: [10, 20, 300, 100],
		})
		expect(snapshot.documents[0]?.nodes[5]).toMatchObject({
			input: 'typed',
			checked: true,
			clickable: true,
		})
		expect(snapshot.documents[0]?.nodes[6]).toMatchObject({
			content: 1,
			source: 'https://example.com/child',
			origin: 'https://example.com/',
		})
	})

	it('decodes Chromium negative-one title indexes as an empty document title', () => {
		const snapshot = readBrowserSnapshot({
			strings: ['frame-main', 'https://example.com/', '#document', ''],
			documents: [
				{
					frameId: 0,
					documentURL: 1,
					title: -1,
					nodes: {
						parentIndex: [-1],
						nodeType: [9],
						nodeName: [2],
						nodeValue: [-1],
						backendNodeId: [1],
						attributes: [[]],
					},
				},
			],
		})

		expect(snapshot.documents[0]?.title).toBe('')
		expect(snapshot.documents[0]?.nodes[0]?.value).toBe('')
	})

	it('rejects invalid limits and enforces the aggregate node limit', () => {
		expect(() => readBrowserSnapshot(createDOMSnapshotResult(), [], -1)).toThrow(
			'Browser snapshot limit must be a non-negative integer',
		)
		expect(() => readBrowserSnapshot(createDOMSnapshotResult(), [], 8)).toThrow(
			BrowserResultLimitError,
		)
		expect(() => readBrowserSnapshot(createDOMSnapshotResult(), [], 9)).not.toThrow()
	})

	it('rejects malformed top-level, string-table, document, metadata, and node data', () => {
		expect(() => readBrowserSnapshot(undefined)).toThrow(
			'Malformed DOMSnapshot.captureSnapshot result',
		)
		expect(() => readBrowserSnapshot({ strings: [42], documents: [] })).toThrow(
			'Malformed DOMSnapshot string table',
		)
		expect(() => readBrowserSnapshot({ strings: [], documents: [null] })).toThrow(
			'Malformed DOM snapshot document',
		)
		expect(() =>
			readBrowserSnapshot({
				strings: [],
				documents: [{ frameId: 0, documentURL: 0, title: 0, nodes: {} }],
			}),
		).toThrow('Malformed DOM snapshot document metadata')
		expect(() =>
			readBrowserSnapshot({
				strings: ['frame', 'url', 'title'],
				documents: [{ frameId: 0, documentURL: 1, title: 2, nodes: {} }],
			}),
		).toThrow('Malformed DOM snapshot node table')
		expect(() =>
			readBrowserSnapshot({
				strings: ['frame', 'url', 'title', 'DIV', ''],
				documents: [
					{
						frameId: 0,
						documentURL: 1,
						title: 2,
						nodes: { nodeType: [1], nodeName: [], nodeValue: [4] },
					},
				],
			}),
		).toThrow('Malformed DOM snapshot node')
	})
})

describe('snapshot node helpers', () => {
	it('distinguishes declarative queries from predicate functions', () => {
		expect(isBrowserNodeQuery({ name: 'main' })).toBe(true)
		expect(isBrowserNodeQuery(() => true)).toBe(false)
	})

	it('matches names, text, frames, attributes, clickability, and visibility together', () => {
		const snapshot = readBrowserSnapshot(createDOMSnapshotResult(), ['color'])
		const node = snapshot.documents[0]?.nodes[3]
		const text = snapshot.documents[0]?.nodes[4]
		if (node === undefined || text === undefined) throw new Error('Snapshot fixture is malformed')

		expect(
			matchesBrowserNode(node, {
				name: 'div',
				text: 'world',
				attributes: { id: 'hero' },
				frame: 'frame-main',
				clickable: true,
				visible: true,
			}),
		).toBe(true)
		expect(matchesBrowserNode(node, { attributes: { role: 'button' } })).toBe(false)
		expect(matchesBrowserNode(node, { frame: 'frame-child' })).toBe(false)
		expect(isBrowserNodeVisible(node)).toBe(true)
		expect(isBrowserNodeVisible(text)).toBe(false)
		expect(node.attributes['id']).toBe('hero')
		expect(node.attributes['missing']).toBeUndefined()
	})
})

describe('settleBrowserTeardown', () => {
	it('returns undefined when every step settles', async () => {
		const ran: string[] = []

		const failure = await settleBrowserTeardown(
			async () => {
				ran.push('first')
			},
			async () => {
				ran.push('second')
			},
		)

		expect(failure).toBeUndefined()
		expect(ran).toEqual(['first', 'second'])
	})

	it('runs every later step after one fails and returns the first failure', async () => {
		const ran: string[] = []

		const failure = await settleBrowserTeardown(
			async () => {
				ran.push('first')
				throw new Error('first failed')
			},
			async () => {
				ran.push('second')
				throw new Error('second failed')
			},
			async () => {
				ran.push('third')
			},
		)

		expect(ran).toEqual(['first', 'second', 'third'])
		expect(failure).toBeInstanceOf(Error)
		expect(String(failure)).toContain('first failed')
	})

	it('returns undefined for no steps at all', async () => {
		expect(await settleBrowserTeardown()).toBeUndefined()
	})

	it('keeps a thrown undefined as the first failure rather than a later one', async () => {
		const ran: string[] = []
		const failure = await settleBrowserTeardown(
			async () => {
				ran.push('first')
				throw undefined
			},
			async () => {
				ran.push('second')
				throw new Error('second failed')
			},
		)

		expect(ran).toEqual(['first', 'second'])
		expect(failure).toBeUndefined()
	})

	it('keeps a thrown null as the first failure rather than a later one', async () => {
		const ran: string[] = []
		const failure = await settleBrowserTeardown(
			async () => {
				ran.push('first')
				throw null
			},
			async () => {
				ran.push('second')
				throw new Error('second failed')
			},
		)

		expect(ran).toEqual(['first', 'second'])
		expect(failure).toBeNull()
	})
})

describe('journey editing and rendering', () => {
	it('never reuses an id after removal', () => {
		const removed = editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [{ operation: 'remove', id: 's5' }])
		const added = editBrowserJourney(removed, [
			{ operation: 'add', step: { action: 'wait', arguments: { text: 'Saved' } } },
		])
		expect(added.steps.at(-1)?.id).toBe('s6')
		expect(added.next).toBe(7)
	})
	it('refuses a lone unbound declare', () => {
		expect(
			attempt(() =>
				editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
					{ operation: 'declare', name: 'unused', parameter: {} },
				]),
			),
		).toMatchObject({
			success: false,
			error: {
				code: 'BROWSER_JOURNEY_EDIT',
				message: 'Edit 1 is refused: it declares "unused" but no step binds it',
				context: { index: 1, reason: 'declares "unused" but no step binds it' },
			},
		})
	})
	it('applies anchors in order and merges argument updates', () => {
		const journey = editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
			{ operation: 'add', before: 's2', step: { action: 'wait', arguments: { text: 'Ready' } } },
			{ operation: 'add', after: 's6', step: { action: 'press', arguments: { key: 'Enter' } } },
			{
				operation: 'update',
				id: 's4',
				arguments: { text: 'Ada' },
				target: { role: 'textbox', name: 'Name' },
			},
		])
		expect(journey.steps.map((step) => step.id)).toEqual(['s1', 's6', 's7', 's2', 's3', 's4', 's5'])
		expect(journey.steps.find((step) => step.id === 's4')).toMatchObject({
			arguments: { text: 'Ada', submit: true },
			target: { role: 'textbox', name: 'Name' },
		})
		expect(journey.parameters).toEqual({})
	})
	it('checks cross-step bindings only after the batch', () => {
		const journey = editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
			{ operation: 'update', id: 's4', arguments: { text: { parameter: 'name' } } },
			{ operation: 'declare', name: 'name', parameter: { default: 'Ada' } },
		])
		expect(journey.parameters).toEqual({ name: { default: 'Ada' } })
		expect(BROWSER_JOURNEY_FIXTURE.parameters).toEqual({ email: { default: 'sam@example.test' } })
	})
	it('updates portable tabs', () => {
		const journey = editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
			{
				operation: 'add',
				step: {
					action: 'switch',
					arguments: {},
					tab: { title: 'Cart', url: 'https://example.test/cart' },
				},
			},
			{
				operation: 'update',
				id: 's6',
				tab: { title: 'Checkout', url: 'https://example.test/checkout' },
			},
		])
		expect(journey.steps.at(-1)?.tab?.title).toBe('Checkout')
	})
	it.each(BROWSER_JOURNEY_EDIT_REFUSALS)('refuses $name atomically', ({ edit }) => {
		const before = JSON.stringify(BROWSER_JOURNEY_FIXTURE)
		const result = attempt(() =>
			Reflect.apply(editBrowserJourney, undefined, [
				BROWSER_JOURNEY_FIXTURE,
				[{ operation: 'remove', id: 's1' }, edit],
			]),
		)
		expect(result).toMatchObject({
			success: false,
			error: {
				code: 'BROWSER_JOURNEY_EDIT',
				message: expect.stringMatching(/^Edit 2 is refused: it [^\n]+[^.]$/),
			},
		})
		expect(JSON.stringify(BROWSER_JOURNEY_FIXTURE)).toBe(before)
	})
	it('renders the listing fence byte for byte', () => {
		expect(renderBrowserJourney(BROWSER_JOURNEY_FIXTURE)).toBe(BROWSER_JOURNEY_LISTING)
	})
	it.each(BROWSER_JOURNEY_TEMPLATE_CASES)(
		'renders $line and its trigger',
		({ step, line, trigger }) => {
			const journey = { ...BROWSER_JOURNEY_FIXTURE, parameters: {}, steps: [step] }
			expect(renderBrowserJourney(journey)).toBe(
				`add-kettle "Add the Alpine Kettle to the cart"\n${line}`,
			)
			expect(deriveBrowserJourneyTrigger(step)).toBe(trigger)
		},
	)
	it('renders secret marks and bound target names', () => {
		const journey = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: { password: { secret: true }, field: { default: 'Password' } },
			steps: [
				{
					id: 's1',
					action: 'type',
					arguments: { text: { parameter: 'password' } },
					target: { role: 'textbox', name: { parameter: 'field' } },
				},
			],
		}
		expect(renderBrowserJourney(journey)).toBe(
			'add-kettle "Add the Alpine Kettle to the cart" (parameters: password (secret), field)\ns1 type (secret) as password into textbox "Password" as field',
		)
		expect(collectBrowserJourneyBindings(journey.steps)).toEqual(
			new Map([
				['password', ['type.text']],
				['field', ['type.target.name']],
			]),
		)
		expect(
			deriveBrowserJourneyTrigger(
				journey.steps[0] ?? BROWSER_JOURNEY_FIXTURE.steps[0] ?? { action: 'type', arguments: {} },
				{ field: 'PIN' },
			),
		).toBe('PIN')
	})
	it('resolves bindings and refuses missing inputs', () => {
		expect(resolveBrowserJourneyBinding('literal', {})).toBe('literal')
		expect(resolveBrowserJourneyBinding({ parameter: 'email' }, { email: 'Ada' })).toBe('Ada')
		expect(() => resolveBrowserJourneyBinding({ parameter: 'email' }, {})).toThrow(Error)
	})
	it('derives secret names and unused fallbacks', () => {
		expect(deriveBrowserJourneySecret('Confirm Password')).toBe('confirmPassword')
		expect(deriveBrowserJourneySecret('confirmPassword')).toBe('confirmPassword')
		expect(deriveBrowserJourneySecret('PIN code')).toBe('pinCode')
		expect(deriveBrowserJourneySecret('123')).toBe('secret1')
		expect(deriveBrowserJourneySecret('Pässword')).toBe('secret1')
		expect(deriveBrowserJourneySecret('', ['secret1', 'secret2'])).toBe('secret3')
		expect(deriveBrowserJourneySecret('Password', ['password'])).toBe('secret1')
	})
	it('generates a timestamped run id with four hexadecimal digits', () => {
		const before = Date.now()
		const id = generateBrowserRunId()
		expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9]{4}$/)
		const timestamp = Date.parse(id.slice(0, -5).replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
		expect(timestamp).toBeGreaterThanOrEqual(before)
		expect(timestamp).toBeLessThanOrEqual(Date.now())
	})
})

describe('run rendering', () => {
	it('renders the run fence byte for byte with a blank line before the view', () => {
		expect(renderBrowserRun(BROWSER_RUN_FIXTURE, BROWSER_RUN_VIEW)).toBe(BROWSER_RUN_LISTING)
	})
	it('strips a directive from a run step line', () => {
		const run = {
			...BROWSER_RUN_FIXTURE,
			outcome: 'stopped' as const,
			steps: [
				...BROWSER_RUN_FIXTURE.steps.slice(0, 2),
				{
					...BROWSER_RUN_FIXTURE.steps[2],
					id: 's3',
					action: 'click',
					arguments: {},
					trigger: 'Add to cart',
					elapsed: 0,
					outcome: 'refused' as const,
					result:
						'Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.',
				},
			],
		}
		expect(renderBrowserRun(run))
			.toBe(`Replay of add-kettle stopped at s3 of 5: Step s3 names button "Add to cart", which no element carries.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".
s3 Step s3 names button "Add to cart", which no element carries.`)
	})
	it('keeps directive-like quoted text and strips appended receipt views', () => {
		expect(
			renderBrowserRunResult(
				'Typed "text; call save" into e1 textbox "Note"; call look.\n\npage "Notes"',
			),
		).toBe('Typed "text; call save" into e1 textbox "Note".')
		expect(renderBrowserRunResult('Clicked button "Say \\"hi; call save\\""; call look.')).toBe(
			'Clicked button "Say \\"hi; call save\\"".',
		)
	})
	it('renders aborts at the pending step and before any step', () => {
		expect(
			renderBrowserRun({
				...BROWSER_RUN_FIXTURE,
				outcome: 'aborted',
				steps: BROWSER_RUN_FIXTURE.steps.slice(0, 2),
			}).split('\n')[0],
		).toBe('Replay of add-kettle aborted at s3 of 5.')
		expect(renderBrowserRun({ ...BROWSER_RUN_FIXTURE, outcome: 'aborted', steps: [] })).toBe(
			'Replay of add-kettle aborted at s1 of 5.',
		)
	})
})
