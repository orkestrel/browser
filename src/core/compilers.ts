import type {
	BrowserActionabilityOptions,
	BrowserCodegenLanguage,
	BrowserCodegenScript,
	BrowserJourney,
	BrowserRect,
	BrowserScreenshotOptions,
	BrowserStorageOrigin,
} from './types.js'
import type { JSONValue } from '@orkestrel/contract'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import {
	BROWSER_JOURNEY_ACTIONS,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_SCREENSHOT_ATTRIBUTE,
	BROWSER_STABLE_FRAME_COUNT,
	BROWSER_SUBMIT_KEY,
	BROWSER_WAIT_EVENTS,
} from './constants.js'
import { validateBrowserJourney } from './helpers.js'
import { isBrowserSecretBinding } from './validators.js'

/**
 * Compiles a wait woken by mutations and finished transitions and animations, with one deadline and explicit disconnect ownership.
 * @remarks
 * `transitionend` and `animationend` inside a shadow root are not composed in Chromium
 * 154.0.4258.53, so this document listener does not see them. Mutations inside that root are
 * not observed either.
 * @param deadline - Maximum time in milliseconds
 * @param key - Isolated-world property owning this observer
 * @param predicate - Optional expression checked immediately and on the task after a mutation batch or a `BROWSER_WAIT_EVENTS` event
 * @returns Promise expression resolving true on a match or change, false at the deadline
 */
export function compileQueryWaitExpression(
	deadline: number,
	key: string,
	predicate?: string,
): string {
	return `new Promise((resolve) => {
	let task
	let timer
	let observer
	const events = new AbortController()
	const finish = (value) => {
		observer?.disconnect()
		events.abort()
		if (task !== undefined) clearTimeout(task)
		clearTimeout(timer)
		delete globalThis[${JSON.stringify(key)}]
		resolve(value)
	}
	const check = () => {
		task = undefined
		if (${predicate ?? 'true'}) finish(true)
	}
	globalThis[${JSON.stringify(key)}] = () => finish(false)
	const schedule = () => {
		if (task === undefined) task = setTimeout(check, 0)
	}
	observer = new MutationObserver(schedule)
	observer.observe(document, { childList: true, attributes: true, characterData: true, subtree: true })
	for (const name of ${JSON.stringify(BROWSER_WAIT_EVENTS)}) document.addEventListener(name, schedule, { capture: true, signal: events.signal })
	timer = setTimeout(() => finish(false), ${JSON.stringify(deadline)})
	${predicate === undefined ? '' : 'check()'}
})`
}

/**
 * Compiles a wait for the presence or absence of visible text, coalesced by tasks.
 * @param text - Text to find in the main document body
 * @param deadline - Maximum time in milliseconds
 * @param key - Isolated-world property owning this observer
 * @param absent - If `true`, resolves when the body's `innerText` lacks `text`; if `false`, when it contains it. Default: `false`
 * @returns Mutation-driven promise expression with one deadline
 */
export function compileTextWaitExpression(
	text: string,
	deadline: number,
	key: string,
	absent = false,
): string {
	return compileQueryWaitExpression(
		deadline,
		key,
		`${absent ? '!' : ''}(document.body?.innerText ?? '').includes(${JSON.stringify(text)})`,
	)
}

/**
 * Compiles text selection or select-option assignment against the resolved element.
 * @param values - Option values or labels; absence selects the text control's contents
 * @returns Function declaration for an isolated-world element call
 */
export function compileSelectFunction(values?: readonly string[]): string {
	if (values === undefined)
		return `function() {
	if (this.isContentEditable) {
		this.ownerDocument.getSelection().selectAllChildren(this)
		return true
	}
	if (typeof this.select !== 'function') throw new Error('Element is not a text control')
	this.select()
	return true
}`
	return `function() {
	if (!(this instanceof HTMLSelectElement)) throw new Error('Element is not a select control')
	const values = ${JSON.stringify(values)}
	const selected = values.map((value) => [...this.options].find((option) => option.value === value) ?? [...this.options].find((option) => option.label === value))
	if (selected.some((option) => option === undefined)) throw new Error('Select option was not found')
	for (const option of this.options) option.selected = selected.includes(option)
	this.dispatchEvent(new Event('input', { bubbles: true }))
	this.dispatchEvent(new Event('change', { bubbles: true }))
	return true
}`
}

/**
 * Compiles the descendant hit check for a resolved element.
 * @returns Function declaration accepting the resolved covering node
 */
export function compileHitFunction(): string {
	return `function(target) {
		while (target && target.nodeType !== 9) {
			if (target === this) return true
			target = target instanceof ShadowRoot ? target.host : target.parentNode
		}
		return false
	}`
}

