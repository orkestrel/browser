// === Browser errors

/**
 * Base error for all browser automation operations.
 *
 * @remarks
 * Carries a machine-readable `code` and optional `context` (AGENTS §12) so
 * callers can branch in a `catch` without parsing message strings.
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
 * A selector-based lookup or wait timed out without the element appearing.
 */
export class BrowserSelectorError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_SELECTOR_ERROR', context)
		this.name = 'BrowserSelectorError'
	}
}

/**
 * A CDP request received an error response from the remote endpoint.
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
 * A CDP request could not be sent or completed because the client was not in
 * a connectable state (not connected, closed while connecting, or the
 * connection dropped mid-request).
 */
export class CDPConnectionError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_CONNECTION_ERROR', context)
		this.name = 'CDPConnectionError'
	}
}

/**
 * A pending CDP request was not answered within its timeout window.
 */
export class CDPTimeoutError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_TIMEOUT_ERROR', context)
		this.name = 'CDPTimeoutError'
	}
}

/**
 * An `evaluate()`/`content()` result exceeded {@link BROWSER_RESULT_LIMIT}
 * and was rejected in-page before it could overflow the CDP transport frame.
 */
export class BrowserResultLimitError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_RESULT_LIMIT_ERROR', context)
		this.name = 'BrowserResultLimitError'
	}
}

// === Browser type guards

/**
 * Narrow an unknown value to BrowserError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserError instance
 */
export function isBrowserError(value: unknown): value is BrowserError {
	return value instanceof BrowserError
}

/**
 * Narrow an unknown value to BrowserSelectorError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserSelectorError instance
 */
export function isBrowserSelectorError(value: unknown): value is BrowserSelectorError {
	return value instanceof BrowserSelectorError
}

/**
 * Narrow an unknown value to CDPError.
 *
 * @param value - Value to check
 * @returns True when value is a CDPError instance
 */
export function isCDPError(value: unknown): value is CDPError {
	return value instanceof CDPError
}

/**
 * Narrow an unknown value to CDPConnectionError.
 *
 * @param value - Value to check
 * @returns True when value is a CDPConnectionError instance
 */
export function isCDPConnectionError(value: unknown): value is CDPConnectionError {
	return value instanceof CDPConnectionError
}

/**
 * Narrow an unknown value to CDPTimeoutError.
 *
 * @param value - Value to check
 * @returns True when value is a CDPTimeoutError instance
 */
export function isCDPTimeoutError(value: unknown): value is CDPTimeoutError {
	return value instanceof CDPTimeoutError
}

/**
 * Narrow an unknown value to BrowserResultLimitError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserResultLimitError instance
 */
export function isBrowserResultLimitError(value: unknown): value is BrowserResultLimitError {
	return value instanceof BrowserResultLimitError
}
