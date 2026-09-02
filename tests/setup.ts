import type {
	CDPClientInterface,
	CDPTarget,
	CDPTransportEventMap,
	CDPTransportInterface,
	BrowserWriterInterface,
} from '@src/core'
import { BrowserCodegen, createCDPClient } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'

/** Ignore an intentional callback invocation. */
export function ignoreCall(): void {
	return undefined
}

/** Ignore an intentional asynchronous callback invocation. */
export function ignoreAsyncCall(): Promise<void> {
	return Promise.resolve()
}

/** Throw the stable listener failure used by emitter containment tests. */
export function throwListenerError(): never {
	throw new Error('listener failed')
}

/** Evaluate a JavaScript expression fixture and expose its result as unknown. */
export function evaluateJavaScript(expression: string): unknown {
	const evaluator = new Function(`return (${expression})`)
	return Reflect.apply(evaluator, undefined, [])
}

// === Fake CDP transport

/** One JSON-RPC frame recorded by the fake transport's `send()`. */
export interface CDPSentMessage {
	readonly id: number
	readonly method: string
	readonly params: Readonly<Record<string, unknown>> | undefined
	readonly sessionId: string | undefined
}

/** Handler invoked synchronously when the fake transport observes a matching `send()`. */
export type CDPSentHandler = (message: CDPSentMessage) => void

/**
 * An in-memory {@link CDPTransportInterface} for tests, plus scripting hooks.
 *
 * @remarks
 * `send()` records every frame in `sent` and invokes any handler registered
 * via `onSend` for that method. Tests drive
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
	fail(id: number, message: string): void
	event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void
	closeRemote(): void
	errorRemote(error: unknown): void
}

/** A connected client and the transport used to drive it. */
export interface ConnectedCDPFixture {
	readonly client: CDPClientInterface
	readonly transport: CDPTestTransportInterface
}

/**
 * Create a fake in-memory CDP transport for driving a real {@link CDPClient}
 * end-to-end in tests — no network, no mocks of CDPClient behavior itself.
 *
 * @returns A {@link CDPTestTransportInterface}
 */
export function createCDPTransport(): CDPTestTransportInterface {
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

			if (typeof parsed['id'] !== 'number' || typeof parsed['method'] !== 'string') return
			const id = parsed['id']
			const method = parsed['method']
			const params = isRecord(parsed['params']) ? parsed['params'] : undefined
			const sessionId = typeof parsed['sessionId'] === 'string' ? parsed['sessionId'] : undefined
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
		fail(id: number, message: string): void {
			emitter.emit('message', JSON.stringify({ id, error: { message } }))
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
 * Create and connect a real CDP client over the in-memory test transport.
 *
 * @returns The connected client and its scriptable transport
 */
export async function createConnectedCDPClient(): Promise<ConnectedCDPFixture> {
	const transport = createCDPTransport()
	const client = createCDPClient({ transport })
	await client.connect()
	return { client, transport }
}

/**
 * Script an automatic success reply for the next (and every subsequent)
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

/** Script the target attach and required domain-enable handshake. */
export function scriptCDPAttach(transport: CDPTestTransportInterface, session = 'session-1'): void {
	replyOk(transport, 'Target.attachToTarget', { sessionId: session })
	replyOk(transport, 'Page.enable')
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Network.enable')
	replyOk(transport, 'Network.disable')
	replyOk(transport, 'Page.getFrameTree', {
		frameTree: { frame: { id: `frame-${session}`, url: 'about:blank' } },
	})
	replyOk(transport, 'Target.setAutoAttach')
	replyOk(transport, 'Page.setInterceptFileChooserDialog')
	replyOk(transport, 'Browser.setDownloadBehavior')
	replyOk(transport, 'Emulation.setTouchEmulationEnabled')
}

/** Read a sent Runtime expression without a type assertion. */
export function readCDPExpression(message: CDPSentMessage | undefined): string | undefined {
	const expression = message?.params?.['expression']
	return typeof expression === 'string' ? expression : undefined
}

/** Script a selector lookup that resolves as present. */
export function scriptSelectorPresent(
	transport: CDPTestTransportInterface,
	selector: string,
): void {
	scriptEvaluate(
		transport,
		(expression) =>
			expression.includes('new Promise') &&
			expression.includes('const query =') &&
			expression.includes(JSON.stringify(selector)),
		true,
	)
}

/**
 * Script the complete trusted-input path for one present selector.
 *
 * @param transport - Fake transport
 * @param selector - Selector resolved by the locator
 */
export function scriptTrustedSelector(
	transport: CDPTestTransportInterface,
	selector: string,
): void {
	scriptSelectorPresent(transport, selector)
	transport.onSend('Runtime.evaluate', (message) => {
		const expression = message.params?.['expression']
		if (
			message.params?.['returnByValue'] === false &&
			typeof expression === 'string' &&
			expression.includes(JSON.stringify(selector))
		) {
			transport.reply(message.id, { result: { objectId: 'object-1' } })
		}
	})
	replyOk(transport, 'Runtime.callFunctionOn', { result: { value: true } })
	replyOk(transport, 'DOM.getContentQuads', {
		quads: [[0, 0, 100, 0, 100, 40, 0, 40]],
	})
	replyOk(transport, 'Input.dispatchMouseEvent')
	replyOk(transport, 'Input.dispatchKeyEvent')
	replyOk(transport, 'Input.insertText')
	replyOk(transport, 'Runtime.releaseObject')
}

/** Script the nested frame tree shared by page frame tests. */
export function scriptFrameTree(transport: CDPTestTransportInterface): void {
	replyOk(transport, 'Page.getFrameTree', {
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
}

/** A fully started codegen fixture. */
export interface StartedCodegenFixture extends ConnectedCDPFixture {
	readonly codegen: BrowserCodegen
}

/** Create a connected client with a started codegen recorder. */
export async function createStartedCodegen(session = 'session-1'): Promise<StartedCodegenFixture> {
	const { client, transport } = await createConnectedCDPClient()
	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Runtime.addBinding')
	replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
	replyOk(transport, 'Runtime.evaluate')

	const codegen = new BrowserCodegen(client, session)
	await codegen.start()
	return { client, transport, codegen }
}

/** Create the CDP payload delivered by the codegen binding. */
export function createCodegenBindingPayload(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return { name: '__orkestrelBrowserCodegen', payload: JSON.stringify(payload) }
}

/**
 * Script a `Runtime.evaluate` response keyed by a predicate over the sent
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
		if (typeof expression === 'string' && matches(expression)) {
			transport.reply(message.id, { result: { value } })
		}
	})
}

// === Fixtures

/**
 * Build a {@link CDPTarget} fixture, overriding any fields.
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
 * Build a two-document `DOMSnapshot.captureSnapshot` result with sparse node
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

/** A {@link BrowserWriterInterface} recording every `write()` call. */
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

/** Base64 for bytes `[137, 80, 78, 71, 13]` (PNG-signature-prefixed). */
export const PNG_BASE64 = 'iVBORw0='

/** Base64 for bytes `[255, 216, 255, 224]` (JPEG-signature-prefixed). */
export const JPEG_BASE64 = '/9j/4A=='