/**
 * Compiles the installation of a capture-phase `submit` observer owned by `token` on the window of
 * the world it runs in.
 *
 * @remarks
 * The observer records every `submit` event the window sees from installation until
 * {@link compileSubmitReadExpression} with the same `token` reads and removes it, under
 * {@link BROWSER_SUBMIT_KEY}, and replaces an observer an earlier installation left in place,
 * whatever its token. A capture-phase `keydown` listener beside it records whether an Enter's
 * target is an `input` a form owns, before any handler of the page can move the focus. A listener
 * of an isolated world observes the events the page's own scripts dispatch, because both worlds
 * share one DOM.
 *
 * @param token - The integer that identifies the action owning the observer
 * @returns Expression source that resolves `true`
 */
export function compileSubmitObserverExpression(token: number): string {
	const key = JSON.stringify(BROWSER_SUBMIT_KEY)
	return `(() => {
	const token = ${JSON.stringify(token)}
	const previous = globalThis[${key}]
	if (previous !== undefined) {
		removeEventListener('submit', previous.listener, true)
		removeEventListener('keydown', previous.keys, true)
	}
	const state = { token, events: [], implicit: false, listener: undefined, keys: undefined }
	state.listener = (event) => { state.events.push(event) }
	state.keys = (event) => {
		const target = event.target ?? null
		if (event.key === 'Enter' && target?.localName === 'input' && (target.form ?? null) !== null) state.implicit = true
	}
	globalThis[${key}] = state
	addEventListener('submit', state.listener, true)
	addEventListener('keydown', state.keys, true)
	return true
})()`
}

/**
 * Compiles the read of the `submit` observer {@link compileSubmitObserverExpression} installs for
 * `token`, removing the observer.
 *
 * @remarks
 * The read resolves an object of four members:
 * - `destinations` — without repeats and in the order first recorded, the relationship of the
 *   destination of every recorded `submit` that kept its default action: `self` for a target
 *   that is empty or `_self`, `parent` for `_parent`, and `top` for `_top`. The target is the one
 *   the submitter, the form, or the document's `base` element names. A prevented submission, one
 *   whose method is `dialog`, and one aimed at another browsing context add nothing.
 * - `prevented` — true when a listener prevented any recorded `submit`; false otherwise
 * - `submitted` — true when the observer recorded any `submit`; false otherwise
 * - `implicit` — true when the observer recorded an Enter whose target is an `input` a form owns,
 *   the control whose Enter submits that form implicitly; false otherwise. The target is recorded
 *   in the capture phase, so a handler that moves the focus afterwards does not change it.
 *
 * Every listener of an event has run by the time the input that fired it settles, so
 * `defaultPrevented` is final by then. The read resolves `null` and removes nothing when no
 * observer of `token` is installed, so a delayed read of an earlier action leaves a later
 * action's observer in place.
 *
 * @param token - The integer that identifies the action owning the observer
 * @returns Expression source that resolves `{ destinations, prevented, submitted, implicit }`, or
 * `null`
 */
export function compileSubmitReadExpression(token: number): string {
	const key = JSON.stringify(BROWSER_SUBMIT_KEY)
	return `(() => {
	const token = ${JSON.stringify(token)}
	const state = globalThis[${key}]
	if (state === undefined || state.token !== token) return null
	delete globalThis[${key}]
	removeEventListener('submit', state.listener, true)
	removeEventListener('keydown', state.keys, true)
	const destinations = { '': 'self', _self: 'self', _parent: 'parent', _top: 'top' }
	const found = []
	for (const event of state.events) {
		if (event.defaultPrevented) continue
		const submitter = event.submitter ?? null
		const form = event.target
		const method = (submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? '').toLowerCase()
		const target = (submitter?.getAttribute('formtarget') ?? form.getAttribute('target') ?? document.querySelector('base[target]')?.getAttribute('target') ?? '').toLowerCase()
		const destination = Object.hasOwn(destinations, target) ? destinations[target] : undefined
		if (method !== 'dialog' && destination !== undefined && !found.includes(destination)) found.push(destination)
	}
	return {
		destinations: found,
		prevented: state.events.some((event) => event.defaultPrevented),
		submitted: state.events.length > 0,
		implicit: state.implicit,
	}
})()`
}

/**
 * Compiles the page-side promise facade for one Runtime binding.
 *
 * @param name - Binding identifier
 * @returns Self-installing script source
 */
export function compileBrowserBindingSource(name: string): string {
	const binding = JSON.stringify(name)
	const state = JSON.stringify(`__orkestrelBinding_${name}`)
	return `(() => {
	const name = ${binding}
	const key = ${state}
	if (globalThis[key]) return
	const send = globalThis[name]
	if (typeof send !== 'function') throw new Error('Browser binding transport is unavailable')
	const pending = new Map()
	let sequence = 0
	globalThis[key] = {
		resolve(id, success, value) {
			const entry = pending.get(id)
			if (!entry) return
			pending.delete(id)
			if (success) entry.resolve(value)
			else entry.reject(new Error(String(value)))
		},
	}
	globalThis[name] = (...args) => new Promise((resolve, reject) => {
		sequence += 1
		const id = String(sequence)
		pending.set(id, { resolve, reject })
		send(JSON.stringify({ id, name, args }))
	})
})()`
}

