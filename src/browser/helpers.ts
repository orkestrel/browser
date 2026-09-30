import type { BrowserReadingInput } from '@src/core'
import type { BrowserNameContext } from './types.js'
import { attempt, isObject, isString } from '@orkestrel/contract'
import { BROWSER_RESULT_LIMIT, BrowserResultLimitError, normalizeBrowserName } from '@src/core'
import {
	BROWSER_CONTENT_NAMED_ROLES,
	BROWSER_CONTEXT_TARGETS,
	BROWSER_IMPLICIT_ROLES,
	BROWSER_INTERACTIVE_CONTENT,
	BROWSER_TYPED_INPUTS,
} from './constants.js'

// === Browser document

/**
 * Narrows a value to a `Document` attached to a window.
 *
 * @param value - The value to test
 * @returns `true` for an object that is a `Document` with a `defaultView`, otherwise `false`
 */
export function isBrowserDocument(value: unknown): value is Document {
	return (
		isObject(value) &&
		Reflect.get(value, 'nodeType') === 9 &&
		isObject(Reflect.get(value, 'defaultView'))
	)
}

/**
 * Reads the URL, title, and serialized markup a DOM reading is built from, refusing a capture
 * over the result limit before any parse.
 *
 * @remarks
 * The measure is the length of `JSON.stringify({ url, title, html })`, the form the CDP capture
 * guard compares with `BROWSER_RESULT_LIMIT`, so a character JSON escapes counts as its escape
 * sequence. A reading a caller builds with `createBrowserReading` passes through no limit.
 *
 * @param node - The element whose `outerHTML` is captured; its owner document supplies `URL`
 * and `title`
 * @returns The capture's `url`, `title`, and `html`
 * @throws Thrown as a `BrowserResultLimitError` when the serialized capture is longer than
 * `BROWSER_RESULT_LIMIT` characters, with `length` and `limit` in its context.
 */
export function readBrowserCapture(node: Element): BrowserReadingInput {
	const document = node.ownerDocument
	const capture = { url: document.URL, title: document.title, html: node.outerHTML }
	const length = JSON.stringify(capture).length
	if (length > BROWSER_RESULT_LIMIT) {
		throw new BrowserResultLimitError('Document capture exceeds BROWSER_RESULT_LIMIT', {
			length,
			limit: BROWSER_RESULT_LIMIT,
		})
	}
	return capture
}

/**
 * Computes the ARIA role of an element from its `role` attribute or its implicit mapping.
 *
 * @remarks
 * The explicit role is the first token of the `role` attribute, with `presentation` folded into
 * its synonym `none`. Without one, the role follows the HTML Accessibility API Mappings
 * specification through `BROWSER_IMPLICIT_ROLES`, after the element-specific conditions that
 * table cannot express: a link needs `href`, a `select` with `multiple` or a `size` above 1 is a
 * `listbox`, an `img` with an empty `alt` is `none`, a `header` or `footer` inside sectioning
 * content has no landmark role, a `section` or `form` needs an accessible name, a text input with
 * a `list` is a `combobox`, and a `th` with `scope="row"` is a `rowheader`.
 *
 * @param element - The element to classify
 * @returns The role, or `undefined` when the element maps to no role
 *
 * @example
 * ```ts
 * const input = document.createElement('input')
 * input.type = 'checkbox'
 * computeBrowserRole(input) // 'checkbox'
 * ```
 */
