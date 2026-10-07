import type {
	BrowserCallOptions,
	BrowserLoaderFunction,
	BrowserNavigationEventMap,
	BrowserNavigationManagerInterface,
	BrowserNavigationRecordInterface,
	BrowserPageInterface,
	CDPClientInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BrowserNavigationRecord } from './BrowserNavigationRecord.js'
import { BROWSER_DEFAULT_TIMEOUT_MS } from './constants.js'
import { assertBrowserPage, matchesBrowserURL, validateBrowserTimeout } from './helpers.js'
import { BrowserError } from './errors.js'
import { isString } from '@orkestrel/contract'

/**
 * Parks URL-pattern and network-idle waits on page events and abort signals, and opens the records
 * that settle the navigation an input starts.
 *
 * @remarks
 * `steps` carries the navigation steps the page accepts from the session that owns each frame,
 * and `parent` returns the parent the page last recorded for a frame, or `undefined` when the
 * page cannot name it. A record opened here rejects its pending waits with the page-closed error
 * when the page closes.
 *
 * @example
 * ```ts
 * import { BrowserNavigationManager } from '@orkestrel/browser'
 *
 * const navigation = new BrowserNavigationManager(page, client, 'session-1', () => loader, steps, parent)
 * const url = await navigation.wait('https://example.com/checkout', { timeout: 5_000 })
 * await navigation.idle({ signal: AbortSignal.timeout(10_000) })
 * const record = navigation.record(page.id)
 * ```
 */
export class BrowserNavigationManager implements BrowserNavigationManagerInterface {
	readonly #page: BrowserPageInterface
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #loader: BrowserLoaderFunction
	readonly #steps: EmitterInterface<BrowserNavigationEventMap>
	readonly #parent: (frame: string) => string | undefined
	// Aborts with the page-closed error when the page closes, which ends every record.
	readonly #lifetime = new AbortController()
	readonly #waits: Map<
		symbol,
		{
			readonly pattern: string | undefined
			readonly timer: ReturnType<typeof setTimeout>
			readonly signal: AbortSignal | undefined
			readonly listener: (() => void) | undefined
			readonly resolve: (url: string) => void
			readonly reject: (error: unknown) => void
		}
	> = new Map()
	readonly #navigateHandler = this.#handleNavigate.bind(this)
	readonly #lifecycleHandler = this.#handleLifecycle.bind(this)
	readonly #closeHandler = this.#handleClose.bind(this)

	constructor(
		page: BrowserPageInterface,
		client: CDPClientInterface,
		session: string,
		loader: BrowserLoaderFunction,
		steps: EmitterInterface<BrowserNavigationEventMap>,
		parent: (frame: string) => string | undefined,
	) {
		this.#page = page
		this.#client = client
		this.#session = session
		this.#loader = loader
		this.#steps = steps
		this.#parent = parent
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

	record(frame: string): BrowserNavigationRecordInterface {
		assertBrowserPage(this.#page, this.#client)
		return new BrowserNavigationRecord(
			this.#steps,
			this.#page.id,
			this.#parent,
			frame,
			this.#lifetime.signal,
		)
	}

	#park(pattern: string | undefined, timeout: number, signal?: AbortSignal): Promise<string> {
		const deferred = Promise.withResolvers<string>()
		const id = Symbol(pattern ?? 'idle')
		const timer = setTimeout(() => {
			this.#settle(id)
			deferred.reject(
				new BrowserError(
					'NAVIGATION_TIMEOUT',
					pattern === undefined
						? 'Browser network idle wait timed out'
						: 'Browser URL wait timed out',
					{ ...(pattern === undefined ? {} : { pattern }), timeout },
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

	#settle(id: symbol):
		| {
				readonly pattern: string | undefined
				readonly timer: ReturnType<typeof setTimeout>
				readonly signal: AbortSignal | undefined
				readonly listener: (() => void) | undefined
				readonly resolve: (url: string) => void
				readonly reject: (error: unknown) => void
		  }
		| undefined {
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
		const closed = new BrowserError(
			'CLOSED',
			'Browser navigation wait ended because the page closed',
		)
		for (const id of [...this.#waits.keys()]) this.#settle(id)?.reject(closed)
		this.#lifetime.abort(closed)
	}

	#timeout(options?: BrowserCallOptions): number {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		return timeout
	}
}
