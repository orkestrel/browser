import type { BrowserFrameInterface, BrowserProfile, BrowserProfilerInterface } from './types.js'
import { readBrowserProfile } from './helpers.js'
import { BrowserError } from './errors.js'
import { isInteger } from '@orkestrel/contract'

/**
 * Sampled JavaScript CPU profiles over one frame's Profiler domain.
 *
 * @example
 * ```ts
 * import { BrowserProfiler } from '@orkestrel/browser'
 *
 * const profiler = new BrowserProfiler(page)
 * await profiler.start(100)
 * const profile = await profiler.stop() // { start, end, nodes, samples, deltas }
 * ```
 */
export class BrowserProfiler implements BrowserProfilerInterface {
	readonly #frame: BrowserFrameInterface
	#active = false

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	get active(): boolean {
		return this.#active
	}

	async start(interval?: number): Promise<void> {
		if (this.#active) throw new BrowserError('Browser CPU profiling is already active')
		if (interval !== undefined) {
			if (!isInteger(interval) || interval <= 0) {
				throw new BrowserError(
					'Browser CPU sampling interval must be a positive integer',
					undefined,
					{
						interval,
					},
				)
			}
			await this.#frame.send('Profiler.setSamplingInterval', { interval })
		}
		await this.#frame.send('Profiler.enable')
		try {
			await this.#frame.send('Profiler.start')
			this.#active = true
		} catch (error) {
			await this.#frame.send('Profiler.disable').catch(() => undefined)
			throw error
		}
	}

	async stop(): Promise<BrowserProfile> {
		if (!this.#active) throw new BrowserError('Browser CPU profiling is not active')
		this.#active = false
		let result: unknown
		try {
			result = await this.#frame.send('Profiler.stop')
		} finally {
			await this.#frame.send('Profiler.disable').catch(() => undefined)
		}
		return readBrowserProfile(result)
	}

	async destroy(): Promise<void> {
		if (!this.#active) return
		await this.stop().catch(() => undefined)
	}
}
