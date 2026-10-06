import type {
	BrowserAction,
	BrowserJourneyStepInput,
	BrowserJourneyEdit,
	BrowserJourney,
	BrowserJourneyStoreInterface,
	BrowserJourneyStep,
	BrowserRun,
	BrowserStoreOptions,
	BrowserStoreFault,
	BrowserCallOptions,
	BrowserWaitOptions,
	BrowserElementInterface,
	BrowserElementManagerInterface,
	BrowserElementQuery,
	BrowserFrameInterface,
	BrowserNavigationEventMap,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserOutlineOptions,
	BrowserReadingInterface,
	BrowserReferenceFunction,
	BrowserViewInterface,
	BrowserToolsetInterface,
	BrowserToolSourceEventMap,
	CDPClientInterface,
	CDPTarget,
	CDPTransportEventMap,
	CDPTransportInterface,
	BrowserWriterInterface,
	CDPClientEventMap,
	CDPHandler,
	CDPSendOptions,
} from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { RecorderInterface } from '@orkestrel/test'
import {
	BrowserCodegen,
	BROWSER_CODEGEN_SOURCE,
	BrowserError,
	BrowserPage,
	BrowserToolset,
	MemoryBrowserRunStore,
	compileSubmitObserverExpression,
	compileReadFunction,
	compileSubmitReadExpression,
	createBrowserReading,
	createCDPClient,
} from '@src/core'
import { BrowserNavigationRecord } from '../src/core/BrowserNavigationRecord.js'
import { isNumber, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createTool, createToolManager } from '@orkestrel/tool'
import { createRecorder, waitForEvent } from '@orkestrel/test'

/** Holds details whose body becomes readable when opened. */
export const WAIT_DETAILS_HTML = '<details><summary>Summary</summary><p>Wait subject</p></details>'

/** Holds text-wait visibility cases shared by the DOM and CDP placements. */
export const WAIT_TEXT_CASES = Object.freeze([
	{ name: 'closed details', html: WAIT_DETAILS_HTML, absent: true },
	{ name: 'until-found', html: '<p hidden="until-found">Wait subject</p>', absent: true },
	{ name: 'opacity zero', html: '<p style="opacity:0">Wait subject</p>', absent: false },
	{ name: 'aria-hidden', html: '<p aria-hidden="true">Wait subject</p>', absent: false },
])

/** Holds an exit whose visibility changes after its last DOM mutation. */
export const WAIT_EXIT_HTML = `<style>
#toast{visibility:hidden;transition:visibility 0s linear 200ms}
#toast.shown{visibility:visible;transition:none}
</style><p id="toast" class="shown">Saved to drafts</p>`

/** Holds stylesheet-hidden panels and the rendered capture's layout controls. */
export const RENDERED_PAGE = `<!doctype html><html><head><title>Rendered reading</title><style>
.toast:not(.show),.tab-pane,.carousel-item,.hidden-host{display:none}
.offcanvas{visibility:hidden}.revealed{visibility:visible}.transparent{opacity:0}
.contents{display:contents}.skipped{content-visibility:hidden}
</style></head><body><main><p>Order summary shown</p>
<div class="toast">Toast body dismissed</div><div class="tab-pane"><p id="hidden-child">Notes pane inactive</p></div>
<div class="offcanvas">Offcanvas title closed<span class="revealed">Visible inside hidden</span><img src="/pixel.png" alt="Hidden image alt"></div>
<img src="/pixel.png" alt="Shown image alt"><div class="carousel-item">Slide caption inactive</div>
<dialog>Closed dialog text</dialog><p class="transparent">Transparent text kept</p><div class="contents">Contents wrapper kept</div>
<select><option>Option label kept</option></select>
<details><summary>Summary label</summary>Closed details body<summary>Second summary hidden</summary></details>
<details open><summary>Open label</summary>Open details body</details>
<div class="skipped">Skipped contents</div><div>Skipped contents twin</div>
<canvas>Canvas fallback</canvas><video>Video fallback</video><audio controls>Audio fallback</audio><iframe>Iframe fallback</iframe>
<section id="region" aria-label="Region"><p>Region shown</p><p style="display:none">Region hidden</p></section>
<div id="shadow"><span slot="shown">Slotted shown</span><span slot="hidden">Slotted hidden</span><span>Unslotted element</span>Unslotted text</div>
<div id="hidden-host" class="hidden-host"></div>
</main></body></html>`

/** Declares visible prose independently of the capture implementation. */
export const RENDERED_TEXT =
	'Order summary shown Visible inside hidden Transparent text kept Contents wrapper kept Option label kept Summary label Open label Open details body Skipped contents twin Region shown Slotted shown'

/** Declares the floor fixture's printed text and explicit graphic alternatives. */
export const CAPTURE_CASES = Object.freeze([
	{
		name: 'HTML switch element',
		html: '<switch>Enable alerts</switch>',
		edit: '',
		text: 'Enable alerts',
	},
	{
		name: 'HTML switch mixed children',
		html: '<switch><span>Bold</span> rest</switch>',
		edit: '',
		text: 'Bold rest',
	},
	{
		name: 'SVG switch symbol use',
		html: '<svg><symbol id="caption"><switch><text y="20">Used label</text><text y="20">Used label</text></switch></symbol><use href="#caption"></use></svg>',
		edit: '',
		text: 'Used label',
	},
	{
		name: 'SVG switch defs use',
		html: '<svg><defs><g id="caption"><switch><text y="20">Used label</text><text y="20">Used label</text></switch></g></defs><use href="#caption"></use></svg>',
		edit: '',
		text: 'Used label',
	},
	{
		name: 'SVG switch offscreen auto visibility',
		html: '<div style="position:absolute;top:100000px;content-visibility:auto;contain-intrinsic-size:300px 100px"><svg><switch><foreignObject requiredExtensions="urn:example:unsupported" width="200" height="40"><div>Unsupported label</div></foreignObject><text y="20">Supported label</text></switch></svg></div>',
		edit: '',
		text: 'Supported label',
	},
	{
		name: 'SVG switch first branch',
		html: '<svg><switch><foreignObject width="200" height="40"><div>Order total</div></foreignObject><text y="20">Order total</text></switch></svg>',
		edit: '',
		text: 'Order total',
	},
	{
		name: 'SVG switch unsupported extension',
		html: '<svg><switch><foreignObject requiredExtensions="urn:example:unsupported" width="200" height="40"><div>Unsupported label</div></foreignObject><text y="20">Supported label</text></switch></svg>',
		edit: '',
		text: 'Supported label',
	},
	{
		name: 'SVG inside foreignObject',
		html: '<svg><foreignObject><div><svg><text y="20">Deep label</text></svg></div></foreignObject></svg>',
		edit: '',
		text: 'Deep label',
	},
	{
		name: 'SVG switch empty first branch',
		html: '<svg><switch><g></g><text y="20">Unused fallback</text></switch></svg>',
		edit: '',
		text: '',
	},
	{
		name: 'SVG switch hidden first branch',
		html: '<svg><switch><g style="display:none"><text>Hidden branch</text></g><text y="20">Unused fallback</text></switch></svg>',
		edit: '',
		text: '',
	},
	{
		name: 'SVG nested text',
		html: '<svg><text>A<text>B</text></text></svg>',
		edit: '',
		text: 'AB',
	},
	{
		name: 'nested SVG',
		html: '<svg><svg><text y="20">Inner label</text></svg></svg>',
		edit: '',
		text: 'Inner label',
	},
	{
		name: 'foreignObject',
		html: '<svg><foreignObject width="200" height="100"><p>Legend prose</p><input value="Legend value"></foreignObject></svg>',
		edit: '',
		text: 'Legend prose Legend value',
	},
	{
		name: 'placeholder color',
		html: '<input placeholder="Visible hint"><input id="unpainted" placeholder="Transparent hint"><style>#unpainted::placeholder{color:transparent}</style>',
		edit: '',
		text: 'Visible hint',
	},
	{
		name: 'placeholder visibility',
		html: '<input placeholder="Visible hint"><input id="unpainted" placeholder="Hidden hint"><style>#unpainted::placeholder{visibility:hidden}</style>',
		edit: '',
		text: 'Visible hint',
	},
	{
		name: 'image privacy',
		html: '<p>Public label</p><input type="image" aria-hidden="true" aria-label="Private image name" alt="Private image alt">',
		edit: '',
		text: 'Public label',
	},
	{
		name: 'invisible button',
		html: '<p>Public label</p><button style="visibility:hidden" aria-label="Hidden button"><svg style="visibility:visible" aria-label="Visible child"></svg></button>',
		edit: '',
		text: 'Public label Visible child',
	},
	{
		name: 'textarea placeholder',
		html: '<textarea placeholder="Visible notes"></textarea><textarea id="unpainted" placeholder="Hidden notes"></textarea><style>#unpainted::placeholder{opacity:0}</style>',
		edit: '',
		text: 'Visible notes',
	},
	{
		name: 'namespaced select privacy',
		html: '<p>Public label</p>',
		edit: 'const box=document.createElementNS(\'urn:example\',\'select\');box.innerHTML=\'<input type="password" value="private-namespace"><input type="hidden" value="hidden-payload">\';document.body.append(box)',
		text: 'Public label',
	},
	{
		name: 'form privacy',
		html: '<form>Public label<input type="password" value="private-form"><input type="hidden" value="hidden-payload"></form>',
		edit: '',
		text: 'Public label',
	},
	{
		name: 'dialog privacy',
		html: '<dialog open>Public label<input type="password" value="private-dialog"><input type="hidden" value="hidden-payload"></dialog>',
		edit: '',
		text: 'Public label',
	},
	{
		name: 'slot privacy',
		html: '<div id="host"><p>Public label</p><input type="password" value="private-slot"><input type="hidden" value="hidden-payload"></div>',
		edit: "document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<slot></slot>'",
		text: 'Public label',
	},
	{
		name: 'form',
		html: '<form action="/submit"><p>Form prose</p><label>Name <input value="Old name"></label></form>',
		edit: 'document.querySelector("input").value="Typed name"',
		text: 'Form prose Name Typed name',
	},
	{
		name: 'dialog',
		html: '<dialog open style="position:static">Open notice</dialog><dialog>Closed notice</dialog>',
		edit: '',
		text: 'Open notice',
	},
	{
		name: 'buttons',
		html: '<button aria-label="Wrong name">Save changes</button><button disabled>Unavailable action</button>',
		edit: '',
		text: 'Save changes Unavailable action',
	},
	{
		name: 'selection',
		html: '<select><option selected>Default selection</option><option label="Shown selection" value="payload">Source selection</option></select>',
		edit: 'document.querySelector("select").selectedIndex=1',
		text: 'Shown selection',
	},
	{
		name: 'listbox',
		html: '<select multiple size="3"><option selected>First row</option><option>Second row</option><option>Third row</option><option>Fourth row</option></select>',
		edit: '',
		text: 'First row Second row Third row',
	},
	{
		name: 'groups',
		html: '<select size="5"><optgroup label="Group caption"><option>Group first</option><option selected>Group second</option></optgroup><optgroup label="Other caption"><option>Group third</option></optgroup></select>',
		edit: '',
		text: 'Group caption Group first Group second Other caption Group third',
	},
	{
		name: 'values',
		html: '<input value="Old text"><input type="email" value="old@example.test"><input type="search" value="Old search"><input type="number" value="12"><textarea>Old notes</textarea>',
		edit: 'document.querySelector("input").value="Typed text";document.querySelector("[type=email]").value="typed@example.test";document.querySelector("[type=search]").value="Typed search";document.querySelector("[type=number]").value="37";document.querySelector("textarea").value="Typed notes\\nSecond line"',
		text: 'Typed text typed@example.test Typed search 37 Typed notes Second line',
	},
	{
		name: 'privacy',
		html: '<p>Public label</p><input type="password" value="private-default" placeholder="private-hint"><input type="hidden" value="hidden-payload" style="display:block">',
		edit: 'document.querySelector("[type=password]").value="private-edited"',
		text: 'Public label',
	},
	{
		name: 'nontext',
		html: '<label>Checkbox label<input type="checkbox" checked value="Payload only"></label><input type="radio" value="Radio payload"><input type="range" value="73"><input type="color" value="#abcdef"><input type="file">',
		edit: 'const transfer=new DataTransfer();transfer.items.add(new File(["fixture"],"visible-report.txt"));document.querySelector("[type=file]").files=transfer.files',
		text: 'Checkbox label visible-report.txt',
	},
	{
		name: 'graphics',
		html: '<button aria-label="Search records"><svg><title>Duplicate graphic</title><circle r="2"/></svg></button><svg><title>Star title</title><path d="M0 0L1 1"/></svg><svg aria-label="Blue circle"><title>Wrong title</title></svg><svg aria-hidden="true"><title>Decorative title</title></svg><input type="image" alt="Image action">',
		edit: '',
		text: 'Search records Star title Blue circle Image action',
	},
	{
		name: 'separators',
		html: '<button>Left control</button><button>Right control</button><textarea>First line\nLast line</textarea>',
		edit: '',
		text: 'Left control Right control First line Last line',
	},
	{
		name: 'painted',
		html: '<p aria-hidden="true">Painted prose</p><p hidden style="display:block">Displayed hidden attribute</p>',
		edit: '',
		text: 'Painted prose Displayed hidden attribute',
	},
	{
		name: 'limits',
		html: '<p>Supported prose</p><input type="submit"><input type="reset"><input type="file"><input type="date" value="2026-10-03"><input type="datetime-local" value="2026-10-03T12:00"><math aria-label="Guessed equation"><mfrac><mi>x</mi><mn>2</mn></mfrac></math>',
		edit: '',
		text: 'Supported prose',
	},
	{
		name: 'captions',
		html: '<input type="submit" value="Send"><input type="reset" value="Clear"><input type="button" value="Action">',
		edit: '',
		text: 'Send Clear Action',
	},
	{
		name: 'placeholder',
		html: '<input placeholder="Visible hint"><input placeholder="Invisible hint" style="--unused:0"><style>input:last-of-type::placeholder{opacity:0}</style>',
		edit: 'document.querySelector("input").focus()',
		text: 'Visible hint',
	},
])

/** Declares ancestors whose children do not contribute rendered prose. */
export const CAPTURE_ANCESTORS = Object.freeze([
	{
		name: 'unselected switch branch',
		html: '<svg><switch><foreignObject requiredExtensions="urn:example:unsupported" width="200" height="40"><div id="target">Omitted text</div></foreignObject><text y="20">Public label</text></switch></svg>',
		edit: '',
	},
	{
		name: 'input control',
		html: '<input value="Public label">',
		edit: 'const target=document.createElement("span");target.id="target";target.textContent="Omitted text";document.querySelector("input").append(target)',
	},
	{
		name: 'select non-option descendant',
		html: '<select><option>Public label</option></select>',
		edit: 'const target=document.createElement("span");target.id="target";target.textContent="Omitted text";document.querySelector("select").append(target)',
	},
	{
		name: 'optgroup non-option descendant',
		html: '<select><optgroup label="Public group"><option>Public label</option></optgroup></select>',
		edit: 'const target=document.createElement("span");target.id="target";target.textContent="Omitted text";document.querySelector("optgroup").append(target)',
	},
	{
		name: 'textarea control',
		html: '<textarea></textarea><p>Public label</p>',
		edit: 'const target=document.createElement("b");target.id="target";target.textContent="Omitted text";document.querySelector("textarea").append(target)',
	},
	{
		name: 'option control',
		html: '<select><option selected>Chosen label</option><option>Other label</option></select>',
		edit: 'const target=document.createElement("span");target.id="target";target.textContent="Omitted text";document.querySelector("option:last-child").append(target)',
	},
	{
		name: 'details',
		html: '<details><summary>Shown summary</summary><p id="target">Omitted text</p></details><p>Public label</p>',
		edit: '',
	},
	{
		name: 'content visibility',
		html: '<div style="content-visibility:hidden"><p id="target">Omitted text</p></div><p>Public label</p>',
		edit: '',
	},
	{
		name: 'canvas',
		html: '<canvas><p id="target">Omitted text</p></canvas><p>Public label</p>',
		edit: '',
	},
	{
		name: 'video',
		html: '<video><p id="target">Omitted text</p></video><p>Public label</p>',
		edit: '',
	},
	{
		name: 'audio',
		html: '<audio controls><p id="target">Omitted text</p></audio><p>Public label</p>',
		edit: '',
	},
	{
		name: 'unassigned child',
		html: '<div id="host"><p id="target">Omitted text</p></div><p>Public label</p>',
		edit: 'document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<slot name=other></slot>"',
	},
])

/** Installs the capture's open-shadow fixtures in either browser placement. */
export const RENDERED_SHADOW_EXPRESSION = `(() => {
	document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<div style="display:none"><slot name="hidden"></slot></div><slot name="shown"></slot><p>Shadow own text</p>'
	document.querySelector('#hidden-host').attachShadow({mode:'open'}).innerHTML = '<p id="shadow-child">Shadow child hidden</p>'
})()`

/** Supplies a path-free fault whose slash belongs to its reason rather than a filesystem path. */
export const BROWSER_STORE_FAULT_FIXTURE: BrowserStoreFault = Object.freeze({
	name: 'broken-journey',
	reason: 'The read/write mode is unsupported',
})

/**
 * Refuses scripted writes at the store boundary before delegating subsequent writes to the store.
 * @param store - The real store retaining successful writes
 * @param failures - The errors successive writes throw
 * @returns A store boundary with the scripted write failures
 */
export function createBrowserFailingJourneyStore(
	store: BrowserJourneyStoreInterface,
	failures: readonly unknown[],
): BrowserJourneyStoreInterface {
	const pending = [...failures]
	return {
		get: store.get.bind(store),
		delete: store.delete.bind(store),
		list: store.list.bind(store),
		set: async (journey, expected, options) => {
			const failure = pending.shift()
			if (failure !== undefined) throw failure
			return store.set(journey, expected, options)
		},
	}
}

/** Describes a timer call observed while evaluating a natively parsed expression. */
export interface BrowserCompiledTimer {
	readonly name: string
	readonly delay: string | undefined
}

/**
 * Parses compiled JavaScript and collects timer calls, including their actual delay argument.
 * @param expression - Compiler output
 * @returns Timer names and the values passed as their delay arguments
 */
export function readBrowserCompiledTimers(expression: string): readonly BrowserCompiledTimer[] {
	const timers: BrowserCompiledTimer[] = []
	const evaluator = new Function(
		'observer',
		'timers',
		`
		const globalThis = {}
		const MutationObserver = observer
		const listeners = []
		const document = { body: { innerText: '' }, addEventListener: (name, _handler, options) => listeners.push({ name, capture: options.capture, signal: options.signal }) }
		const requestAnimationFrame = () => 0
		const cancelAnimationFrame = () => undefined
		const clearTimeout = () => undefined
		const setTimeout = (_callback, delay) => timers.push({ name: 'setTimeout', delay: delay === undefined ? undefined : String(delay) })
		const setInterval = (_callback, delay) => timers.push({ name: 'setInterval', delay: delay === undefined ? undefined : String(delay) })
		return (${expression})
	`,
	)
	Reflect.apply(evaluator, undefined, [BrowserCompiledObserver, timers])
	return timers
}

/** Reports what a compiled wait registered, disconnected, and resolved after its deadline ran. */
export interface BrowserCompiledRun {
	readonly listeners: ReadonlyArray<{ readonly name: string; readonly capture: boolean }>
	readonly released: number
	readonly timers: readonly BrowserCompiledTimer[]
	readonly disconnects: number
	readonly result: unknown
}

/**
 * Evaluates a compiled wait, records every timer registration, and runs the first timer callback once.
 * @param expression - Compiler output resolving through its deadline
 * @returns Every registration, the observer disconnect count, and the resolved value
 */
