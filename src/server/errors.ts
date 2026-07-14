import { BrowserError } from '@src/core'

// === Server browser errors

/**
 * A CDP connection, discovery, or launch attempt failed.
 */
export class BrowserConnectionError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CONNECTION_ERROR', context)
		this.name = 'BrowserConnectionError'
	}
}

/**
 * An operation requiring an active connection was attempted while disconnected.
 */
export class BrowserNotConnectedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser is not connected', 'BROWSER_NOT_CONNECTED_ERROR', context)
		this.name = 'BrowserNotConnectedError'
	}
}

/**
 * An operation was attempted after the Browser was destroyed.
 */
export class BrowserDestroyedError extends BrowserError {
	constructor(context?: Readonly<Record<string, unknown>>) {
		super('Browser has been destroyed', 'BROWSER_DESTROYED_ERROR', context)
		this.name = 'BrowserDestroyedError'
	}
}

// === Server browser type guards

/**
 * Narrow an unknown value to BrowserConnectionError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserConnectionError instance
 */
export function isBrowserConnectionError(value: unknown): value is BrowserConnectionError {
	return value instanceof BrowserConnectionError
}

/**
 * Narrow an unknown value to BrowserNotConnectedError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserNotConnectedError instance
 */
export function isBrowserNotConnectedError(value: unknown): value is BrowserNotConnectedError {
	return value instanceof BrowserNotConnectedError
}

/**
 * Narrow an unknown value to BrowserDestroyedError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserDestroyedError instance
 */
export function isBrowserDestroyedError(value: unknown): value is BrowserDestroyedError {
	return value instanceof BrowserDestroyedError
}
