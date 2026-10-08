import type {
	BrowserWebSocketEventMap,
	BrowserWebSocketFrame,
	BrowserWebSocketInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { Emitter } from '@orkestrel/emitter'

/**
 * Represents an observable WebSocket connection reconstructed from Network-domain events.
 *
 */
export class BrowserWebSocket implements BrowserWebSocketInterface {
	readonly #emitter: Emitter<BrowserWebSocketEventMap>
	readonly #id: string
	readonly #url: string
	#closed = false

	constructor(
		id: string,
		url: string,
		drive: (driver: {
			readonly receive: (frame: BrowserWebSocketFrame) => void
			readonly transmit: (frame: BrowserWebSocketFrame) => void
			readonly fail: (message: string) => void
			readonly close: (timestamp: number) => void
		}) => void,
	) {
		this.#id = id
		this.#url = url
		this.#emitter = new Emitter()
		drive({
			receive: this.#receive.bind(this),
			transmit: this.#transmit.bind(this),
			fail: this.#fail.bind(this),
			close: this.#close.bind(this),
		})
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

	#receive(frame: BrowserWebSocketFrame): void {
		if (!this.#closed) this.#emitter.emit('receive', frame)
	}

	#transmit(frame: BrowserWebSocketFrame): void {
		if (!this.#closed) this.#emitter.emit('transmit', frame)
	}

	#fail(message: string): void {
		if (!this.#closed) this.#emitter.emit('error', message)
	}

	#close(timestamp: number): void {
		if (this.#closed) return
		this.#closed = true
		this.#emitter.emit('close', timestamp)
		this.#emitter.destroy()
	}
}
