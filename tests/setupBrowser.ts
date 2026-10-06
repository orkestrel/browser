import type { BrowserDOMElementInterface, BrowserDOMViewInterface } from '@src/browser'
import type { ModelContextInterface } from '@orkestrel/mcp/browser'
import type { ModelContextFixtureInterface } from './fixtures/modelContext.js'
import type { RecorderInterface } from '@orkestrel/test'
import type { BrowserReadingInput } from '@src/core'
import {
	compileReadFunction,
	compileGuardedEvaluateExpression,
	BROWSER_RESULT_LIMIT,
} from '@src/core'
import { isFunction, isRecord, isString } from '@orkestrel/contract'
import { afterEach, inject } from 'vitest'
import { createModelContext } from '@orkestrel/mcp/browser'
import { createRecorder, requireValue, waitForEvent } from '@orkestrel/test'
import { installModelContext } from './fixtures/modelContext.js'

const frames = new Set<HTMLIFrameElement>()

/** Evaluates a compiler expression in the real window owning a fixture document.
 * @param document - Real fixture document
 * @param expression - Compiled JavaScript expression
 * @returns The expression's value
 */
export function evaluateProbeDocument(document: Document, expression: string): unknown {
	const view = requireValue(document.defaultView)
	const evaluate: unknown = Reflect.get(view, 'eval')
	if (!isFunction(evaluate)) throw new Error('The fixture has no evaluator')
	return Reflect.apply(evaluate, view, [expression])
}

/**
 * Executes the CDP capture declaration against a real DOM root.
 * @param root - The capture root
 * @returns The validated capture
 */
export function readCompiledCapture(root: Element): BrowserReadingInput {
	const result: unknown = new Function(
		'document',
		'root',
		`return ${compileGuardedEvaluateExpression(`(${compileReadFunction()})(root)`, BROWSER_RESULT_LIMIT)}`,
	)(root.ownerDocument, root)
	if (
		!isRecord(result) ||
		!isString(result['url']) ||
		!isString(result['title']) ||
		!isString(result['html'])
	)
		throw new Error('Invalid compiled capture')
	return { url: result['url'], title: result['title'], html: result['html'] }
}

afterEach(() => {
	for (const frame of frames) frame.remove()
	frames.clear()
})

/**
 * Holds the markup of the page the P7 reading probe and the P8 outline probe read: navigation
 * links, a heading, a paragraph, a labelled button, a labelled text field, and a footer.
 */
export const PROBE_PAGE = `<!doctype html><html><head><title>Probe</title></head><body>
<nav aria-label="Site"><a href="/one">One</a><a href="/two">Two</a></nav>
<main><h1>Probe page</h1><p>A paragraph the reader wants.</p>
<button aria-label="Save">Save</button>
<label>Email <input name="email"></label>
<div id="late"></div></main>
<footer>Footer chrome nobody reads</footer>
</body></html>`

/** Holds the probe page's document and the elements the proofs drive. */
export interface ProbeElements {
	/** The `iframe` element the test owns; it is removed after the test. */
	readonly frame: Element
	/** The probe page's document. */
	readonly document: Document
	/** The button labelled `Save`. */
	readonly save: HTMLButtonElement
	/** The text field labelled `Email`. */
	readonly email: HTMLInputElement
	/** The navigation link `One`. */
	readonly one: HTMLAnchorElement
	/** The empty `div` a proof appends late content to. */
	readonly late: HTMLDivElement
}

/** Pairs a registry double installed on a probe document with the real bridge over it. */
export interface ProbeBridge {
	/** The registry double and the recorders over its state. */
	readonly registry: ModelContextFixtureInterface
	/** The bridge `createModelContext` returns for the document. */
	readonly bridge: ModelContextInterface
}

/**
 * Reads the fixture server origin the global setup provides.
 *
 * @returns The loopback origin, without a trailing slash
 */
export function readBrowserFixtureBase(): string {
	return inject('server')
}

/**
 * Builds a same-origin document inside an iframe the test owns.
 *
 * @param html - The markup written into the document
 * @returns The iframe's document; the iframe is removed after the test
 */
export function createProbeDocument(html: string): Document {
	const frame = document.createElement('iframe')
	document.body.append(frame)
	frames.add(frame)
	const probe = frame.contentDocument
	if (probe === null) throw new Error('probe iframe has no document')
	probe.open()
	probe.write(html)
	probe.close()
	return probe
}