export async function runBrowserCompiledTimers(expression: string): Promise<BrowserCompiledRun> {
	const timers: BrowserCompiledTimer[] = []
	const callbacks: Array<() => void> = []
	const counts = { disconnects: 0 }
	const listeners: Array<{
		readonly name: string
		readonly capture: boolean
		readonly signal: AbortSignal
	}> = []
	class RecordingObserver {
		observe(): void {
			return undefined
		}
		disconnect(): void {
			counts.disconnects += 1
		}
	}
	const evaluator = new Function(
		'observer',
		'timers',
		'callbacks',
		'listeners',
		`
		const globalThis = {}
		const MutationObserver = observer
		const document = { body: { innerText: '' }, addEventListener: (name, _handler, options) => listeners.push({ name, capture: options.capture, signal: options.signal }) }
		const requestAnimationFrame = () => 0
		const cancelAnimationFrame = () => undefined
		const clearTimeout = () => undefined
		const setTimeout = (callback, delay) => {
			callbacks.push(callback)
			return timers.push({ name: 'setTimeout', delay: delay === undefined ? undefined : String(delay) })
		}
		return (${expression})
	`,
	)
	const pending: unknown = Reflect.apply(evaluator, undefined, [
		RecordingObserver,
		timers,
		callbacks,
		listeners,
	])
	callbacks[0]?.()
	return {
		timers,
		disconnects: counts.disconnects,
		result: await pending,
		listeners: listeners.map(({ name, capture }) => ({ name, capture })),
		released: listeners.filter(({ signal }) => signal.aborted).length,
	}
}

/** Supplies inert observer methods to the compiler timer-argument instrument. */
export class BrowserCompiledObserver {
	observe(): void {
		return undefined
	}
	disconnect(): void {
		return undefined
	}
}

/**
 * Bounds, in whole milliseconds, how far a real host timer can end short of its duration on a
 * `performance.now()` span that opens before the timer is armed.
 *
 * @remarks
 * Node refreshes libuv's loop clock when it arms a timer, and stamps the timer with that clock
 * truncated to a whole millisecond. libuv reads `CLOCK_MONOTONIC_COARSE` when that clock ticks
 * every millisecond, so the stamp can trail the arming by under 1 ms of truncation plus under 1 ms
 * of coarse tick. The timer fires when the loop clock reaches the stamp plus the duration, so the
 * span can close up to this lead early. Synchronous work earlier in the arming macrotask does not
 * widen the shortfall, because the arming refreshes the clock. Assert a span that waits out a
 * timer of `D` milliseconds as at least `D` minus this lead.
 */
export const TIMER_LEAD = 2

/** Ignores an intentional callback invocation. */
export function ignoreCall(): void {
	return undefined
}

/** Ignores an intentional asynchronous callback invocation. */
export function ignoreAsyncCall(): Promise<void> {
	return Promise.resolve()
}

/** Throws the stable listener failure emitter containment tests use. */
export function throwListenerError(): never {
	throw new Error('listener failed')
}

/** Evaluates a JavaScript expression fixture and exposes its result as unknown. */
export function evaluateJavaScript(expression: string): unknown {
	const evaluator = new Function(`return (${expression})`)
	return Reflect.apply(evaluator, undefined, [])
}

/** Evaluates a hit compiler against inert composed-tree and sibling-tree data. */
export function evaluateBrowserHit(declaration: string): unknown {
	const evaluator = new Function(`
		class ShadowRoot { constructor(host) { this.host = host; this.nodeType = 11 } }
		const document = { nodeType: 9 }
		const element = { nodeType: 1, parentNode: document, contains: (target) => target === element }
		const shadow = new ShadowRoot(element)
		const target = { nodeType: 1, parentNode: shadow }
		const sibling = { nodeType: 1, parentNode: document }
		return [(${declaration}).call(element, target), (${declaration}).call(element, sibling)]
	`)
	return Reflect.apply(evaluator, undefined, [])
}

/**
 * Describes one inert `submit` event a submit-observer case dispatches.
 *
 * @remarks
 * - `prevented` — the event's `defaultPrevented`
 * - `form` — the form's attributes, such as `method` and `target`
 * - `submitter` — the submitter's attributes, such as `formmethod`; absent for an implicit
 *   submission, which has no submitter
 * - `base` — the `target` of the document's `base` element; absent for a document without one
 */
export interface BrowserSubmitCase {
	readonly prevented: boolean
	readonly form: Readonly<Record<string, string>>
	readonly submitter?: Readonly<Record<string, string>>
	readonly base?: string
}

/**
 * Pairs each submit-observer case, the submissions one action dispatches in order, with the
 * destinations the read reports and whether it reports a prevented submission.
 */
export const BROWSER_SUBMIT_CASES: ReadonlyArray<
	readonly [
		name: string,
		submits: readonly BrowserSubmitCase[],
		destinations: readonly string[],
		prevented: boolean,
	]
> = [
	['an implicit submission', [{ prevented: false, form: {} }], ['self'], false],
	['a prevented submission', [{ prevented: true, form: {} }], [], true],
	['a dialog form', [{ prevented: false, form: { method: 'dialog' } }], [], false],
	[
		'a dialog submitter',
		[{ prevented: false, form: {}, submitter: { formmethod: 'DIALOG' } }],
		[],
		false,
	],
	['a new-window form', [{ prevented: false, form: { target: '_blank' } }], [], false],
	[
		'a same-window submitter of a new-window form',
		[{ prevented: false, form: { target: '_blank' }, submitter: { formtarget: '_self' } }],
		['self'],
		false,
	],
	['a named-window base target', [{ prevented: false, form: {}, base: 'results' }], [], false],
	['a parent-window form', [{ prevented: false, form: { target: '_parent' } }], ['parent'], false],
	['a top-window form', [{ prevented: false, form: { target: '_TOP' } }], ['top'], false],
	[
		'a prevented submission followed by a navigating one',
		[
			{ prevented: true, form: {} },
			{ prevented: false, form: {} },
		],
		['self'],
		true,
	],
	[
		'a navigating submission followed by a prevented one',
		[
			{ prevented: false, form: {} },
			{ prevented: true, form: {} },
		],
		['self'],
		true,
	],
	[
		'three submissions to two destinations',
		[
			{ prevented: false, form: { target: '_top' } },
			{ prevented: false, form: {} },
			{ prevented: false, form: { target: '_top' } },
		],
		['top', 'self'],
		false,
	],
]

/**
 * Pairs each toolset action that can submit a form over the element fixture with its arguments,
 * its receipt's action sentence, the protocol method of its first input, and the sessions whose
 * documents it observes: the element's document for `click` and `type`, and every listed frame
 * for `press`.
 */
export const BROWSER_SUBMIT_ACTIONS = [
	['click', { ref: 'e1' }, 'Clicked e1 link "Home"', 'Input.dispatchMouseEvent', ['session-main']],
	[
		'type',
		{ ref: 'e2', text: 'sam', submit: true },
		'Typed "sam" into e2 textbox "Email" and submitted the form',
		'Input.insertText',
		['session-main'],
	],
	[
		'press',
		{ key: 'Enter' },
		'Pressed Enter',
		'Input.dispatchKeyEvent',
		['session-main', 'session-child'],
	],
] as const

/**
 * Pairs each focus arrangement of the element fixture's `main` and `child` documents with a
 * toolset action and the receipt line it returns when the observer records no submission: the
 * no-form status for `type` with `submit` and for an Enter an `input` a form owns received, and no
 * status for a click, another key, or an Enter any other element received, a focus move by that
 * element's own handler included.
 */
export const BROWSER_SUBMIT_FOCUS_STEPS: ReadonlyArray<
	readonly [
		label: string,
		main: BrowserSubmitFocus | undefined,
		child: BrowserSubmitFocus | undefined,
		tool: string,
		args: Readonly<Record<string, unknown>>,
		line: string,
	]
> = [
	[
		'a type with submit',
		undefined,
		undefined,
		'type',
		{ ref: 'e2', text: 'sam', submit: true },
		'Typed "sam" into e2 textbox "Email" and pressed Enter; no form received the submission.',
	],
	[
		'an Enter in an input a form owns',
		{ name: 'input', form: { method: 'post' } },
		undefined,
		'press',
		{ key: 'Enter' },
		'Pressed Enter; no form received the submission.',
	],
	[
		'a Tab in an input a form owns',
		{ name: 'input', form: { method: 'post' } },
		undefined,
		'press',
		{ key: 'Tab' },
		'Pressed Tab.',
	],
	[
		'a click with the focus in an input a form owns',
		{ name: 'input', form: { method: 'post' } },
		undefined,
		'click',
		{ ref: 'e1' },
		'Clicked e1 link "Home".',
	],
	[
		'an Enter in a textarea',
		{ name: 'textarea', form: { method: 'post' } },
		undefined,
		'press',
		{ key: 'Enter' },
		'Pressed Enter.',
	],
	[
		'an Enter in an input no form owns',
		{ name: 'input' },
		undefined,
		'press',
		{ key: 'Enter' },
		'Pressed Enter.',
	],
	[
		'an Enter in a framed input a form owns',
		{ name: 'iframe' },
		{ name: 'input', form: { method: 'post' } },
		'press',
		{ key: 'Enter' },
		'Pressed Enter; no form received the submission.',
	],
	[
		'an Enter in a form input whose handler focuses a textarea',
		{ name: 'input', form: { method: 'post' }, moves: { name: 'textarea', form: {} } },
		undefined,
		'press',
		{ key: 'Enter' },
		'Pressed Enter; no form received the submission.',
	],
	[
		'an Enter in a textarea whose handler focuses a form input',
		{ name: 'textarea', form: {}, moves: { name: 'input', form: { method: 'post' } } },
		undefined,
		'press',
		{ key: 'Enter' },
		'Pressed Enter.',
	],
]

/**
 * Pairs each key a real document dispatches to its focused element with whether the
 * submit observer's read reports it `implicit`: true only for an Enter an `input` a form owns
 * received, whichever element its handler focuses afterwards.
 */
export const BROWSER_SUBMIT_FOCUS_CASES: ReadonlyArray<
	readonly [name: string, focus: BrowserSubmitFocus | undefined, key: string, implicit: boolean]
> = [
	['an Enter in an input a form owns', { name: 'input', form: { method: 'post' } }, 'Enter', true],
	['an Enter in an input no form owns', { name: 'input' }, 'Enter', false],
	['an Enter in a textarea', { name: 'textarea', form: {} }, 'Enter', false],
	['an Enter on a button', { name: 'button', form: {} }, 'Enter', false],
	['a Tab in an input a form owns', { name: 'input', form: {} }, 'Tab', false],
	['an Enter with no focused element', undefined, 'Enter', false],
	[
		'an Enter in a form input whose handler focuses a textarea',
		{ name: 'input', form: {}, moves: { name: 'textarea', form: {} } },
		'Enter',
		true,
	],
	[
		'an Enter in a textarea whose handler focuses a form input',
		{ name: 'textarea', form: {}, moves: { name: 'input', form: {} } },
		'Enter',
		false,
	],
]

/**
 * Pairs each lifetime rule of a page's pending navigation request with the protocol events the
 * page session reports before a record of `frame` opens, the events after it opens, and the reason
 * the record's settlement reports: a start takes the reason of the latest request for its frame
 * and URL once, and a later request, a reload or history start, a same-document commit, and the
 * frame's removal drop it.
 */
export const BROWSER_PENDING_REQUEST_CASES: ReadonlyArray<
	readonly [
		name: string,
		frame: string,
		before: ReadonlyArray<readonly [method: string, params: Readonly<Record<string, unknown>>]>,
		after: ReadonlyArray<readonly [method: string, params: Readonly<Record<string, unknown>>]>,
		reason: string | undefined,
	]
> = [
	[
		'a start of the requested URL takes the request reason',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		'formSubmissionPost',
	],
	[
		'an unknown-reason request for the same URL replaces a form reason',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'prerenderActivation',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a second start of the same URL finds the request consumed',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-first',
					navigationType: 'differentDocument',
				},
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-second',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a reload start of the requested URL takes no reason',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-reload',
					navigationType: 'reload',
				},
			],
		],
		undefined,
	],
	[
		'a history start drops the request for the next start',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-back',
					navigationType: 'historyDifferentDocument',
				},
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a start of another URL drops the request for a later request-less start of its URL',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/other',
					loaderId: 'loader-other',
					navigationType: 'differentDocument',
				},
			],
			[
				'Page.frameNavigated',
				{ frame: { id: 'main', url: 'https://example.test/other', loaderId: 'loader-other' } },
			],
			['Page.lifecycleEvent', { frameId: 'main', loaderId: 'loader-other', name: 'load' }],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a same-document commit drops the request',
		'main',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'main',
					reason: 'formSubmissionGet',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			[
				'Page.navigatedWithinDocument',
				{ frameId: 'main', url: 'https://example.test/cart#placed', navigationType: 'fragment' },
			],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'main',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a removed frame drops its request',
		'side',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'side',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			['Page.frameDetached', { frameId: 'side', reason: 'remove' }],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'side',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
	[
		'a swapped frame keeps its request',
		'side',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'side',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			['Page.frameDetached', { frameId: 'side', reason: 'swap' }],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'side',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		'formSubmissionPost',
	],
	[
		'a frame whose target detached drops its request',
		'side',
		[
			[
				'Page.frameRequestedNavigation',
				{
					frameId: 'side',
					reason: 'formSubmissionPost',
					url: 'https://example.test/order',
					disposition: 'currentTab',
				},
			],
			['Target.detachedFromTarget', { sessionId: 'session-side', targetId: 'side' }],
		],
		[
			[
				'Page.frameStartedNavigating',
				{
					frameId: 'side',
					url: 'https://example.test/order',
					loaderId: 'loader-order',
					navigationType: 'differentDocument',
				},
			],
		],
		undefined,
	],
]

/**
 * Pairs each navigation that outruns the Enter of a `type` with `submit` before any observer read
 * with the protocol stages it starts with, the reason its request carries, and the clause the
 * receipt ends its action with: `and submitted the form` only for a form submission's reason.
 */
export const BROWSER_SUBMIT_EARLY_CASES: ReadonlyArray<
	readonly [
		name: string,
		stages: readonly BrowserNavigationStageEvent[],
		reason: string,
		clause: string,
	]
> = [
	['a form submission', ['request', 'start'], 'formSubmissionPost', 'and submitted the form'],
	['a link click', ['request', 'start'], 'anchorClick', 'and pressed Enter'],
	[
		'a navigation whose request names no reason',
		['start'],
		'formSubmissionPost',
		'and pressed Enter',
	],
]

/**
 * Pairs each ordering of a `type` with `submit` whose observer read answered no submission and a
 * `formSubmissionPost` navigation of the main frame with whether that navigation starts and loads
 * before the read answers; the navigation starts right after the read otherwise, and loads later.
 */
export const BROWSER_SUBMIT_NEGATIVE_CASES: ReadonlyArray<readonly [name: string, first: boolean]> =
	[
		['the navigation before the read answers', true],
		['the read answering before the navigation settles', false],
	]

/**
 * Pairs each outcome of a `type` with `submit` whose observer read failed with the protocol stages
 * of the main-frame navigation that followed it, the reason its request carries, the URL of the
 * view the receipt carries, and the clause the receipt ends its action with.
 */
export const BROWSER_SUBMIT_UNREAD_CASES: ReadonlyArray<
	readonly [
		name: string,
		stages: readonly BrowserNavigationStageEvent[],
		reason: string,
		url: string,
		clause: string,
	]
> = [
	[
		'a form submission followed',
		['request', 'start', 'commit', 'load'],
		'formSubmissionGet',
		'https://example.test/next',
		'and submitted the form',
	],
	[
		'a link navigation followed',
		['request', 'start', 'commit', 'load'],
		'anchorClick',
		'https://example.test/next',
		'and pressed Enter',
	],
	[
		'a navigation without a request followed',
		['start', 'commit', 'load'],
		'formSubmissionPost',
		'https://example.test/next',
		'and pressed Enter',
	],
	[
		'no navigation followed',
		[],
		'formSubmissionPost',
		'https://example.test/cart',
		'and pressed Enter',
	],
]

/**
 * Lists the read values off the submit observer read's shape that a toolset takes as an unknown
 * outcome: a missing member, a member of the wrong type, `null`, and the bare array an earlier
 * read shape answered.
 */
export const BROWSER_SUBMIT_MALFORMED_READS: ReadonlyArray<
	readonly [name: string, value: unknown]
> = [
	['a record without implicit', { destinations: [], prevented: false, submitted: false }],
	[
		'a record whose submitted is a string',
		{ destinations: [], prevented: false, submitted: 'false', implicit: false },
	],
	[
		'a record whose destinations hold a number',
		{ destinations: [1], prevented: false, submitted: false, implicit: false },
	],
	['null', null],
	['a bare array', ['self']],
]

/**
 * Pairs each session arrangement of the element fixture's `child` iframe with its fixture `local`
 * option and the session that reports the frame's navigation.
 */
export const BROWSER_CHILD_ARRANGEMENTS = [
	['out-of-process', false, 'session-child'],
	['in-process', true, 'session-main'],
] as const

/** Answers `getAttribute` over an inert attribute record, as a submit-observer form does. */
export interface BrowserSubmitFocus {
	readonly name: string
	readonly form?: Readonly<Record<string, string>>
	readonly moves?: BrowserSubmitFocus
}

/**
 * Reads the owning token a compiled submit observer or read embeds.
 * @param expression - The expression source, compiled alone or wrapped by an evaluation guard
 * @returns The token, or `undefined` when the source embeds none
 */
