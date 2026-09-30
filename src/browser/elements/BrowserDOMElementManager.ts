import type {
	BrowserCallOptions,
	BrowserElementManagerInterface,
	BrowserElementQuery,
	BrowserElementWaitOptions,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserOutlineOptions,
} from '@src/core'
import type { BrowserDOMElementInterface, BrowserDOMElementManagerInput } from '../types.js'
import { attempt, isInteger } from '@orkestrel/contract'
import {
	BROWSER_INTERACTIVE_ROLES,
	BROWSER_OUTLINE_LIMIT,
	BROWSER_REFERENCE_PREFIX,
	BrowserElementError,
	BrowserError,
	filterBrowserOutline,
	normalizeBrowserName,
	parseBrowserReference,
	renderBrowserOutline,
	validateBrowserTimeout,
} from '@src/core'
import { BrowserDOMElement } from './BrowserDOMElement.js'
import {
	BROWSER_CONTENT_NAMED_ROLES,
	BROWSER_DOCUMENT_TIMEOUT_MS,
	BROWSER_TYPED_INPUTS,
} from '../constants.js'
import {
	computeBrowserName,
	computeBrowserRole,
	matchesBrowserHidden,
	observeBrowserMutations,
	readBrowserBlock,
	skipBrowserSubtree,
} from '../helpers.js'

/**
 * Outlines a DOM document from its elements and binds stable references to the interactive ones.
 *
 * @remarks
 * Rows come in document order from a `TreeWalker`. A hidden element and its subtree are omitted,
 * a same-origin `iframe` contributes its document's rows in place, and a cross-origin one renders
 * `iframe "NAME" (cross-origin, not readable)`. An element whose role `BROWSER_INTERACTIVE_ROLES`
 * names receives a reference that never changes while the manager holds it, and a reference
 * number is never reused. A form carrying a `toolname` attribute renders `[tool=NAME]` after its
 * role and name. A CSS query searches the document the view drives, not its child documents.
 *
 * @example
 * ```ts
 * const view = createBrowserDOMView({ document: frame.contentDocument })
 * const outline = await view.elements.outline()
 * const [save] = await view.elements.find({ role: 'button', name: 'save' })
 * ```
 */
export class BrowserDOMElementManager implements BrowserElementManagerInterface<BrowserDOMElementInterface> {
	readonly #input: BrowserDOMElementManagerInput
	readonly #records = new Map<Element, BrowserDOMElement>()
	#count = 0

	constructor(input: BrowserDOMElementManagerInput) {
		this.#input = input
	}

	async outline(options?: BrowserOutlineOptions): Promise<BrowserOutline> {
		const limit = options?.limit ?? BROWSER_OUTLINE_LIMIT
		if (!isInteger(limit) || limit < 0) {
			throw new BrowserError('Outline limit must be a nonnegative integer', undefined, { limit })
		}
		options?.signal?.throwIfAborted()
		const document = this.#input.document()
		const rows: BrowserOutlineNode[] = []
		this.#walk(this.#root(document, options?.within), rows)
		return renderBrowserOutline(document.URL, document.title, rows, limit)
	}

