import type { BrowserCodegenAction, BrowserCodegenScriptOptions } from './types.js'
import { isRecord, isString } from '@orkestrel/contract'
import { BASE64_LOOKUP, BROWSER_RESULT_LIMIT_SENTINEL_PREFIX } from './constants.js'

/**
 * Decode a base64-encoded string into raw bytes.
 *
 * @remarks
 * Pure JS implementation — no `Buffer`, no `atob` (DOM-only) — so it runs
 * identically in Node and browser environments. Whitespace and `=` padding
 * are ignored; invalid characters are skipped.
 *
 * @param text - Base64-encoded input string
 * @returns Decoded bytes
 *
 * @example
 * ```ts
 * decodeBase64('aGVsbG8=') // Uint8Array [104, 101, 108, 108, 111]
 * ```
 */
export function decodeBase64(text: string): Uint8Array {
	const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
	const bytes: number[] = []

	let buffer = 0
	let bits = 0

	for (const char of clean) {
		const value = BASE64_LOOKUP[char]
		if (value === undefined) continue

		buffer = (buffer << 6) | value
		bits += 6

		if (bits >= 8) {
			bits -= 8
			bytes.push((buffer >> bits) & 0xff)
		}
	}

	return new Uint8Array(bytes)
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
 * Normalize a raw list of recorded codegen actions.
 *
 * @remarks
 * Collapses consecutive `fill` actions on the same selector into the latest
 * value (a text input fires one `input` event per keystroke) so the
 * compiled script reflects the final typed value rather than every
 * intermediate keystroke.
 *
 * @param actions - Raw recorded actions, in capture order
 * @returns Normalized actions, in the same order
 */
export function normalizeCodegenActions(
	actions: readonly BrowserCodegenAction[],
): readonly BrowserCodegenAction[] {
	const result: BrowserCodegenAction[] = []

	for (const action of actions) {
		const previous = result[result.length - 1]
		if (
			previous !== undefined &&
			previous.action === 'fill' &&
			action.action === 'fill' &&
			previous.selector === action.selector
		) {
			result[result.length - 1] = action
			continue
		}
		result.push(action)
	}

	return result
}

/**
 * Parse a codegen binding payload into a typed action.
 *
 * @remarks
 * The in-page recorder script calls the CDP binding with a JSON string
 * payload shaped like a {@link BrowserCodegenAction}. Returns `undefined`
 * when the payload is not valid JSON or does not match a known action shape.
 *
 * @param payload - Raw binding call payload (the CDP `payload` param)
 * @returns The parsed action, or `undefined` when the payload is malformed
 */
export function parseCodegenActionPayload(payload: unknown): BrowserCodegenAction | undefined {
	if (!isString(payload)) return undefined

	let parsed: unknown
	try {
		parsed = JSON.parse(payload)
	} catch {
		return undefined
	}

	if (!isRecord(parsed)) return undefined

	const action = parsed['action']
	const selector = parsed['selector']

	if (action === 'click' && isString(selector)) {
		return { action: 'click', selector }
	}

	if (action === 'fill' && isString(selector) && isString(parsed['value'])) {
		return { action: 'fill', selector, value: parsed['value'] }
	}

	if (action === 'select' && isString(selector) && Array.isArray(parsed['values'])) {
		const values = parsed['values'].filter(isString)
		if (values.length === parsed['values'].length) {
			return { action: 'select', selector, values }
		}
	}

	return undefined
}

/**
 * Derive a `navigate` codegen action from a `Page.frameNavigated` CDP event.
 *
 * @remarks
 * Only the top-level (main) frame's navigation is recorded — a frame
 * carrying a `parentId` is a sub-frame and is ignored.
 *
 * @param params - The CDP `Page.frameNavigated` event params
 * @returns A `navigate` action, or `undefined` when the event is not a
 *   top-level navigation with a resolvable URL
 */
export function readCodegenNavigateAction(
	params: Readonly<Record<string, unknown>>,
): BrowserCodegenAction | undefined {
	const frame = params['frame']
	if (!isRecord(frame)) return undefined
	if ('parentId' in frame) return undefined
	if (!isString(frame['url'])) return undefined

	return { action: 'navigate', url: frame['url'] }
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
