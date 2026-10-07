import type { BrowserClockInterface, BrowserFrameInterface } from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { BrowserError } from './errors.js'
import { settleBrowserTeardown } from './helpers.js'
import { isFiniteNumber } from '@orkestrel/contract'

/**
 * Controls the Chromium virtual-time budget for deterministic page timers.
 *
 * @remarks The owner exposes this entity through `page.clock`.
 */
export class BrowserClock implements BrowserClockInterface {
	readonly #frame: BrowserFrameInterface
	#active = false
	#advancing = false
	#budgetResolve: (() => void) | undefined
	readonly #budgetHandler = this.#handleBudget.bind(this)

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	get active(): boolean {
		return this.#active
	}

	async start(time = Date.now()): Promise<void> {
		if (this.#active) throw new BrowserError('ARGUMENT', 'Browser clock is already active')
		if (!isFiniteNumber(time) || time < 0) {
			throw new BrowserError('ARGUMENT', 'Browser clock time must be a non-negative finite epoch', {
				time,
			})
		}
		await this.#frame.send('Emulation.setVirtualTimePolicy', {
			policy: 'pause',
			initialVirtualTime: time / 1000,
		})
		this.#active = true
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
			throw new BrowserError('ARGUMENT', 'Browser clock advance must be non-negative and finite', {
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
			deferred.reject(
				new BrowserError('TIMEOUT', 'Browser virtual-time budget timed out', {
					operation: 'advance',
					ms,
				}),
			)
		}, BROWSER_DEFAULT_TIMEOUT_MS)
		let failure: unknown
		try {
			await this.#frame.send('Emulation.setVirtualTimePolicy', {
				policy: 'advance',
				budget: ms,
				maxVirtualTimeTaskStarvationCount: 10_000,
			})
			await deferred.promise
		} catch (error) {
			failure = error
		} finally {
			clearTimeout(timer)
			this.#budgetResolve = undefined
			const settled = await settleBrowserTeardown(
				() => this.#frame.unsubscribe('Emulation.virtualTimeBudgetExpired', this.#budgetHandler),
				() => this.#frame.send('Emulation.setVirtualTimePolicy', { policy: 'pause' }),
			)
			failure ??= settled
			this.#advancing = false
		}
		if (failure !== undefined) throw failure
	}

	async stop(): Promise<void> {
		if (!this.#active) return
		this.#idle()
		await this.#frame.send('Emulation.setVirtualTimePolicy', {
			policy: 'advance',
			maxVirtualTimeTaskStarvationCount: 10_000,
		})
		this.#active = false
	}

	#assert(): void {
		if (!this.#active) throw new BrowserError('ARGUMENT', 'Browser clock is not active')
	}

	#idle(): void {
		if (this.#advancing)
			throw new BrowserError('ARGUMENT', 'Browser clock advance is already active')
	}

	#handleBudget(): void {
		this.#budgetResolve?.()
	}
}