export function computeBrowserRole(element: Element): string | undefined {
	const explicit = (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
	if (explicit !== '') return explicit === 'presentation' ? 'none' : explicit
	const tag = element.localName
	if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : undefined
	if (tag === 'input') {
		const type = Reflect.get(element, 'type')
		const role = BROWSER_IMPLICIT_ROLES.get(`input:${isString(type) ? type : 'text'}`)
		return element.hasAttribute('list') && (role === 'textbox' || role === 'searchbox')
			? 'combobox'
			: role
	}
	if (tag === 'select') {
		return element.hasAttribute('multiple') || Number(element.getAttribute('size')) > 1
			? 'listbox'
			: 'combobox'
	}
	if (tag === 'img' && element.getAttribute('alt') === '') return 'none'
	if (
		(tag === 'header' || tag === 'footer') &&
		(element.parentElement?.closest('article, aside, main, nav, section') ?? null) !== null
	)
		return undefined
	if (
		(tag === 'section' || tag === 'form') &&
		!element.hasAttribute('aria-label') &&
		!element.hasAttribute('aria-labelledby') &&
		!element.hasAttribute('title')
	)
		return undefined
	if (tag === 'th' && element.getAttribute('scope')?.toLowerCase() === 'row') return 'rowheader'
	return BROWSER_IMPLICIT_ROLES.get(tag)
}

/**
 * Computes the accessible name of an element, trimmed and whitespace-collapsed.
 *
 * @remarks
 * The steps follow the accessible-name computation, first match wins: the elements
 * that `aria-labelledby` references in the element's own tree, each through
 * `computeBrowserAlternative` with hidden content admitted when the referenced element is itself
 * hidden (`matchesBrowserOmitted` or `matchesBrowserInvisible`), `aria-label`, the `label` of an
 * `option`, the value of an `input` button, the `alt` of an
 * image, the text of every associated `label`, the element's own content for a role in
 * `BROWSER_CONTENT_NAMED_ROLES`, then the `title` attribute, then the `placeholder` of a text
 * control. Every traversal carries the element as its `target`, so an embedded control
 * contributes its value unless it is the element being named. The `title` step follows content because a tooltip names an element only when nothing
 * else does.
 *
 * @param element - The element to name
 * @param role - The element's role. Default: `computeBrowserRole(element)`
 * @returns The name, or the empty string when no step names the element
 *
 * @example
 * ```ts
 * const button = document.createElement('button')
 * button.textContent = ' Save  draft '
 * computeBrowserName(button) // 'Save draft'
 * ```
 */
export function computeBrowserName(element: Element, role = computeBrowserRole(element)): string {
	const view = element.ownerDocument.defaultView
	const tree = element.getRootNode()
	const scope = view !== null && tree instanceof view.ShadowRoot ? tree : element.ownerDocument
	const referenced = normalizeBrowserName(
		(element.getAttribute('aria-labelledby') ?? '')
			.split(/\s+/)
			.flatMap((id) => {
				const target = id === '' ? null : scope.getElementById(id)
				return target === null
					? []
					: [
							computeBrowserAlternative(target, {
								hidden: matchesBrowserOmitted(target) || matchesBrowserInvisible(target),
								target: element,
							}),
						]
			})
			.join(' '),
	)
	if (referenced !== '') return referenced
	const label = normalizeBrowserName(element.getAttribute('aria-label') ?? '')
	if (label !== '') return label
	if (view !== null && element instanceof view.HTMLOptionElement) {
		const option = normalizeBrowserName(element.label)
		if (option !== '') return option
	}
	const tag = element.localName
	const type = tag === 'input' ? Reflect.get(element, 'type') : undefined
	if (type === 'button' || type === 'submit' || type === 'reset') {
		const value = normalizeBrowserName(
			element.getAttribute('value') ??
				(type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : ''),
		)
		if (value !== '') return value
	}
	if (type === 'image' || tag === 'img' || tag === 'area') {
		const alt = normalizeBrowserName(element.getAttribute('alt') ?? '')
		if (alt !== '') return alt
	}
	const labelled = normalizeBrowserName(
		Array.from(scope.querySelectorAll('label'))
			.filter((candidate) => candidate.control === element)
			.map((candidate) => computeBrowserText(candidate, { target: element }))
			.join(' '),
	)
	if (labelled !== '') return labelled
	if (role !== undefined && BROWSER_CONTENT_NAMED_ROLES.has(role)) {
		const content = computeBrowserText(element, { target: element })
		if (content !== '') return content
	}
	const title = normalizeBrowserName(element.getAttribute('title') ?? '')
	if (title !== '') return title
	return tag === 'input' || tag === 'textarea'
		? normalizeBrowserName(element.getAttribute('placeholder') ?? '')
		: ''
}

/**
 * Computes the text an element's content contributes to an accessible name, in the flat tree,
 * trimmed and whitespace-collapsed.
 *
 * @remarks
 * The text is what `readBrowserContent` reads, normalized.
 *
 * @param root - The element or shadow root whose content is read
 * @param context - The traversal context. Default: no hidden content and no target
 * @returns The trimmed, whitespace-collapsed text
 *
 * @example
 * ```ts
 * const link = document.createElement('a')
 * link.innerHTML = '<div>Cars</div><div>Search the fleet</div>'
 * document.body.append(link)
 * computeBrowserText(link) // 'Cars Search the fleet'
 * ```
 */
export function computeBrowserText(
	root: Element | ShadowRoot,
	context?: BrowserNameContext,
): string {
	return normalizeBrowserName(readBrowserContent(root, context))
}

/**
 * Reads the untrimmed text an element's content contributes to an accessible name, in the flat
 * tree.
 *
 * @remarks
 * The content is the open shadow root's children for a shadow host, the flattened assigned nodes
 * for a `slot`, and the child nodes otherwise. Each child contributes what
 * `computeBrowserAlternative` returns for it, and a child that `matchesBrowserBlock` reports is
 * set apart from its neighbours by a space. Whitespace at the edges of an inline child is kept,
 * so `<b>Go </b>home` reads `Go home`.
 *
 * @param root - The element or shadow root whose content is read
 * @param context - The traversal context. Default: no hidden content and no target
 * @returns The untrimmed text
 *
 * @example
 * ```ts
 * const label = document.createElement('span')
 * label.innerHTML = '<b>Go </b>home'
 * document.body.append(label)
 * readBrowserContent(label) // 'Go home'
 * ```
 */
export function readBrowserContent(
	root: Element | ShadowRoot,
	context?: BrowserNameContext,
): string {
	const view = root.ownerDocument?.defaultView ?? null
	const shadow = view !== null && root instanceof view.Element ? root.shadowRoot : null
	const children: readonly Node[] =
		shadow !== null
			? Array.from(shadow.childNodes)
			: view !== null && root instanceof view.HTMLSlotElement
				? root.assignedNodes({ flatten: true })
				: Array.from(root.childNodes)
	let text = ''
	let previous = false
	for (const child of children) {
		const piece = computeBrowserAlternative(child, context)
		const block = view !== null && child instanceof view.Element && matchesBrowserBlock(child)
		if (piece !== '') text += text !== '' && (block || previous) ? ` ${piece}` : piece
		previous = block
	}
	return text
}

/**
 * Computes the text one node contributes to an accessible name: its own text alternative, or its
 * content.
 *
 * @remarks
 * A text node contributes its data unless its parent is invisible; a parent without a box of its
 * own, such as a `slot` or a `display: contents` element, is not invisible. An element
 * contributes nothing when it is hidden or is a `script` or `style`, and an element that
 * `matchesBrowserInvisible` reports contributes only what its content contributes, never its
 * value, `aria-label`, `alt`, or `title`. The context's `hidden` admits both. An embedded control
 * that is not the context's `target` contributes its value: a text field or a range its `value`,
 * a `select` its selected options' labels; a password field and the target itself contribute
 * nothing. Any other element contributes its `aria-label`, the `alt` of an image, or its content
 * through `readBrowserContent`, and its `title` when those are empty.
 *
 * @param node - The node whose contribution is computed
 * @param context - The traversal context. Default: no hidden content and no target
 * @returns The untrimmed contribution
 *
 * @example
 * ```ts
 * const image = document.createElement('img')
 * image.alt = 'Save'
 * computeBrowserAlternative(image) // 'Save'
 * ```
 */
export function computeBrowserAlternative(node: Node, context?: BrowserNameContext): string {
	const view = node.ownerDocument?.defaultView ?? null
	const hidden = context?.hidden === true
	if (view === null) return node.textContent ?? ''
	if (!(node instanceof view.Element)) {
		const parent = node.parentElement
		if (node.nodeType !== view.Node.TEXT_NODE) return ''
		return !hidden && parent !== null && matchesBrowserInvisible(parent)
			? ''
			: (node.textContent ?? '')
	}
	const tag = node.localName
	if (!hidden && matchesBrowserHidden(node)) return ''
	if (tag === 'script' || tag === 'style') return ''
	// An invisible element's descendants can still render, so only its content can contribute.
	if (!hidden && matchesBrowserInvisible(node)) return readBrowserContent(node, context)
	const embedded = node !== context?.target
	if (node instanceof view.HTMLTextAreaElement) return embedded ? node.value : ''
	if (node instanceof view.HTMLSelectElement) {
		return embedded ? Array.from(node.selectedOptions, (option) => option.label).join(' ') : ''
	}
	if (
		node instanceof view.HTMLInputElement &&
		node.type !== 'password' &&
		(BROWSER_TYPED_INPUTS.has(node.type) || node.type === 'range')
	) {
		return embedded ? node.value : ''
	}
	const label = normalizeBrowserName(node.getAttribute('aria-label') ?? '')
	if (label !== '') return label
	const content =
		tag === 'img' || tag === 'area' || (tag === 'input' && Reflect.get(node, 'type') === 'image')
			? (node.getAttribute('alt') ?? '')
			: readBrowserContent(node, context)
	return content.trim() !== '' ? content : (node.getAttribute('title') ?? '')
}

/**
 * Checks whether an element and its subtree are hidden from the rendered page.
 *
 * @param element - The element to test
 * @returns True if the element carries `hidden` or `aria-hidden="true"`, or its computed
 * `display` is `none`; false otherwise
 *
 * @example
 * ```ts
 * const note = document.createElement('p')
 * note.hidden = true
 * matchesBrowserHidden(note) // true
 * ```
 */
export function matchesBrowserHidden(element: Element): boolean {
	return (
		element.hasAttribute('hidden') ||
		element.getAttribute('aria-hidden') === 'true' ||
		element.ownerDocument.defaultView?.getComputedStyle(element).display === 'none'
	)
}

/**
 * Checks whether an element renders nothing visible of its own.
 *
 * @remarks
 * An element whose computed `visibility` is `hidden` or `collapse` is invisible. An element with
 * `display: contents` has no box of its own but renders its descendants, so it is not invisible.
 * Any other element is invisible when `checkVisibility` with `visibilityProperty` and
 * `contentVisibilityAuto` reports it, which covers an element without a box and one skipped by
 * `content-visibility: auto`. A descendant can still be visible, so the rule omits the element's
 * own row and text and keeps its subtree. An `option` or `optgroup` inside a `select` is
 * invisible where the `select` is, because a drop-down renders its options outside the page's
 * boxes. Zero-size and off-screen elements stay visible. An
 * element in a document without a window is never invisible, because nothing renders it.
 *
 * @param element - The element to test
 * @returns True if the element renders nothing visible of its own; false otherwise
 *
 * @example
 * ```ts
 * const button = document.createElement('button')
 * button.style.visibility = 'hidden'
 * document.body.append(button)
 * matchesBrowserInvisible(button) // true
 * ```
 */
export function matchesBrowserInvisible(element: Element): boolean {
	const style = element.ownerDocument.defaultView?.getComputedStyle(element)
	if (style === undefined) return false
	if (style.visibility === 'hidden' || style.visibility === 'collapse') return true
	// A drop-down select renders its options in a popup outside the page's boxes, so an option or
	// group is visible where its select is.
	const select =
		element.localName === 'option' || element.localName === 'optgroup'
			? element.closest('select')
			: null
	if (select !== null) return matchesBrowserInvisible(select)
	return (
		style.display !== 'contents' &&
		!element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
	)
}

/**
 * Checks whether an element sits in an omitted subtree: the element or a flat-tree ancestor that
 * `readBrowserParent` reaches matches `matchesBrowserHidden`, through assigned slots, shadow
 * hosts, and the frame elements of same-origin documents.
 *
 * @param element - The element to test
 * @returns True if the element or an ancestor is hidden; false otherwise
 *
 * @example
 * ```ts
 * const section = document.createElement('section')
 * section.hidden = true
 * const button = section.appendChild(document.createElement('button'))
 * matchesBrowserOmitted(button) // true
 * ```
 */
export function matchesBrowserOmitted(element: Element): boolean {
	for (
		let current: Element | null = element;
		current !== null;
		current = readBrowserParent(current)
	) {
		if (matchesBrowserHidden(current)) return true
	}
	return false
}

/**
 * Reads an element's parent in the flat tree: the slot it is assigned to in an open shadow root,
 * its parent element, the host of the open shadow root it sits at the top of, or the frame
 * element of its same-origin document.
 *
 * @param element - The element whose parent is read
 * @returns The parent, or `null` at the top of a top-level or cross-origin-framed document
 *
 * @example
 * ```ts
 * readBrowserParent(document.body) // document.documentElement
 * readBrowserParent(document.documentElement) // null in a top-level document
 * ```
 */
export function readBrowserParent(element: Element): Element | null {
	if (element.assignedSlot !== null) return element.assignedSlot
	if (element.parentElement !== null) return element.parentElement
	const view: (Window & typeof globalThis) | null = element.ownerDocument.defaultView
	if (view === null) return null
	const tree = element.getRootNode()
	return tree instanceof view.ShadowRoot ? tree.host : view.frameElement
}

/**
 * Checks whether an element starts a block of its own, the unit that separates runs of text.
 *
 * @param element - The element to test
 * @returns True if the element is a `br`, or its computed `display` is neither inline-level,
 * `contents`, nor `none`; false otherwise
 *
 * @example
 * ```ts
 * const paragraph = document.createElement('p')
 * document.body.append(paragraph)
 * matchesBrowserBlock(paragraph) // true
 * ```
 */
export function matchesBrowserBlock(element: Element): boolean {
	if (element.localName === 'br') return true
	const display = element.ownerDocument.defaultView?.getComputedStyle(element).display ?? ''
	return !display.startsWith('inline') && display !== 'contents' && display !== 'none'
}

/**
 * Collects the tree roots a wait observes under a node: the node's own root, then every open
 * shadow root and every same-origin frame document at or beneath it, recursively.
 *
 * @param root - The document, shadow root, or element to collect under
 * @returns The roots, the node's own root first; a cross-origin frame contributes none
 *
 * @example
 * ```ts
 * collectBrowserRoots(document) // [document, ...each open shadow root and frame document]
 * ```
 */
export function collectBrowserRoots(root: Document | ShadowRoot | Element): readonly Node[] {
	const roots: Node[] = [root.getRootNode()]
	const queue: Array<Document | ShadowRoot | Element> = [root]
	for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
		const view = (isBrowserDocument(current) ? current : current.ownerDocument)?.defaultView ?? null
		const own = view !== null && current instanceof view.Element ? [current] : []
		for (const element of [...own, ...current.querySelectorAll('*')]) {
			const shadow = element.shadowRoot
			if (shadow !== null) {
				roots.push(shadow)
				queue.push(shadow)
			}
			const child =
				view !== null && element instanceof view.HTMLIFrameElement ? element.contentDocument : null
			if (child !== null) {
				roots.push(child)
				queue.push(child)
			}
		}
	}
	return roots
}