export function readBrowserSubmitToken(expression: string): number | undefined {
	const match = /\(\(\) => \{\n\tconst token = (-?\d+)\n/.exec(expression)
	return match === null ? undefined : Number(match[1])
}

/**
 * Checks whether an expression carries the submit observer installation for the token it embeds.
 * @param expression - The expression source, compiled alone or wrapped by an evaluation guard
 * @returns True if the source carries a compiled observer installation; false otherwise
 */
export function matchesBrowserSubmitObserver(expression: string): boolean {
	const token = readBrowserSubmitToken(expression)
	return token !== undefined && expression.includes(compileSubmitObserverExpression(token))
}

/**
 * Checks whether an expression carries the submit observer read for the token it embeds.
 * @param expression - The expression source, compiled alone or wrapped by an evaluation guard
 * @returns True if the source carries a compiled observer read; false otherwise
 */
export function matchesBrowserSubmitRead(expression: string): boolean {
	const token = readBrowserSubmitToken(expression)
	return token !== undefined && expression.includes(compileSubmitReadExpression(token))
}

// === Fake CDP transport

/** Describes one JSON-RPC frame the fake transport's `send()` recorded. */
export interface CDPSentMessage {
	readonly id: number
	readonly method: string
	readonly params: Readonly<Record<string, unknown>> | undefined
	readonly sessionId: string | undefined
}

/** Runs synchronously when the fake transport observes a matching `send()`. */
export type CDPSentHandler = (message: CDPSentMessage) => void

/**
 * Implements {@link CDPTransportInterface} in memory for tests, plus scripting hooks.
 *
 * @remarks
 * `send()` records every frame in `sent` and invokes any handler registered
 * through `onSend` for that method. Tests drive
 * server-initiated behavior with `reply` / `fail` (correlate a response by
 * id) and `event` (push a CDP event frame), or use the `onSend` hook to
 * script a response the moment a matching request arrives.
 *
 * `close()` emits `close` when the transport was started, the way the real
 * WebSocket transport reports every socket close including the one it
 * requested itself.
 *
 * `sessions` holds every flattened session the scripted peer has announced on the current
 * connection: a reply that answers a pending `Target.attachToTarget` request of that connection
 * and a `Target.attachedToTarget` event add one, and a `Target.detachedFromTarget` event removes
 * it. A success or failure reply consumes its pending request, and `close()` and `closeRemote()`
 * end the connection with every pending request and session; `sent` keeps its history.
 */
export interface CDPTestTransportInterface extends CDPTransportInterface {
	readonly sent: readonly CDPSentMessage[]
	readonly sessions: ReadonlySet<string>
	readonly started: boolean
	readonly closed: boolean
	onSend(method: string, handler: CDPSentHandler): void
	reply(id: number, result: unknown): void
	fail(id: number, message: string, code?: number): void
	event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void
	closeRemote(): void
	errorRemote(error: unknown): void
}

/** Pairs a connected client with the transport that drives it. */
export interface ConnectedCDPFixture {
	readonly client: CDPClientInterface
	readonly transport: CDPTestTransportInterface
}

/**
 * Creates a fake in-memory CDP transport for driving a real {@link CDPClient}
 * end-to-end in tests — no network, no mocks of CDPClient behavior itself.
 *
 * @returns A {@link CDPTestTransportInterface}
 */
export function createCDPTestTransport(): CDPTestTransportInterface {
	const emitter = new Emitter<CDPTransportEventMap>()
	const sent: CDPSentMessage[] = []
	const handlers = new Map<string, CDPSentHandler[]>()
	const sessions = new Set<string>()
	// The `Target.attachToTarget` requests of the current connection that no reply has answered.
	const attaching = new Set<number>()
	let started = false
	let closed = false

	return {
		emitter,
		get sent(): readonly CDPSentMessage[] {
			return sent
		},
		get sessions(): ReadonlySet<string> {
			return sessions
		},
		get started(): boolean {
			return started
		},
		get closed(): boolean {
			return closed
		},
		async start(): Promise<void> {
			started = true
			closed = false
		},
		async send(data: string): Promise<void> {
			const parsed: unknown = JSON.parse(data)
			if (!isRecord(parsed)) return

			if (!isNumber(parsed['id']) || !isString(parsed['method'])) return
			const id = parsed['id']
			const method = parsed['method']
			const params = isRecord(parsed['params']) ? parsed['params'] : undefined
			const sessionId = isString(parsed['sessionId']) ? parsed['sessionId'] : undefined
			const message: CDPSentMessage = { id, method, params, sessionId }

			sent.push(message)
			if (method === 'Target.attachToTarget' && started) attaching.add(id)

			for (const handler of handlers.get(method) ?? []) handler(message)
		},
		async close(): Promise<void> {
			const open = started
			closed = true
			started = false
			attaching.clear()
			sessions.clear()
			// The real transport reports every socket close, including the one it
			// requested itself, so a close request emits `close` exactly once.
			if (open) emitter.emit('close')
		},
		onSend(method: string, handler: CDPSentHandler): void {
			let list = handlers.get(method)
			if (list === undefined) {
				list = []
				handlers.set(method, list)
			}
			list.push(handler)
		},
		reply(id: number, result: unknown): void {
			if (attaching.delete(id) && isRecord(result) && isString(result['sessionId']))
				sessions.add(result['sessionId'])
			emitter.emit('message', JSON.stringify({ id, result }))
		},
		fail(id: number, message: string, code?: number): void {
			attaching.delete(id)
			const error = code === undefined ? { message } : { code, message }
			emitter.emit('message', JSON.stringify({ id, error }))
		},
		event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void {
			const announced = params?.['sessionId']
			if (isString(announced) && method === 'Target.attachedToTarget') sessions.add(announced)
			if (isString(announced) && method === 'Target.detachedFromTarget') sessions.delete(announced)
			const frame: Record<string, unknown> = { method, params: params ?? {} }
			if (sessionId !== undefined) frame['sessionId'] = sessionId
			emitter.emit('message', JSON.stringify(frame))
		},
		closeRemote(): void {
			attaching.clear()
			sessions.clear()
			emitter.emit('close')
		},
		errorRemote(error: unknown): void {
			emitter.emit('error', error)
		},
	}
}

/**
 * Creates and connects a real CDP client over the in-memory test transport.
 *
 * @returns The connected client and its scriptable transport
 */
export async function createConnectedCDPClient(): Promise<ConnectedCDPFixture> {
	const transport = createCDPTestTransport()
	const client = createCDPClient({ transport })
	await client.connect()
	return { client, transport }
}

/**
 * Wraps a real {@link CDPClientInterface} and records its live event registrations, so a proof can
 * show which handlers an operation adds or leaves behind; every call reaches the wrapped client.
 *
 * @remarks
 * A registration is one handler for one method on one session, or on no session; registering the
 * same handler twice holds one registration, as the client does.
 */
export class RecordingCDPClient implements CDPClientInterface {
	readonly #client: CDPClientInterface
	readonly #registrations = new Map<
		string,
		{
			readonly method: string
			readonly session: string | undefined
			readonly handlers: Set<CDPHandler>
		}
	>()

	constructor(client: CDPClientInterface) {
		this.#client = client
	}

	get emitter(): EmitterInterface<CDPClientEventMap> {
		return this.#client.emitter
	}

	get connected(): boolean {
		return this.#client.connected
	}

	connect(): Promise<void> {
		return this.#client.connect()
	}

	reconnect(): Promise<void> {
		return this.#client.reconnect()
	}

	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: CDPSendOptions,
	): Promise<unknown> {
		return this.#client.send(method, params, options)
	}

	subscribe(method: string, handler: CDPHandler, session?: string): void {
		const key = `${method} ${session ?? ''}`
		const held = this.#registrations.get(key) ?? {
			method,
			session,
			handlers: new Set<CDPHandler>(),
		}
		held.handlers.add(handler)
		this.#registrations.set(key, held)
		this.#client.subscribe(method, handler, session)
	}

	unsubscribe(method: string, handler: CDPHandler, session?: string): void {
		const key = `${method} ${session ?? ''}`
		const held = this.#registrations.get(key)
		held?.handlers.delete(handler)
		if (held?.handlers.size === 0) this.#registrations.delete(key)
		this.#client.unsubscribe(method, handler, session)
	}

	close(): Promise<void> {
		return this.#client.close()
	}

	/**
	 * Counts the live registrations, of `method` when given and on `session` when given.
	 * @param method - The CDP event to count. Default: every event
	 * @param session - The session to count on. Default: every session and none
	 * @returns The count of live handler registrations that match
	 */
	registrations(method?: string, session?: string): number {
		let count = 0
		for (const held of this.#registrations.values())
			if (
				(method === undefined || held.method === method) &&
				(session === undefined || held.session === session)
			)
				count += held.handlers.size
		return count
	}
}

/**
 * Maps each frame of the navigation record fixture to its parent: `main` frames `child` and
 * `side`, and `child` frames `nested`; `orphan` has no parent the page can name.
 */
export const BROWSER_RECORD_PARENTS: ReadonlyMap<string, string> = new Map([
	['child', 'main'],
	['side', 'main'],
	['nested', 'child'],
])

/** Holds a navigation record opened over steps a test emits, with the lifetime that ends it. */
export interface BrowserNavigationRecordFixture {
	readonly steps: Emitter<BrowserNavigationEventMap>
	readonly lifetime: AbortController
	readonly record: BrowserNavigationRecord
}

/**
 * Opens a real navigation record for `frame` over a fresh step emitter, the `main` frame, and
 * {@link BROWSER_RECORD_PARENTS}, so a test emits the steps a page would accept.
 * @param frame - The frame the record's input goes to
 * @param steps - The steps the record follows. Default: a fresh emitter
 * @returns The steps, the lifetime whose abort stands for the page closing, and the record
 */
export function openBrowserNavigationRecord(
	frame: string,
	steps: Emitter<BrowserNavigationEventMap> = new Emitter(),
): BrowserNavigationRecordFixture {
	const lifetime = new AbortController()
	const record = new BrowserNavigationRecord(
		steps,
		'main',
		BROWSER_RECORD_PARENTS.get.bind(BROWSER_RECORD_PARENTS),
		frame,
		lifetime.signal,
	)
	return { steps, lifetime, record }
}

/** Pairs a real page attached over the in-memory transport with the transport driving it. */
export interface AttachedPageFixture extends ConnectedCDPFixture {
	readonly page: BrowserPage
}

/**
 * Creates a real {@link BrowserPage} over a connected in-memory CDP client.
 *
 * @param session - Flattened CDP session id the page dispatches on
 * @returns The page, its client, and the scriptable transport
 */
export async function createAttachedPage(session = 'session-1'): Promise<AttachedPageFixture> {
	const { client, transport } = await createConnectedCDPClient()
	return { client, transport, page: new BrowserPage(client, 'target-1', session) }
}

/**
 * Creates a real {@link BrowserPage} that takes part in target discovery, as `BrowserContext`
 * constructs every page, over a connected in-memory CDP client whose attach handshake answers
 * every attach with `popup-session`.
 *
 * @param withheld - Reports a message the attach handshake leaves unanswered, for the test to answer
 * @returns The page holding `target-1` on `session-1`, its client, and the scriptable transport
 */
export async function createDiscoveringPage(
	withheld?: (message: CDPSentMessage) => boolean,
): Promise<AttachedPageFixture> {
	const { client, transport } = await createConnectedCDPClient()
	scriptCDPAttach(transport, 'popup-session', undefined, withheld)
	const page = new BrowserPage(
		client,
		'target-1',
		'session-1',
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		createReferenceSequence(),
	)
	return { client, transport, page }
}

/**
 * Reports a window a page's document opened as Chromium 141 reports it on the opener's session,
 * through `Page.windowOpen`, which names the address and no target.
 *
 * @param transport - The fake transport the opener listens on
 * @param session - The opener's session
 * @param url - The address the window opens. Default: `https://example.com/popup`
 */
export function emitBrowserWindowOpen(
	transport: CDPTestTransportInterface,
	session: string,
	url = 'https://example.com/popup',
): void {
	transport.event(
		'Page.windowOpen',
		{ url, windowName: '', windowFeatures: [], userGesture: true },
		session,
	)
}

/**
 * Creates a reference provider that numbers element references across every page it is passed to,
 * as a browser context numbers them for its pages.
 *
 * @returns A provider whose calls answer `e1`, `e2`, and so on, independent of every other provider
 * @example
 * ```ts
 * const reference = createReferenceSequence()
 * reference() // 'e1'
 * reference() // 'e2'
 * ```
 */
export function createReferenceSequence(): BrowserReferenceFunction {
	let sequence = 0
	return () => `e${++sequence}`
}

/**
 * Reads the parameter record of every frame the transport recorded for one method.
 *
 * @param transport - The fake transport to read
 * @param method - The CDP method to collect
 * @returns Each matching frame's params, in send order, with an absent record as `{}`
 */
export function readCDPParams(
	transport: CDPTestTransportInterface,
	method: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	return transport.sent
		.filter((message) => message.method === method)
		.map((message) => message.params ?? {})
}

/**
 * Lists the methods the transport recorded for one session: those sent on it and those naming it as
 * their `sessionId` parameter, such as `Target.detachFromTarget` sent through its owner.
 *
 * @param transport - The fake transport to read
 * @param session - The session to follow
 * @returns The matching methods, in send order
 */
export function readCDPSessionMethods(
	transport: CDPTestTransportInterface,
	session: string,
): readonly string[] {
	return transport.sent
		.filter((message) => message.sessionId === session || message.params?.['sessionId'] === session)
		.map((message) => message.method)
}

/**
 * Scripts an automatic success reply for the next (and every subsequent)
 * `send()` matching `method`, replying with `result`.
 *
 * @param transport - The fake transport to script
 * @param method - The CDP method to auto-reply to
 * @param result - The result value to resolve with
 */
export function replyOk(
	transport: CDPTestTransportInterface,
	method: string,
	result: unknown = {},
): void {
	transport.onSend(method, (message) => transport.reply(message.id, result))
}

/** Holds a deliberately non-document-ordered AX response including the P8 iframe. */
export const BROWSER_ELEMENT_AX_FIXTURE = Object.freeze({
	nodes: [
		{
			nodeId: 'root',
			backendDOMNodeId: 1,
			role: { value: 'RootWebArea' },
			name: { value: 'Cart' },
			childIds: [
				'heading',
				'link',
				'email',
				'gift',
				'order',
				'text',
				'none',
				'generic',
				'inline',
				'ignored',
				'iframe',
				'paragraph',
				'list',
			],
		},
		{
			nodeId: 'order',
			parentId: 'root',
			backendDOMNodeId: 7,
			role: { value: 'button' },
			name: { value: ' Place order ' },
			properties: [{ name: 'disabled', value: { value: true } }],
		},
		{
			nodeId: 'heading',
			parentId: 'root',
			backendDOMNodeId: 2,
			role: { value: 'heading' },
			name: { value: ' Your cart ' },
		},
		{
			nodeId: 'link',
			parentId: 'root',
			childIds: ['duplicate'],
			backendDOMNodeId: 3,
			role: { value: 'link' },
			name: { value: ' Home ' },
		},
		{
			nodeId: 'duplicate',
			parentId: 'link',
			backendDOMNodeId: 4,
			role: { value: 'StaticText' },
			name: { value: 'Home' },
		},
		{
			nodeId: 'email',
			parentId: 'root',
			backendDOMNodeId: 5,
			role: { value: 'textbox' },
			name: { value: 'Email' },
			value: { value: 'sam@example.test' },
		},
		{
			nodeId: 'gift',
			parentId: 'root',
			backendDOMNodeId: 6,
			role: { value: 'checkbox' },
			name: { value: 'Gift wrap' },
			properties: [{ name: 'checked', value: { value: 'true' } }],
		},
		{
			nodeId: 'text',
			parentId: 'root',
			backendDOMNodeId: 8,
			role: { value: 'StaticText' },
			name: { value: ' Two items, 48.00 total. ' },
		},
		{
			nodeId: 'none',
			parentId: 'root',
			backendDOMNodeId: 9,
			role: { value: 'none' },
			name: { value: 'omit none' },
		},
		{
			nodeId: 'generic',
			parentId: 'root',
			backendDOMNodeId: 10,
			role: { value: 'generic' },
			name: { value: 'omit generic' },
		},
		{
			nodeId: 'inline',
			parentId: 'root',
			backendDOMNodeId: 11,
			role: { value: 'InlineTextBox' },
			name: { value: 'omit inline' },
		},
		{
			nodeId: 'ignored',
			parentId: 'root',
			backendDOMNodeId: 12,
			ignored: true,
			role: { value: 'button' },
			name: { value: 'omit ignored' },
		},
		{
			nodeId: 'iframe',
			parentId: 'root',
			backendDOMNodeId: 13,
			role: { value: 'Iframe' },
			name: { value: 'Checkout' },
		},
		{
			nodeId: 'paragraph',
			parentId: 'root',
			backendDOMNodeId: 14,
			role: { value: 'paragraph' },
			childIds: ['paragraph-text'],
		},
		{
			nodeId: 'paragraph-text',
			parentId: 'paragraph',
			backendDOMNodeId: 15,
			role: { value: 'StaticText' },
			name: { value: 'Delivery included.' },
		},
		{
			nodeId: 'list',
			parentId: 'root',
			backendDOMNodeId: 16,
			role: { value: 'list' },
			childIds: ['listitem'],
		},
		{
			nodeId: 'listitem',
			parentId: 'list',
			backendDOMNodeId: 17,
			role: { value: 'listitem' },
			childIds: ['marker'],
		},
		{
			nodeId: 'marker',
			parentId: 'listitem',
			backendDOMNodeId: 18,
			role: { value: 'ListMarker' },
			name: { value: '•' },
		},
	],
})

/** Lists accessible names that distinguish exact matching from substring and folded matching. */
export const BROWSER_ELEMENT_NAME_FIXTURE = Object.freeze([
	'Save',
	'save',
	'Save draft',
	'Save   draft',
])

/** Holds the protocol names used to prove exact accessibility queries. */
export const BROWSER_ELEMENT_NAME_AX_FIXTURE = Object.freeze({
	nodes: BROWSER_ELEMENT_NAME_FIXTURE.map((name, index) => ({
		nodeId: String(index),
		backendDOMNodeId: index + 100,
		role: { value: 'button' },
		name: { value: name },
	})),
})

/** Describes one outline node a fixture builds: its role, its name, and its optional state. */
export interface BrowserOutlineNodeFixture {
	readonly role: string
	readonly name: string
	readonly reference?: string
	readonly ignored?: boolean
	readonly properties?: Readonly<Record<string, unknown>>
}

/**
 * Builds main-session outline nodes in the given order, each identified by its position.
 *
 * @param rows - The role, name, reference, ignored flag, and properties of each node
 * @returns One `BrowserOutlineNode` per row, unreferenced and not ignored unless the row says so
 */
export function createBrowserOutlineNodes(
	rows: readonly BrowserOutlineNodeFixture[],
): readonly BrowserOutlineNode[] {
	return rows.map((row, index) => ({
		id: String(index + 1),
		parent: undefined,
		children: [],
		backend: index + 1,
		frame: 'main',
		ignored: row.ignored ?? false,
		role: row.role,
		name: row.name,
		description: undefined,
		value: undefined,
		properties: row.properties ?? {},
		session: 'main',
		reference: row.reference,
	}))
}

/**
 * Builds an accessibility tree of a `RootWebArea` named `Shop` over `count` buttons named
 * `Button N`, where N counts from 1, with an optional node carrying the `focused` property.
 *
 * @param count - The number of buttons
 * @param focused - The node id that carries `focused`: `root`, or `button-N`. Default: none
 * @returns The `Accessibility.getFullAXTree` result
 */
export function buildBrowserButtonTree(
	count: number,
	focused?: string,
): { readonly nodes: ReadonlyArray<Readonly<Record<string, unknown>>> } {
	const buttons = Array.from({ length: count }, (_, index) => `button-${index + 1}`)
	const focus = [{ name: 'focused', value: { type: 'boolean', value: true } }]
	return {
		nodes: [
			{
				nodeId: 'root',
				backendDOMNodeId: 1,
				role: { value: 'RootWebArea' },
				name: { value: 'Shop' },
				childIds: buttons,
				...(focused === 'root' ? { properties: focus } : {}),
			},
			...buttons.map((id, index) => ({
				nodeId: id,
				parentId: 'root',
				backendDOMNodeId: index + 2,
				role: { value: 'button' },
				name: { value: `Button ${index + 1}` },
				...(focused === id ? { properties: focus } : {}),
			})),
		],
	}
}

/** Describes one page of a `look` or `read` result: its body and the range its footer names. */
export interface BrowserPageFixture {
	readonly body: string
	readonly start: number
	readonly end: number
	readonly total: number
	readonly next: number | undefined
}

/**
 * Extracts the body and the footer's range from one page of a `look` or `read` result.
 *
 * @param result - The tool's result text
 * @returns The body before the footer, the footer's start, end, and total, and the offset the
 * footer names for the next page; a result with no footer reads as the whole text from 0 with no
 * next offset
 */
export function extractBrowserPage(result: string): BrowserPageFixture {
	const footer = /\n\[lines (\d+)–(\d+) of (\d+);[^\]]*\]$/.exec(result)
	if (footer === null)
		return { body: result, start: 0, end: result.length, total: result.length, next: undefined }
	return {
		body: [...result.matchAll(/^\d+: (.*)$/gm)].map((match) => match[1]).join('\n'),
		start: Number(footer[1]),
		end: Number(footer[2]),
		total: Number(footer[3]),
		next: /call read with from (\d+)/.test(footer[0])
			? Number(/call read with from (\d+)/.exec(footer[0])?.[1])
			: undefined,
	}
}

/** Holds query expectations shared by the remote and DOM element managers. */
export const BROWSER_ELEMENT_NAME_CASES: ReadonlyArray<{
	readonly title: string
	readonly query: BrowserElementQuery
	readonly expected: readonly string[]
}> = Object.freeze([
	{
		title: 'exact names reject substrings',
		query: { role: 'button', name: 'Save', exact: true },
		expected: ['Save'],
	},
	{
		title: 'exact names preserve case',
		query: { role: 'button', name: 'save', exact: true },
		expected: ['save'],
	},
	{
		title: 'normalizes whitespace on both sides when exact is true',
		query: { role: 'button', name: '  Save\n draft  ', exact: true },
		expected: ['Save draft', 'Save draft'],
	},
	{
		title: 'rejects a partial name when exact is true',
		query: { role: 'button', name: 'Sav', exact: true },
		expected: [],
	},
	{
		title: 'keeps case-insensitive substring matching by default',
		query: { role: 'button', name: 'Save' },
		expected: ['Save', 'save', 'Save draft', 'Save draft'],
	},
	{
		title: 'keeps case-insensitive substring matching when exact is false',
		query: { role: 'button', name: 'Save', exact: false },
		expected: ['Save', 'save', 'Save draft', 'Save draft'],
	},
	{
		title: 'keeps role matching without a name when exact is true',
		query: { role: 'button', exact: true },
		expected: ['Save', 'save', 'Save draft', 'Save draft'],
	},
])

