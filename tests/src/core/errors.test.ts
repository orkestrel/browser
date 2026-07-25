import {
	BrowserError,
	BrowserResultLimitError,
	BrowserSelectorError,
	CDPConnectionError,
	CDPError,
	CDPTimeoutError,
	isBrowserError,
	isBrowserResultLimitError,
	isBrowserSelectorError,
	isCDPConnectionError,
	isCDPError,
	isCDPTimeoutError,
} from '@src/core'
import { describe, expect, it } from 'vitest'

describe('core browser error guards', () => {
	it('narrows every browser error class', () => {
		expect(isBrowserError(new BrowserError('failure'))).toBe(true)
		expect(isBrowserSelectorError(new BrowserSelectorError('failure'))).toBe(true)
		expect(isCDPError(new CDPError('failure'))).toBe(true)
		expect(isCDPConnectionError(new CDPConnectionError('failure'))).toBe(true)
		expect(isCDPTimeoutError(new CDPTimeoutError('failure'))).toBe(true)
		expect(isBrowserResultLimitError(new BrowserResultLimitError('failure'))).toBe(true)
	})

	it('is total for revoked proxies and unrelated values', () => {
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()

		expect(() => isBrowserError(revocable.proxy)).not.toThrow()
		expect(isBrowserError(revocable.proxy)).toBe(false)
		expect(isBrowserSelectorError(revocable.proxy)).toBe(false)
		expect(isCDPError(revocable.proxy)).toBe(false)
		expect(isCDPConnectionError(revocable.proxy)).toBe(false)
		expect(isCDPTimeoutError(revocable.proxy)).toBe(false)
		expect(isBrowserResultLimitError(revocable.proxy)).toBe(false)
		expect(isBrowserError({ name: 'BrowserError' })).toBe(false)
	})
})
