import {
	BrowserDestroyedError,
	BrowserNotConnectedError,
	isBrowserDestroyedError,
	isBrowserNotConnectedError,
} from '@src/server'
import * as server from '@src/server'
import { describe, expect, it } from 'vitest'

describe('server browser error guards', () => {
	it('narrows the server browser error classes', () => {
		expect(isBrowserNotConnectedError(new BrowserNotConnectedError())).toBe(true)
		expect(isBrowserDestroyedError(new BrowserDestroyedError())).toBe(true)
	})

	it('contains revoked-proxy prototype failures', () => {
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()

		expect(isBrowserNotConnectedError(revocable.proxy)).toBe(false)
		expect(isBrowserDestroyedError(revocable.proxy)).toBe(false)
	})
	it('leaves the connection error to the core barrel', () => {
		expect('BrowserConnectionError' in server).toBe(false)
		expect('isBrowserConnectionError' in server).toBe(false)
	})
})
