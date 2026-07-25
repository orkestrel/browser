import {
	BrowserConnectionError,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	isBrowserConnectionError,
	isBrowserDestroyedError,
	isBrowserNotConnectedError,
} from '@src/server'
import { describe, expect, it } from 'vitest'

describe('server browser error guards', () => {
	it('narrows every server browser error class', () => {
		expect(isBrowserConnectionError(new BrowserConnectionError('failure'))).toBe(true)
		expect(isBrowserNotConnectedError(new BrowserNotConnectedError())).toBe(true)
		expect(isBrowserDestroyedError(new BrowserDestroyedError())).toBe(true)
	})

	it('contains revoked-proxy prototype failures', () => {
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()

		expect(() => isBrowserConnectionError(revocable.proxy)).not.toThrow()
		expect(isBrowserConnectionError(revocable.proxy)).toBe(false)
		expect(isBrowserNotConnectedError(revocable.proxy)).toBe(false)
		expect(isBrowserDestroyedError(revocable.proxy)).toBe(false)
	})
})
