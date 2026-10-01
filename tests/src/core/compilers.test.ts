/**
 * src/core/compilers.ts tests.
 */

import type { BrowserJourney } from '@src/core'
import { attempt } from '@orkestrel/contract'
import { describe, it, expect } from 'vitest'
import {
	compileTextWaitExpression,
	compileQueryWaitExpression,
	compileSelectFunction,
	compileHitFunction,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	compileBrowserJourney,
	compileBrowserJourneyValue,
	compileReadFunction,
	compileScreenshotPreparationExpression,
	compileGuardedEvaluateExpression,
	compileSubmitObserverExpression,
	compileSubmitReadExpression,
	BROWSER_SUBMIT_KEY,
} from '@src/core'
import {
	BROWSER_JOURNEY_ACTION_FIXTURE,
	BROWSER_JOURNEY_ACTION_MODULE,
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_JOURNEY_MODULE,
	BROWSER_JOURNEY_MODULE_JAVASCRIPT,
	evaluateJavaScript,
	evaluateBrowserHit,
	evaluateBrowserSubmit,
	BrowserSubmitWindow,
	BrowserSubmitWindows,
	BROWSER_SUBMIT_CASES,
	BROWSER_SUBMIT_FOCUS_CASES,
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

describe('compileBrowserJourney', () => {
	it('emits the add-kettle module byte for byte in TypeScript', () => {
		expect(
			compileBrowserJourney(BROWSER_JOURNEY_FIXTURE, { language: 'typescript' }),
		).toStrictEqual({ source: BROWSER_JOURNEY_MODULE, gaps: [] })
	})

	it('emits the JavaScript twin without the type import and the annotations, by default', () => {
		const twin = { source: BROWSER_JOURNEY_MODULE_JAVASCRIPT, gaps: [] }
		expect(compileBrowserJourney(BROWSER_JOURNEY_FIXTURE)).toStrictEqual(twin)
		expect(
			compileBrowserJourney(BROWSER_JOURNEY_FIXTURE, { language: 'javascript' }),
		).toStrictEqual(twin)
	})

	it("renders every action's arguments, keeps a page tool's arguments literal, and drops the target evidence", () => {
		expect(
			compileBrowserJourney(BROWSER_JOURNEY_ACTION_FIXTURE, { language: 'typescript' }),
		).toStrictEqual({ source: BROWSER_JOURNEY_ACTION_MODULE, gaps: ['s11'] })
	})

	it('requires a secret input and forwards it with secret: true and no literal fallback', () => {
		const journey: BrowserJourney = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: { email: { secret: true } },
		}
		const typed = compileBrowserJourney(journey, { language: 'typescript' }).source.split('\n')
		const plain = compileBrowserJourney(journey).source.split('\n')
		const call = `\t\tawait performBrowserStep(toolset, 's4', { action: 'type', arguments: { text: inputs.email, submit: true }, target: { role: 'textbox', name: 'Email' } }, { secret: true })`
		expect(typed[3]).toBe(
			'export async function execute(page: BrowserPageInterface, inputs: { readonly email: string }): Promise<void> {',
		)
		expect(plain[2]).toBe('export async function execute(page, inputs) {')
		expect(typed[10]).toBe(call)
		expect(plain[9]).toBe(call)
		expect(typed.filter((line) => line.includes('secret: true'))).toStrictEqual([call])
	})

	it('compiles each gap to a throw at its position and lists every gap in order', () => {
		const [navigate, , click] = BROWSER_JOURNEY_FIXTURE.steps
		if (navigate === undefined || click === undefined) throw new Error('The fixture lost a step')
		const journey: BrowserJourney = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [
				navigate,
				{ id: 's2', action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
				click,
				{ id: 's4', action: 'unresolved', arguments: {}, gap: "the option's value repeats" },
			],
		}
		const script = compileBrowserJourney(journey, { language: 'typescript' })
		expect(script.gaps).toStrictEqual(['s2', 's4'])
		expect(script.source.split('\n').slice(7, 11)).toStrictEqual([
			`\t\tawait performBrowserStep(toolset, 's1', { action: 'navigate', arguments: { url: 'https://shop.example.test/' } })`,
			`\t\tthrow new Error('s2: the element is in a child frame; handle it here')`,
			`\t\tawait performBrowserStep(toolset, 's3', { action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } })`,
			`\t\tthrow new Error('s4: the option\\'s value repeats; handle it here')`,
		])
	})

	it('takes no inputs when the journey declares no parameter', () => {
		const [navigate] = BROWSER_JOURNEY_FIXTURE.steps
		if (navigate === undefined) throw new Error('The fixture lost a step')
		const journey: BrowserJourney = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [navigate],
		}
		expect(compileBrowserJourney(journey, { language: 'typescript' }).source.split('\n')[3]).toBe(
			'export async function execute(page: BrowserPageInterface): Promise<void> {',
		)
		expect(compileBrowserJourney(journey).source.split('\n')[2]).toBe(
			'export async function execute(page) {',
		)
	})

	it('reads only an own input for a parameter that names an inherited member', () => {
		const field = BROWSER_JOURNEY_FIXTURE.steps[3]
		if (field === undefined) throw new Error('The fixture lost a step')
		const journey: BrowserJourney = {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: { toString: { default: 'sam@example.test' } },
			steps: [{ ...field, arguments: { text: { parameter: 'toString' }, submit: true } }],
		}
		const expression = `(Object.hasOwn(inputs, 'toString') ? inputs.toString : undefined) ?? 'sam@example.test'`
		const lines = compileBrowserJourney(journey).source.split('\n')
		expect(lines[6]).toBe(
			`\t\tawait performBrowserStep(toolset, 's4', { action: 'type', arguments: { text: ${expression}, submit: true }, target: { role: 'textbox', name: 'Email' } })`,
		)
		expect(evaluateJavaScript(`((inputs) => ${expression})({})`)).toBe('sam@example.test')
		expect(
			evaluateJavaScript(`((inputs) => ${expression})({ toString: 'ada@example.test' })`),
		).toBe('ada@example.test')
	})

	it('refuses an invalid journey with the validator code before compiling any source', () => {
		const cases: ReadonlyArray<readonly [journey: BrowserJourney, code: string]> = [
			[{ ...BROWSER_JOURNEY_FIXTURE, name: 'Add Kettle' }, 'BROWSER_JOURNEY_INVALID'],
			[
				{ ...BROWSER_JOURNEY_FIXTURE, parameters: { email: { secret: true, default: 'x' } } },
				'BROWSER_JOURNEY_INVALID',
			],
			[{ ...BROWSER_JOURNEY_FIXTURE, parameters: {} }, 'BROWSER_JOURNEY_INVALID'],
			// `Object.assign` types the unknown format as the declared literal, as a parsed file reaches the compiler.
			[Object.assign({ ...BROWSER_JOURNEY_FIXTURE }, { format: 2 }), 'BROWSER_JOURNEY_FORMAT'],
		]
		for (const [journey, code] of cases) {
			expect(attempt(() => compileBrowserJourney(journey))).toMatchObject({
				success: false,
				error: { code },
			})
		}
	})
})

