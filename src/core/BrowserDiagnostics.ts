import type {
	BrowserCoverageInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInterface,
	BrowserPerformanceInterface,
	BrowserProfilerInterface,
	BrowserTraceInterface,
	BrowserWriterInterface,
} from './types.js'
import { BrowserCoverage } from './BrowserCoverage.js'
import { BrowserPerformance } from './BrowserPerformance.js'
import { BrowserProfiler } from './BrowserProfiler.js'
import { BrowserTrace } from './BrowserTrace.js'

/**
 * Groups the tracing, coverage, performance, and profiler classes beneath one page.
 *
 * @remarks The owner exposes this entity through `page.diagnostics`.
 */
export class BrowserDiagnostics implements BrowserDiagnosticsInterface {
	readonly #trace: BrowserTrace
	readonly #coverage: BrowserCoverage
	readonly #performance: BrowserPerformance
	readonly #profiler: BrowserProfiler

	constructor(frame: BrowserFrameInterface, writer?: BrowserWriterInterface) {
		this.#trace = new BrowserTrace(frame, writer)
		this.#coverage = new BrowserCoverage(frame)
		this.#performance = new BrowserPerformance(frame)
		this.#profiler = new BrowserProfiler(frame)
	}

	get trace(): BrowserTraceInterface {
		return this.#trace
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
		await this.#trace.destroy()
		await this.#coverage.destroy()
		await this.#profiler.destroy()
	}
}
