import { isInstance } from '@orkestrel/contract'

// === Browser errors

/**
 * Represents the base error for all browser automation operations, carrying the code
 * `BROWSER_ERROR` and a `context` record.
 *
 * @remarks
 * A caller branches in a `catch` on the `code` rather than parsing message strings.
 */
export class BrowserError extends Error {
	readonly code: string
	readonly context: Readonly<Record<string, unknown>> | undefined

	constructor(
		message: string,
		code = 'BROWSER_ERROR',
		context?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		this.name = 'BrowserError'
		this.code = code
		this.context = context
	}
}

/**
 * Reports that a selector-based lookup or wait timed out without the element appearing, under
 * the code `BROWSER_SELECTOR_ERROR`.
 */
export class BrowserSelectorError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_SELECTOR_ERROR', context)
		this.name = 'BrowserSelectorError'
	}
}

/**
 * Reports that a CDP request received an error response from the remote endpoint, under the
 * code `BROWSER_CDP_ERROR`, with the `method`, the CDP `code`, the `message`, and any `data`
 * in its context.
 *
 * @remarks
 * Carries the originating `method` plus the CDP error's own `code`,
 * `message`, and `data` (when present) in `context`, so callers can branch
 * on the protocol-level error instead of parsing the message string.
 */
export class CDPError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_ERROR', context)
		this.name = 'CDPError'
	}
}

/**
 * Reports that a CDP request could not be sent or completed because the client was not in a
 * connectable state — not connected, closed while connecting, or the connection dropped mid-
 * request — under the code `BROWSER_CDP_CONNECTION_ERROR`.
 */
export class CDPConnectionError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_CONNECTION_ERROR', context)
		this.name = 'CDPConnectionError'
	}
}

/**
 * Reports that a pending CDP request was not answered within its timeout window, under the
 * code `BROWSER_CDP_TIMEOUT_ERROR`.
 */
export class CDPTimeoutError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_TIMEOUT_ERROR', context)
		this.name = 'CDPTimeoutError'
	}
}

/**
 * Reports that an `evaluate()`/`content()` result exceeded `BROWSER_RESULT_LIMIT` and was
 * rejected in-page before it could overflow the CDP transport frame, under the code
 * `BROWSER_RESULT_LIMIT_ERROR`.
 */
export class BrowserResultLimitError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_RESULT_LIMIT_ERROR', context)
		this.name = 'BrowserResultLimitError'
	}
}

// === Browser type guards

/**
 * Narrows an unknown value to a `BrowserError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserError instance; false otherwise
 */
export function isBrowserError(value: unknown): value is BrowserError {
	return isInstance(value, BrowserError)
}

/**
 * Narrows an unknown value to a `BrowserSelectorError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserSelectorError instance; false otherwise
 */
export function isBrowserSelectorError(value: unknown): value is BrowserSelectorError {
	return isInstance(value, BrowserSelectorError)
}

/**
 * Narrows an unknown value to a `CDPError`.
 *
 * @param value - Value to check
 * @returns True if value is a CDPError instance; false otherwise
 */
export function isCDPError(value: unknown): value is CDPError {
	return isInstance(value, CDPError)
}

/**
 * Narrows an unknown value to a `CDPConnectionError`.
 *
 * @param value - Value to check
 * @returns True if value is a CDPConnectionError instance; false otherwise
 */
export function isCDPConnectionError(value: unknown): value is CDPConnectionError {
	return isInstance(value, CDPConnectionError)
}

/**
 * Narrows an unknown value to a `CDPTimeoutError`.
 *
 * @param value - Value to check
 * @returns True if value is a CDPTimeoutError instance; false otherwise
 */
export function isCDPTimeoutError(value: unknown): value is CDPTimeoutError {
	return isInstance(value, CDPTimeoutError)
}

/**
 * Narrows an unknown value to a `BrowserResultLimitError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserResultLimitError instance; false otherwise
 */
export function isBrowserResultLimitError(value: unknown): value is BrowserResultLimitError {
	return isInstance(value, BrowserResultLimitError)
}
