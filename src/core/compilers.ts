import type {
	BrowserActionabilityOptions,
	BrowserCodegenAction,
	BrowserCodegenScriptOptions,
	BrowserQuery,
	BrowserScreenshotOptions,
	BrowserStorageOrigin,
} from './types.js'
import {
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_SCREENSHOT_ATTRIBUTE,
	BROWSER_STABLE_FRAME_COUNT,
	BROWSER_TEST_ID_ATTRIBUTE,
	BROWSER_VISIBILITY_SOURCE,
	BROWSER_WAIT_POLL_INTERVAL_MS,
} from './constants.js'

/**
 * Compile an auto-retrying in-page predicate wait.
 *
 * @param expression - Value or function expression
 * @param timeout - Maximum wait in milliseconds
 * @returns Promise expression resolving to the first truthy value or false
 */
export function compileFunctionWaitExpression(expression: string, timeout: number): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const predicate = (${expression})
	const check = async () => {
		try {
			const value = typeof predicate === 'function' ? await predicate() : await predicate
			if (value) {
				resolve(value)
				return
			}
			if (performance.now() >= deadline) {
				resolve(false)
				return
			}
			setTimeout(check, ${BROWSER_WAIT_POLL_INTERVAL_MS})
		} catch (error) {
			reject(error)
		}
	}
	void check()
})`
}

/**
 * Compile the page-side promise facade for one Runtime binding.
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
 * Compile delivery of a host binding result to one execution context.
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
 * Compile current-document cleanup for one page-side host binding facade.
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
 * Compile temporary animation, caret, and mask setup for a screenshot.
 *
 * @param options - Screenshot controls
 * @returns Setup expression or undefined when no preparation is required
 */
export function compileScreenshotPreparationExpression(
	options?: BrowserScreenshotOptions,
): string | undefined {
	const masks = options?.mask ?? []
	if (options?.animations !== false && options?.caret !== false && masks.length === 0) {
		return undefined
	}
	const queries = masks.map((locator) => compileLocatorListExpression(locator.query))
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
	const groups = [${queries.join(',')}]
	for (const group of groups) {
		for (const element of group) {
			const rect = element.getBoundingClientRect()
			const mask = document.createElement('div')
			mask.setAttribute(attribute, token)
			mask.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
				'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;' +
				'background:' + ${JSON.stringify(options?.color ?? '#ff00ff')}
			document.documentElement.appendChild(mask)
		}
	}
	return token
})()`
}

/**
 * Compile cleanup for temporary screenshot styles and masks.
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
 * Compile an expression that serializes local and session storage.
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
 * Compile an expression that restores one origin's web storage.
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
 * Compile an expression that clears local and session storage.
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
 * Wrap a `Runtime.evaluate` expression so the IN-PAGE code stringifies its
 * own result and throws a recognizable error before an oversized result
 * would overflow the CDP transport frame.
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
export function guardEvaluateExpression(expression: string, limit: number): string {
	return `(() => { const r = (
${expression}
); const s = JSON.stringify(r); if (typeof s === 'string' && s.length > ${limit}) throw new Error(${JSON.stringify(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)} + s.length); return r })()`
}

/**
 * Compile recorded codegen actions into a replayable script.
 *
 * @remarks
 * Emits one statement per action against a `page` object shaped like
 * {@link BrowserPageInterface} (`page.navigate(...)`, `page.click(...)`, …).
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
				return `await page.click(${JSON.stringify(action.selector)})`
			case 'fill':
				return `await page.fill(${JSON.stringify(action.selector)}, ${JSON.stringify(action.value)})`
			case 'select':
				return `await page.select(${JSON.stringify(action.selector)}, ${JSON.stringify(action.values)})`
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
 * Compile a deep, shadow-aware locator query returning every match.
 *
 * @param query - Serializable locator query
 * @returns Runtime expression returning an element array
 */
