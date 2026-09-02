import { BrowserError } from '@src/core'
import { isInstance } from '@orkestrel/contract'

// === Server browser errors

/**
 * Reports that a CDP connection, discovery, or launch attempt failed.
 */
export class BrowserConnectionError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CONNECTION_ERROR', context)
		this.name = 'BrowserConnectionError'
	}
}

/**
 * Reports that an operation requiring an active connection was attempted while disconnected.
 */
export class BrowserNotConnectedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser is not connected', 'BROWSER_NOT_CONNECTED_ERROR', context)
		this.name = 'BrowserNotConnectedError'
	}
}

/**
 * Reports that an operation was attempted after the Browser was destroyed.
 */
export class BrowserDestroyedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser has been destroyed', 'BROWSER_DESTROYED_ERROR', context)
		this.name = 'BrowserDestroyedError'
	}
}

// === Server browser type guards

/**
 * Narrows an unknown value to BrowserConnectionError.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserConnectionError instance; false otherwise
 */
export function isBrowserConnectionError(value: unknown): value is BrowserConnectionError {
	return isInstance(value, BrowserConnectionError)
}

/**
 * Narrows an unknown value to BrowserNotConnectedError.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserNotConnectedError instance; false otherwise
 */
export function isBrowserNotConnectedError(value: unknown): value is BrowserNotConnectedError {
	return isInstance(value, BrowserNotConnectedError)
}

/**
 * Narrows an unknown value to BrowserDestroyedError.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserDestroyedError instance; false otherwise
 */
export function isBrowserDestroyedError(value: unknown): value is BrowserDestroyedError {
	return isInstance(value, BrowserDestroyedError)
}
