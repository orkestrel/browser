/**
 * src/core/compilers.ts tests.
 */

import type { BrowserCodegenAction } from '@src/core'
import { describe, it, expect } from 'vitest'
import {
	compileTextWaitExpression,
	compileQueryWaitExpression,
	compileSelectFunction,
	compileHitFunction,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	compileCodegenScript,
	compileReadFunction,
	compileScreenshotPreparationExpression,
	compileGuardedEvaluateExpression,
	compileSubmitObserverExpression,
	compileSubmitReadExpression,
	BROWSER_SUBMIT_KEY,
} from '@src/core'
import {
	evaluateJavaScript,
	evaluateBrowserHit,
	evaluateBrowserSubmit,
	BrowserSubmitWindows,
	BROWSER_SUBMIT_CASES,
	readBrowserCompiledTimers,
	runBrowserCompiledTimers,
} from '../../setup.js'

describe('element compilers', () => {
	it('catches polling, duplicate timers, and a deadline placed in the wrong argument', () => {
		for (const expression of [
			compileTextWaitExpression('ready', 73, 'text'),
			compileQueryWaitExpression(73, 'query'),
		]) {
			expect(expression).not.toContain('setInterval')
			expect(expression.match(/setTimeout/g)).toHaveLength(1)
			expect(readBrowserCompiledTimers(expression)).toEqual([{ name: 'setTimeout', delay: '73' }])
			expect(expression).toContain('new MutationObserver')
			expect(expression).toContain('requestAnimationFrame(check)')
			expect(expression).toContain('observer?.disconnect()')
		}
	})

	it('registers one timer, runs its deadline once without re-arming, and disconnects the observer', async () => {
		for (const expression of [
			compileTextWaitExpression('ready', 73, 'text'),
			compileQueryWaitExpression(73, 'query'),
		]) {
			const run = await runBrowserCompiledTimers(expression)
			expect(run.result).toBe(false)
			expect(run.timers).toEqual([{ name: 'setTimeout', delay: '73' }])
			expect(run.disconnects).toBe(1)
		}
	})

	it('reports a re-armed timer from a deadline callback that registers another', async () => {
		const rearming = `new Promise((resolve) => {
	const arm = () => setTimeout(() => { arm(); resolve(false) }, 5)
	arm()
})`
		const run = await runBrowserCompiledTimers(rearming)
		expect(run.timers).toHaveLength(2)
	})

	it('catches dropping selection, label fallback, dispatched change, or descendant hit support', () => {
		expect(compileSelectFunction()).toContain('this.select()')
		const select = compileSelectFunction(['Business'])
		expect(select).toContain('option.value === value')
		expect(select).toContain('option.label === value')
		expect(select).toContain("new Event('input', { bubbles: true })")
		expect(select).toContain("new Event('change', { bubbles: true })")
		expect(evaluateBrowserHit(compileHitFunction())).toEqual([true, false])
	})
})

describe('compileScreenshotPreparationExpression', () => {
	it('draws one overlay per masked rectangle and skips preparation when nothing needs it', () => {
		expect(compileScreenshotPreparationExpression()).toBeUndefined()

		const expression = compileScreenshotPreparationExpression({ color: '#123456' }, [
			[10, 20, 30, 40],
		])

		expect(expression).toContain('[[10,20,30,40]]')
		expect(expression).toContain(JSON.stringify('#123456'))
	})
})

describe('compileGuardedEvaluateExpression', () => {
	it('wraps the expression and embeds the limit in the thrown sentinel message', () => {
		const wrapped = compileGuardedEvaluateExpression('1 + 1', 100)
		expect(wrapped).toContain('1 + 1')
		expect(wrapped).toContain('JSON.stringify(r)')
		expect(wrapped).toContain(
			`throw new Error(${JSON.stringify(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)} + s.length)`,
		)
		expect(wrapped).toContain('s.length > 100')
	})

	it('returns the original value when the serialized result is within the limit', () => {
		const wrapped = compileGuardedEvaluateExpression('({ a: 1 })', 1000)
		expect(evaluateJavaScript(wrapped)).toEqual({ a: 1 })
	})

	it('throws the sentinel error when the serialized result exceeds the limit', () => {
		const wrapped = compileGuardedEvaluateExpression('"x".repeat(50)', 10)
		expect(() => evaluateJavaScript(wrapped)).toThrow(`${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}52`)
	})

	it('does not throw for a non-serializable (undefined) result even over a tiny limit', () => {
		const wrapped = compileGuardedEvaluateExpression('undefined', 0)
		expect(evaluateJavaScript(wrapped)).toBeUndefined()
	})

	it('places the expression on its own line so a trailing line comment cannot swallow the closing guard syntax', () => {
		const wrapped = compileGuardedEvaluateExpression('1 + 1 // a trailing comment', 1000)
		// Must still parse: a single-line wrapper would have the `// comment`
		// consume everything after it on that line, including the guard tail.
		expect(evaluateJavaScript(wrapped)).toBe(2)
	})

	it('still enforces the limit when the expression ends with a line comment', () => {
		const wrapped = compileGuardedEvaluateExpression('"x".repeat(50) // trailing comment', 10)
		expect(() => evaluateJavaScript(wrapped)).toThrow(`${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}52`)
	})

	it('does not misclassify a page-thrown error whose message merely contains the sentinel-like substring', () => {
		// A page's own error text containing "BROWSER_RESULT_LIMIT: <n>" (the
		// OLD unanchored substring) must not match the anchored, distinctively
		// prefixed pattern used to recognize the guard's own throw.
		const pageDescription = 'Uncaught Error: my message says BROWSER_RESULT_LIMIT: 5 right here'
		expect(BROWSER_RESULT_LIMIT_PATTERN.exec(pageDescription)).toBeNull()
	})

	it('recognizes the real guard throw through the anchored, distinctive pattern', () => {
		const description = `Uncaught Error: ${BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}4200000\n    at <anonymous>:1:100`
		const match = BROWSER_RESULT_LIMIT_PATTERN.exec(description)
		expect(match?.[1]).toBe('4200000')
	})
})