export function compileLocatorListExpression(query: BrowserQuery): string {
	return `(() => {
	const query = ${JSON.stringify(query)}
	const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
	const matchesText = (actual, expected, exact) => exact ? normalize(actual) === normalize(expected) : normalize(actual).includes(normalize(expected))
	const elements = (root) => {
		const found = []
		const stack = []
		if (root instanceof Document || root instanceof ShadowRoot) {
			for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index])
		} else {
			for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index])
		}
		while (stack.length > 0) {
			const element = stack.pop()
			if (!(element instanceof Element)) continue
			found.push(element)
			if (element.shadowRoot) {
				for (let index = element.shadowRoot.children.length - 1; index >= 0; index -= 1) stack.push(element.shadowRoot.children[index])
			}
			for (let index = element.children.length - 1; index >= 0; index -= 1) stack.push(element.children[index])
		}
		return found
	}
	const roleOf = (element) => {
		const explicit = element.getAttribute('role')
		if (explicit) return explicit.split(/\\s+/)[0]
		const tag = element.tagName.toLowerCase()
		if (tag === 'a' && element.hasAttribute('href')) return 'link'
		if (tag === 'button') return 'button'
		if (tag === 'textarea') return 'textbox'
		if (tag === 'select') return element.multiple ? 'listbox' : 'combobox'
		if (tag === 'option') return 'option'
		if (tag === 'img') return 'img'
		if (tag === 'nav') return 'navigation'
		if (tag === 'main') return 'main'
		if (tag === 'header') return 'banner'
		if (tag === 'footer') return 'contentinfo'
		if (tag === 'aside') return 'complementary'
		if (tag === 'article') return 'article'
		if (tag === 'form') return 'form'
		if (tag === 'table') return 'table'
		if (tag === 'tr') return 'row'
		if (tag === 'th') return 'columnheader'
		if (tag === 'td') return 'cell'
		if (tag === 'ul' || tag === 'ol') return 'list'
		if (tag === 'li') return 'listitem'
		if (/^h[1-6]$/.test(tag)) return 'heading'
		if (tag === 'input') {
			const type = (element.getAttribute('type') || 'text').toLowerCase()
			if (type === 'checkbox') return 'checkbox'
			if (type === 'radio') return 'radio'
			if (type === 'range') return 'slider'
			if (type === 'number') return 'spinbutton'
			if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
			if (type !== 'hidden') return 'textbox'
		}
		return undefined
	}
	const labelOf = (element) => {
		const labelled = element.getAttribute('aria-labelledby')
		if (labelled) {
			const text = labelled.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent || '').join(' ')
			if (normalize(text)) return normalize(text)
		}
		if (element.hasAttribute('aria-label')) return normalize(element.getAttribute('aria-label'))
		if ('labels' in element && element.labels && element.labels.length > 0) {
			const text = Array.from(element.labels, (label) => label.textContent || '').join(' ')
			return normalize(text)
		}
		return undefined
	}
	const nameOf = (element) => {
		const label = labelOf(element)
		if (label !== undefined) return label
		const alt = element.getAttribute('alt')
		if (alt) return normalize(alt)
		const title = element.getAttribute('title')
		if (title) return normalize(title)
		if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) return normalize(element.value)
		return normalize(element.textContent)
	}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
	}
	const resolve = (candidate) => {
		const roots = candidate.parent ? resolve(candidate.parent) : [document]
		let found = []
		for (const root of roots) {
			const candidates = elements(root)
			switch (candidate.selector) {
				case 'css':
					found.push(...candidates.filter((element) => element.matches(candidate.value)))
					break
				case 'role':
					found.push(...candidates.filter((element) => roleOf(element) === candidate.value && (candidate.name === undefined || matchesText(nameOf(element), candidate.name, candidate.exact === true))))
					break
				case 'text':
					found.push(...candidates.filter((element) => matchesText(element.textContent, candidate.value, candidate.exact === true) && !Array.from(element.children).some((child) => matchesText(child.textContent, candidate.value, candidate.exact === true))))
					break
				case 'label':
					found.push(...candidates.filter((element) => {
						const label = labelOf(element)
						return label !== undefined && matchesText(label, candidate.value, candidate.exact === true)
					}))
					break
				case 'placeholder':
					found.push(...candidates.filter((element) => matchesText(element.getAttribute('placeholder'), candidate.value, candidate.exact === true)))
					break
				case 'test':
					found.push(...candidates.filter((element) => element.getAttribute(${JSON.stringify(BROWSER_TEST_ID_ATTRIBUTE)}) === candidate.value))
					break
			}
		}
		found = found.filter((element, index) => found.indexOf(element) === index)
		if (candidate.filter?.text !== undefined) found = found.filter((element) => matchesText(element.textContent, candidate.filter.text, candidate.filter.exact === true))
		if (candidate.filter?.visible !== undefined) found = found.filter((element) => visible(element) === candidate.filter.visible)
		if (candidate.index !== undefined) {
			const index = candidate.index < 0 ? found.length + candidate.index : candidate.index
			return found[index] ? [found[index]] : []
		}
		return found
	}
	return resolve(query)
})()`
}

