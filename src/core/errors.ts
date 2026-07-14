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
