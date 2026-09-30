import type { BrowserMutationWait } from './types.js'
import { attempt, isObject, isString } from '@orkestrel/contract'
import { BrowserElementError, BrowserError, normalizeBrowserName } from '@src/core'
import {
	BROWSER_CONTENT_NAMED_ROLES,
	BROWSER_CONTEXT_TARGETS,
	BROWSER_IMPLICIT_ROLES,
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
 * that `aria-labelledby` references, `aria-label`, the value of an `input` button, the `alt` of an
 * image, the text of every associated `label`, the element's own content for a role in
 * `BROWSER_CONTENT_NAMED_ROLES`, then the `title` attribute, then the `placeholder` of a text
 * control. The `title` step follows content because a tooltip names an element only when nothing
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
	const document = element.ownerDocument
	const referenced = normalizeBrowserName(
		(element.getAttribute('aria-labelledby') ?? '')
			.split(/\s+/)
			.flatMap((id) => {
				const target = id === '' ? null : document.getElementById(id)
				if (target === null) return []
				const label = normalizeBrowserName(target.getAttribute('aria-label') ?? '')
				return [label === '' ? computeBrowserText(target) : label]
			})
			.join(' '),
	)
	if (referenced !== '') return referenced
	const label = normalizeBrowserName(element.getAttribute('aria-label') ?? '')
	if (label !== '') return label
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
		Array.from(document.querySelectorAll('label'))
			.filter((candidate) => candidate.control === element)
			.map((candidate) => computeBrowserText(candidate))
			.join(' '),
	)
	if (labelled !== '') return labelled
	if (role !== undefined && BROWSER_CONTENT_NAMED_ROLES.has(role)) {
		const content = computeBrowserText(element)
		if (content !== '') return content
	}
	const title = normalizeBrowserName(element.getAttribute('title') ?? '')
	if (title !== '') return title
	return tag === 'input' || tag === 'textarea'
		? normalizeBrowserName(element.getAttribute('placeholder') ?? '')
		: ''
}

/**
 * Computes the rendered text an element's content contributes to an accessible name.
 *
 * @remarks
 * Text from different block containers is joined by a space and text within one block is joined
 * directly. A descendant with `aria-label` contributes that label instead of its content, an
 * image contributes its `alt`, and a hidden descendant, a `select`, and a `textarea` contribute
 * nothing. Hidden means what `matchesBrowserHidden` reports.
 *
 * @param root - The element whose content is read
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
export function computeBrowserText(root: Element): string {
	const view = root.ownerDocument.defaultView
	if (view === null) return normalizeBrowserName(root.textContent ?? '')
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
	)
	let text = ''
	let block: Element | undefined
	let node = walker.nextNode()
	while (node !== null) {
		let piece = ''
		let owner: Element | null = node.parentElement
		let descend = true
		if (node instanceof view.Element) {
			owner = node
			const label = node.getAttribute('aria-label')?.trim() ?? ''
			const type = node.localName === 'input' ? Reflect.get(node, 'type') : undefined
			if (
				matchesBrowserHidden(node) ||
				node.localName === 'select' ||
				node.localName === 'textarea'
			) {
				descend = false
			} else if (label !== '') {
				piece = label
				descend = false
			} else if (node.localName === 'img' || node.localName === 'area' || type === 'image') {
				piece = node.getAttribute('alt') ?? ''
			}
		} else {
			piece = node.textContent ?? ''
		}
		if (piece.trim() !== '') {
			const current = readBrowserBlock(owner, root)
			text += block === undefined || block === current ? piece : ` ${piece}`
			block = current
		}
		node = descend ? walker.nextNode() : skipBrowserSubtree(walker)
	}
	return normalizeBrowserName(text)
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
 * @param root - The element that bounds the search
 * @returns The nearest inclusive ancestor, below `root`, whose computed `display` is neither
 * inline-level nor `contents`; `root` when none is
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
export function readBrowserBlock(element: Element | null, root: Element): Element {
	const view = root.ownerDocument.defaultView
	if (view === null) return root
	let current = element
	while (current !== null && current !== root) {
		const display = view.getComputedStyle(current).display
		if (!display.startsWith('inline') && display !== 'contents') return current
		current = current.parentElement
	}
	return root
}

/**
 * Resolves the first value a check returns, re-running the check after each batch of mutations
 * in the observed documents.
 *
 * @remarks
 * The wait parks on one `MutationObserver` per document, with one deadline timer and no other
 * timer, and releases every observer, the timer, and its listeners when it settles. The check
 * runs one time before the wait parks, so a condition that already holds resolves at once.
 *
 * @param wait - The documents, the check, the deadline, the signal, and the subject
 * @returns The first value the check returns other than `undefined`
 * @throws Thrown when the signal aborts, with the signal's reason; when the deadline passes, a
 * `BrowserError` with the code `BROWSER_WAIT_TIMEOUT`; when an observed document's window fires
 * `pagehide`, a `BrowserElementError` with the reason `GONE`; and whatever the check throws.
 *
 * @example
 * ```ts
 * const ready = await observeBrowserMutations({
 * 	documents: [document],
 * 	check: () => document.querySelector('#ready') ?? undefined,
 * 	timeout: 1_000,
 * 	subject: 'Ready wait',
 * })
 * ```
 */
export async function observeBrowserMutations<T>(wait: BrowserMutationWait<T>): Promise<T> {
	const signal = wait.signal
	signal?.throwIfAborted()
	const first = wait.check()
	if (first !== undefined) return first
	const settled = Promise.withResolvers<T>()
	const release = new AbortController()
	const observers = wait.documents.flatMap((document) => {
		const view = document.defaultView
		if (view === null) return []
		const observer = new view.MutationObserver(() => {
			const result = attempt(wait.check)
			if (!result.success) settled.reject(result.error)
			else if (result.value !== undefined) settled.resolve(result.value)
		})
		observer.observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		view.addEventListener(
			'pagehide',
			() => settled.reject(new BrowserElementError({ subject: 'document' }, 'GONE')),
			{ signal: release.signal },
		)
		return [observer]
	})
	const timer = setTimeout(() => {
		settled.reject(
			new BrowserError(`${wait.subject} timed out`, 'BROWSER_WAIT_TIMEOUT', {
				timeout: wait.timeout,
			}),
		)
	}, wait.timeout)
	signal?.addEventListener('abort', () => settled.reject(signal.reason), {
		signal: release.signal,
	})
	try {
		return await settled.promise
	} finally {
		for (const observer of observers) observer.disconnect()
		clearTimeout(timer)
		release.abort()
	}
}
