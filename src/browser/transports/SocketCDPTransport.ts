import type { CDPTransportEventMap, CDPTransportInterface } from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { SocketCDPTransportOptions } from '../types.js'
import { attempt, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BROWSER_DEFAULT_TIMEOUT_MS, BrowserConnectionError, BrowserTransition } from '@src/core'

/**
 * Provides a raw CDP text transport over the browser's native `WebSocket`.
 *
 * @remarks
 * `start()` resolves on the socket's `open` event and rejects with a `BrowserConnectionError`
 * carrying `url` for a URL whose scheme is not `ws:` or `wss:`, for a URL the `WebSocket`
 * constructor refuses (one with a fragment), for a socket that fails or closes before it opens,
 * and at the `timeout` deadline. Concurrent and repeated `start()` and `close()`
 * calls share their active transition, and a later `start()` opens a fresh socket after the
 * prior one closes. A close the remote end initiates emits `close`. The driven Chromium must
 * allow the caller's origin through `--remote-allow-origins`.
 *
 * @example
 * ```ts
 * const transport = new SocketCDPTransport({ url: 'ws://127.0.0.1:9222/devtools/browser/abc' })
 * await transport.start()
 * await transport.close()
 * ```
 */
export class SocketCDPTransport implements CDPTransportInterface {
	readonly #emitter: Emitter<CDPTransportEventMap>
	readonly #url: string
	readonly #timeout: number
	readonly #starting = new BrowserTransition()
	readonly #closing = new BrowserTransition()
	#socket: WebSocket | undefined
	#opening: PromiseWithResolvers<void> | undefined

	constructor(options: SocketCDPTransportOptions) {
		this.#emitter = new Emitter({
			...(options.on !== undefined ? { on: options.on } : {}),
			...(options.error !== undefined ? { error: options.error } : {}),
		})
		this.#url = options.url
		this.#timeout = options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	get emitter(): EmitterInterface<CDPTransportEventMap> {
		return this.#emitter
	}

	async start(): Promise<void> {
		const closing = this.#closing.pending
		if (closing !== undefined) await closing
		if (this.#socket?.readyState === WebSocket.OPEN) return
		const active = this.#starting.pending
		if (active !== undefined) {
			await active
			return
		}
		await this.#starting.execute(this.#start.bind(this))
	}

	async send(data: string): Promise<void> {
		const socket = this.#socket
		if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
			throw new BrowserConnectionError('Socket CDP transport is not open', { url: this.#url })
		}
		socket.send(data)
	}

	async close(): Promise<void> {
		await this.#closing.execute(this.#close.bind(this))
	}

	async #start(): Promise<void> {
		const parsed = attempt(() => new URL(this.#url))
		if (!parsed.success) {
			throw new BrowserConnectionError(`Socket CDP URL is invalid: ${this.#url}`, {
				url: this.#url,
				error: parsed.error,
			})
		}
		if (parsed.value.protocol !== 'ws:' && parsed.value.protocol !== 'wss:') {
			throw new BrowserConnectionError(
				`Socket CDP connection requires a ws: or wss: URL: ${this.#url}`,
				{ url: this.#url },
			)
		}
		const created = attempt(() => new WebSocket(this.#url))
		if (!created.success) {
			throw new BrowserConnectionError(`Socket CDP connection to ${this.#url} could not open`, {
				url: this.#url,
				error: created.error,
			})
		}
		const socket = created.value
		this.#socket = socket
		const opened = Promise.withResolvers<void>()
		this.#opening = opened
		const release = new AbortController()
		const options = { signal: release.signal }
		socket.addEventListener('open', () => opened.resolve(), options)
		socket.addEventListener('error', () => opened.reject(this.#refuse('failed')), options)
		socket.addEventListener(
			'close',
			() => opened.reject(this.#refuse('closed before it opened')),
			options,
		)
		const timer = setTimeout(() => {
			opened.reject(this.#refuse(`timed out after ${this.#timeout}ms`))
		}, this.#timeout)
		try {
			await opened.promise
		} catch (error) {
			if (this.#socket === socket) this.#socket = undefined
			socket.close()
			throw error
		} finally {
			if (this.#opening === opened) this.#opening = undefined
			clearTimeout(timer)
			release.abort()
		}
		this.#bind(socket)
	}

	async #close(): Promise<void> {
		this.#opening?.reject(this.#refuse('was closed before it finished connecting'))
		const socket = this.#socket
		this.#socket = undefined
		if (socket === undefined || socket.readyState === WebSocket.CLOSED) {
			await this.#starting.pending?.catch(() => undefined)
			return
		}
		const closed = Promise.withResolvers<void>()
		socket.addEventListener('close', () => closed.resolve(), { once: true })
		socket.close()
		await this.#starting.pending?.catch(() => undefined)
		await closed.promise
	}

	#bind(socket: WebSocket): void {
		socket.binaryType = 'arraybuffer'
		socket.addEventListener('message', (event) => {
			const data: unknown = event.data
			if (isString(data)) this.#emitter.emit('message', data)
			else if (data instanceof ArrayBuffer)
				this.#emitter.emit('message', new TextDecoder().decode(data))
		})
		socket.addEventListener('close', () => {
			if (this.#socket === socket) this.#socket = undefined
			this.#emitter.emit('close')
		})
		socket.addEventListener('error', () => {
			this.#emitter.emit('error', this.#refuse('failed'))
		})
	}

	#refuse(reason: string): BrowserConnectionError {
		return new BrowserConnectionError(`Socket CDP connection to ${this.#url} ${reason}`, {
			url: this.#url,
		})
	}
}
