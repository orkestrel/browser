/**
 * src/core/parsers.ts tests.
 */

import { describe, it, expect } from 'vitest'
import {
	parseBrowserConsoleMessage,
	parseBrowserRect,
	parseBrowserSecurity,
	parseBrowserTiming,
	parseBrowserTimingRange,
	parseCodegenActionPayload,
	parseCodegenNavigateAction,
	parseNumberArray,
	parseSnapshotString,
} from '@src/core'

describe('network timing parsers', () => {
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

		expect(parseBrowserTiming(timing)).toEqual({
			request: 10,
			proxy: undefined,
			dns: { start: 0, end: 2 },
			connect: { start: 2, end: 5 },
			ssl: { start: 3, end: 5 },
			send: { start: 5, end: 6 },
			receive: 9,
		})
		expect(parseBrowserTimingRange(timing, 'dnsStart', 'dnsEnd')).toEqual({
			start: 0,
			end: 2,
		})
	})

	it('rejects non-finite, negative, and reversed protocol timing values', () => {
		expect(parseBrowserTiming({ requestTime: Number.NaN })).toBeUndefined()
		expect(parseBrowserTiming({ requestTime: -1 })).toBeUndefined()
		expect(parseBrowserTimingRange({ start: 2, end: 1 }, 'start', 'end')).toBeUndefined()
		expect(
			parseBrowserTimingRange({ start: 0, end: Number.POSITIVE_INFINITY }, 'start', 'end'),
		).toBeUndefined()
	})

	it('decodes ordered certificate validity and rejects malformed bounds', () => {
		expect(
			parseBrowserSecurity({
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
			parseBrowserSecurity({
				protocol: 'TLS 1.3',
				issuer: 'Example CA',
				validFrom: 200,
				validTo: 100,
			}),
		).toBeUndefined()
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

describe('parseCodegenNavigateAction', () => {
	it('derives a navigate action from a top-level frame', () => {
		const params = { frame: { url: 'https://example.com' } }
		expect(parseCodegenNavigateAction(params)).toEqual({
			action: 'navigate',
			url: 'https://example.com',
		})
	})

	it('returns undefined for a sub-frame (has parentId)', () => {
		const params = { frame: { url: 'https://example.com', parentId: 'p1' } }
		expect(parseCodegenNavigateAction(params)).toBeUndefined()
	})

	it('returns undefined when frame is missing', () => {
		expect(parseCodegenNavigateAction({})).toBeUndefined()
	})

	it('returns undefined when frame is not a record', () => {
		expect(parseCodegenNavigateAction({ frame: 'not-a-record' })).toBeUndefined()
	})

	it('returns undefined when the frame url is not a string', () => {
		expect(parseCodegenNavigateAction({ frame: { url: 42 } })).toBeUndefined()
	})
})

describe('parseBrowserConsoleMessage', () => {
	it('contains cyclic console serialization without dropping the event', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic['self'] = cyclic

		expect(
			parseBrowserConsoleMessage({
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
})

describe('snapshot value parsers', () => {
	it('coerces number arrays, string indexes, and rectangles, or reports undefined', () => {
		expect(parseNumberArray([1, 2.5, -3])).toEqual([1, 2.5, -3])
		expect(parseNumberArray([1, '2'])).toBeUndefined()
		expect(parseNumberArray([Number.NaN])).toBeUndefined()
		expect(parseNumberArray([Number.POSITIVE_INFINITY])).toBeUndefined()
		expect(parseSnapshotString(['zero', 'one'], 1)).toBe('one')
		expect(parseSnapshotString(['zero'], 99)).toBeUndefined()
		expect(parseBrowserRect([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
		expect(parseBrowserRect([1, 2, 3])).toBeUndefined()
	})
})
