import type {
	BrowserFrameInterface,
	BrowserTraceOptions,
	BrowserTraceResult,
	BrowserWriterInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { concatBytes, readBrowserStreamChunk } from './helpers.js'
import { BrowserError } from './errors.js'
import { isString } from '@orkestrel/contract'

/** Owns initialization, stream completion, and cleanup for one trace. */
export class BrowserTraceCapture {
	readonly #frame: BrowserFrameInterface
	readonly #writer: BrowserWriterInterface | undefined
	readonly #options: BrowserTraceOptions | undefined
	readonly #categories: readonly string[]
	readonly #completion = Promise.withResolvers<string>()
	readonly #ended = Promise.withResolvers<void>()
	#started = false
	#closed = false
	readonly #completeHandler = this.#handleComplete.bind(this)

	constructor(
		frame: BrowserFrameInterface,
		options: BrowserTraceOptions | undefined,
		writer: BrowserWriterInterface | undefined,
	) {
		this.#frame = frame
		this.#writer = writer
		const categories = [...(options?.categories ?? ['devtools.timeline', 'v8.execute'])]
		if (options?.screenshots === true) {
			categories.push('disabled-by-default-devtools.screenshot')
		}
		if (options?.samples === true) {
			categories.push('disabled-by-default-v8.cpu_profiler')
		}
		this.#options = options
		this.#categories = categories
	}

	get active(): boolean {
		return this.#started && !this.#closed
	}

	get closed(): boolean {
		return this.#closed
	}

	get ended(): Promise<void> {
		return this.#ended.promise
	}

	async start(): Promise<void> {
		try {
			await this.#frame.subscribe('Tracing.tracingComplete', this.#completeHandler)
			await this.#frame.send('Tracing.start', {
				transferMode: 'ReturnAsStream',
				traceConfig: {
					includedCategories: this.#categories,
				},
			})
			this.#started = true
		} catch (error) {
			this.#closed = true
			await this.#frame
				.unsubscribe('Tracing.tracingComplete', this.#completeHandler)
				.catch(() => undefined)
			this.#ended.resolve()
			throw error
		}
	}

	async stop(): Promise<BrowserTraceResult> {
		this.#closed = true
		const completion = this.#completion
		const options = this.#options
		const chunks: Uint8Array[] = []
		try {
			await this.#frame.send('Tracing.end')
			const stream = await this.#wait(completion.promise)
			try {
				while (true) {
					const chunk = readBrowserStreamChunk(
						await this.#frame.send('IO.read', { handle: stream }),
					)
					chunks.push(chunk.bytes)
					if (chunk.eof) break
				}
			} finally {
				await this.#frame.send('IO.close', { handle: stream }).catch(() => undefined)
			}
		} finally {
			await this.#frame
				.unsubscribe('Tracing.tracingComplete', this.#completeHandler)
				.catch(() => undefined)
			this.#ended.resolve()
		}
		const bytes = concatBytes(chunks)
		if (options?.path !== undefined) {
			if (this.#writer === undefined) {
				throw new BrowserError('ARGUMENT', 'Browser trace path requires a configured writer')
			}
			await this.#writer.write(options.path, bytes)
		}
		return { bytes, path: options?.path }
	}

	async #wait(promise: Promise<string>): Promise<string> {
		const deferred = Promise.withResolvers<string>()
		const timer = setTimeout(() => {
			deferred.reject(
				new BrowserError('TIMEOUT', 'Browser trace completion timed out', { operation: 'stop' }),
			)
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
		else
			completion.reject(new BrowserError('PROTOCOL', 'Browser trace did not return an IO stream'))
	}
}
