import type { BrowserAction, BrowserErrorCode } from './types.js'
import type { JSONRecord } from '@orkestrel/contract'
import { holds, INTRINSICS, literalOf } from '@orkestrel/contract'
import { BROWSER_ERROR_BRAND, BROWSER_ERROR_CODES, BROWSER_STEP_ERROR_BRAND } from './constants.js'
import { isBrowserAction, isBrowserErrorContext } from './validators.js'

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
		INTRINSICS.define(this, BROWSER_ERROR_BRAND, { value: this })
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
		INTRINSICS.define(this, BROWSER_STEP_ERROR_BRAND, { value: this })
		this.name = 'BrowserStepError'
		this.action = action
	}
}

/**
 * Checks whether an error carries the browser brand and declared members across package copies.
 * @remarks Subclasses are accepted without requiring their name; transparent proxies are refused.
 * @param value - Value to check
 * @returns True if the value is a browser error; false otherwise
 */
export function isBrowserError(value: unknown): value is BrowserError {
	return holds(() => {
		if (!(value instanceof Error) || INTRINSICS.prototype(value) === Error.prototype) return false
		if (INTRINSICS.describe(value, BROWSER_ERROR_BRAND)?.value !== value) return false
		if (!literalOf(BROWSER_ERROR_CODES)(INTRINSICS.reflect.read(value, 'code'))) return false
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return context === undefined || isBrowserErrorContext(context)
	})
}

/**
 * Checks whether a branded browser error carries the step brand and declared action members.
 * @remarks Subclasses are accepted without requiring their name; transparent proxies are refused.
 * @param value - Value to check
 * @returns True if the value is a step error; false otherwise
 */
export function isBrowserStepError(value: unknown): value is BrowserStepError {
	return holds(
		() =>
			isBrowserError(value) &&
			INTRINSICS.describe(value, BROWSER_STEP_ERROR_BRAND)?.value === value &&
			isBrowserAction(INTRINSICS.reflect.read(value, 'action')),
	)
}