	async find(
		query: BrowserElementQuery,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserDOMElementInterface[]> {
		options?.signal?.throwIfAborted()
		return this.#find(query)
	}

	async wait(
		query: BrowserElementQuery,
		options?: BrowserElementWaitOptions,
	): Promise<readonly BrowserDOMElementInterface[]> {
		const timeout = options?.timeout ?? BROWSER_DOCUMENT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const absent = options?.absent === true
		const root = this.#root(this.#input.document(), query.within)
		return await observeBrowserMutations({
			documents: this.#documents(root),
			check: this.#match.bind(this, query, absent),
			timeout,
			signal: options?.signal,
			subject: 'Element wait',
		})
	}

	element(reference: string): BrowserDOMElementInterface | undefined {
		const canonical = parseBrowserReference(reference)
		return [...this.#records.values()].find((element) => element.reference === canonical)
	}

	elements(): readonly BrowserDOMElementInterface[] {
		return [...this.#records.values()]
	}

	clear(): void {
		this.#records.clear()
	}

	// Reports the elements a wait settles on, or undefined while it keeps waiting.
	#match(
		query: BrowserElementQuery,
		absent: boolean,
	): readonly BrowserDOMElementInterface[] | undefined {
		const found = this.#find(query)
		return (absent ? found.length === 0 : found.length > 0) ? found : undefined
	}

	#find(query: BrowserElementQuery): readonly BrowserDOMElement[] {
		const root = this.#root(this.#input.document(), query.within)
		const rows: BrowserOutlineNode[] = []
		this.#walk(root, rows)
		const matches = filterBrowserOutline(rows, query).flatMap((row) => {
			const element = [...this.#records.values()].find(
				(candidate) => candidate.reference === row.reference,
			)
			return element === undefined ? [] : [element]
		})
		const css = query.css
		if (css === undefined) return matches
		const selected = attempt(() => Array.from(root.querySelectorAll(css)))
		if (!selected.success) {
			throw new BrowserError(`CSS query is invalid: ${css}`, 'BROWSER_ELEMENT_QUERY', { css })
		}
		const bound = selected.value.map((element) => this.#bind(element))
		if (query.role === undefined && query.name === undefined) return bound
		return matches.filter((element) => bound.includes(element))
	}

	// Resolves the element an outline, query, or wait is scoped to.
	#root(document: Document, within?: string): Element {
		if (within === undefined) return document.documentElement
		const canonical = parseBrowserReference(within)
		const node = [...this.#records].find(([, element]) => element.reference === canonical)?.[0]
		if (node === undefined || !node.isConnected || node.ownerDocument.defaultView === null) {
			throw new BrowserElementError(within, 'GONE')
		}
		return node
	}

	// Collects the documents a wait observes: the scope's own and each same-origin child's.
	#documents(root: Element): readonly Document[] {
		const documents = [root.ownerDocument]
		for (const frame of root.querySelectorAll('iframe')) {
			const child = frame.contentDocument
			if (child !== null) documents.push(...this.#documents(child.documentElement))
		}
		return documents
	}

	// Appends the rows of one document subtree, descending into same-origin frames in place.
	#walk(root: Element, rows: BrowserOutlineNode[]): void {
		const document = root.ownerDocument
		const view = document.defaultView
		if (view === null) return
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
			(node) =>
				node instanceof view.Element && matchesBrowserHidden(node)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT,
		)
		let text = ''
		let block: Element | undefined
		let muted: Element | undefined
		let node: Node | null = root
		while (node !== null) {
			if (muted !== undefined && !muted.contains(node)) muted = undefined
			if (!(node instanceof view.Element)) {
				if (muted === undefined && (node.textContent ?? '').trim() !== '') {
					const container = readBrowserBlock(node.parentElement, root)
					if (block !== undefined && block !== container) text = this.#flush(rows, text)
					text += node.textContent ?? ''
					block = container
				}
				node = walker.nextNode()
				continue
			}
			if (node instanceof view.HTMLIFrameElement) {
				text = this.#flush(rows, text)
				const child = node.contentDocument
				if (child === null) {
					this.#text(
						rows,
						`iframe ${JSON.stringify(computeBrowserName(node))} (cross-origin, not readable)`,
					)
				} else {
					this.#walk(child.documentElement, rows)
				}
				node = skipBrowserSubtree(walker)
				continue
			}
			const role = computeBrowserRole(node)
			if (role !== undefined && (BROWSER_INTERACTIVE_ROLES.has(role) || role === 'heading')) {
				text = this.#flush(rows, text)
				rows.push(this.#row(node, role, view, String(rows.length)))
				if (muted === undefined && BROWSER_CONTENT_NAMED_ROLES.has(role)) muted = node
				if (node.localName === 'select' || node.localName === 'textarea') {
					node = skipBrowserSubtree(walker)
					continue
				}
			}
			const tool = node.localName === 'form' ? (node.getAttribute('toolname') ?? '') : ''
			if (tool !== '') {
				text = this.#flush(rows, text)
				this.#text(rows, `form ${JSON.stringify(computeBrowserName(node))} [tool=${tool}]`)
			}
			node = walker.nextNode()
		}
		this.#flush(rows, text)
	}

	// Emits the pending text as one row and returns the emptied buffer.
	#flush(rows: BrowserOutlineNode[], text: string): string {
		if (normalizeBrowserName(text) !== '') this.#text(rows, text)
		return ''
	}

	#text(rows: BrowserOutlineNode[], text: string): void {
		rows.push({
			id: String(rows.length),
			parent: undefined,
			children: [],
			backend: undefined,
			frame: undefined,
			ignored: false,
			role: 'StaticText',
			name: normalizeBrowserName(text),
			description: undefined,
			value: undefined,
			properties: {},
			session: '',
			reference: undefined,
		})
	}

	#row(
		element: Element,
		role: string,
		view: Window & typeof globalThis,
		id: string,
	): BrowserOutlineNode {
		const reference = role === 'heading' ? undefined : this.#bind(element).reference
		const input = element instanceof view.HTMLInputElement ? element : undefined
		const checked =
			input !== undefined && (input.type === 'checkbox' || input.type === 'radio')
				? input.checked
				: element.getAttribute('aria-checked') === 'true'
		let value: string | undefined
		if (element instanceof view.HTMLSelectElement)
			value = Array.from(element.selectedOptions, (option) => option.label).join(', ')
		else if (element instanceof view.HTMLTextAreaElement) value = element.value
		else if (
			input !== undefined &&
			input.type !== 'password' &&
			(BROWSER_TYPED_INPUTS.has(input.type) || input.type === 'range')
		)
			value = input.value
		return {
			id: reference ?? id,
			parent: undefined,
			children: [],
			backend: undefined,
			frame: undefined,
			ignored: false,
			role,
			name: computeBrowserName(element, role),
			description: undefined,
			value,
			properties: { checked, disabled: element.matches(':disabled') },
			session: '',
			reference,
		}
	}

	#bind(element: Element): BrowserDOMElement {
		const existing = this.#records.get(element)
		if (existing !== undefined) return existing
		this.#count += 1
		const reference = `${BROWSER_REFERENCE_PREFIX}${this.#count}`
		const created = new BrowserDOMElement({
			reference,
			node: element,
			current: this.#holds.bind(this, element, reference),
			navigation: this.#input.navigation,
		})
		this.#records.set(element, created)
		return created
	}

	#holds(element: Element, reference: string): boolean {
		return this.#records.get(element)?.reference === reference
	}
}
