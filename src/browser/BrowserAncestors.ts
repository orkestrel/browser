import type { BrowserAncestorReader } from './types.js'

/** Traverses ancestors lazily while retaining the previously yielded node. */
export class BrowserAncestors<T> extends Iterator<T, undefined> {
	readonly #parent: BrowserAncestorReader<T>
	#current: T | null
	#previous: T | null
	#started = false

	constructor(node: T | null, parent: BrowserAncestorReader<T>) {
		super()
		this.#current = node
		this.#previous = node
		this.#parent = parent
	}

	next(): IteratorResult<T, undefined> {
		if (this.#started && this.#current !== null) {
			this.#previous = this.#current
			this.#current = this.#parent(this.#current)
		}
		this.#started = true
		return this.#current === null
			? { done: true, value: undefined }
			: { done: false, value: this.#current }
	}

	get previous(): T | null {
		return this.#previous
	}
}
