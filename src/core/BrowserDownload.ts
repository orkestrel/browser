import type {
	BrowserDownloadEventMap,
	BrowserDownloadInterface,
	BrowserDownloadProgress,
	BrowserDownloadStatus,
	CDPClientInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { Emitter } from '@orkestrel/emitter'

/**
 * One Chromium download and its progress lifecycle.
 */
export class BrowserDownload implements BrowserDownloadInterface {
	readonly #client: CDPClientInterface
	readonly #context: string | undefined
	readonly #emitter: Emitter<BrowserDownloadEventMap>
	readonly #id: string
	readonly #url: string
	readonly #name: string
	#status: BrowserDownloadStatus = 'pending'
	#received = 0
	#total = 0
	#path: string | undefined

	constructor(client: CDPClientInterface, id: string, url: string, name: string, context?: string) {
		this.#client = client
		this.#context = context
		this.#id = id
		this.#url = url
		this.#name = name
		this.#emitter = new Emitter()
	}

	get emitter(): EmitterInterface<BrowserDownloadEventMap> {
		return this.#emitter
	}

	get id(): string {
		return this.#id
	}

	get url(): string {
		return this.#url
	}

	get name(): string {
		return this.#name
	}

	get status(): BrowserDownloadStatus {
		return this.#status
	}

	get received(): number {
		return this.#received
	}

	get total(): number {
		return this.#total
	}

	get path(): string | undefined {
		return this.#path
	}

	async cancel(): Promise<void> {
		if (this.#status !== 'pending') return
		const params: Record<string, unknown> = { guid: this.#id }
		if (this.#context !== undefined) params['browserContextId'] = this.#context
		await this.#client.send('Browser.cancelDownload', params)
	}

	update(progress: BrowserDownloadProgress): void {
		if (this.#status !== 'pending') return
		this.#received = progress.received
		this.#total = progress.total
		this.#path = progress.path
		this.#emitter.emit('progress', this.#received, this.#total)
		if (progress.status === 'complete') {
			this.#status = 'complete'
			this.#emitter.emit('complete', this.#path)
			this.#emitter.destroy()
		} else if (progress.status === 'cancelled') {
			this.#status = 'cancelled'
			this.#emitter.emit('cancel')
			this.#emitter.destroy()
		}
	}
}