/**
 * Builds a probe document from markup and returns the element a CSS query names in it.
 *
 * @param markup - The markup written into the probe document
 * @param css - The CSS query naming the element
 * @returns The first element the query matches
 * @throws Thrown when the query matches nothing.
 */
export function readProbeCase(markup: string, css: string): Element {
	return requireValue(createProbeDocument(markup).querySelector(css), css)
}

/**
 * Loads markup as the `srcdoc` of an iframe the test owns and waits for its `load`.
 *
 * @remarks
 * A `srcdoc` document is a navigated document rather than the initial `about:blank` one, so its
 * window fires the History and Navigation API events a navigation proof observes.
 *
 * @param html - The markup the iframe loads
 * @returns The loaded document; the iframe is removed after the test
 */
export async function loadProbeDocument(html: string): Promise<Document> {
	const probe = await loadProbeFrame(document, document.body, html)
	const frame = probe.defaultView?.frameElement
	if (frame instanceof HTMLIFrameElement) frames.add(frame)
	return probe
}

/**
 * Appends a `srcdoc` iframe holding markup to a parent node and waits for its `load`.
 *
 * @param host - The document the iframe element is created in
 * @param parent - The node the iframe is appended to: an element or a shadow root in `host`
 * @param html - The markup the iframe loads
 * @returns The loaded document
 */
export async function loadProbeFrame(
	host: Document,
	parent: ParentNode,
	html: string,
): Promise<Document> {
	const frame = host.createElement('iframe')
	const loaded = waitForEvent<[Event]>((listener) => {
		frame.addEventListener('load', listener, { once: true })
		return () => frame.removeEventListener('load', listener)
	}, 'probe iframe load')
	frame.srcdoc = html
	parent.append(frame)
	await loaded
	return requireValue(frame.contentDocument, 'probe iframe document')
}

/**
 * Builds the {@link PROBE_PAGE} inside a same-origin iframe the test owns.
 *
 * @returns The probe page's document and elements; the iframe is removed after the test
 */
export async function createProbeElements(): Promise<ProbeElements> {
	const probe = await loadProbeDocument(PROBE_PAGE)
	return {
		frame: requireValue(probe.defaultView?.frameElement, 'probe iframe'),
		document: probe,
		save: requireValue(probe.querySelector('button'), 'probe button'),
		email: requireValue(probe.querySelector('input'), 'probe input'),
		one: requireValue(probe.querySelector('a'), 'probe link'),
		late: requireValue(probe.querySelector('div'), 'probe late container'),
	}
}

/**
 * Installs the WebMCP registry double on a probe document and creates the real bridge over it.
 *
 * @param host - The probe document the registry is installed on
 * @returns The registry double and the bridge
 * @throws Thrown when the bridge refuses the document.
 */
export function createProbeBridge(host: Document): ProbeBridge {
	const registry = installModelContext(host)
	const bridge = requireValue(createModelContext({ document: host }), 'model context bridge')
	return { registry, bridge }
}

/**
 * Finds the first element of a DOM view that a CSS query matches.
 *
 * @param view - The view whose document is queried
 * @param css - The CSS query
 * @returns The first matching element
 * @throws Thrown when the query matches nothing.
 */
export async function findProbeElement(
	view: BrowserDOMViewInterface,
	css: string,
): Promise<BrowserDOMElementInterface> {
	const [element] = await view.elements.find({ css })
	return requireValue(element, `element ${css}`)
}

/**
 * Records the signal of every listener a target subscribes for one event type, and subscribes
 * each listener through the target's inherited `addEventListener`.
 *
 * @remarks
 * An `EventTarget` publishes no way to read back its subscriptions, so the recorder defines an
 * own `addEventListener` on the target that records the subscription's `signal` and delegates to
 * the inherited method unchanged. An aborted recorded signal is a released subscription.
 *
 * @param target - The event target the proof owns, such as a probe document's window
 * @param type - The event type whose subscriptions are recorded
 * @returns A recorder whose calls hold each subscription's signal, `undefined` when it had none
 */
