import type { BrowserCaptureCursor, BrowserCaptureSibling } from './types.js'

/** Traverses paired live and inert siblings while preserving pointers across pruning. */
export class BrowserCaptureSiblings extends Iterator<BrowserCaptureSibling, undefined> {
	#element: Element | null
	#counterpart: Element | null
	#child: Node | null
	#mirror: Node | null
	#previous: BrowserCaptureCursor | undefined

	constructor(live: Element, twin: Element) {
		super()
		this.#element = live.lastElementChild
		this.#counterpart = twin.lastElementChild
		this.#child = live.lastChild
		this.#mirror = twin.lastChild
	}

	next(): IteratorResult<BrowserCaptureSibling, undefined> {
		if (this.#previous !== undefined) {
			if (this.#child?.nodeType === 1) {
				this.#element = this.#previous.element
				this.#counterpart = this.#previous.counterpart
			}
			this.#child = this.#previous.child
			this.#mirror = this.#previous.mirror
		}
		if (this.#child === null || this.#mirror === null) {
			this.#previous = undefined
			this.#child = null
			return { done: true, value: undefined }
		}
		this.#previous = {
			child: this.#child.previousSibling,
			mirror: this.#mirror.previousSibling,
			element: this.#element?.previousElementSibling ?? null,
			counterpart: this.#counterpart?.previousElementSibling ?? null,
		}
		return {
			done: false,
			value: {
				child: this.#child,
				mirror: this.#mirror,
				element: this.#element,
				counterpart: this.#counterpart,
			},
		}
	}
}
