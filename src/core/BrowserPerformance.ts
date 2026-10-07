import type { BrowserFrameInterface, BrowserMetric, BrowserPerformanceInterface } from './types.js'
import { readBrowserMetrics } from './helpers.js'

/**
 * Reads Performance-domain metrics for one frame.
 *
 * @remarks The owner exposes this entity through `page.diagnostics.performance`.
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
