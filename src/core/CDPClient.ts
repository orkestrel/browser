import type {
	CDPClientEventMap,
	CDPClientInterface,
	CDPClientOptions,
	CDPHandler,
	CDPSendOptions,
	CDPTransportInterface,
} from './types.js'
import type { EmitterErrorHandler, EmitterInterface } from '@orkestrel/emitter'
import { BrowserTransition } from './BrowserTransition.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { CDPConnectionError, CDPError, CDPTimeoutError } from './errors.js'
import { Emitter } from '@orkestrel/emitter'
import { isInteger, isRecord, isString, parseJSON } from '@orkestrel/contract'

// === CDPClient

/**
 * Lightweight Chrome DevTools Protocol client over a {@link CDPTransportInterface}.
 *
 * @remarks
 * Sends JSON-RPC messages over the injected transport and dispatches
 * responses and events. The transport owns the connection itself
 * (WebSocket, pipe, or any other duplex channel); this class owns only
 * the JSON-RPC framing and id/session correlation.
 *
 * Supports session-scoped event subscriptions: a subscription registered
 * without a session id receives the event whatever session carries it, and a
 * session-scoped subscription receives only its own session's events.
 *
 * @example
 * ```ts
 * import { CDPClient } from '@orkestrel/browser'
 *
 * const client = new CDPClient({ transport })
 * await client.connect()
 * const targets = await client.send('Target.getTargets')
 * await client.close()
 * ```
 */
export class CDPClient implements CDPClientInterface {
	readonly #emitter: Emitter<CDPClientEventMap>
	readonly #transport: CDPTransportInterface
	#messageId = 0
	readonly #pending: Map<
		number,
		{
			method: string
			resolve: (value: unknown) => void
			reject: (reason: unknown) => void
			timer: ReturnType<typeof setTimeout>
		}
	> = new Map()
	readonly #subscriptions: Map<string | undefined, Map<string, Set<CDPHandler>>> = new Map()
	#connected = false
	#active = false
	#wired = false
	readonly #timeout: number
	readonly #error: EmitterErrorHandler | undefined
	readonly #connecting: BrowserTransition = new BrowserTransition()
	readonly #closing: BrowserTransition = new BrowserTransition()
	#closeRequested = false
	// Set while this client is the one closing the transport, so the transport
	// `close` a teardown produces reports `close` rather than `drop`.
	#expected = false

