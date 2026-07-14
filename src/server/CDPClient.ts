import type { CdpClientInterface, CdpHandler } from '../types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from '../constants.js'
import { isRecord, isString } from '@scsr/core'

// === CDPClient

/**
 * Lightweight Chrome DevTools Protocol client over WebSocket.
 *
 * @remarks
 * Sends JSON-RPC messages to a CDP endpoint and dispatches responses
 * and events. Uses the Node.js 22 native `WebSocket` global.
 *
 * Supports session-scoped event subscriptions: when a sessionId is
 * provided to subscribe/unsubscribe, the handler only fires for CDP
 * events carrying that sessionId. Global subscriptions (no sessionId)
 * continue to see ALL events for backwards compatibility.
 */
export class CDPClient implements CdpClientInterface {
	#socket: WebSocket | undefined
	#messageId = 0
	#pending: Map<
		number,
		{
			resolve: (value: unknown) => void
			reject: (reason: unknown) => void
			timer: ReturnType<typeof setTimeout>
		}
	> = new Map()
	#subscriptions: Map<string, Set<CdpHandler>> = new Map()
	#sessionSubscriptions: Map<string, Map<string, Set<CdpHandler>>> = new Map()
	#connected = false
	#endpoint: string | undefined
	#timeout: number

	constructor(timeout?: number) {
		this.#timeout = timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get connected(): boolean {
		return this.#connected
	}

	get endpoint(): string | undefined {
		return this.#endpoint
	}

	async connect(endpoint: string): Promise<void> {
		if (this.#connected) return
		this.#endpoint = endpoint

		return new Promise<void>((resolve, reject) => {
			const socket = new WebSocket(endpoint)

			const timer = setTimeout(() => {
				socket.close()
				reject(new Error(`CDP connection timed out after ${this.#timeout}ms`))
			}, this.#timeout)

			socket.addEventListener('open', () => {
				clearTimeout(timer)
				this.#socket = socket
				this.#connected = true
				resolve()
			})

			socket.addEventListener('error', (event) => {
				clearTimeout(timer)
				if (!this.#connected) {
					reject(new Error(`CDP connection failed: ${String(event)}`))
				}
			})

			socket.addEventListener('close', () => {
				this.#connected = false
				this.#socket = undefined
				// Reject all pending requests
				for (const [id, entry] of this.#pending) {
					clearTimeout(entry.timer)
					entry.reject(new Error('CDP connection closed'))
					this.#pending.delete(id)
				}
			})

			socket.addEventListener('message', (event) => {
				this.#onMessage(event.data)
			})
		})
	}

	async reconnect(): Promise<void> {
		if (this.#endpoint === undefined) {
			throw new Error('No endpoint to reconnect to')
		}
		await this.close()
		return this.connect(this.#endpoint)
	}

	async send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		sessionId?: string,
	): Promise<unknown> {
		if (this.#socket === undefined || !this.#connected) {
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

			try {
				this.#socket?.send(JSON.stringify(message))
			} catch (thrown) {
				this.#pending.delete(id)
				clearTimeout(timer)
				reject(thrown)
			}
		})
	}

	subscribe(method: string, handler: CdpHandler, sessionId?: string): void {
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

	unsubscribe(method: string, handler: CdpHandler, sessionId?: string): void {
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
		if (this.#socket === undefined) return

		const socket = this.#socket
		this.#socket = undefined
		this.#connected = false

		// Reject all pending requests
		for (const [id, entry] of this.#pending) {
			clearTimeout(entry.timer)
			entry.reject(new Error('CDP connection closed'))
			this.#pending.delete(id)
		}

		this.#subscriptions.clear()
		this.#sessionSubscriptions.clear()

		return new Promise<void>((resolve) => {
			socket.addEventListener('close', () => resolve())

			if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
				socket.close()
			} else {
				resolve()
			}
		})
	}

	// === Private helpers

	#nextId(): number {
		this.#messageId += 1
		return this.#messageId
	}

	#onMessage(data: unknown): void {
		if (typeof data !== 'string') return

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
