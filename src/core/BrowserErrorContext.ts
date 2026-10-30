import {
	arrayOf,
	INTRINSICS,
	isBoolean,
	isFunction,
	isNumber,
	isObject,
	isRecord,
	isString,
} from '@orkestrel/contract'

/** Checks error metadata while retaining non-finite numbers that describe refused inputs. */
export class BrowserErrorContext {
	readonly #visited = new WeakMap<object, boolean>()

	matches(value: unknown): boolean {
		if (!isObject(value) && !isFunction(value)) return false
		return this.#record(value)
	}

	#value(value: unknown): boolean {
		if (value === null || isString(value) || isBoolean(value) || isNumber(value)) return true
		if (INTRINSICS.array(value)) {
			const previous = this.#visited.get(value)
			if (previous !== undefined) return previous
			this.#visited.set(value, false)
			const valid = arrayOf(this.#value.bind(this))(value)
			this.#visited.set(value, valid)
			return valid
		}
		return isRecord(value) && this.#record(value)
	}

	#record(value: object): boolean {
		const previous = this.#visited.get(value)
		if (previous !== undefined) return previous
		this.#visited.set(value, false)
		const valid = INTRINSICS.keys(value).every((key) =>
			this.#value(INTRINSICS.reflect.read(value, key)),
		)
		this.#visited.set(value, valid)
		return valid
	}
}
