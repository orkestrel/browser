import type {
	BrowserJourney,
	BrowserJourneyBinding,
	BrowserJourneyEdit,
	BrowserJourneyParameter,
	BrowserJourneyStepInput,
	BrowserJourneyTarget,
	BrowserJourneyTab,
	BrowserRun,
} from './types.js'
import {
	attempt,
	isArray,
	isBoolean,
	isFiniteNumber,
	isJSONValue,
	isRecord,
	isString,
	parseEnum,
} from '@orkestrel/contract'
import {
	BROWSER_JOURNEY_ACTIONS,
	BROWSER_JOURNEY_FORMAT_VERSION,
	BROWSER_JOURNEY_NAME_PATTERN,
	BROWSER_JOURNEY_PARAMETER_PATTERN,
} from './constants.js'
import { BrowserError } from './errors.js'
import { collectBrowserJourneyBindings } from './helpers.js'

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
 * Validates a parameter declaration, including the secret-default exclusion.
 * @param value - Candidate declaration
 * @throws BrowserError - Thrown when invariant 5 or the declaration shape fails
 */
export function validateBrowserJourneyParameter(
	value: unknown,
): asserts value is BrowserJourneyParameter {
	if (
		!isRecord(value) ||
		!isJSONValue(value) ||
		Object.keys(value).some((key) => key !== 'default' && key !== 'secret') ||
		(value['default'] !== undefined && !isString(value['default'])) ||
		(value['secret'] !== undefined && !isBoolean(value['secret']))
	) {
		throw new BrowserError(
			'Invariant 5 (secrets): has a malformed parameter declaration',
			'BROWSER_JOURNEY_INVALID',
		)
	}
	if (value['secret'] === true && value['default'] !== undefined)
		throw new BrowserError(
			'Invariant 5 (secrets): declares a secret with a default',
			'BROWSER_JOURNEY_INVALID',
		)
}

/**
 * Validates one step independently of ids and parameter declarations.
 * @param value - Candidate step
 * @throws BrowserError - Thrown when the action, target, tab, arguments, or JSON shape fails
 */
export function validateBrowserJourneyStep(
	value: unknown,
): asserts value is BrowserJourneyStepInput {
	if (
		!isJSONValue(value) ||
		!isRecord(value) ||
		!isString(value['action']) ||
		!isRecord(value['arguments'])
	)
		throw new BrowserError(
			'Invariant 6 (JSON round trip): has a malformed step',
			'BROWSER_JOURNEY_INVALID',
		)
	const action = value['action']
	if (
		action.length === 0 ||
		['look', 'read', 'tabs', 'record', 'save', 'journeys', 'edit', 'replay'].includes(action)
	)
		throw new BrowserError(
			'Invariant 7 (actions): uses an observation or journey tool as a step',
			'BROWSER_JOURNEY_INVALID',
		)
	const native = BROWSER_JOURNEY_ACTIONS.some((name) => name === action)
	const targeted = action === 'click' || action === 'type'
	if (
		(targeted ? !isBrowserJourneyTarget(value['target']) : value['target'] !== undefined) ||
		(action === 'switch' ? !isBrowserJourneyTab(value['tab']) : value['tab'] !== undefined)
	)
		throw new BrowserError(
			'Invariant 3 (targets and tabs): has an incompatible target or tab',
			'BROWSER_JOURNEY_INVALID',
		)
	const args = value['arguments']
	if (native && ('ref' in args || 'tab' in args))
		throw new BrowserError(
			'Invariant 3 (targets and tabs): carries ref or tab in native arguments',
			'BROWSER_JOURNEY_INVALID',
		)
	if (
		action === 'unresolved'
			? !isString(value['gap']) || value['gap'].length === 0
			: value['gap'] !== undefined
	)
		throw new BrowserError(
			'Invariant 7 (actions): has an incompatible gap',
			'BROWSER_JOURNEY_INVALID',
		)
	if (!native) return
	const text =
		action === 'type' || action === 'wait'
			? 'text'
			: action === 'navigate'
				? 'url'
				: action === 'press'
					? 'key'
					: undefined
	const allowed = text === undefined ? [] : [text]
	if (action === 'type') allowed.push('submit')
	if (action === 'dialog') allowed.push('accept', 'text')
	if (
		Object.keys(args).some((key) => !allowed.includes(key)) ||
		(text !== undefined && !isBrowserJourneyBinding(args[text])) ||
		(args['submit'] !== undefined && !isBoolean(args['submit'])) ||
		(action === 'dialog' &&
			(!isBoolean(args['accept']) ||
				(args['text'] !== undefined && !isBrowserJourneyBinding(args['text']))))
	)
		throw new BrowserError(
			'Invariant 7 (actions): has malformed native arguments',
			'BROWSER_JOURNEY_INVALID',
		)
}

/**
 * Validates the journey format and its name, ids, bindings, secrets, JSON, and actions.
 * @param value - Candidate journey
 * @throws BrowserError - Thrown with BROWSER_JOURNEY_FORMAT for an unknown format, or BROWSER_JOURNEY_INVALID naming the failed invariant
 */
