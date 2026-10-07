import {
	BROWSER_READ_WIDTH,
	BROWSER_TOOL_LIMIT,
	wrapBrowserLine,
	renderBrowserPassage,
	renderBrowserFooter,
	validateBrowserLines,
	redactBrowserText,
	BROWSER_TOOL_COPY,
	renderBrowserReceiptWindow,
	renderBrowserWindow,
	renderBrowserSearch,
	abbreviateBrowserText,
} from '@src/core'
import type { BrowserLine, BrowserPassage } from '@src/core'
import { BrowserPage } from '../../../src/core/BrowserPage.js'
import { readBrowserStreamChunk } from '@src/core'
import { BROWSER_BASE64_REFUSALS } from '../../setup.js'
import { validateBrowserPageOpen, validateBrowserJourneyWriteOptions } from '@src/core'
import { createConnectedCDPClient, replyOk } from '../../setup.js'
import { scanBrowserLines, describeBrowserRefusal, isBrowserError } from '@src/core'
import { renderBrowserLine } from '@src/core'
/**
 * src/core/helpers.ts tests.
 */

import { describe, it, expect } from 'vitest'
import { attempt } from '@orkestrel/contract'
import {
	buildBrowserJourney,
	renderBrowserRun,
	renderBrowserRunResult,
	collectBrowserJourneyBindings,
	collectBrowserJourneyTextBindings,
	editBrowserJourney,
	validateBrowserJourneyStep,
	renderBrowserJourney,
	renderBrowserJourneyFault,
	normalizeBrowserJourneyReason,
	validateBrowserJourneyName,
	validateBrowserStorePage,
	deriveBrowserJourneyTrigger,
	deriveBrowserJourneySecret,
	generateBrowserRunId,
	resolveBrowserJourneyBinding,
	composeBrowserPoint,
	filterBrowserOutline,
	collectBrowserWords,
	normalizeBrowserKey,
	normalizeBrowserName,
	readBrowserAccessibility,
	renderBrowserOutline,
	renderBrowserOutlineRow,
	BrowserError,
	renderBrowserToolOutput,
	deriveBrowserToolSchema,
	BROWSER_REGISTRY_OUTPUT_LIMIT,
	extractBrowserSlice,
	readBrowserAttributes,
	readBrowserSnapshot,
	readRareBooleanData,
	readRareIntegerData,
	readRareStringData,
	isBrowserNodeQuery,
	isBrowserNodeVisible,
	matchesBrowserNode,
	settleBrowserTeardown,
	readBrowserFrames,
	readBrowserHeaders,
	readBrowserProfile,
	readBrowserWorld,
	readEvaluationResult,
	requireBrowserString,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	boundBrowserText,
	requireBrowserReference,
	readBrowserToolString,
	renderBrowserElement,
	renderBrowserReceipt,
} from '@src/core'
import { readProperty, requireValue } from '@orkestrel/test'
import {
	BROWSER_RUN_FIXTURE,
	BROWSER_RUN_LISTING,
	BROWSER_RUN_VIEW,
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_STORE_FAULT_FIXTURE,
	BROWSER_STORE_INVALID_NAMES,
	BROWSER_JOURNEY_LISTING,
	BROWSER_JOURNEY_TEMPLATE_CASES,
	BROWSER_JOURNEY_EDIT_REFUSALS,
	BROWSER_JOURNEY_EDIT_ORIGINS,
	BROWSER_ELEMENT_AX_FIXTURE,
	BROWSER_ELEMENT_NAME_CASES,
	BROWSER_ELEMENT_NAME_AX_FIXTURE,
	createBrowserElementFixture,
	createDOMSnapshotResult,
	createBrowserOutlineNodes,
} from '../../setup.js'

describe('element refusals', () => {
	it('keeps element references, named subjects, details, and punctuation', () => {
		expect(describeBrowserRefusal('e4', 'GONE')).toBe(
			'Element [ref=e4] is gone because the page changed; call read for fresh refs.',
		)
		expect(describeBrowserRefusal({ subject: 'outline' }, 'GONE', 'changed during capture')).toBe(
			'outline changed during capture; call read for fresh refs.',
		)
		expect(describeBrowserRefusal({ subject: 'Upload' }, 'UNTRUSTED')).toBe(
			'Upload needs a trusted event.',
		)
		expect(
			describeBrowserRefusal(
				'e4',
				'UNTRUSTED',
				'opens a file chooser, which an untrusted click cannot do',
			),
		).toBe('Element [ref=e4] opens a file chooser, which an untrusted click cannot do.')
		expect(describeBrowserRefusal('e4', 'UNKNOWN', 'is not editable')).toBe(
			'Element [ref=e4] is not editable.',
		)
		expect(describeBrowserRefusal('e4', 'DISABLED', 'is disabled')).toBe(
			'Element [ref=e4] is disabled.',
		)
		expect(describeBrowserRefusal('e4', 'HIDDEN')).toBe('Element [ref=e4] hidden.')
		expect(describeBrowserRefusal('e4', 'OCCLUDED', 'is covered by div#veil')).toBe(
			'Element [ref=e4] is covered by div#veil.',
		)
		expect(describeBrowserRefusal('e4', 'UNKNOWN', '')).toBe('Element [ref=e4] .')
	})
})

describe('IO stream base64 boundary', () => {
	it.each(BROWSER_BASE64_REFUSALS)('refuses malformed encoded stream data %j', (data) => {
		expect(() => readBrowserStreamChunk({ data, base64Encoded: true, eof: true })).toThrow(
			expect.objectContaining({
				code: 'PROTOCOL',
				message: 'Browser IO stream chunk has malformed base64 data',
			}),
		)
	})
	it('decodes canonical bytes and preserves empty and plain UTF-8 chunks', () => {
		expect(readBrowserStreamChunk({ data: 'AAH+', base64Encoded: true, eof: false })).toEqual({
			bytes: new Uint8Array([0, 1, 254]),
			eof: false,
		})
		expect(readBrowserStreamChunk({ data: '', base64Encoded: true, eof: true })).toEqual({
			bytes: new Uint8Array(),
			eof: true,
		})
		expect(
			new TextDecoder().decode(readBrowserStreamChunk({ data: 'caf\u00e9 \u{1f600}' }).bytes),
		).toBe('caf\u00e9 \u{1f600}')
	})
})

describe('reading matches', () => {
	it('collects distinct whole Unicode words and digits of at least three characters', () => {
		expect([...collectBrowserWords('Cart CART cartwheel a to 12 123 café 中文字')]).toEqual([
			'cart',
			'cartwheel',
			'123',
			'café',
			'中文字',
		])
	})
})