/**
 * Compiles delivery of a host binding result to one execution context.
 *
 * @param name - Binding identifier
 * @param id - Call identifier
 * @param success - Resolve rather than reject
 * @param value - Serializable result or error
 * @returns Runtime expression
 */
export function compileBrowserBindingResult(
	name: string,
	id: string,
	success: boolean,
	value: unknown,
): string {
	return `globalThis[${JSON.stringify(`__orkestrelBinding_${name}`)}]?.resolve(${JSON.stringify(id)}, ${JSON.stringify(success)}, ${JSON.stringify(value)})`
}

/**
 * Compiles current-document cleanup for one page-side host binding facade.
 *
 * @param name - Binding identifier
 * @returns Runtime cleanup expression
 */
export function compileBrowserBindingCleanup(name: string): string {
	return `(() => {
	delete globalThis[${JSON.stringify(name)}]
	delete globalThis[${JSON.stringify(`__orkestrelBinding_${name}`)}]
	return true
})()`
}

/**
 * Compiles temporary animation, caret, and mask setup for a screenshot.
 *
 * @param options - Screenshot controls
 * @param masks - Viewport rectangles to cover, resolved from the masked elements
 * @returns Setup expression or undefined when no preparation is required
 */
export function compileScreenshotPreparationExpression(
	options?: BrowserScreenshotOptions,
	masks: readonly BrowserRect[] = [],
): string | undefined {
	if (options?.animations !== false && options?.caret !== false && masks.length === 0) {
		return undefined
	}
	return `(() => {
	const attribute = ${JSON.stringify(BROWSER_SCREENSHOT_ATTRIBUTE)}
	const sequence = (globalThis.__orkestrelScreenshotSequence ?? 0) + 1
	globalThis.__orkestrelScreenshotSequence = sequence
	const token = String(sequence)
	if (${JSON.stringify(options?.animations === false || options?.caret === false)}) {
		const style = document.createElement('style')
		style.setAttribute(attribute, token)
		style.textContent = ${JSON.stringify(
			`${options?.animations === false ? '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' : ''}${options?.caret === false ? '*{caret-color:transparent!important}' : ''}`,
		)}
		document.documentElement.appendChild(style)
	}
	const rects = ${JSON.stringify(masks)}
	for (const [left, top, width, height] of rects) {
		const mask = document.createElement('div')
		mask.setAttribute(attribute, token)
		mask.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
			'left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;' +
			'background:' + ${JSON.stringify(options?.color ?? '#ff00ff')}
		document.documentElement.appendChild(mask)
	}
	return token
})()`
}

/**
 * Compiles cleanup for temporary screenshot styles and masks.
 *
 * @param token - Preparation token
 * @returns Cleanup expression
 */
export function compileScreenshotCleanupExpression(token: string): string {
	return `(() => {
	const attribute = ${JSON.stringify(BROWSER_SCREENSHOT_ATTRIBUTE)}
	for (const element of document.querySelectorAll('[' + attribute + ']')) {
		if (element.getAttribute(attribute) === ${JSON.stringify(token)}) element.remove()
	}
	return true
})()`
}

/**
 * Compiles an expression that serializes local and session storage.
 *
 * @returns In-page storage expression
 */
export function compileStorageReadExpression(): string {
	return `({
	local: Array.from({ length: localStorage.length }, (_, index) => {
		const name = localStorage.key(index)
		return { name, value: name === null ? '' : localStorage.getItem(name) ?? '' }
	}),
	session: Array.from({ length: sessionStorage.length }, (_, index) => {
		const name = sessionStorage.key(index)
		return { name, value: name === null ? '' : sessionStorage.getItem(name) ?? '' }
	}),
})`
}

/**
 * Compiles an expression that restores one origin's web storage.
 *
 * @param origin - Storage values to restore
 * @returns In-page restore expression
 */
export function compileStorageRestoreExpression(origin: BrowserStorageOrigin): string {
	return `(() => {
	const state = ${JSON.stringify({ local: origin.local, session: origin.session })}
	localStorage.clear()
	sessionStorage.clear()
	for (const entry of state.local) localStorage.setItem(entry.name, entry.value)
	for (const entry of state.session) sessionStorage.setItem(entry.name, entry.value)
	return true
})()`
}

/**
 * Compiles an expression that clears local and session storage.
 *
 * @returns In-page clear expression
 */
export function compileStorageClearExpression(): string {
	return `(() => {
	localStorage.clear()
	sessionStorage.clear()
	return true
})()`
}

