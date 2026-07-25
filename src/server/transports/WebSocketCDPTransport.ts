import type { CDPTransportEventMap, CDPTransportInterface } from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import type { WebSocketCDPTransportOptions } from '../types.js'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { attempt, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import {
	computeWebSocketAccept,
	createNodeWebSocket,
	WEBSOCKET_READY_CLOSED,
	WEBSOCKET_READY_OPEN,
	WEBSOCKET_VERSION,
} from '@orkestrel/websocket'
import { BROWSER_DEFAULT_TIMEOUT_MS } from '@src/core'
import { BrowserConnectionError } from '../errors.js'

// === WebSocketCDPTransport

/**
 * `@orkestrel/websocket`-backed raw CDP text transport.
 *
 * @remarks
 * Performs and validates the RFC 6455 HTTP upgrade, then delegates frame
 * handling to `@orkestrel/websocket`. Concurrent and repeated `start()` /
 * `close()` calls share their active transition, and a later `start()` opens a
 * fresh socket after the prior one closes.
 */
export class WebSocketCDPTransport implements CDPTransportInterface {
	readonly #emitter: Emitter<CDPTransportEventMap>
	readonly #url: string
	readonly #timeout: number
	#socket: NodeWebSocketInterface | undefined
	#starting: Promise<void> | undefined
	#closing: Promise<void> | undefined
	#request: ClientRequest | undefined
	#resolve: ((socket: NodeWebSocketInterface) => void) | undefined
	#reject: ((error: unknown) => void) | undefined
	#timer: ReturnType<typeof setTimeout> | undefined
	#closeResolve: (() => void) | undefined
	#onSocketClose = (): void => this.#closeResolve?.()

	constructor(options: WebSocketCDPTransportOptions) {
		this.#emitter = new Emitter({ on: options.on, error: options.error })
		this.#url = options.url
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get emitter(): EmitterInterface<CDPTransportEventMap> {
		return this.#emitter
	}

	async start(): Promise<void> {
		if (this.#closing !== undefined) await this.#closing
		if (this.#socket?.readyState === WEBSOCKET_READY_OPEN) return

		const active = this.#starting
		if (active !== undefined) {
			await active
			return
		}

		this.#socket?.destroy()
		this.#socket = undefined
		const transition = this.#open()
		this.#starting = transition

		try {
			await transition
		} finally {
			if (this.#starting === transition) this.#starting = undefined
		}
	}

	async send(data: string): Promise<void> {
		const socket = this.#socket
		if (socket === undefined || socket.readyState !== WEBSOCKET_READY_OPEN) {
			throw new Error('WebSocket CDP transport is not open')
		}
		socket.send(data)
	}

	async close(): Promise<void> {
		const active = this.#closing
		if (active !== undefined) {
			await active
			return
		}

		const transition = this.#stop()
		this.#closing = transition
		try {
			await transition
		} finally {
			if (this.#closing === transition) this.#closing = undefined
		}
	}

	// === Private helpers

	async #open(): Promise<void> {
		const parsed = attempt(() => new URL(this.#url))
		if (!parsed.success) {
			throw new BrowserConnectionError(`WebSocket CDP URL is invalid: ${this.#url}`, {
				url: this.#url,
				error: parsed.error,
			})
		}
		const url = parsed.value
		if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
			throw new BrowserConnectionError(
				`WebSocket CDP connection requires a ws: or wss: URL: ${this.#url}`,
				{ url: this.#url },
			)
		}
		const key = randomBytes(16).toString('base64')
		const deferred = Promise.withResolvers<NodeWebSocketInterface>()
		const options: RequestOptions = {
			hostname: url.hostname,
			port: url.port.length > 0 ? Number(url.port) : url.protocol === 'wss:' ? 443 : 80,
			path: `${url.pathname}${url.search}`,
			headers: {
				Connection: 'Upgrade',
				Upgrade: 'websocket',
				'Sec-WebSocket-Key': key,
				'Sec-WebSocket-Version': WEBSOCKET_VERSION,
			},
		}
		const request = url.protocol === 'wss:' ? httpsRequest(options) : httpRequest(options)

		this.#request = request
		this.#resolve = deferred.resolve
		this.#reject = deferred.reject
		this.#timer = setTimeout(() => this.#expire(request), this.#timeout)

		request.on('upgrade', (response: IncomingMessage, socket: Duplex, head: Buffer) => {
			this.#upgrade(request, key, response, socket, head)
		})
		request.on('response', (response) => this.#decline(request, response))
		request.on('error', (error) => this.#fail(request, error))
		request.end()

		const socket = await deferred.promise
		this.#socket = socket
		this.#bind(socket)
	}

	async #stop(): Promise<void> {
		const request = this.#request
		if (request !== undefined) {
			this.#rejectRequest(
				request,
				new BrowserConnectionError(
					`WebSocket CDP connection to ${this.#url} was closed before it finished connecting`,
					{ url: this.#url },
				),
			)
			request.destroy()
		}
		await this.#starting?.catch(() => undefined)

		const socket = this.#socket
		this.#socket = undefined
		if (socket === undefined || socket.readyState === WEBSOCKET_READY_CLOSED) return

		const closed = Promise.withResolvers<void>()
		this.#closeResolve = closed.resolve
		socket.emitter.on('close', this.#onSocketClose)
		try {
			socket.close()
			if (socket.readyState !== WEBSOCKET_READY_CLOSED) await closed.promise
		} catch {
			socket.destroy()
			if (socket.readyState !== WEBSOCKET_READY_CLOSED) await closed.promise
		} finally {
			socket.emitter.off('close', this.#onSocketClose)
			this.#closeResolve = undefined
		}
	}

	#upgrade(
		request: ClientRequest,
		key: string,
		response: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): void {
		if (this.#request !== request) {
			socket.destroy()
			return
		}

		const accept = response.headers['sec-websocket-accept']
		if (!isString(accept) || accept !== computeWebSocketAccept(key)) {
			socket.destroy()
			this.#rejectRequest(
				request,
				new BrowserConnectionError(
					`WebSocket CDP connection to ${this.#url} failed: Sec-WebSocket-Accept mismatch`,
					{ url: this.#url },
				),
			)
			return
		}

		try {
			this.#resolveRequest(request, createNodeWebSocket({ socket, head }))
		} catch (error) {
			socket.destroy()
			this.#rejectRequest(request, error)
		}
	}

	#decline(request: ClientRequest, response: IncomingMessage): void {
		response.resume()
		const reason =
			response.statusCode === undefined
				? 'upgrade was declined without a status code'
				: `upgrade declined with status ${response.statusCode}`
		this.#rejectRequest(
			request,
			new BrowserConnectionError(`WebSocket CDP connection to ${this.#url} failed: ${reason}`, {
				url: this.#url,
			}),
		)
	}

	#fail(request: ClientRequest, error: Error): void {
		this.#rejectRequest(
			request,
			new BrowserConnectionError(
				`WebSocket CDP connection to ${this.#url} failed: ${error.message}`,
				{ url: this.#url },
			),
		)
	}

	#expire(request: ClientRequest): void {
		this.#rejectRequest(
			request,
			new BrowserConnectionError(
				`WebSocket CDP connection to ${this.#url} timed out after ${this.#timeout}ms`,
				{ url: this.#url, timeout: this.#timeout },
			),
		)
		request.destroy()
	}

	#resolveRequest(request: ClientRequest, socket: NodeWebSocketInterface): void {
		if (this.#request !== request) {
			socket.destroy()
			return
		}

		const resolve = this.#resolve
		this.#clearRequest()
		resolve?.(socket)
	}

	#rejectRequest(request: ClientRequest, error: unknown): void {
		if (this.#request !== request) return

		const reject = this.#reject
		this.#clearRequest()
		reject?.(error)
	}

	#clearRequest(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer)
		this.#timer = undefined
		this.#request = undefined
		this.#resolve = undefined
		this.#reject = undefined
	}

	#bind(socket: NodeWebSocketInterface): void {
		socket.emitter.on('message', (data) => this.#emitter.emit('message', data))
		socket.emitter.on('close', () => {
			if (this.#socket === socket) this.#socket = undefined
			this.#emitter.emit('close')
		})
		socket.emitter.on('error', (error) => this.#emitter.emit('error', error))
	}
}