describe('compileBrowserJourneyValue', () => {
	it('compiles quoting, keys, and nesting into a literal that evaluates back to the value', () => {
		expect(
			compileBrowserJourneyValue({
				plain: `it's "quoted"`,
				'gift-wrap': 'a\\b\nc',
				list: [1, -2.5, true, null, {}, []],
			}),
		).toBe(
			`{ plain: 'it\\'s "quoted"', 'gift-wrap': 'a\\\\b\\nc', list: [1, -2.5, true, null, {}, []] }`,
		)
		const value = {
			['__proto__']: { own: true },
			'': [' ', '\u0000', '\\'],
			'line\nbreak': `'"`,
		}
		const evaluated = evaluateJavaScript(compileBrowserJourneyValue(value))
		expect(evaluated).toStrictEqual(value)
		expect(Object.getPrototypeOf(evaluated)).toBe(Object.prototype)
		expect(Object.hasOwn(Object(evaluated), '__proto__')).toBe(true)
	})

	it('replaces only a binding the map names and keeps every other parameter object literal', () => {
		const value = {
			text: { parameter: 'email' },
			other: { parameter: 'name' },
			pair: { parameter: 'email', extra: 1 },
		}
		expect(compileBrowserJourneyValue(value, new Map([['email', 'inputs.email']]))).toBe(
			`{ text: inputs.email, other: { parameter: 'name' }, pair: { parameter: 'email', extra: 1 } }`,
		)
		expect(compileBrowserJourneyValue(value)).toBe(
			`{ text: { parameter: 'email' }, other: { parameter: 'name' }, pair: { parameter: 'email', extra: 1 } }`,
		)
	})
})