/**
 * Compiles a `Runtime.evaluate` expression so the in-page code stringifies its own result and
 * throws a recognizable sentinel error before an oversized result would overflow the CDP
 * transport frame.
 *
 * @remarks
 * A result whose `JSON.stringify` length exceeds `limit` throws
 * `Error('BROWSER_RESULT_LIMIT: <length>')` inside the page instead of being
 * returned — the caller maps that sentinel to a coded
 * {@link BrowserResultLimitError}. A non-serializable result (`undefined`,
 * a function, a symbol) makes `JSON.stringify` return `undefined`, so the
 * length check is skipped and today's undefined-passthrough behavior is
 * unchanged.
 *
 * The expression is placed on its own line inside the wrapper (rather than
 * inline with the guard code) so a trailing `//` line comment in the
 * expression cannot swallow the closing guard syntax that follows it.
 *
 * @param expression - The candidate JavaScript expression to evaluate
 * @param limit - Maximum serialized-character length (see {@link BROWSER_RESULT_LIMIT})
 * @returns The wrapped, guarded expression
 */
export function compileGuardedEvaluateExpression(expression: string, limit: number): string {
	return `(() => { const r = (
${expression}
); const s = JSON.stringify(r); if (typeof s === 'string' && s.length > ${limit}) throw new Error(${JSON.stringify(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)} + s.length); return r })()`
}

/**
 * Compiles the in-page function that reads the document's URL, title, and rendered HTML.
 *
 * @remarks
 * The optional root defaults to `document.documentElement`. {@link BrowserReadingInput}
 * defines its inert capture, lowering, redaction, and limits. A missing root yields empty HTML.
 * Call it inside {@link compileGuardedEvaluateExpression} to bound the final serialized result
 * under {@link BROWSER_RESULT_LIMIT}.
 *
 * @returns A function declaration source
 */
