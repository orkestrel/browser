import type {
	BrowserPageInterface,
	BrowserJourneyBinding,
	BrowserJourneyTarget,
	BrowserJourneyTab,
	BrowserJourneyValidationContext,
} from './types.js'
import {
	attempt,
	isRecord,
	isString,
	isBoolean,
	isFunction,
	isTrue,
	objectOf,
} from '@orkestrel/contract'
import { BROWSER_JOURNEY_PARAMETER_PATTERN } from './constants.js'

/**
 * Checks whether a value exposes the page capabilities used by a browser toolset.
 *
 * @remarks
 * Reads structural members, including inherited accessors, without invoking page operations.
 * A trusted view alone is insufficient. Hostile getters and revoked proxies return false.
 *
 * @param value - The candidate page or view
 * @returns True if the value exposes the page's protocol and toolset capabilities; false otherwise
 * @example
 * isBrowserPage(page) // true
 * isBrowserPage(view) // false for a DOM document view
 */
export function isBrowserPage(value: unknown): value is BrowserPageInterface {
	const result = attempt(() =>
		objectOf({
			trusted: isTrue,
			id: isString,
			target: isString,
			url: isString,
			closed: isBoolean,
			title: isFunction,
			read: isFunction,
			wait: isFunction,
			evaluate: isFunction,
			handle: isFunction,
			send: isFunction,
			subscribe: isFunction,
			unsubscribe: isFunction,
			navigate: isFunction,
			reload: isFunction,
			back: isFunction,
			forward: isFunction,
			screenshot: isFunction,
			pdf: isFunction,
			frame: isFunction,
			frames: isFunction,
			snapshot: isFunction,
			recorder: objectOf({
				start: isFunction,
				stop: isFunction,
				journey: isFunction,
				destroy: isFunction,
			}),
			destroy: isFunction,
			close: isFunction,
			elements: objectOf({ element: isFunction, find: isFunction, outline: isFunction }),
			emitter: objectOf({ on: isFunction, off: isFunction }),
			keyboard: objectOf({ press: isFunction }),
			registry: objectOf({
				start: isFunction,
				adopt: isFunction,
				tools: isFunction,
				emitter: objectOf({ on: isFunction, off: isFunction }),
			}),
			navigation: objectOf({ record: isFunction }),
			popups: objectOf({ record: isFunction }),
		})(value),
	)
	return result.success && result.value
}

/**
 * Checks whether a validation context identifies a parameter, step, and field.
 * @param value - Candidate error context
 * @returns True if the binding coordinates are strings; false otherwise
 * @example
 * isBrowserJourneyValidationContext({ parameter: 'email', step: 's4', field: 'text' })
 */
export function isBrowserJourneyValidationContext(
	value: unknown,
): value is BrowserJourneyValidationContext {
	const result = attempt(
		() =>
			isRecord(value) &&
			isString(value['parameter']) &&
			isString(value['step']) &&
			isString(value['field']),
	)
	return result.success && result.value
}

/**
 * Checks whether a native string argument is a literal or a parameter binding.
 * @param value - Candidate argument
 * @returns True if the binding has the declared shape; false otherwise
 */
export function isBrowserJourneyBinding(value: unknown): value is BrowserJourneyBinding {
	const result = attempt(
		() =>
			isString(value) ||
			(isRecord(value) &&
				Object.keys(value).length === 1 &&
				isString(value['parameter']) &&
				BROWSER_JOURNEY_PARAMETER_PATTERN.test(value['parameter'])),
	)
	return result.success && result.value
}

/**
 * Checks whether a target carries its role, name, and optional evidence.
 * @param value - Candidate target
 * @returns True if the target has the declared shape; false otherwise
 */
export function isBrowserJourneyTarget(value: unknown): value is BrowserJourneyTarget {
	const result = attempt(
		() =>
			isRecord(value) &&
			Object.keys(value).every((key) => ['role', 'name', 'css', 'reference'].includes(key)) &&
			isString(value['role']) &&
			value['role'].length > 0 &&
			isBrowserJourneyBinding(value['name']) &&
			(value['css'] === undefined || isString(value['css'])) &&
			(value['reference'] === undefined || isString(value['reference'])),
	)
	return result.success && result.value
}

/**
 * Checks whether a tab carries its portable URL and title.
 * @param value - Candidate tab
 * @returns True if both fields are strings; false otherwise
 */
export function isBrowserJourneyTab(value: unknown): value is BrowserJourneyTab {
	const result = attempt(
		() => isRecord(value) && isString(value['url']) && isString(value['title']),
	)
	return result.success && result.value
}

/**
 * Checks whether a step binds a declared secret through type.text.
 * @param step - Candidate step
 * @param parameters - Candidate parameter declarations
 * @returns True if the text binds a declared secret on a type action; false otherwise
 */
export function isBrowserSecretBinding(
	step: unknown,
	parameters: unknown,
): step is {
	readonly action: 'type'
	readonly arguments: { readonly text: { readonly parameter: string } }
} {
	const result = attempt(() => {
		if (
			!isRecord(step) ||
			step['action'] !== 'type' ||
			!isRecord(step['arguments']) ||
			!isRecord(parameters)
		)
			return false
		const binding = step['arguments']['text']
		if (!isBrowserJourneyBinding(binding) || isString(binding)) return false
		const parameter = parameters[binding.parameter]
		return isRecord(parameter) && parameter['secret'] === true
	})
	return result.success && result.value
}
