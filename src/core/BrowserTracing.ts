import type {
	BrowserFrameInterface,
	BrowserTracingInterface,
	BrowserTracingOptions,
	BrowserTracingResult,
	ScreenshotWriterInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { concatBytes, readBrowserStreamChunk } from './helpers.js'
import { BrowserError } from './errors.js'
import { isString } from '@orkestrel/contract'

/**
 * Chromium trace capture streamed through the IO domain.
 */
export class BrowserTracing implements BrowserTracingInterface {
	readonly #frame: BrowserFrameInterface
	readonly #writer: ScreenshotWriterInterface | undefined
	#active = false
	#options: BrowserTracingOptions | undefined
	#completion: PromiseWithResolvers<string> | undefined
	readonly #completeHandler = this.#handleComplete.bind(this)

	constructor(frame: BrowserFrameInterface, writer?: ScreenshotWriterInterface) {
		this.#frame = frame
		this.#writer = writer
	}

	get active(): boolean {
		return this.#active
	}

	async start(options?: BrowserTracingOptions): Promise<void> {
		if (this.#active) throw new BrowserError('Browser tracing is already active')
		const categories = [...(options?.categories ?? ['devtools.timeline', 'v8.execute'])]
		if (options?.screenshots === true) {
			categories.push('disabled-by-default-devtools.screenshot')
		}
		if (options?.sampling === true) {
			categories.push('disabled-by-default-v8.cpu_profiler')
		}
		this.#options = options
		this.#completion = Promise.withResolvers<string>()
		try {
			await this.#frame.subscribe('Tracing.tracingComplete', this.#completeHandler)
			await this.#frame.send('Tracing.start', {
				transferMode: 'ReturnAsStream',
				traceConfig: {
					includedCategories: categories,
				},
			})
			this.#active = true
		} catch (error) {
			await this.#frame
				.unsubscribe('Tracing.tracingComplete', this.#completeHandler)
				.catch(() => undefined)
			this.#options = undefined
			this.#completion = undefined
			throw error
		}
	}

	async stop(): Promise<BrowserTracingResult> {
		if (!this.#active || this.#completion === undefined) {
			throw new BrowserError('Browser tracing is not active')
		}
		const completion = this.#completion
		const options = this.#options
		this.#active = false
		let stream: string | undefined
		const chunks: Uint8Array[] = []
		try {
			await this.#frame.send('Tracing.end')
			stream = await this.#wait(completion.promise)
			while (true) {
				const chunk = readBrowserStreamChunk(await this.#frame.send('IO.read', { handle: stream }))
				chunks.push(chunk.bytes)
				if (chunk.eof) break
			}
		} finally {
			if (stream !== undefined) {
				await this.#frame.send('IO.close', { handle: stream }).catch(() => undefined)
			}
			await this.#frame
				.unsubscribe('Tracing.tracingComplete', this.#completeHandler)
				.catch(() => undefined)
			this.#options = undefined
			this.#completion = undefined
		}
		const bytes = concatBytes(chunks)
		if (options?.path !== undefined) {
			if (this.#writer === undefined) {
				throw new BrowserError('Browser trace path requires a configured writer')
			}
			await this.#writer.write(options.path, bytes)
		}
		return { bytes, path: options?.path }
	}

	async destroy(): Promise<void> {
		if (!this.#active) return
		await this.stop().catch(() => undefined)
	}

	async #wait(promise: Promise<string>): Promise<string> {
		const deferred = Promise.withResolvers<string>()
		const timer = setTimeout(() => {
			deferred.reject(new BrowserError('Browser trace completion timed out'))
		}, BROWSER_DEFAULT_TIMEOUT_MS)
		void promise.then(deferred.resolve, deferred.reject)
		try {
			return await deferred.promise
		} finally {
			clearTimeout(timer)
		}
	}

	#handleComplete(params: Readonly<Record<string, unknown>>): void {
		const completion = this.#completion
		if (completion === undefined) return
		if (isString(params['stream'])) completion.resolve(params['stream'])
		else completion.reject(new BrowserError('Browser trace did not return an IO stream'))
	}
}
