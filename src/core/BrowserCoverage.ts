import type {
	BrowserCoverageInterface,
	BrowserCoverageOptions,
	BrowserCoverageResult,
	BrowserFrameInterface,
} from './types.js'
import {
	readBrowserScriptCoverage,
	readBrowserStyleCoverage,
	settleBrowserTeardown,
} from './helpers.js'
import { BrowserError } from './errors.js'
import type { Result } from '@orkestrel/contract'

/**
 * Collects JavaScript precise coverage and CSS rule usage for one page target.
 *
 * @remarks The owner exposes this entity through `page.diagnostics.coverage`.
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
		if (this.#active) throw new BrowserError('ARGUMENT', 'Browser coverage is already active')
		const javascript = options?.javascript ?? true
		const css = options?.css ?? true
		if (!javascript && !css) {
			throw new BrowserError('ARGUMENT', 'Browser coverage requires JavaScript, CSS, or both')
		}
		const cleanup: Array<() => Promise<unknown>> = []
		try {
			if (javascript) {
				await this.#frame.send('Profiler.enable')
				cleanup.push(() => this.#frame.send('Profiler.disable'))
				await this.#frame.send('Profiler.startPreciseCoverage', {
					callCount: true,
					detailed: options?.detailed ?? true,
					allowTriggeredUpdates: false,
				})
				cleanup.push(() => this.#frame.send('Profiler.stopPreciseCoverage'))
			}
			if (css) {
				await this.#frame.send('DOM.enable')
				cleanup.push(() => this.#frame.send('DOM.disable'))
				await this.#frame.send('CSS.enable')
				cleanup.push(() => this.#frame.send('CSS.disable'))
				await this.#frame.send('CSS.startRuleUsageTracking')
				cleanup.push(() => this.#frame.send('CSS.stopRuleUsageTracking'))
			}
		} catch (error) {
			for (const release of cleanup.toReversed()) await release().catch(() => undefined)
			throw error
		}
		this.#options = options
		this.#active = true
	}

	async stop(): Promise<BrowserCoverageResult> {
		if (!this.#active) throw new BrowserError('ARGUMENT', 'Browser coverage is not active')
		this.#active = false
		const javascript = this.#options?.javascript ?? true
		const css = this.#options?.css ?? true
		const scripts: Result<BrowserCoverageResult['scripts']> = javascript
			? await this.#stopJavaScript().then(
					(value) => ({ success: true, value }),
					(error: unknown) => ({ success: false, error }),
				)
			: { success: true, value: [] }
		const styles: Result<BrowserCoverageResult['styles']> = css
			? await this.#stopCSS().then(
					(value) => ({ success: true, value }),
					(error: unknown) => ({ success: false, error }),
				)
			: { success: true, value: [] }
		this.#options = undefined
		const failure = !scripts.success ? scripts.error : !styles.success ? styles.error : undefined
		if (failure !== undefined) throw failure
		return {
			scripts: scripts.success ? scripts.value : [],
			styles: styles.success ? styles.value : [],
		}
	}

	async destroy(): Promise<void> {
		if (!this.#active) return
		await this.stop().catch(() => undefined)
	}

	async #stopJavaScript(): Promise<BrowserCoverageResult['scripts']> {
		const result = await this.#readCoverage('Profiler.takePreciseCoverage')
		const failure = await settleBrowserTeardown(
			() => this.#frame.send('Profiler.stopPreciseCoverage'),
			() => this.#frame.send('Profiler.disable'),
		)
		const error = result.success ? failure : result.error
		if (error !== undefined) throw error
		return readBrowserScriptCoverage(result.success ? result.value : undefined)
	}

	async #stopCSS(): Promise<BrowserCoverageResult['styles']> {
		const result = await this.#readCoverage('CSS.stopRuleUsageTracking')
		const failure = await settleBrowserTeardown(
			() => this.#frame.send('CSS.disable'),
			() => this.#frame.send('DOM.disable'),
		)
		const error = result.success ? failure : result.error
		if (error !== undefined) throw error
		return readBrowserStyleCoverage(result.success ? result.value : undefined)
	}

	async #readCoverage(method: string): Promise<Result<unknown>> {
		try {
			return { success: true, value: await this.#frame.send(method) }
		} catch (error) {
			return { success: false, error }
		}
	}
}