/** Holds the iframe tree whose backend overlaps the parent renderer's link. */
export const BROWSER_ELEMENT_CHILD_FIXTURE = Object.freeze({
	nodes: [
		{
			nodeId: 'child-root',
			backendDOMNodeId: 20,
			role: { value: 'RootWebArea' },
			childIds: ['save'],
		},
		{
			nodeId: 'save',
			parentId: 'child-root',
			backendDOMNodeId: 3,
			role: { value: 'button' },
			name: { value: ' Save ' },
		},
	],
})

/**
 * Holds the iframe tree of an in-process `child` frame, whose backends the page's renderer assigns
 * apart from the main document's: a `Save` button on backend `23`.
 */
export const BROWSER_ELEMENT_FRAMED_FIXTURE = Object.freeze({
	nodes: [
		{
			nodeId: 'framed-root',
			backendDOMNodeId: 22,
			role: { value: 'RootWebArea' },
			childIds: ['framed-save'],
		},
		{
			nodeId: 'framed-save',
			parentId: 'framed-root',
			backendDOMNodeId: 23,
			role: { value: 'button' },
			name: { value: ' Save ' },
		},
	],
})

/** Holds the iframe tree after its form submitted: a document whose heading reads `Voucher applied`. */
export const BROWSER_ELEMENT_APPLIED_FIXTURE = Object.freeze({
	nodes: [
		{
			nodeId: 'applied-root',
			backendDOMNodeId: 30,
			role: { value: 'RootWebArea' },
			childIds: ['applied'],
		},
		{
			nodeId: 'applied',
			parentId: 'applied-root',
			backendDOMNodeId: 31,
			role: { value: 'heading' },
			name: { value: 'Voucher applied' },
		},
	],
})

/** Maps each frame of the element fixture to the isolated-world context its page creates for it. */
export const BROWSER_ELEMENT_WORLDS: Readonly<Record<string, number>> = Object.freeze({
	main: 91,
	child: 92,
	nested: 93,
	late: 94,
})

/** Configures protocol responses for discriminating element action tests. */
export interface BrowserElementFixtureOptions {
	readonly local?: boolean
	readonly held?: boolean
	readonly nested?: boolean
	readonly roots?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
	readonly tree?: CDPSentHandler
	readonly observe?: CDPSentHandler
	readonly loaderless?: boolean
	readonly readiness?: CDPSentHandler
	readonly world?: CDPSentHandler
	readonly title?: CDPSentHandler
	readonly document?: CDPSentHandler
	readonly query?: CDPSentHandler
	readonly describe?: CDPSentHandler
	readonly resolve?: CDPSentHandler
	readonly metrics?: Readonly<Record<string, unknown>>
	readonly failure?: { readonly method: string; readonly message: string }
	readonly accessibility?: CDPSentHandler
	readonly hidden?: boolean
	readonly covered?: boolean
	readonly gone?: boolean
	readonly actionability?: string
	readonly pressed?: () => void
	readonly released?: CDPSentHandler
	readonly select?: CDPSentHandler
	readonly text?: CDPSentHandler
	readonly insert?: CDPSentHandler
	readonly registry?: CDPSentHandler
	readonly evaluation?: CDPSentHandler
	readonly submit?: CDPSentHandler
}

/**
 * Scripts accessibility, DOM, isolated-world, and trusted-input replies without replacing project behavior.
 * @remarks
 * `WebMCP.enable` fails with the method-not-found code `-32601`, as Chromium 141 answers, unless
 * `registry` answers it. `released` answers a `mouseReleased` dispatch in place of the reply,
 * `select` answers the select-option function call, and `text` answers the text-selection
 * function call, and `insert` answers `Input.insertText`, so a test can withhold or refuse any
 * of them. `observe` and `submit` can withhold or refuse their protocol replies; submission behavior
 * is proved in real browser documents. `nested` adds a `nested` frame inside `child` to the frame tree. `roots` names
 * the root frame a session's `Page.getFrameTree` answers with in place of the page tree, unless
 * `tree` answers every frame tree read.
 * @param transport - In-memory CDP boundary
 * @param options - Deliberate protocol refusal or observation
 */
export function scriptBrowserElements(
	transport: CDPTestTransportInterface,
	options?: BrowserElementFixtureOptions,
): void {
	replyOk(transport, 'Accessibility.enable')
	replyOk(transport, 'Runtime.releaseObject')
	for (const method of ['Page.bringToFront', 'DOM.focus', 'DOM.scrollIntoViewIfNeeded'])
		transport.onSend(method, (message) => {
			if (options?.failure?.method === method) transport.fail(message.id, options.failure.message)
			else transport.reply(message.id, {})
		})
	replyOk(
		transport,
		'Page.getLayoutMetrics',
		options?.metrics ?? { cssLayoutViewport: { pageX: 0, pageY: 0 } },
	)
	transport.onSend('DOM.getBoxModel', (message) => {
		if (options?.failure?.method === message.method)
			transport.fail(message.id, options.failure.message)
		else
			transport.reply(message.id, {
				model: {
					border: [220, 160, 420, 160, 420, 360, 220, 360],
					content: [230, 170, 410, 170, 410, 350, 230, 350],
				},
			})
	})
	replyOk(transport, 'DOM.setFileInputFiles')
	transport.onSend('Input.insertText', (message) => {
		if (options?.insert !== undefined) options.insert(message)
		else transport.reply(message.id, {})
	})
	transport.onSend('Input.dispatchKeyEvent', (message) => {
		transport.reply(message.id, {})
	})
	replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Page.setLifecycleEventsEnabled')
	replyOk(transport, 'Target.setAutoAttach')
	replyOk(transport, 'Runtime.runIfWaitingForDebugger')
	transport.onSend('Page.getFrameTree', (message) => {
		if (options?.tree !== undefined) {
			options.tree(message)
			return
		}
		const root =
			message.sessionId === undefined ? undefined : options?.roots?.get(message.sessionId)
		transport.reply(
			message.id,
			root === undefined ? buildBrowserElementTree(options) : { frameTree: { frame: root } },
		)
	})
	transport.onSend('Page.createIsolatedWorld', (message) => {
		if (options?.world !== undefined) options.world(message)
		else
			transport.reply(message.id, {
				executionContextId: BROWSER_ELEMENT_WORLDS[String(message.params?.['frameId'])] ?? 91,
			})
	})
	transport.onSend('Accessibility.getFullAXTree', (message) => {
		if (options?.accessibility !== undefined) options.accessibility(message)
		else
			transport.reply(
				message.id,
				message.params?.['frameId'] === 'child'
					? BROWSER_ELEMENT_CHILD_FIXTURE
					: BROWSER_ELEMENT_AX_FIXTURE,
			)
	})
	transport.onSend('DOM.describeNode', (message) => {
		if (options?.describe !== undefined) {
			options.describe(message)
			return
		}
		transport.reply(message.id, {
			node:
				message.params?.['backendNodeId'] === 13
					? { backendNodeId: 13, frameId: 'child' }
					: message.params?.['backendNodeId'] === 99
						? { backendNodeId: 99, nodeName: 'DIV', attributes: ['id', 'overlay'] }
						: { backendNodeId: 7 },
		})
	})
	transport.onSend('DOM.getDocument', (message) => {
		if (options?.document !== undefined) options.document(message)
		else transport.reply(message.id, { root: { nodeId: 1 } })
	})
	replyOk(transport, 'DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [1] })
	transport.onSend('DOM.querySelectorAll', (message) => {
		if (options?.query !== undefined) options.query(message)
		else transport.reply(message.id, { nodeIds: [50] })
	})
	transport.onSend('DOM.resolveNode', (message) => {
		if (options?.resolve !== undefined) options.resolve(message)
		else if (options?.gone === true) transport.fail(message.id, 'No node with given id found')
		else
			transport.reply(message.id, {
				object: { objectId: `object-${message.params?.['backendNodeId']}` },
			})
	})
	transport.onSend('DOM.getContentQuads', (message) => {
		if (options?.failure?.method === message.method) {
			transport.fail(message.id, options.failure.message)
			return
		}
		transport.reply(message.id, {
			quads:
				options?.hidden === true
					? []
					: message.params?.['backendNodeId'] === 13
						? [[220, 160, 420, 160, 420, 360, 220, 360]]
						: message.params?.['backendNodeId'] === 23
							? [[300, 240, 340, 240, 340, 280, 300, 280]]
							: [[10, 20, 30, 20, 30, 40, 10, 40]],
		})
	})
	transport.onSend('DOM.getNodeForLocation', (message) =>
		transport.reply(message.id, {
			backendNodeId:
				options?.covered === true
					? 99
					: message.sessionId === 'session-child'
						? 3
						: message.params?.['x'] === 250
							? 13
							: message.params?.['x'] === 320
								? 23
								: 3,
			frameId:
				message.sessionId === 'session-child' || message.params?.['x'] === 320 ? 'child' : 'main',
		}),
	)
	transport.onSend('WebMCP.enable', (message) => {
		if (options?.registry !== undefined) options.registry(message)
		else transport.fail(message.id, "'WebMCP.enable' wasn't found", -32601)
	})
	transport.onSend('Input.dispatchMouseEvent', (message) => {
		if (message.params?.['type'] === 'mousePressed') options?.pressed?.()
		if (message.params?.['type'] === 'mouseReleased' && options?.released !== undefined)
			options.released(message)
		else transport.reply(message.id, {})
	})
	transport.onSend('Runtime.callFunctionOn', (message) => {
		const declaration = message.params?.['functionDeclaration']
		if (
			options?.select !== undefined &&
			isString(declaration) &&
			declaration.includes('HTMLSelectElement')
		) {
			options.select(message)
			return
		}
		if (
			options?.text !== undefined &&
			isString(declaration) &&
			declaration.includes('this.select()')
		) {
			options.text(message)
			return
		}
		if (isString(declaration) && declaration.includes(compileReadFunction())) {
			transport.reply(message.id, {
				result: {
					value: { url: 'https://example.test/cart', title: 'Cart', html: '<button>Save</button>' },
				},
			})
			return
		}
		if (
			options?.actionability !== undefined &&
			isString(declaration) &&
			declaration.includes('requestAnimationFrame')
		) {
			transport.reply(message.id, {
				exceptionDetails: { exception: { description: options.actionability } },
			})
		} else
			transport.reply(message.id, {
				result: {
					value: !(
						options?.covered === true &&
						isString(declaration) &&
						declaration.includes('function(target)')
					),
				},
			})
	})
	transport.onSend('Runtime.evaluate', (message) => {
		const expression = message.params?.['expression']
		if (expression === 'document.readyState') {
			if (options?.readiness !== undefined) options.readiness(message)
			else transport.reply(message.id, { result: { value: 'complete' } })
		} else if (expression === 'document.title') {
			if (options?.title !== undefined) options.title(message)
			else transport.reply(message.id, { result: { value: 'Cart' } })
		} else if (isString(expression) && matchesBrowserSubmitRead(expression)) {
			if (options?.submit !== undefined) options.submit(message)
			else transport.reply(message.id, { result: { value: null } })
		} else if (isString(expression) && matchesBrowserSubmitObserver(expression)) {
			if (options?.observe !== undefined) options.observe(message)
			else transport.reply(message.id, { result: { value: null } })
		} else if (options?.evaluation !== undefined) options.evaluation(message)
		else transport.reply(message.id, { result: { value: true } })
	})
}

/**
 * Builds the element fixture's page frame tree: `main` framing `child`, which frames `nested` when
 * the `nested` option is `true`.
 * @param options - The fixture options whose `nested` switch the tree reads
 * @returns The `Page.getFrameTree` result
 */
export function buildBrowserElementTree(options?: BrowserElementFixtureOptions): unknown {
	return {
		frameTree: {
			frame: { id: 'main', url: 'https://example.test/cart' },
			childFrames: [
				{
					frame: { id: 'child', parentId: 'main', url: 'https://example.test/checkout' },
					...(options?.nested === true
						? {
								childFrames: [
									{
										frame: { id: 'nested', parentId: 'child', url: 'https://example.test/coupon' },
									},
								],
							}
						: {}),
				},
			],
		},
	}
}

/**
 * Pairs each session move of the element fixture's `child` iframe during its navigation with the
 * fixture `local` option, the session that reports the start, and the session that reports the
 * commit and the load.
 */
export const BROWSER_SESSION_MOVES = [
	['into a new out-of-process target', true, 'session-main', 'session-swap'],
	['back into the page process', false, 'session-child', 'session-main'],
] as const

/**
 * Names each protocol stage of one frame navigation that {@link emitBrowserNavigation} emits.
 */
export type BrowserNavigationStageEvent = 'request' | 'start' | 'commit' | 'load'

/**
 * Emits the protocol events of one frame navigation on a session, in order: the request in the
 * current tab, the start with its loader, the commit, and the lifecycle `DOMContentLoaded` and
 * `load` of the committed loader, as Chromium 141 reports each on the session that owns the frame.
 * @param transport - The fake transport the page listens on
 * @param session - The session that reports the events
 * @param frame - The navigating frame's id
 * @param url - The navigation's destination
 * @param loader - The navigation's loader id
 * @param stages - The events to emit. Default: `request`, `start`, `commit`, and `load`
 * @param reason - The `reason` the request carries, any string the protocol could send. Default:
 * `formSubmissionPost`
 */
export function emitBrowserNavigation(
	transport: CDPTestTransportInterface,
	session: string,
	frame: string,
	url: string,
	loader: string,
	stages: readonly BrowserNavigationStageEvent[] = ['request', 'start', 'commit', 'load'],
	reason = 'formSubmissionPost',
): void {
	if (stages.includes('request'))
		transport.event(
			'Page.frameRequestedNavigation',
			{ frameId: frame, reason, url, disposition: 'currentTab' },
			session,
		)
	if (stages.includes('start'))
		transport.event(
			'Page.frameStartedNavigating',
			{ frameId: frame, url, loaderId: loader, navigationType: 'differentDocument' },
			session,
		)
	if (stages.includes('commit'))
		transport.event('Page.frameNavigated', { frame: { id: frame, url, loaderId: loader } }, session)
	if (!stages.includes('load')) return
	for (const name of ['DOMContentLoaded', 'load'])
		transport.event('Page.lifecycleEvent', { frameId: frame, loaderId: loader, name }, session)
}

/**
 * Attaches the fixture's `child` iframe as its own target on `session-child`, as Chromium attaches
 * an out-of-process frame with the `main` frame as its parent, and waits for the page to announce
 * the frame's session.
 * @param transport - The fake transport the page listens on
 * @param page - The page the frame belongs to
 */
export async function attachBrowserElementChild(
	transport: CDPTestTransportInterface,
	page: BrowserPage,
): Promise<void> {
	const attached = waitForEvent<readonly [BrowserFrameInterface]>((handler) => {
		page.emitter.on('session', handler)
		return () => page.emitter.off('session', handler)
	}, 'element iframe session')
	transport.event(
		'Target.attachedToTarget',
		{
			sessionId: 'session-child',
			targetInfo: {
				targetId: 'child',
				type: 'iframe',
				url: 'https://example.test/checkout',
				parentFrameId: 'main',
			},
		},
		'session-main',
	)
	await attached
}

/**
 * Holds the element fixture's page with the submit-observer windows its evaluations run in and
 * the recording client the page runs over.
 */
export interface BrowserElementFixture extends AttachedPageFixture {
	readonly recording: RecordingCDPClient
}

/**
 * Creates a page with a committed, DOM-ready document and scripted accessibility and DOM replies.
 * @remarks The `child` iframe attaches as its own target unless `local` is `true`, which keeps it
 * in the page's process on `session-main`. The page runs over the {@link RecordingCDPClient} the
 * fixture's `recording` holds, so a proof can count the registrations an operation leaves. With
 * `held`, the page takes part in target discovery, as `BrowserContext` constructs every page, so it
 * counts the `Page.windowOpen` reports its popup records follow.
 */
export async function createBrowserElementFixture(
	options?: BrowserElementFixtureOptions,
): Promise<BrowserElementFixture> {
	const { client, transport } = await createConnectedCDPClient()
	scriptBrowserElements(transport, options)
	const recording = new RecordingCDPClient(client)
	if (options?.held === true) replyOk(transport, 'Target.setDiscoverTargets')
	const page = new BrowserPage(
		recording,
		'main',
		'session-main',
		undefined,
		'https://example.test/cart',
		undefined,
		undefined,
		undefined,
		undefined,
		options?.held === true ? createReferenceSequence() : undefined,
	)
	if (options?.local !== true) await attachBrowserElementChild(transport, page)
	if (options?.loaderless === true) return { client, transport, page, recording }
	transport.event(
		'Page.frameNavigated',
		{ frame: { id: 'main', url: page.url, loaderId: 'loader-main' } },
		'session-main',
	)
	transport.event(
		'Page.lifecycleEvent',
		{ frameId: 'main', loaderId: 'loader-main', name: 'DOMContentLoaded' },
		'session-main',
	)
	return { client, transport, page, recording }
}

/**
 * Creates a protocol fixture whose main-frame click opens a popup before the input reply.
 * @returns The opener, transport, and client driving the popup's attachment and settlement
 */
export async function createBrowserPopupFixture(): Promise<BrowserElementFixture> {
	const fixture = await createBrowserElementFixture({
		held: true,
		roots: new Map([['popup-session', { id: 'popup-1', url: 'https://example.test/popup' }]]),
		title: (message) =>
			fixture.transport.reply(message.id, {
				result: { value: message.sessionId === 'popup-session' ? 'Details' : 'Cart' },
			}),
		released: (message) => {
			emitBrowserWindowOpen(fixture.transport, 'session-main', 'https://example.test/popup')
			fixture.transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'popup-session',
					targetInfo: {
						targetId: 'popup-1',
						type: 'page',
						url: 'https://example.test/popup',
					},
				},
				'session-main',
			)
			fixture.transport.reply(message.id, {})
		},
	})
	for (const method of [
		'Page.setInterceptFileChooserDialog',
		'Network.enable',
		'Network.disable',
		'Target.detachFromTarget',
	])
		replyOk(fixture.transport, method)
	return fixture
}

/**
 * Emits a committed main-frame document and its `DOMContentLoaded`, so a page's readiness wait
 * resolves without the `document.readyState` seed.
 * @param transport - The fake transport the page listens on
 * @param page - The page whose main frame becomes ready at its current URL
 * @param session - The page's session
 */
export function emitDocumentReady(
	transport: CDPTestTransportInterface,
	page: BrowserPage,
	session = 'session-1',
): void {
	transport.event(
		'Page.frameNavigated',
		{ frame: { id: page.id, url: page.url, loaderId: 'loader-ready' } },
		session,
	)
	transport.event(
		'Page.lifecycleEvent',
		{ frameId: page.id, loaderId: 'loader-ready', name: 'DOMContentLoaded' },
		session,
	)
}

/**
 * Configures the scripted results of a {@link BrowserViewDouble}.
 * @remarks
 * `url`, `title`, and `html` describe the document the view reads; `waited` is `false` to make
 * every text wait reject coded `BROWSER_WAIT_TIMEOUT`.
 */
export interface BrowserViewDoubleOptions {
	readonly url?: string
	readonly title?: string
	readonly html?: string
	readonly waited?: boolean
}

/** Holds native journey calls whose service receipts are compared on independently reset pages. */
export const BROWSER_JOURNEY_SERVICE_CASES = Object.freeze([
	{
		name: 'click',
		route: '/form',
		action: 'click',
		arguments: {},
		target: { role: 'button', name: 'Save draft' },
	},
	{
		name: 'type',
		route: '/form',
		action: 'type',
		arguments: { text: 'Grace Hopper' },
		target: { role: 'textbox', name: 'Name' },
	},
	{
		name: 'submitted form',
		route: '/form',
		action: 'type',
		arguments: { text: 'Grace Hopper', submit: true },
		target: { role: 'textbox', name: 'Name' },
	},
	{
		name: 'delayed child submission',
		route: '/frame/local',
		action: 'type',
		arguments: { text: 'SPRING', submit: true },
		target: { role: 'textbox', name: 'Code' },
	},
	{ name: 'press', route: '/form', action: 'press', arguments: { key: 'Escape' } },
	{ name: 'navigate', route: '/form', action: 'navigate', arguments: { url: '/shop' } },
	{ name: 'wait', route: '/form', action: 'wait', arguments: { text: 'Delivery form' } },
] as const)

