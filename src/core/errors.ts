import type { BrowserAction, BrowserErrorCode } from './types.js'
import type { JSONRecord } from '@orkestrel/contract'
import { isInstance } from '@orkestrel/contract'

/**
 * Reports a browser failure with a typed code and optional JSON context.
 *
 * @remarks
 * A caller branches on `code` rather than parsing the message.
 */
export class BrowserError extends Error {
	readonly code: BrowserErrorCode
	readonly context: JSONRecord | undefined

	constructor(code: BrowserErrorCode, message: string, context?: JSONRecord) {
		super(message)
		this.name = 'BrowserError'
		this.code = code
		this.context = context
	}
}

/**
 * Reports an incomplete journey step with its action and the code `STEP`.
 *
 * @remarks
 * The message is `ID: RECEIPT`, and `context.step` names the step.
 * The action carries the outcome, stage, reason, receipt, and elapsed time.
 */
export class BrowserStepError extends BrowserError {
	readonly action: BrowserAction

	constructor(id: string, action: BrowserAction) {
		super('STEP', `${id}: ${action.receipt}`, { step: id })
		this.name = 'BrowserStepError'
		this.action = action
	}
}

/**
 * Checks whether a value is a browser error.
 * @param value - Value to check
 * @returns True if the value is a browser error; false otherwise
 */
export function isBrowserError(value: unknown): value is BrowserError {
	return isInstance(value, BrowserError)
}

/**
 * Checks whether a value is a journey step error.
 * @param value - Value to check
 * @returns True if the value is a step error; false otherwise
 */
export function isBrowserStepError(value: unknown): value is BrowserStepError {
	return isInstance(value, BrowserStepError)
}
