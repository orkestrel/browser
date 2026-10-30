import type { BrowserRecorderInterface } from './types.js'

/** Owns one journey recording from its reservation through save or teardown. */
export class BrowserJourneyRecord {
	readonly name: string
	readonly #open: () => Promise<BrowserRecorderInterface>
	readonly #signal: AbortSignal
	#recorder: BrowserRecorderInterface | undefined
	#started = false
	#closed = false

	constructor(name: string, open: () => Promise<BrowserRecorderInterface>, signal: AbortSignal) {
		this.name = name
		this.#open = open
		this.#signal = signal
	}

	get closed(): boolean {
		return this.#closed
	}

	get recorder(): BrowserRecorderInterface | undefined {
		return this.#started && !this.#closed ? this.#recorder : undefined
	}

	async start(): Promise<void> {
		try {
			this.#recorder = await this.#open()
			await this.#recorder.start()
			this.#signal.throwIfAborted()
			this.#started = true
		} catch (error) {
			this.#closed = true
			await this.#recorder?.destroy()
			throw error
		}
	}

	async destroy(): Promise<void> {
		this.#closed = true
		if (this.#started) await this.#recorder?.destroy()
	}
}
