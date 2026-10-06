import type { BrowserAction, BrowserElementReason, BrowserElementSubject } from './types.js'
import { isInstance, isString } from '@orkestrel/contract'

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
 * Reports a refused element operation with a reason and, for `GONE`, the refresh directive.
 *
 * @remarks
 * The message names the element and the detail on one line. It ends with
 * `; call read for fresh refs.` for `GONE` alone, because only a changed page makes a fresh
 * reference the remedy; every other reason ends the message with a period, and a caller whose
 * refusal a fresh reference does fix names that remedy in its detail.
 */
export class BrowserElementError extends BrowserError {
	constructor(
		reference: string | BrowserElementSubject,
		reason: BrowserElementReason,
		detail?: string,
	) {
		const subject = isString(reference) ? `Element ${reference}` : reference.subject
		const text =
			detail ??
			(reason === 'GONE'
				? 'is gone because the page changed'
				: reason === 'UNTRUSTED'
					? 'needs a trusted event'
					: reason.toLowerCase())
		super(
			`${subject} ${text}${reason === 'GONE' ? '; call read for fresh refs.' : '.'}`,
			'BROWSER_ELEMENT_ERROR',
			isString(reference) ? { reference, reason } : { subject: reference.subject, reason },
		)
		this.name = 'BrowserElementError'
	}
}

/**
 * Checks whether a value is an element refusal.
 * @param value - Caught value
 * @returns True if the value is an element error; false otherwise
 */
export function isBrowserElementError(value: unknown): value is BrowserElementError {
	return isInstance(value, BrowserElementError)
}

/**
 * Reports a journey step whose action did not complete, under the code `BROWSER_STEP_ERROR`, with
 * the performed action in `action`.
 *
 * @remarks
 * The message is `ID: RECEIPT`, where `ID` is the step's id and `RECEIPT` the action's receipt, and
 * `context` names the step under `step`. A caller reads the outcome, stage, reason, receipt, and
 * elapsed time from `action` rather than from the message.
 */
export class BrowserStepError extends BrowserError {
	readonly action: BrowserAction

	constructor(id: string, action: BrowserAction) {
		super(`${id}: ${action.receipt}`, 'BROWSER_STEP_ERROR', { step: id })
		this.name = 'BrowserStepError'
		this.action = action
	}
}

/**
 * Checks whether a value is a journey step error.
 * @param value - Caught value
 * @returns True if the value is a step error; false otherwise
 */
export function isBrowserStepError(value: unknown): value is BrowserStepError {
	return isInstance(value, BrowserStepError)
}

/**
 * Reports that a CDP request received an error response from the remote endpoint, under the
 * code `BROWSER_CDP_ERROR`, with the `method`, the CDP `code`, the `message`, and any `data`
 * in its context.
 *
 * @remarks
 * Branch on the protocol-level error in `context` instead of parsing the message string.
 */
export class CDPError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CDP_ERROR', context)
		this.name = 'CDPError'
	}
}

/**
 * Reports that a CDP request could not be sent or completed because the client was not connected, closed while connecting, lost its connection, or lost the request's target session, under the code `BROWSER_CDP_CONNECTION_ERROR`.
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
 * Reports that an `evaluate()`/`read()` result exceeded {@link BROWSER_RESULT_LIMIT} and
 * was rejected in-page before it could overflow the CDP transport frame, under the code
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

/**
 * Reports that a CDP connection, discovery, or launch attempt failed, under the code
 * `BROWSER_CONNECTION_ERROR`.
 */
export class BrowserConnectionError extends BrowserError {
	constructor(message: string, context?: Readonly<Record<string, unknown>>) {
		super(message, 'BROWSER_CONNECTION_ERROR', context)
		this.name = 'BrowserConnectionError'
	}
}

/**
 * Narrows an unknown value to a `BrowserConnectionError`.
 *
 * @param value - Value to check
 * @returns True if value is a BrowserConnectionError instance; false otherwise
 */
export function isBrowserConnectionError(value: unknown): value is BrowserConnectionError {
	return isInstance(value, BrowserConnectionError)
}
