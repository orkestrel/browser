/**
 * src/core/parsers.ts tests.
 */

import { describe, it, expect } from 'vitest'
import {
	parseBrowserToolInteger,
	parseBrowserJourney,
	parseBrowserJourneyEdit,
	parseBrowserRun,
	parseBrowserReference,
	parseBrowserTool,
	parseBrowserRemoval,
	parseBrowserInvocation,
	parseBrowserInvocationResult,
	parseBrowserConsoleMessage,
	parseBrowserRect,
	parseBrowserSecurity,
	parseBrowserTiming,
	parseBrowserTimingRange,
	parseCodegenActionPayload,
	parseNumberArray,
	parseSnapshotString,
} from '@src/core'
import { BROWSER_JOURNEY_FIXTURE, BROWSER_RUN_FIXTURE } from '../../setup.js'

describe('small refusals: tool integers', () => {
	it('accepts integers and canonical unsigned decimal strings', () => {
		for (const value of [7, '7']) expect(parseBrowserToolInteger(value)).toBe(7)
		expect(parseBrowserToolInteger('0')).toBe(0)
		expect(parseBrowserToolInteger(-1)).toBe(-1)
	})
	it.each([
		'7a',
		'1.5',
		'-1',
		'',
		'07',
		' 7',
		'7 ',
		'+7',
		'7e0',
		'0x7',
		null,
		undefined,
		true,
		{},
		1.5,
		NaN,
		Infinity,
	])('refuses %j', (value) => {
		expect(parseBrowserToolInteger(value)).toBeUndefined()
	})
})

describe('element references', () => {
	it('catches accepting invalid references or losing any of the six spellings', () => {
		expect(['e12', 'E12', '[e12]', 'ref=e12', '[ref=e12]'].map(parseBrowserReference)).toEqual([
			'e12',
			'e12',
			'e12',
			'e12',
			'e12',
		])
		expect(['12', 'x12', 'e0', 'e-1'].map(parseBrowserReference)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		])
	})
})

describe('WebMCP parsers', () => {
	it('decodes protocol tools, annotations, removals, and invocations', () => {
		expect(
			parseBrowserTool({
				name: 'search',
				description: 'Search',
				frameId: 'main',
				inputSchema: { type: 'object' },
				backendNodeId: 12,
				annotations: {
					readOnly: true,
					untrustedContent: false,
					consequential: true,
					debugging: false,
					autosubmit: true,
				},
			}),
		).toEqual({
			name: 'search',
			description: 'Search',
			frame: 'main',
			schema: { type: 'object' },
			node: 12,
			annotation: {
				readOnly: true,
				untrustedContent: false,
				consequential: true,
				debugging: false,
				autosubmit: true,
			},
		})
		expect(
			parseBrowserTool({
				name: 'search',
				description: 'Search',
				frameId: 'main',
				annotations: { readOnly: 'true' },
			}),
		).toEqual({
			name: 'search',
			description: 'Search',
			frame: 'main',
			schema: undefined,
			node: undefined,
			annotation: {},
		})
		expect(parseBrowserRemoval({ name: 'search', frameId: 'child' })).toEqual({
			name: 'search',
			frame: 'child',
		})
		expect(
			parseBrowserInvocation({
				invocationId: 'call',
				toolName: 'search',
				frameId: 'main',
				input: '{"query":"book"}',
			}),
		).toEqual({ id: 'call', tool: 'search', frame: 'main', input: '{"query":"book"}' })
	})

	it('preserves unknown output and statuses and falls back to exception descriptions', () => {
		const output = { content: [{ type: 'image', source: 'untrusted' }] }
		expect(
			parseBrowserInvocationResult({ invocationId: 'call', status: 'Completed', output })?.output,
		).toBe(output)
		expect(
			parseBrowserInvocationResult({
				invocationId: 'call',
				status: 'Error',
				exception: { description: 'Exception detail' },
			}),
		).toEqual({ id: 'call', status: 'Error', output: undefined, error: 'Exception detail' })
		expect(
			parseBrowserInvocationResult({
				invocationId: 'call',
				status: 'Error',
				errorText: '',
				exception: { description: 'ignored' },
			})?.error,
		).toBe('')
		expect(parseBrowserInvocationResult({ invocationId: 'call', status: 'Canceled' })?.status).toBe(
			'Canceled',
		)
		expect(
			parseBrowserInvocationResult({ invocationId: 'call', status: 'FutureStatus' })?.status,
		).toBe('FutureStatus')
	})

	it('refuses malformed required fields', () => {
		expect(parseBrowserTool(undefined)).toBeUndefined()
		expect(parseBrowserTool({ name: 'search', frameId: 'main' })).toBeUndefined()
		expect(parseBrowserRemoval({ name: 'search', frameId: 4 })).toBeUndefined()
		expect(
			parseBrowserInvocation({
				invocationId: 'call',
				toolName: 'search',
				frameId: 'main',
				input: {},
			}),
		).toBeUndefined()
		expect(parseBrowserInvocationResult({ invocationId: 'call', status: 2 })).toBeUndefined()
	})
})

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

