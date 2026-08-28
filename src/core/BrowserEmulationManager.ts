import type {
	BrowserEmulationManagerInterface,
	BrowserEmulationOptions,
	BrowserPageInterface,
	BrowserPagesFunction,
} from './types.js'
import { mediaToFeatures, validateBrowserEmulationOptions } from './helpers.js'

/**
 * Rendering, identity, location, and network emulation for context pages.
 */
export class BrowserEmulationManager implements BrowserEmulationManagerInterface {
	readonly #pages: BrowserPagesFunction
	#options: BrowserEmulationOptions | undefined

	constructor(pages: BrowserPagesFunction, options?: BrowserEmulationOptions) {
		if (options !== undefined) validateBrowserEmulationOptions(options)
		this.#pages = pages
		this.#options = options
	}

	async apply(options: BrowserEmulationOptions): Promise<void> {
		validateBrowserEmulationOptions(options)
		const previous = this.#options
		const changed: BrowserPageInterface[] = []
		try {
			for (const page of this.#pages()) {
				changed.push(page)
				if (previous !== undefined) await this.#clearPage(page, previous)
				await this.#configurePage(page, options)
			}
		} catch (error) {
			for (const page of changed.reverse()) {
				await this.#clearPage(page, options).catch(() => undefined)
				if (previous !== undefined) {
					await this.#configurePage(page, previous).catch(() => undefined)
				}
			}
			throw error
		}
		this.#options = options
	}

	async clear(): Promise<void> {
		const previous = this.#options
		if (previous === undefined) return
		const changed: BrowserPageInterface[] = []
		try {
			for (const page of this.#pages()) {
				changed.push(page)
				await this.#clearPage(page, previous)
			}
		} catch (error) {
			for (const page of changed.reverse()) {
				await this.#clearPage(page, previous).catch(() => undefined)
				await this.#configurePage(page, previous).catch(() => undefined)
			}
			throw error
		}
		this.#options = undefined
	}

	async attach(page: BrowserPageInterface): Promise<void> {
		const options = this.#options
		if (options === undefined) return
		try {
			await this.#configurePage(page, options)
		} catch (error) {
			await this.#clearPage(page, options).catch(() => undefined)
			throw error
		}
	}

	async #configurePage(
		page: BrowserPageInterface,
		options: BrowserEmulationOptions,
	): Promise<void> {
		if (options.viewport !== undefined) {
			await page.send('Emulation.setDeviceMetricsOverride', {
				width: options.viewport.width,
				height: options.viewport.height,
				deviceScaleFactor: options.viewport.scale ?? 1,
				mobile: options.viewport.mobile ?? false,
				screenOrientation:
					options.viewport.landscape === undefined
						? undefined
						: {
								type: options.viewport.landscape ? 'landscapePrimary' : 'portraitPrimary',
								angle: options.viewport.landscape ? 90 : 0,
							},
			})
			await page.send('Emulation.setTouchEmulationEnabled', {
				enabled: options.viewport.touch ?? false,
			})
		}
		if (options.user !== undefined) {
			await page.send('Emulation.setUserAgentOverride', {
				userAgent: options.user.value,
				acceptLanguage: options.user.language,
				platform: options.user.platform,
			})
		}
		if (options.locale !== undefined) {
			await page.send('Emulation.setLocaleOverride', { locale: options.locale })
		}
		if (options.timezone !== undefined) {
			await page.send('Emulation.setTimezoneOverride', { timezoneId: options.timezone })
		}
		if (options.geolocation !== undefined) {
			await page.send('Emulation.setGeolocationOverride', {
				latitude: options.geolocation.latitude,
				longitude: options.geolocation.longitude,
				accuracy: options.geolocation.accuracy,
			})
		}
		if (options.media !== undefined) {
			await page.send('Emulation.setEmulatedMedia', {
				media: options.media.media ?? '',
				features: mediaToFeatures(options.media),
			})
		}
		if (options.offline !== undefined) {
			await page.send('Network.emulateNetworkConditions', {
				offline: options.offline,
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			})
		}
		if (options.headers !== undefined) {
			await page.send('Network.setExtraHTTPHeaders', { headers: options.headers })
		}
		if (options.credentials !== undefined) {
			await page.network.credentials(options.credentials)
		}
	}

	async #clearPage(page: BrowserPageInterface, options: BrowserEmulationOptions): Promise<void> {
		if (options.viewport !== undefined) {
			await page.send('Emulation.clearDeviceMetricsOverride')
			await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
		}
		if (options.user !== undefined) {
			await page.send('Emulation.setUserAgentOverride', { userAgent: '' })
		}
		if (options.locale !== undefined) {
			await page.send('Emulation.setLocaleOverride', { locale: '' })
		}
		if (options.timezone !== undefined) {
			await page.send('Emulation.setTimezoneOverride', { timezoneId: '' })
		}
		if (options.geolocation !== undefined) {
			await page.send('Emulation.clearGeolocationOverride')
		}
		if (options.media !== undefined) {
			await page.send('Emulation.setEmulatedMedia', { media: '', features: [] })
		}
		if (options.offline !== undefined) {
			await page.send('Network.emulateNetworkConditions', {
				offline: false,
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			})
		}
		if (options.headers !== undefined) {
			await page.send('Network.setExtraHTTPHeaders', { headers: {} })
		}
		if (options.credentials !== undefined) await page.network.credentials(undefined)
	}
}