/**
 * Creates the one-step journey that replays a {@link BROWSER_JOURNEY_SERVICE_CASES} row, named
 * for the row, with a `navigate` path resolved to the absolute URL the tool requires.
 * @param scenario - The row whose action, arguments, and target the step carries
 * @param resolve - Returns the absolute URL the fixture server answers for a path
 * @returns The journey whose one step is `s1`
 */
export function createBrowserJourneyServiceJourney(
	scenario: (typeof BROWSER_JOURNEY_SERVICE_CASES)[number],
	resolve: (path: string) => string,
): BrowserJourney {
	return createBrowserJourneyFixture(
		[
			{
				action: scenario.action,
				arguments:
					scenario.action === 'navigate'
						? { url: resolve(scenario.arguments.url) }
						: { ...scenario.arguments },
				...('target' in scenario ? { target: { ...scenario.target } } : {}),
			},
		],
		{ name: scenario.name.replaceAll(' ', '-'), description: `Perform the ${scenario.name} step` },
	)
}

/**
 * Describes a native journey whose replay the claim 5 proof compares step by step with direct
 * `tools.execute` calls, each over a toolset given the context of a fresh page.
 *
 * @remarks
 * - `route` — the fixture path the context opens first
 * - `tabs` — the fixture paths the context opens after `route`, in order
 * - `steps` — the journey's steps, each `tab` URL a fixture path
 * - `calls` — each step's direct arguments, which also take the target's reference as `ref` when
 *   the step names a target
 * - `outcomes` — the outcome of each step's action
 */
export interface BrowserJourneySequenceCase {
	readonly name: string
	readonly route: string
	readonly tabs: readonly string[]
	readonly steps: readonly BrowserJourneyStepInput[]
	readonly calls: ReadonlyArray<Readonly<Record<string, JSONValue>>>
	readonly outcomes: ReadonlyArray<BrowserAction['outcome']>
}

/**
 * Holds the native journeys whose replay and direct calls the claim 5 proof compares step by step:
 * a click the `/confirm` route's confirm dialog interrupts followed by the `dialog` step that
 * accepts it, and a `switch` to the `/popup/child` tab titled `Details`.
 */
export const BROWSER_JOURNEY_SEQUENCE_CASES: readonly BrowserJourneySequenceCase[] = Object.freeze([
	{
		name: 'interrupted click and its dialog',
		route: '/confirm',
		tabs: [],
		steps: [
			{ action: 'click', arguments: {}, target: { role: 'button', name: 'Delete' } },
			{ action: 'dialog', arguments: { accept: true } },
		],
		calls: [{}, { accept: true }],
		outcomes: ['interrupted', 'done'],
	},
	{
		name: 'switch with a context',
		route: '/popup',
		tabs: ['/popup/child'],
		steps: [{ action: 'switch', arguments: {}, tab: { url: '/popup/child', title: 'Details' } }],
		calls: [{ tab: 't2' }],
		outcomes: ['done'],
	},
])

/**
 * Creates the journey that replays a {@link BROWSER_JOURNEY_SEQUENCE_CASES} row, named for the row,
 * with each `tab` path resolved to the absolute URL the `tabs` tool lists.
 * @param scenario - The row whose steps the journey carries
 * @param resolve - Returns the absolute URL the fixture server answers for a path
 * @returns The journey whose steps are `s1` onward
 */
export function createBrowserJourneySequenceJourney(
	scenario: BrowserJourneySequenceCase,
	resolve: (path: string) => string,
): BrowserJourney {
	return createBrowserJourneyFixture(
		scenario.steps.map((step) =>
			step.tab === undefined ? step : { ...step, tab: { ...step.tab, url: resolve(step.tab.url) } },
		),
		{ name: scenario.name.replaceAll(' ', '-'), description: `Perform the ${scenario.name}` },
	)
}

/** Holds an editable combobox whose suggestion remains a text input. */
export const BROWSER_JOURNEY_COMBOBOX_HTML =
	'<label>Destination <input list="places"></label><datalist id="places"><option value="Harbor"></datalist>'

/**
 * Holds the `/popup` route's `main` with a link that opens `/popup/child` in a new tab through
 * `target="_blank"`.
 */
export const BROWSER_JOURNEY_POPUP_LINK_HTML =
	'<h1>Catalog</h1><a href="/popup/child" target="_blank">Open details</a>'

/** Holds a same-origin child document whose button records its input. */
export const BROWSER_JOURNEY_FRAME_HTML =
	'<button onclick="document.body.dataset.clicked = \'yes\'">Save in frame</button>'

/** Holds the one-step journey that clicks the {@link BROWSER_JOURNEY_FRAME_HTML} button by name. */
export const BROWSER_JOURNEY_FRAME_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save in frame' } }],
	{ name: 'save-in-frame', description: 'Save inside the child frame' },
)

/** Records an element's operations into its view double's call list. */
export class BrowserElementDouble implements BrowserElementInterface {
	readonly #reference: string
	readonly #role: string
	readonly #name: string
	readonly #calls: string[]

	constructor(reference: string, role: string, name: string, calls: string[]) {
		this.#reference = reference
		this.#role = role
		this.#name = name
		this.#calls = calls
	}

	get reference(): string {
		return this.#reference
	}

	get role(): string {
		return this.#role
	}

	get name(): string {
		return this.#name
	}

	async click(options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`click ${this.#reference}`)
	}

	async fill(value: string, options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`fill ${this.#reference} ${value}`)
	}

	async select(values: readonly string[], options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		if (this.#role !== 'combobox') throw new BrowserError('Element is not a select control')
		this.#calls.push(`select ${this.#reference} ${values.join(',')}`)
	}

	async focus(options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`focus ${this.#reference}`)
	}

	async submit(options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`submit ${this.#reference}`)
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`read ${this.#reference}`)
		return createBrowserReading({
			url: 'https://example.test/form',
			title: 'Form',
			html: `<p>${this.#name}</p>`,
		})
	}
}

/** Serves a fixed outline over three element doubles and records every operation. */
export class BrowserElementManagerDouble implements BrowserElementManagerInterface {
	readonly #url: string
	readonly #title: string
	readonly #calls: string[]
	readonly #elements: readonly BrowserElementDouble[]

	constructor(url: string, title: string, calls: string[]) {
		this.#url = url
		this.#title = title
		this.#calls = calls
		this.#elements = [
			new BrowserElementDouble('e1', 'button', 'Save', calls),
			new BrowserElementDouble('e2', 'textbox', 'Email', calls),
			new BrowserElementDouble('e3', 'combobox', 'Size', calls),
		]
	}

	async outline(options?: BrowserOutlineOptions): Promise<BrowserOutline> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`outline${options?.within === undefined ? '' : ` ${options.within}`}`)
		return {
			url: this.#url,
			title: this.#title,
			lines: this.#elements.map((element) => ({
				spans: [
					{
						category: 'text',
						text: `${element.reference} ${element.role} ${JSON.stringify(element.name)}`,
					},
				],
			})),
			count: this.#elements.length,
			total: this.#elements.length,
			focus: undefined,
		}
	}

	async find(): Promise<readonly BrowserElementInterface[]> {
		return this.#elements
	}

	async wait(): Promise<readonly BrowserElementInterface[]> {
		return this.#elements
	}

	element(reference: string): BrowserElementInterface | undefined {
		return this.#elements.find((element) => element.reference === reference)
	}

	elements(): readonly BrowserElementInterface[] {
		return this.#elements
	}

	clear(): void {
		this.#calls.push('clear')
	}
}

/**
 * Implements {@link BrowserViewInterface} over scripted outline, reading, and wait results, with
 * no page and no protocol session, and records every operation in `calls`.
 */
export class BrowserViewDouble implements BrowserViewInterface {
	readonly #url: string
	readonly #title: string
	readonly #html: string
	readonly #waited: boolean
	readonly #calls: string[] = []
	readonly #elements: BrowserElementManagerDouble

	constructor(options?: BrowserViewDoubleOptions) {
		this.#url = options?.url ?? 'https://example.test/form'
		this.#title = options?.title ?? 'Form'
		this.#html = options?.html ?? '<main><p>Form body</p></main>'
		this.#waited = options?.waited ?? true
		this.#elements = new BrowserElementManagerDouble(this.#url, this.#title, this.#calls)
	}

	get url(): string {
		return this.#url
	}

	get trusted(): boolean {
		return false
	}

	get elements(): BrowserElementManagerInterface {
		return this.#elements
	}

	get calls(): readonly string[] {
		return this.#calls
	}

	async title(): Promise<string> {
		return this.#title
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		options?.signal?.throwIfAborted()
		this.#calls.push('read')
		return createBrowserReading({ url: this.#url, title: this.#title, html: this.#html })
	}

	async wait(text: string, options?: BrowserWaitOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`wait ${text}${options?.absent === true ? ' absent' : ''}`)
		if (!this.#waited)
			throw new BrowserError('Browser text wait timed out', 'BROWSER_WAIT_TIMEOUT', { text })
	}
}

/**
 * Creates a view double: a document view with no page behind it.
 * @param options - The scripted document and wait result
 * @returns The view double
 */
export function createBrowserViewDouble(options?: BrowserViewDoubleOptions): BrowserViewDouble {
	return new BrowserViewDouble(options)
}

/** Describes an adopted action whose completion the caller controls. */
export interface BrowserPendingToolsetFixture {
	readonly toolset: BrowserToolsetInterface
	readonly view: BrowserViewDouble
	readonly pending: PromiseWithResolvers<string>
	readonly invoked: RecorderInterface<[]>
}

/**
 * Creates a toolset with an adopted checkout action waiting for an explicit completion.
 * @param options - The document view and wait result
 * @returns The unstarted toolset, its view, the completion, and the invocation recorder
 */
export function createBrowserPendingToolsetFixture(
	options?: BrowserViewDoubleOptions,
): BrowserPendingToolsetFixture {
	const pending = Promise.withResolvers<string>()
	const invoked = createRecorder<[]>()
	const source = createToolManager()
	source.add(
		createTool({
			name: 'checkout',
			execute: () => {
				invoked.handler()
				return pending.promise
			},
		}),
	)
	const view = createBrowserViewDouble(options)
	const toolset = new BrowserToolset(view, {
		source: {
			adopt: async () => source.tools(),
			emitter: new Emitter<BrowserToolSourceEventMap>(),
		},
	})
	return { toolset, view, pending, invoked }
}

/**
 * Scripts target discovery, the target attach, and the required domain-enable handshake.
 *
 * @remarks
 * `Page.getFrameTree` answers a session the transport's `sessions` holds with that session's own
 * frame, and refuses a call without a session with the method-not-found code `-32601` and one on
 * any other session with `-32001`, as Chromium does.
 *
 * @param transport - The fake transport to script
 * @param session - The session an attach answers with. Default: `session-1`
 * @param sessions - The session an attach to one target id answers with instead of `session`
 * @param withheld - Reports a message this handshake leaves unanswered, for the test to answer
 */
export function scriptCDPAttach(
	transport: CDPTestTransportInterface,
	session = 'session-1',
	sessions?: Readonly<Record<string, string>>,
	withheld?: (message: CDPSentMessage) => boolean,
): void {
	for (const method of [
		'Target.setDiscoverTargets',
		'Page.enable',
		'Page.setLifecycleEventsEnabled',
		'Runtime.enable',
		'Network.enable',
		'Network.disable',
		'Target.setAutoAttach',
		'Runtime.runIfWaitingForDebugger',
		'Page.setInterceptFileChooserDialog',
		'Browser.setDownloadBehavior',
		'Emulation.setTouchEmulationEnabled',
	])
		transport.onSend(method, (message) => {
			if (withheld?.(message) !== true) transport.reply(message.id, {})
		})
	transport.onSend('Target.attachToTarget', (message) => {
		if (withheld?.(message) === true) return
		const target = message.params?.['targetId']
		const named = isString(target) ? sessions?.[target] : undefined
		transport.reply(message.id, { sessionId: named ?? session })
	})
	transport.onSend('Page.getFrameTree', (message) => {
		const known = message.sessionId
		if (withheld?.(message) === true) return
		if (known === undefined) transport.fail(message.id, "'Page.getFrameTree' wasn't found", -32601)
		else if (!transport.sessions.has(known))
			transport.fail(message.id, 'Session with given id not found.', -32001)
		else
			transport.reply(message.id, {
				frameTree: { frame: { id: `frame-${known}`, url: 'about:blank' } },
			})
	})
}

/** Reads a sent Runtime expression without a type assertion. */
export function readCDPExpression(message: CDPSentMessage | undefined): string | undefined {
	const expression = message?.params?.['expression']
	return isString(expression) ? expression : undefined
}

/** Lists the page history directions, in the order a history case matrix registers them. */
export const BROWSER_HISTORY_DIRECTIONS = ['back', 'forward'] as const

/** Pairs each page navigation operation with the protocol command that starts it. */
export const BROWSER_NAVIGATION_COMMANDS = [
	['navigate', 'Page.navigate'],
	['reload', 'Page.reload'],
] as const

/**
 * Pairs each history direction with the current history index that gives it a target entry and
 * the URL of the entry it restores, over the two-entry `form` and `article` history.
 */
export const BROWSER_HISTORY_RESTORE_CASES = [
	['back', 1, 'https://example.com/form'],
	['forward', 0, 'https://example.com/article'],
] as const

/**
 * Scripts the `Page.getNavigationHistory` reply over the two-entry `form` and `article` history.
 * @param transport - The fake transport to script
 * @param current - The index of the entry the page shows
 */
export function scriptBrowserHistory(transport: CDPTestTransportInterface, current: number): void {
	replyOk(transport, 'Page.getNavigationHistory', {
		currentIndex: current,
		entries: [
			{ id: 1, url: 'https://example.com/form' },
			{ id: 2, url: 'https://example.com/article' },
		],
	})
}

/** Holds the three-level page frame tree whose child frames name their parent. */
export const FRAME_TREE_FIXTURE = Object.freeze({
	frameTree: {
		frame: { id: 'main-1', url: 'https://example.com/' },
		childFrames: [
			{
				frame: {
					id: 'child-1',
					parentId: 'main-1',
					name: 'child-frame',
					url: 'https://example.com/child',
				},
				childFrames: [
					{
						frame: {
							id: 'grandchild-1',
							parentId: 'child-1',
							name: '',
							url: 'https://example.com/grandchild',
						},
					},
				],
			},
		],
	},
})

/**
 * Scripts the nested frame tree page frame tests share.
 * @param transport - The fake transport to script
 * @param roots - The root frame each named frame session answers with in place of the page tree
 */
export function scriptFrameTree(
	transport: CDPTestTransportInterface,
	roots: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(),
): void {
	transport.onSend('Page.getFrameTree', (message) => {
		const root = message.sessionId === undefined ? undefined : roots.get(message.sessionId)
		transport.reply(
			message.id,
			root === undefined ? FRAME_TREE_FIXTURE : { frameTree: { frame: root } },
		)
	})
}

/** Describes a fully started codegen fixture. */
export interface StartedCodegenFixture extends ConnectedCDPFixture {
	readonly codegen: BrowserCodegen
}

/** Creates a connected client with a started codegen recorder. */
export async function createStartedCodegen(
	session = 'session-1',
	target = { role: 'textbox', name: 'Title' },
): Promise<StartedCodegenFixture> {
	const { client, transport } = await createConnectedCDPClient()
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Page.getFrameTree', {
		frameTree: { frame: { id: 'main', url: 'https://example.test/' } },
	})
	replyOk(transport, 'Runtime.releaseObject')
	replyOk(transport, 'Accessibility.getPartialAXTree', {
		nodes: [{ role: { value: target.role }, name: { value: target.name } }],
	})
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Runtime.addBinding')
	replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
	replyOk(transport, 'Runtime.evaluate', { result: { objectId: 'target' } })
	replyOk(transport, 'Runtime.removeBinding')

	const codegen = new BrowserCodegen(client, session)
	await codegen.start()
	return { client, transport, codegen }
}

/** Creates the CDP payload the codegen binding delivers. */
export function createCodegenBindingPayload(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return {
		name: '__orkestrelBrowserCodegen',
		executionContextId: 1,
		payload: JSON.stringify(payload),
	}
}

/**
 * Scripts a `Runtime.evaluate` response keyed by a predicate over the sent
 * expression — each call replies with `value` (wrapped as a CDP remote
 * object) the first time a pending `Runtime.evaluate` frame's `expression`
 * param satisfies `matches`.
 *
 * @param transport - The fake transport to script
 * @param matches - Predicate over the expression string
 * @param value - The resolved value to reply with
 */
export function scriptEvaluate(
	transport: CDPTestTransportInterface,
	matches: (expression: string) => boolean,
	value: unknown,
): void {
	transport.onSend('Runtime.evaluate', (message) => {
		const expression = message.params?.['expression']
		if (isString(expression) && matches(expression)) {
			transport.reply(message.id, { result: { value } })
		}
	})
}

// === Fixtures

/**
 * Builds a {@link CDPTarget} fixture, overriding any fields.
 *
 * @param overrides - Fields to override on the default fixture
 * @returns A CDPTarget
 */
export function createTarget(overrides?: Partial<CDPTarget>): CDPTarget {
	return {
		id: 'target-1',
		category: 'page',
		title: 'Test Page',
		url: 'about:blank',
		...overrides,
	}
}

/**
 * Builds a two-document `DOMSnapshot.captureSnapshot` result with sparse node
 * metadata, layout, styles, and an iframe content-document link.
 *
 * @returns A protocol-shaped DOM snapshot result
 */
export function createDOMSnapshotResult(): unknown {
	return {
		strings: [
			'frame-main',
			'https://example.com/',
			'Main',
			'#document',
			'',
			'HTML',
			'BODY',
			'DIV',
			'id',
			'hero',
			'#text',
			'Hello world',
			'rgb(1, 2, 3)',
			'open',
			'INPUT',
			'typed',
			'IFRAME',
			'frame-child',
			'https://example.com/child',
			'Child',
			'src',
		],
		documents: [
			{
				frameId: 0,
				documentURL: 1,
				title: 2,
				scrollOffsetX: 12,
				scrollOffsetY: 34,
				contentWidth: 1200,
				contentHeight: 2400,
				nodes: {
					parentIndex: [-1, 0, 1, 2, 3, 2, 2],
					nodeType: [9, 1, 1, 1, 3, 1, 1],
					nodeName: [3, 5, 6, 7, 10, 14, 16],
					nodeValue: [4, 4, 4, 4, 11, 4, 4],
					backendNodeId: [100, 101, 102, 103, 104, 105, 106],
					attributes: [[], [], [], [8, 9], [], [8, 15], [20, 18]],
					textValue: { index: [3], value: [11] },
					inputValue: { index: [5], value: [15] },
					inputChecked: { index: [5] },
					optionSelected: { index: [] },
					isClickable: { index: [3, 5] },
					shadowRootType: { index: [3], value: [13] },
					contentDocumentIndex: { index: [6], value: [1] },
					pseudoType: { index: [], value: [] },
					currentSourceURL: { index: [6], value: [18] },
					originURL: { index: [6], value: [1] },
				},
				layout: {
					nodeIndex: [3, 4, 5, 6],
					styles: [[12], [12], [12], [12]],
					bounds: [
						[10, 20, 300, 100],
						[10, 20, 0, 0],
						[10, 140, 200, 40],
						[10, 200, 600, 400],
					],
					text: [11, 11, 15, 4],
					paintOrders: [2, 3, 4, 5],
					offsetRects: [
						[10, 20, 300, 100],
						[10, 20, 0, 0],
						[10, 140, 200, 40],
						[10, 200, 600, 400],
					],
					scrollRects: [
						[0, 0, 300, 100],
						[0, 0, 0, 0],
						[0, 0, 200, 40],
						[0, 0, 600, 400],
					],
					clientRects: [
						[10, 20, 300, 100],
						[10, 20, 0, 0],
						[10, 140, 200, 40],
						[10, 200, 600, 400],
					],
				},
			},
			{
				frameId: 17,
				documentURL: 18,
				title: 19,
				nodes: {
					parentIndex: [-1, 0],
					nodeType: [9, 1],
					nodeName: [3, 6],
					nodeValue: [4, 4],
					backendNodeId: [200, 201],
					attributes: [[], []],
				},
				layout: {
					nodeIndex: [1],
					styles: [[12]],
					bounds: [[0, 0, 600, 400]],
					text: [4],
				},
			},
		],
	}
}

