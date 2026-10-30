import type { BrowserDOMOutlineInput, BrowserDOMOutlineInterface } from './types.js'
import type { BrowserOutlineNode } from '@src/core'
import { BROWSER_INTERACTIVE_ROLES, normalizeBrowserName } from '@src/core'
import { BROWSER_CONTENT_NAMED_ROLES } from './constants.js'
import {
	matchesBrowserHidden,
	matchesBrowserInvisible,
	readBrowserBlock,
	computeBrowserName,
	computeBrowserRole,
	skipBrowserSubtree,
} from './helpers.js'

/** Captures one flat-tree subtree while retaining its text and visibility state. */
export class BrowserDOMOutline implements BrowserDOMOutlineInterface {
	readonly #input: BrowserDOMOutlineInput
	#text = ''
	#block: Node | undefined
	#silenced: Element | undefined
	#node: Node | null = null

	constructor(input: BrowserDOMOutlineInput) {
		this.#input = input
	}

	capture(): void {
		const { root, rows, muted } = this.#input
		this.#text = ''
		this.#block = undefined
		this.#silenced = undefined
		const document = root.ownerDocument
		const view = document.defaultView
		if (view === null) return
		if (root instanceof view.Element && matchesBrowserHidden(root)) return
		this.#input.watch(document)
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
			(node) =>
				node instanceof view.Element && matchesBrowserHidden(node)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT,
		)
		this.#node = root instanceof view.Element ? root : walker.nextNode()
		while (this.#node !== null) {
			if (this.#silenced !== undefined && !this.#silenced.contains(this.#node))
				this.#silenced = undefined
			const quiet = muted || this.#silenced !== undefined
			if (!(this.#node instanceof view.Element)) {
				const parent = this.#node.parentElement
				const data = this.#node.textContent ?? ''
				const blank = data.trim() === ''
				// Whitespace between two texts of one block separates them, so it joins the pending text
				// and normalization collapses it; elsewhere it contributes nothing.
				if (
					!quiet &&
					(!blank || this.#text !== '') &&
					(parent === null || !matchesBrowserInvisible(parent))
				) {
					const container = readBrowserBlock(parent, root)
					if (!blank) {
						if (this.#block !== undefined && this.#block !== container)
							this.#text = this.#flush(rows, this.#text, this.#block)
						this.#text += data
						this.#block = container
					} else if (container === this.#block) this.#text += data
				}
				this.#node = walker.nextNode()
				continue
			}
			const invisible = matchesBrowserInvisible(this.#node)
			// A rendered break separates the texts of its block the way whitespace does; the walker never
			// reaches a hidden one.
			if (this.#node.localName === 'br') {
				if (!quiet && this.#text !== '') this.#text += '\n'
				this.#node = walker.nextNode()
				continue
			}
			if (this.#node instanceof view.HTMLIFrameElement) {
				this.#text = this.#flush(rows, this.#text, this.#block)
				const child = this.#node.contentDocument
				if (invisible) {
					this.#node = skipBrowserSubtree(walker)
					continue
				}
				if (child === null) {
					this.#input.text(
						rows,
						`iframe ${JSON.stringify(computeBrowserName(this.#node))} (cross-origin, not readable)`,
					)
				} else {
					this.#input.walk(child.documentElement, rows, quiet)
				}
				this.#node = skipBrowserSubtree(walker)
				continue
			}
			if (this.#node instanceof view.HTMLSlotElement) {
				this.#text = this.#flush(rows, this.#text, this.#block)
				for (const assigned of this.#node.assignedNodes({ flatten: true })) {
					if (assigned instanceof view.Element) this.#input.walk(assigned, rows, quiet)
					else if (!quiet) this.#flush(rows, assigned.textContent ?? '')
				}
				this.#node = skipBrowserSubtree(walker)
				continue
			}
			const tool =
				this.#node.localName === 'form' ? (this.#node.getAttribute('toolname') ?? '') : ''
			const role = tool === '' ? computeBrowserRole(this.#node) : 'form'
			if (
				!invisible &&
				role !== undefined &&
				(BROWSER_INTERACTIVE_ROLES.has(role) ||
					[
						'heading',
						'image',
						'img',
						'listitem',
						'row',
						'cell',
						'gridcell',
						'columnheader',
						'rowheader',
					].includes(role) ||
					tool !== '')
			) {
				this.#text = this.#flush(rows, this.#text, this.#block)
				const row = this.#input.row(this.#node, role, view, String(rows.length))
				rows.push(row)
				this.#input.positions.set(this.#node, row.id)
				if (
					this.#silenced === undefined &&
					BROWSER_CONTENT_NAMED_ROLES.has(role) &&
					!['row', 'cell', 'gridcell', 'columnheader', 'rowheader'].includes(role)
				)
					this.#silenced = this.#node
				if (this.#node.localName === 'textarea') {
					this.#node = skipBrowserSubtree(walker)
					continue
				}
			}
			const shadow = this.#node.shadowRoot
			if (shadow !== null) {
				this.#text = this.#flush(rows, this.#text, this.#block)
				this.#input.walk(shadow, rows, muted || this.#silenced !== undefined)
				this.#node = skipBrowserSubtree(walker)
				continue
			}
			this.#node = walker.nextNode()
		}
		this.#flush(rows, this.#text, this.#block)
	}

	#flush(rows: BrowserOutlineNode[], text: string, parent?: Node): string {
		if (normalizeBrowserName(text) !== '') this.#input.text(rows, text, parent)
		return ''
	}
}
