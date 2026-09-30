import {
	BrowserConnectionError,
	BrowserElementError,
	BrowserError,
	BrowserResultLimitError,
	CDPConnectionError,
	CDPError,
	CDPTimeoutError,
	isBrowserConnectionError,
	isBrowserElementError,
	isBrowserError,
	isBrowserResultLimitError,
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

	it('names an UNTRUSTED refusal with its detail and no fresh-refs instruction', () => {
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
		expect(new BrowserElementError('e4', 'UNKNOWN', 'is not editable').message).toBe(
			'Element e4 is not editable; call look for fresh refs.',
		)
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
