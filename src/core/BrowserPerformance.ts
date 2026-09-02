import type { BrowserFrameInterface, BrowserMetric, BrowserPerformanceInterface } from './types.js'
import { readBrowserMetrics } from './helpers.js'

/**
 * Reads Performance-domain metrics for one frame.
 *
 * @example
 * ```ts
 * import { BrowserPerformance } from '@orkestrel/browser'
 *
 * const performance = new BrowserPerformance(page)
 * const metrics = await performance.metrics() // readonly BrowserMetric[]
 * ```
 */
export class BrowserPerformance implements BrowserPerformanceInterface {
	readonly #frame: BrowserFrameInterface

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async metrics(): Promise<readonly BrowserMetric[]> {
		await this.#frame.send('Performance.enable')
		try {
			return readBrowserMetrics(await this.#frame.send('Performance.getMetrics'))
		} finally {
			await this.#frame.send('Performance.disable').catch(() => undefined)
		}
	}
}