describe('journey step helpers', () => {
	it('admits the advertised wait timeout in a journey step', () => {
		expect(() =>
			validateBrowserJourneyStep({ action: 'wait', arguments: { text: 'Ready', timeout: 2 } }),
		).not.toThrow()
		expect(() =>
			validateBrowserJourneyStep({ action: 'wait', arguments: { text: 'Ready', timeout: '2' } }),
		).toThrow('malformed native arguments')
		expect(() =>
			validateBrowserJourneyStep({
				action: 'wait',
				arguments: { text: 'Ready', timeout: { parameter: 'seconds' } },
			}),
		).toThrow('malformed native arguments')
	})
	it('collects the names a native type text binds and ignores a page tool literal argument', () => {
		expect(collectBrowserJourneyTextBindings([])).toEqual([])
		expect(
			collectBrowserJourneyTextBindings([
				{ action: 'type', arguments: { text: { parameter: 'password' } } },
				{ action: 'type', arguments: { text: 'literal' } },
				{ action: 'press', arguments: { key: { parameter: 'key' } } },
				{ action: 'type', arguments: { text: { parameter: 3 } } },
				{ action: 'type', arguments: { text: { parameter: 'secret1' } } },
				{ action: 'checkout', arguments: { text: { parameter: 'confirmPassword' } } },
				{ action: 'type', arguments: { text: { parameter: 'password' } } },
				{
					action: 'click',
					arguments: {},
					target: { role: 'button', name: { parameter: 'label' } },
				},
			]),
		).toEqual(['password', 'secret1'])
	})
})

describe('element helpers', () => {
	it('renders toggle states in order in outlines, matches, and focus, retaining false and controls', () => {
		const nodes = createBrowserOutlineNodes([
			{ role: 'button', name: 'Off', reference: 'e1', properties: { pressed: 'false' } },
			{
				role: 'button',
				name: 'Mixed',
				reference: 'e2',
				properties: { pressed: 'mixed', expanded: false, focused: true },
			},
			{ role: 'option', name: 'Chosen', reference: 'e3', properties: { selected: true } },
			{
				role: 'checkbox',
				name: 'Flags',
				reference: 'e4',
				properties: { checked: 'true', disabled: true },
			},
			{ role: 'button', name: 'Plain', reference: 'e5' },
			{
				role: 'button',
				name: 'All',
				reference: 'e6',
				properties: {
					pressed: true,
					expanded: 'false',
					selected: false,
					checked: true,
					disabled: true,
				},
			},
			{
				role: 'button',
				name: 'Invalid',
				reference: 'e7',
				properties: { pressed: 0, expanded: null, selected: {} },
			},
		]).map((node) => (node.reference === 'e6' ? { ...node, value: 'V', tool: 'act' } : node))
		const outline = renderBrowserOutline('url', 'title', nodes, 150)
		expect(outline.lines.map(renderBrowserLine)).toEqual([
			'button "Off" [ref=e1] pressed=false',
			'button "Mixed" [ref=e2] pressed=mixed expanded=false',
			'option "Chosen" [ref=e3] selected=true',
			'checkbox "Flags" [ref=e4] [checked] [disabled]',
			'button "Plain" [ref=e5]',
			'button "All" [ref=e6] value="V" pressed=true expanded=false selected=false [checked] [disabled] [tool=act]',
			'button "Invalid" [ref=e7]',
		])
		expect(scanBrowserLines(outline.lines, 'Mixed')).toEqual([2])
		expect(outline.focus).toBe('button "Mixed" [ref=e2] pressed=mixed expanded=false')
	})

	it('reads each text node parent from its own session, by first match, before or after the text', () => {
		const nodes = readBrowserAccessibility(BROWSER_ELEMENT_AX_FIXTURE).nodes.filter(
			(node) => node.id === 'link' || node.id === 'duplicate',
		)
		const rows = [
			...nodes.map((node) => ({
				...node,
				session: 'main',
				reference: node.id === 'link' ? 'e1' : undefined,
			})),
			...nodes.map((node) => ({
				...node,
				session: 'child',
				name: node.id === 'link' ? 'Child' : node.name,
				reference: node.id === 'link' ? 'e2' : undefined,
			})),
			...nodes.map((node) => ({
				...node,
				session: 'other',
				name: ' Other home ',
				reference: node.id === 'link' ? 'e3' : undefined,
			})),
			// A later row reusing the link's id must not replace the first match.
			...nodes
				.filter((node) => node.id === 'link')
				.map((node) => ({ ...node, session: 'main', name: 'Elsewhere', reference: undefined })),
			// The text comes before its parent here, so the lookup must reach forward.
			...[...nodes].reverse().map((node) => ({
				...node,
				session: 'later',
				name: ' Later ',
				reference: node.id === 'link' ? 'e4' : undefined,
			})),
		]
		const projected = renderBrowserOutline('url', 'title', rows, 150)
		expect({ ...projected, lines: projected.lines.map(renderBrowserLine).join('\n') }).toEqual({
			url: 'url',
			title: 'title',
			lines:
				'link "Home" [ref=e1]\nlink "Child" [ref=e2]\nlink "Other home" [ref=e3]\nlink "Later" [ref=e4]',
			listed: 4,
			found: 4,
			focus: undefined,
		})
	})

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
		expect(renderBrowserOutline('url', 'title', rows, 0)).toMatchObject({
			listed: 0,
			found: 1,
			focus: undefined,
		})
	})
})