export function recordProbeSubscriptions(
	target: EventTarget,
	type: string,
): RecorderInterface<[AbortSignal | undefined]> {
	const recorder = createRecorder<[AbortSignal | undefined]>()
	const inherited = target.addEventListener
	Object.defineProperty(target, 'addEventListener', {
		configurable: true,
		value: (
			event: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: AddEventListenerOptions | boolean,
		) => {
			if (event === type) recorder.handler(typeof options === 'object' ? options.signal : undefined)
			Reflect.apply(inherited, target, [event, listener, options])
		},
	})
	return recorder
}

/**
 * Reads an input's value through its realm's native prototype getter, past any own accessor a
 * framework's value tracker defines on the element.
 *
 * @param input - The input element to read
 * @returns The native value, or `undefined` when the element has no window
 */
export function readNativeValue(input: HTMLInputElement): unknown {
	const view = input.ownerDocument.defaultView
	if (view === null) return undefined
	const getter = Reflect.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.get
	return getter === undefined ? undefined : Reflect.apply(getter, input, [])
}

/** Describes one markup case: the markup, the CSS query naming the element, and the expectation. */
export interface ProbeCase<T> {
	readonly markup: string
	readonly css: string
	readonly expected: T
}

/**
 * Lists markup cases and the role the HTML Accessibility API Mappings give each queried element.
 */
export const PROBE_ROLE_CASES: ReadonlyArray<ProbeCase<string | undefined>> = Object.freeze([
	{ markup: '<button>Save</button>', css: 'button', expected: 'button' },
	{ markup: '<a href="/cars">Cars</a>', css: 'a', expected: 'link' },
	{ markup: '<a>Cars</a>', css: 'a', expected: undefined },
	{ markup: '<input>', css: 'input', expected: 'textbox' },
	{ markup: '<input type="bogus">', css: 'input', expected: 'textbox' },
	{ markup: '<input type="password">', css: 'input', expected: 'textbox' },
	{ markup: '<input type="checkbox">', css: 'input', expected: 'checkbox' },
	{ markup: '<input type="radio">', css: 'input', expected: 'radio' },
	{ markup: '<input type="search">', css: 'input', expected: 'searchbox' },
	{ markup: '<input list="makes">', css: 'input', expected: 'combobox' },
	{ markup: '<input type="range">', css: 'input', expected: 'slider' },
	{ markup: '<input type="number">', css: 'input', expected: 'spinbutton' },
	{ markup: '<input type="submit">', css: 'input', expected: 'button' },
	{ markup: '<input type="hidden">', css: 'input', expected: undefined },
	{ markup: '<input type="date">', css: 'input', expected: undefined },
	{ markup: '<textarea></textarea>', css: 'textarea', expected: 'textbox' },
	{ markup: '<select><option>Small</option></select>', css: 'select', expected: 'combobox' },
	{ markup: '<select multiple></select>', css: 'select', expected: 'listbox' },
	{ markup: '<select size="3"></select>', css: 'select', expected: 'listbox' },
	{ markup: '<select><option>Small</option></select>', css: 'option', expected: 'option' },
	{ markup: '<h3>Cart</h3>', css: 'h3', expected: 'heading' },
	{ markup: '<img alt="">', css: 'img', expected: 'none' },
	{ markup: '<img alt="Logo">', css: 'img', expected: 'img' },
	{ markup: '<div role="Button link"></div>', css: 'div', expected: 'button' },
	{ markup: '<div role="presentation"></div>', css: 'div', expected: 'none' },
	{ markup: '<div></div>', css: 'div', expected: undefined },
	{ markup: '<section></section>', css: 'section', expected: undefined },
	{ markup: '<section aria-label="Offers"></section>', css: 'section', expected: 'region' },
	{ markup: '<form></form>', css: 'form', expected: undefined },
	{ markup: '<form aria-label="Search"></form>', css: 'form', expected: 'form' },
	{ markup: '<header></header>', css: 'header', expected: 'banner' },
	{ markup: '<article><header></header></article>', css: 'header', expected: undefined },
	{ markup: '<nav></nav>', css: 'nav', expected: 'navigation' },
	{
		markup: '<table><tr><th scope="row">Total</th><td>48.00</td></tr></table>',
		css: 'th',
		expected: 'rowheader',
	},
	{ markup: '<table><tr><td>48.00</td></tr></table>', css: 'td', expected: 'cell' },
])

