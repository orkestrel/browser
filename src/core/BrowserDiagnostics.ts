import type {
	BrowserCoverageInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInterface,
	BrowserPerformanceInterface,
	BrowserTracingInterface,
	ScreenshotWriterInterface,
} from './types.js'
import { BrowserCoverage } from './BrowserCoverage.js'
import { BrowserPerformance } from './BrowserPerformance.js'
import { BrowserTracing } from './BrowserTracing.js'

/**
 * Diagnostic subentities grouped beneath one page.
 */
export class BrowserDiagnostics implements BrowserDiagnosticsInterface {
	readonly #tracing: BrowserTracing
	readonly #coverage: BrowserCoverage
	readonly #performance: BrowserPerformance

	constructor(frame: BrowserFrameInterface, writer?: ScreenshotWriterInterface) {
		this.#tracing = new BrowserTracing(frame, writer)
		this.#coverage = new BrowserCoverage(frame)
		this.#performance = new BrowserPerformance(frame)
	}

	get tracing(): BrowserTracingInterface {
		return this.#tracing
	}

	get coverage(): BrowserCoverageInterface {
		return this.#coverage
	}

	get performance(): BrowserPerformanceInterface {
		return this.#performance
	}

	async destroy(): Promise<void> {
		await this.#tracing.destroy()
		await this.#coverage.destroy()
		await this.#performance.destroy()
	}
}