export function compileReadFunction(): string {
	return `function(node = document.documentElement) {
	const owner = node?.ownerDocument ?? document
	if (!node) return { url: owner.URL, title: owner.title, html: '' }
	const capture = { url: owner.URL, title: owner.title, html: '' }
	const view = owner.defaultView
	const rendered = view !== null && node.isConnected
	const inert = owner.implementation.createHTMLDocument('')
	let root = inert.importNode(node, true)
	const pending = [{ live: node, twin: root, visited: false }]
	if (rendered) {
		let child = node
		for (
			let parent = node;
			parent?.ownerDocument === owner;
			parent = parent.assignedSlot ?? parent.parentElement ?? (parent.parentNode instanceof view.ShadowRoot ? parent.parentNode.host : null)
		) {
			const style = view.getComputedStyle(parent)
			const outside =
				parent !== node &&
				(style.contentVisibility === 'hidden' ||
					['canvas', 'video', 'audio'].includes(parent.localName) ||
					parent instanceof view.HTMLInputElement ||
					parent instanceof view.HTMLTextAreaElement ||
					parent instanceof view.HTMLOptionElement ||
					(parent.namespaceURI === 'http://www.w3.org/2000/svg' &&
						parent.localName === 'switch' &&
						child !== (Array.from(parent.children).find((candidate) => candidate.getClientRects().length > 0) ?? parent.firstElementChild)) ||
					((parent instanceof view.HTMLSelectElement || parent instanceof view.HTMLOptGroupElement) &&
						!(node instanceof view.HTMLOptionElement || node instanceof view.HTMLOptGroupElement)) ||
					[
						'script',
						'style',
						'template',
						'frame',
						'frameset',
						'iframe',
						'object',
						'embed',
						'applet',
						'noscript',
						'meta',
						'link',
						'base',
						'math',
					].includes(parent.localName) ||
					(parent.localName === 'details' &&
						!parent.hasAttribute('open') &&
						child !== parent.querySelector(':scope > summary')))
			const unassigned =
				child.parentElement?.shadowRoot !== null &&
				child.parentElement?.shadowRoot !== undefined &&
				child.assignedSlot === null
			if (style.display === 'none' || outside || unassigned) {
				root = undefined
				pending.length = 0
				break
			}
			child = parent
		}
	}
	while (pending.length > 0) {
		const entry = pending.pop()
		if (entry === undefined) continue
		const { live, twin, visited } = entry
		const tag = live.localName
		const input = tag === 'input' ? (live.getAttribute('type')?.toLowerCase() ?? 'text') : ''
		if (
			[
				'script',
				'style',
				'template',
				'frame',
				'frameset',
				'iframe',
				'object',
				'embed',
				'applet',
				'noscript',
				'meta',
				'link',
				'base',
				'math',
			].includes(tag) ||
			(tag === 'input' && ['password', 'hidden'].includes(input))
		) {
			twin.remove()
			if (twin === root) root = undefined
			continue
		}
		const style = entry.style ?? (rendered ? view.getComputedStyle(live) : undefined)
		const invisible = style?.visibility === 'hidden' || style?.visibility === 'collapse'
		if (style?.display === 'none' || (invisible && !live.hasChildNodes())) {
			twin.remove()
			if (twin === root) root = undefined
			continue
		}
		if (!visited) {
			pending.push({ live, twin, style, visited: true })
			if (rendered) {
				twin.removeAttribute('hidden')
				twin.removeAttribute('aria-hidden')
			}
			if (
				rendered &&
				(live instanceof view.HTMLAnchorElement || live instanceof view.HTMLAreaElement) &&
				live.hasAttribute('href')
			)
				twin.setAttribute('href', live.href)
			if (style?.contentVisibility === 'hidden' || ['canvas', 'video', 'audio'].includes(tag)) {
				twin.replaceChildren()
				continue
			}
			if (
				rendered &&
				(live instanceof view.HTMLInputElement ||
					live instanceof view.HTMLTextAreaElement ||
					live instanceof view.HTMLSelectElement ||
					live instanceof view.HTMLOptionElement ||
					live instanceof view.HTMLOptGroupElement)
			)
				continue
			const summary =
				tag === 'details' && !live.hasAttribute('open')
					? live.querySelector(':scope > summary')
					: undefined

			// Native layout selects the switch branch after its conditional processing tests.
			const conditional = tag === 'switch' && live.namespaceURI === 'http://www.w3.org/2000/svg'
			const branch = rendered && conditional
				? (Array.from(live.children).find((candidate) => candidate.getClientRects().length > 0) ?? live.firstElementChild)
				: undefined
			// Save sibling pointers before pruning invalidates the copied child collections.
			let element = live.lastElementChild
			let counterpart = twin.lastElementChild
			let child = live.lastChild
			let mirror = twin.lastChild
			while (child !== null && mirror !== null) {
				const previous = child.previousSibling
				const previousMirror = mirror.previousSibling
				const previousElement = element?.previousElementSibling ?? null
				const previousCounterpart = counterpart?.previousElementSibling ?? null
				let omitted = rendered && ((summary !== undefined && child !== summary) || (conditional && child !== branch))
				if (rendered && live.shadowRoot !== null) {
					const slot =
						child instanceof view.Element || child instanceof view.Text ? child.assignedSlot : null
					if (slot === null) omitted = true
					else {
						for (
							let parent = slot;
							parent !== null && parent !== live;
							parent = parent.assignedSlot ?? parent.parentElement ?? (parent.parentNode instanceof view.ShadowRoot ? parent.parentNode.host : null)
						) {
							if (view.getComputedStyle(parent).display === 'none') omitted = true
						}
					}
				}
				if (omitted || (child.nodeType === 3 && invisible)) mirror.parentNode?.removeChild(mirror)
				else if (child.nodeType === 1) {
					// Element sibling pointers retain their type across windowless owner realms.
					if (element !== null && counterpart !== null)
						pending.push({ live: element, twin: counterpart, visited: false })
				}
				if (child.nodeType === 1) {
					element = previousElement
					counterpart = previousCounterpart
				}
				child = previous
				mirror = previousMirror
			}
			continue
		}
		if (!rendered || style?.contentVisibility === 'hidden') continue
		if (
			['div', 'summary', 'details'].includes(tag) &&
			!style?.display.startsWith('inline') &&
			style?.display !== 'contents' &&
			twin.hasChildNodes()
		) {
			twin.prepend(inert.createElement('br'))
			twin.append(inert.createElement('br'))
		}
		let fragments
		let lines
		let container = false
		if (live instanceof view.HTMLInputElement) {
			lines = []
			if (['text', 'email', 'search', 'tel', 'url', 'number'].includes(live.type)) {
				if (live.type !== 'number' || !live.validity.badInput) {
					const placeholder = view.getComputedStyle(live, '::placeholder')
					lines = [
						live.value ||
							(live.matches(':placeholder-shown') &&
							placeholder.visibility === 'visible' &&
							placeholder.opacity !== '0' &&
							placeholder.color !== 'rgba(0, 0, 0, 0)'
								? live.placeholder
								: ''),
					]
				}
			} else if (['submit', 'reset', 'button'].includes(live.type)) lines = [live.value]
			else if (live.type === 'file' && live.files?.length === 1)
				lines = Array.from(live.files ?? [], (file) => file.name)
			else if (live.type === 'image' && live.getAttribute('aria-hidden') !== 'true')
				lines = [live.getAttribute('aria-label')?.trim() || live.alt]
		} else if (live instanceof view.HTMLTextAreaElement) {
			const placeholder = view.getComputedStyle(live, '::placeholder')
			const value =
				live.value ||
				(live.matches(':placeholder-shown') &&
				placeholder.visibility === 'visible' &&
				placeholder.opacity !== '0' &&
				placeholder.color !== 'rgba(0, 0, 0, 0)'
					? live.placeholder
					: '')
			lines = value.split(/\\r?\\n/)
		} else if (
			live instanceof view.HTMLSelectElement ||
			live instanceof view.HTMLOptionElement ||
			live instanceof view.HTMLOptGroupElement
		) {
			lines = []
			const select = live instanceof view.HTMLSelectElement ? live : live.closest('select')
			if (select !== null) {
				if (!select.multiple && select.size <= 1) {
					const option = select.selectedOptions[0]
					if (option !== undefined && (live === select || live === option || live.contains(option)))
						lines.push(option.label)
				} else {
					const box = select.getBoundingClientRect()
					const top = box.top + select.clientTop
					const bottom = top + select.clientHeight
					const rows =
						live === select
							? select.querySelectorAll('option,optgroup')
							: [live, ...live.querySelectorAll('option')]
					for (const row of rows) {
						const rowStyle = view.getComputedStyle(row)
						const groupStyle =
							row.parentElement instanceof view.HTMLOptGroupElement
								? view.getComputedStyle(row.parentElement)
								: undefined
						if (
							rowStyle.display === 'none' ||
							rowStyle.visibility !== 'visible' ||
							groupStyle?.display === 'none'
						)
							continue
						const rect = row.getBoundingClientRect()
						// The group box includes its options; its caption ends where the first row starts.
						const end =
							row instanceof view.HTMLOptGroupElement
								? (Array.from(row.querySelectorAll('option'))
										.find((option) => option.getClientRects().length > 0)
										?.getBoundingClientRect().top ?? rect.bottom)
								: rect.bottom
						if (
							end > top &&
							rect.top < bottom &&
							rect.right > box.left + select.clientLeft &&
							rect.left < box.left + select.clientLeft + select.clientWidth &&
							(row instanceof view.HTMLOptionElement || row instanceof view.HTMLOptGroupElement)
						)
							lines.push(row.label)
					}
				}
			}
		} else if (tag === 'svg') {
			if (twin.parentElement?.closest('svg, foreignObject')?.localName === 'svg') continue
			lines = []
			fragments = []
			for (const content of twin.querySelectorAll('text, foreignObject')) {
				if (content.parentElement?.closest('svg, foreignObject')?.localName === 'foreignObject') continue
				if (content.localName === 'text' && content.parentElement?.closest('text')?.closest('svg') === content.closest('svg')) continue
				if (content.localName === 'foreignObject') fragments.push(...content.childNodes)
				else if (content.textContent) fragments.push(inert.createTextNode(content.textContent))
			}
			if (fragments.length === 0) fragments = undefined
			if (!invisible && fragments === undefined && live.getAttribute('aria-hidden') !== 'true')
				lines.push(
					live.getAttribute('aria-label')?.trim() ||
						live.querySelector(':scope > title')?.textContent ||
						'',
				)
		} else if (['form', 'dialog', 'button'].includes(tag)) {
			container = true
			if (live instanceof view.HTMLButtonElement && !invisible && live.innerText.trim() === '') {
				const name = live.getAttribute('aria-label')?.trim()
				if (name) {
					lines = [name]
					container = false
				}
			}
		}
		if (lines === undefined && !container) continue
		if (invisible && !container && tag !== 'svg') lines = []
		const block = !style?.display.startsWith('inline') && style?.display !== 'contents'
		const carrier = inert.createElement(block ? 'div' : 'span')
		if (container) carrier.append(...twin.childNodes)
		else if (fragments !== undefined) {
			for (const fragment of fragments) {
				carrier.append(fragment, inert.createElement('br'))
			}
		} else
			for (const [index, line] of (lines ?? []).entries()) {
				if (index > 0) carrier.append(inert.createElement('br'))
				carrier.append(inert.createTextNode(line))
			}
		if (carrier.hasChildNodes()) {
			carrier.prepend(inert.createElement('br'))
			carrier.append(inert.createElement('br'))
		}
		twin.replaceWith(carrier)
		if (twin === root) root = carrier
	}
	// Guard a copy that has fallen out of step with the live tree.
	for (const input of root?.querySelectorAll('input[type="password" i],input[type="hidden" i]') ??
		[])
		input.remove()
	capture.html = root?.outerHTML ?? ''
	return capture
}`
}

