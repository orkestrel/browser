import type { BrowserLine, BrowserLineSpan, BrowserTextRange } from './types.js'
import { BROWSER_READ_WIDTH } from './constants.js'
import { renderBrowserLine, findBrowserWrapSpace, skipBrowserWhitespace } from './helpers.js'

/** Wraps one semantic line while retaining its continuation and reference boundaries. */
export class BrowserLineWrap extends Iterator<BrowserLine, undefined> {
	readonly #line: BrowserLine
	readonly #text: string
	readonly #references: readonly BrowserTextRange[]
	#offset = 0
	#continuation = false

	constructor(line: BrowserLine) {
		super()
		this.#line = line
		this.#text = renderBrowserLine(line)
		const references: BrowserTextRange[] = []
		Iterator.from(line.spans).reduce((boundary, span) => {
			if (span.category === 'reference') references.push([boundary, boundary + span.text.length])
			return boundary + span.text.length
		}, 0)
		this.#references = references
	}

	next(): IteratorResult<BrowserLine, undefined> {
		const text = this.#text
		const offset = this.#offset
		if (offset >= text.length) return { done: true, value: undefined }
		const room = BROWSER_READ_WIDTH - (this.#continuation ? 1 : 0)
		const boundary = Math.min(text.length, offset + room)
		const whitespace =
			boundary < text.length
				? findBrowserWrapSpace(
						text,
						offset,
						text.slice(offset, boundary + 1).search(/\s+\S*$/u),
						this.#references,
					)
				: 0
		const hard = boundary < text.length && whitespace <= 0
		const cut = hard
			? this.#references.reduce(
					(end, [start, last]) =>
						end >= start - 1 && end < last ? Math.max(offset + 1, start - 2) : end,
					boundary,
				)
			: boundary
		const end =
			boundary >= text.length
				? boundary
				: whitespace > 0
					? offset + whitespace
					: text.charCodeAt(cut - 1) >= 0xd800 && text.charCodeAt(cut - 1) <= 0xdbff
						? cut - 1
						: cut
		const spans: BrowserLineSpan[] = this.#continuation ? [{ category: 'syntax', text: '↳' }] : []
		Iterator.from(this.#line.spans).reduce((position, span) => {
			const last = position + span.text.length
			if (last > offset && position < end)
				spans.push({
					category: span.category,
					text: span.text.slice(Math.max(0, offset - position), end - position),
				})
			return last
		}, 0)
		this.#offset = hard ? end : skipBrowserWhitespace(text, end)
		this.#continuation = hard
		return { done: false, value: { spans } }
	}
}
