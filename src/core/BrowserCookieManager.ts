import type {
	BrowserCookie,
	BrowserCookieFilter,
	BrowserCookieInput,
	BrowserCookieManagerInterface,
	CDPClientInterface,
} from './types.js'
import { cookieToProtocol, matchesBrowserCookieURL, readBrowserCookies } from './helpers.js'
import { isRecord } from '@orkestrel/contract'
import { BrowserError } from './errors.js'

/**
 * Performs cookie operations isolated to one browser context.
 *
 * @remarks The owner exposes this entity through `context.cookies`.
 */
export class BrowserCookieManager implements BrowserCookieManagerInterface {
	readonly #client: CDPClientInterface
	readonly #context: string | undefined

	constructor(client: CDPClientInterface, context?: string) {
		this.#client = client
		this.#context = context
	}

	async cookies(urls?: readonly string[]): Promise<readonly BrowserCookie[]> {
		const params: Record<string, unknown> = {}
		if (this.#context !== undefined) params['browserContextId'] = this.#context
		const result = await this.#client.send('Storage.getCookies', params)
		const cookies = readBrowserCookies(result)
		if (urls === undefined || urls.length === 0) return cookies

		return cookies.filter((cookie) => urls.some((value) => matchesBrowserCookieURL(cookie, value)))
	}

	async set(cookies: readonly BrowserCookieInput[]): Promise<void> {
		if (cookies.length === 0) return
		const params: Record<string, unknown> = {
			cookies: cookies.map(cookieToProtocol),
		}
		if (this.#context !== undefined) params['browserContextId'] = this.#context
		await this.#client.send('Storage.setCookies', params)
	}

	async clear(): Promise<void> {
		await this.#client.send(
			'Storage.clearCookies',
			this.#context === undefined ? {} : { browserContextId: this.#context },
		)
	}

	async remove(filter: BrowserCookieFilter): Promise<void> {
		if (filter.name === undefined && filter.domain === undefined && filter.path === undefined)
			throw new BrowserError('ARGUMENT', 'Cookie removal requires a name, domain, or path', {
				operation: 'remove',
			})
		const params: Record<string, unknown> = {}
		if (this.#context !== undefined) params['browserContextId'] = this.#context

		const retained = (await this.cookies()).filter((cookie) => {
			if (filter.name !== undefined && cookie.name !== filter.name) return true
			if (filter.domain !== undefined && cookie.domain !== filter.domain) return true
			if (filter.path !== undefined && cookie.path !== filter.path) return true
			return false
		})
		await this.#client.send('Storage.clearCookies', params)
		if (retained.length === 0) return
		const cookies = retained.map((cookie) =>
			cookieToProtocol({
				name: cookie.name,
				value: cookie.value,
				domain: cookie.domain,
				path: cookie.path,
				expires: cookie.expires,
				http: cookie.http,
				secure: cookie.secure,
				...(cookie.site !== undefined ? { site: cookie.site } : {}),
				...(cookie.partition !== undefined ? { partition: cookie.partition } : {}),
			}),
		)
		const restore: Record<string, unknown> = { cookies }
		if (this.#context !== undefined) restore['browserContextId'] = this.#context
		const result = await this.#client.send('Storage.setCookies', restore)
		if (result !== undefined && !isRecord(result)) {
			throw new BrowserError('PROTOCOL', 'Browser cookie restore returned a malformed result')
		}
	}
}
