/**
 * src/core/helpers.ts tests.
 */

import type { BrowserCodegenAction } from '@src/core'
import { describe, it, expect } from 'vitest'
import { attempt } from '@orkestrel/contract'
import {
	attributeOfBrowserNode,
	BrowserResultLimitError,
	decodeBase64,
	decodeBrowserAttributes,
	decodeBrowserSnapshot,
	decodeRareBooleanData,
	decodeRareIntegerData,
	decodeRareStringData,
	encodeBase64,
	isBrowserNodeQuery,
	isBrowserNodeVisible,
	isBrowserResultLimitError,
	matchesBrowserNode,
	normalizeCodegenActions,
	settleBrowserTeardown,
	parseCodegenActionPayload,
	readBrowserConsoleMessage,
	readBrowserFrames,
	readBrowserHeaders,
	readBrowserProfile,
	readBrowserRect,
	readBrowserSecurity,
	readBrowserTiming,
	readBrowserTimingRange,
	readCodegenNavigateAction,
	readEvaluationResult,
	readNumberArray,
	readSnapshotString,
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

describe('network timing helpers', () => {
	it('decodes finite ordered phases and omits Chromium unavailable sentinels', () => {
		const timing = {
			requestTime: 10,
			proxyStart: -1,
			proxyEnd: -1,
			dnsStart: 0,
			dnsEnd: 2,
			connectStart: 2,
			connectEnd: 5,
			sslStart: 3,
			sslEnd: 5,
			sendStart: 5,
			sendEnd: 6,
			receiveHeadersEnd: 9,
		}

		expect(readBrowserTiming(timing)).toEqual({
			request: 10,
			proxy: undefined,
			dns: { start: 0, end: 2 },
			connect: { start: 2, end: 5 },
			ssl: { start: 3, end: 5 },
			send: { start: 5, end: 6 },
			receive: 9,
		})
		expect(readBrowserTimingRange(timing, 'dnsStart', 'dnsEnd')).toEqual({
			start: 0,
			end: 2,
		})
	})

	it('rejects non-finite, negative, and reversed protocol timing values', () => {
		expect(readBrowserTiming({ requestTime: Number.NaN })).toBeUndefined()
		expect(readBrowserTiming({ requestTime: -1 })).toBeUndefined()
		expect(readBrowserTimingRange({ start: 2, end: 1 }, 'start', 'end')).toBeUndefined()
		expect(
			readBrowserTimingRange({ start: 0, end: Number.POSITIVE_INFINITY }, 'start', 'end'),
		).toBeUndefined()
	})

	it('decodes ordered certificate validity and rejects malformed bounds', () => {
		expect(
			readBrowserSecurity({
				protocol: 'TLS 1.3',
				issuer: 'Example CA',
				validFrom: 100,
				validTo: 200,
			}),
		).toEqual({
			protocol: 'TLS 1.3',
			issuer: 'Example CA',
			from: 100,
			to: 200,
		})
		expect(
			readBrowserSecurity({
				protocol: 'TLS 1.3',
				issuer: 'Example CA',
				validFrom: 200,
				validTo: 100,
			}),
		).toBeUndefined()
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

	it('contains cyclic console serialization without dropping the event', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic['self'] = cyclic

		expect(
			readBrowserConsoleMessage({
				type: 'log',
				timestamp: 1,
				args: [{ value: cyclic }],
			}),
		).toMatchObject({
			level: 'log',
			text: '[object Object]',
			values: [cyclic],
		})
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
	it('validates generic number arrays, string indexes, rectangles, and attributes', () => {
		expect(readNumberArray([1, 2.5, -3])).toEqual([1, 2.5, -3])
		expect(readNumberArray([1, '2'])).toBeUndefined()
		expect(readNumberArray([Number.NaN])).toBeUndefined()
		expect(readNumberArray([Number.POSITIVE_INFINITY])).toBeUndefined()
		expect(readSnapshotString(['zero', 'one'], 1)).toBe('one')
		expect(readSnapshotString(['zero'], 99)).toBeUndefined()
		expect(readBrowserRect([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
		expect(readBrowserRect([1, 2, 3])).toBeUndefined()
		const attributes = decodeBrowserAttributes([0, 1, 2, 3], ['id', 'hero', 'role', 'main'])
		expect(attributes).toEqual({ id: 'hero', role: 'main' })
		expect(Object.isFrozen(attributes)).toBe(true)
	})

	it('decodes sparse string, boolean, and integer records defensively', () => {
		expect([...decodeRareStringData({ index: [2, 4], value: [0, 1] }, ['open', 'closed'])]).toEqual(
			[
				[2, 'open'],
				[4, 'closed'],
			],
		)
		expect([...decodeRareBooleanData({ index: [1, 3] })]).toEqual([1, 3])
		expect([...decodeRareIntegerData({ index: [5], value: [9] })]).toEqual([[5, 9]])
		expect([...decodeRareStringData({ index: 'invalid' }, [])]).toEqual([])
		expect([...decodeRareBooleanData(undefined)]).toEqual([])
		expect([...decodeRareIntegerData({ index: [], value: 'invalid' })]).toEqual([])
	})

	it('decodes documents, sparse node state, iframe links, and requested layout data', () => {
		const snapshot = decodeBrowserSnapshot(createDOMSnapshotResult(), ['color'])

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
			type: 1,
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
		const snapshot = decodeBrowserSnapshot({
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
		expect(() => decodeBrowserSnapshot(createDOMSnapshotResult(), [], -1)).toThrow(
			'Browser snapshot limit must be a non-negative integer',
		)
		expect(() => decodeBrowserSnapshot(createDOMSnapshotResult(), [], 8)).toThrow(
			BrowserResultLimitError,
		)
		expect(() => decodeBrowserSnapshot(createDOMSnapshotResult(), [], 9)).not.toThrow()
	})

	it('rejects malformed top-level, string-table, document, metadata, and node data', () => {
		expect(() => decodeBrowserSnapshot(undefined)).toThrow(
			'Malformed DOMSnapshot.captureSnapshot result',
		)
		expect(() => decodeBrowserSnapshot({ strings: [42], documents: [] })).toThrow(
			'Malformed DOMSnapshot string table',
		)
		expect(() => decodeBrowserSnapshot({ strings: [], documents: [null] })).toThrow(
			'Malformed DOM snapshot document',
		)
		expect(() =>
			decodeBrowserSnapshot({
				strings: [],
				documents: [{ frameId: 0, documentURL: 0, title: 0, nodes: {} }],
			}),
		).toThrow('Malformed DOM snapshot document metadata')
		expect(() =>
			decodeBrowserSnapshot({
				strings: ['frame', 'url', 'title'],
				documents: [{ frameId: 0, documentURL: 1, title: 2, nodes: {} }],
			}),
		).toThrow('Malformed DOM snapshot node table')
		expect(() =>
			decodeBrowserSnapshot({
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
		const snapshot = decodeBrowserSnapshot(createDOMSnapshotResult(), ['color'])
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
		expect(attributeOfBrowserNode(node, 'id')).toBe('hero')
		expect(attributeOfBrowserNode(node, 'missing')).toBeUndefined()
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

describe('parseCodegenActionPayload', () => {
	it('parses a valid click payload', () => {
		const payload = JSON.stringify({ action: 'click', selector: '#a' })
		expect(parseCodegenActionPayload(payload)).toEqual({ action: 'click', selector: '#a' })
	})

	it('parses a valid fill payload', () => {
		const payload = JSON.stringify({ action: 'fill', selector: '#a', value: 'text' })
		expect(parseCodegenActionPayload(payload)).toEqual({
			action: 'fill',
			selector: '#a',
			value: 'text',
		})
	})

	it('parses a valid select payload', () => {
		const payload = JSON.stringify({ action: 'select', selector: '#a', values: ['x', 'y'] })
		expect(parseCodegenActionPayload(payload)).toEqual({
			action: 'select',
			selector: '#a',
			values: ['x', 'y'],
		})
	})

	it('returns undefined for invalid JSON', () => {
		expect(parseCodegenActionPayload('{not json')).toBeUndefined()
	})

	it('returns undefined for a non-string payload', () => {
		expect(parseCodegenActionPayload(42)).toBeUndefined()
	})

	it('returns undefined when the parsed JSON is not a record', () => {
		expect(parseCodegenActionPayload(JSON.stringify(['a', 'b']))).toBeUndefined()
		expect(parseCodegenActionPayload(JSON.stringify('a string'))).toBeUndefined()
		expect(parseCodegenActionPayload(JSON.stringify(null))).toBeUndefined()
	})

	it('returns undefined for an unknown action name', () => {
		expect(
			parseCodegenActionPayload(JSON.stringify({ action: 'scroll', selector: '#a' })),
		).toBeUndefined()
	})

	it('returns undefined for click missing selector', () => {
		expect(parseCodegenActionPayload(JSON.stringify({ action: 'click' }))).toBeUndefined()
	})

	it('returns undefined for click with a non-string selector', () => {
		expect(
			parseCodegenActionPayload(JSON.stringify({ action: 'click', selector: 1 })),
		).toBeUndefined()
	})

	it('returns undefined for fill missing value', () => {
		expect(
			parseCodegenActionPayload(JSON.stringify({ action: 'fill', selector: '#a' })),
		).toBeUndefined()
	})

	it('returns undefined for select with a non-array values field', () => {
		expect(
			parseCodegenActionPayload(JSON.stringify({ action: 'select', selector: '#a', values: 'x' })),
		).toBeUndefined()
	})

	it('returns undefined for select whose values contain a non-string element', () => {
		expect(
			parseCodegenActionPayload(
				JSON.stringify({ action: 'select', selector: '#a', values: ['x', 1] }),
			),
		).toBeUndefined()
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

describe('readCodegenNavigateAction', () => {
	it('derives a navigate action from a top-level frame', () => {
		const params = { frame: { url: 'https://example.com' } }
		expect(readCodegenNavigateAction(params)).toEqual({
			action: 'navigate',
			url: 'https://example.com',
		})
	})

	it('returns undefined for a sub-frame (has parentId)', () => {
		const params = { frame: { url: 'https://example.com', parentId: 'p1' } }
		expect(readCodegenNavigateAction(params)).toBeUndefined()
	})

	it('returns undefined when frame is missing', () => {
		expect(readCodegenNavigateAction({})).toBeUndefined()
	})

	it('returns undefined when frame is not a record', () => {
		expect(readCodegenNavigateAction({ frame: 'not-a-record' })).toBeUndefined()
	})

	it('returns undefined when the frame url is not a string', () => {
		expect(readCodegenNavigateAction({ frame: { url: 42 } })).toBeUndefined()
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
})
