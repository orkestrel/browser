import type {
	BrowserFrameInterface,
	BrowserRequest,
	BrowserRouteContinueOptions,
	BrowserRouteFulfillOptions,
	BrowserRouteInterface,
} from './types.js'
import { browserHeadersToProtocol, encodeBase64, textToBytes } from './helpers.js'
import { BrowserError } from './errors.js'
import { isInteger, isString } from '@orkestrel/contract'

/**
 * One paused request that can be aborted, continued, or fulfilled exactly once.
 */
export class BrowserRoute implements BrowserRouteInterface {
	readonly #frame: BrowserFrameInterface
	readonly #id: string
	readonly #request: BrowserRequest
	#handled = false
	#handling = false

	constructor(frame: BrowserFrameInterface, id: string, request: BrowserRequest) {
		this.#frame = frame
		this.#id = id
		this.#request = request
	}

	get id(): string {
		return this.#id
	}

	get request(): BrowserRequest {
		return this.#request
	}

	get handled(): boolean {
		return this.#handled
	}

	async abort(reason = 'Failed'): Promise<void> {
		this.#assert()
		this.#handling = true
		try {
			await this.#frame.send('Fetch.failRequest', {
				requestId: this.#id,
				errorReason: reason,
			})
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	async continue(options?: BrowserRouteContinueOptions): Promise<void> {
		this.#assert()
		const params: Record<string, unknown> = { requestId: this.#id }
		if (options?.url !== undefined) params['url'] = options.url
		if (options?.method !== undefined) params['method'] = options.method
		if (options?.headers !== undefined) {
			params['headers'] = browserHeadersToProtocol(options.headers)
		}
		if (options?.post !== undefined) {
			params['postData'] = encodeBase64(textToBytes(options.post))
		}
		this.#handling = true
		try {
			await this.#frame.send('Fetch.continueRequest', params)
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	async fulfill(options: BrowserRouteFulfillOptions): Promise<void> {
		this.#assert()
		const status = options.status ?? 200
		if (!isInteger(status) || status < 100 || status > 999) {
			throw new BrowserError('Browser route status must be an integer from 100 to 999', undefined, {
				status,
			})
		}
		const params: Record<string, unknown> = {
			requestId: this.#id,
			responseCode: status,
		}
		if (options.phrase !== undefined) params['responsePhrase'] = options.phrase
		if (options.headers !== undefined) {
			params['responseHeaders'] = browserHeadersToProtocol(options.headers)
		}
		if (options.body !== undefined) {
			params['body'] = encodeBase64(
				isString(options.body) ? textToBytes(options.body) : options.body,
			)
		}
		this.#handling = true
		try {
			await this.#frame.send('Fetch.fulfillRequest', params)
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	#assert(): void {
		if (this.#handled || this.#handling) throw new BrowserError('Browser route is already handled')
	}
}