/**
 * Compiles a JSON value into the JavaScript literal a generated journey module carries.
 *
 * @remarks
 * A string takes single quotes, an object key that is an identifier stays bare, and an own
 * `__proto__` key compiles to a computed key so the literal keeps it as an own property. An object
 * whose only member is a `parameter` string that `bindings` names compiles to the expression
 * `bindings` maps that name to; without `bindings`, every value compiles literally.
 *
 * @param value - The JSON value to compile
 * @param bindings - The expression each parameter's binding compiles to, by parameter name
 * @returns Expression source that evaluates to the value
 * @example
 * ```ts
 * compileBrowserJourneyValue({ text: { parameter: 'email' }, submit: true }, new Map([['email', 'inputs.email']]))
 * // "{ text: inputs.email, submit: true }"
 * ```
 */
export function compileBrowserJourneyValue(
	value: JSONValue,
	bindings?: ReadonlyMap<string, string>,
): string {
	if (isString(value))
		return `'${JSON.stringify(value)
			.slice(1, -1)
			.replace(/\\"|'/g, (escape) => (escape === "'" ? "\\'" : '"'))}'`
	if (isArray(value))
		return `[${value.map((member) => compileBrowserJourneyValue(member, bindings)).join(', ')}]`
	if (!isRecord(value)) return JSON.stringify(value)
	const entries = Object.entries(value)
	const parameter = value['parameter']
	const expression =
		entries.length === 1 && isString(parameter) ? bindings?.get(parameter) : undefined
	if (expression !== undefined) return expression
	if (entries.length === 0) return '{}'
	const members = entries.map(([key, member]) => {
		const name =
			key === '__proto__'
				? `['__proto__']`
				: /^[A-Za-z_$][\w$]*$/.test(key)
					? key
					: compileBrowserJourneyValue(key)
		return `${name}: ${compileBrowserJourneyValue(member, bindings)}`
	})
	return `{ ${members.join(', ')} }`
}