/** Lists markup cases and the accessible name of each queried element. */
export const PROBE_NAME_CASES: ReadonlyArray<ProbeCase<string>> = Object.freeze([
	{
		markup:
			'<span id="billing">Billing</span><span id="email">Email</span><input aria-labelledby="billing email" aria-label="Ignored">',
		css: 'input',
		expected: 'Billing Email',
	},
	{
		markup:
			'<span id="secret" hidden>Secret <span hidden>name</span></span><button aria-labelledby="secret">X</button>',
		css: 'button',
		expected: 'Secret name',
	},
	{
		markup: '<img id="caption" alt="Save"><button aria-labelledby="caption">Wrong</button>',
		css: 'button',
		expected: 'Save',
	},
	{
		markup:
			'<span id="visible">Pay <span hidden>later</span></span><button aria-labelledby="visible">X</button>',
		css: 'button',
		expected: 'Pay',
	},
	{
		markup: '<div role="button"><template shadowrootmode="open">Shadow save</template>Light</div>',
		css: 'div',
		expected: 'Shadow save',
	},
	{
		markup:
			'<div role="button"><template shadowrootmode="open"><b>Go </b><slot></slot></template>home</div>',
		css: 'div',
		expected: 'Go home',
	},
	{
		markup: '<button aria-label=" Close  dialog ">X</button>',
		css: 'button',
		expected: 'Close dialog',
	},
	{
		markup: '<input id="amount" value="5"><button aria-labelledby="amount">Wrong</button>',
		css: 'button',
		expected: '5',
	},
	{
		markup:
			'<span id="caption" style="visibility: hidden">Save</span><button aria-labelledby="caption">Wrong</button>',
		css: 'button',
		expected: 'Save',
	},
	{
		markup: '<img id="caption" title="Save"><button aria-labelledby="caption">Wrong</button>',
		css: 'button',
		expected: 'Save',
	},
	{
		markup:
			'<span id="caption">Visible <input style="visibility:hidden" value="Secret"></span><button aria-labelledby="caption"></button>',
		css: 'button',
		expected: 'Visible',
	},
	{
		markup:
			'<span id="caption">Visible <span style="visibility:hidden" aria-label="Secret"></span></span><button aria-labelledby="caption"></button>',
		css: 'button',
		expected: 'Visible',
	},
	{
		markup:
			'<span id="caption">Visible <span style="visibility:hidden" title="Secret"></span></span><button aria-labelledby="caption"></button>',
		css: 'button',
		expected: 'Visible',
	},
	{
		markup:
			'<span id="caption">Visible <img style="visibility:hidden" alt="Secret"></span><button aria-labelledby="caption"></button>',
		css: 'button',
		expected: 'Visible',
	},
	{
		markup:
			'<span id="caption">Visible <span style="visibility:hidden" title="Secret"><b style="visibility:visible">shown</b></span></span><button aria-labelledby="caption"></button>',
		css: 'button',
		expected: 'Visible shown',
	},
	{
		markup:
			'<span id="caption" style="visibility:hidden">Save <input value="Draft"></span><button aria-labelledby="caption">Wrong</button>',
		css: 'button',
		expected: 'Save Draft',
	},
	{
		markup:
			'<div role="button"><template shadowrootmode="open"><span><slot>Save</slot></span></template></div>',
		css: 'div',
		expected: 'Save',
	},
	{
		markup: '<button><span style="display: contents">Save</span></button>',
		css: 'button',
		expected: 'Save',
	},
	{
		markup: '<label>Email <input value="sam@example.test"></label>',
		css: 'input',
		expected: 'Email',
	},
	{ markup: '<input type="submit" value="Send">', css: 'input', expected: 'Send' },
	{ markup: '<input type="submit">', css: 'input', expected: 'Submit' },
	{ markup: '<input type="reset">', css: 'input', expected: 'Reset' },
	{ markup: '<img alt="Logo">', css: 'img', expected: 'Logo' },
	{ markup: '<input type="image" alt="Go">', css: 'input', expected: 'Go' },
	{ markup: '<label>Email <input></label>', css: 'input', expected: 'Email' },
	{ markup: '<label for="name">Name</label><input id="name">', css: 'input', expected: 'Name' },
	{
		markup: '<label>Size <select><option>Small</option></select></label>',
		css: 'select',
		expected: 'Size',
	},
	{ markup: '<button>  Save <b>draft</b> </button>', css: 'button', expected: 'Save draft' },
	{ markup: '<a href="/"><img alt="Home"></a>', css: 'a', expected: 'Home' },
	{
		markup:
			'<button>Save<span hidden> hidden</span><span aria-hidden="true"> muted</span></button>',
		css: 'button',
		expected: 'Save',
	},
	{ markup: '<a href="/"><div>Cars</div><div>Fleet</div></a>', css: 'a', expected: 'Cars Fleet' },
	{ markup: '<button><svg aria-label="Close"></svg></button>', css: 'button', expected: 'Close' },
	{ markup: '<button title="Tooltip">Save</button>', css: 'button', expected: 'Save' },
	{ markup: '<input title="Search" placeholder="Type">', css: 'input', expected: 'Search' },
	{ markup: '<input placeholder="Type here">', css: 'input', expected: 'Type here' },
	{ markup: '<div>Text</div>', css: 'div', expected: '' },
	{ markup: '<div title="Tip">Text</div>', css: 'div', expected: 'Tip' },
	{ markup: '<h2>Your <em>cart</em></h2>', css: 'h2', expected: 'Your cart' },
])

