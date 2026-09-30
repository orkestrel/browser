import type {
	BrowserActionabilityOptions,
	BrowserCodegenAction,
	BrowserCodegenScriptOptions,
	BrowserRect,
	BrowserScreenshotOptions,
	BrowserStorageOrigin,
} from './types.js'
import {
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_SCREENSHOT_ATTRIBUTE,
	BROWSER_STABLE_FRAME_COUNT,
	BROWSER_SUBMIT_KEY,
} from './constants.js'

/**
 * Compiles a mutation-driven wait with one deadline and explicit disconnect ownership.
 * @param deadline - Maximum time in milliseconds
 * @param key - Isolated-world property owning this observer
 * @param predicate - Optional expression checked immediately and after each mutation batch
 * @returns Promise expression resolving true on a match or change, false at the deadline
 */
export function compileQueryWaitExpression(
	deadline: number,
	key: string,
	predicate?: string,
): string {
	return `new Promise((resolve) => {
	let frame
	let timer
	let observer
	const finish = (value) => {
		observer?.disconnect()
		if (frame !== undefined) cancelAnimationFrame(frame)
		clearTimeout(timer)
		delete globalThis[${JSON.stringify(key)}]
		resolve(value)
	}
	const check = () => {
		frame = undefined
		if (${predicate ?? 'true'}) finish(true)
	}
	globalThis[${JSON.stringify(key)}] = () => finish(false)
	observer = new MutationObserver(() => {
		if (frame === undefined) frame = requestAnimationFrame(check)
	})
	observer.observe(document, { childList: true, attributes: true, characterData: true, subtree: true })
	timer = setTimeout(() => finish(false), ${JSON.stringify(deadline)})
	${predicate === undefined ? '' : 'check()'}
})`
}

/**
 * Compiles a visible-text wait coalesced by animation frames.
 * @param text - Text to find in the main document body
 * @param deadline - Maximum time in milliseconds
 * @param key - Isolated-world property owning this observer
 * @returns Mutation-driven promise expression with one deadline
 */
export function compileTextWaitExpression(text: string, deadline: number, key: string): string {
	return compileQueryWaitExpression(
		deadline,
		key,
		`(document.body?.innerText ?? '').includes(${JSON.stringify(text)})`,
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
 * whatever its token. A listener of an isolated world observes the events the page's own scripts
 * dispatch, because both worlds share one DOM.
 *
 * @param token - The integer that identifies the action owning the observer
 * @returns Expression source that resolves `true`
 */
export function compileSubmitObserverExpression(token: number): string {
	const key = JSON.stringify(BROWSER_SUBMIT_KEY)
	return `(() => {
	const token = ${JSON.stringify(token)}
	const previous = globalThis[${key}]
	if (previous !== undefined) removeEventListener('submit', previous.listener, true)
	const state = { token, events: [], listener: undefined }
	state.listener = (event) => { state.events.push(event) }
	globalThis[${key}] = state
	addEventListener('submit', state.listener, true)
	return true
})()`
}

/**
 * Compiles the read of the `submit` observer {@link compileSubmitObserverExpression} installs for
 * `token`, removing the observer.
 *
 * @remarks
 * The read lists, without repeats and in the order first recorded, the relationship of the
 * destination of every recorded `submit` that kept its default action: `self` for a target that
 * is empty or `_self`, `parent` for `_parent`, and `top` for `_top`. The target is the one the
 * submitter, the form, or the document's `base` element names. A prevented submission, one whose
 * method is `dialog`, and one aimed at another browsing context add nothing. Every listener of an
 * event has run by the time the input that fired it settles, so `defaultPrevented` is final by
 * then. The read resolves `null` and removes nothing when no observer of `token` is installed, so
 * a delayed read of an earlier action leaves a later action's observer in place.
 *
 * @param token - The integer that identifies the action owning the observer
 * @returns Expression source that resolves an array of `self`, `parent`, and `top`, or `null`
 */
export function compileSubmitReadExpression(token: number): string {
	const key = JSON.stringify(BROWSER_SUBMIT_KEY)
	return `(() => {
	const token = ${JSON.stringify(token)}
	const state = globalThis[${key}]
	if (state === undefined || state.token !== token) return null
	delete globalThis[${key}]
	removeEventListener('submit', state.listener, true)
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
	return found
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
 * Compiles the in-page function that reads the document's URL, title, and serialized HTML.
 *
 * @remarks
 * The declaration takes no arguments and returns `{ url, title, html }` from `location.href`,
 * `document.title`, and `document.documentElement.outerHTML`, with `html` empty for a document
 * that has no root element. Call it inside {@link compileGuardedEvaluateExpression} to bound the
 * result under {@link BROWSER_RESULT_LIMIT}.
 *
 * @returns A function declaration source
 */
export function compileReadFunction(): string {
	return `function() {
	const root = document.documentElement
	return { url: location.href, title: document.title, html: root ? root.outerHTML : '' }
}`
}

/**
 * Compiles recorded codegen actions into a replayable JavaScript or TypeScript script.
 *
 * @remarks
 * Emits one statement per action against a `page` object shaped like
 * {@link BrowserPageInterface}. A `click`, `fill`, or `select` action resolves its
 * selector through `page.elements.find({ css })`, takes the first match, and calls the
 * element action (`await (await page.elements.find({ css: "#save" }))[0].click()`);
 * `navigate` calls `page.navigate(...)`.
 * Both target languages emit an `async function run(page)` body whose
 * statements are `await`-ed; `language` only toggles whether the `page`
 * parameter carries a TypeScript type annotation (default `'javascript'`).
 *
 * @param actions - Normalized actions to compile
 * @param options - Compilation options (target language)
 * @returns The compiled script source
 */
export function compileCodegenScript(
	actions: readonly BrowserCodegenAction[],
	options?: BrowserCodegenScriptOptions,
): string {
	const language = options?.language ?? 'javascript'

	const lines = actions.map((action) => {
		switch (action.action) {
			case 'navigate':
				return `await page.navigate(${JSON.stringify(action.url)})`
			case 'click':
				return `await (await page.elements.find({ css: ${JSON.stringify(action.selector)} }))[0].click()`
			case 'fill':
				return `await (await page.elements.find({ css: ${JSON.stringify(action.selector)} }))[0].fill(${JSON.stringify(action.value)})`
			case 'select':
				return `await (await page.elements.find({ css: ${JSON.stringify(action.selector)} }))[0].select(${JSON.stringify(action.values)})`
		}
	})

	if (language === 'typescript') {
		return [
			`async function run(page: import('@orkestrel/browser').BrowserPageInterface): Promise<void> {`,
			...lines.map((line) => `\t${line}`),
			`}`,
		].join('\n')
	}

	return [`async function run(page) {`, ...lines.map((line) => `\t${line}`), `}`].join('\n')
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
