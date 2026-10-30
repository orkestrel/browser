import type {
	BrowserFrameInterface,
	BrowserTraceInterface,
	BrowserTraceOptions,
	BrowserTraceResult,
	BrowserWriterInterface,
} from './types.js'
import { BrowserTraceCapture } from './BrowserTraceCapture.js'
import { BrowserError } from './errors.js'

/**
 * Captures Chromium traces streamed through the IO domain.
 *
 * @remarks The owner exposes this entity through `page.diagnostics.trace`.
 */
export class BrowserTrace implements BrowserTraceInterface {
	readonly #frame: BrowserFrameInterface
	readonly #writer: BrowserWriterInterface | undefined
	#capture: BrowserTraceCapture | undefined

	constructor(frame: BrowserFrameInterface, writer?: BrowserWriterInterface) {
		this.#frame = frame
		this.#writer = writer
	}

	get active(): boolean {
		return this.#capture?.active === true
	}

	async start(options?: BrowserTraceOptions): Promise<void> {
		const previous = this.#capture
		if (previous !== undefined && !previous.closed)
			throw new BrowserError('ARGUMENT', 'Browser tracing is already active')
		const capture = new BrowserTraceCapture(this.#frame, options, this.#writer)
		this.#capture = capture
		if (previous !== undefined) await previous.ended
		await capture.start()
	}

	async stop(): Promise<BrowserTraceResult> {
		const capture = this.#capture
		if (capture?.active !== true)
			throw new BrowserError('ARGUMENT', 'Browser tracing is not active')
		return capture.stop()
	}

	async destroy(): Promise<void> {
		if (!this.active) return
		await this.stop().catch(() => undefined)
	}
}