	constructor(options: CDPClientOptions) {
		this.#transport = options.transport
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		this.#error = options.error
		this.#emitter = new Emitter({
			...(options.on !== undefined ? { on: options.on } : {}),
			...(options.error !== undefined ? { error: options.error } : {}),
		})
	}

	get emitter(): EmitterInterface<CDPClientEventMap> {
		return this.#emitter
	}

	get connected(): boolean {
		return this.#connected
	}

	async connect(): Promise<void> {
		const closing = this.#closing.pending
		if (closing !== undefined) await closing
		if (this.#connected) return
		const active = this.#connecting.pending
		if (active !== undefined) return await active

		this.#closeRequested = false
		this.#expected = false
		await this.#connecting.execute(() => this.#connect())
	}

	/**
	 * Close the transport and re-establish a fresh connection.
	 *
	 * @remarks
	 * Client-level subscriptions (`subscribe`/`unsubscribe` registrations)
	 * survive `close()` and remain active after the reconnect — only pending
	 * in-flight requests are rejected. This lets a caller reconnect a dropped
	 * transport without re-registering every handler.
	 */
	async reconnect(): Promise<void> {
		await this.close()
		await this.connect()
	}

	async send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: CDPSendOptions,
	): Promise<unknown> {
		if (!this.#connected) {
			throw new CDPConnectionError('CDP client is not connected', { method })
		}

		const id = this.#nextId()
		const message: Record<string, unknown> = { id, method }

		if (params !== undefined) {
			message['params'] = params
		}
		if (options?.session !== undefined) {
			message['sessionId'] = options.session
		}

		const serialized = JSON.stringify(message)
		const effectiveTimeout = options?.timeout ?? this.#timeout

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				reject(
					new CDPTimeoutError(`CDP request timed out: ${method}`, {
						method,
						timeout: effectiveTimeout,
					}),
				)
			}, effectiveTimeout)

			this.#pending.set(id, { method, resolve, reject, timer })

			this.#transport.send(serialized).catch((thrown: unknown) => {
				this.#pending.delete(id)
				clearTimeout(timer)
				reject(thrown)
			})
		})
	}

	subscribe(method: string, handler: CDPHandler, session?: string): void {
		let methods = this.#subscriptions.get(session)
		if (methods === undefined) {
			methods = new Map()
			this.#subscriptions.set(session, methods)
		}
		let handlers = methods.get(method)
		if (handlers === undefined) {
			handlers = new Set()
			methods.set(method, handlers)
		}
		handlers.add(handler)
	}

	unsubscribe(method: string, handler: CDPHandler, session?: string): void {
		const methods = this.#subscriptions.get(session)
		if (methods === undefined) return
		const handlers = methods.get(method)
		if (handlers !== undefined) {
			handlers.delete(handler)
			if (handlers.size === 0) methods.delete(method)
		}
		if (methods.size === 0) this.#subscriptions.delete(session)
	}

	/**
	 * Close the transport and reject all pending requests.
	 *
	 * @remarks
	 * Subscriptions registered via `subscribe()` are client-level
	 * registrations, not connection-level state — they survive `close()`
	 * (and a subsequent `reconnect()`/`connect()`) and keep firing once the
	 * transport is active again. Only pending requests are rejected here.
	 * If `close()` is called while `connect()` is still awaiting
	 * `transport.start()`, the in-flight connect is rejected and the
	 * transport is closed deterministically once `start()` resolves.
	 */
	async close(): Promise<void> {
		await this.#closing.execute(() => this.#close())
	}

	// === Private helpers

	async #connect(): Promise<void> {
		if (!this.#wired) {
			this.#transport.emitter.on('message', (data) => this.#onMessage(data))
			this.#transport.emitter.on('close', () => this.#onClose())
			this.#transport.emitter.on('error', (error) => this.#onError(error))
			this.#wired = true
		}

		await this.#transport.start()
		this.#active = true

		if (this.#closeRequested) {
			this.#closeRequested = false
			this.#expected = true
			try {
				await this.#transport.close()
			} finally {
				this.#active = false
			}
			throw new CDPConnectionError('CDP client was closed while connecting', {
				method: 'connect',
			})
		}

		this.#connected = true
		this.#emitter.emit('connect')
	}

	async #close(): Promise<void> {
		const connecting = this.#connecting.pending
		if (connecting !== undefined) {
			this.#closeRequested = true
			await connecting.catch(() => undefined)
			// The in-flight attempt may have already flipped #connected to
			// true before observing #closeRequested (race between the
			// attempt's final steps and #closeRequested being set here).
			// Fall through to the normal connected-close path instead of
			// returning early, or the close would be silently lost.
		}

		if (!this.#connected && !this.#active) return

		this.#connected = false

		// Reject all pending requests
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(new CDPConnectionError('CDP connection closed', { method: entry.method }))
			this.#pending.delete(id)
		}

		this.#expected = true
		try {
			await this.#transport.close()
		} finally {
			this.#active = false
		}
		this.#emitter.emit('close')
	}

	#nextId(): number {
		this.#messageId += 1
		return this.#messageId
	}

	#onClose(): void {
		this.#connected = false
		this.#active = false

		// Reject all pending requests
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(new CDPConnectionError('CDP connection closed', { method: entry.method }))
			this.#pending.delete(id)
		}
		if (!this.#expected) this.#emitter.emit('drop')
	}

	#onError(error: unknown): void {
		this.#connected = false
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(
				new CDPConnectionError(`CDP connection failed: ${String(error)}`, {
					method: entry.method,
					error,
				}),
			)
			this.#pending.delete(id)
		}
		this.#emitter.emit('error', error)
	}

	#onMessage(data: string): void {
		const parsed = parseJSON(data)
		if (!isRecord(parsed)) return

		// Response to a pending request
		if (isInteger(parsed['id'])) {
			const id = parsed['id']
			const entry = this.#pending.get(id)
			if (entry !== undefined) {
				this.#pending.delete(id)
				clearTimeout(entry.timer)

				const errorValue = parsed['error']
				if (isRecord(errorValue)) {
					const message = isString(errorValue['message']) ? errorValue['message'] : 'CDP error'
					const context: Record<string, unknown> = { method: entry.method }
					if ('code' in errorValue) context['code'] = errorValue['code']
					context['message'] = message
					if ('data' in errorValue) context['data'] = errorValue['data']
					entry.reject(new CDPError(message, context))
				} else {
					entry.resolve('result' in parsed ? parsed['result'] : undefined)
				}
			}
			return
		}

		// CDP event
		if (isString(parsed['method'])) {
			const method = parsed['method']
			const rawParams = parsed['params']
			const params: Readonly<Record<string, unknown>> = isRecord(rawParams)
				? rawParams
				: Object.freeze({})

			const global = this.#subscriptions.get(undefined)?.get(method)
			if (global !== undefined) this.#dispatch(global, method, params)

			const session = parsed['sessionId']
			if (isString(session)) {
				const scoped = this.#subscriptions.get(session)?.get(method)
				if (scoped !== undefined) this.#dispatch(scoped, method, params)
			}
		}
	}

	#dispatch(
		handlers: ReadonlySet<CDPHandler>,
		method: string,
		params: Readonly<Record<string, unknown>>,
	): void {
		for (const handler of [...handlers]) {
			try {
				handler(params)
			} catch (thrown) {
				// One observer must not prevent sibling observers from receiving the
				// event, so the throw is reported rather than propagated.
				this.#error?.(thrown, method)
			}
		}
	}
}