export function validateBrowserJourney(value: unknown): asserts value is BrowserJourney {
	if (!isJSONValue(value) || !isRecord(value))
		throw new BrowserError(
			'Invariant 6 (JSON round trip): is not a JSON record',
			'BROWSER_JOURNEY_INVALID',
		)
	if (value['format'] !== BROWSER_JOURNEY_FORMAT_VERSION)
		throw new BrowserError('Has an unknown journey format', 'BROWSER_JOURNEY_FORMAT')
	if (!isString(value['name']) || !BROWSER_JOURNEY_NAME_PATTERN.test(value['name']))
		throw new BrowserError(
			'Invariant 1 (name): has an invalid journey name',
			'BROWSER_JOURNEY_INVALID',
		)
	if (!isString(value['description']) || !isArray(value['steps']) || !isRecord(value['parameters']))
		throw new BrowserError(
			'Invariant 6 (JSON round trip): has malformed journey fields',
			'BROWSER_JOURNEY_INVALID',
		)
	if (!Number.isSafeInteger(value['next']) || !isFiniteNumber(value['next']) || value['next'] < 1)
		throw new BrowserError(
			'Invariant 2 (ids): has an invalid next counter',
			'BROWSER_JOURNEY_INVALID',
		)
	const ids = new Set<string>()
	const steps: BrowserJourneyStepInput[] = []
	for (const step of value['steps']) {
		validateBrowserJourneyStep(step)
		if (
			!('id' in step) ||
			!isString(step.id) ||
			!/^s[1-9]\d*$/.test(step.id) ||
			!Number.isSafeInteger(Number(step.id.slice(1))) ||
			Number(step.id.slice(1)) >= value['next'] ||
			ids.has(step.id)
		)
			throw new BrowserError(
				'Invariant 2 (ids): repeats an id or exceeds the next counter',
				'BROWSER_JOURNEY_INVALID',
			)
		ids.add(step.id)
		steps.push(step)
	}
	const bindings = collectBrowserJourneyBindings(steps)
	for (const [name, parameter] of Object.entries(value['parameters'])) {
		if (!BROWSER_JOURNEY_PARAMETER_PATTERN.test(name))
			throw new BrowserError(
				'Invariant 4 (bindings): has an invalid parameter name',
				'BROWSER_JOURNEY_INVALID',
			)
		validateBrowserJourneyParameter(parameter)
		if (!bindings.has(name))
			throw new BrowserError(
				`Invariant 4 (bindings): declares "${name}" but no step binds it`,
				'BROWSER_JOURNEY_INVALID',
			)
	}
	for (const [name, fields] of bindings) {
		if (!Object.hasOwn(value['parameters'], name))
			throw new BrowserError(
				`Invariant 4 (bindings): binds undeclared parameter "${name}"`,
				'BROWSER_JOURNEY_INVALID',
			)
		const parameter = value['parameters'][name]
		validateBrowserJourneyParameter(parameter)
		if (parameter.secret === true && fields.some((field) => field !== 'type.text'))
			throw new BrowserError(
				`Invariant 5 (secrets): binds secret "${name}" outside type.text`,
				'BROWSER_JOURNEY_INVALID',
			)
	}
}

/**
 * Validates an edit structure before its position-dependent checks.
 * @param value - Candidate edit
 * @throws BrowserError - Thrown when the operation or its fields are malformed
 */
export function validateBrowserJourneyEdit(value: unknown): asserts value is BrowserJourneyEdit {
	if (!isJSONValue(value) || !isRecord(value))
		throw new BrowserError('has a malformed edit', 'BROWSER_JOURNEY_EDIT')
	switch (value['operation']) {
		case 'add':
			if (
				Object.keys(value).some((key) => !['operation', 'step', 'before', 'after'].includes(key)) ||
				(value['before'] !== undefined && !isString(value['before'])) ||
				(value['after'] !== undefined && !isString(value['after'])) ||
				(value['before'] !== undefined && value['after'] !== undefined)
			)
				break
			validateBrowserJourneyStep(value['step'])
			if ('id' in value['step']) break
			return
		case 'remove':
			if (
				!isString(value['id']) ||
				Object.keys(value).some((key) => key !== 'operation' && key !== 'id')
			)
				break
			return
		case 'update':
			if (
				!isString(value['id']) ||
				Object.keys(value).some(
					(key) => !['operation', 'id', 'arguments', 'target', 'tab'].includes(key),
				) ||
				(value['arguments'] !== undefined && !isRecord(value['arguments'])) ||
				(value['target'] !== undefined && !isBrowserJourneyTarget(value['target'])) ||
				(value['tab'] !== undefined && !isBrowserJourneyTab(value['tab']))
			)
				break
			return
		case 'declare':
			if (
				!isString(value['name']) ||
				!BROWSER_JOURNEY_PARAMETER_PATTERN.test(value['name']) ||
				Object.keys(value).some((key) => !['operation', 'name', 'parameter'].includes(key))
			)
				break
			validateBrowserJourneyParameter(value['parameter'])
			return
	}
	throw new BrowserError('has a malformed edit or duplicate anchors', 'BROWSER_JOURNEY_EDIT')
}