describe('journey parsers', () => {
	it('round trips the journey and run through JSON', () => {
		expect(parseBrowserJourney(JSON.parse(JSON.stringify(BROWSER_JOURNEY_FIXTURE)))).toEqual(
			BROWSER_JOURNEY_FIXTURE,
		)
		expect(parseBrowserRun(JSON.parse(JSON.stringify(BROWSER_RUN_FIXTURE)))).toEqual(
			BROWSER_RUN_FIXTURE,
		)
		expect(parseBrowserJourney(BROWSER_JOURNEY_FIXTURE)).toBe(BROWSER_JOURNEY_FIXTURE)
	})
	it('returns undefined on invalid journeys, edits, and runs', () => {
		expect(parseBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, format: 2 })).toBeUndefined()
		expect(parseBrowserJourneyEdit({ operation: 'remove', id: 4 })).toBeUndefined()
		expect(parseBrowserJourneyEdit({ operation: 'remove', id: 's1' })).toEqual({
			operation: 'remove',
			id: 's1',
		})
		expect(parseBrowserRun({ ...BROWSER_RUN_FIXTURE, elapsed: NaN })).toBeUndefined()
	})
	it('preserves page-tool ref and tab keys as literal JSON', () => {
		const journey = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [
				{
					id: 's1',
					action: 'reserve',
					arguments: { ref: 'stock', tab: 'warehouse', nested: { parameter: 'literal' } },
				},
			],
		}
		expect(parseBrowserJourney(journey)).toEqual(journey)
	})
	it('contains hostile property reads', () => {
		const value = Object.defineProperty({}, 'format', {
			enumerable: true,
			get: () => {
				throw new Error('hostile')
			},
		})
		expect(parseBrowserJourney(value)).toBeUndefined()
		expect(parseBrowserJourneyEdit(value)).toBeUndefined()
		expect(parseBrowserRun(value)).toBeUndefined()
	})
})

describe('parseCodegenActionPayload', () => {
	it('accepts complete click, text, password, Enter, and select gestures', () => {
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'click',
					control: 'other',
					index: 0,
					top: true,
					form: false,
					detail: 1,
				}),
			),
		).toEqual({ event: 'click', control: 'other', index: 0, top: true, form: false, detail: 1 })
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'input',
					control: 'text',
					index: 1,
					top: true,
					form: true,
					value: '',
				}),
			)?.value,
		).toBe('')
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'input',
					control: 'password',
					index: 1,
					top: true,
					form: true,
					secret: true,
				}),
			)?.secret,
		).toBe(true)
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'keydown',
					control: 'text',
					index: 1,
					top: true,
					form: true,
					key: 'Enter',
				}),
			)?.key,
		).toBe('Enter')
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'change',
					control: 'select',
					index: 1,
					top: true,
					form: true,
					value: 'm',
					roundtrip: false,
				}),
			)?.roundtrip,
		).toBe(false)
	})
	it('contains malformed JSON, unknown fields, invalid coordinates, and retired actions', () => {
		expect(parseCodegenActionPayload('{')).toBeUndefined()
		expect(parseCodegenActionPayload(42)).toBeUndefined()
		expect(parseCodegenActionPayload('null')).toBeUndefined()
		expect(parseCodegenActionPayload('[]')).toBeUndefined()
		expect(
			parseCodegenActionPayload(JSON.stringify({ action: 'click', selector: '#save' })),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'click',
					control: 'other',
					index: -1,
					top: true,
					form: false,
					detail: 1,
				}),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'click',
					control: 'other',
					index: 0.5,
					top: true,
					form: false,
					detail: 1,
				}),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'click',
					control: 'other',
					index: 0,
					top: true,
					form: false,
					detail: 1,
					answer: 'private',
				}),
			),
		).toBeUndefined()
	})
	it('refuses password values and keys other than Enter', () => {
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'input',
					control: 'password',
					index: 0,
					top: true,
					form: true,
					value: 'teal-Heron-42',
					secret: true,
				}),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({ event: 'input', control: 'password', index: 0, top: true, form: true }),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'keydown',
					control: 'password',
					index: 0,
					top: true,
					form: true,
					key: 't',
				}),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({ event: 'keydown', control: 'text', index: 0, top: true, form: true }),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'click',
					control: 'text',
					index: 0,
					top: true,
					form: true,
					detail: 1,
					key: 'Enter',
				}),
			),
		).toBeUndefined()
	})
	it('refuses missing text, click detail, select roundtrip, and malformed gaps', () => {
		expect(
			parseCodegenActionPayload(
				JSON.stringify({ event: 'input', control: 'text', index: 0, top: true, form: false }),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({ event: 'click', control: 'other', index: 0, top: true, form: false }),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'change',
					control: 'select',
					index: 0,
					top: true,
					form: false,
					value: 'm',
				}),
			),
		).toBeUndefined()
		expect(
			parseCodegenActionPayload(
				JSON.stringify({
					event: 'unsupported',
					control: 'other',
					index: 0,
					top: true,
					form: false,
					gap: 1,
				}),
			),
		).toBeUndefined()
	})
})
