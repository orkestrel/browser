import { BrowserError } from '@src/core'
import { isInstance } from '@orkestrel/contract'

// === Server browser errors

/**
 * Reports that an operation requiring an active connection was attempted while disconnected,
 * under the code `BROWSER_NOT_CONNECTED_ERROR`.
 */
export class BrowserNotConnectedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser is not connected', 'BROWSER_NOT_CONNECTED_ERROR', context)
		this.name = 'BrowserNotConnectedError'
	}
}

/**
 * Reports that an operation was attempted after the browser wrapper was destroyed, under the
 * code `BROWSER_DESTROYED_ERROR`.
 */
export class BrowserDestroyedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser has been destroyed', 'BROWSER_DESTROYED_ERROR', context)
		this.name = 'BrowserDestroyedError'
	}
}

// === Server browser type guards

/**
 * Narrows an unknown value to a `BrowserNotConnectedError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserNotConnectedError instance; false otherwise
 */
export function isBrowserNotConnectedError(value: unknown): value is BrowserNotConnectedError {
	return isInstance(value, BrowserNotConnectedError)
}

/**
 * Narrows an unknown value to a `BrowserDestroyedError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserDestroyedError instance; false otherwise
 */
export function isBrowserDestroyedError(value: unknown): value is BrowserDestroyedError {
	return isInstance(value, BrowserDestroyedError)
}
