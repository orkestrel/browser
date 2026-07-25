import type {
	BrowserCoverageInterface,
	BrowserCoverageOptions,
	BrowserCoverageResult,
	BrowserFrameInterface,
} from './types.js'
import { readBrowserScriptCoverage, readBrowserStyleCoverage } from './helpers.js'
import { BrowserError } from './errors.js'

/**
 * JavaScript precise coverage and CSS rule usage for one page target.
 */
export class BrowserCoverage implements BrowserCoverageInterface {
	readonly #frame: BrowserFrameInterface
	#active = false
	#options: BrowserCoverageOptions | undefined

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	get active(): boolean {
		return this.#active
	}

	async start(options?: BrowserCoverageOptions): Promise<void> {
		if (this.#active) throw new BrowserError('Browser coverage is already active')
		const javascript = options?.javascript ?? true
		const css = options?.css ?? true
		if (!javascript && !css) {
			throw new BrowserError('Browser coverage requires JavaScript, CSS, or both')
		}
		let profiler = false
		let precise = false
		let dom = false
		let styles = false
		let rules = false
		try {
			if (javascript) {
				await this.#frame.send('Profiler.enable')
				profiler = true
				await this.#frame.send('Profiler.startPreciseCoverage', {
					callCount: true,
					detailed: options?.detailed ?? true,
					allowTriggeredUpdates: false,
				})
				precise = true
			}
			if (css) {
				await this.#frame.send('DOM.enable')
				dom = true
				await this.#frame.send('CSS.enable')
				styles = true
				await this.#frame.send('CSS.startRuleUsageTracking')
				rules = true
			}
		} catch (error) {
			if (rules) {
				await this.#frame.send('CSS.stopRuleUsageTracking').catch(() => undefined)
			}
			if (styles) await this.#frame.send('CSS.disable').catch(() => undefined)
			if (dom) await this.#frame.send('DOM.disable').catch(() => undefined)
			if (precise) {
				await this.#frame.send('Profiler.stopPreciseCoverage').catch(() => undefined)
			}
			if (profiler) await this.#frame.send('Profiler.disable').catch(() => undefined)
			throw error
		}
		this.#options = options
		this.#active = true
	}

	async stop(): Promise<BrowserCoverageResult> {
		if (!this.#active) throw new BrowserError('Browser coverage is not active')
		this.#active = false
		const javascript = this.#options?.javascript ?? true
		const css = this.#options?.css ?? true
		let scripts: BrowserCoverageResult['scripts'] = []
		let styles: BrowserCoverageResult['styles'] = []
		let failed = false
		let failure: unknown
		if (javascript) {
			try {
				scripts = await this.#stopJavaScript()
			} catch (error) {
				failed = true
				failure = error
			}
		}
		if (css) {
			try {
				styles = await this.#stopCSS()
			} catch (error) {
				if (!failed) {
					failed = true
					failure = error
				}
			}
		}
		this.#options = undefined
		if (failed) throw failure
		return { scripts, styles }
	}

	async destroy(): Promise<void> {
		if (!this.#active) return
		await this.stop().catch(() => undefined)
	}

	async #stopJavaScript(): Promise<BrowserCoverageResult['scripts']> {
		let result: unknown
		let failed = false
		let failure: unknown
		try {
			result = await this.#frame.send('Profiler.takePreciseCoverage')
		} catch (error) {
			failed = true
			failure = error
		}
		try {
			await this.#frame.send('Profiler.stopPreciseCoverage')
		} catch (error) {
			if (!failed) {
				failed = true
				failure = error
			}
		}
		try {
			await this.#frame.send('Profiler.disable')
		} catch (error) {
			if (!failed) {
				failed = true
				failure = error
			}
		}
		if (failed) throw failure
		return readBrowserScriptCoverage(result)
	}

	async #stopCSS(): Promise<BrowserCoverageResult['styles']> {
		let result: unknown
		let failed = false
		let failure: unknown
		try {
			result = await this.#frame.send('CSS.stopRuleUsageTracking')
		} catch (error) {
			failed = true
			failure = error
		}
		try {
			await this.#frame.send('CSS.disable')
		} catch (error) {
			if (!failed) {
				failed = true
				failure = error
			}
		}
		try {
			await this.#frame.send('DOM.disable')
		} catch (error) {
			if (!failed) {
				failed = true
				failure = error
			}
		}
		if (failed) throw failure
		return readBrowserStyleCoverage(result)
	}
}