/**
 * Checks whether activating an element opens another browsing context.
 *
 * @remarks
 * A link with `href` navigates its `target`, and a form, or a submit button inside one, navigates
 * the submitter's `formtarget` or the form's `target`; either falls back to the target of the
 * document's `base` element. `_blank` opens another context, and a target in
 * `BROWSER_CONTEXT_TARGETS` does not. A name reuses the browsing context carrying it when the
 * element's window, an ancestor window, or a frame element in one of their documents carries it,
 * and opens another context otherwise; an ancestor this realm cannot read is skipped.
 *
 * @param element - The element an untrusted activation would target
 * @returns True if the activation opens another browsing context; false otherwise, including
 * for an element whose activation navigates nothing
 *
 * @example
 * ```ts
 * const link = document.createElement('a')
 * link.href = '/cars'
 * link.target = '_blank'
 * matchesBrowserPopup(link) // true
 * ```
 */
export function matchesBrowserPopup(element: Element): boolean {
	const document = element.ownerDocument
	const view = document.defaultView
	const base = document.querySelector('base[target]')?.getAttribute('target') ?? ''
	const tag = element.localName
	const type = Reflect.get(element, 'type')
	const submitter =
		(tag === 'button' && type === 'submit') ||
		(tag === 'input' && (type === 'submit' || type === 'image'))
	const form = tag === 'form' ? element : Reflect.get(element, 'form')
	let target: string | undefined
	if ((tag === 'a' || tag === 'area') && element.hasAttribute('href'))
		target = element.getAttribute('target') ?? base
	else if (view !== null && form instanceof view.HTMLFormElement && (tag === 'form' || submitter))
		target =
			(submitter ? element.getAttribute('formtarget') : null) ?? form.getAttribute('target') ?? base
	if (target === undefined) return false
	const keyword = target.trim().toLowerCase()
	if (BROWSER_CONTEXT_TARGETS.has(keyword)) return false
	if (keyword === '_blank') return true
	const selector = `iframe[name="${CSS.escape(target)}"], frame[name="${CSS.escape(target)}"]`
	let current: Window | null = view
	while (current !== null) {
		const frame: Window = current
		const found = attempt(
			() => frame.name === target || frame.document.querySelector(selector) !== null,
		)
		if (found.success && found.value) return false
		current = frame.parent === frame ? null : frame.parent
	}
	return true
}

