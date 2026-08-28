/**
 * src/core/compilers.ts tests.
 */

import type { BrowserCodegenAction } from '@src/core'
import { describe, it, expect } from 'vitest'
import {
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	compileAttachedWaitExpression,
	compileClickExpression,
	compileCodegenScript,
	compileHiddenWaitExpression,
	compileSelectExpression,
	compileVisibleWaitExpression,
	guardEvaluateExpression,
} from '@src/core'
import { evaluateJavaScript } from '../../setup.js'

describe('browser action expressions', () => {
	it('embeds hostile selectors as JSON data rather than executable source', () => {
		const selector = String.raw`div[data-value='";globalThis.pwned=true;//']`
		const wait = compileAttachedWaitExpression(selector, true, 250)
		const click = compileClickExpression(selector, true)

		expect(wait).toContain(JSON.stringify(selector))
		expect(click).toContain(JSON.stringify(selector))
		expect(wait).toContain('const strict = true')
		expect(wait).toContain('250')
		expect(click).toContain('matches.length !== 1')
		expect(click).toContain(':disabled')
	})

	it('lets non-strict visible waits act on the first match and hidden waits require all hidden', () => {
		const visible = compileVisibleWaitExpression('.item', false, 100)
		const hidden = compileHiddenWaitExpression('.item', false, 100)

		expect(visible).toContain('matches.length > 0 && visible(matches[0])')
		expect(hidden).toContain('Array.from(matches).every')
	})

	it('rejects missing options and multiple values for a single select', () => {
		const expression = compileSelectExpression('#region', ['us', 'ca'], true)

		expect(expression).toContain('!el.multiple && values.length > 1')
		expect(expression).toContain('Select options not found')
		expect(expression).toContain('new Set(Array.from(el.options')
	})
})

describe('guardEvaluateExpression', () => {
	it('wraps the expression and embeds the limit in the thrown sentinel message', () => {
		const wrapped = guardEvaluateExpression('1 + 1', 100)
		expect(wrapped).toContain('1 + 1')
		expect(wrapped).toContain('JSON.stringify(r)')
		expect(wrapped).toContain(
			`throw new Error(${JSON.stringify(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)} + s.length)`,
		)
		expect(wrapped).toContain('s.length > 100')
	})

	it('returns the original value when the serialized result is within the limit', () => {
		const wrapped = guardEvaluateExpression('({ a: 1 })', 1000)
		expect(evaluateJavaScript(wrapped)).toEqual({ a: 1 })
	})

	it('throws the sentinel error when the serialized result exceeds the limit', () => {
		const wrapped = guardEvaluateExpression('"x".repeat(50)', 10)
		expect(() => evaluateJavaScript(wrapped)).toThrow(`${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}52`)
	})

	it('does not throw for a non-serializable (undefined) result even over a tiny limit', () => {
		const wrapped = guardEvaluateExpression('undefined', 0)
		expect(evaluateJavaScript(wrapped)).toBeUndefined()
	})

	it('places the expression on its own line so a trailing line comment cannot swallow the closing guard syntax', () => {
		const wrapped = guardEvaluateExpression('1 + 1 // a trailing comment', 1000)
		// Must still parse: a single-line wrapper would have the `// comment`
		// consume everything after it on that line, including the guard tail.
		expect(evaluateJavaScript(wrapped)).toBe(2)
	})

	it('still enforces the limit when the expression ends with a line comment', () => {
		const wrapped = guardEvaluateExpression('"x".repeat(50) // trailing comment', 10)
		expect(() => evaluateJavaScript(wrapped)).toThrow(`${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}52`)
	})

	it('does not misclassify a page-thrown error whose message merely contains the sentinel-like substring', () => {
		// A page's own error text containing "BROWSER_RESULT_LIMIT: <n>" (the
		// OLD unanchored substring) must not match the anchored, distinctively
		// prefixed pattern used to recognize the guard's own throw.
		const pageDescription = 'Uncaught Error: my message says BROWSER_RESULT_LIMIT: 5 right here'
		expect(BROWSER_RESULT_LIMIT_PATTERN.exec(pageDescription)).toBeNull()
	})

	it('recognizes the real guard throw via the anchored, distinctive pattern', () => {
		const description = `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000\n    at <anonymous>:1:100`
		const match = BROWSER_RESULT_LIMIT_PATTERN.exec(description)
		expect(match?.[1]).toBe('4200000')
	})
})

describe('compileCodegenScript', () => {
	const actions: BrowserCodegenAction[] = [
		{ action: 'navigate', url: 'about:blank' },
		{ action: 'click', selector: '#a' },
		{ action: 'fill', selector: '#b', value: 'hi' },
		{ action: 'select', selector: '#c', values: ['x', 'y'] },
	]

	it('emits an async run(page) wrapper with one statement per action (javascript default)', () => {
		const script = compileCodegenScript(actions)
		expect(script.startsWith('async function run(page) {')).toBe(true)
		expect(script).not.toContain('import(')
		const lines = script.split('\n')
		expect(lines).toHaveLength(actions.length + 2)
		expect(lines[1]).toBe(`\tawait page.navigate("about:blank")`)
		expect(lines[2]).toBe(`\tawait page.click("#a")`)
		expect(lines[3]).toBe(`\tawait page.fill("#b", "hi")`)
		expect(lines[4]).toBe(`\tawait page.select("#c", ["x","y"])`)
	})

	it('emits a TypeScript-typed page parameter only when language is typescript', () => {
		const script = compileCodegenScript(actions, { language: 'typescript' })
		expect(
			script.startsWith(
				`async function run(page: import('@orkestrel/browser').BrowserPageInterface): Promise<void> {`,
			),
		).toBe(true)
	})

	it('embeds a selector containing quotes safely via JSON-safe quoting', () => {
		const withQuote: BrowserCodegenAction[] = [{ action: 'click', selector: `div[data-x="y"]` }]
		const script = compileCodegenScript(withQuote)
		const expectedLine = `\tawait page.click(${JSON.stringify(`div[data-x="y"]`)})`
		expect(script).toContain(expectedLine)
		// The embedded quotes are escaped, not left bare.
		expect(script).toContain('\\"y\\"')
	})

	it('emits an empty body for an empty action list', () => {
		const script = compileCodegenScript([])
		expect(script).toBe('async function run(page) {\n}')
	})
})
