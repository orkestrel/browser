import type { BrowserClockInterface, BrowserFrameInterface } from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { BrowserError } from './errors.js'
import { isFiniteNumber } from '@orkestrel/contract'

/**
 * Chromium virtual-time budget controls for deterministic page timers.
 */
export class BrowserClock implements BrowserClockInterface {
	readonly #frame: BrowserFrameInterface
	#installed = false
	#advancing = false
	#budgetResolve: (() => void) | undefined
	#budgetHandler = (): void => this.#budgetResolve?.()

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	get installed(): boolean {
		return this.#installed
	}

	async install(time = Date.now()): Promise<void> {
		if (this.#installed) throw new BrowserError('Browser clock is already installed')
		if (!isFiniteNumber(time) || time < 0) {
			throw new BrowserError('Browser clock time must be a non-negative finite epoch', undefined, {
				time,
			})
		}
		await this.#frame.send('Emulation.setVirtualTimePolicy', {
			policy: 'pause',
			initialVirtualTime: time / 1000,
		})
		this.#installed = true
	}

	async pause(): Promise<void> {
		this.#assert()
		this.#idle()
		await this.#frame.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
	}

	async resume(): Promise<void> {
		this.#assert()
		this.#idle()
		await this.#frame.send('Emulation.setVirtualTimePolicy', {
			policy: 'advance',
			maxVirtualTimeTaskStarvationCount: 10_000,
		})
	}

	async advance(ms: number): Promise<void> {
		this.#assert()
		this.#idle()
		if (!isFiniteNumber(ms) || ms < 0) {
			throw new BrowserError('Browser clock advance must be non-negative and finite', undefined, {
				ms,
			})
		}
		if (ms === 0) {
			await this.pause()
			return
		}
		const deferred = Promise.withResolvers<void>()
		this.#advancing = true
		this.#budgetResolve = deferred.resolve
		try {
			await this.#frame.subscribe('Emulation.virtualTimeBudgetExpired', this.#budgetHandler)
		} catch (error) {
			this.#budgetResolve = undefined
			this.#advancing = false
			throw error
		}
		const timer = setTimeout(() => {
			deferred.reject(new BrowserError('Browser virtual-time budget timed out'))
		}, BROWSER_DEFAULT_TIMEOUT_MS)
		let failed = false
		let failure: unknown
		try {
			await this.#frame.send('Emulation.setVirtualTimePolicy', {
				policy: 'advance',
				budget: ms,
				maxVirtualTimeTaskStarvationCount: 10_000,
			})
			await deferred.promise
		} catch (error) {
			failed = true
			failure = error
		} finally {
			clearTimeout(timer)
			this.#budgetResolve = undefined
			try {
				await this.#frame.unsubscribe('Emulation.virtualTimeBudgetExpired', this.#budgetHandler)
			} catch (error) {
				if (!failed) {
					failed = true
					failure = error
				}
			}
			try {
				await this.#frame.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
			} catch (error) {
				if (!failed) {
					failed = true
					failure = error
				}
			}
			this.#advancing = false
		}
		if (failed) throw failure
	}

	async uninstall(): Promise<void> {
		if (!this.#installed) return
		this.#idle()
		await this.#frame.send('Emulation.setVirtualTimePolicy', {
			policy: 'advance',
			maxVirtualTimeTaskStarvationCount: 10_000,
		})
		this.#installed = false
	}

	#assert(): void {
		if (!this.#installed) throw new BrowserError('Browser clock is not installed')
	}

	#idle(): void {
		if (this.#advancing) throw new BrowserError('Browser clock advance is already active')
	}
}