describe('compileSubmitObserverExpression and compileSubmitReadExpression', () => {
	const observer = compileSubmitObserverExpression(7)
	const read = compileSubmitReadExpression(7)

	it.each(BROWSER_SUBMIT_CASES)(
		'reads %s as its surviving relationships and its prevention, and removes the observer',
		(_name, submits, destinations, prevented) => {
			expect(evaluateBrowserSubmit(observer, read, submits)).toEqual([
				{ destinations, prevented, submitted: true, implicit: false },
				0,
			])
		},
	)

	it('reads nothing when no submission fired and replaces an earlier installation', () => {
		const empty = { destinations: [], prevented: false, submitted: false, implicit: false }
		expect(evaluateBrowserSubmit(observer, read)).toEqual([empty, 0])
		expect(evaluateBrowserSubmit(observer, read, [], 2)).toEqual([empty, 0])
		expect(evaluateBrowserSubmit(observer, read, [{ prevented: false, form: {} }], 2)).toEqual([
			{ destinations: ['self'], prevented: false, submitted: true, implicit: false },
			0,
		])
		expect(observer).toContain(JSON.stringify(BROWSER_SUBMIT_KEY))
		expect(read).toContain(JSON.stringify(BROWSER_SUBMIT_KEY))
	})

	it.each(BROWSER_SUBMIT_FOCUS_CASES)(
		'reads %s as implicit only when the Enter reached an input a form owns',
		(_name, focus, key, implicit) => {
			const window = new BrowserSubmitWindow()
			window.focus(focus)
			window.evaluate(compileSubmitObserverExpression(3))
			expect(window.listeners).toBe(2)
			window.press(key)
			expect(window.evaluate(compileSubmitReadExpression(3))).toEqual({
				destinations: [],
				prevented: false,
				submitted: false,
				implicit,
			})
			expect(window.listeners).toBe(0)
		},
	)

	it('reads no Enter that arrived before the installation, and one that arrived after a replacing installation', () => {
		const window = new BrowserSubmitWindow()
		window.focus({ name: 'input', form: {} })
		window.press('Enter')
		window.evaluate(compileSubmitObserverExpression(4))
		expect(window.evaluate(compileSubmitReadExpression(4))).toMatchObject({ implicit: false })
		window.press('Enter')
		window.evaluate(compileSubmitObserverExpression(5))
		window.evaluate(compileSubmitObserverExpression(6))
		window.press('Enter')
		expect(window.listeners).toBe(2)
		expect(window.evaluate(compileSubmitReadExpression(6))).toMatchObject({ implicit: true })
	})

	it('answers null and removes nothing for a read of another token or of no observer', () => {
		expect(evaluateBrowserSubmit(observer, read, [], 0)).toEqual([null, 0])
		expect(
			evaluateBrowserSubmit(compileSubmitObserverExpression(8), read, [
				{ prevented: false, form: {} },
			]),
		).toEqual([null, 2])
	})

	it('keeps a later action observer when an earlier action removal lands after it installed', () => {
		const windows = new BrowserSubmitWindows()
		const window = windows.window('session-main', 91)
		window.evaluate(compileSubmitObserverExpression(1))
		window.evaluate(compileSubmitObserverExpression(2))
		expect(window.evaluate(compileSubmitReadExpression(1))).toBeNull()
		expect(window.listeners).toBe(2)
		window.dispatch({ prevented: false, form: { target: '_parent' } })
		expect(window.evaluate(compileSubmitReadExpression(2))).toEqual({
			destinations: ['parent'],
			prevented: false,
			submitted: true,
			implicit: false,
		})
		expect(window.listeners).toBe(0)
	})
})
