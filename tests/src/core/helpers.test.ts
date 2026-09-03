/**
 * src/core/helpers.ts tests.
 */

import type { BrowserCodegenAction } from '@src/core'
import { describe, it, expect } from 'vitest'
import { attempt } from '@orkestrel/contract'
import {
	BrowserResultLimitError,
	decodeBase64,
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
	normalizeCodegenActions,
	parseCodegenActionPayload,
	settleBrowserTeardown,
	readBrowserFrames,
	readBrowserHeaders,
	readBrowserProfile,
	readEvaluationResult,
	requireBrowserString,
	compileCodegenScript,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BASE64_CHARS,
} from '@src/core'
import { createDOMSnapshotResult, JPEG_BASE64, PNG_BASE64 } from '../../setup.js'

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

describe('normalizeCodegenActions', () => {
	it('passes through a list with no consecutive fills unchanged', () => {
		const actions: BrowserCodegenAction[] = [
			{ action: 'navigate', url: 'about:blank' },
			{ action: 'click', selector: '#a' },
		]
		expect(normalizeCodegenActions(actions)).toEqual(actions)
	})

	it('collapses consecutive fills on the same selector to the latest value', () => {
		const actions: BrowserCodegenAction[] = [
			{ action: 'fill', selector: '#a', value: 'h' },
			{ action: 'fill', selector: '#a', value: 'he' },
			{ action: 'fill', selector: '#a', value: 'hello' },
		]
		expect(normalizeCodegenActions(actions)).toEqual([
			{ action: 'fill', selector: '#a', value: 'hello' },
		])
	})

	it('does not collapse fills on different selectors', () => {
		const actions: BrowserCodegenAction[] = [
			{ action: 'fill', selector: '#a', value: 'x' },
			{ action: 'fill', selector: '#b', value: 'y' },
		]
		expect(normalizeCodegenActions(actions)).toEqual(actions)
	})

	it('preserves order and restarts collapsing after an intervening action', () => {
		const actions: BrowserCodegenAction[] = [
			{ action: 'fill', selector: '#a', value: 'x' },
			{ action: 'click', selector: '#b' },
			{ action: 'fill', selector: '#a', value: 'y' },
			{ action: 'fill', selector: '#a', value: 'z' },
		]
		expect(normalizeCodegenActions(actions)).toEqual([
			{ action: 'fill', selector: '#a', value: 'x' },
			{ action: 'click', selector: '#b' },
			{ action: 'fill', selector: '#a', value: 'z' },
		])
	})

	it('returns an empty array for an empty input', () => {
		expect(normalizeCodegenActions([])).toEqual([])
	})
})

describe('contenteditable fill — parse/normalize/compile pipeline', () => {
	it('flows a contenteditable fill binding payload through parse, normalize, and compile unchanged in shape', () => {
		const payload = JSON.stringify({ action: 'fill', selector: '#editor', value: 'hello world' })
		const parsed = parseCodegenActionPayload(payload)
		expect(parsed).toEqual({ action: 'fill', selector: '#editor', value: 'hello world' })

		const normalized = normalizeCodegenActions(parsed !== undefined ? [parsed] : [])
		expect(normalized).toEqual([{ action: 'fill', selector: '#editor', value: 'hello world' }])

		const script = compileCodegenScript(normalized)
		expect(script).toContain(`await page.fill("#editor", "hello world")`)
	})

	it('collapses consecutive contenteditable-originated fill payloads to the latest value', () => {
		const payloads = [
			{ action: 'fill', selector: '#editor', value: 'h' },
			{ action: 'fill', selector: '#editor', value: 'he' },
			{ action: 'fill', selector: '#editor', value: 'hello' },
		].map((entry) => JSON.stringify(entry))

		const parsed = payloads
			.map((payload) => parseCodegenActionPayload(payload))
			.filter((action): action is BrowserCodegenAction => action !== undefined)

		const normalized = normalizeCodegenActions(parsed)
		expect(normalized).toEqual([{ action: 'fill', selector: '#editor', value: 'hello' }])

		const script = compileCodegenScript(normalized)
		expect(script).toContain(`await page.fill("#editor", "hello")`)
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
