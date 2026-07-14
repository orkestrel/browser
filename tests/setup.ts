import type { CDPTarget, CDPTransportEventMap, CDPTransportInterface, ScreenshotWriterInterface } from '@src/core'
import { Emitter } from '@orkestrel/emitter'

// === Test recorder (AGENTS §16.1)

/** A real callback with recorded calls — used instead of a test-framework spy. */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a call recorder — a real function that records every invocation's
 * arguments for later inspection.
 *
 * @returns A {@link TestRecorderInterface}
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	let calls: TArgs[] = []

	return {
		get calls(): readonly TArgs[] {
			return calls
		},
		get count(): number {
			return calls.length
		},
		handler: (...args: TArgs): void => {
			calls.push(args)
		},
		clear(): void {
			calls = []
		},
	}
}

/** A single wait, in place of an inline `setTimeout` promise. */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
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
 * via `onSend` for that method (or `'*'` for all methods). Tests drive
 * server-initiated behavior with `reply` / `fail` (correlate a response by
 * id) and `event` (push a CDP event frame), or use the `onSend` hook to
 * script a response the moment a matching request arrives.
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
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

	function registerHandler(method: string, handler: CDPSentHandler): void {
		let list = handlers.get(method)
		if (list === undefined) {
			list = []
			handlers.set(method, list)
		}
		list.push(handler)
	}

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

			const id = typeof parsed['id'] === 'number' ? parsed['id'] : -1
			const method = typeof parsed['method'] === 'string' ? parsed['method'] : ''
			const params = isRecord(parsed['params']) ? parsed['params'] : undefined
			const sessionId = typeof parsed['sessionId'] === 'string' ? parsed['sessionId'] : undefined
			const message: CDPSentMessage = { id, method, params, sessionId }

			sent.push(message)

			for (const handler of handlers.get(method) ?? []) handler(message)
			for (const handler of handlers.get('*') ?? []) handler(message)
		},
		async close(): Promise<void> {
			closed = true
			started = false
		},
		onSend(method: string, handler: CDPSentHandler): void {
			registerHandler(method, handler)
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
 * Script an automatic success reply for the next (and every subsequent)
 * `send()` matching `method`, replying with `result`.
 *
 * @param transport - The fake transport to script
 * @param method - The CDP method to auto-reply to
 * @param result - The result value to resolve with
 */
export function replyOk(transport: CDPTestTransportInterface, method: string, result: unknown = {}): void {
	transport.onSend(method, (message) => transport.reply(message.id, result))
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
		type: 'page',
		title: 'Test Page',
		url: 'about:blank',
		...overrides,
	}
}

// === Fake screenshot writer

/** A fake {@link ScreenshotWriterInterface} recording every `write()` call. */
export interface FakeScreenshotWriterInterface extends ScreenshotWriterInterface {
	readonly calls: readonly { readonly path: string; readonly data: Uint8Array }[]
}

/**
 * Create an in-memory {@link ScreenshotWriterInterface} that records writes
 * instead of touching a filesystem.
 *
 * @returns A {@link FakeScreenshotWriterInterface}
 */
export function createScreenshotWriter(): FakeScreenshotWriterInterface {
	const calls: { path: string; data: Uint8Array }[] = []

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
