import type {
	BrowserWebSocketEventMap,
	BrowserWebSocketFrame,
	BrowserWebSocketInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { Emitter } from '@orkestrel/emitter'

/**
 * Observable WebSocket connection reconstructed from Network-domain events.
 *
 * @example
 * ```ts
 * import { BrowserWebSocket } from '@orkestrel/browser'
 *
 * const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')
 * socket.emitter.on('receive', (frame) => log(frame.data))
 * ```
 */
export class BrowserWebSocket implements BrowserWebSocketInterface {
	readonly #emitter: Emitter<BrowserWebSocketEventMap>
	readonly #id: string
	readonly #url: string
	#closed = false

	constructor(id: string, url: string) {
		this.#id = id
		this.#url = url
		this.#emitter = new Emitter()
	}

	get emitter(): EmitterInterface<BrowserWebSocketEventMap> {
		return this.#emitter
	}

	get id(): string {
		return this.#id
	}

	get url(): string {
		return this.#url
	}

	receive(frame: BrowserWebSocketFrame): void {
		if (!this.#closed) this.#emitter.emit('receive', frame)
	}

	transmit(frame: BrowserWebSocketFrame): void {
		if (!this.#closed) this.#emitter.emit('transmit', frame)
	}

	fail(message: string): void {
		if (!this.#closed) this.#emitter.emit('error', message)
	}

	close(timestamp: number): void {
		if (this.#closed) return
		this.#closed = true
		this.#emitter.emit('close', timestamp)
		this.#emitter.destroy()
	}
}