/** Lists markup cases and whether activating each queried element opens another browsing context. */
export const PROBE_POPUP_CASES: ReadonlyArray<ProbeCase<boolean>> = Object.freeze([
	{ markup: '<a href="/cars" target="_blank">Cars</a>', css: 'a', expected: true },
	{ markup: '<a href="/cars" target="_BLANK">Cars</a>', css: 'a', expected: true },
	{ markup: '<a href="/cars">Cars</a>', css: 'a', expected: false },
	{ markup: '<a href="/cars" target="_self">Cars</a>', css: 'a', expected: false },
	{ markup: '<a href="/cars" target="_top">Cars</a>', css: 'a', expected: false },
	{ markup: '<a href="/cars" target="_parent">Cars</a>', css: 'a', expected: false },
	{ markup: '<a target="_blank">Cars</a>', css: 'a', expected: false },
	{ markup: '<base target="_blank"><a href="/cars">Cars</a>', css: 'a', expected: true },
	{
		markup: '<a href="/cars" target="panel">Cars</a><iframe name="panel"></iframe>',
		css: 'a',
		expected: false,
	},
	{ markup: '<a href="/cars" target="elsewhere">Cars</a>', css: 'a', expected: true },
	{ markup: '<form target="_blank"></form>', css: 'form', expected: true },
	{ markup: '<form target="_blank"><button>Go</button></form>', css: 'button', expected: true },
	{
		markup: '<form target="_blank"><button formtarget="_self">Go</button></form>',
		css: 'button',
		expected: false,
	},
	{ markup: '<form target="_blank"><input></form>', css: 'input', expected: false },
	{
		markup: '<form target="_blank"><button type="button">Go</button></form>',
		css: 'button',
		expected: false,
	},
])

/**
 * Stands in for a weak reference whose target the collector reclaimed, the one state a proof
 * cannot produce on demand because it cannot force a collection.
 */
export class CollectedReference extends WeakRef<Element> {
	override deref(): Element | undefined {
		return undefined
	}
}

/** Supplies ARIA token normalization and pressed-state cases, including nontrimmed whitespace. */
export const PROBE_TOKEN_CASES = Object.freeze([
	{ token: 'true', normalized: 'true', pressed: 'true' },
	{ token: 'false', normalized: 'false', pressed: 'false' },
	{ token: 'mixed', normalized: 'mixed', pressed: 'mixed' },
	{ token: 'TRUE', normalized: 'true', pressed: 'true' },
	{ token: '', normalized: undefined, pressed: undefined },
	{ token: 'undefined', normalized: undefined, pressed: undefined },
	{ token: 'UNDEFINED', normalized: undefined, pressed: undefined },
	{ token: 'foo', normalized: 'foo', pressed: 'true' },
	{ token: ' false ', normalized: ' false ', pressed: 'true' },
	{ token: undefined, normalized: undefined, pressed: undefined },
])