/**
 * Validates a persisted run and the journey it carries.
 * @param value - Candidate run
 * @throws BrowserError - Thrown when the format, run fields, or embedded journey fails validation
 */
export function validateBrowserRun(value: unknown): asserts value is BrowserRun {
	if (!isJSONValue(value) || !isRecord(value))
		throw new BrowserError('Run is not a JSON record', 'BROWSER_JOURNEY_INVALID')
	if (value['format'] !== BROWSER_JOURNEY_FORMAT_VERSION)
		throw new BrowserError('Has an unknown run format', 'BROWSER_JOURNEY_FORMAT')
	validateBrowserJourney(value['journey'])
	const journey = value['journey']
	if (
		!isString(value['id']) ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9]{4}$/.test(value['id']) ||
		!isRecord(value['inputs']) ||
		!Object.values(value['inputs']).every(isString) ||
		!isArray(value['steps']) ||
		parseEnum(value['outcome'], ['complete', 'stopped', 'aborted']) === undefined ||
		!isFiniteNumber(value['elapsed']) ||
		value['elapsed'] < 0 ||
		(value['revision'] !== undefined &&
			(!isFiniteNumber(value['revision']) ||
				!Number.isSafeInteger(value['revision']) ||
				value['revision'] < 1)) ||
		(value['fault'] !== undefined && !isString(value['fault'])) ||
		(value['output'] !== undefined &&
			(!isArray(value['output']) || !value['output'].every(isString)))
	)
		throw new BrowserError('Run has malformed fields', 'BROWSER_JOURNEY_INVALID')
	for (const [index, step] of value['steps'].entries()) {
		const source = journey.steps[index]
		if (
			!isRecord(step) ||
			source === undefined ||
			step['id'] !== source.id ||
			step['action'] !== source.action ||
			!isString(step['trigger']) ||
			!isRecord(step['arguments']) ||
			!isString(step['result']) ||
			!isFiniteNumber(step['elapsed']) ||
			step['elapsed'] < 0 ||
			parseEnum(step['outcome'], ['done', 'refused', 'timeout', 'interrupted']) === undefined ||
			(step['capture'] !== undefined && !isString(step['capture'])) ||
			(step['stage'] !== undefined &&
				parseEnum(step['stage'], ['requested', 'committed', 'loaded']) === undefined) ||
			(step['reason'] !== undefined &&
				parseEnum(step['reason'], [
					'anchorClick',
					'formSubmissionGet',
					'formSubmissionPost',
					'httpHeaderRefresh',
					'initialFrameNavigation',
					'metaTagRefresh',
					'other',
					'pageBlockInterstitial',
					'reload',
					'scriptInitiated',
				]) === undefined)
		)
			throw new BrowserError(
				'Run has a malformed step or is not a journey prefix',
				'BROWSER_JOURNEY_INVALID',
			)
	}
	for (const [name, parameter] of Object.entries(journey.parameters)) {
		if (
			parameter.secret === true &&
			(Object.hasOwn(value['inputs'], name) ||
				value['output'] !== undefined ||
				value['steps'].some((step) => isRecord(step) && step['capture'] !== undefined))
		)
			throw new BrowserError(
				'Invariant 5 (secrets): run retains secret inputs, output, or captures',
				'BROWSER_JOURNEY_INVALID',
			)
	}
	if (Object.keys(value['inputs']).some((name) => !Object.hasOwn(journey.parameters, name)))
		throw new BrowserError('Run has an unknown input', 'BROWSER_JOURNEY_INVALID')
	if (
		value['outcome'] === 'complete' &&
		(value['steps'].length !== journey.steps.length ||
			value['steps'].some((step, index) => {
				if (!isRecord(step)) return true
				const following = journey.steps[index + 1]
				return (
					(step['outcome'] !== 'done' &&
						!(step['outcome'] === 'interrupted' && following?.action === 'dialog')) ||
					(step['stage'] !== undefined && step['stage'] !== 'loaded')
				)
			}))
	)
		throw new BrowserError('Run completion does not match its steps', 'BROWSER_JOURNEY_INVALID')
	for (const [index, source] of journey.steps.entries()) {
		const binding = source.arguments['text']
		const step = value['steps'][index]
		if (
			source.action === 'type' &&
			isBrowserJourneyBinding(binding) &&
			!isString(binding) &&
			journey.parameters[binding.parameter]?.secret === true &&
			isRecord(step) &&
			isRecord(step['arguments']) &&
			Object.hasOwn(step['arguments'], 'text')
		)
			throw new BrowserError(
				'Invariant 5 (secrets): run retains secret type.text',
				'BROWSER_JOURNEY_INVALID',
			)
	}
}
