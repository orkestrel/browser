import type {
	BrowserEpochFunction,
	BrowserReadOptions,
	BrowserReadResult,
	BrowserContentInput,
	BrowserContentInterface,
} from './types.js'
import type { HTMLInterface } from '@orkestrel/html'
import { extractBrowserSlice } from './helpers.js'
import { createHTML, renderText, resolveAttributes } from '@orkestrel/html'
import { htmlToMarkdown, renderMarkdown } from '@orkestrel/markdown'

/**
 * Represents one captured document, parsed one time and projected to Markdown or plain text in
 * bounded slices.
 *
 * @example
 * ```ts
 * import { BrowserContent } from '@orkestrel/browser'
 *
 * const reading = new BrowserContent({
 * 	url: 'https://example.com/',
 * 	title: 'Example',
 * 	html: '<nav>Menu</nav><main><p>Body</p></main>',
 * })
 * reading.markdown({ distill: true }) // { text: 'Body', offset: 0, total: 4 }
 * ```
 */
export class BrowserContent implements BrowserContentInterface {
	readonly #url: string
	readonly #title: string
	readonly #html: HTMLInterface
	readonly #epoch: number | undefined
	readonly #navigation: BrowserEpochFunction | undefined
	// A projection reads only the immutable handle, so each one is computed once per mode.
	readonly #markdowns: Map<boolean, string> = new Map()
	readonly #texts: Map<boolean, string> = new Map()
	#distilled: HTMLInterface | undefined

	constructor(input: BrowserContentInput) {
		this.#url = input.url
		this.#title = input.title
		this.#html = createHTML(input.html)
		this.#navigation = input.navigation
		this.#epoch = input.epoch ?? input.navigation?.()
	}

	get url(): string {
		return this.#url
	}

	get title(): string {
		return this.#title
	}

	get html(): HTMLInterface {
		return this.#html
	}

	get stale(): boolean {
		return this.#navigation !== undefined && this.#navigation() !== this.#epoch
	}

	markdown(options?: BrowserReadOptions): BrowserReadResult {
		const distill = options?.distill ?? false
		const cached = this.#markdowns.get(distill)
		if (cached !== undefined) return extractBrowserSlice(cached, options?.offset, options?.limit)
		const text = renderMarkdown(htmlToMarkdown(this.#source(distill).document))
		this.#markdowns.set(distill, text)
		return extractBrowserSlice(text, options?.offset, options?.limit)
	}

	text(options?: BrowserReadOptions): BrowserReadResult {
		const distill = options?.distill ?? false
		const cached = this.#texts.get(distill)
		if (cached !== undefined) return extractBrowserSlice(cached, options?.offset, options?.limit)
		const text = renderText(this.#source(distill).document)
		this.#texts.set(distill, text)
		return extractBrowserSlice(text, options?.offset, options?.limit)
	}

	#source(distill: boolean): HTMLInterface {
		if (!distill)
			return this.#html.map((node) =>
				node.category === 'element'
					? { ...node, attributes: resolveAttributes(node, this.#url) }
					: node,
			)
		this.#distilled ??= this.#html.distill({ base: this.#url })
		return this.#distilled
	}
}
