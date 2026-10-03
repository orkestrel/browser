import type {
	BrowserCallOptions,
	BrowserElementInterface,
	BrowserElementManagerInterface,
	BrowserElementQuery,
	BrowserWaitOptions,
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
import { BrowserDOMWait } from '../BrowserDOMWait.js'
import {
	BROWSER_CONTENT_NAMED_ROLES,
	BROWSER_DOCUMENT_TIMEOUT_MS,
	BROWSER_TYPED_INPUTS,
} from '../constants.js'
import {
	collectBrowserRoots,
	computeBrowserName,
	computeBrowserRole,
	listenBrowserNavigation,
	matchesBrowserHidden,
	matchesBrowserInvisible,
	matchesBrowserOmitted,
	readBrowserBlock,
	readBrowserStates,
	skipBrowserSubtree,
} from '../helpers.js'

/**
 * Outlines a DOM document from its elements and binds stable references to the interactive ones.
 *
 * @remarks
 * Rows come in document order from a `TreeWalker` over the flat tree: an open shadow root
 * contributes its rows in place of its host's children, a `slot` its assigned nodes, and a
 * same-origin `iframe` its document's rows, while a cross-origin one renders
 * `iframe "NAME" (cross-origin, not readable)`. An element that `matchesBrowserHidden` reports is
 * omitted with its subtree, a scope root in such a subtree yields no row, and an element that
 * `matchesBrowserInvisible` reports yields no row of its own. An element whose role
 * `BROWSER_INTERACTIVE_ROLES` names receives a reference bound through a `WeakRef`, which never
 * changes while the manager holds it, and a reference number is never reused. Every outline or
 * query that encounters a bound element records its role and name afresh, and the element's
 * wrapper reports that latest capture, also after the manager drops the reference. A reference
 * and a reading from any walked document record that document's epoch, which advances on its own
 * navigation events and on the view's; that document's `pagehide` drops its references. A form
 * carrying a `toolname` attribute renders `[tool=NAME]` after its role and name. A row carries
 * `focused` when its element is the active element of its own document or shadow root. Rows carry
 * pressed, expanded, and selected states through the Chromium mapping in `readBrowserStates`.
 * A `select` row is followed by one `option` row per option, named by its label. Whitespace between two texts of
 * one block renders as one space, as a rendered `br` between them does, and texts with neither
 * between them stay joined. A CSS query
 * searches the document the view drives, not its child documents or shadow trees. After the
 * input's `signal` aborts, `outline`, `find`, and `wait` reject with its reason.
 *
 * `wait` parks a `BrowserDOMWait` bound to the view's lifetime over every root that
 * `collectBrowserRoots` reaches from its scope, reconciled at every observed mutation and frame
 * `load`. A shadow root attached after the wait began is a declared limit: the wait discovers it
 * at the next observed mutation or `load`, so a match inserted there with no other observed
 * change is not seen before the deadline.
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
	readonly #records = new Map<
		string,
		{ readonly node: WeakRef<Element>; readonly element: BrowserDOMElement }
	>()
	readonly #identities = new WeakMap<Element, string>()
	readonly #descriptions = new WeakMap<
		WeakRef<Element>,
		Pick<BrowserElementInterface, 'role' | 'name'>
	>()
	readonly #epochs = new WeakMap<Document, number>()
	readonly #watched = new WeakSet<Document>()
	#count = 0

	constructor(input: BrowserDOMElementManagerInput) {
		this.#input = input
	}

	async outline(options?: BrowserOutlineOptions): Promise<BrowserOutline> {
		this.#input.signal.throwIfAborted()
		const limit = options?.limit ?? BROWSER_OUTLINE_LIMIT
		if (!isInteger(limit) || limit < 0) {
			throw new BrowserError('Outline limit must be a nonnegative integer', undefined, { limit })
		}
		options?.signal?.throwIfAborted()
		const document = this.#input.document()
		const rows = this.#capture(this.#root(document, options?.within), options?.within)
		return renderBrowserOutline(document.URL, document.title, rows, limit, options?.search)
	}

	async find(
		query: BrowserElementQuery,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserDOMElementInterface[]> {
		this.#input.signal.throwIfAborted()
		options?.signal?.throwIfAborted()
		return this.#find(query)
	}

	async wait(
		query: BrowserElementQuery,
		options?: BrowserWaitOptions,
	): Promise<readonly BrowserDOMElementInterface[]> {
		this.#input.signal.throwIfAborted()
		const start = performance.now()
		const timeout = options?.timeout ?? BROWSER_DOCUMENT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const signal =
			options?.signal === undefined
				? this.#input.signal
				: AbortSignal.any([options.signal, this.#input.signal])
		return await new BrowserDOMWait({
			roots: this.#roots.bind(this, query.within),
			check: this.#match.bind(this, query, options?.absent === true),
			timeout,
			start,
			signal,
			subject: 'Element wait',
		}).execute()
	}

	element(reference: string): BrowserDOMElementInterface | undefined {
		return this.#records.get(parseBrowserReference(reference) ?? '')?.element
	}

	elements(): readonly BrowserDOMElementInterface[] {
		for (const [reference, record] of this.#records) {
			if (record.node.deref() === undefined) this.#records.delete(reference)
		}
		return [...this.#records.values()].map((record) => record.element)
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
		const matches = filterBrowserOutline(this.#capture(root, query.within), query).flatMap(
			(row) => {
				const record = this.#records.get(row.reference ?? '')
				return record === undefined ? [] : [record.element]
			},
		)
		const css = query.css
		if (css === undefined) return matches
		const selected = attempt(() => Array.from(root.querySelectorAll(css)))
		if (!selected.success) {
			throw new BrowserError(`CSS query is invalid: ${css}`, 'BROWSER_ELEMENT_QUERY', { css })
		}
		const bound = selected.value.map((element) => {
			const role = computeBrowserRole(element) ?? 'generic'
			return this.#bind(element, role, computeBrowserName(element, role))
		})
		if (query.role === undefined && query.name === undefined) return bound
		return matches.filter((element) => bound.includes(element))
	}

	// Walks one scope; a scope root in an omitted subtree yields no row.
	#capture(root: Element, within?: string): readonly BrowserOutlineNode[] {
		const rows: BrowserOutlineNode[] = []
		if (within === undefined || !matchesBrowserOmitted(root)) this.#walk(root, rows, false)
		return rows
	}

	// Resolves the element an outline, query, or wait is scoped to.
	#root(document: Document, within?: string): Element {
		if (within === undefined) return document.documentElement
		const node = this.#records.get(parseBrowserReference(within) ?? '')?.node.deref()
		if (node === undefined || !node.isConnected || node.ownerDocument.defaultView === null) {
			throw new BrowserElementError(within, 'GONE')
		}
		return node
	}

	// Collects the roots a wait observes, re-read after every mutation batch and frame load.
	#roots(within?: string): readonly Node[] {
		return collectBrowserRoots(this.#root(this.#input.document(), within))
	}

	// Appends the rows of one flat-tree subtree, descending into shadow roots, slots, and frames.
	#walk(root: Element | ShadowRoot, rows: BrowserOutlineNode[], muted: boolean): void {
		const document = root.ownerDocument
		const view = document.defaultView
		if (view === null) return
		if (root instanceof view.Element && matchesBrowserHidden(root)) return
		this.#watch(document)
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
			(node) =>
				node instanceof view.Element && matchesBrowserHidden(node)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT,
		)
		let text = ''
		let block: Node | undefined
		let silenced: Element | undefined
		let node: Node | null = root instanceof view.Element ? root : walker.nextNode()
		while (node !== null) {
			if (silenced !== undefined && !silenced.contains(node)) silenced = undefined
			const quiet = muted || silenced !== undefined
			if (!(node instanceof view.Element)) {
				const parent = node.parentElement
				const data = node.textContent ?? ''
				const blank = data.trim() === ''
				// Whitespace between two texts of one block separates them, so it joins the pending text
				// and normalization collapses it; elsewhere it contributes nothing.
				if (
					!quiet &&
					(!blank || text !== '') &&
					(parent === null || !matchesBrowserInvisible(parent))
				) {
					const container = readBrowserBlock(parent, root)
					if (!blank) {
						if (block !== undefined && block !== container) text = this.#flush(rows, text)
						text += data
						block = container
					} else if (container === block) text += data
				}
				node = walker.nextNode()
				continue
			}
			const invisible = matchesBrowserInvisible(node)
			// A rendered break separates the texts of its block the way whitespace does; the walker never
			// reaches a hidden one.
			if (node.localName === 'br') {
				if (!quiet && text !== '') text += '\n'
				node = walker.nextNode()
				continue
			}
			if (node instanceof view.HTMLIFrameElement) {
				text = this.#flush(rows, text)
				const child = node.contentDocument
				if (invisible) {
					node = skipBrowserSubtree(walker)
					continue
				}
				if (child === null) {
					this.#text(
						rows,
						`iframe ${JSON.stringify(computeBrowserName(node))} (cross-origin, not readable)`,
					)
				} else {
					this.#walk(child.documentElement, rows, quiet)
				}
				node = skipBrowserSubtree(walker)
				continue
			}
			if (node instanceof view.HTMLSlotElement) {
				text = this.#flush(rows, text)
				for (const assigned of node.assignedNodes({ flatten: true })) {
					if (assigned instanceof view.Element) this.#walk(assigned, rows, quiet)
					else if (!quiet) this.#flush(rows, assigned.textContent ?? '')
				}
				node = skipBrowserSubtree(walker)
				continue
			}
			const tool = node.localName === 'form' ? (node.getAttribute('toolname') ?? '') : ''
			const role = tool === '' ? computeBrowserRole(node) : 'form'
			if (
				!invisible &&
				role !== undefined &&
				(BROWSER_INTERACTIVE_ROLES.has(role) || role === 'heading' || tool !== '')
			) {
				text = this.#flush(rows, text)
				rows.push(this.#row(node, role, view, String(rows.length)))
				if (silenced === undefined && BROWSER_CONTENT_NAMED_ROLES.has(role)) silenced = node
				if (node.localName === 'textarea') {
					node = skipBrowserSubtree(walker)
					continue
				}
			}
			const shadow = node.shadowRoot
			if (shadow !== null) {
				text = this.#flush(rows, text)
				this.#walk(shadow, rows, muted || silenced !== undefined)
				node = skipBrowserSubtree(walker)
				continue
			}
			node = walker.nextNode()
		}
		this.#flush(rows, text)
	}

	// Subscribes one time to a walked document's navigation events.
	#watch(document: Document): void {
		const view = document.defaultView
		if (this.#watched.has(document) || view === null) return
		this.#watched.add(document)
		listenBrowserNavigation(
			view,
			this.#advance.bind(this, new WeakRef(document)),
			this.#input.signal,
		)
	}

	// Advances one document's epoch; its unload drops the references bound in it.
	#advance(document: WeakRef<Document>, event: Event): void {
		const target = document.deref()
		if (target === undefined) return
		this.#epochs.set(target, (this.#epochs.get(target) ?? 0) + 1)
		if (event.type !== 'pagehide') return
		for (const [reference, record] of this.#records) {
			const node = record.node.deref()
			if (node === undefined || node.ownerDocument === target) this.#records.delete(reference)
		}
	}

	// Reads the epoch a reading from one document records; a collected document reads -1.
	#epoch(document: WeakRef<Document>): number {
		const target = document.deref()
		return target === undefined ? -1 : this.#input.navigation() + (this.#epochs.get(target) ?? 0)
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
		const name = computeBrowserName(element, role)
		const tool = element.localName === 'form' ? element.getAttribute('toolname') : null
		const reference = role === 'heading' ? undefined : this.#bind(element, role, name).reference
		const input = element instanceof view.HTMLInputElement ? element : undefined
		const checked =
			input !== undefined && (input.type === 'checkbox' || input.type === 'radio')
				? input.checked
				: element.getAttribute('aria-checked') === 'true'
		// Focus inside a shadow tree leaves its host as the document's active element, so the
		// element is compared with the active element of its own root.
		const root = element.getRootNode()
		const focused =
			(root instanceof view.Document || root instanceof view.ShadowRoot) &&
			root.activeElement === element
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
			name,
			description: undefined,
			value,
			properties: {
				checked,
				disabled: element.matches(':disabled'),
				focused,
				...readBrowserStates(element, role),
			},
			...(tool === null || tool === '' ? {} : { tool }),
			session: '',
			reference,
		}
	}

	#bind(element: Element, role: string, name: string): BrowserDOMElement {
		const known = this.#identities.get(element)
		const existing = known === undefined ? undefined : this.#records.get(known)
		if (existing !== undefined) {
			this.#descriptions.set(existing.node, { role, name })
			return existing.element
		}
		this.#count += 1
		const reference = `${BROWSER_REFERENCE_PREFIX}${this.#count}`
		const node = new WeakRef(element)
		const description = { role, name }
		this.#descriptions.set(node, description)
		const created = new BrowserDOMElement({
			reference,
			description: this.#description.bind(this, node, description),
			node,
			current: this.#holds.bind(this, reference),
			navigation: this.#epoch.bind(this, new WeakRef(element.ownerDocument)),
		})
		this.#records.set(reference, { node, element: created })
		this.#identities.set(element, reference)
		return created
	}

	#holds(reference: string): boolean {
		return this.#records.has(reference)
	}

	// Reads the latest capture of a binding; the entry lives as long as the wrapper's weak node.
	#description(
		node: WeakRef<Element>,
		captured: Pick<BrowserElementInterface, 'role' | 'name'>,
	): Pick<BrowserElementInterface, 'role' | 'name'> {
		return this.#descriptions.get(node) ?? captured
	}
}
