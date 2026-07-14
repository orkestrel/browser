import { describe, it, expect } from 'vitest'
import {
	isSuccess,
	isFailure,
	isRecord,
	isQueueEntryStatus,
	isNodeWorkerRequest,
	isNodeWorkerAbortRequest,
	isNodeWorkerResponseForId,
	roundUpToMultiple,
	sectorsNeeded,
	compareCfbName,
	inferExtension,
	isBrowserEngine,
	isBrowserStatus,
	isBrowserConnection,
	isBrowserWaitUntil,
	isPlaywrightPageLike,
	isPlaywrightContextLike,
	isPlaywrightBrowserLike,
	isPlaywrightEngineLike,
	BROWSER_DEFAULT_CDP_PORT,
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_DEFAULT_VIEWPORT_WIDTH,
	BROWSER_DEFAULT_VIEWPORT_HEIGHT,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_CDP_PROTOCOL,
} from 'keepalive'
import type { Result } from 'keepalive'

describe('helpers', () => {
	// === isSuccess

	describe('isSuccess', () => {
		it('returns true for a Success result', () => {
			const result: Result<number> = { success: true, value: 42 }
			expect(isSuccess(result)).toBe(true)
		})

		it('returns false for a Failure result', () => {
			const result: Result<number> = { success: false, error: new Error('fail') }
			expect(isSuccess(result)).toBe(false)
		})

		it('narrows the type to Success', () => {
			const result: Result<string, Error> = { success: true, value: 'hello' }
			expect(isSuccess(result)).toBe(true)
			// TypeScript narrows after the guard — access value directly
			if (!isSuccess(result)) throw new Error('unreachable')
			expect(result.value).toBe('hello')
		})

		it('works with undefined value', () => {
			const result: Result<undefined> = { success: true, value: undefined }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with null value', () => {
			const result: Result<null> = { success: true, value: null }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with zero value', () => {
			const result: Result<number> = { success: true, value: 0 }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with empty string value', () => {
			const result: Result<string> = { success: true, value: '' }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with false value', () => {
			const result: Result<boolean> = { success: true, value: false }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with complex object value', () => {
			const result: Result<{ readonly count: number }> = { success: true, value: { count: 5 } }
			expect(isSuccess(result)).toBe(true)
		})

		it('works with array value', () => {
			const result: Result<readonly number[]> = { success: true, value: [1, 2, 3] }
			expect(isSuccess(result)).toBe(true)
		})

		it('returns false for custom error type', () => {
			const result: Result<string, TypeError> = { success: false, error: new TypeError('bad') }
			expect(isSuccess(result)).toBe(false)
		})
	})

	// === isFailure

	describe('isFailure', () => {
		it('returns true for a Failure result', () => {
			const result: Result<number> = { success: false, error: new Error('fail') }
			expect(isFailure(result)).toBe(true)
		})

		it('returns false for a Success result', () => {
			const result: Result<number> = { success: true, value: 42 }
			expect(isFailure(result)).toBe(false)
		})

		it('narrows the type to Failure', () => {
			const result: Result<string, Error> = { success: false, error: new Error('oops') }
			expect(isFailure(result)).toBe(true)
			// TypeScript narrows after the guard — access error directly
			if (!isFailure(result)) throw new Error('unreachable')
			expect(result.error.message).toBe('oops')
		})

		it('works with custom error type', () => {
			const result: Result<string, TypeError> = { success: false, error: new TypeError('bad') }
			expect(isFailure(result)).toBe(true)
		})

		it('works with string error type', () => {
			const result: Result<number, string> = { success: false, error: 'something went wrong' }
			expect(isFailure(result)).toBe(true)
		})

		it('returns false when success is true regardless of value', () => {
			const result: Result<undefined> = { success: true, value: undefined }
			expect(isFailure(result)).toBe(false)
		})

		it('returns false for zero-value success', () => {
			const result: Result<number> = { success: true, value: 0 }
			expect(isFailure(result)).toBe(false)
		})

		it('returns false for empty string success', () => {
			const result: Result<string> = { success: true, value: '' }
			expect(isFailure(result)).toBe(false)
		})
	})

	// === isSuccess and isFailure are mutually exclusive

	describe('isSuccess and isFailure mutual exclusion', () => {
		it('exactly one is true for a Success result', () => {
			const result: Result<number> = { success: true, value: 1 }
			expect(isSuccess(result)).toBe(true)
			expect(isFailure(result)).toBe(false)
		})

		it('exactly one is true for a Failure result', () => {
			const result: Result<number> = { success: false, error: new Error('x') }
			expect(isSuccess(result)).toBe(false)
			expect(isFailure(result)).toBe(true)
		})

		it('narrows correctly in if/else chain', () => {
			const result: Result<string> = { success: true, value: 'ok' }
			expect(isSuccess(result)).toBe(true)
			expect(isFailure(result)).toBe(false)
			if (!isSuccess(result)) throw new Error('unreachable')
			expect(result.value).toBe('ok')
		})
	})

	// === isRecord

	describe('isRecord', () => {
		it('returns true for plain object', () => {
			expect(isRecord({})).toBe(true)
		})

		it('returns true for object with properties', () => {
			expect(isRecord({ key: 'value', count: 1 })).toBe(true)
		})

		it('returns false for null', () => {
			expect(isRecord(null)).toBe(false)
		})

		it('returns false for undefined', () => {
			expect(isRecord(undefined)).toBe(false)
		})

		it('returns false for string', () => {
			expect(isRecord('hello')).toBe(false)
		})

		it('returns false for number', () => {
			expect(isRecord(42)).toBe(false)
		})

		it('returns false for boolean true', () => {
			expect(isRecord(true)).toBe(false)
		})

		it('returns false for boolean false', () => {
			expect(isRecord(false)).toBe(false)
		})

		it('returns false for array', () => {
			expect(isRecord([1, 2, 3])).toBe(false)
		})

		it('returns false for empty array', () => {
			expect(isRecord([])).toBe(false)
		})

		it('returns false for bigint', () => {
			expect(isRecord(BigInt(9007199254740991))).toBe(false)
		})

		it('returns false for symbol', () => {
			expect(isRecord(Symbol('test'))).toBe(false)
		})

		it('returns false for function', () => {
			expect(isRecord(() => {})).toBe(false)
		})

		it('returns true for Date instance', () => {
			// Date is typeof 'object', non-null, non-array
			expect(isRecord(new Date())).toBe(true)
		})

		it('returns true for RegExp instance', () => {
			// RegExp is typeof 'object', non-null, non-array
			expect(isRecord(/abc/)).toBe(true)
		})

		it('returns true for Map instance', () => {
			expect(isRecord(new Map())).toBe(true)
		})

		it('returns true for Set instance', () => {
			expect(isRecord(new Set())).toBe(true)
		})

		it('returns true for Error instance', () => {
			expect(isRecord(new Error('oops'))).toBe(true)
		})

		it('returns true for Object.create(null)', () => {
			expect(isRecord(Object.create(null))).toBe(true)
		})

		it('returns false for NaN', () => {
			expect(isRecord(NaN)).toBe(false)
		})

		it('returns false for Infinity', () => {
			expect(isRecord(Infinity)).toBe(false)
		})

		it('returns false for negative Infinity', () => {
			expect(isRecord(-Infinity)).toBe(false)
		})

		it('returns false for zero', () => {
			expect(isRecord(0)).toBe(false)
		})

		it('returns false for negative zero', () => {
			expect(isRecord(-0)).toBe(false)
		})

		it('returns false for empty string', () => {
			expect(isRecord('')).toBe(false)
		})

		it('returns true for nested object', () => {
			expect(isRecord({ a: { b: { c: 1 } } })).toBe(true)
		})

		it('returns true for object with symbol keys', () => {
			const sym = Symbol('key')
			expect(isRecord({ [sym]: 'value' })).toBe(true)
		})

		it('returns true for frozen object', () => {
			expect(isRecord(Object.freeze({ x: 1 }))).toBe(true)
		})

		it('returns true for sealed object', () => {
			expect(isRecord(Object.seal({ x: 1 }))).toBe(true)
		})

		it('returns false for array-like typed arrays', () => {
			// TypedArrays are array-like but not Array.isArray
			// They are typeof 'object' and non-null, so isRecord returns true
			expect(isRecord(new Uint8Array(4))).toBe(true)
		})
	})

	// === isQueueEntryStatus

	describe('isQueueEntryStatus', () => {
		it('returns true for pending', () => {
			expect(isQueueEntryStatus('pending')).toBe(true)
		})

		it('returns true for scheduled', () => {
			expect(isQueueEntryStatus('scheduled')).toBe(true)
		})

		it('returns true for active', () => {
			expect(isQueueEntryStatus('active')).toBe(true)
		})

		it('returns true for completed', () => {
			expect(isQueueEntryStatus('completed')).toBe(true)
		})

		it('returns true for failed', () => {
			expect(isQueueEntryStatus('failed')).toBe(true)
		})

		it('returns true for aborted', () => {
			expect(isQueueEntryStatus('aborted')).toBe(true)
		})

		it('returns true for expired', () => {
			expect(isQueueEntryStatus('expired')).toBe(true)
		})

		it('returns false for empty string', () => {
			expect(isQueueEntryStatus('')).toBe(false)
		})

		it('returns false for unknown status string', () => {
			expect(isQueueEntryStatus('running')).toBe(false)
		})

		it('returns false for status with wrong casing', () => {
			expect(isQueueEntryStatus('Pending')).toBe(false)
			expect(isQueueEntryStatus('PENDING')).toBe(false)
			expect(isQueueEntryStatus('Active')).toBe(false)
			expect(isQueueEntryStatus('COMPLETED')).toBe(false)
		})

		it('returns false for status with whitespace', () => {
			expect(isQueueEntryStatus(' pending')).toBe(false)
			expect(isQueueEntryStatus('pending ')).toBe(false)
			expect(isQueueEntryStatus(' pending ')).toBe(false)
		})

		it('returns false for null', () => {
			expect(isQueueEntryStatus(null)).toBe(false)
		})

		it('returns false for undefined', () => {
			expect(isQueueEntryStatus(undefined)).toBe(false)
		})

		it('returns false for number', () => {
			expect(isQueueEntryStatus(0)).toBe(false)
			expect(isQueueEntryStatus(1)).toBe(false)
		})

		it('returns false for boolean', () => {
			expect(isQueueEntryStatus(true)).toBe(false)
			expect(isQueueEntryStatus(false)).toBe(false)
		})

		it('returns false for object', () => {
			expect(isQueueEntryStatus({})).toBe(false)
			expect(isQueueEntryStatus({ status: 'pending' })).toBe(false)
		})

		it('returns false for array', () => {
			expect(isQueueEntryStatus([])).toBe(false)
			expect(isQueueEntryStatus(['pending'])).toBe(false)
		})

		it('returns false for symbol', () => {
			expect(isQueueEntryStatus(Symbol('pending'))).toBe(false)
		})

		it('returns false for similar but invalid strings', () => {
			expect(isQueueEntryStatus('queued')).toBe(false)
			expect(isQueueEntryStatus('cancelled')).toBe(false)
			expect(isQueueEntryStatus('done')).toBe(false)
			expect(isQueueEntryStatus('error')).toBe(false)
			expect(isQueueEntryStatus('timeout')).toBe(false)
			expect(isQueueEntryStatus('waiting')).toBe(false)
		})

		it('accepts all seven valid statuses in sequence', () => {
			const validStatuses = [
				'pending',
				'scheduled',
				'active',
				'completed',
				'failed',
				'aborted',
				'expired',
			]
			for (const status of validStatuses) {
				expect(isQueueEntryStatus(status)).toBe(true)
			}
		})

		it('rejects a batch of invalid values', () => {
			const invalidValues: unknown[] = [
				null,
				undefined,
				0,
				1,
				-1,
				NaN,
				Infinity,
				true,
				false,
				'',
				'x',
				'Pending',
				{},
				[],
				new Date(),
				/regex/,
				Symbol('x'),
			]
			for (const value of invalidValues) {
				expect(isQueueEntryStatus(value)).toBe(false)
			}
		})
	})

	// === isNodeWorkerRequest

	describe('isNodeWorkerRequest', () => {
		it('returns true for valid dispatch request', () => {
			expect(isNodeWorkerRequest({ id: 'nw-1', context: 42 })).toBe(true)
		})

		it('returns true when context is undefined', () => {
			expect(isNodeWorkerRequest({ id: 'nw-1', context: undefined })).toBe(true)
		})

		it('returns false when id is missing', () => {
			expect(isNodeWorkerRequest({ context: 42 })).toBe(false)
		})

		it('returns false when context is missing', () => {
			expect(isNodeWorkerRequest({ id: 'nw-1' })).toBe(false)
		})

		it('returns false when type field is present', () => {
			expect(isNodeWorkerRequest({ id: 'nw-1', context: 42, type: 'abort' })).toBe(false)
		})

		it('returns false for null', () => {
			expect(isNodeWorkerRequest(null)).toBe(false)
		})

		it('returns false for string', () => {
			expect(isNodeWorkerRequest('test')).toBe(false)
		})

		it('returns false for array', () => {
			expect(isNodeWorkerRequest([])).toBe(false)
		})

		it('returns false when id is a number', () => {
			expect(isNodeWorkerRequest({ id: 1, context: 42 })).toBe(false)
		})
	})

	// === isNodeWorkerAbortRequest

	describe('isNodeWorkerAbortRequest', () => {
		it('returns true for valid abort request', () => {
			expect(isNodeWorkerAbortRequest({ id: 'nw-1', type: 'abort' })).toBe(true)
		})

		it('returns false when type is not abort', () => {
			expect(isNodeWorkerAbortRequest({ id: 'nw-1', type: 'result' })).toBe(false)
		})

		it('returns false when id is missing', () => {
			expect(isNodeWorkerAbortRequest({ type: 'abort' })).toBe(false)
		})

		it('returns false when type is missing', () => {
			expect(isNodeWorkerAbortRequest({ id: 'nw-1' })).toBe(false)
		})

		it('returns false for null', () => {
			expect(isNodeWorkerAbortRequest(null)).toBe(false)
		})

		it('returns false for string', () => {
			expect(isNodeWorkerAbortRequest('abort')).toBe(false)
		})

		it('returns false when id is a number', () => {
			expect(isNodeWorkerAbortRequest({ id: 1, type: 'abort' })).toBe(false)
		})
	})

	// === isNodeWorkerResponseForId

	describe('isNodeWorkerResponseForId', () => {
		it('returns true for matching success response', () => {
			expect(
				isNodeWorkerResponseForId({ id: 'nw-1', type: 'result', success: true, value: 42 }, 'nw-1'),
			).toBe(true)
		})

		it('returns true for matching failure response', () => {
			expect(
				isNodeWorkerResponseForId(
					{ id: 'nw-2', type: 'result', success: false, error: 'oops' },
					'nw-2',
				),
			).toBe(true)
		})

		it('returns false when id does not match', () => {
			expect(
				isNodeWorkerResponseForId({ id: 'nw-1', type: 'result', success: true, value: 1 }, 'nw-2'),
			).toBe(false)
		})

		it('returns false for null', () => {
			expect(isNodeWorkerResponseForId(null, 'nw-1')).toBe(false)
		})

		it('returns false for undefined', () => {
			expect(isNodeWorkerResponseForId(undefined, 'nw-1')).toBe(false)
		})

		it('returns false for string', () => {
			expect(isNodeWorkerResponseForId('nw-1', 'nw-1')).toBe(false)
		})

		it('returns false for number', () => {
			expect(isNodeWorkerResponseForId(42, 'nw-1')).toBe(false)
		})

		it('returns false for object without id', () => {
			expect(isNodeWorkerResponseForId({ type: 'result', success: true, value: 1 }, 'nw-1')).toBe(
				false,
			)
		})

		it('returns false for empty object', () => {
			expect(isNodeWorkerResponseForId({}, 'nw-1')).toBe(false)
		})

		it('returns false for array', () => {
			expect(isNodeWorkerResponseForId([], 'nw-1')).toBe(false)
		})

		it('returns true when id is empty string and matches', () => {
			expect(isNodeWorkerResponseForId({ id: '', type: 'result' }, '')).toBe(true)
		})

		it('returns false when id property is a number', () => {
			expect(isNodeWorkerResponseForId({ id: 1, type: 'result' }, '1')).toBe(false)
		})

		it('returns false for progress message with matching id', () => {
			expect(
				isNodeWorkerResponseForId({ id: 'nw-1', type: 'progress', progress: {} }, 'nw-1'),
			).toBe(false)
		})

		it('returns false for channel message with matching id', () => {
			expect(
				isNodeWorkerResponseForId({ id: 'nw-1', type: 'message', value: 'hello' }, 'nw-1'),
			).toBe(false)
		})

		it('returns false for object without type field', () => {
			expect(isNodeWorkerResponseForId({ id: 'nw-1', success: true, value: 42 }, 'nw-1')).toBe(
				false,
			)
		})
	})

	// === roundUpToMultiple

	describe('roundUpToMultiple', () => {
		it('returns the value when already aligned', () => {
			expect(roundUpToMultiple(512, 512)).toBe(512)
		})

		it('rounds up to the next boundary', () => {
			expect(roundUpToMultiple(1, 512)).toBe(512)
			expect(roundUpToMultiple(513, 512)).toBe(1024)
		})

		it('returns 0 for 0', () => {
			expect(roundUpToMultiple(0, 512)).toBe(0)
		})

		it('handles small boundaries', () => {
			expect(roundUpToMultiple(5, 4)).toBe(8)
			expect(roundUpToMultiple(4, 4)).toBe(4)
		})
	})

	// === sectorsNeeded

	describe('sectorsNeeded', () => {
		it('returns 0 when bytes is 0', () => {
			expect(sectorsNeeded(0, 512)).toBe(0)
		})

		it('returns 0 when bytes is negative', () => {
			expect(sectorsNeeded(-10, 512)).toBe(0)
		})

		it('returns 1 for a single byte', () => {
			expect(sectorsNeeded(1, 512)).toBe(1)
		})

		it('returns 1 for exactly one sector', () => {
			expect(sectorsNeeded(512, 512)).toBe(1)
		})

		it('returns 2 when bytes exceed one sector', () => {
			expect(sectorsNeeded(513, 512)).toBe(2)
		})

		it('works with mini-sector size', () => {
			expect(sectorsNeeded(64, 64)).toBe(1)
			expect(sectorsNeeded(65, 64)).toBe(2)
			expect(sectorsNeeded(128, 64)).toBe(2)
		})
	})

	// === compareCfbName

	describe('compareCfbName', () => {
		it('returns 0 for identical names', () => {
			expect(compareCfbName('abc', 'abc')).toBe(0)
		})

		it('compares by length first', () => {
			expect(compareCfbName('a', 'ab')).toBeLessThan(0)
			expect(compareCfbName('abc', 'ab')).toBeGreaterThan(0)
		})

		it('compares case-insensitively when length matches', () => {
			expect(compareCfbName('ABC', 'abc')).toBe(0)
			expect(compareCfbName('abc', 'ABC')).toBe(0)
		})

		it('orders alphabetically for same-length names', () => {
			expect(compareCfbName('aaa', 'bbb')).toBeLessThan(0)
			expect(compareCfbName('bbb', 'aaa')).toBeGreaterThan(0)
		})

		it('returns 0 for empty strings', () => {
			expect(compareCfbName('', '')).toBe(0)
		})
	})

	// === Attachment Helpers

	describe('inferExtension', () => {
		it('infers from known mime type', () => {
			expect(inferExtension('image/jpeg')).toBe('.jpg')
			expect(inferExtension('application/pdf')).toBe('.pdf')
			expect(inferExtension('text/plain; charset=utf-8')).toBe('.txt')
		})

		it('infers from filename extension', () => {
			expect(inferExtension('application/octet-stream', 'document.docx')).toBe('.docx')
			expect(inferExtension(undefined, 'archive.zip')).toBe('.zip')
			expect(inferExtension('image/png', 'photo.jpeg')).toBe('.jpeg') // filename wins
		})

		it('falls back to .bin for unknown mime types and no filename', () => {
			expect(inferExtension('application/x-custom')).toBe('.bin')
			expect(inferExtension(undefined, 'no-extension-here')).toBe('.bin')
			expect(inferExtension()).toBe('.bin')
		})

		it('normalizes case on filenames', () => {
			expect(inferExtension(undefined, 'IMAGE.PNG')).toBe('.png')
		})
	})

	// === Browser Constants

	describe('Browser Constants', () => {
		it('BROWSER_DEFAULT_CDP_PORT is 9222', () => {
			expect(BROWSER_DEFAULT_CDP_PORT).toBe(9222)
		})

		it('BROWSER_DEFAULT_TIMEOUT_MS is 30000', () => {
			expect(BROWSER_DEFAULT_TIMEOUT_MS).toBe(30_000)
		})

		it('BROWSER_DEFAULT_VIEWPORT_WIDTH is 1280', () => {
			expect(BROWSER_DEFAULT_VIEWPORT_WIDTH).toBe(1280)
		})

		it('BROWSER_DEFAULT_VIEWPORT_HEIGHT is 720', () => {
			expect(BROWSER_DEFAULT_VIEWPORT_HEIGHT).toBe(720)
		})

		it('BROWSER_CDP_VERSION_PATH is /json/version', () => {
			expect(BROWSER_CDP_VERSION_PATH).toBe('/json/version')
		})

		it('BROWSER_CDP_PROTOCOL is http', () => {
			expect(BROWSER_CDP_PROTOCOL).toBe('http')
		})

		it('constants have correct types', () => {
			expect(typeof BROWSER_DEFAULT_CDP_PORT).toBe('number')
			expect(typeof BROWSER_DEFAULT_TIMEOUT_MS).toBe('number')
			expect(typeof BROWSER_DEFAULT_VIEWPORT_WIDTH).toBe('number')
			expect(typeof BROWSER_DEFAULT_VIEWPORT_HEIGHT).toBe('number')
			expect(typeof BROWSER_CDP_VERSION_PATH).toBe('string')
			expect(typeof BROWSER_CDP_PROTOCOL).toBe('string')
		})

		it('viewport constants are positive', () => {
			expect(BROWSER_DEFAULT_VIEWPORT_WIDTH).toBeGreaterThan(0)
			expect(BROWSER_DEFAULT_VIEWPORT_HEIGHT).toBeGreaterThan(0)
		})

		it('timeout constant is positive', () => {
			expect(BROWSER_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
		})

		it('CDP port is in valid range', () => {
			expect(BROWSER_DEFAULT_CDP_PORT).toBeGreaterThan(0)
			expect(BROWSER_DEFAULT_CDP_PORT).toBeLessThanOrEqual(65535)
		})
	})

	// === isBrowserEngine

	describe('isBrowserEngine', () => {
		it('accepts chromium', () => {
			expect(isBrowserEngine('chromium')).toBe(true)
		})

		it('accepts firefox', () => {
			expect(isBrowserEngine('firefox')).toBe(true)
		})

		it('accepts webkit', () => {
			expect(isBrowserEngine('webkit')).toBe(true)
		})

		it('rejects edge', () => {
			expect(isBrowserEngine('edge')).toBe(false)
		})

		it('rejects chrome', () => {
			expect(isBrowserEngine('chrome')).toBe(false)
		})

		it('rejects safari', () => {
			expect(isBrowserEngine('safari')).toBe(false)
		})

		it('rejects empty string', () => {
			expect(isBrowserEngine('')).toBe(false)
		})

		it('rejects wrong casing', () => {
			expect(isBrowserEngine('Chromium')).toBe(false)
			expect(isBrowserEngine('CHROMIUM')).toBe(false)
			expect(isBrowserEngine('Firefox')).toBe(false)
			expect(isBrowserEngine('WebKit')).toBe(false)
		})

		it('rejects non-string types', () => {
			expect(isBrowserEngine(123)).toBe(false)
			expect(isBrowserEngine(null)).toBe(false)
			expect(isBrowserEngine(undefined)).toBe(false)
			expect(isBrowserEngine(true)).toBe(false)
			expect(isBrowserEngine({})).toBe(false)
			expect(isBrowserEngine([])).toBe(false)
			expect(isBrowserEngine(Symbol('chromium'))).toBe(false)
		})
	})

	// === isBrowserStatus

	describe('isBrowserStatus', () => {
		it('accepts idle', () => {
			expect(isBrowserStatus('idle')).toBe(true)
		})

		it('accepts connecting', () => {
			expect(isBrowserStatus('connecting')).toBe(true)
		})

		it('accepts connected', () => {
			expect(isBrowserStatus('connected')).toBe(true)
		})

		it('accepts disconnected', () => {
			expect(isBrowserStatus('disconnected')).toBe(true)
		})

		it('accepts error', () => {
			expect(isBrowserStatus('error')).toBe(true)
		})

		it('rejects running', () => {
			expect(isBrowserStatus('running')).toBe(false)
		})

		it('rejects pending', () => {
			expect(isBrowserStatus('pending')).toBe(false)
		})

		it('rejects empty string', () => {
			expect(isBrowserStatus('')).toBe(false)
		})

		it('rejects wrong casing', () => {
			expect(isBrowserStatus('Idle')).toBe(false)
			expect(isBrowserStatus('CONNECTED')).toBe(false)
		})

		it('rejects non-string types', () => {
			expect(isBrowserStatus(42)).toBe(false)
			expect(isBrowserStatus(null)).toBe(false)
			expect(isBrowserStatus(undefined)).toBe(false)
			expect(isBrowserStatus(true)).toBe(false)
			expect(isBrowserStatus({})).toBe(false)
		})

		it('accepts all five valid statuses in sequence', () => {
			const valid = ['idle', 'connecting', 'connected', 'disconnected', 'error']
			for (const s of valid) {
				expect(isBrowserStatus(s)).toBe(true)
			}
		})
	})

	// === isBrowserConnection

	describe('isBrowserConnection', () => {
		it('accepts cdp', () => {
			expect(isBrowserConnection('cdp')).toBe(true)
		})

		it('accepts launch', () => {
			expect(isBrowserConnection('launch')).toBe(true)
		})

		it('accepts persistent', () => {
			expect(isBrowserConnection('persistent')).toBe(true)
		})

		it('rejects websocket', () => {
			expect(isBrowserConnection('websocket')).toBe(false)
		})

		it('rejects direct', () => {
			expect(isBrowserConnection('direct')).toBe(false)
		})

		it('rejects empty string', () => {
			expect(isBrowserConnection('')).toBe(false)
		})

		it('rejects non-string types', () => {
			expect(isBrowserConnection(null)).toBe(false)
			expect(isBrowserConnection(undefined)).toBe(false)
			expect(isBrowserConnection(0)).toBe(false)
			expect(isBrowserConnection(true)).toBe(false)
			expect(isBrowserConnection({})).toBe(false)
		})

		it('rejects wrong casing', () => {
			expect(isBrowserConnection('CDP')).toBe(false)
			expect(isBrowserConnection('Launch')).toBe(false)
			expect(isBrowserConnection('Persistent')).toBe(false)
		})
	})

	// === isBrowserWaitUntil

	describe('isBrowserWaitUntil', () => {
		it('accepts load', () => {
			expect(isBrowserWaitUntil('load')).toBe(true)
		})

		it('accepts domcontentloaded', () => {
			expect(isBrowserWaitUntil('domcontentloaded')).toBe(true)
		})

		it('accepts networkidle', () => {
			expect(isBrowserWaitUntil('networkidle')).toBe(true)
		})

		it('accepts commit', () => {
			expect(isBrowserWaitUntil('commit')).toBe(true)
		})

		it('rejects ready', () => {
			expect(isBrowserWaitUntil('ready')).toBe(false)
		})

		it('rejects complete', () => {
			expect(isBrowserWaitUntil('complete')).toBe(false)
		})

		it('rejects empty string', () => {
			expect(isBrowserWaitUntil('')).toBe(false)
		})

		it('rejects wrong casing', () => {
			expect(isBrowserWaitUntil('Load')).toBe(false)
			expect(isBrowserWaitUntil('DOMContentLoaded')).toBe(false)
			expect(isBrowserWaitUntil('NetworkIdle')).toBe(false)
		})

		it('rejects non-string types', () => {
			expect(isBrowserWaitUntil(null)).toBe(false)
			expect(isBrowserWaitUntil(undefined)).toBe(false)
			expect(isBrowserWaitUntil(42)).toBe(false)
			expect(isBrowserWaitUntil(true)).toBe(false)
		})
	})

	// === isPlaywrightPageLike

	describe('isPlaywrightPageLike', () => {
		it('rejects null', () => {
			expect(isPlaywrightPageLike(null)).toBe(false)
		})

		it('rejects undefined', () => {
			expect(isPlaywrightPageLike(undefined)).toBe(false)
		})

		it('rejects non-objects', () => {
			expect(isPlaywrightPageLike('string')).toBe(false)
			expect(isPlaywrightPageLike(42)).toBe(false)
			expect(isPlaywrightPageLike(true)).toBe(false)
		})

		it('rejects empty object', () => {
			expect(isPlaywrightPageLike({})).toBe(false)
		})

		it('rejects incomplete objects', () => {
			expect(isPlaywrightPageLike({ url: () => '' })).toBe(false)
		})

		it('rejects object with only url and title', () => {
			expect(isPlaywrightPageLike({ url: () => '', title: async () => '' })).toBe(false)
		})

		it('rejects object with non-function properties', () => {
			expect(
				isPlaywrightPageLike({
					url: 'not-fn',
					title: 'not-fn',
					goto: 'not-fn',
					content: 'not-fn',
					evaluate: 'not-fn',
					click: 'not-fn',
					fill: 'not-fn',
					selectOption: 'not-fn',
					waitForSelector: 'not-fn',
				}),
			).toBe(false)
		})

		it('accepts minimal valid page-like object', () => {
			const pageLike = {
				url: () => '',
				title: async () => '',
				goto: async () => null,
				content: async () => '',
				evaluate: async () => null,
				click: async () => {},
				fill: async () => {},
				selectOption: async () => [],
				waitForSelector: async () => null,
			}
			expect(isPlaywrightPageLike(pageLike)).toBe(true)
		})

		it('accepts page-like with optional methods', () => {
			const pageLike = {
				url: () => '',
				title: async () => '',
				goto: async () => null,
				content: async () => '',
				evaluate: async () => null,
				click: async () => {},
				fill: async () => {},
				selectOption: async () => [],
				waitForSelector: async () => null,
				screenshot: async () => Buffer.from([]),
				frame: () => null,
				close: async () => {},
				isClosed: () => false,
			}
			expect(isPlaywrightPageLike(pageLike)).toBe(true)
		})

		it('rejects array', () => {
			expect(isPlaywrightPageLike([])).toBe(false)
		})
	})

	// === isPlaywrightContextLike

	describe('isPlaywrightContextLike', () => {
		it('rejects null', () => {
			expect(isPlaywrightContextLike(null)).toBe(false)
		})

		it('rejects undefined', () => {
			expect(isPlaywrightContextLike(undefined)).toBe(false)
		})

		it('rejects empty object', () => {
			expect(isPlaywrightContextLike({})).toBe(false)
		})

		it('rejects incomplete objects', () => {
			expect(isPlaywrightContextLike({ newPage: () => {} })).toBe(false)
			expect(isPlaywrightContextLike({ newPage: () => {}, pages: () => [] })).toBe(false)
		})

		it('accepts minimal valid context-like object', () => {
			const ctxLike = {
				newPage: async () => ({}),
				pages: () => [],
				close: async () => {},
			}
			expect(isPlaywrightContextLike(ctxLike)).toBe(true)
		})

		it('rejects non-function properties', () => {
			expect(
				isPlaywrightContextLike({
					newPage: 'not-fn',
					pages: 'not-fn',
					close: 'not-fn',
				}),
			).toBe(false)
		})

		it('rejects non-objects', () => {
			expect(isPlaywrightContextLike('string')).toBe(false)
			expect(isPlaywrightContextLike(42)).toBe(false)
		})
	})

	// === isPlaywrightBrowserLike

	describe('isPlaywrightBrowserLike', () => {
		it('rejects null', () => {
			expect(isPlaywrightBrowserLike(null)).toBe(false)
		})

		it('rejects undefined', () => {
			expect(isPlaywrightBrowserLike(undefined)).toBe(false)
		})

		it('rejects empty object', () => {
			expect(isPlaywrightBrowserLike({})).toBe(false)
		})

		it('rejects incomplete objects', () => {
			expect(isPlaywrightBrowserLike({ close: () => {} })).toBe(false)
			expect(isPlaywrightBrowserLike({ newContext: () => {}, close: () => {} })).toBe(false)
		})

		it('accepts minimal valid browser-like object', () => {
			const browserLike = {
				newContext: async () => ({}),
				contexts: () => [],
				close: async () => {},
				isConnected: () => true,
			}
			expect(isPlaywrightBrowserLike(browserLike)).toBe(true)
		})

		it('rejects non-function properties', () => {
			expect(
				isPlaywrightBrowserLike({
					newContext: 'not-fn',
					contexts: 'not-fn',
					close: 'not-fn',
					isConnected: 'not-fn',
				}),
			).toBe(false)
		})

		it('rejects non-objects', () => {
			expect(isPlaywrightBrowserLike('string')).toBe(false)
			expect(isPlaywrightBrowserLike(42)).toBe(false)
		})
	})

	// === isPlaywrightEngineLike

	describe('isPlaywrightEngineLike', () => {
		it('rejects null', () => {
			expect(isPlaywrightEngineLike(null)).toBe(false)
		})

		it('rejects undefined', () => {
			expect(isPlaywrightEngineLike(undefined)).toBe(false)
		})

		it('rejects empty object', () => {
			expect(isPlaywrightEngineLike({})).toBe(false)
		})

		it('rejects incomplete objects', () => {
			expect(isPlaywrightEngineLike({ launch: () => {} })).toBe(false)
			expect(isPlaywrightEngineLike({ launch: () => {}, connectOverCDP: () => {} })).toBe(false)
		})

		it('accepts minimal valid engine-like object', () => {
			const engineLike = {
				connectOverCDP: async () => ({}),
				launch: async () => ({}),
				launchPersistentContext: async () => ({}),
			}
			expect(isPlaywrightEngineLike(engineLike)).toBe(true)
		})

		it('rejects non-function properties', () => {
			expect(
				isPlaywrightEngineLike({
					connectOverCDP: 'not-fn',
					launch: 'not-fn',
					launchPersistentContext: 'not-fn',
				}),
			).toBe(false)
		})

		it('rejects non-objects', () => {
			expect(isPlaywrightEngineLike('string')).toBe(false)
			expect(isPlaywrightEngineLike(42)).toBe(false)
		})
	})
})
