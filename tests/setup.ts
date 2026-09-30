import type {
	BrowserCallOptions,
	BrowserElementInterface,
	BrowserElementManagerInterface,
	BrowserFrameInterface,
	BrowserOutline,
	BrowserOutlineOptions,
	BrowserReadingInterface,
	BrowserViewInterface,
	CDPClientInterface,
	CDPTarget,
	CDPTransportEventMap,
	CDPTransportInterface,
	BrowserWriterInterface,
} from '@src/core'
import {
	BrowserCodegen,
	BrowserError,
	BrowserPage,
	createBrowserReading,
	createCDPClient,
} from '@src/core'
import { isNumber, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { waitForEvent } from '@orkestrel/test'

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
		const document = { body: { innerText: '' } }
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
		`
		const globalThis = {}
		const MutationObserver = observer
		const document = { body: { innerText: '' } }
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
	])
	callbacks[0]?.()
	return { timers, disconnects: counts.disconnects, result: await pending }
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
 */
export interface CDPTestTransportInterface extends CDPTransportInterface {
	readonly sent: readonly CDPSentMessage[]
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
	let started = false
	let closed = false

	return {
		emitter,
		get sent(): readonly CDPSentMessage[] {
			return sent
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

			for (const handler of handlers.get(method) ?? []) handler(message)
		},
		async close(): Promise<void> {
			const open = started
			closed = true
			started = false
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
			emitter.emit('message', JSON.stringify({ id, result }))
		},
		fail(id: number, message: string, code?: number): void {
			const error = code === undefined ? { message } : { code, message }
			emitter.emit('message', JSON.stringify({ id, error }))
		},
		event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void {
			const frame: Record<string, unknown> = { method, params: params ?? {} }
			if (sessionId !== undefined) frame['sessionId'] = sessionId
			emitter.emit('message', JSON.stringify(frame))
		},
		closeRemote(): void {
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

/** Configures protocol responses for discriminating element action tests. */
export interface BrowserElementFixtureOptions {
	readonly loaderless?: boolean
	readonly readiness?: CDPSentHandler
	readonly title?: CDPSentHandler
	readonly document?: CDPSentHandler
	readonly query?: CDPSentHandler
	readonly describe?: CDPSentHandler
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
	readonly registry?: CDPSentHandler
	readonly evaluation?: CDPSentHandler
}

/**
 * Scripts accessibility, DOM, isolated-world, and trusted-input replies without replacing project behavior.
 * @remarks
 * `WebMCP.enable` fails with the method-not-found code `-32601`, as Chromium 141 answers, unless
 * `registry` answers it. `released` answers a `mouseReleased` dispatch in place of the reply,
 * and `select` answers the select-option function call, so a test can withhold either.
 * @param transport - In-memory CDP boundary
 * @param options - Deliberate protocol refusal or observation
 */
export function scriptBrowserElements(
	transport: CDPTestTransportInterface,
	options?: BrowserElementFixtureOptions,
): void {
	replyOk(transport, 'Accessibility.enable')
	replyOk(transport, 'Runtime.releaseObject')
	for (const method of ['DOM.focus', 'DOM.scrollIntoViewIfNeeded'])
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
	replyOk(transport, 'Input.insertText')
	replyOk(transport, 'Input.dispatchKeyEvent')
	replyOk(transport, 'Page.captureScreenshot', { data: PNG_BASE64 })
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Page.setLifecycleEventsEnabled')
	replyOk(transport, 'Target.setAutoAttach')
	replyOk(transport, 'Page.getFrameTree', {
		frameTree: {
			frame: { id: 'main', url: 'https://example.test/cart' },
			childFrames: [
				{ frame: { id: 'child', parentId: 'main', url: 'https://example.test/checkout' } },
			],
		},
	})
	transport.onSend('Page.createIsolatedWorld', (message) =>
		transport.reply(message.id, {
			executionContextId: message.params?.['frameId'] === 'child' ? 92 : 91,
		}),
	)
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
		if (options?.gone === true) transport.fail(message.id, 'No node with given id found')
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
							: 3,
			frameId: message.sessionId === 'session-child' ? 'child' : 'main',
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
		if (isString(declaration) && declaration.includes('capture.html')) {
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
		} else if (options?.evaluation !== undefined) options.evaluation(message)
		else transport.reply(message.id, { result: { value: true } })
	})
}

/** Creates a page with a committed, DOM-ready document and scripted accessibility and DOM replies. */
export async function createBrowserElementFixture(
	options?: BrowserElementFixtureOptions,
): Promise<AttachedPageFixture> {
	const { client, transport } = await createConnectedCDPClient()
	scriptBrowserElements(transport, options)
	const page = new BrowserPage(
		client,
		'main',
		'session-main',
		undefined,
		'https://example.test/cart',
	)
	const attached = waitForEvent<readonly [BrowserFrameInterface]>((handler) => {
		page.emitter.on('session', handler)
		return () => page.emitter.off('session', handler)
	}, 'element iframe session')
	transport.event(
		'Target.attachedToTarget',
		{
			sessionId: 'session-child',
			targetInfo: { targetId: 'child', type: 'iframe', url: 'https://example.test/checkout' },
		},
		'session-main',
	)
	await attached
	if (options?.loaderless === true) return { client, transport, page }
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
	return { client, transport, page }
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
			text: [
				`page ${JSON.stringify(this.#title)} ${this.#url}`,
				...this.#elements.map(
					(element) => `${element.reference} ${element.role} ${JSON.stringify(element.name)}`,
				),
				`(${this.#elements.length} of ${this.#elements.length} elements)`,
			].join('\n'),
			count: this.#elements.length,
			total: this.#elements.length,
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

	async wait(text: string, options?: BrowserCallOptions): Promise<void> {
		options?.signal?.throwIfAborted()
		this.#calls.push(`wait ${text}`)
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

/**
 * Scripts target discovery, the target attach, and the required domain-enable handshake.
 *
 * @param transport - The fake transport to script
 * @param session - The session an attach answers with. Default: `session-1`
 * @param sessions - The session an attach to one target id answers with instead of `session`
 */
export function scriptCDPAttach(
	transport: CDPTestTransportInterface,
	session = 'session-1',
	sessions?: Readonly<Record<string, string>>,
): void {
	replyOk(transport, 'Target.setDiscoverTargets')
	transport.onSend('Target.attachToTarget', (message) => {
		const target = message.params?.['targetId']
		const named = isString(target) ? sessions?.[target] : undefined
		transport.reply(message.id, { sessionId: named ?? session })
	})
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Page.setLifecycleEventsEnabled')
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Network.enable')
	replyOk(transport, 'Network.disable')
	transport.onSend('Page.getFrameTree', (message) =>
		transport.reply(message.id, {
			frameTree: { frame: { id: `frame-${message.sessionId ?? session}`, url: 'about:blank' } },
		}),
	)
	replyOk(transport, 'Target.setAutoAttach')
	replyOk(transport, 'Page.setInterceptFileChooserDialog')
	replyOk(transport, 'Browser.setDownloadBehavior')
	replyOk(transport, 'Emulation.setTouchEmulationEnabled')
}

/** Reads a sent Runtime expression without a type assertion. */
export function readCDPExpression(message: CDPSentMessage | undefined): string | undefined {
	const expression = message?.params?.['expression']
	return isString(expression) ? expression : undefined
}

/** Lists the page history directions, in the order a history case matrix registers them. */
export const BROWSER_HISTORY_DIRECTIONS = ['back', 'forward'] as const

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
export async function createStartedCodegen(session = 'session-1'): Promise<StartedCodegenFixture> {
	const { client, transport } = await createConnectedCDPClient()
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Runtime.addBinding')
	replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
	replyOk(transport, 'Runtime.evaluate')
	replyOk(transport, 'Runtime.removeBinding')

	const codegen = new BrowserCodegen(client, session)
	await codegen.start()
	return { client, transport, codegen }
}

/** Creates the CDP payload the codegen binding delivers. */
export function createCodegenBindingPayload(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return { name: '__orkestrelBrowserCodegen', payload: JSON.stringify(payload) }
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
