import type { BrowserOutlineNode } from './types.js'

/** Traverses outline parents lazily through the supplied index. */
export class BrowserOutlineAncestors extends Iterator<BrowserOutlineNode, undefined> {
	readonly #indexed: ReadonlyMap<string, BrowserOutlineNode>
	#current: BrowserOutlineNode | undefined
	#started = false

	constructor(
		node: BrowserOutlineNode | undefined,
		indexed: ReadonlyMap<string, BrowserOutlineNode>,
	) {
		super()
		this.#current = node
		this.#indexed = indexed
	}

	next(): IteratorResult<BrowserOutlineNode, undefined> {
		if (this.#started && this.#current !== undefined)
			this.#current = this.#indexed.get(`${this.#current.session}:${this.#current.parent}`)
		this.#started = true
		return this.#current === undefined
			? { done: true, value: undefined }
			: { done: false, value: this.#current }
	}
}