// === Recording writer

/** Extends {@link BrowserWriterInterface} with a record of every `write()` call. */
export interface RecordingWriterInterface extends BrowserWriterInterface {
	readonly calls: ReadonlyArray<{ readonly path: string; readonly data: Uint8Array }>
}

/**
 * Creates an in-memory {@link BrowserWriterInterface} that records writes
 * instead of touching a filesystem.
 *
 * @returns A {@link RecordingWriterInterface}
 */
export function createRecordingWriter(): RecordingWriterInterface {
	const calls: Array<{ path: string; data: Uint8Array }> = []

	return {
		calls,
		async write(path: string, data: Uint8Array): Promise<void> {
			calls.push({ path, data })
		},
	}
}

// === Base64 fixtures (plain-JS encoded, no Buffer)

/** Encodes bytes `[137, 80, 78, 71, 13]` as base64 (PNG-signature-prefixed). */
export const PNG_BASE64 = 'iVBORw0='

/** Encodes bytes `[255, 216, 255, 224]` as base64 (JPEG-signature-prefixed). */
export const JPEG_BASE64 = '/9j/4A=='

/** Supplies the journey printed in the design listing. */
export const BROWSER_JOURNEY_FIXTURE: BrowserJourney = {
	format: 1,
	name: 'add-kettle',
	description: 'Add the Alpine Kettle to the cart',
	parameters: { email: { default: 'sam@example.test' } },
	next: 6,
	steps: [
		{ id: 's1', action: 'navigate', arguments: { url: 'https://shop.example.test/' } },
		{ id: 's2', action: 'click', arguments: {}, target: { role: 'link', name: 'Alpine Kettle' } },
		{ id: 's3', action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } },
		{
			id: 's4',
			action: 'type',
			arguments: { text: { parameter: 'email' }, submit: true },
			target: { role: 'textbox', name: 'Email' },
		},
		{ id: 's5', action: 'wait', arguments: { text: 'Added to cart' } },
	],
}

/** Supplies the exact listing fence from the design. */
export const BROWSER_JOURNEY_LISTING = `add-kettle "Add the Alpine Kettle to the cart" (parameters: email)
s1 navigate https://shop.example.test/
s2 click link "Alpine Kettle"
s3 click button "Add to cart"
s4 type "sam@example.test" as email into textbox "Email", submit
s5 wait "Added to cart"`

/** Supplies the view fence appended to a rendered run. */
export const BROWSER_RUN_VIEW = `page "Cart" https://shop.example.test/cart
e40 link "Catalogue"
e41 link "Cart"
e42 link "Checkout"
# Your cart
Alpine Kettle
(3 of 3 elements)`

/** Supplies the completed run printed in the design. */
export const BROWSER_RUN_FIXTURE: BrowserRun = {
	format: 1,
	id: '2026-09-30T14-03-12.481Z-7f3a',
	journey: BROWSER_JOURNEY_FIXTURE,
	inputs: { email: 'ada@example.test' },
	outcome: 'complete',
	elapsed: 25,
	steps: [
		{
			id: 's1',
			action: 'navigate',
			trigger: 'https://shop.example.test/',
			arguments: { url: 'https://shop.example.test/' },
			outcome: 'done',
			result: 'Navigated to https://shop.example.test/.',
			elapsed: 5,
		},
		{
			id: 's2',
			action: 'click',
			trigger: 'Alpine Kettle',
			arguments: { ref: 'e12' },
			outcome: 'done',
			result: 'Clicked e12 link "Alpine Kettle".',
			elapsed: 5,
		},
		{
			id: 's3',
			action: 'click',
			trigger: 'Add to cart',
			arguments: { ref: 'e31' },
			outcome: 'done',
			result: 'Clicked e31 button "Add to cart".',
			elapsed: 5,
		},
		{
			id: 's4',
			action: 'type',
			trigger: 'Email',
			arguments: { ref: 'e33', text: 'ada@example.test', submit: true },
			outcome: 'done',
			result: 'Typed "ada@example.test" into e33 textbox "Email" and submitted the form.',
			elapsed: 5,
		},
		{
			id: 's5',
			action: 'wait',
			trigger: 'Added to cart',
			arguments: { text: 'Added to cart' },
			outcome: 'done',
			result: '"Added to cart" is on the page.',
			elapsed: 5,
		},
	],
}

/** Supplies the exact run fence from the design. */
export const BROWSER_RUN_LISTING = `Replayed add-kettle: 5 of 5 steps.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".
s3 Clicked e31 button "Add to cart".
s4 Typed "ada@example.test" into e33 textbox "Email" and submitted the form.
s5 "Added to cart" is on the page.

page "Cart" https://shop.example.test/cart
e40 link "Catalogue"
e41 link "Cart"
e42 link "Checkout"
# Your cart
Alpine Kettle
(3 of 3 elements)`