/**
 * Compiles a journey into a standalone module that performs each step through the `follow`
 * method of a toolset the module constructs on the page. The module checks its inputs before any
 * step.
 *
 * @remarks
 * The module imports only `@orkestrel/browser` and exports `execute(page, inputs)`, which starts
 * the toolset, performs the steps in order, and destroys the toolset in `finally`.
 * - A parameter with a default compiles to an optional input that falls back to the default; a
 *   secret and a parameter without a default compile to a required input, and `inputs` then takes
 *   no default. `execute` takes no `inputs` when the journey declares no parameter.
 * - A step passes its action, its arguments, and its target's role and name or its tab's URL and
 *   title as literals, with each native binding replaced by its input; a page tool's arguments
 *   stay literal. A `type` step whose text binds a secret passes `{ secret: true }`.
 * - `execute` checks its inputs before the toolset starts, as replay refuses them at preparation:
 *   an input that names no parameter throws `Error('NAME: no parameter has that name')`, then a
 *   required parameter whose input is not a string throws `Error('NAME: the input is missing')`,
 *   then a defaulted parameter whose input is neither `undefined` nor a string throws
 *   `Error('NAME: the input is not a string')`. A journey without parameters compiles no check. A
 *   journey with a required parameter reads `inputs ?? {}` and `inputs?.NAME` in its required
 *   checks, so `execute(page)` without inputs reports the first required parameter as missing
 *   before a defaulted check reads `inputs.NAME`; a journey whose parameters all have defaults
 *   reads `inputs`, which defaults to `{}`.
 * - A journey with a gap compiles to an unconditional throw naming the first gap after the input
 *   checks and before the toolset starts, as replay refuses a gap at preparation; each gap step
 *   compiles to a comment at its position, with its line terminators escaped, and is listed in
 *   `gaps`.
 *
 * The JavaScript module is the TypeScript module without the type import and the annotations.
 * `options.language` selects `'javascript'` or `'typescript'`. Default: `'javascript'`.
 *
 * @param journey - The journey to compile
 * @param options - The target language
 * @returns The module source and the gap step ids in step order
 * @throws BrowserError - Thrown with `BROWSER_JOURNEY_FORMAT` or `BROWSER_JOURNEY_INVALID` when the
 * journey fails validation, before any source is compiled
 * @example
 * ```ts
 * const script = compileBrowserJourney(journey, { language: 'typescript' })
 * // script.source begins with the two `@orkestrel/browser` imports; script.gaps lists the gap ids
 * ```
 */
