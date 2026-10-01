import type { BrowserAction } from '@src/core'
import {
	BrowserConnectionError,
	BrowserElementError,
	BrowserError,
	BrowserResultLimitError,
	BrowserStepError,
	CDPConnectionError,
	CDPError,
	CDPTimeoutError,
	isBrowserConnectionError,
	isBrowserElementError,
	isBrowserError,
	isBrowserResultLimitError,
	isBrowserStepError,
	isCDPConnectionError,
	isCDPError,
	isCDPTimeoutError,
} from '@src/core'
import { describe, expect, it } from 'vitest'

describe('core browser error guards', () => {
	it('narrows every browser error class', () => {
		expect(isBrowserError(new BrowserError('failure'))).toBe(true)
		expect(isBrowserConnectionError(new BrowserConnectionError('failure'))).toBe(true)
		expect(isCDPError(new CDPError('failure'))).toBe(true)
		expect(isCDPConnectionError(new CDPConnectionError('failure'))).toBe(true)
		expect(isCDPTimeoutError(new CDPTimeoutError('failure'))).toBe(true)
		expect(isBrowserResultLimitError(new BrowserResultLimitError('failure'))).toBe(true)
	})

	it('carries the performed action of a step that did not complete, with the step in its message and context', () => {
		const action: BrowserAction = {
			action: 'wait',
			arguments: { text: 'Saved' },
			outcome: 'timeout',
			receipt: '"Saved" did not appear within 5 s.',
			elapsed: 5000,
		}
		const error = new BrowserStepError('s3', action)

		expect(error).toMatchObject({
			name: 'BrowserStepError',
			code: 'BROWSER_STEP_ERROR',
			message: 's3: "Saved" did not appear within 5 s.',
			context: { step: 's3' },
		})
		expect(error.action).toBe(action)
		expect(isBrowserStepError(error)).toBe(true)
		expect(isBrowserError(error)).toBe(true)
		expect(isBrowserStepError(new BrowserError('s3: "Saved" did not appear within 5 s.'))).toBe(
			false,
		)
		expect(isBrowserStepError(action)).toBe(false)
	})

	it('names an UNTRUSTED or other non-GONE refusal with its detail and no fresh-refs instruction', () => {
		const untrusted = new BrowserElementError(
			'e4',
			'UNTRUSTED',
			'opens a file chooser, which an untrusted click cannot do',
		)
		expect(untrusted.message).toBe(
			'Element e4 opens a file chooser, which an untrusted click cannot do.',
		)
		expect(untrusted.message).not.toContain('call look')
		expect(untrusted.code).toBe('BROWSER_ELEMENT_ERROR')
		expect(untrusted.context).toEqual({ reference: 'e4', reason: 'UNTRUSTED' })
		expect(isBrowserElementError(untrusted)).toBe(true)
		expect(new BrowserElementError({ subject: 'Upload' }, 'UNTRUSTED').message).toBe(
			'Upload needs a trusted event.',
		)
		expect(new BrowserElementError('e4', 'GONE').message).toBe(
			'Element e4 is gone because the page changed; call look for fresh refs.',
		)
		expect(
			[
				new BrowserElementError('e4', 'UNKNOWN', 'is not editable'),
				new BrowserElementError('e4', 'DISABLED', 'is disabled'),
				new BrowserElementError('e4', 'HIDDEN', 'is not visible'),
				new BrowserElementError('e4', 'OCCLUDED', 'is covered by div#veil'),
			].map((error) => error.message),
		).toEqual([
			'Element e4 is not editable.',
			'Element e4 is disabled.',
			'Element e4 is not visible.',
			'Element e4 is covered by div#veil.',
		])
	})

	it('is total for revoked proxies and unrelated values', () => {
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()

		expect(() => isBrowserError(revocable.proxy)).not.toThrow()
		expect(isBrowserError(revocable.proxy)).toBe(false)
		expect(isBrowserConnectionError(revocable.proxy)).toBe(false)
		expect(isCDPError(revocable.proxy)).toBe(false)
		expect(isCDPConnectionError(revocable.proxy)).toBe(false)
		expect(isCDPTimeoutError(revocable.proxy)).toBe(false)
		expect(isBrowserResultLimitError(revocable.proxy)).toBe(false)
		expect(isBrowserError({ name: 'BrowserError' })).toBe(false)
	})
})
