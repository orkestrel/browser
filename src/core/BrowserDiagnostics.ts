import type {
	BrowserCoverageInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInterface,
	BrowserPerformanceInterface,
	BrowserProfilerInterface,
	BrowserTracingInterface,
	BrowserWriterInterface,
} from './types.js'
import { BrowserCoverage } from './BrowserCoverage.js'
import { BrowserPerformance } from './BrowserPerformance.js'
import { BrowserProfiler } from './BrowserProfiler.js'
import { BrowserTracing } from './BrowserTracing.js'

/**
 * Groups the diagnostic subentities beneath one page.
 *
 * @example
 * ```ts
 * import { BrowserDiagnostics } from '@orkestrel/browser'
 *
 * const diagnostics = new BrowserDiagnostics(page)
 * const metrics = await diagnostics.performance.metrics()
 * await diagnostics.destroy()
 * ```
 */
export class BrowserDiagnostics implements BrowserDiagnosticsInterface {
	readonly #tracing: BrowserTracing
	readonly #coverage: BrowserCoverage
	readonly #performance: BrowserPerformance
	readonly #profiler: BrowserProfiler

	constructor(frame: BrowserFrameInterface, writer?: BrowserWriterInterface) {
		this.#tracing = new BrowserTracing(frame, writer)
		this.#coverage = new BrowserCoverage(frame)
		this.#performance = new BrowserPerformance(frame)
		this.#profiler = new BrowserProfiler(frame)
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

	get profiler(): BrowserProfilerInterface {
		return this.#profiler
	}

	async destroy(): Promise<void> {
		await this.#tracing.destroy()
		await this.#coverage.destroy()
		await this.#profiler.destroy()
	}
}