/** Supplies native and page step renderings, including every template. */
export const BROWSER_JOURNEY_TEMPLATE_CASES: ReadonlyArray<{
	readonly step: BrowserJourneyStep
	readonly line: string
	readonly trigger: string
}> = [
	{
		step: {
			id: 's1',
			action: 'click',
			arguments: {},
			target: { role: 'button', name: 'Save', reference: 'e7', css: '#save' },
		},
		line: 's1 click button "Save"',
		trigger: 'Save',
	},
	{
		step: {
			id: 's1',
			action: 'type',
			arguments: { text: 'Ada' },
			target: { role: 'textbox', name: 'Name' },
		},
		line: 's1 type "Ada" into textbox "Name"',
		trigger: 'Name',
	},
	{
		step: { id: 's1', action: 'press', arguments: { key: 'Enter' } },
		line: 's1 press Enter',
		trigger: 'Enter',
	},
	{
		step: { id: 's1', action: 'navigate', arguments: { url: 'https://example.test/' } },
		line: 's1 navigate https://example.test/',
		trigger: 'https://example.test/',
	},
	{
		step: { id: 's1', action: 'wait', arguments: { text: 'Saved' } },
		line: 's1 wait "Saved"',
		trigger: 'Saved',
	},
	{
		step: { id: 's1', action: 'wait', arguments: { text: 'Saving', absent: true } },
		line: 's1 wait "Saving", absent',
		trigger: 'Saving',
	},
	{
		step: { id: 's1', action: 'dialog', arguments: { accept: true } },
		line: 's1 dialog accept',
		trigger: 'accept',
	},
	{
		step: { id: 's1', action: 'dialog', arguments: { accept: false, text: 'No' } },
		line: 's1 dialog dismiss "No"',
		trigger: 'dismiss',
	},
	{
		step: {
			id: 's1',
			action: 'switch',
			arguments: {},
			tab: { title: 'Cart', url: 'https://example.test/cart' },
		},
		line: 's1 switch "Cart" https://example.test/cart',
		trigger: 'Cart',
	},
	{
		step: {
			id: 's1',
			action: 'reserve',
			arguments: { ref: 'sku7', tab: 'stock', value: { parameter: 'literal' } },
		},
		line: 's1 reserve {"ref":"sku7","tab":"stock","value":{"parameter":"literal"}}',
		trigger: 'reserve',
	},
	{
		step: { id: 's1', action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
		line: 's1 unresolved: the element is in a child frame',
		trigger: 'unresolved',
	},
]

/** Supplies invalid journeys and the invariants each violates. */
export const BROWSER_JOURNEY_INVALID_CASES: ReadonlyArray<{
	readonly name: string
	readonly value: unknown
	readonly invariant: number
}> = [
	{ name: 'reserved name', value: { ...BROWSER_JOURNEY_FIXTURE, name: 'con' }, invariant: 1 },
	{ name: 'long name', value: { ...BROWSER_JOURNEY_FIXTURE, name: 'a'.repeat(65) }, invariant: 1 },
	{
		name: 'duplicate ids',
		value: {
			...BROWSER_JOURNEY_FIXTURE,
			steps: [...BROWSER_JOURNEY_FIXTURE.steps, BROWSER_JOURNEY_FIXTURE.steps[0]],
		},
		invariant: 2,
	},
	{ name: 'counter bounds', value: { ...BROWSER_JOURNEY_FIXTURE, next: 5 }, invariant: 2 },
	{
		name: 'missing target',
		value: {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [{ id: 's1', action: 'click', arguments: {} }],
		},
		invariant: 3,
	},
	{
		name: 'native ref',
		value: {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [{ id: 's1', action: 'wait', arguments: { text: 'saved', ref: 'e1' } }],
		},
		invariant: 3,
	},
	{
		name: 'undeclared binding',
		value: { ...BROWSER_JOURNEY_FIXTURE, parameters: {} },
		invariant: 4,
	},
	{
		name: 'unused declaration',
		value: { ...BROWSER_JOURNEY_FIXTURE, parameters: { email: {}, unused: {} } },
		invariant: 4,
	},
	{
		name: 'secret default',
		value: {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: { email: { secret: true, default: 'hidden' } },
		},
		invariant: 5,
	},
	{ name: 'non JSON argument', value: { ...BROWSER_JOURNEY_FIXTURE, extra: NaN }, invariant: 6 },
	{
		name: 'observation action',
		value: {
			...BROWSER_JOURNEY_FIXTURE,
			parameters: {},
			steps: [{ id: 's1', action: 'read', arguments: {} }],
		},
		invariant: 7,
	},
]

/** Supplies edit grammar refusals with their operation and field clauses. */
export const BROWSER_JOURNEY_EDIT_SHAPES: ReadonlyArray<readonly [unknown, string]> = Object.freeze(
	[
		[null, 'has no edit object with an "operation" field'],
		[[], 'has no edit object with an "operation" field'],
		[{}, 'names no operation among add, update, remove, and declare'],
		[{ operation: 'move' }, 'names no operation among add, update, remove, and declare'],
		[{ operation: 'remove' }, 'its "remove" names no step in "id"'],
		[{ operation: 'remove', id: 1 }, 'its "remove" names no step in "id"'],
		[{ operation: 'remove', id: '' }, 'its "remove" names no step in "id"'],
		[
			{ operation: 'remove', id: 's1', before: 's2' },
			'its "remove" carries an unknown field "before"',
		],
		[{ operation: 'remove', id: undefined }, 'its "remove" has non-JSON content in "id"'],
		[
			{ operation: 'add', before: 's1', after: 's2' },
			'its "add" carries both "before" and "after"',
		],
		[{ operation: 'add', before: 1 }, 'its "add" has no step id in "before"'],
		[{ operation: 'add', after: '' }, 'its "add" has no step id in "after"'],
		[{ operation: 'add' }, 'its "add" has an invalid "step": has a malformed step'],
		[
			{ operation: 'add', step: { action: 'wait', arguments: { text: 'Ready' }, id: 's1' } },
			'its "add" supplies "step.id", which is assigned automatically',
		],
		[
			{ operation: 'add', step: { action: 'click', arguments: {} } },
			'its "add" has an invalid "step": has an incompatible target or tab',
		],
		[
			{ operation: 'add', step: { action: 'wait', arguments: {} } },
			'its "add" has an invalid "step": has malformed native arguments',
		],
		[{ operation: 'add', id: 's1' }, 'its "add" carries an unknown field "id"'],
		[{ operation: 'update' }, 'its "update" names no step in "id"'],
		[{ operation: 'update', id: 's1', arguments: [] }, 'its "update" has no object in "arguments"'],
		[{ operation: 'update', id: 's1', target: null }, 'its "update" has an invalid "target"'],
		[{ operation: 'update', id: 's1', tab: {} }, 'its "update" has an invalid "tab"'],
		[
			{ operation: 'update', id: 's1', after: 's2' },
			'its "update" carries an unknown field "after"',
		],
		[
			{ operation: 'update', id: 's1', arguments: { text: NaN } },
			'its "update" has non-JSON content in "arguments"',
		],
		[{ operation: 'declare' }, 'its "declare" has no "name"'],
		[{ operation: 'declare', name: 'Bad Name' }, 'its "declare" has an invalid "name"'],
		[
			{ operation: 'declare', name: 'email' },
			'its "declare" has an invalid "parameter": has a malformed parameter declaration',
		],
		[
			{ operation: 'declare', name: 'email', parameter: { secret: true, default: 'hidden' } },
			'its "declare" has an invalid "parameter": declares a secret with a default',
		],
		[
			{ operation: 'declare', name: 'email', arguments: {} },
			'its "declare" carries an unknown field "arguments"',
		],
	],
)

/** Supplies malformed edits and the application failures the editor refuses. */
export const BROWSER_JOURNEY_EDIT_REFUSALS: ReadonlyArray<{
	readonly name: string
	readonly edit: unknown
}> = [
	{ name: 'unknown operation', edit: { operation: 'move', id: 's1' } },
	{ name: 'unknown remove id', edit: { operation: 'remove', id: 's99' } },
	{ name: 'unknown update id', edit: { operation: 'update', id: 's99', arguments: {} } },
	{
		name: 'unknown anchor',
		edit: {
			operation: 'add',
			before: 's99',
			step: { action: 'wait', arguments: { text: 'done' } },
		},
	},
	{
		name: 'duplicate anchors',
		edit: {
			operation: 'add',
			before: 's1',
			after: 's2',
			step: { action: 'wait', arguments: { text: 'done' } },
		},
	},
	{
		name: 'supplied id',
		edit: { operation: 'add', step: { id: 's1', action: 'wait', arguments: { text: 'done' } } },
	},
	{ name: 'removed target', edit: { operation: 'update', id: 's2', target: null } },
	{
		name: 'incompatible tab',
		edit: { operation: 'update', id: 's2', tab: { url: 'https://example.test/', title: 'Cart' } },
	},
	{
		name: 'secret default',
		edit: { operation: 'declare', name: 'email', parameter: { secret: true, default: 'hidden' } },
	},
	{
		name: 'undeclared binding',
		edit: { operation: 'update', id: 's4', arguments: { text: { parameter: 'missing' } } },
	},
]

/** Supplies final-candidate binding failures and the edit that introduced each. */
export const BROWSER_JOURNEY_EDIT_ORIGINS: ReadonlyArray<{
	readonly name: string
	readonly edits: readonly BrowserJourneyEdit[]
	readonly index: number
}> = [
	{
		name: 'an undeclared prototype member binding',
		index: 1,
		edits: [
			{ operation: 'update', id: 's4', arguments: { text: { parameter: 'constructor' } } },
			{ operation: 'remove', id: 's5' },
		],
	},
	{
		name: 'added binding before a later removal',
		index: 1,
		edits: [
			{ operation: 'add', step: { action: 'wait', arguments: { text: { parameter: 'missing' } } } },
			{ operation: 'remove', id: 's5' },
		],
	},
	{
		name: 'target binding before an argument update',
		index: 1,
		edits: [
			{
				operation: 'update',
				id: 's4',
				target: { role: 'textbox', name: { parameter: 'missing' } },
			},
			{ operation: 'update', id: 's4', arguments: { submit: false } },
		],
	},
	{
		name: 'same binding repeated after its introduction',
		index: 1,
		edits: [
			{ operation: 'update', id: 's4', arguments: { text: { parameter: 'missing' } } },
			{
				operation: 'update',
				id: 's4',
				arguments: { text: { parameter: 'missing' }, submit: false },
			},
		],
	},
	{
		name: 'secret declaration after a wait binding',
		index: 2,
		edits: [
			{ operation: 'update', id: 's5', arguments: { text: { parameter: 'email' } } },
			{ operation: 'declare', name: 'email', parameter: { secret: true } },
			{ operation: 'remove', id: 's1' },
		],
	},
	{
		name: 'wait binding after a secret declaration',
		index: 2,
		edits: [
			{ operation: 'declare', name: 'email', parameter: { secret: true } },
			{ operation: 'update', id: 's5', arguments: { text: { parameter: 'email' } } },
			{ operation: 'remove', id: 's1' },
		],
	},
	{
		name: 'unbound declaration before a later update',
		index: 1,
		edits: [
			{ operation: 'declare', name: 'missing', parameter: {} },
			{ operation: 'update', id: 's5', arguments: { text: 'Ready' } },
		],
	},
]

/**
 * Creates an independently editable journey with sequential ids.
 * @param steps - Steps in execution order
 * @param options - Journey metadata and parameters
 * @returns The journey fixture
 */
export function createBrowserJourneyFixture(
	steps: readonly BrowserJourneyStepInput[] = [{ action: 'wait', arguments: { text: 'Ready' } }],
	options?: Partial<Pick<BrowserJourney, 'name' | 'description' | 'parameters'>>,
): BrowserJourney {
	return {
		format: 1,
		name: 'check-ready',
		description: 'Check readiness',
		parameters: {},
		...options,
		next: steps.length + 1,
		steps: steps.map((step, index) => ({ ...structuredClone(step), id: 's' + (index + 1) })),
	}
}

/**
 * Creates a structured action event for the recorder boundary.
 * @param options - Action fields to replace
 * @returns The independent action value
 */
export function createBrowserActionFixture(options?: Partial<BrowserAction>): BrowserAction {
	return {
		action: 'click',
		arguments: { ref: 'e1' },
		target: { role: 'button', name: 'Save', reference: 'e1' },
		outcome: 'done',
		receipt: 'Clicked e1 button "Save".',
		elapsed: 1,
		...options,
	}
}

/** Describes a preparation refusal and its tool sentence. */
export interface BrowserPreparationCase {
	readonly name: string
	readonly journey: BrowserJourney
	readonly inputs: Readonly<Record<string, string>>
	readonly code: string
	readonly context: Readonly<Record<string, unknown>>
	readonly sentence: string
	readonly corrupt?: readonly [string, unknown]
}

/** Supplies preparation refusals through real replay and journey tools. */
export const BROWSER_PREPARATION_CASES: readonly BrowserPreparationCase[] = Object.freeze([
	{
		name: 'missing input',
		journey: createBrowserJourneyFixture(
			[{ action: 'wait', arguments: { text: { parameter: 'status' } } }],
			{ parameters: { status: {} } },
		),
		inputs: {},
		code: 'BROWSER_JOURNEY_INPUT',
		context: { parameter: 'status' },
		sentence: 'Journey check-ready needs the input "status"; call replay with inputs.',
	},
	{
		name: 'unknown input',
		journey: createBrowserJourneyFixture(),
		inputs: { extra: 'Ready' },
		code: 'BROWSER_JOURNEY_INPUT',
		context: { parameter: 'extra' },
		sentence: 'Journey check-ready has no parameter named "extra"; call journeys.',
	},
	{
		name: 'gap',
		journey: createBrowserJourneyFixture([
			{ action: 'unresolved', arguments: {}, gap: 'child frame' },
		]),
		inputs: {},
		code: 'BROWSER_JOURNEY_GAP',
		context: { step: 's1' },
		sentence:
			'Journey check-ready has a gap at s1 (child frame); call edit to remove or replace s1.',
	},
	{
		name: 'placement',
		journey: createBrowserJourneyFixture([{ action: 'press', arguments: { key: 'Enter' } }]),
		inputs: {},
		code: 'BROWSER_JOURNEY_PLACEMENT',
		context: { step: 's1', action: 'press', placement: 'dom' },
		sentence:
			'Journey check-ready cannot run here: s1 press is not available in a page toolset; call journeys.',
	},
	{
		name: 'format',
		journey: createBrowserJourneyFixture(),
		inputs: {},
		corrupt: ['format', 9],
		code: 'BROWSER_JOURNEY_FORMAT',
		context: { action: 'replay', placement: 'dom' },
		sentence: 'Journey check-ready cannot be read: Has an unknown journey format; call journeys.',
	},
	{
		name: 'invalid',
		journey: createBrowserJourneyFixture(),
		inputs: {},
		corrupt: ['next', 0],
		code: 'BROWSER_JOURNEY_INVALID',
		context: { action: 'replay', placement: 'dom' },
		sentence: 'Journey check-ready cannot be read: has an invalid next counter; call journeys.',
	},
])

/**
 * Records outbound CDP frames while forwarding them unchanged to a real transport.
 * @example
 * const recording = new BrowserJourneyTransportRecorder(transport)
 * const client = createCDPClient({ transport: recording })
 */
export class BrowserJourneyTransportRecorder implements CDPTransportInterface {
	readonly #transport: CDPTransportInterface
	readonly #sent: string[] = []
	constructor(transport: CDPTransportInterface) {
		this.#transport = transport
	}
	get emitter(): EmitterInterface<CDPTransportEventMap> {
		return this.#transport.emitter
	}
	get sent(): readonly string[] {
		return [...this.#sent]
	}
	start(): Promise<void> {
		return this.#transport.start()
	}
	async send(message: string): Promise<void> {
		this.#sent.push(message)
		await this.#transport.send(message)
	}
	close(): Promise<void> {
		return this.#transport.close()
	}
	clear(): void {
		this.#sent.length = 0
	}
}

/** Holds record and replay documents with changed ids, classes, and control order. */
export const BROWSER_JOURNEY_TARGET_HTML = Object.freeze({
	record:
		'<button id="archive" class="plain">Archive</button><button id="delete" class="danger">Delete</button><button id="all" class="large">Delete all</button><label>Title <input id="title"></label>',
	changed:
		'<button id="bulk" class="muted">Delete all</button><section><button id="k1" class="changed">Delete</button></section><button id="k2" class="archived">Archive</button><label>Title <input id="last"></label>',
	duplicate:
		'<button id="bulk" class="muted">Delete all</button><section><button id="k1" class="changed">Delete</button></section><aside><button id="second">Delete</button></aside>',
	css: '<button id="save">Save</button><button id="cancel">Cancel</button><a href="#help">Help</a>',
})

/**
 * Installs the journey proofs' own click log after replacing fixture content; its key differs from
 * the fixture page's `data-clicks` log, which the page's document listener keeps appending to.
 */
export const BROWSER_JOURNEY_TARGET_LOG =
	'document.body.dataset.journeyClicks = "[]"; document.body.onclick = event => { if (event.target instanceof HTMLButtonElement) document.body.dataset.journeyClicks = JSON.stringify([...JSON.parse(document.body.dataset.journeyClicks), { id: event.target.id, trusted: event.isTrusted }]) }'

/** Supplies the design's `add-kettle` module fence, which the TypeScript compilation equals byte for byte. */
export const BROWSER_JOURNEY_MODULE = `import type { BrowserPageInterface } from '@orkestrel/browser'
import { createBrowserToolset } from '@orkestrel/browser'

export async function execute(page: BrowserPageInterface, inputs: { readonly email?: string } = {}): Promise<void> {
	for (const name of Object.keys(inputs)) if (!['email'].includes(name)) throw new Error(name + ': no parameter has that name')
	if (inputs.email !== undefined && typeof inputs.email !== 'string') throw new Error('email: the input is not a string')
	const toolset = createBrowserToolset(page)
	await toolset.start()
	try {
		await toolset.follow('s1', { action: 'navigate', arguments: { url: 'https://shop.example.test/' } })
		await toolset.follow('s2', { action: 'click', arguments: {}, target: { role: 'link', name: 'Alpine Kettle' } })
		await toolset.follow('s3', { action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } })
		await toolset.follow('s4', { action: 'type', arguments: { text: inputs.email ?? 'sam@example.test', submit: true }, target: { role: 'textbox', name: 'Email' } })
		await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
	} finally {
		await toolset.destroy()
	}
}
`

/** Supplies the JavaScript twin of the `add-kettle` module: no type import and no annotations. */
export const BROWSER_JOURNEY_MODULE_JAVASCRIPT = `import { createBrowserToolset } from '@orkestrel/browser'

export async function execute(page, inputs = {}) {
	for (const name of Object.keys(inputs)) if (!['email'].includes(name)) throw new Error(name + ': no parameter has that name')
	if (inputs.email !== undefined && typeof inputs.email !== 'string') throw new Error('email: the input is not a string')
	const toolset = createBrowserToolset(page)
	await toolset.start()
	try {
		await toolset.follow('s1', { action: 'navigate', arguments: { url: 'https://shop.example.test/' } })
		await toolset.follow('s2', { action: 'click', arguments: {}, target: { role: 'link', name: 'Alpine Kettle' } })
		await toolset.follow('s3', { action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } })
		await toolset.follow('s4', { action: 'type', arguments: { text: inputs.email ?? 'sam@example.test', submit: true }, target: { role: 'textbox', name: 'Email' } })
		await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
	} finally {
		await toolset.destroy()
	}
}
`

/**
 * Supplies a journey holding every action: bound, required, and secret inputs, quoted text, both
 * dialog answers, a tab, a gap, and a page tool whose arguments stay literal JSON.
 */
export const BROWSER_JOURNEY_ACTION_FIXTURE: BrowserJourney = {
	format: 1,
	name: 'checkout',
	description: 'Pay for the Alpine Kettle',
	parameters: {
		store: { default: 'https://shop.example.test/' },
		product: { default: 'Alpine Kettle' },
		customer: {},
		password: { secret: true },
		key: { default: 'Enter' },
		reply: { default: `It's "fine"` },
	},
	next: 13,
	steps: [
		{ id: 's1', action: 'navigate', arguments: { url: { parameter: 'store' } } },
		{
			id: 's2',
			action: 'click',
			arguments: {},
			target: { role: 'link', name: { parameter: 'product' }, css: '#kettle', reference: 'e12' },
		},
		{
			id: 's3',
			action: 'type',
			arguments: { text: { parameter: 'customer' } },
			target: { role: 'textbox', name: 'Name' },
		},
		{
			id: 's4',
			action: 'type',
			arguments: { text: { parameter: 'password' }, submit: true },
			target: { role: 'textbox', name: 'Password' },
		},
		{ id: 's5', action: 'press', arguments: { key: { parameter: 'key' } } },
		{ id: 's6', action: 'wait', arguments: { text: 'Paid' } },
		{
			id: 's7',
			action: 'click',
			arguments: {},
			target: { role: 'button', name: 'Delete "draft"' },
		},
		{ id: 's8', action: 'dialog', arguments: { accept: false, text: { parameter: 'reply' } } },
		{ id: 's9', action: 'dialog', arguments: { accept: true } },
		{
			id: 's10',
			action: 'switch',
			arguments: {},
			tab: { url: 'https://shop.example.test/cart', title: 'Cart' },
		},
		{ id: 's11', action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
		{
			id: 's12',
			action: 'reserve',
			arguments: {
				ref: 'sku7',
				tab: 'stock',
				value: { parameter: 'customer' },
				count: 2,
				gift: null,
				tags: ['a\\b', `it's`],
				'line\nbreak': '',
				'gift-wrap': true,
				nested: {},
				list: [],
			},
		},
	],
}

/** Supplies the TypeScript module the action journey compiles to, transcribed by hand. */
export const BROWSER_JOURNEY_ACTION_MODULE = String.raw`import type { BrowserPageInterface } from '@orkestrel/browser'
import { createBrowserToolset } from '@orkestrel/browser'

export async function execute(page: BrowserPageInterface, inputs: { readonly store?: string; readonly product?: string; readonly customer: string; readonly password: string; readonly key?: string; readonly reply?: string }): Promise<void> {
	for (const name of Object.keys(inputs ?? {})) if (!['store', 'product', 'customer', 'password', 'key', 'reply'].includes(name)) throw new Error(name + ': no parameter has that name')
	if (typeof inputs?.customer !== 'string') throw new Error('customer: the input is missing')
	if (typeof inputs?.password !== 'string') throw new Error('password: the input is missing')
	if (inputs.store !== undefined && typeof inputs.store !== 'string') throw new Error('store: the input is not a string')
	if (inputs.product !== undefined && typeof inputs.product !== 'string') throw new Error('product: the input is not a string')
	if (inputs.key !== undefined && typeof inputs.key !== 'string') throw new Error('key: the input is not a string')
	if (inputs.reply !== undefined && typeof inputs.reply !== 'string') throw new Error('reply: the input is not a string')
	throw new Error('s11: the element is in a child frame; handle it here')
	const toolset = createBrowserToolset(page)
	await toolset.start()
	try {
		await toolset.follow('s1', { action: 'navigate', arguments: { url: inputs.store ?? 'https://shop.example.test/' } })
		await toolset.follow('s2', { action: 'click', arguments: {}, target: { role: 'link', name: inputs.product ?? 'Alpine Kettle' } })
		await toolset.follow('s3', { action: 'type', arguments: { text: inputs.customer }, target: { role: 'textbox', name: 'Name' } })
		await toolset.follow('s4', { action: 'type', arguments: { text: inputs.password, submit: true }, target: { role: 'textbox', name: 'Password' } }, { secret: true })
		await toolset.follow('s5', { action: 'press', arguments: { key: inputs.key ?? 'Enter' } })
		await toolset.follow('s6', { action: 'wait', arguments: { text: 'Paid' } })
		await toolset.follow('s7', { action: 'click', arguments: {}, target: { role: 'button', name: 'Delete "draft"' } })
		await toolset.follow('s8', { action: 'dialog', arguments: { accept: false, text: inputs.reply ?? 'It\'s "fine"' } })
		await toolset.follow('s9', { action: 'dialog', arguments: { accept: true } })
		await toolset.follow('s10', { action: 'switch', arguments: {}, tab: { url: 'https://shop.example.test/cart', title: 'Cart' } })
		// s11: the element is in a child frame; handle it here
		await toolset.follow('s12', { action: 'reserve', arguments: { ref: 'sku7', tab: 'stock', value: { parameter: 'customer' }, count: 2, gift: null, tags: ['a\\b', 'it\'s'], 'line\nbreak': '', 'gift-wrap': true, nested: {}, list: [] } })
	} finally {
		await toolset.destroy()
	}
}
`

/** Creates a complete listener payload with configurable gesture fields. */
export function createCodegenGesture(
	fields: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return {
		event: 'input',
		control: 'text',
		index: 0,
		top: true,
		form: true,
		value: 'Title text',
		...fields,
	}
}

/** Drives the shipped listener with inert DOM boundary data and returns its raw binding strings. */
export function captureCodegenSource(
	events: ReadonlyArray<Readonly<Record<string, unknown>>>,
): readonly string[] {
	const listeners = new Map<string, (event: Readonly<Record<string, unknown>>) => void>()
	const payloads: string[] = []
	const window: Record<string, unknown> = {
		__orkestrelBrowserCodegen: payloads.push.bind(payloads),
	}
	window['top'] = window
	const document = { addEventListener: listeners.set.bind(listeners) }
	new Function('window', 'document', 'Element', 'AbortController', BROWSER_CODEGEN_SOURCE)(
		window,
		document,
		Object,
		AbortController,
	)
	for (const event of events) {
		const element = {
			tagName: 'INPUT',
			type: 'password',
			value: 'teal-Heron-42',
			form: {},
			ownerDocument: document,
			getRootNode: () => document,
			...(isRecord(event['element']) ? event['element'] : {}),
		}
		const name = event['type']
		if (isString(name))
			listeners.get(name)?.({ isTrusted: true, ...event, composedPath: () => [element] })
	}
	return payloads
}

/** Holds the independent fixture event log, using only fixture-declared semantic names. */
export const BROWSER_CODEGEN_ORACLE = `
document.body.dataset.codegenLog = "[]";
window.addEventListener("message", event => { if (event.data?.codegen) document.body.dataset.codegenLog = JSON.stringify([...JSON.parse(document.body.dataset.codegenLog), event.data.codegen]); });
for (const name of ["click", "input", "change", "keydown", "focusout", "submit"]) document.addEventListener(name, event => {
 if (!event.isTrusted || (name === "keydown" && event.key !== "Enter")) return;
 const node = event.target;
 const entry = { event: name, id: node.id, main: window === top, role: node.dataset.role, name: node.dataset.name, form: !!node.form, detail: event.detail, control: node.dataset.control || "other" };
 if (name === "input" && node.dataset.control === "text") entry.text = node.isContentEditable ? node.textContent : node.value;
 if (name === "input" && node.type === "password") entry.secret = true;
 if (name === "change" && node.tagName === "SELECT" && !node.multiple) { entry.text = node.value; entry.valid = [...node.options].find(option => option.value === node.value) === node.selectedOptions[0]; }
 if (window === top) document.body.dataset.codegenLog = JSON.stringify([...JSON.parse(document.body.dataset.codegenLog), entry]); else parent.postMessage({ codegen: entry }, "*");
}, true);
`

/** Holds the controls for the host recorder proof; remote URL substitution belongs to its server. */
export const BROWSER_CODEGEN_FIXTURE = `<!doctype html><meta charset="utf-8"><title>Recorder gestures</title>
<style>body{font:16px sans-serif;margin:12px}input,select{display:block;margin:6px}iframe{width:240px;height:70px}#sink{display:none}</style>
<button id="add" data-role="button" data-name="Add note">Add note</button>
<form target="sink" action="/sink"><label>Title<input id="title" name="title" data-role="textbox" data-name="Title" data-control="text"></label><button id="save" data-role="button" data-name="Save note">Save note</button></form>
<form target="sink" action="/sink"><label>Search<input id="search" name="search" value="kettle" data-role="textbox" data-name="Search" data-control="text"></label></form>
<label>Speed<select id="speed" data-role="combobox" data-name="Speed" data-control="select"><option value="standard">Standard</option><option value="express">Express</option></select></label>
<label>Size<select id="size" data-role="combobox" data-name="Size" data-control="select"><option value="m">Medium</option><option value="m">Medium tall</option></select></label>
<label>Toppings<select id="toppings" multiple size="3" data-role="listbox" data-name="Toppings" data-control="multiple"><option id="olives" data-control="option" value="olives">Olives</option><option value="onion">Onion</option></select></label>
<button id="discard" data-role="button" data-name="Discard draft" onclick="document.body.dataset.codegenLog = JSON.stringify([...JSON.parse(document.body.dataset.codegenLog), { event: 'dialog', answer: confirm('Discard the draft?') }])">Discard draft</button>
<label>Password<input id="password" type="password" data-role="textbox" data-name="Password" data-control="password"></label>
<div id="editor" role="textbox" aria-label="Notes" contenteditable="true" data-role="textbox" data-name="Notes" data-control="text">Draft</div>
<a id="next" href="#next" data-role="link" data-name="Next">Next</a>
<iframe id="child" src="/child"></iframe><iframe id="remote" src="REMOTE_URL"></iframe><iframe id="sink" name="sink"></iframe>
<script>${BROWSER_CODEGEN_ORACLE}</script>`

/** Projects the fixture's own event log using the declared gesture boundaries, without recorder data. */
export function projectCodegenOracle(
	log: ReadonlyArray<Readonly<Record<string, unknown>>>,
): readonly BrowserJourneyStepInput[] {
	const steps: BrowserJourneyStepInput[] = []
	let edit: { readonly id: unknown; readonly position: number } | undefined
	let entered = false
	for (const event of log) {
		const action = event['event']
		const control = event['control']
		const target = { role: String(event['role']), name: String(event['name']) }
		if (action === 'focusout' || action === 'submit' || action === 'navigation') {
			edit = undefined
			entered = false
			continue
		}
		if (action === 'input' && (control === 'text' || control === 'password')) {
			const step = {
				action: 'type',
				target,
				arguments: {
					text: event['secret'] === true ? { parameter: 'password' } : String(event['text']),
				},
			}
			if (edit !== undefined && edit.id === event['id']) steps[edit.position] = step
			else {
				steps.push(step)
				edit = { id: event['id'], position: steps.length - 1 }
			}
			continue
		}
		if (action === 'keydown') {
			const previous =
				edit !== undefined && edit.id === event['id'] ? steps[edit.position] : undefined
			if (previous?.action === 'type' && event['form'] === true && edit !== undefined)
				steps[edit.position] = { ...previous, arguments: { ...previous.arguments, submit: true } }
			else steps.push({ action: 'press', arguments: { key: 'Enter' } })
			edit = undefined
			entered = event['form'] === true
			continue
		}
		if (action === 'click') {
			if (
				['select', 'multiple', 'option'].includes(String(control)) ||
				(event['detail'] === 0 && entered)
			)
				continue
			edit = undefined
			entered = false
			if (event['main'] === false)
				steps.push({ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' })
			else {
				steps.push({ action: 'click', arguments: {}, target })
				if (control === 'text' || control === 'password')
					edit = { id: event['id'], position: steps.length - 1 }
			}
		}
		if (action === 'change' && (control === 'select' || control === 'multiple')) {
			edit = undefined
			if (control === 'multiple' || event['valid'] !== true)
				steps.push({
					action: 'unresolved',
					arguments: {},
					gap: control === 'multiple' ? 'a multiple selection' : 'the option does not round-trip',
				})
			else steps.push({ action: 'type', arguments: { text: String(event['text']) }, target })
		}
		if (action === 'dialog') {
			edit = undefined
			steps.push({ action: 'unresolved', arguments: {}, gap: 'a native dialog answer' })
		}
	}
	return steps
}

// === Compiled journey modules

/**
 * Describes one journey the compiled-module proof runs as a generated module and as a replay.
 *
 * @remarks
 * - `route` — the fixture path each run opens a fresh page on
 * - `markup` — the HTML each run writes into the page's `main` before the journey starts
 * - `inputs` — the inputs both the module and the replay receive
 * - `state` — the page expression whose value is the fixture's own state
 * - `outcome` — the state each run leaves on its page and on each popup the page opened, in that
 *   order
 */
export interface BrowserJourneyModuleCase {
	readonly name: string
	readonly route: string
	readonly markup?: string
	readonly journey: BrowserJourney
	readonly inputs: Readonly<Record<string, string>>
	readonly state: string
	readonly outcome: readonly unknown[]
}

/** Holds the journeys a generated module and a replay run to the same page outcome and receipts. */
export const BROWSER_JOURNEY_MODULE_CASES: readonly BrowserJourneyModuleCase[] = Object.freeze([
	{
		name: 'delayed in-frame submission',
		route: '/checkout',
		journey: createBrowserJourneyFixture(
			[
				{
					action: 'type',
					arguments: { text: { parameter: 'name' }, submit: true },
					target: { role: 'textbox', name: 'Name' },
				},
				{ action: 'wait', arguments: { text: 'placed for Grace.' } },
			],
			{
				name: 'place-order',
				description: 'Place an order under a name',
				parameters: { name: { default: 'Ada' } },
			},
		),
		inputs: { name: 'Grace' },
		state:
			"({ name: document.getElementById('name').value, lines: [...document.querySelectorAll('main > p')].map((line) => line.textContent) })",
		outcome: [{ name: 'Grace', lines: ['Order A1042 placed for Grace.'] }],
	},
	{
		name: 'editable combobox',
		route: '/form',
		markup: BROWSER_JOURNEY_COMBOBOX_HTML,
		journey: createBrowserJourneyFixture(
			[
				{
					action: 'type',
					arguments: { text: { parameter: 'place' } },
					target: { role: 'combobox', name: 'Destination' },
				},
			],
			{
				name: 'choose-destination',
				description: 'Choose a destination',
				parameters: { place: { default: 'Harbor' } },
			},
		),
		inputs: {},
		state:
			"({ value: document.querySelector('main input').value, clicks: document.body.dataset.clicks ?? '' })",
		outcome: [{ value: 'Harbor', clicks: '' }],
	},
	{
		name: 'form whose submit navigates',
		route: '/form',
		journey: createBrowserJourneyFixture(
			[
				{
					action: 'type',
					arguments: { text: { parameter: 'name' }, submit: true },
					target: { role: 'textbox', name: 'Name' },
				},
				{ action: 'wait', arguments: { text: 'Delivery booked for Grace Hopper' } },
			],
			{
				name: 'book-delivery',
				description: 'Book a delivery under a name',
				parameters: { name: { default: 'Ada' } },
			},
		),
		inputs: { name: 'Grace Hopper' },
		state:
			"({ path: location.pathname + location.search, summary: document.getElementById('summary')?.textContent ?? '' })",
		outcome: [
			{
				path: '/form/placed?name=Grace+Hopper&notes=Leave+at+the+door&speed=Standard',
				summary: 'Delivery booked for Grace Hopper at Standard speed.',
			},
		],
	},
	{
		name: 'click that opens a dialog',
		route: '/confirm',
		journey: createBrowserJourneyFixture(
			[
				{ action: 'click', arguments: {}, target: { role: 'button', name: 'Delete' } },
				{ action: 'dialog', arguments: { accept: true } },
				{ action: 'click', arguments: {}, target: { role: 'button', name: 'Keep' } },
			],
			{ name: 'delete-draft', description: 'Delete the draft and keep the page' },
		),
		inputs: {},
		state:
			"({ answer: document.body.dataset.answer ?? '', kept: document.body.dataset.kept ?? '0' })",
		outcome: [{ answer: 'true', kept: '1' }],
	},
	{
		name: 'click that opens a popup',
		route: '/popup',
		journey: createBrowserJourneyFixture(
			[
				{ action: 'click', arguments: {}, target: { role: 'button', name: 'Open details' } },
				{ action: 'click', arguments: {}, target: { role: 'button', name: 'Like' } },
			],
			{ name: 'like-details', description: 'Like the details a popup shows' },
		),
		inputs: {},
		state:
			"({ path: location.pathname, stayed: document.body.dataset.stayed ?? 'no', liked: document.body.dataset.liked ?? 'no' })",
		outcome: [
			{ path: '/popup', stayed: 'no', liked: 'no' },
			{ path: '/popup/child', stayed: 'no', liked: 'yes' },
		],
	},
])

/** Reads the `/form` route's click log and whether its `Save draft` button saved the draft. */
export const BROWSER_JOURNEY_DRAFT_STATE =
	"({ clicks: document.body.dataset.clicks ?? '', saved: document.body.dataset.saved ?? 'no' })"

/**
 * Holds a journey whose gap follows a click that saves the form page's draft: the module and the
 * replay both refuse it before that click, so the page's click log stays empty.
 */
export const BROWSER_JOURNEY_GAP_CASE: BrowserJourneyModuleCase = Object.freeze({
	name: 'gap after a click',
	route: '/form',
	journey: createBrowserJourneyFixture(
		[
			{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
			{ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
			{ action: 'click', arguments: {}, target: { role: 'button', name: 'Submit' } },
		],
		{ name: 'save-draft', description: 'Save the delivery draft and submit it' },
	),
	inputs: {},
	state: BROWSER_JOURNEY_DRAFT_STATE,
	outcome: [{ clicks: '', saved: 'no' }],
})

/**
 * Rewrites a generated JavaScript module so the toolset it constructs records every action it
 * performs into an exported `actions` array, leaving every step call as generated.
 *
 * @param source - The JavaScript source `compileBrowserJourney` returned
 * @returns The source with `export const actions = []` before `execute` and an `action` hook on the
 * toolset's construction
 * @throws Thrown when the source declares no `execute` or constructs no toolset over its page.
 */
export function instrumentBrowserJourneyModule(source: string): string {
	const declaration = 'export async function execute('
	const construction = '\tconst toolset = createBrowserToolset(page)\n'
	if (!source.includes(declaration) || !source.includes(construction))
		throw new Error('The module declares no execute that constructs a toolset over its page')
	return source
		.replace(declaration, `export const actions = []\n\n${declaration}`)
		.replace(
			construction,
			'\tconst toolset = createBrowserToolset(page, { on: { action: (action) => actions.push(action) } })\n',
		)
}

/**
 * Opens a fresh page on a fixture URL and writes a case's markup into its `main`.
 *
 * @param context - The context the page opens in
 * @param url - The fixture URL
 * @param markup - The HTML that replaces the children of `main`; the route's own markup stays when
 * absent
 * @returns The opened page
 */
export async function openBrowserJourneyPage<
	P extends { evaluate(expression: string): Promise<unknown> },
>(
	context: { create(options: { readonly url: string }): Promise<P> },
	url: string,
	markup?: string,
): Promise<P> {
	const page = await context.create({ url })
	if (markup !== undefined)
		await page.evaluate(`document.querySelector('main').innerHTML = ${JSON.stringify(markup)}`)
	return page
}

/**
 * Reads a page's state and the state of each popup it opened.
 *
 * @param pages - Every page the context holds
 * @param page - The page a run started on
 * @param expression - The page expression whose value is the fixture's state
 * @returns The value on `page`, then the value on each page whose `opener` is `page`, in context
 * order
 */
export async function readBrowserJourneyOutcome<
	P extends { readonly opener: unknown; evaluate(expression: string): Promise<unknown> },
>(pages: readonly P[], page: P, expression: string): Promise<readonly unknown[]> {
	const shown = [page, ...pages.filter((candidate) => candidate.opener === page)]
	return Promise.all(shown.map((candidate) => candidate.evaluate(expression)))
}

/**
 * Holds a `Slow` button for the `/confirm` route whose click handler occupies the page for 1 500 ms
 * before it sets `document.body.dataset.slow`, so the protocol reply of the input stays pending
 * while the handler runs.
 */
export const BROWSER_JOURNEY_SLOW_HTML =
	'<button id="slow" type="button" onclick="const end = performance.now() + 1500; while (performance.now() < end); document.body.dataset.slow = \'done\'">Slow</button>'

/**
 * Holds the journey whose replay holds a toolset over the `/confirm` route: a click that opens the
 * confirm dialog, the dialog step that accepts it, and a wait for `Draft deleted`, which the proof
 * adds to the page after its foreign calls.
 */
export const BROWSER_JOURNEY_HOLD_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Delete' } },
		{ action: 'dialog', arguments: { accept: true } },
		{ action: 'wait', arguments: { text: 'Draft deleted' } },
	],
	{ name: 'delete-draft', description: 'Delete the draft' },
)

/**
 * Holds the journey whose first input the proof aborts while it is held: a click on the
 * {@link BROWSER_JOURNEY_SLOW_HTML} button, then a click on the `/confirm` route's `Keep` button.
 */
export const BROWSER_JOURNEY_ABORT_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Slow' } },
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Keep' } },
	],
	{ name: 'keep-draft', description: 'Keep the draft after a slow click' },
)

/**
 * Holds the `/form` journey whose wait never succeeds: `Save draft`, a wait for `Order shipped`,
 * which the route never shows, and `Review`, whose click the page's click log would record.
 */
export const BROWSER_JOURNEY_TIMEOUT_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
		{ action: 'wait', arguments: { text: 'Order shipped' } },
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Review' } },
	],
	{ name: 'review-draft', description: 'Review the saved draft' },
)

/**
 * Holds {@link BROWSER_JOURNEY_TIMEOUT_JOURNEY} with a wait for the route's heading, so every step
 * runs and the click log records the `Review` click.
 */
export const BROWSER_JOURNEY_TIMEOUT_CONTROL: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
		{ action: 'wait', arguments: { text: 'Delivery form' } },
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Review' } },
	],
	{ name: 'review-draft', description: 'Review the saved draft' },
)

