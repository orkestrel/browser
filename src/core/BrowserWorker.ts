import type { BrowserWorkerCategory, BrowserWorkerInterface, CDPClientInterface } from './types.js'
import { BROWSER_RESULT_LIMIT } from './constants.js'
import { compileGuardedEvaluateExpression } from './compilers.js'
import { readEvaluationResult } from './helpers.js'
import { BrowserError } from './errors.js'

/**
 * Represents a dedicated, shared, or service worker attached through a flattened target session.
 */
export class BrowserWorker implements BrowserWorkerInterface {
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #id: string
	readonly #url: string
	readonly #category: BrowserWorkerCategory
	#closed = false

	constructor(
		client: CDPClientInterface,
		session: string,
		id: string,
		url: string,
		category: BrowserWorkerCategory,
	) {
		this.#client = client
		this.#session = session
		this.#id = id
		this.#url = url
		this.#category = category
	}

	get id(): string {
		return this.#id
	}

	get url(): string {
		return this.#url
	}

	get category(): BrowserWorkerCategory {
		return this.#category
	}

	async evaluate(expression: string, timeout?: number): Promise<unknown> {
		this.#assert()
		return readEvaluationResult(
			await this.#client.send(
				'Runtime.evaluate',
				{
					expression: compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT),
					returnByValue: true,
					awaitPromise: true,
				},
				{ session: this.#session, ...(timeout !== undefined ? { timeout } : {}) },
			),
		)
	}

	async send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
		this.#assert()
		return await this.#client.send(method, params, { session: this.#session })
	}

	detach(): void {
		this.#closed = true
	}

	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true
		try {
			await this.#client.send('Target.closeTarget', { targetId: this.#id })
		} catch {
			// The worker may already have terminated.
		}
	}

	#assert(): void {
		if (this.#closed) throw new BrowserError('Browser worker is closed')
		if (!this.#client.connected) throw new BrowserError('Browser worker is disconnected')
	}
}