/**
 * Checks whether a click on an element activates the `label` that contains it, following the
 * HTML label activation rule.
 *
 * @remarks
 * The click activates the label when the target is the label itself, or when no element on the
 * path from the target up to the label, the target included, matches
 * `BROWSER_INTERACTIVE_CONTENT`.
 *
 * @param target - The element the click lands on
 * @param label - The label that contains the target, or the target itself
 * @returns True if the click activates the label; false otherwise
 *
 * @example
 * ```ts
 * const label = document.createElement('label')
 * label.innerHTML = '<a href="#help">Help</a> <span>Photo</span>'
 * matchesBrowserActivation(label.querySelector('a'), label) // false
 * matchesBrowserActivation(label.querySelector('span'), label) // true
 * ```
 */
export function matchesBrowserActivation(target: Element, label: Element): boolean {
	for (
		let current: Element | null = target;
		current !== null && current !== label;
		current = current.parentElement
	) {
		if (current.matches(BROWSER_INTERACTIVE_CONTENT)) return false
	}
	return true
}

/**
 * Moves a tree walker past the subtree of its current node.
 *
 * @param walker - The walker to move; its root bounds the move
 * @returns The first node after the subtree in document order, or `null` when the walk is done
 *
 * @example
 * ```ts
 * const walker = document.createTreeWalker(document.body)
 * walker.nextNode()
 * skipBrowserSubtree(walker) // the first node after the body's first child and its descendants
 * ```
 */