export function compileBrowserJourney(
	journey: BrowserJourney,
	options?: { readonly language?: BrowserCodegenLanguage },
): BrowserCodegenScript {
	validateBrowserJourney(journey)
	const typed = options?.language === 'typescript'
	const parameters = Object.entries(journey.parameters)
	const defaulted = parameters.flatMap(([name, parameter]) =>
		parameter.default === undefined
			? []
			: [
					{
						name,
						fallback: parameter.default,
						// An inherited member such as `toString` is not an input, so only an own property counts.
						read:
							name in Object.prototype
								? `(Object.hasOwn(inputs, '${name}') ? inputs.${name} : undefined)`
								: `inputs.${name}`,
					},
				],
	)
	const bindings = new Map([
		...parameters.map(([name]): [string, string] => [name, `inputs.${name}`]),
		...defaulted.map(({ name, fallback, read }): [string, string] => [
			name,
			`${read} ?? ${compileBrowserJourneyValue(fallback)}`,
		]),
	])
	const shape = parameters
		.map(
			([name, parameter]) =>
				`readonly ${name}${parameter.default === undefined ? '' : '?'}: string`,
		)
		.join('; ')
	const required = parameters.filter(([, parameter]) => parameter.default === undefined)
	const inputs =
		parameters.length === 0
			? ''
			: `, inputs${typed ? `: { ${shape} }` : ''}${required.length === 0 ? ' = {}' : ''}`
	// A module with a required parameter declares no `inputs` default, so its checks tolerate an absent object.
	const supplied = required.length === 0 ? 'inputs' : 'inputs ?? {}'
	const preflight =
		parameters.length === 0
			? []
			: [
					`\tfor (const name of Object.keys(${supplied})) if (!${compileBrowserJourneyValue(parameters.map(([name]) => name))}.includes(name)) throw new Error(name + ': no parameter has that name')`,
					...required.map(
						([name]) =>
							`\tif (typeof inputs?.${name} !== 'string') throw new Error(${compileBrowserJourneyValue(`${name}: the input is missing`)})`,
					),
					// The required checks run first, so `inputs` is an object by the time a defaulted check reads it.
					...defaulted.map(
						({ name, read }) =>
							`\tif (${read} !== undefined && typeof ${read} !== 'string') throw new Error(${compileBrowserJourneyValue(`${name}: the input is not a string`)})`,
					),
				]
	const gap = journey.steps.find((step) => step.action === 'unresolved')
	const statements = journey.steps.map((step) => {
		if (step.action === 'unresolved')
			return `\t\t// ${step.id}: ${step.gap ?? ''}; handle it here`.replace(
				/[\n\r\u2028\u2029]/gu,
				(terminator) => `\\u${terminator.charCodeAt(0).toString(16).padStart(4, '0')}`,
			)
		const secret = isBrowserSecretBinding(step, journey.parameters)
		const call: JSONValue = {
			action: step.action,
			arguments: step.arguments,
			...(step.target === undefined
				? {}
				: { target: { role: step.target.role, name: step.target.name } }),
			...(step.tab === undefined ? {} : { tab: { url: step.tab.url, title: step.tab.title } }),
		}
		const native = BROWSER_JOURNEY_ACTIONS.some((action) => action === step.action)
		return `\t\tawait toolset.follow(${compileBrowserJourneyValue(step.id)}, ${compileBrowserJourneyValue(call, native ? bindings : undefined)}${secret ? ', { secret: true }' : ''})`
	})
	const source = [
		...(typed ? [`import type { BrowserPageInterface } from '@orkestrel/browser'`] : []),
		`import { createBrowserToolset } from '@orkestrel/browser'`,
		'',
		`export async function execute(page${typed ? ': BrowserPageInterface' : ''}${inputs})${typed ? ': Promise<void>' : ''} {`,
		...preflight,
		...(gap === undefined
			? []
			: [
					`\tthrow new Error(${compileBrowserJourneyValue(`${gap.id}: ${gap.gap ?? ''}; handle it here`)})`,
				]),
		'\tconst toolset = createBrowserToolset(page)',
		'\tawait toolset.start()',
		'\ttry {',
		...statements,
		'\t} finally {',
		'\t\tawait toolset.destroy()',
		'\t}',
		'}',
		'',
	].join('\n')
	return {
		source,
		gaps: journey.steps.filter((step) => step.action === 'unresolved').map((step) => step.id),
	}
}

/**
 * Compiles the element-side actionability pass used before trusted input.
 *
 * @param options - Checks required for the action
 * @returns Async `Runtime.callFunctionOn` function declaration
 */
export function compileActionabilityFunction(options: BrowserActionabilityOptions): string {
	// Visible means a rendered, non-collapsed box; `style` and `rect` are in scope at the interpolation site.
	const VISIBILITY_SOURCE =
		"style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0"
	return `async function() {
	if (!(this instanceof Element) || !this.isConnected) throw new Error('Element is detached')
	this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
	const visible = () => {
		const style = getComputedStyle(this)
		const rect = this.getBoundingClientRect()
		return ${VISIBILITY_SOURCE}
	}
	if (${JSON.stringify(options.visible === true)} && !visible()) throw new Error('Element is not visible')
	if (${JSON.stringify(options.enabled === true)} && this.matches(':disabled')) throw new Error('Element is disabled')
	if (${JSON.stringify(options.editable === true)} && (this.matches('[readonly]') || (!this.isContentEditable && !('value' in this)))) throw new Error('Element is not editable')
	let previous
	for (let index = 0; index < ${BROWSER_STABLE_FRAME_COUNT}; index += 1) {
		await new Promise((resolve) => requestAnimationFrame(resolve))
		const rect = this.getBoundingClientRect()
		const current = [rect.x, rect.y, rect.width, rect.height]
		if (${JSON.stringify(options.stable === true)} && previous && current.some((value, part) => value !== previous[part])) {
			index = 0
		}
		previous = current
	}
	if (${JSON.stringify(options.events === true)}) {
		const rect = this.getBoundingClientRect()
		const position = ${JSON.stringify(options.position)}
		const x = rect.x + (position?.x ?? rect.width / 2)
		const y = rect.y + (position?.y ?? rect.height / 2)
		const target = this.ownerDocument.elementFromPoint(x, y)
		if (target !== this && !this.contains(target)) throw new Error('Element does not receive pointer events')
	}
	return true
}`
}
