import type { Readable } from 'node:stream'
import { isString } from '@orkestrel/contract'
import { BrowserError } from '@src/core'
import { BROWSER_DEVTOOLS_PATTERN } from './constants.js'

/** Reads the announced CDP endpoint while continuing to drain the browser's standard error. */
export class BrowserEndpoint {
	readonly #completion = Promise.withResolvers<string>()
	#pending = ''
	#endpoint: string | undefined

	constructor(stream: Readable, signal: AbortSignal) {
		if (signal.aborted) this.#completion.reject(signal.reason)
		signal.addEventListener('abort', () => this.#completion.reject(signal.reason), { once: true })
		stream.on('error', this.#completion.reject)
		stream.setEncoding('utf8')
		stream.on('data', this.#handleChunk.bind(this))
		stream.on('close', this.#handleClose.bind(this))
	}

	get endpoint(): Promise<string> {
		return this.#completion.promise
	}

	#handleChunk(chunk: unknown): void {
		if (this.#endpoint !== undefined || !isString(chunk)) return
		const lines = (this.#pending + chunk).split(/\r\n|\n/)
		this.#pending = lines.pop() ?? ''
		for (const line of lines) {
			const endpoint = BROWSER_DEVTOOLS_PATTERN.exec(line)?.[1]
			if (endpoint === undefined) continue
			this.#endpoint = endpoint
			this.#pending = ''
			this.#completion.resolve(endpoint)
			return
		}
	}

	#handleClose(): void {
		const endpoint =
			this.#endpoint === undefined ? BROWSER_DEVTOOLS_PATTERN.exec(this.#pending)?.[1] : undefined
		if (endpoint !== undefined) this.#completion.resolve(endpoint)
		else {
			this.#completion.reject(
				new BrowserError(
					'CONNECTION',
					'Browser closed its standard error before reporting a CDP endpoint',
				),
			)
		}
	}
}
