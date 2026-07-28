import type {
	BrowserHAR,
	BrowserHAREntry,
	BrowserHARManagerInterface,
	BrowserHAROptions,
	BrowserHARPending,
	BrowserHARReplayOptions,
	BrowserNetworkManagerInterface,
	BrowserRequest,
	BrowserRequestFailure,
	BrowserResponse,
	BrowserRouteHandler,
	ScreenshotWriterInterface,
} from './types.js'
import { BROWSER_HAR_CREATOR } from './constants.js'
import {
	browserHARHeadersToRecord,
	createBrowserHAREntry,
	decodeBase64,
	textToBytes,
	validateBrowserHAR,
} from './helpers.js'
import { BrowserError } from './errors.js'

/**
 * HTTP archive recording and replay over one page network manager.
 */
export class BrowserHARManager implements BrowserHARManagerInterface {
	readonly #network: BrowserNetworkManagerInterface
	readonly #writer: ScreenshotWriterInterface | undefined
	readonly #pending: Map<string, BrowserHARPending> = new Map()
	readonly #entries: BrowserHAREntry[] = []
	readonly #tasks: Set<Promise<void>> = new Set()
	#options: BrowserHAROptions | undefined
	#recording = false
	#failure: unknown
	#archive: BrowserHAR | undefined
	#fallback = false
	readonly #requestHandler = this.#handleRequest.bind(this)
	readonly #responseHandler = this.#handleResponse.bind(this)
	readonly #failureHandler = this.#handleFailure.bind(this)
	readonly #finishHandler = this.#handleFinish.bind(this)
	readonly #replayHandler: BrowserRouteHandler = this.#handleReplay.bind(this)

	constructor(network: BrowserNetworkManagerInterface, writer?: ScreenshotWriterInterface) {
		this.#network = network
		this.#writer = writer
	}

	get recording(): boolean {
		return this.#recording
	}

	async start(options?: BrowserHAROptions): Promise<void> {
		if (this.#recording) return
		this.#options = options
		this.#entries.length = 0
		this.#pending.clear()
		this.#failure = undefined
		this.#network.emitter.on('request', this.#requestHandler)
		this.#network.emitter.on('response', this.#responseHandler)
		this.#network.emitter.on('failure', this.#failureHandler)
		this.#network.emitter.on('finish', this.#finishHandler)
		this.#recording = true
		try {
			await this.#network.start()
		} catch (error) {
			this.#recording = false
			this.#network.emitter.off('request', this.#requestHandler)
			this.#network.emitter.off('response', this.#responseHandler)
			this.#network.emitter.off('failure', this.#failureHandler)
			this.#network.emitter.off('finish', this.#finishHandler)
			throw error
		}
	}

	async stop(): Promise<BrowserHAR> {
		if (this.#recording) {
			this.#recording = false
			this.#network.emitter.off('request', this.#requestHandler)
			this.#network.emitter.off('response', this.#responseHandler)
			this.#network.emitter.off('failure', this.#failureHandler)
			this.#network.emitter.off('finish', this.#finishHandler)
			await Promise.allSettled([...this.#tasks])
			for (const id of [...this.#pending.keys()]) {
				const pending = this.#pending.get(id)
				if (pending === undefined) continue
				this.#pending.delete(id)
				this.#entries.push(
					createBrowserHAREntry(
						pending,
						Math.max(0, Date.now() - pending.started),
						undefined,
						'Request was incomplete when recording stopped',
					),
				)
			}
		}
		if (this.#failure !== undefined) {
			throw new BrowserError('Browser HAR recording failed', 'BROWSER_HAR_ERROR', {
				error: this.#failure,
			})
		}
		const har: BrowserHAR = {
			log: {
				version: '1.2',
				creator: BROWSER_HAR_CREATOR,
				entries: [...this.#entries],
			},
		}
		if (this.#options?.path !== undefined) {
			if (this.#writer === undefined) {
				throw new BrowserError('Browser HAR path requires a configured writer')
			}
			await this.#writer.write(this.#options.path, textToBytes(JSON.stringify(har, undefined, 2)))
		}
		return har
	}

	async replay(har: BrowserHAR, options?: BrowserHARReplayOptions): Promise<void> {
		validateBrowserHAR(har)
		if (this.#archive !== undefined) await this.#network.unroute(this.#replayHandler)
		this.#archive = har
		this.#fallback = options?.fallback === true
		try {
			await this.#network.route({}, this.#replayHandler)
		} catch (error) {
			this.#archive = undefined
			this.#fallback = false
			throw error
		}
	}

	async clear(): Promise<void> {
		if (this.#recording) await this.stop()
		const replaying = this.#archive !== undefined
		this.#archive = undefined
		this.#fallback = false
		if (replaying) await this.#network.unroute(this.#replayHandler)
		this.#entries.length = 0
		this.#pending.clear()
	}

	#handleRequest(request: BrowserRequest): void {
		if (!this.#recording) return
		this.#pending.set(request.id, {
			request,
			started: request.walltime === undefined ? Date.now() : request.walltime * 1000,
			response: undefined,
		})
	}

	#handleResponse(response: BrowserResponse): void {
		const pending = this.#pending.get(response.id)
		if (pending === undefined) return
		this.#pending.set(response.id, {
			request: pending.request,
			started: pending.started,
			response,
		})
	}

	#handleFailure(failure: BrowserRequestFailure): void {
		const pending = this.#pending.get(failure.id)
		if (pending === undefined) return
		this.#pending.delete(failure.id)
		this.#entries.push(
			createBrowserHAREntry(
				pending,
				Math.max(0, Date.now() - pending.started),
				undefined,
				failure.error,
			),
		)
	}

	#handleFinish(id: string): void {
		this.#track(this.#complete(id))
	}

	async #handleReplay(route: Parameters<BrowserRouteHandler>[0]): Promise<void> {
		const entry = this.#archive?.log.entries.find(
			(candidate) =>
				candidate.request.url === route.request.url &&
				candidate.request.method === route.request.method,
		)
		if (entry === undefined || entry.response.status === 0) {
			if (this.#fallback) await route.continue()
			else await route.abort('Failed')
			return
		}
		const body =
			entry.response.content.text === undefined
				? undefined
				: entry.response.content.encoding === 'base64'
					? decodeBase64(entry.response.content.text)
					: entry.response.content.text
		await route.fulfill({
			status: entry.response.status,
			phrase: entry.response.statusText,
			headers: browserHARHeadersToRecord(entry.response.headers),
			...(body !== undefined ? { body } : {}),
		})
	}

	async #complete(id: string): Promise<void> {
		const pending = this.#pending.get(id)
		if (pending === undefined) return
		this.#pending.delete(id)
		let body: Uint8Array | undefined
		if (this.#options?.content === true && pending.response !== undefined) {
			try {
				body = await this.#network.body(id)
			} catch {
				// Some redirects, cached resources, and protocol errors have no retrievable body.
			}
		}
		this.#entries.push(
			createBrowserHAREntry(pending, Math.max(0, Date.now() - pending.started), body),
		)
	}

	#track(task: Promise<void>): void {
		this.#tasks.add(task)
		void task
			.catch((error: unknown) => {
				if (this.#failure === undefined) this.#failure = error
			})
			.finally(() => this.#tasks.delete(task))
	}
}
