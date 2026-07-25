import type {
	CDPClientInterface,
	CDPClientOptions,
	CDPHandler,
	CDPTransportInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { CDPConnectionError, CDPError, CDPTimeoutError } from './errors.js'
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
 * Supports session-scoped event subscriptions: when a sessionId is
 * provided to subscribe/unsubscribe, the handler only fires for CDP
 * events carrying that sessionId. Global subscriptions (no sessionId)
 * continue to see ALL events for backwards compatibility.
 */
export class CDPClient implements CDPClientInterface {
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
	readonly #subscriptions: Map<string, Set<CDPHandler>> = new Map()
	readonly #sessionSubscriptions: Map<string, Map<string, Set<CDPHandler>>> = new Map()
	#connected = false
	#active = false
	#wired = false
	readonly #timeout: number
	#connecting: Promise<void> | undefined
	#closing: Promise<void> | undefined
	#closeRequested = false

	constructor(options: CDPClientOptions) {
		this.#transport = options.transport
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get connected(): boolean {
		return this.#connected
	}

	async connect(): Promise<void> {
		if (this.#closing !== undefined) await this.#closing
		if (this.#connected) return
		if (this.#connecting !== undefined) return this.#connecting

		this.#closeRequested = false
		const attempt = this.#start()
		this.#connecting = attempt
		try {
			await attempt
		} finally {
			if (this.#connecting === attempt) this.#connecting = undefined
		}
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
		sessionId?: string,
		timeout?: number,
	): Promise<unknown> {
		if (!this.#connected) {
			throw new CDPConnectionError('CDP client is not connected', { method })
		}

		const id = this.#nextId()
		const message: Record<string, unknown> = { id, method }

		if (params !== undefined) {
			message['params'] = params
		}
		if (sessionId !== undefined) {
			message['sessionId'] = sessionId
		}

		const serialized = JSON.stringify(message)
		const effectiveTimeout = timeout ?? this.#timeout

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

	subscribe(method: string, handler: CDPHandler, sessionId?: string): void {
		if (sessionId !== undefined) {
			let sessionMap = this.#sessionSubscriptions.get(sessionId)
			if (sessionMap === undefined) {
				sessionMap = new Map()
				this.#sessionSubscriptions.set(sessionId, sessionMap)
			}
			let handlers = sessionMap.get(method)
			if (handlers === undefined) {
				handlers = new Set()
				sessionMap.set(method, handlers)
			}
			handlers.add(handler)
		} else {
			let handlers = this.#subscriptions.get(method)
			if (handlers === undefined) {
				handlers = new Set()
				this.#subscriptions.set(method, handlers)
			}
			handlers.add(handler)
		}
	}

	unsubscribe(method: string, handler: CDPHandler, sessionId?: string): void {
		if (sessionId !== undefined) {
			const sessionMap = this.#sessionSubscriptions.get(sessionId)
			if (sessionMap !== undefined) {
				const handlers = sessionMap.get(method)
				if (handlers !== undefined) {
					handlers.delete(handler)
					if (handlers.size === 0) {
						sessionMap.delete(method)
					}
				}
				if (sessionMap.size === 0) {
					this.#sessionSubscriptions.delete(sessionId)
				}
			}
		} else {
			const handlers = this.#subscriptions.get(method)
			if (handlers !== undefined) {
				handlers.delete(handler)
				if (handlers.size === 0) {
					this.#subscriptions.delete(method)
				}
			}
		}
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
		const active = this.#closing
		if (active !== undefined) {
			await active
			return
		}

		const attempt = this.#stop()
		this.#closing = attempt
		try {
			await attempt
		} finally {
			if (this.#closing === attempt) this.#closing = undefined
		}
	}

	// === Private helpers

	async #start(): Promise<void> {
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
	}

	async #stop(): Promise<void> {
		if (this.#connecting !== undefined) {
			this.#closeRequested = true
			await this.#connecting.catch(() => undefined)
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

		try {
			await this.#transport.close()
		} finally {
			this.#active = false
		}
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

			// Fire global handlers (backwards compatible — see ALL events)
			const globalHandlers = this.#subscriptions.get(method)
			if (globalHandlers !== undefined) {
				this.#dispatch(globalHandlers, params)
			}

			// Fire session-scoped handlers
			const eventSessionId = parsed['sessionId']
			if (isString(eventSessionId)) {
				const sessionMap = this.#sessionSubscriptions.get(eventSessionId)
				if (sessionMap !== undefined) {
					const sessionHandlers = sessionMap.get(method)
					if (sessionHandlers !== undefined) {
						this.#dispatch(sessionHandlers, params)
					}
				}
			}
		}
	}

	#dispatch(handlers: ReadonlySet<CDPHandler>, params: Readonly<Record<string, unknown>>): void {
		for (const handler of [...handlers]) {
			try {
				handler(params)
			} catch {
				// One observer must not prevent sibling observers from receiving the event.
			}
		}
	}
}
