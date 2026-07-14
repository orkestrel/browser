import type { CDPTransportEventMap, CDPTransportInterface } from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import type { WebSocketCDPTransportOptions } from '../types.js'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import {
	computeWebSocketAccept,
	createNodeWebSocket,
	WEBSOCKET_READY_OPEN,
	WEBSOCKET_VERSION,
} from '@orkestrel/websocket'
import { BROWSER_DEFAULT_TIMEOUT_MS } from '@src/core'
import { BrowserConnectionError } from '../errors.js'

// === WebSocketCDPTransport

/**
 * `@orkestrel/websocket`-backed {@link CDPTransportInterface} — the dumb text
 * pipe a {@link import('@src/core').CDPClientInterface} sends and receives
 * JSON-RPC frames over.
 *
 * @remarks
 * `start()` hand-rolls the RFC 6455 client handshake: it opens a `node:http`
 * `GET` carrying `Connection: Upgrade` / `Upgrade: websocket` / a random
 * `Sec-WebSocket-Key` / `Sec-WebSocket-Version`, awaits the client `'upgrade'`
 * event, and validates `Sec-WebSocket-Accept === computeWebSocketAccept(key)`
 * — a mismatch (or a connection/request error, or a timeout) rejects `start()`
 * with a coded {@link BrowserConnectionError} and cleans up the socket. On
 * success it wraps the raw upgraded socket in `createNodeWebSocket({ socket,
 * head })` (CLIENT mode — no `key` — so outgoing frames are masked per RFC
 * 6455 §5.3) and bridges its `message`/`close`/`error` events onto this
 * transport's emitter. `start()` opens a fresh socket each call (safe to call
 * again after `close()` — a new request/socket/NodeWebSocket triple is
 * created every time, which is what `CDPClient.reconnect()` depends on). CDP
 * frames are text-only, so `message` always carries a `string`.
 */
export class WebSocketCDPTransport implements CDPTransportInterface {
	readonly #emitter: Emitter<CDPTransportEventMap>
	readonly #url: string
	readonly #timeout: number
	#socket: NodeWebSocketInterface | undefined
	#connecting:
		| {
				readonly abort: () => void
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
		const url = new URL(this.#url)
		const key = randomBytes(16).toString('base64')

		const ws = await new Promise<NodeWebSocketInterface>((resolve, reject) => {
			const settle = (fn: () => void): void => {
				this.#connecting = undefined
				fn()
			}

			const timer = setTimeout(() => {
				request.destroy()
				settle(() =>
					reject(
						new BrowserConnectionError(
							`WebSocket CDP connection to ${this.#url} timed out after ${this.#timeout}ms`,
							{ url: this.#url, timeout: this.#timeout },
						),
					),
				)
			}, this.#timeout)

			const request = httpRequest({
				hostname: url.hostname,
				port: url.port.length > 0 ? Number(url.port) : 80,
				path: `${url.pathname}${url.search}`,
				headers: {
					Connection: 'Upgrade',
					Upgrade: 'websocket',
					'Sec-WebSocket-Key': key,
					'Sec-WebSocket-Version': WEBSOCKET_VERSION,
				},
			})

			request.on('upgrade', (response: IncomingMessage, socket: Duplex, head: Buffer) => {
				clearTimeout(timer)
				const accept = response.headers['sec-websocket-accept']
				if (!isString(accept) || accept !== computeWebSocketAccept(key)) {
					socket.destroy()
					settle(() =>
						reject(
							new BrowserConnectionError(
								`WebSocket CDP connection to ${this.#url} failed: Sec-WebSocket-Accept mismatch`,
								{ url: this.#url },
							),
						),
					)
					return
				}
				settle(() => resolve(createNodeWebSocket({ socket, head })))
			})

			request.on('response', (response) => {
				clearTimeout(timer)
				response.resume()
				settle(() =>
					reject(
						new BrowserConnectionError(
							`WebSocket CDP connection to ${this.#url} failed: upgrade declined with status ${response.statusCode ?? 0}`,
							{ url: this.#url },
						),
					),
				)
			})

			request.on('error', (error) => {
				clearTimeout(timer)
				settle(() =>
					reject(
						new BrowserConnectionError(
							`WebSocket CDP connection to ${this.#url} failed: ${error.message}`,
							{ url: this.#url },
						),
					),
				)
			})

			this.#connecting = {
				abort: () => request.destroy(),
				timer,
				reject: (error) => settle(() => reject(error)),
			}

			request.end()
		})

		this.#socket = ws
		this.#bind(ws)
	}

	async send(data: string): Promise<void> {
		const socket = this.#socket
		if (socket === undefined || socket.readyState !== WEBSOCKET_READY_OPEN) {
			throw new Error('WebSocket CDP transport is not open')
		}
		socket.send(data)
	}

	async close(): Promise<void> {
		const connecting = this.#connecting
		if (connecting !== undefined) {
			clearTimeout(connecting.timer)
			this.#connecting = undefined
			connecting.abort()
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
		this.#socket = undefined

		await new Promise<void>((resolve) => {
			socket.emitter.on('close', () => resolve())
			socket.close()
		})
	}

	// === Private helpers

	#bind(ws: NodeWebSocketInterface): void {
		ws.emitter.on('message', (data) => {
			this.#emitter.emit('message', data)
		})

		ws.emitter.on('close', () => {
			this.#emitter.emit('close')
		})

		ws.emitter.on('error', (error) => {
			this.#emitter.emit('error', error)
		})
	}
}
