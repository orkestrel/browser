/** Yields positive ordinals for fallback secret parameter names. */
export class BrowserOrdinals extends Iterator<number, undefined> {
	#value = 1

	next(): IteratorYieldResult<number> {
		return { done: false, value: this.#value++ }
	}
}
