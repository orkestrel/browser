/**
 * src/core/helpers.ts tests.
 */

import { describe, it, expect } from 'vitest'
import {
	decodeBase64,
	normalizeCodegenActions,
	parseCodegenActionPayload,
	readCodegenNavigateAction,
	compileCodegenScript,
} from '@src/core'
import type { BrowserCodegenAction } from '@src/core'
import { PNG_BASE64, JPEG_BASE64 } from '../../setup.js'

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

describe('compileCodegenScript', () => {
	const actions: BrowserCodegenAction[] = [
		{ action: 'navigate', url: 'about:blank' },
		{ action: 'click', selector: '#a' },
		{ action: 'fill', selector: '#b', value: 'hi' },
		{ action: 'select', selector: '#c', values: ['x', 'y'] },
	]

	it('emits an async run(page) wrapper with one statement per action (javascript default)', () => {
		const script = compileCodegenScript(actions)
		expect(script.startsWith('async function run(page) {')).toBe(true)
		expect(script).not.toContain('import(')
		const lines = script.split('\n')
		expect(lines).toHaveLength(actions.length + 2)
		expect(lines[1]).toBe(`\tawait page.navigate("about:blank")`)
		expect(lines[2]).toBe(`\tawait page.click("#a")`)
		expect(lines[3]).toBe(`\tawait page.fill("#b", "hi")`)
		expect(lines[4]).toBe(`\tawait page.select("#c", ["x","y"])`)
	})

	it('emits a TypeScript-typed page parameter only when language is typescript', () => {
		const script = compileCodegenScript(actions, { language: 'typescript' })
		expect(
			script.startsWith(
				`async function run(page: import('@orkestrel/browser').BrowserPageInterface): Promise<void> {`,
			),
		).toBe(true)
	})

	it('embeds a selector containing quotes safely via JSON-safe quoting', () => {
		const withQuote: BrowserCodegenAction[] = [{ action: 'click', selector: `div[data-x="y"]` }]
		const script = compileCodegenScript(withQuote)
		const expectedLine = `\tawait page.click(${JSON.stringify(`div[data-x="y"]`)})`
		expect(script).toContain(expectedLine)
		// The embedded quotes are escaped, not left bare.
		expect(script).toContain('\\"y\\"')
	})

	it('emits an empty body for an empty action list', () => {
		const script = compileCodegenScript([])
		expect(script).toBe('async function run(page) {\n}')
	})
})
