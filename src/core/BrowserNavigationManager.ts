import type {
	BrowserNavigationManagerInterface,
	BrowserNavigationWait,
	BrowserNavigationWaitOptions,
	BrowserPageInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS, BROWSER_WAIT_POLL_INTERVAL_MS } from './constants.js'
import { compileFunctionWaitExpression } from './compilers.js'
import { matchesBrowserURL, validateBrowserTimeout } from './helpers.js'
import { BrowserError } from './errors.js'

/**
 * URL and page-predicate waits resilient to ordinary navigation events.
 */
export class BrowserNavigationManager implements BrowserNavigationManagerInterface {
	readonly #page: BrowserPageInterface
	readonly #waits: Map<symbol, BrowserNavigationWait> = new Map()
	readonly #navigateHandler = this.#handleNavigate.bind(this)
	readonly #closeHandler = this.#handleClose.bind(this)

	constructor(page: BrowserPageInterface) {
		this.#page = page
		this.#page.emitter.on('navigate', this.#navigateHandler)
		this.#page.emitter.on('close', this.#closeHandler)
	}

	async wait(pattern: string, options?: BrowserNavigationWaitOptions): Promise<string> {
		const timeout = this.#timeout(options)
		if (matchesBrowserURL(this.#page.url, pattern)) return this.#page.url
		const deferred = Promise.withResolvers<string>()
		const id = Symbol(pattern)
		const timer = setTimeout(() => {
			this.#waits.delete(id)
			deferred.reject(
				new BrowserError('Browser URL wait timed out', 'BROWSER_NAVIGATION_TIMEOUT', {
					pattern,
					timeout,
				}),
			)
		}, timeout)
		this.#waits.set(id, {
			pattern,
			timer,
			resolve: deferred.resolve,
			reject: deferred.reject,
		})
		return await deferred.promise
	}

	async until(expression: string, options?: BrowserNavigationWaitOptions): Promise<unknown> {
		const timeout = this.#timeout(options)
		const result = await this.#page.evaluate(
			compileFunctionWaitExpression(expression, timeout),
			timeout + BROWSER_WAIT_POLL_INTERVAL_MS,
		)
		if (result !== false) return result
		throw new BrowserError('Browser predicate wait timed out', 'BROWSER_NAVIGATION_TIMEOUT', {
			expression,
			timeout,
		})
	}

	#handleNavigate(url: string): void {
		for (const [id, wait] of this.#waits) {
			if (!matchesBrowserURL(url, wait.pattern)) continue
			clearTimeout(wait.timer)
			this.#waits.delete(id)
			wait.resolve(url)
		}
	}

	#handleClose(): void {
		for (const [id, wait] of this.#waits) {
			clearTimeout(wait.timer)
			this.#waits.delete(id)
			wait.reject(new BrowserError('Browser URL wait ended because the page closed'))
		}
	}

	#timeout(options?: BrowserNavigationWaitOptions): number {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		return timeout
	}
}