describe('outline search and focus helpers', () => {
	it('renders a row with its reference, role, quoted name, and states in order', () => {
		expect(
			createBrowserOutlineNodes([
				{
					role: 'checkbox',
					name: ' Gift  "wrap" ',
					reference: 'e4',
					properties: { checked: true, disabled: true },
				},
				{ role: 'button', name: 'Save' },
			]).map(renderBrowserOutlineRow),
		).toEqual(['checkbox "Gift \\"wrap\\"" [ref=e4] [checked] [disabled]', 'button "Save"'])
	})

	it('lists matches and the focused row past the limit', () => {
		const nodes = createBrowserOutlineNodes([
			{ role: 'button', name: 'Close', reference: 'e1' },
			{ role: 'button', name: 'Cancel', reference: 'e2' },
			{ role: 'button', name: 'Archive', reference: 'e3', properties: { focused: true } },
		])
		const projected = renderBrowserOutline('url', 'title', nodes, 1)
		expect({ ...projected, lines: projected.lines.map(renderBrowserLine).join('\n') }).toEqual({
			url: 'url',
			title: 'title',
			lines: 'button "Close" [ref=e1]',
			listed: 1,
			found: 3,
			focus: 'button "Archive" [ref=e3]',
		})
		expect(
			scanBrowserLines(renderBrowserOutline('url', 'title', nodes, 150).lines, 'archive button'),
		).toEqual([3])
	})

	it('names the last focused referenced row and none when only an unreferenced row has focus', () => {
		const focused = { focused: true }
		expect(
			renderBrowserOutline(
				'url',
				'title',
				createBrowserOutlineNodes([
					{ role: 'button', name: 'Host', reference: 'e1', properties: focused },
					{ role: 'button', name: 'Inner', reference: 'e2', properties: focused },
				]),
				150,
			).focus,
		).toBe('button "Inner" [ref=e2]')
		expect(
			renderBrowserOutline(
				'url',
				'title',
				createBrowserOutlineNodes([
					{ role: 'RootWebArea', name: 'Shop', properties: focused },
					{ role: 'button', name: 'Save', reference: 'e1', properties: { focused: false } },
				]),
				150,
			).focus,
		).toBeUndefined()
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

	it('adds a synthetic required purpose without mutating the authored schema', () => {
		expect(deriveBrowserToolSchema(undefined)?.['required']).toEqual(['purpose'])
		const schema = { type: 'object', properties: { query: { type: 'string' } }, required: [] }
		const result = deriveBrowserToolSchema(schema)
		expect(result?.['required']).toEqual(['purpose'])
		expect(result?.['properties']).toHaveProperty('query')
		expect(result?.['properties']).toHaveProperty('purpose')
		expect(schema.required).toEqual([])
		expect(schema.properties).not.toHaveProperty('purpose')
	})

	it('retains required parameters and refuses an optional authored purpose', () => {
		const schema = {
			type: 'object',
			properties: { purpose: { type: 'string' } },
			required: ['purpose'],
		}
		expect(deriveBrowserToolSchema(schema)).toBe(schema)
		expect(
			deriveBrowserToolSchema({ type: 'object', properties: { purpose: { type: 'string' } } }),
		).toBeUndefined()
		expect(
			deriveBrowserToolSchema({
				type: 'object',
				properties: { purpose: { type: 'string' } },
				required: ['query'],
			}),
		).toBeUndefined()
	})
})

describe('toolset helpers', () => {
	it('catches a bound that cuts a string within the limit, keeps more than the limit, splits a surrogate pair, or drops the footer it is given', () => {
		const footer = "the rest was cut; call read for the page's text"
		expect(boundBrowserText('abc', 3, footer)).toBe('abc')
		expect(boundBrowserText('abcdef', 4, footer)).toBe('abc…')
		expect(boundBrowserText('abcdef', 4, 'the rest was cut')).toBe('abc…')
		expect(boundBrowserText('ab\u{1F600}cd', 3, 'the rest was cut')).toBe('ab…')
		expect(boundBrowserText('\u{1F600}\u{1F600}', 1, 'the rest was cut')).toBe('…')
		for (const limit of [0, -1, 1.5, Number.NaN])
			expect(() => boundBrowserText('abc', limit, footer)).toThrow(
				'Browser tool limit must be a positive integer',
			)
	})

	it('catches a receipt that drops the status, the dialog article, or the blank line before the view', () => {
		expect(
			renderBrowserReceipt({ action: 'Clicked button "Place order" [ref=e4]', view: 'page' }),
		).toBe('Clicked button "Place order" [ref=e4].\n\npage')
		expect(
			renderBrowserReceipt({
				action: 'Clicked link "Next" [ref=e3]',
				status: 'the page is still loading https://example.test/next',
			}),
		).toBe('Clicked link "Next" [ref=e3]; the page is still loading https://example.test/next.')
		expect(
			renderBrowserReceipt({
				action: 'Clicked button "Delete" [ref=e7]',
				dialog: { category: 'confirm', message: 'Delete the draft?' },
			}),
		).toBe(
			'Clicked button "Delete" [ref=e7]. A confirm dialog is open: "Delete the draft?"; call dialog.',
		)
		expect(
			renderBrowserReceipt({ action: '', dialog: { category: 'alert', message: 'Line\n"two"' } }),
		).toBe('An alert dialog is open: "Line\\n\\"two\\""; call dialog.')
		expect(renderBrowserReceipt({ action: '', view: 'page' })).toBe('page')
	})

	it('catches an untrusted click or type receipt without its marker, or a trusted one with it', () => {
		for (const [action, status, line] of [
			['Clicked button "Save" [ref=e1]', undefined, 'Clicked button "Save" [ref=e1].'],
			[
				'Typed "sam" into textbox "Email" [ref=e2]',
				undefined,
				'Typed "sam" into textbox "Email" [ref=e2].',
			],
			[
				'Typed "sam" into textbox "Email" [ref=e2] and submitted the form',
				undefined,
				'Typed "sam" into textbox "Email" [ref=e2] and submitted the form.',
			],
			[
				'Selected "Large" in combobox "Size" [ref=e3] (programmatic)',
				undefined,
				'Selected "Large" in combobox "Size" [ref=e3] (programmatic).',
			],
			[
				'Clicked link "Next" [ref=e3]',
				'the page is still loading https://example.test/next',
				'Clicked link "Next" [ref=e3]; the page is still loading https://example.test/next.',
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
			const rows = outline.lines.map(renderBrowserLine).join('\n').split('\n')
			for (const reference of ['e1', 'e2', 'e4']) {
				const rendered = renderBrowserElement(requireValue(page.elements.element(reference)))
				expect(rows.some((row) => row.startsWith(rendered))).toBe(true)
			}
			expect(renderBrowserElement(requireValue(page.elements.element('e1')))).toBe(
				'link "Home" [ref=e1]',
			)
		} finally {
			await client.close()
		}
	})

	it('catches a reference reader that accepts a non-reference or names no next call', () => {
		for (const value of ['e12', 'E12', '[e12]', 'ref=e12', '[ref=e12]'])
			expect(requireBrowserReference(value)).toBe('e12')
		for (const value of ['12', 'x12', 'e0', '', 12, undefined]) {
			const outcome = attempt(() => requireBrowserReference(value))
			expect(outcome.success).toBe(false)
			const error = readProperty(outcome, 'error')
			expect(isBrowserError(error) && error.code === 'ELEMENT').toBe(true)
			expect(String(error)).toContain('is not a reference such as e12; call read')
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

	it('maps the result-limit sentinel to BrowserError', () => {
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
		expect(isBrowserError(result.error) && result.error.code === 'RESULT_LIMIT').toBe(true)
		expect(
			isBrowserError(result.error) && result.error.code === 'RESULT_LIMIT'
				? result.error.context
				: undefined,
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
			expect.objectContaining({
				code: 'ARGUMENT',
				message: 'Browser snapshot limit must be a non-negative integer',
			}),
		)
		expect(() => readBrowserSnapshot(createDOMSnapshotResult(), [], 8)).toThrow(
			expect.objectContaining({ code: 'RESULT_LIMIT' }),
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
	it('attributes an empty result to the removal even before a later declaration', () => {
		const journey = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [{ id: 's1', action: 'wait', arguments: { text: 'Ready' } }],
		}
		expect(
			attempt(() =>
				editBrowserJourney(journey, [
					{ operation: 'remove', id: 's1' },
					{ operation: 'declare', name: 'email', parameter: {} },
				]),
			),
		).toMatchObject({
			success: false,
			error: {
				code: 'JOURNEY_EDIT',
				message: 'Edit 1 is refused: it removes the last step',
				context: { index: 1 },
			},
		})
		expect(journey.steps).toHaveLength(1)
		expect(
			editBrowserJourney(journey, [
				{ operation: 'remove', id: 's1' },
				{ operation: 'add', step: { action: 'wait', arguments: { text: 'Saved' } } },
			]).steps,
		).toEqual([{ id: 's6', action: 'wait', arguments: { text: 'Saved' } }])
	})
	it('renders a structured journey fault without parsing its reason', () => {
		expect(renderBrowserJourneyFault(BROWSER_STORE_FAULT_FIXTURE)).toBe(
			'broken-journey cannot be read: The read/write mode is unsupported',
		)
	})
	it('normalizes error and string reasons to a clause', () => {
		expect(
			normalizeBrowserJourneyReason(
				new Error(
					'Invariant 4 (bindings): binds an undeclared parameter; call journeys.\n\nDetails',
				),
			),
		).toBe('binds an undeclared parameter')
		expect(normalizeBrowserJourneyReason('The write failed...')).toBe('The write failed')
		expect(normalizeBrowserJourneyReason(undefined)).toBe('undefined')
	})
	it('checks names before store access with the path code', () => {
		expect(() => validateBrowserJourneyName('add-kettle')).not.toThrow()
		expect(() => validateBrowserJourneyName('a'.repeat(64))).not.toThrow()
		for (const name of [...BROWSER_STORE_INVALID_NAMES, 'a'.repeat(65)])
			expect(() => validateBrowserJourneyName(name)).toThrow(
				expect.objectContaining({ code: 'STORE_PATH' }),
			)
	})
	it('checks safe integer paging boundaries with the argument code', () => {
		expect(() => validateBrowserStorePage(0, 1)).not.toThrow()
		expect(() => validateBrowserStorePage(-0, Number.MAX_SAFE_INTEGER)).not.toThrow()
		for (const invalid of [
			-1,
			0.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			expect(() => validateBrowserStorePage(invalid, 1)).toThrow(
				expect.objectContaining({ code: 'ARGUMENT', context: { subject: 'store' } }),
			)
			expect(() => validateBrowserStorePage(0, invalid)).toThrow(
				expect.objectContaining({ code: 'ARGUMENT' }),
			)
		}
		for (const invalid of [0, -0])
			expect(() => validateBrowserStorePage(0, invalid)).toThrow(
				expect.objectContaining({ code: 'ARGUMENT' }),
			)
	})
	it('attributes an exhausted id counter to the add before later edits', () => {
		expect(
			attempt(() =>
				editBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, next: Number.MAX_SAFE_INTEGER }, [
					{ operation: 'add', step: { action: 'wait', arguments: { text: 'Ready' } } },
					{ operation: 'remove', id: 's5' },
				]),
			),
		).toMatchObject({
			success: false,
			error: {
				context: { index: 1 },
				message: 'Edit 1 is refused: it has an invalid next counter',
			},
		})
	})
	it.each(BROWSER_JOURNEY_EDIT_ORIGINS)('attributes $name atomically', ({ edits, index }) => {
		const before = structuredClone(BROWSER_JOURNEY_FIXTURE)
		expect(attempt(() => editBrowserJourney(BROWSER_JOURNEY_FIXTURE, edits))).toMatchObject({
			success: false,
			error: { code: 'JOURNEY_EDIT', context: { index } },
		})
		expect(BROWSER_JOURNEY_FIXTURE).toEqual(before)
	})
	it('accepts a repaired binding and a forward secret declaration on the final candidate', () => {
		const result = editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
			{ operation: 'update', id: 's5', arguments: { text: { parameter: 'missing' } } },
			{ operation: 'update', id: 's4', arguments: { text: { parameter: 'password' } } },
			{ operation: 'declare', name: 'password', parameter: { secret: true } },
			{ operation: 'update', id: 's5', arguments: { text: 'Saved' } },
		])
		expect(result.parameters).toEqual({ password: { secret: true } })
	})
	it('names the edit that introduced an undeclared binding despite later edits', () => {
		expect(
			attempt(() =>
				editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [
					{ operation: 'update', id: 's4', arguments: { text: { parameter: 'missing' } } },
					{ operation: 'update', id: 's4', arguments: { submit: false } },
					{ operation: 'remove', id: 's5' },
				]),
			),
		).toMatchObject({
			success: false,
			error: {
				code: 'JOURNEY_EDIT',
				context: { index: 1 },
				message: 'Edit 1 is refused: it binds undeclared parameter "missing"',
			},
		})
	})
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
				code: 'JOURNEY_EDIT',
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
				code: 'JOURNEY_EDIT',
				message: expect.stringMatching(/^Edit 2 is refused: its? [^\n]+[^.]$/),
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
		expect(renderBrowserRun(run)).toBe(
			'Replay of add-kettle stopped at s3 of 5: Step s3 names button "Add to cart", which no element carries.\ns1 Navigated to https://shop.example.test/.\ns2 Clicked link "Alpine Kettle" [ref=e12].\ns3 Step s3 names button "Add to cart", which no element carries.',
		)
	})
	it('keeps directive-like quoted text and strips appended receipt views', () => {
		expect(
			renderBrowserRunResult(
				'Typed "text; call save" into textbox "Note" [ref=e1]; call read.\n\npage "Notes"',
			),
		).toBe('Typed "text; call save" into textbox "Note" [ref=e1].')
		expect(renderBrowserRunResult('Clicked button "Say \\"hi; call save\\""; call read.')).toBe(
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

describe('buildBrowserJourney', () => {
	it('owns recorded steps and declares secret text bindings', () => {
		const steps = [
			{
				id: 's1',
				action: 'type',
				arguments: { text: { parameter: 'password' } },
				target: { role: 'textbox', name: 'Password' },
			},
		]
		const journey = buildBrowserJourney(steps, { name: 'sign-in', description: 'Sign in' })
		expect(journey).toEqual({
			format: 1,
			name: 'sign-in',
			description: 'Sign in',
			parameters: { password: { secret: true } },
			next: 2,
			steps,
		})
		Reflect.set(steps[0]?.arguments ?? {}, 'text', 'changed')
		expect(journey.steps[0]?.arguments['text']).toEqual({ parameter: 'password' })
	})
	it('refuses empty journeys and invalid names and ids', () => {
		expect(() => buildBrowserJourney([], { name: 'empty', description: '' })).toThrow(
			'Invariant 2 (ids): has no steps',
		)
		expect(() => buildBrowserJourney([], { name: 'Bad name', description: '' })).toThrow(
			'Invariant 1',
		)
		expect(() =>
			buildBrowserJourney([{ id: 's2', action: 'wait', arguments: { text: 'Ready' } }], {
				name: 'ready',
				description: '',
			}),
		).toThrow('Invariant 2')
	})
})

describe('write conditions and page lifecycle', () => {
	it('validates journey write conditions independently of a backend', () => {
		for (const options of [
			undefined,
			{},
			{ exclusive: true },
			{ exclusive: false },
			{ revision: 1 },
		])
			expect(() => validateBrowserJourneyWriteOptions(options)).not.toThrow()
		for (const options of [{ revision: 0 }, { revision: Number.NaN }])
			expect(() => validateBrowserJourneyWriteOptions(options)).toThrow(BrowserError)
	})
	it('refuses a released page and a disconnected frame before protocol work', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target', 'session')
		expect(() => validateBrowserPageOpen(page, client)).not.toThrow()
		expect(transport.sent).toEqual([])
		replyOk(transport, 'Target.detachFromTarget')
		await page.destroy()
		expect(() => validateBrowserPageOpen(page, client)).toThrow('Browser page is closed')
		await client.close()
		expect(() => validateBrowserPageOpen(page, client)).toThrow('Browser frame is disconnected')
		expect(transport.sent.map((message) => message.method)).toEqual(['Target.detachFromTarget'])
	})
})

describe('line projection and whole windows', () => {
	it('miss placement: reserves the plain miss immediately before the footer', () => {
		const lines: readonly BrowserLine[] = [
			'Policy details',
			'Other details',
			'Last details '.repeat(30),
		].map((text) => ({ spans: [{ category: 'text', text }] }))
		const passage: BrowserPassage = {
			title: 'Policy',
			url: '/',
			lines,
			from: 2,
			tabs: [],
			changed: false,
			search: 'policy token',
		}
		const expected =
			'page "Policy" / (3 lines)\nThis read shows lines 2–2 of 3; line 3 is not shown yet.\n2: Other details\nNo line from 2 on matches "policy token".\n[lines 2–2 of 3; 1 above, 1 below; call read with from 3 for more]'
		expect(renderBrowserPassage(passage, expected.length)).toBe(expected)
		expect(() => renderBrowserPassage(passage, expected.length - 1)).toThrow('cannot hold')
		expect(renderBrowserPassage({ ...passage, to: 2 }, 4000)).toContain(
			'\n2: Other details\nNo line from 2 to 2 matches "policy token".\n[lines 2–2',
		)
		expect(renderBrowserPassage({ ...passage, from: 1, search: 'missing' }, 4000)).toContain(
			'\nNo line matches "missing".\n[lines 1–3',
		)
	})
	it('miss placement: leaves an in-range hit under the header unchanged', () => {
		const lines: readonly BrowserLine[] = [
			{ spans: [{ category: 'text', text: 'Policy details' }] },
			{ spans: [{ category: 'text', text: 'Other details' }] },
		]
		expect(
			renderBrowserPassage(
				{ title: 'Policy', url: '/', lines, from: 1, tabs: [], changed: false, search: 'policy' },
				4000,
			),
		).toBe(
			'page "Policy" / (2 lines)\n1 line matches "policy": 1\n1: Policy details\n2: Other details\n[lines 1–2 of 2; the whole page]',
		)
	})
	it('heading boundary: leaves the last fitting heading for the next read', () => {
		const lines: readonly BrowserLine[] = [
			{ spans: [{ category: 'text', text: 'Body before' }] },
			{
				spans: [
					{ category: 'syntax', text: '## ' },
					{ category: 'text', text: 'Next section' },
				],
			},
			{ spans: [{ category: 'text', text: 'Section body '.repeat(30) }] },
		]
		const limit = [
			'page',
			'This read shows lines 1–2 of 3; line 3 is not shown yet.',
			'1: Body before',
			'2: ## Next section',
			'[lines 1–2 of 3; 1 below; call read with from 3 for more]',
		].join('\n').length
		for (const to of [undefined, 2]) {
			const result = renderBrowserWindow(lines, 1, to, 'page', limit, 'read', true)
			expect(result).toBe(
				'page\nThis read shows lines 1–1 of 3; lines 2–3 are not shown yet.\n1: Body before\n[lines 1–1 of 3; 2 below; call read with from 2 for more]',
			)
			expect(result.length).toBeLessThanOrEqual(limit)
		}
		const next = renderBrowserWindow(lines, 2, undefined, 'page', 4000, 'read', true)
		expect(next).toContain('page\n2: ## Next section\n3: Section body')
		expect(next).toMatch(/\[lines 2–3 of 3; 1 above; end of page\]$/)
	})
	it('heading boundary: keeps a heading when it is the only row in the window', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'syntax', text: '# ' },
					{ category: 'text', text: 'Only heading' },
				],
			},
			{ spans: [{ category: 'text', text: 'Body' }] },
		]
		expect(renderBrowserWindow(lines, 1, 1, 'page', 4000, 'read', true)).toBe(
			'page\nThis read shows lines 1–1 of 2; line 2 is not shown yet.\n1: # Only heading\n[lines 1–1 of 2; 1 below; call read with from 2 for more]',
		)
	})
	it('heading boundary: keeps a heading at the end of the page', () => {
		const lines: readonly BrowserLine[] = [
			{ spans: [{ category: 'text', text: 'Body' }] },
			{
				spans: [
					{ category: 'syntax', text: '###### ' },
					{ category: 'text', text: 'Last heading' },
				],
			},
		]
		expect(renderBrowserWindow(lines, 1, undefined, 'page', 4000, 'read', true)).toBe(
			'page\n1: Body\n2: ###### Last heading\n[lines 1–2 of 2; the whole page]',
		)
	})
	it('element best-match: text-only winners keep the plain miss, including ties and reference-shaped text', () => {
		const lines: readonly BrowserLine[] = [
			{ spans: [{ category: 'text', text: 'Shipping policy [ref=e9]' }] },
			{
				spans: [
					{ category: 'text', text: 'Shipping policy' },
					{ category: 'reference', text: ' [ref=e1]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other details' }] },
			{ spans: [{ category: 'text', text: 'End' }] },
		]
		expect(scanBrowserLines(lines, 'policy token')).toEqual([1, 2])
		for (const to of [3, 4]) {
			const result = renderBrowserPassage(
				{
					title: 'Policy',
					url: '/',
					lines,
					from: 3,
					to,
					tabs: [],
					changed: false,
					search: 'policy token',
				},
				4000,
			)
			expect(result).toContain(
				`No line from 3 ${to === 3 ? 'to 3' : 'on'} matches "policy token".\n[lines 3–${to}`,
			)
			expect(result).not.toContain('best match')
			expect(result).not.toMatch(/^[12]: /m)
		}
	})
	it('element best-match: element winners outside the range are quoted with the window unmoved', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'text', text: 'Cedar Tea Tray' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other products' }] },
		]
		const result = renderBrowserPassage(
			{
				title: 'Shop',
				url: '/',
				lines,
				from: 2,
				tabs: [],
				changed: false,
				search: 'Cedar Tea Tray',
			},
			4000,
		)
		expect(result).toContain(
			'No line from 2 on matches "Cedar Tea Tray"; the best match is line 1:\n1: Cedar Tea Tray [ref=e7]\n2: Other products',
		)
		expect(result).toMatch(/\[lines 2–2 of 2; 1 above; end of page\]$/)
	})
	it('redesign fix: abbreviates the best-match query before reserving the sentence', () => {
		const search = 'Cedar Tea Tray ' + 'zzzz '.repeat(700)
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'text', text: 'Cedar Tea Tray' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other products' }] },
		]
		const result = renderBrowserPassage(
			{ title: 'Shop', url: '/', lines, from: 2, tabs: [], changed: false, search },
			4000,
		)
		expect(result).toContain(
			`No line from 2 on matches ${JSON.stringify(abbreviateBrowserText(search, 120))}; the best match is line 1:\n1: Cedar Tea Tray [ref=e7]\n2: Other products`,
		)
		expect(result.length).toBeLessThanOrEqual(4000)
	})
	it('redesign fix: omits a best-match row whole and reserves the miss sentence', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'text', text: 'Cedar ' + 'x'.repeat(690) },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other ' + 'y'.repeat(690) }] },
		]
		const passage: BrowserPassage = {
			title: 'Shop',
			url: '/',
			lines,
			from: 2,
			tabs: [],
			changed: false,
			search: 'Cedar',
		}
		const result = renderBrowserPassage(passage, 1200)
		expect(result).toContain(
			'No line from 2 on matches "Cedar"; the best match is line 1.\n[lines 2–2',
		)
		expect(result).not.toMatch(/^1: /m)
		expect(result).not.toContain('[characters')
		expect(result).toContain('2: ' + renderBrowserLine(requireValue(lines[1])))
		expect(result.length).toBeLessThanOrEqual(1200)
		const minimum = renderBrowserPassage({ ...passage, search: '' }, 4000).length
		expect(() => renderBrowserPassage(passage, minimum)).toThrow('cannot hold')
	})
	it('redesign fix: selects the first of tied page-wide best matches', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'text', text: 'Cedar Tea Tray first' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{
				spans: [
					{ category: 'text', text: 'Cedar Tea Tray second' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other products' }] },
		]
		expect(scanBrowserLines(lines, 'Cedar Tea Tray')).toEqual([1, 2])
		expect(
			renderBrowserPassage(
				{
					title: 'Shop',
					url: '/',
					lines,
					from: 3,
					tabs: [],
					changed: false,
					search: 'Cedar Tea Tray',
				},
				4000,
			),
		).toContain('the best match is line 1:\n1: Cedar Tea Tray first [ref=e7]\n3: Other products')
	})
	it('redesign fix: names an explicit shortened range in both miss sentences only', () => {
		const lines: readonly BrowserLine[] = ['One', 'Two', 'Cedar'].map((text) => ({
			spans: [
				{ category: 'text', text },
				{ category: 'reference', text: ' [ref=e7]' },
			],
		}))
		for (const from of [1, 2]) {
			expect(renderBrowserSearch(lines, from, 2, 'Missing').text).toBe(
				`No line from ${from} to 2 matches "Missing".`,
			)
			expect(
				renderBrowserPassage(
					{
						title: 'Shop',
						url: '/',
						lines,
						from,
						to: 2,
						tabs: [],
						changed: false,
						search: 'Cedar',
					},
					4000,
				),
			).toContain(`No line from ${from} to 2 matches "Cedar"; the best match is line 3:`)
		}
		for (const to of [undefined, 3, 99]) {
			expect(renderBrowserSearch(lines, 2, to, 'Missing').text).toBe(
				'No line from 2 on matches "Missing".',
			)
			expect(renderBrowserSearch(lines, 1, to, 'Missing').text).toBe('No line matches "Missing".')
			expect(
				renderBrowserPassage(
					{
						title: 'Shop',
						url: '/',
						lines,
						from: 2,
						...(to === undefined ? {} : { to }),
						tabs: [],
						changed: false,
						search: 'One',
					},
					4000,
				),
			).toContain('No line from 2 on matches "One"; the best match is line 1:')
		}
	})
	it('redesign fix: soft wraps keep the reference with the end of its name', () => {
		for (const length of [780, 785, 790, 795, 800, 1590]) {
			const name = 'Cedar Tea Tray '.repeat(120).slice(0, length).trimEnd()
			const line: BrowserLine = {
				spans: [
					{ category: 'syntax', text: 'link ' },
					{ category: 'text', text: JSON.stringify(name) },
					{ category: 'syntax', text: ' ' },
					{ category: 'reference', text: '[ref=e7]' },
					{ category: 'text', text: ' /product/p3' },
				],
			}
			const wrapped = wrapBrowserLine(line)
			const reference = requireValue(
				wrapped.find((row) => row.spans.some((span) => span.category === 'reference')),
			)
			expect(renderBrowserLine(reference)).toMatch(/\S" \[ref=e7\]/)
			for (const row of wrapped)
				expect(renderBrowserLine(row).length).toBeLessThanOrEqual(BROWSER_READ_WIDTH)
			expect(
				wrapped
					.flatMap((row) => row.spans.filter((span) => span.category === 'reference'))
					.map((span) => span.text),
			).toEqual(['[ref=e7]'])
		}
	})
	it('redesign fix: partial headers use a boolean independent of header and tool text', () => {
		const lines: readonly BrowserLine[] = ['One', 'Two', 'Three'].map((text) => ({
			spans: [{ category: 'text', text }],
		}))
		expect(renderBrowserWindow(lines, 1, 1, 'page custom', 4000)).not.toContain('This read')
		expect(renderBrowserWindow(lines, 1, 1, 'Custom header', 4000, 'read', true)).toContain(
			'Custom header\nThis read shows lines 1–1 of 3; lines 2–3 are not shown yet.',
		)
		expect(renderBrowserWindow(lines, 1, 1, 'page custom', 4000, 'read', false)).not.toContain(
			'This read',
		)
		expect(renderBrowserWindow(lines, 1, 3, 'Custom header', 4000, 'read', true)).not.toContain(
			'This read',
		)
	})
	it('line redesign: references follow names in rows and inline spans and never score', () => {
		const nodes = createBrowserOutlineNodes([
			{ role: 'link', name: 'Cedar Tea Tray', reference: 'e7', properties: { url: '/product/p3' } },
			{ role: 'textbox', name: 'Name', reference: 'e16' },
			{ role: 'button', name: '', reference: 'e17' },
		]).map((node) => (node.reference === 'e16' ? { ...node, value: 'Ada Lovelace' } : node))
		const outline = renderBrowserOutline('https://shop.test/', '', nodes, 100)
		expect(outline.lines.map(renderBrowserLine)).toEqual([
			'link "Cedar Tea Tray" [ref=e7] /product/p3',
			'textbox "Name" [ref=e16] value="Ada Lovelace"',
			'button [ref=e17]',
		])
		expect(renderBrowserOutlineRow(requireValue(nodes[1]))).toBe(
			'textbox "Name" [ref=e16] value="Ada Lovelace"',
		)
		for (const search of ['ref', 'e16', '[ref=e17]'])
			expect(scanBrowserLines(outline.lines, search)).toEqual([])
		expect(scanBrowserLines(outline.lines, 'Ada')).toEqual([2])
		expect(describeBrowserRefusal('e7', 'GONE')).toBe(
			'Element [ref=e7] is gone because the page changed; call read for fresh refs.',
		)
	})
	it('line redesign: partial headers reserve room, name the actual window, and use singular only for one remaining line', () => {
		const lines: readonly BrowserLine[] = Array.from({ length: 12 }, (_, index) => ({
			spans: [{ category: 'text', text: `Paragraph ${index + 1}` }],
		}))
		const passage: BrowserPassage = {
			title: 'Shop',
			url: 'https://shop.test/',
			lines,
			from: 1,
			tabs: [],
			changed: false,
		}
		expect(renderBrowserPassage({ ...passage, to: 10 }, 4000).split('\n')[1]).toBe(
			'This read shows lines 1–10 of 12; lines 11–12 are not shown yet.',
		)
		expect(renderBrowserPassage({ ...passage, to: 11 }, 4000).split('\n')[1]).toBe(
			'This read shows lines 1–11 of 12; line 12 is not shown yet.',
		)
		expect(renderBrowserPassage(passage, 4000)).not.toContain('This read')
		expect(renderBrowserPassage({ ...passage, from: 12 }, 4000)).not.toContain('This read')
		expect(renderBrowserPassage({ ...passage, lines: [] }, 4000)).not.toContain('This read')
		for (const result of [
			renderBrowserPassage(passage, 250),
			renderBrowserReceiptWindow(passage, 'Clicked.', 250),
		]) {
			expect(result.length).toBeLessThanOrEqual(250)
			const end = Number(requireValue(/\[lines 1–(\d+) of 12;/.exec(result))[1])
			expect(result).toContain(
				`This read shows lines 1–${end} of 12; lines ${end + 1}–12 are not shown yet.`,
			)
			expect(result).toContain(`call read with from ${end + 1} for more]`)
		}
	})
	it('line redesign: range misses show the page best match without moving the window and bound long notes', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'text', text: 'Cedar' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{
				spans: [
					{ category: 'text', text: 'Cedar Tea Tray' },
					{ category: 'reference', text: ' [ref=e7]' },
				],
			},
			{ spans: [{ category: 'text', text: 'Other products' }] },
			{ spans: [{ category: 'text', text: 'Shipping' }] },
		]
		const passage: BrowserPassage = {
			title: 'Shop',
			url: 'https://shop.test/',
			lines,
			from: 3,
			to: 3,
			tabs: [],
			changed: false,
			search: 'Cedar Tea Tray',
		}
		const result = renderBrowserPassage(passage, 4000)
		expect(result).toContain(
			'This read shows lines 3–3 of 4; line 4 is not shown yet.\nNo line from 3 to 3 matches "Cedar Tea Tray"; the best match is line 2:\n2: Cedar Tea Tray [ref=e7]\n3: Other products',
		)
		expect(result).toMatch(/\[lines 3–3 of 4; 2 above, 1 below; call read with from 4 for more\]$/)
		expect(renderBrowserPassage({ ...passage, from: 1 }, 4000)).not.toContain('best match')
		expect(
			renderBrowserPassage({ ...passage, from: 1, to: 1, search: 'Tea Tray' }, 4000),
		).toContain(
			'No line from 1 to 1 matches "Tea Tray"; the best match is line 2:\n2: Cedar Tea Tray [ref=e7]\n1: Cedar',
		)
		expect(renderBrowserPassage({ ...passage, search: 'Absent' }, 4000)).toContain(
			'No line from 3 to 3 matches "Absent".',
		)
		expect(renderBrowserPassage({ ...passage, search: 'Absent' }, 4000)).not.toContain('best match')
		const bounded = renderBrowserPassage({ ...passage, search: 'Cedar '.repeat(2000) }, 400)
		expect(bounded.length).toBeLessThanOrEqual(400)
		expect(bounded).toContain('\n3: Other products\n[lines 3–3')
	})
	it('line redesign: changed projections carry the change note from line one', () => {
		const passage: BrowserPassage = {
			title: 'Shop',
			url: 'https://shop.test/',
			lines: [{ spans: [{ category: 'text', text: 'Changed' }] }],
			from: 1,
			tabs: [],
			changed: true,
		}
		expect(renderBrowserPassage(passage, 4000)).toContain('The page changed')
		expect(renderBrowserPassage({ ...passage, changed: false }, 4000)).not.toContain(
			'The page changed',
		)
	})
	it('audit repair 13: extreme passages and receipt windows keep the bound and every addressed row whole', () => {
		for (const title of ['Title', '\u0000'.repeat(5000), '𐐷'.repeat(2500)]) {
			for (const receipt of ['Clicked.', '𐐷'.repeat(5000)]) {
				const lines: readonly BrowserLine[] = [
					...wrapBrowserLine({ spans: [{ category: 'text', text: '𐐷'.repeat(5000) }] }),
					...Array.from({ length: 500 }, (): BrowserLine => ({
						spans: [{ category: 'text', text: 'Matching prose' }],
					})),
				]
				const passage: BrowserPassage = {
					title,
					url: 'https://example.test/' + 'x'.repeat(5000),
					lines,
					from: 1,
					search: 'Matching',
					changed: true,
					note: 'Moved '.repeat(1000),
					tabs: Array.from({ length: 400 }, (_, index) => ({
						id: 't' + index,
						title,
						url: 'https://example.test/',
						current: index === 0,
					})),
				}
				for (const result of [
					renderBrowserPassage(passage, 4000),
					renderBrowserReceiptWindow({ ...passage, search: '' }, receipt, 4000),
				]) {
					expect(result.length).toBeLessThanOrEqual(4000)
					expect(result.isWellFormed()).toBe(true)
					const rows = [...result.matchAll(/^(\d+): (.*)$/gm)]
					expect(rows.length).toBeGreaterThan(0)
					for (const row of rows)
						expect(row[2]).toBe(renderBrowserLine(lines[Number(row[1]) - 1] ?? { spans: [] }))
					expect(result).toMatch(/\[lines \d+–\d+ of \d+;.*\]$/)
				}
			}
		}
	})
	it('audit repair 10: copy explains line coordinates and the search opening within the journey bound', () => {
		const definitions = Object.values(BROWSER_TOOL_COPY).map(
			({ name, description, parameters }) => ({ name, description, parameters }),
		)
		const journeys = definitions.filter(({ name }) =>
			['record', 'save', 'journeys', 'edit', 'replay', 'forget', 'capture'].includes(name),
		)
		expect(JSON.stringify(BROWSER_TOOL_COPY.read.parameters)).toContain(
			'Words to find; the reply opens one line before the first match at or after from.',
		)
		expect(BROWSER_TOOL_COPY.journeys.description).toContain('as numbered lines')
		expect(JSON.stringify(BROWSER_TOOL_COPY.journeys.parameters)).toContain('1 for the top')
		expect(JSON.stringify(BROWSER_TOOL_COPY.journeys.parameters)).toContain(
			'Default: as many lines as fit.',
		)
		expect(
			JSON.stringify(journeys).length +
				JSON.stringify({
					secret: readProperty(
						readProperty(BROWSER_TOOL_COPY.type.parameters, 'properties'),
						'secret',
					),
				}).length,
		).toBeLessThanOrEqual(3400)
	})
	it('audit repair 1: redacts raw and normalized secrets before a hard wrap can split them', () => {
		const secret = 'private'.repeat(150)
		const outline = renderBrowserOutline(
			'https://example.test/',
			'',
			createBrowserOutlineNodes([{ role: 'textbox', reference: 'e1', name: '  Tide  4821  ' }]).map(
				(node) => ({ ...node, value: secret }),
			),
			100,
			[secret, '  Tide  4821  '],
		)
		expect(outline.lines.map(renderBrowserLine)).toEqual([
			'textbox "[redacted]" [ref=e1] value="[redacted]"',
		])
		expect(redactBrowserText('Tide 4821', ['  Tide  4821  '])).toBe('[redacted]')
	})
	it('audit repair 4: role and state words never score as text', () => {
		const outline = renderBrowserOutline(
			'https://example.test/',
			'',
			createBrowserOutlineNodes([
				{ role: 'button', reference: 'e1', name: 'Save', properties: { pressed: true } },
				{ role: 'textbox', reference: 'e2', name: 'Buyer' },
				{ role: 'checkbox', reference: 'e3', name: 'Agree', properties: { checked: true } },
			]),
			100,
		)
		for (const word of ['button', 'text', 'check', 'true', 'pressed'])
			expect(scanBrowserLines(outline.lines, word)).toEqual([])
		expect(scanBrowserLines(outline.lines, 'Save')).toEqual([1])
	})
	it('wraps whitespace and hard tokens before numbering without splitting a code point', () => {
		const paragraph = 'An ordinary paragraph. '.repeat(50).trim()
		const ordinary = wrapBrowserLine({ spans: [{ category: 'text', text: paragraph }] })
		expect(ordinary.map(renderBrowserLine).join(' ')).toBe(paragraph)
		const token = '𐐷'.repeat(1200)
		const hard = wrapBrowserLine({ spans: [{ category: 'text', text: token }] })
		expect(
			hard
				.map(renderBrowserLine)
				.map((line) => line.replace(/^↳/, ''))
				.join(''),
		).toBe(token)
		for (const line of [...ordinary, ...hard].map(renderBrowserLine)) {
			expect(line.length).toBeLessThanOrEqual(BROWSER_READ_WIDTH)
			expect(line.isWellFormed()).toBe(true)
		}
		expect(hard.slice(1).every((line) => renderBrowserLine(line).startsWith('↳'))).toBe(true)
	})
	it('searches only text spans, uses best scores, Unicode words, and prefixes of at least four letters', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'reference', text: 'e12345' },
					{ category: 'syntax', text: ' value="' },
					{ category: 'text', text: 'Cedar schedules 日本語' },
					{ category: 'syntax', text: '"' },
				],
			},
			{ spans: [{ category: 'text', text: '/delivery?season=winter' }] },
			{ spans: [{ category: 'text', text: 'Cedar schedule' }] },
		]
		expect(scanBrowserLines(lines, 'e12345 value')).toEqual([])
		expect(scanBrowserLines(lines, 'cedar schedule')).toEqual([1, 3])
		expect(scanBrowserLines(lines, 'deliver')).toEqual([2])
		expect(scanBrowserLines(lines, 'ced')).toEqual([])
		expect(scanBrowserLines(lines, '日本語')).toEqual([1])
		expect(scanBrowserLines(lines, 'cedar schedule', 2)).toEqual([3])
	})
	it('bounds metadata, matching numbers and complete rows together without changing addresses', () => {
		const lines: readonly BrowserLine[] = Array.from({ length: 120 }, () => ({
			spans: [{ category: 'text', text: 'Matching ' + '𐐷'.repeat(300) }],
		}))
		const passage: BrowserPassage = {
			url: 'https://example.test/' + 'u'.repeat(5000),
			title: '"'.repeat(5000),
			lines,
			from: 40,
			search: 'matching ' + 'a'.repeat(5000),
			changed: true,
			note: 'm'.repeat(5000),
			tabs: Array.from({ length: 100 }, (_, i) => ({
				id: 't' + i,
				title: 't'.repeat(500),
				url: 'https://example.test/',
				current: i === 0,
			})),
		}
		const window = renderBrowserPassage(passage, BROWSER_TOOL_LIMIT)
		expect(window.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		expect(window).toContain('\n40: Matching')
		expect(window).not.toContain('\n39:')
		expect(window).toContain('more tabs omitted')
		expect(window).toContain('and 31 more; add words to narrow')
		expect(window).toContain('changed')
		expect(window).toMatch(/call read with from \d+ for more\]$/)
	})
	it('renders each footer form, clamps at the end and refuses invalid ranges', () => {
		expect(renderBrowserFooter(1, 2, 2)).toBe('[lines 1–2 of 2; the whole page]')
		expect(renderBrowserFooter(2, 2, 2)).toBe('[lines 2–2 of 2; 1 above; end of page]')
		expect(renderBrowserFooter(1, 1, 2)).toBe(
			'[lines 1–1 of 2; 1 below; call read with from 2 for more]',
		)
		expect(renderBrowserFooter(1, 0, 0)).toBe('[empty page; the whole page]')
		for (const from of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
			expect(() => validateBrowserLines(from)).toThrow(/line|Line|from|to/)
		expect(() => validateBrowserLines(2, 1)).toThrow(/line|Line|from|to/)
		expect(() => validateBrowserLines(3, undefined, 2)).toThrow(/line|Line|from|to/)
		const lines: readonly BrowserLine[] = [{ spans: [{ category: 'text', text: 'Only row' }] }]
		expect(
			renderBrowserPassage(
				{ url: 'about:blank', title: '', lines, from: 1, to: 100, tabs: [], changed: false },
				4000,
			),
		).toContain('[lines 1–1 of 1; the whole page]')
		expect(() =>
			renderBrowserPassage(
				{ url: 'about:blank', title: '', lines, from: 1, tabs: [], changed: false },
				20,
			),
		).toThrow('next complete line')
	})
})