export function skipBrowserSubtree(walker: TreeWalker): Node | null {
	let node = walker.nextSibling()
	while (node === null) {
		if (walker.parentNode() === null) return null
		node = walker.nextSibling()
	}
	return node
}

/**
 * Reads the nearest block container of an element, the unit that separates runs of text.
 *
 * @param element - The element to start from, or `null` for a node without a parent element
 * @param root - The node that bounds the search
 * @returns The nearest inclusive ancestor, below `root`, that `matchesBrowserBlock` reports;
 * `root` when none is
 *
 * @example
 * ```ts
 * const strong = document.createElement('strong')
 * const paragraph = document.createElement('p')
 * paragraph.append(strong)
 * document.body.append(paragraph)
 * readBrowserBlock(strong, document.body) // paragraph
 * ```
 */
export function readBrowserBlock(element: Element | null, root: Node): Node {
	let current = element
	while (current !== null && current !== root) {
		if (matchesBrowserBlock(current)) return current
		current = current.parentElement
	}
	return root
}

/**
 * Subscribes one listener to a window's navigation events until a signal aborts.
 *
 * @remarks
 * The listener receives the Navigation API's `navigatesuccess` where the window has that API, and
 * `popstate` and `hashchange` where it does not, plus `pagehide` in both cases. A `pushState` in a
 * window without the Navigation API fires none of those events.
 *
 * @param window - The window whose navigation events are observed
 * @param listener - Receives each event; `event.type` tells an unload from a same-document
 * navigation
 * @param signal - Removes every subscription when it aborts
 *
 * @example
 * ```ts
 * const release = new AbortController()
 * listenBrowserNavigation(frame.contentWindow, (event) => console.log(event.type), release.signal)
 * ```
 */
export function listenBrowserNavigation(
	window: Window,
	listener: (event: Event) => void,
	signal: AbortSignal,
): void {
	const options = { signal }
	if (Reflect.has(window, 'navigation')) {
		window.navigation.addEventListener('navigatesuccess', listener, options)
	} else {
		window.addEventListener('popstate', listener, options)
		window.addEventListener('hashchange', listener, options)
	}
	window.addEventListener('pagehide', listener, options)
}
