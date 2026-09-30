import { isObject } from '@orkestrel/contract'

// === Browser document

/**
 * Narrows a value to a `Document` attached to a window.
 *
 * @param value - The value to test
 * @returns `true` for an object that is a `Document` with a `defaultView`, otherwise `false`
 */
export function isBrowserDocument(value: unknown): value is Document {
	return (
		isObject(value) &&
		Reflect.get(value, 'nodeType') === 9 &&
		isObject(Reflect.get(value, 'defaultView'))
	)
}
