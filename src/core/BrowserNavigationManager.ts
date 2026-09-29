import type {
	BrowserCallOptions,
	BrowserLoaderFunction,
	BrowserNavigationManagerInterface,
	BrowserNavigationWait,
	BrowserPageInterface,
	CDPClientInterface,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { matchesBrowserURL, validateBrowserTimeout } from './helpers.js'
import { BrowserError } from './errors.js'
import { isString } from '@orkestrel/contract'

/**
 * Parks URL-pattern and network-idle waits on page events and abort signals.
 *
 * @example
 * ```ts
 * import { BrowserNavigationManager } from '@orkestrel/browser'
 *
 * const navigation = new BrowserNavigationManager(page, client, 'session-1', () => loader)
 * const url = await navigation.wait('https://example.com/checkout', { timeout: 5_000 })
 * await navigation.idle({ signal: AbortSignal.timeout(10_000) })
 * ```
 */
export class BrowserNavigationManager implements BrowserNavigationManagerInterface {
	readonly #page: BrowserPageInterface
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #loader: BrowserLoaderFunction
	readonly #waits: Map<symbol, BrowserNavigationWait> = new Map()
	readonly #navigateHandler = this.#handleNavigate.bind(this)
	readonly #lifecycleHandler = this.#handleLifecycle.bind(this)
	readonly #closeHandler = this.#handleClose.bind(this)

	constructor(
		page: BrowserPageInterface,
		client: CDPClientInterface,
		session: string,
		loader: BrowserLoaderFunction,
	) {
		this.#page = page
		this.#client = client
		this.#session = session
		this.#loader = loader
		this.#page.emitter.on('navigate', this.#navigateHandler)
		this.#page.emitter.on('close', this.#closeHandler)
		this.#client.subscribe('Page.lifecycleEvent', this.#lifecycleHandler, this.#session)
	}

	async wait(pattern: string, options?: BrowserCallOptions): Promise<string> {
		const timeout = this.#timeout(options)
		if (options?.signal?.aborted === true) throw options.signal.reason
		if (matchesBrowserURL(this.#page.url, pattern)) return this.#page.url
		return await this.#park(pattern, timeout, options?.signal)
	}

	async idle(options?: BrowserCallOptions): Promise<void> {
		const timeout = this.#timeout(options)
		if (options?.signal?.aborted === true) throw options.signal.reason
		await this.#park(undefined, timeout, options?.signal)
	}

	#park(pattern: string | undefined, timeout: number, signal?: AbortSignal): Promise<string> {
		const deferred = Promise.withResolvers<string>()
		const id = Symbol(pattern ?? 'idle')
		const timer = setTimeout(() => {
			this.#settle(id)
			deferred.reject(
				new BrowserError(
					pattern === undefined
						? 'Browser network idle wait timed out'
						: 'Browser URL wait timed out',
					'BROWSER_NAVIGATION_TIMEOUT',
					{ pattern, timeout },
				),
			)
		}, timeout)
		const listener = signal === undefined ? undefined : this.#abort(id, signal, deferred.reject)
		if (listener !== undefined) signal?.addEventListener('abort', listener, { once: true })
		this.#waits.set(id, {
			pattern,
			timer,
			signal,
			listener,
			resolve: deferred.resolve,
			reject: deferred.reject,
		})
		return deferred.promise
	}

	#abort(id: symbol, signal: AbortSignal, reject: (error: unknown) => void): () => void {
		return () => {
			this.#settle(id)
			reject(signal.reason)
		}
	}

	#settle(id: symbol): BrowserNavigationWait | undefined {
		const wait = this.#waits.get(id)
		if (wait === undefined) return undefined
		clearTimeout(wait.timer)
		if (wait.listener !== undefined) wait.signal?.removeEventListener('abort', wait.listener)
		this.#waits.delete(id)
		return wait
	}

	#handleNavigate(url: string): void {
		for (const [id, wait] of this.#waits) {
			if (wait.pattern === undefined || !matchesBrowserURL(url, wait.pattern)) continue
			this.#settle(id)?.resolve(url)
		}
	}

	#handleLifecycle(params: Readonly<Record<string, unknown>>): void {
		const loader = this.#loader()
		if (params['name'] !== 'networkIdle' || !isString(params['loaderId'])) return
		if (loader === undefined || params['loaderId'] !== loader) return
		for (const [id, wait] of this.#waits) {
			if (wait.pattern !== undefined) continue
			this.#settle(id)?.resolve(this.#page.url)
		}
	}

	#handleClose(): void {
		this.#client.unsubscribe('Page.lifecycleEvent', this.#lifecycleHandler, this.#session)
		for (const id of [...this.#waits.keys()]) {
			this.#settle(id)?.reject(
				new BrowserError('Browser navigation wait ended because the page closed'),
			)
		}
	}

	#timeout(options?: BrowserCallOptions): number {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		return timeout
	}
}