/** Supplies the role restrictions, native overrides, and absent-state controls of the DOM mapping. */
export const PROBE_STATE_CASES = Object.freeze([
	{
		markup: '<div role="checkbox" aria-expanded="true"></div>',
		css: 'div',
		role: 'checkbox',
		expected: { expanded: true },
	},
	{
		markup: '<div role="switch" aria-expanded="true"></div>',
		css: 'div',
		role: 'switch',
		expected: { expanded: true },
	},
	{
		markup: '<div role="menuitem" aria-expanded="true"></div>',
		css: 'div',
		role: 'menuitem',
		expected: { expanded: true },
	},
	{
		markup: '<div role="menuitemcheckbox" aria-expanded="true"></div>',
		css: 'div',
		role: 'menuitemcheckbox',
		expected: { expanded: true },
	},
	{
		markup: '<div role="menuitemradio" aria-expanded="true"></div>',
		css: 'div',
		role: 'menuitemradio',
		expected: { expanded: true },
	},
	{ markup: '<a href="#" aria-pressed="true">Link</a>', css: 'a', role: 'link', expected: {} },
	{
		markup: '<button aria-expanded="false">Button</button>',
		css: 'button',
		role: 'button',
		expected: { expanded: false },
	},
	{
		markup: '<a href="#" aria-expanded="TRUE">Link</a>',
		css: 'a',
		role: 'link',
		expected: { expanded: true },
	},
	{
		markup: '<button role="tab" aria-expanded="true">Tab</button>',
		css: 'button',
		role: 'tab',
		expected: { expanded: true },
	},
	{
		markup: '<input role="combobox" aria-expanded="foo">',
		css: 'input',
		role: 'combobox',
		expected: { expanded: true },
	},
	{
		markup: '<input type="radio" aria-expanded="true" aria-selected="true" aria-pressed="true">',
		css: 'input',
		role: 'radio',
		expected: {},
	},
	{ markup: '<input aria-expanded="true">', css: 'input', role: 'textbox', expected: {} },
	{
		markup: '<select aria-expanded="true"><option>One</option></select>',
		css: 'select',
		role: 'combobox',
		expected: { expanded: false },
	},
	{
		markup: '<button role="tab">Tab</button>',
		css: 'button',
		role: 'tab',
		expected: {},
	},
	{
		markup: '<button role="tab" aria-selected="false">Tab</button>',
		css: 'button',
		role: 'tab',
		expected: { selected: false },
	},
	{
		markup: '<button role="tab" aria-selected="foo">Tab</button>',
		css: 'button',
		role: 'tab',
		expected: { selected: true },
	},
	{
		markup: '<select><option selected aria-selected="false">One</option></select>',
		css: 'option',
		role: 'option',
		expected: { selected: false },
	},
	{
		markup: '<select><option>One</option><option aria-selected="true">Two</option></select>',
		css: 'option:last-child',
		role: 'option',
		expected: { selected: true },
	},
	{
		markup: '<select><option selected aria-selected="undefined">One</option></select>',
		css: 'option',
		role: 'option',
		expected: { selected: true },
	},
	{
		markup: '<select><option>One</option><option>Two</option></select>',
		css: 'option:last-child',
		role: 'option',
		expected: { selected: false },
	},
	{
		markup:
			'<div role="tree"><div role="treeitem" aria-expanded="false" aria-selected="true">Item</div></div>',
		css: '[role="treeitem"]',
		role: 'treeitem',
		expected: { expanded: false, selected: true },
	},
	{
		markup: '<div role="tree"><div role="treeitem">Item</div></div>',
		css: '[role="treeitem"]',
		role: 'treeitem',
		expected: {},
	},
	{
		markup: '<div role="tablist"><button role="tab">Tab</button></div>',
		css: 'button',
		role: 'tab',
		expected: {},
	},
	{
		markup: '<div role="listbox"><div role="option">Item</div></div>',
		css: '[role="option"]',
		role: 'option',
		expected: {},
	},
	{
		markup: '<div role="listbox"><div role="option" aria-selected="false">Item</div></div>',
		css: '[role="option"]',
		role: 'option',
		expected: { selected: false },
	},
	{
		markup: '<div role="listbox"><div role="option" aria-selected="true">Item</div></div>',
		css: '[role="option"]',
		role: 'option',
		expected: { selected: true },
	},
	{
		markup: '<div role="listbox"><div role="option" aria-selected="">Item</div></div>',
		css: '[role="option"]',
		role: 'option',
		expected: {},
	},
	{
		markup: '<div role="listbox"><div role="option" aria-selected="undefined">Item</div></div>',
		css: '[role="option"]',
		role: 'option',
		expected: {},
	},
	{
		markup: '<details open><summary>Details</summary></details>',
		css: 'summary',
		role: '',
		expected: {},
	},
])