/**
 * Counts the pointer, mouse, keyboard, and input events a document receives on
 * `document.body.dataset.events`, from zero, in the capture phase.
 */
export const BROWSER_JOURNEY_EVENT_COUNTER =
	"(() => { document.body.dataset.events = '0'; for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'beforeinput', 'input', 'change']) document.addEventListener(type, () => { document.body.dataset.events = String(Number(document.body.dataset.events) + 1) }, true) })()"

/**
 * Describes one journey a replay must refuse at preparation.
 *
 * @remarks
 * - `inputs` — the inputs the replay receives
 * - `code` — the `BrowserError` code the refusal carries
 */
export interface BrowserJourneyPreparationCase {
	readonly name: string
	readonly journey: BrowserJourney
	readonly inputs: Readonly<Record<string, string>>
	readonly code: string
}

/**
 * Holds the `/form` journey the page-placement refusals start from: `Save draft`, then a `type`
 * into `Name` bound to the `name` parameter, which has no default.
 */
export const BROWSER_JOURNEY_PREPARED_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
		{
			action: 'type',
			arguments: { text: { parameter: 'name' } },
			target: { role: 'textbox', name: 'Name' },
		},
	],
	{ name: 'name-draft', description: 'Name the saved draft', parameters: { name: {} } },
)

/**
 * Holds the page-placement journeys a replay refuses at preparation, each after a first step that
 * would click `Save draft` on the `/form` route.
 */
export const BROWSER_JOURNEY_PREPARATION_CASES: readonly BrowserJourneyPreparationCase[] =
	Object.freeze([
		{
			name: 'a missing input',
			journey: BROWSER_JOURNEY_PREPARED_JOURNEY,
			inputs: {},
			code: 'BROWSER_JOURNEY_INPUT',
		},
		{
			name: 'an unknown input',
			journey: BROWSER_JOURNEY_PREPARED_JOURNEY,
			inputs: { name: 'Grace', nmae: 'Grace' },
			code: 'BROWSER_JOURNEY_INPUT',
		},
		{
			name: 'a gap',
			journey: createBrowserJourneyFixture(
				[
					{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
					{ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' },
				],
				{ name: 'gap-draft', description: 'Save the draft across a gap' },
			),
			inputs: {},
			code: 'BROWSER_JOURNEY_GAP',
		},
		{
			name: 'a switch without a context',
			journey: createBrowserJourneyFixture(
				[
					{ action: 'click', arguments: {}, target: { role: 'button', name: 'Save draft' } },
					{
						action: 'switch',
						arguments: {},
						tab: { url: 'http://127.0.0.1/popup/child', title: 'Details' },
					},
				],
				{ name: 'switch-draft', description: 'Save the draft and switch tabs' },
			),
			inputs: {},
			code: 'BROWSER_JOURNEY_PLACEMENT',
		},
	])

/**
 * Describes one journey a generated module refuses before its first step and a replay refuses at
 * preparation.
 *
 * @remarks
 * - `message` — the message of the error the module throws
 * - `code` — the `BrowserError` code the replay's refusal carries
 */
export interface BrowserJourneyRefusalCase extends BrowserJourneyModuleCase {
	readonly message: string
	readonly code: string
}

/**
 * Finds the one element that carries a role and an exact accessible name through the view's own
 * element manager, so a proof's direct side resolves its element without the toolset's `follow`.
 *
 * @param view - The view whose `elements.find` answers the query
 * @param target - The role and the exact accessible name
 * @returns The single element `find` returns with `exact: true`
 * @throws Error - Thrown when `find` returns no element or several
 */
export async function requireBrowserJourneyElement<E extends BrowserElementInterface>(
	view: { readonly elements: BrowserElementManagerInterface<E> },
	target: { readonly role: string; readonly name: string },
): Promise<E> {
	const matches = await view.elements.find({ role: target.role, name: target.name, exact: true })
	const [element] = matches
	if (matches.length !== 1 || element === undefined)
		throw new Error(
			`${matches.length} elements carry ${target.role} ${JSON.stringify(target.name)}, not one`,
		)
	return element
}

/**
 * Creates an inputs record whose one member holds a value of any type, as a JavaScript caller can
 * pass to a generated module or a replay.
 *
 * @param name - The input's name
 * @param value - The value the member holds; `undefined` makes an own member with no value
 * @returns A record typed as string inputs that holds `value` under `name`
 */
export function createBrowserJourneyMalformedInputs(
	name: string,
	value: unknown,
): Readonly<Record<string, string>> {
	const inputs: Record<string, string> = {}
	Reflect.set(inputs, name, value)
	return inputs
}

/**
 * Holds {@link BROWSER_JOURNEY_PREPARED_JOURNEY} with a default for its `name` parameter, so the
 * `type` into `Name` falls back to `Ada` when the input is omitted.
 */
export const BROWSER_JOURNEY_DEFAULTED_JOURNEY: BrowserJourney = {
	...BROWSER_JOURNEY_PREPARED_JOURNEY,
	name: 'retitle-draft',
	description: 'Name the saved draft, Ada by default',
	parameters: { name: { default: 'Ada' } },
}

/**
 * Holds the inputs on which a generated module and its replay both refuse before the `Save draft`
 * click, so the `/form` route's click log stays empty: no value for the required `name` of
 * {@link BROWSER_JOURNEY_PREPARED_JOURNEY}, a `nmae` that names no parameter, and a number for the
 * defaulted `name` of {@link BROWSER_JOURNEY_DEFAULTED_JOURNEY}.
 */
export const BROWSER_JOURNEY_INPUT_CASES: readonly BrowserJourneyRefusalCase[] = Object.freeze([
	{
		name: 'a missing input',
		route: '/form',
		journey: BROWSER_JOURNEY_PREPARED_JOURNEY,
		inputs: {},
		state: BROWSER_JOURNEY_DRAFT_STATE,
		outcome: [{ clicks: '', saved: 'no' }],
		message: 'name: the input is missing',
		code: 'BROWSER_JOURNEY_INPUT',
	},
	{
		name: 'an unknown input',
		route: '/form',
		journey: BROWSER_JOURNEY_PREPARED_JOURNEY,
		inputs: { name: 'Grace', nmae: 'Grace' },
		state: BROWSER_JOURNEY_DRAFT_STATE,
		outcome: [{ clicks: '', saved: 'no' }],
		message: 'nmae: no parameter has that name',
		code: 'BROWSER_JOURNEY_INPUT',
	},
	{
		name: 'a defaulted input that is not a string',
		route: '/form',
		journey: BROWSER_JOURNEY_DEFAULTED_JOURNEY,
		inputs: createBrowserJourneyMalformedInputs('name', 42),
		state: BROWSER_JOURNEY_DRAFT_STATE,
		outcome: [{ clicks: '', saved: 'no' }],
		message: 'name: the input is not a string',
		code: 'BROWSER_JOURNEY_INPUT',
	},
])

/**
 * Holds the `/document` journey the DOM placement refuses at preparation: a click on the
 * `Gift wrap` checkbox, then a `press`, which the DOM placement does not execute.
 */
export const BROWSER_JOURNEY_PRESS_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'checkbox', name: 'Gift wrap' } },
		{ action: 'press', arguments: { key: 'Enter' } },
	],
	{ name: 'wrap-press', description: 'Wrap the gift and press Enter' },
)

/**
 * Holds the `/document` journey the DOM placement refuses live at `s3`: a click on the `Gift wrap`
 * checkbox, a `type` of `Ribbon` into `Message`, and a click on `Wrap all`, which no element
 * carries.
 */
export const BROWSER_JOURNEY_PREFIX_JOURNEY: BrowserJourney = createBrowserJourneyFixture(
	[
		{ action: 'click', arguments: {}, target: { role: 'checkbox', name: 'Gift wrap' } },
		{
			action: 'type',
			arguments: { text: 'Ribbon' },
			target: { role: 'textbox', name: 'Message' },
		},
		{ action: 'click', arguments: {}, target: { role: 'button', name: 'Wrap all' } },
	],
	{ name: 'wrap-gift', description: 'Wrap the gift with a message' },
)

/**
 * Holds a sign-in form for the `/form` route's `main`: a `Password` field and a `Sign in` button
 * that sets `document.body.dataset.signed` to the length of the field's value, never the value.
 */
export const BROWSER_JOURNEY_PASSWORD_HTML =
	'<h1>Sign in</h1><label>Password <input id="password" type="password"></label><button id="sign" type="button" onclick="document.body.dataset.signed = String(document.getElementById(\'password\').value.length)">Sign in</button>'

/** Holds the secret the secrecy proof types; no fixture page or journey name carries its first four characters. */
export const BROWSER_JOURNEY_SECRET = 'Zq7#Marlin-Velvet'

/** Lists invalid names shared by the memory and file store proofs. */
export const BROWSER_STORE_INVALID_NAMES: readonly string[] = [
	'',
	'../escape',
	'Not-valid',
	'con',
	'lpt9',
	'a'.repeat(65),
]

/** Supplies a secret with characters whose JSON representation differs from its literal text. */
export const BROWSER_SELECT_SECRET = 'Zq7#Marlin-"Velvet"\n\\trail'

/** Supplies a select whose public option never contains the secret under test. */
export const BROWSER_SECRET_SELECT_HTML =
	'<select aria-label="Access level"><option value="public">Public</option></select>'

/** Records every run sent to the real memory store, including writes before the final result. */
export class RecordingBrowserRunStore extends MemoryBrowserRunStore {
	readonly writes = createRecorder<readonly [BrowserRun]>()

	override async set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void> {
		this.writes.handler(run)
		await super.set(run, options)
	}
}

/**
 * Creates a select protocol fixture that can return an upstream refusal quoting a secret.
 * @param message - Refusal text; omission selects the option successfully
 * @param name - Accessible name published by the fixture
 * @returns The real page and its recording protocol transport
 */
export async function createBrowserSecretSelectFixture(
	message?: string,
	name = 'Access level',
): Promise<BrowserElementFixture> {
	const fixture = await createBrowserElementFixture({
		accessibility: (request) =>
			fixture.transport.reply(
				request.id,
				request.params?.['frameId'] === 'child'
					? BROWSER_ELEMENT_CHILD_FIXTURE
					: {
							nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
								node.nodeId === 'email'
									? { ...node, role: { value: 'combobox' }, name: { value: name } }
									: node,
							),
						},
			),
		select: (request) =>
			fixture.transport.reply(
				request.id,
				message === undefined
					? { result: { value: true } }
					: { exceptionDetails: { exception: { description: message } } },
			),
	})
	return fixture
}

/** Holds table sizes that expose collection re-walk costs on an unvirtualized data grid. */
export const CAPTURE_TABLE_SIZES = Object.freeze([1000, 2000, 4000])

/** Holds the original indexed traversal as the guarded capture benchmark's control. */
export const CAPTURE_INDEXED_WALK = `let elementIndex = live.children.length - 1
			for (let index = live.childNodes.length - 1; index >= 0; index -= 1) {
				const child = live.childNodes[index]
				const mirror = twin.childNodes[index]
				if (child === undefined || mirror === undefined) continue
				let omitted = rendered && summary !== undefined && child !== summary
				if (rendered && live.shadowRoot !== null) {
					const slot =
						child instanceof view.Element || child instanceof view.Text ? child.assignedSlot : null
					if (slot === null) omitted = true
					for (
						let parent = slot;
						parent !== null && parent !== live;
						parent = parent.assignedSlot ?? parent.parentElement ?? (parent.parentNode instanceof view.ShadowRoot ? parent.parentNode.host : null)
					) {
						if (view.getComputedStyle(parent).display === 'none') omitted = true
					}
				}
				if (omitted || (child.nodeType === 3 && invisible)) mirror.parentNode?.removeChild(mirror)
				else if (child.nodeType === 1) {
					// Element collections retain their type across windowless owner realms.
					const element = live.children.item(elementIndex)
					const counterpart = twin.children.item(elementIndex)
					if (element !== null && counterpart !== null) pending.push({ live: element, twin: counterpart, visited: false })
				}
				if (child.nodeType === 1) elementIndex -= 1
			}`

/** Supplies the real-page projection fixture, shared with the retained AX datum probe. */
export const BROWSER_READING_HTML =
	'<h3><a href="/tea?q=1#cup">Cedar Tea</a></h3><ul><li>A list entry</li></ul><table><tr><th>Product</th><th>Price</th></tr><tr><td>Cedar</td><td>41</td></tr></table><img alt="Named image"><label>Account<input type="password" value="sample"></label><label>Account<input type="text" value="••••••"></label>'

/** Supplies heading, table-reference, image-escaping and hidden-content edge cases. */
export const BROWSER_READING_STRUCTURE_HTML =
	'<h2>Menu <a href="/tea">Tea</a> <a href="https://else.example/">Elsewhere</a></h2><div role="heading" aria-level="9">End</div><table><tr><td>Before <a href="/buy">Buy</a> after</td><td>9</td></tr></table><img alt="A &quot;quote&quot;"><img alt=""><p hidden>Hidden words</p>'
