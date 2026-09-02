import type {
	BrowserCookieInput,
	BrowserCookieManagerInterface,
	BrowserPagesFunction,
	BrowserStorageManagerInterface,
	BrowserStorageOptions,
	BrowserStorageOrigin,
	BrowserStorageState,
} from './types.js'
import {
	compileStorageClearExpression,
	compileStorageReadExpression,
	compileStorageRestoreExpression,
} from './compilers.js'
import { readBrowserStorageOrigin } from './helpers.js'
import { BrowserError } from './errors.js'
import { attempt } from '@orkestrel/contract'

/**
 * Imports, exports, and clears cookie and web-storage state for one browser context.
 *
 * @example
 * ```ts
 * import { BrowserStorageManager } from '@orkestrel/browser'
 *
 * const storage = new BrowserStorageManager(context.cookies, () => context.pages())
 * const state = await storage.state({ origins: ['https://example.com'] })
 * await storage.restore(state)
 * ```
 */
export class BrowserStorageManager implements BrowserStorageManagerInterface {
	readonly #cookies: BrowserCookieManagerInterface
	readonly #pages: BrowserPagesFunction

	constructor(cookies: BrowserCookieManagerInterface, pages: BrowserPagesFunction) {
		this.#cookies = cookies
		this.#pages = pages
	}

	async state(options?: BrowserStorageOptions): Promise<BrowserStorageState> {
		const pages = this.#pages()
		const requested = options?.origins
		const origins =
			requested === undefined
				? [
						...new Set(
							pages.map((page) => this.#origin(page.url)).filter((origin) => origin !== undefined),
						),
					]
				: [...new Set(requested.map((origin) => this.#validate(origin)))]
		const storage: BrowserStorageOrigin[] = []

		for (const origin of origins) {
			const page = pages.find((candidate) => this.#origin(candidate.url) === origin)
			if (page === undefined) {
				throw new BrowserError('Storage origin has no attached page', undefined, { origin })
			}
			storage.push(
				readBrowserStorageOrigin(await page.evaluate(compileStorageReadExpression()), origin),
			)
		}

		const cookies: BrowserCookieInput[] = (await this.#cookies.cookies()).map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			expires: cookie.expires,
			http: cookie.http,
			secure: cookie.secure,
			...(cookie.site !== undefined ? { site: cookie.site } : {}),
			...(cookie.partition !== undefined ? { partition: cookie.partition } : {}),
		}))
		return { cookies, origins: storage }
	}

	async restore(state: BrowserStorageState): Promise<void> {
		const pages = this.#pages()
		for (const origin of state.origins) {
			const normalized = this.#validate(origin.origin)
			const page = pages.find((candidate) => this.#origin(candidate.url) === normalized)
			if (page === undefined) {
				throw new BrowserError('Storage origin has no attached page', undefined, {
					origin: normalized,
				})
			}
		}
		await this.#cookies.set(state.cookies)
		for (const origin of state.origins) {
			const normalized = this.#validate(origin.origin)
			const page = pages.find((candidate) => this.#origin(candidate.url) === normalized)
			if (page === undefined) {
				throw new BrowserError('Storage origin disappeared during restore', undefined, {
					origin: normalized,
				})
			}
			await page.evaluate(compileStorageRestoreExpression(origin))
		}
	}

	async clear(origin?: string): Promise<void> {
		await this.#cookies.clear()
		const normalized = origin === undefined ? undefined : this.#validate(origin)
		for (const page of this.#pages()) {
			if (normalized !== undefined && this.#origin(page.url) !== normalized) continue
			await page.evaluate(compileStorageClearExpression())
		}
	}

	#origin(value: string): string | undefined {
		const result = attempt(() => new URL(value))
		if (!result.success) return undefined
		if (result.value.protocol !== 'http:' && result.value.protocol !== 'https:') return undefined
		return result.value.origin
	}

	#validate(value: string): string {
		const origin = this.#origin(value)
		if (origin === undefined) {
			throw new BrowserError(
				'Browser storage origin must be an absolute HTTP(S) origin',
				undefined,
				{
					origin: value,
				},
			)
		}
		return origin
	}
}
