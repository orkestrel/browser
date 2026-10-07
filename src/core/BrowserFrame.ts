import type {
	BrowserEpochFunction,
	BrowserFrameLocation,
	BrowserFrameInterface,
	BrowserHandleInterface,
	BrowserReadingInterface,
	BrowserCallOptions,
	BrowserSessionFunction,
	BrowserWorldFunction,
	CDPHandler,
	CDPClientInterface,
} from './types.js'
import { BrowserHandle } from './BrowserHandle.js'
import { BrowserReading } from './BrowserReading.js'
import { BROWSER_FRAME_WORLD_NAME, BROWSER_RESULT_LIMIT } from './constants.js'
import { compileGuardedEvaluateExpression, compileReadFunction } from './compilers.js'
import { readBrowserWorld, readEvaluationResult, requireBrowserString } from './helpers.js'
import { BrowserError } from './errors.js'
import { isRecord, isString } from '@orkestrel/contract'

/**
 * Represents one attached document frame, evaluated through its own CDP execution world.
 *
 * @remarks
 * The optional `epoch` constructor parameter reads the frame's navigation counter, which lets
 * `read()` mark a reading stale after a later navigation. The optional `world` parameter
 * resolves a cached isolated-world context, which lets a page share one world across reads.
 * A standalone frame built with neither returns readings whose `stale` stays `false`, because
 * no navigation counter is available to it, and creates a fresh world for each read.
 *
 */
export class BrowserFrame implements BrowserFrameInterface {
	readonly #client: CDPClientInterface
	readonly #session: string | BrowserSessionFunction
	readonly #id: string
	readonly #parent: string | undefined
	readonly #name: string | undefined
	readonly #isolated: boolean
	readonly #epoch: BrowserEpochFunction | undefined
	readonly #world: BrowserWorldFunction | undefined
	readonly #assertion: (() => void) | undefined
	#url: string | BrowserFrameLocation

	constructor(
		client: CDPClientInterface,
		session: string | BrowserSessionFunction,
		id: string,
		url: string | BrowserFrameLocation,
		parent?: string,
		name?: string,
		isolated = true,
		epoch?: BrowserEpochFunction,
		world?: BrowserWorldFunction,
		assert?: () => void,
	) {
		this.#client = client
		this.#session = session
		this.#id = id
		this.#url = url
		this.#parent = parent
		this.#name = name
		this.#isolated = isolated
		this.#epoch = epoch
		this.#world = world
		this.#assertion = assert
	}

	get id(): string {
		return this.#id
	}

	get parent(): string | undefined {
		return this.#parent
	}

	get name(): string | undefined {
		return this.#name
	}

	get url(): string {
		return isString(this.#url) ? this.#url : this.#url.get()
	}

	async title(options?: BrowserCallOptions): Promise<string> {
		this.#assert()
		const result = await this.#evaluate('document.title', options)
		return requireBrowserString(result, 'Document title')
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		this.#assert()
		// The epoch is sampled before the capture is issued, so a navigation that lands while the
		// evaluation is in flight leaves the reading stale rather than current.
		const epoch = this.#epoch?.()
		options?.signal?.throwIfAborted()
		const session = await this.#sessionId()
		const context =
			this.#world === undefined
				? await this.#create(session, options)
				: await this.#world(session, options)
		const result = await this.#client.send(
			'Runtime.evaluate',
			{
				expression: compileGuardedEvaluateExpression(
					`(${compileReadFunction()})()`,
					BROWSER_RESULT_LIMIT,
				),
				returnByValue: true,
				awaitPromise: true,
				contextId: context,
			},
			{ session, ...options },
		)
		const capture = readEvaluationResult(result)
		if (
			!isRecord(capture) ||
			!isString(capture['url']) ||
			!isString(capture['title']) ||
			!isString(capture['html'])
		) {
			throw new BrowserError('PROTOCOL', 'Browser read capture is malformed', { frame: this.#id })
		}
		// A capture that a navigation overtook must not regress the frame URL the navigation set.
		if (this.#epoch === undefined || this.#epoch() === epoch) {
			if (isString(this.#url)) this.#url = capture['url']
			else this.#url.set(capture['url'])
		}
		return new BrowserReading({
			url: capture['url'],
			title: capture['title'],
			html: capture['html'],
			...(epoch === undefined || this.#epoch === undefined
				? {}
				: { epoch, navigation: this.#epoch }),
		})
	}

	async evaluate(expression: string, options?: BrowserCallOptions): Promise<unknown> {
		this.#assert()
		return await this.#evaluate(
			compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT),
			options,
		)
	}

	async handle(expression: string, options?: BrowserCallOptions): Promise<BrowserHandleInterface> {
		this.#assert()
		const session = await this.#sessionId()
		const params: Record<string, unknown> = {
			expression,
			returnByValue: false,
			awaitPromise: true,
		}
		const context = await this.#context(session, options)
		if (context !== undefined) params['contextId'] = context
		const result = await this.#client.send('Runtime.evaluate', params, {
			session,
			...options,
		})
		if (
			!isRecord(result) ||
			!isRecord(result['result']) ||
			!isString(result['result']['objectId'])
		) {
			throw new BrowserError('PROTOCOL', 'Browser expression did not resolve to an object handle', {
				frame: this.#id,
			})
		}
		return new BrowserHandle(this.#client, session, result['result']['objectId'])
	}

	async send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<unknown> {
		this.#assert()
		return await this.#client.send(method, params, {
			session: await this.#sessionId(),
			...options,
		})
	}

	async subscribe(method: string, handler: CDPHandler): Promise<void> {
		this.#assert()
		this.#client.subscribe(method, handler, await this.#sessionId())
	}

	async unsubscribe(method: string, handler: CDPHandler): Promise<void> {
		this.#client.unsubscribe(method, handler, await this.#sessionId())
	}

	#assert(): void {
		this.#assertion?.()
		if (!this.#client.connected) {
			throw new BrowserError('CLOSED', 'Browser frame is disconnected', { frame: this.#id })
		}
	}

	async #evaluate(expression: string, options?: BrowserCallOptions): Promise<unknown> {
		const session = await this.#sessionId()
		const params: Record<string, unknown> = {
			expression,
			returnByValue: true,
			awaitPromise: true,
		}

		const context = await this.#context(session, options)
		if (context !== undefined) params['contextId'] = context

		const result = await this.#client.send('Runtime.evaluate', params, {
			session,
			...options,
		})
		return readEvaluationResult(result)
	}

	async #context(session: string, options?: BrowserCallOptions): Promise<number | undefined> {
		if (!this.#isolated) return undefined
		if (this.#world !== undefined) return await this.#world(session, options)
		return await this.#create(session, options)
	}

	async #create(session: string, options?: BrowserCallOptions): Promise<number> {
		const world = await this.#client.send(
			'Page.createIsolatedWorld',
			{ frameId: this.#id, worldName: BROWSER_FRAME_WORLD_NAME },
			{ session, ...options },
		)
		return readBrowserWorld(world, this.#id)
	}

	async #sessionId(): Promise<string> {
		if (isString(this.#session)) return this.#session
		return await this.#session(this.#id)
	}
}