/**
 * Compile a deep locator query returning its first match.
 *
 * @param query - Serializable locator query
 * @returns Runtime expression returning one element or undefined
 */
export function compileLocatorExpression(query: BrowserQuery): string {
	return `(${compileLocatorListExpression(query)})[0]`
}

/**
 * Compile an attached-state locator wait.
 */
export function compileAttachedLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length > 0) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, ${BROWSER_WAIT_POLL_INTERVAL_MS})
})`
}

/**
 * Compile a detached-state locator wait.
 */
export function compileDetachedLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length === 0) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, ${BROWSER_WAIT_POLL_INTERVAL_MS})
})`
}

/**
 * Compile a visible-state locator wait.
 */
export function compileVisibleLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
	}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length > 0 && visible(matches[0])) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, ${BROWSER_WAIT_POLL_INTERVAL_MS})
})`
}

/**
 * Compile a hidden-state locator wait.
 */
export function compileHiddenLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
	}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length === 0 || matches.every((element) => !visible(element))) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, ${BROWSER_WAIT_POLL_INTERVAL_MS})
})`
}

/**
 * Compile the element-side actionability pass used before trusted input.
 *
 * @param options - Checks required for the action
 * @returns Async `Runtime.callFunctionOn` function declaration
 */
export function compileActionabilityFunction(options: BrowserActionabilityOptions): string {
	return `async function() {
	if (!(this instanceof Element) || !this.isConnected) throw new Error('Element is detached')
	this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
	const visible = () => {
		const style = getComputedStyle(this)
		const rect = this.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
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

/**
 * Compile an in-page wait for an attached selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileAttachedWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length > 0) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a detached selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileDetachedWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length === 0) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a visible selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileVisibleWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
	}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length > 0 && visible(matches[0])) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a hidden selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileHiddenWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return ${BROWSER_VISIBILITY_SOURCE}
	}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length === 0 || Array.from(matches).every((element) => !visible(element))) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile a strict, visibility-checked click expression.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileClickExpression(selector: string, strict: boolean): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	const style = getComputedStyle(el)
	const rect = el.getBoundingClientRect()
	if (!(${BROWSER_VISIBILITY_SOURCE})) throw new Error('Element is not visible: ' + selector)
	if (el.matches(':disabled')) throw new Error('Element is disabled: ' + selector)
	el.scrollIntoView({ block: 'center', inline: 'center' })
	el.click()
})()`
}

/**
 * Compile a strict, editable fill expression.
 *
 * @param selector - CSS selector
 * @param value - Value to assign
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileFillExpression(selector: string, value: string, strict: boolean): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	const style = getComputedStyle(el)
	const rect = el.getBoundingClientRect()
	if (!(${BROWSER_VISIBILITY_SOURCE})) throw new Error('Element is not visible: ' + selector)
	if (el.matches(':disabled') || el.matches('[readonly]')) throw new Error('Element is not editable: ' + selector)
	if (!el.isContentEditable && !('value' in el)) throw new Error('Element cannot be filled: ' + selector)
	el.focus()
	if (el.isContentEditable) {
		el.textContent = ${JSON.stringify(value)}
	} else {
		el.value = ${JSON.stringify(value)}
	}
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }))
	el.dispatchEvent(new Event('change', { bubbles: true }))
})()`
}

/**
 * Compile a strict select expression.
 *
 * @param selector - CSS selector
 * @param values - Option values to select
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileSelectExpression(
	selector: string,
	values: readonly string[],
	strict: boolean,
): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	if (!(el instanceof HTMLSelectElement)) throw new Error('Element is not a select: ' + selector)
	if (el.disabled) throw new Error('Element is disabled: ' + selector)
	const values = ${JSON.stringify([...values])}
	if (!el.multiple && values.length > 1) throw new Error('Single select cannot accept multiple values: ' + selector)
	const available = new Set(Array.from(el.options, (option) => option.value))
	const missing = values.filter((value) => !available.has(value))
	if (missing.length > 0) throw new Error('Select options not found: ' + missing.join(', '))
	for (const opt of el.options) opt.selected = values.includes(opt.value)
	el.dispatchEvent(new Event('input', { bubbles: true }))
	el.dispatchEvent(new Event('change', { bubbles: true }))
})()`
}
