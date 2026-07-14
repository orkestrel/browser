import type {
	CDPClientInterface,
	CDPClientOptions,
	CDPHandler,
	CDPTransportInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { isRecord, isString } from '@orkestrel/contract'

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
	#transport: CDPTransportInterface
	#messageId = 0
	#pending: Map<
		number,
		{
			resolve: (value: unknown) => void
			reject: (reason: unknown) => void
			timer: ReturnType<typeof setTimeout>
		}
	> = new Map()
	#subscriptions: Map<string, Set<CDPHandler>> = new Map()
	#sessionSubscriptions: Map<string, Map<string, Set<CDPHandler>>> = new Map()
	#connected = false
	#wired = false
	#timeout: number

	constructor(options: CDPClientOptions) {
		this.#transport = options.transport
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get connected(): boolean {
		return this.#connected
	}

	async connect(): Promise<void> {
		if (this.#connected) return

		if (!this.#wired) {
			this.#transport.emitter.on('message', (data) => this.#onMessage(data))
			this.#transport.emitter.on('close', () => this.#onClose())
			this.#transport.emitter.on('error', (error) => this.#onError(error))
			this.#wired = true
		}

		await this.#transport.start()
		this.#connected = true
	}

	async reconnect(): Promise<void> {
		await this.close()
		await this.connect()
	}

	async send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		sessionId?: string,
	): Promise<unknown> {
		if (!this.#connected) {
			throw new Error('CDP client is not connected')
		}

		const id = this.#nextId()
		const message: Record<string, unknown> = { id, method }

		if (params !== undefined) {
			message['params'] = params
		}
		if (sessionId !== undefined) {
			message['sessionId'] = sessionId
		}

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				reject(new Error(`CDP request timed out: ${method}`))
			}, this.#timeout)

			this.#pending.set(id, { resolve, reject, timer })

			this.#transport.send(JSON.stringify(message)).catch((thrown: unknown) => {
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

	async close(): Promise<void> {
		if (!this.#connected) return

		this.#connected = false

		// Reject all pending requests
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(new Error('CDP connection closed'))
			this.#pending.delete(id)
		}

		this.#subscriptions.clear()
		this.#sessionSubscriptions.clear()

		await this.#transport.close()
	}

	// === Private helpers

	#nextId(): number {
		this.#messageId += 1
		return this.#messageId
	}

	#onClose(): void {
		this.#connected = false

		// Reject all pending requests
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(new Error('CDP connection closed'))
			this.#pending.delete(id)
		}
	}

	#onError(error: unknown): void {
		if (!this.#connected) {
			for (const [id, entry] of this.#pending) {
				clearTimeout(entry.timer)
				entry.reject(new Error(`CDP connection failed: ${String(error)}`))
				this.#pending.delete(id)
			}
		}
	}

	#onMessage(data: string): void {
		let parsed: unknown
		try {
			parsed = JSON.parse(data)
		} catch {
			return
		}

		if (!isRecord(parsed)) return

		// Response to a pending request
		if (typeof parsed['id'] === 'number') {
			const id = parsed['id']
			const entry = this.#pending.get(id)
			if (entry !== undefined) {
				this.#pending.delete(id)
				clearTimeout(entry.timer)

				const errorValue = parsed['error']
				if (isRecord(errorValue)) {
					const message = isString(errorValue['message']) ? errorValue['message'] : 'CDP error'
					entry.reject(new Error(message))
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
				for (const handler of globalHandlers) {
					handler(params)
				}
			}

			// Fire session-scoped handlers
			const eventSessionId = parsed['sessionId']
			if (isString(eventSessionId)) {
				const sessionMap = this.#sessionSubscriptions.get(eventSessionId)
				if (sessionMap !== undefined) {
					const sessionHandlers = sessionMap.get(method)
					if (sessionHandlers !== undefined) {
						for (const handler of sessionHandlers) {
							handler(params)
						}
					}
				}
			}
		}
	}
}
