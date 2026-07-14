import type { CDPTransportEventMap, CDPTransportInterface } from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { WebSocketCDPTransportOptions } from '../types.js'
import { isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BROWSER_DEFAULT_TIMEOUT_MS } from '@src/core'
import { BrowserConnectionError } from '../errors.js'

// === WebSocketCDPTransport

/**
 * Node `WebSocket`-backed {@link CDPTransportInterface} — the dumb text pipe
 * a {@link import('@src/core').CDPClientInterface} sends and receives
 * JSON-RPC frames over.
 *
 * @remarks
 * Uses the Node ≥24 native `WebSocket` global directly — no hand-rolled
 * upgrade handshake. `start()` opens a fresh socket (safe to call again
 * after `close()` — a new `WebSocket` is created each time, which is what
 * `CDPClient.reconnect()` depends on). CDP frames are text-only, so
 * `message` always carries a `string`.
 */
export class WebSocketCDPTransport implements CDPTransportInterface {
	readonly #emitter: Emitter<CDPTransportEventMap>
	readonly #url: string
	readonly #timeout: number
	#socket: WebSocket | undefined
	#connecting:
		| {
				readonly socket: WebSocket
				readonly timer: ReturnType<typeof setTimeout>
				readonly reject: (error: unknown) => void
		  }
		| undefined

	constructor(options: WebSocketCDPTransportOptions) {
		this.#emitter = new Emitter()
		this.#url = options.url
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get emitter(): EmitterInterface<CDPTransportEventMap> {
		return this.#emitter
	}

	async start(): Promise<void> {
		const socket = new WebSocket(this.#url)

		await new Promise<void>((resolve, reject) => {
			const settle = (fn: () => void): void => {
				this.#connecting = undefined
				fn()
			}

			const timer = setTimeout(() => {
				socket.close()
				settle(() =>
					reject(
						new BrowserConnectionError(
							`WebSocket CDP connection to ${this.#url} timed out after ${this.#timeout}ms`,
							{ url: this.#url, timeout: this.#timeout },
						),
					),
				)
			}, this.#timeout)

			const onOpen = (): void => {
				clearTimeout(timer)
				settle(resolve)
			}

			const onError = (event: Event): void => {
				clearTimeout(timer)
				settle(() =>
					reject(
						new BrowserConnectionError(
							`WebSocket CDP connection to ${this.#url} failed: ${this.#detail(event)}`,
							{ url: this.#url },
						),
					),
				)
			}

			socket.addEventListener('open', onOpen, { once: true })
			socket.addEventListener('error', onError, { once: true })

			this.#connecting = {
				socket,
				timer,
				reject: (error) => settle(() => reject(error)),
			}
		})

		this.#socket = socket
		this.#bind(socket)
	}

	async send(data: string): Promise<void> {
		const socket = this.#socket
		if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket CDP transport is not open')
		}
		socket.send(data)
	}

	async close(): Promise<void> {
		const connecting = this.#connecting
		if (connecting !== undefined) {
			clearTimeout(connecting.timer)
			this.#connecting = undefined
			connecting.socket.close()
			connecting.reject(
				new BrowserConnectionError(
					`WebSocket CDP connection to ${this.#url} was closed before it finished connecting`,
					{ url: this.#url },
				),
			)
			return
		}

		const socket = this.#socket
		if (socket === undefined) return
		if (socket.readyState === WebSocket.CLOSED) {
			this.#socket = undefined
			return
		}

		await new Promise<void>((resolve) => {
			socket.addEventListener('close', () => resolve(), { once: true })
			socket.close()
		})

		this.#socket = undefined
	}

	// === Private helpers

	#detail(event: Event): string {
		if (isRecord(event) && isString(event['message']) && event['message'].length > 0) {
			return event['message']
		}
		return event.type
	}

	#bind(socket: WebSocket): void {
		socket.addEventListener('message', (event) => {
			const data = typeof event.data === 'string' ? event.data : String(event.data)
			this.#emitter.emit('message', data)
		})

		socket.addEventListener('close', () => {
			this.#emitter.emit('close')
		})

		socket.addEventListener('error', (event) => {
			this.#emitter.emit('error', event)
		})
	}
}