describe('compileReadFunction', () => {
	it('reads the url, title, and root html of the document it runs against', () => {
		const read = new Function('document', 'location', `return (${compileReadFunction()})()`)

		expect(
			Reflect.apply(read, undefined, [
				{ title: 'Field notes', documentElement: { outerHTML: '<html><body>Notes</body></html>' } },
				{ href: 'https://example.com/notes' },
			]),
		).toEqual({
			url: 'https://example.com/notes',
			title: 'Field notes',
			html: '<html><body>Notes</body></html>',
		})
	})

	it('reads an empty html for a document without a root element', () => {
		const read = new Function('document', 'location', `return (${compileReadFunction()})()`)

		expect(
			Reflect.apply(read, undefined, [
				{ title: '', documentElement: null },
				{ href: 'about:blank' },
			]),
		).toEqual({ url: 'about:blank', title: '', html: '' })
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
		expect(lines[2]).toBe(`\tawait (await page.elements.find({ css: "#a" }))[0].click()`)
		expect(lines[3]).toBe(`\tawait (await page.elements.find({ css: "#b" }))[0].fill("hi")`)
		expect(lines[4]).toBe(`\tawait (await page.elements.find({ css: "#c" }))[0].select(["x","y"])`)
	})

	it('emits a TypeScript-typed page parameter only when language is typescript', () => {
		const script = compileCodegenScript(actions, { language: 'typescript' })
		expect(
			script.startsWith(
				`async function run(page: import('@orkestrel/browser').BrowserPageInterface): Promise<void> {`,
			),
		).toBe(true)
	})

	it('embeds a selector containing quotes safely through JSON-safe quoting', () => {
		const withQuote: BrowserCodegenAction[] = [{ action: 'click', selector: `div[data-x="y"]` }]
		const script = compileCodegenScript(withQuote)
		const expectedLine = `\tawait (await page.elements.find({ css: ${JSON.stringify(`div[data-x="y"]`)} }))[0].click()`
		expect(script).toContain(expectedLine)
		// The embedded quotes are escaped, not left bare.
		expect(script).toContain('\\"y\\"')
	})

	it('emits an empty body for an empty action list', () => {
		const script = compileCodegenScript([])
		expect(script).toBe('async function run(page) {\n}')
	})
})

describe('compileSubmitObserverExpression and compileSubmitReadExpression', () => {
	const observer = compileSubmitObserverExpression(7)
	const read = compileSubmitReadExpression(7)

	it.each(BROWSER_SUBMIT_CASES)(
		'reads %s as its surviving relationships and removes the observer',
		(_name, submits, destinations) => {
			expect(evaluateBrowserSubmit(observer, read, submits)).toEqual([destinations, 0])
		},
	)

	it('reads nothing when no submission fired and replaces an earlier installation', () => {
		expect(evaluateBrowserSubmit(observer, read)).toEqual([[], 0])
		expect(evaluateBrowserSubmit(observer, read, [], 2)).toEqual([[], 0])
		expect(evaluateBrowserSubmit(observer, read, [{ prevented: false, form: {} }], 2)).toEqual([
			['self'],
			0,
		])
		expect(observer).toContain(JSON.stringify(BROWSER_SUBMIT_KEY))
		expect(read).toContain(JSON.stringify(BROWSER_SUBMIT_KEY))
	})

	it('answers null and removes nothing for a read of another token or of no observer', () => {
		expect(evaluateBrowserSubmit(observer, read, [], 0)).toEqual([null, 0])
		expect(
			evaluateBrowserSubmit(compileSubmitObserverExpression(8), read, [
				{ prevented: false, form: {} },
			]),
		).toEqual([null, 1])
	})

	it('keeps a later action observer when an earlier action removal lands after it installed', () => {
		const windows = new BrowserSubmitWindows()
		const window = windows.window('session-main', 91)
		window.evaluate(compileSubmitObserverExpression(1))
		window.evaluate(compileSubmitObserverExpression(2))
		expect(window.evaluate(compileSubmitReadExpression(1))).toBeNull()
		expect(window.listeners).toBe(1)
		window.dispatch({ prevented: false, form: { target: '_parent' } })
		expect(window.evaluate(compileSubmitReadExpression(2))).toEqual(['parent'])
		expect(window.listeners).toBe(0)
	})
})
