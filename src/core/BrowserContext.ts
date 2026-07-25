import type {
	BrowserContextEventMap,
	BrowserContextInterface,
	BrowserCookieManagerInterface,
	BrowserDownloadOptions,
	BrowserEmulationManagerInterface,
	BrowserEmulationOptions,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserPermissionManagerInterface,
	BrowserStorageManagerInterface,
	BrowserViewport,
	CDPClientInterface,
	CDPTarget,
	ScreenshotWriterInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BrowserCookieManager } from './BrowserCookieManager.js'
import { BrowserEmulationManager } from './BrowserEmulationManager.js'
import { BrowserPage } from './BrowserPage.js'
import { BrowserPermissionManager } from './BrowserPermissionManager.js'
import { BrowserStorageManager } from './BrowserStorageManager.js'
import { BrowserError } from './errors.js'
import { readBrowserFrames, validateBrowserViewport } from './helpers.js'
import { instanceOf, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'

// === BrowserContext

/**
 * Owns pages and shared state inside one Chromium browser context.
 */
export class BrowserContext implements BrowserContextInterface {
	readonly #client: CDPClientInterface
	readonly #id: string | undefined
	readonly #viewport: BrowserViewport | undefined
	readonly #writer: ScreenshotWriterInterface | undefined
	readonly #downloads: BrowserDownloadOptions | undefined
	readonly #emitter: Emitter<BrowserContextEventMap>
	readonly #cookies: BrowserCookieManager
	readonly #permissions: BrowserPermissionManager
	readonly #storage: BrowserStorageManager
	readonly #emulation: BrowserEmulationManager
	readonly #pages: Map<string, BrowserPage> = new Map()
	readonly #creating: Set<Promise<BrowserPage>> = new Set()
	#syncing: Promise<void> | undefined
	#shutdown: Promise<void> | undefined
	#closed = false

	constructor(
		client: CDPClientInterface,
		id?: string,
		viewport?: BrowserViewport,
		writer?: ScreenshotWriterInterface,
		emulation?: BrowserEmulationOptions,
		downloads?: BrowserDownloadOptions,
	) {
		this.#client = client
		if (viewport !== undefined) validateBrowserViewport(viewport)
		this.#id = id
		this.#viewport = viewport
		this.#writer = writer
		this.#downloads = downloads
		this.#emitter = new Emitter()
		this.#cookies = new BrowserCookieManager(client, id)
		this.#permissions = new BrowserPermissionManager(client, id)
		this.#storage = new BrowserStorageManager(this.#cookies, () => this.pages())
		this.#emulation = new BrowserEmulationManager(() => this.pages(), emulation)
	}

	get emitter(): EmitterInterface<BrowserContextEventMap> {
		return this.#emitter
	}

	get id(): string | undefined {
		return this.#id
	}

	get cookies(): BrowserCookieManagerInterface {
		return this.#cookies
	}

	get permissions(): BrowserPermissionManagerInterface {
		return this.#permissions
	}

	get storage(): BrowserStorageManagerInterface {
		return this.#storage
	}

	get emulation(): BrowserEmulationManagerInterface {
		return this.#emulation
	}

	page(index?: number): BrowserPageInterface | undefined {
		const i = index ?? 0
		const pages = [...this.#pages.values()]
		return i >= 0 && i < pages.length ? pages[i] : undefined
	}

	pages(): readonly BrowserPageInterface[] {
		return [...this.#pages.values()]
	}

	async create(options?: BrowserPageOptions): Promise<BrowserPageInterface> {
		if (this.#closed) throw new BrowserError('Browser context is closed')

		const attempt = this.#create(options)
		this.#creating.add(attempt)
		try {
			return await attempt
		} finally {
			this.#creating.delete(attempt)
		}
	}

	async sync(targets: readonly CDPTarget[]): Promise<void> {
		while (this.#syncing !== undefined) {
			await this.#syncing
		}
		if (this.#closed) throw new BrowserError('Browser context is closed')

		const attempt = this.#sync(targets)
		this.#syncing = attempt
		try {
			await attempt
		} finally {
			if (this.#syncing === attempt) this.#syncing = undefined
		}
	}

	destroy(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active

		this.#closed = true
		const shutdown = this.#destroyResources()
		this.#shutdown = shutdown
		return shutdown
	}

	close(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active

		this.#closed = true
		const shutdown = this.#closeResources()
		this.#shutdown = shutdown
		return shutdown
	}

	// === Private helpers

	async #create(options?: BrowserPageOptions): Promise<BrowserPage> {
		if (options?.viewport !== undefined) validateBrowserViewport(options.viewport)
		const result: unknown = await this.#client.send('Target.createTarget', {
			url: 'about:blank',
			...(this.#id === undefined ? {} : { browserContextId: this.#id }),
		})

		if (!isRecord(result) || !isString(result['targetId'])) {
			throw new BrowserError('Failed to create new browser target')
		}

		const targetId = result['targetId']
		let page: BrowserPage | undefined

		try {
			const viewport = options?.viewport ?? this.#viewport
			page = await this.#attach(targetId, options?.url ?? 'about:blank', viewport)

			if (options?.url !== undefined && options.url !== 'about:blank') {
				await page.navigate(options.url, { timeout: options.timeout })
			}
			if (this.#closed) throw new BrowserError('Browser context closed during page creation')

			this.#pages.set(targetId, page)
			this.#emitter.emit('page', page)
			return page
		} catch (error) {
			if (page !== undefined) {
				await page.close()
			} else {
				await this.#closeTarget(targetId)
			}
			throw error
		}
	}

	async #sync(targets: readonly CDPTarget[]): Promise<void> {
		const pageTargets = targets.filter((target) => target.type === 'page')
		const targetIds = new Set(pageTargets.map((target) => target.id))

		for (const [id, page] of this.#pages) {
			if (targetIds.has(id)) continue
			await page.destroy()
			this.#pages.delete(id)
		}

		for (const target of pageTargets) {
			if (this.#closed || this.#pages.has(target.id)) continue

			try {
				const page = await this.#reattach(target.id, target.url, this.#viewport)
				if (this.#closed) {
					await page.destroy()
					continue
				}
				this.#pages.set(target.id, page)
				this.#emitter.emit('page', page)
			} catch {
				// A disappearing or unsupported target does not invalidate its siblings.
			}
		}
	}

	async #attach(
		targetId: string,
		url: string,
		viewport: BrowserViewport | undefined,
	): Promise<BrowserPage> {
		let sessionId: string | undefined
		let page: BrowserPage | undefined

		try {
			sessionId = await this.#openSession(targetId)
			await this.#enableSession(sessionId)
			const frameId = await this.#mainFrame(sessionId)
			page = new BrowserPage(
				this.#client,
				targetId,
				sessionId,
				this.#writer,
				url,
				frameId,
				this.#id,
			)
			await this.#configurePage(page)
			await this.#emulation.attach(page)
			if (viewport !== undefined) await this.#applyViewport(sessionId, viewport)
			this.#observe(page)

			return page
		} catch (error) {
			if (page !== undefined) await page.destroy().catch(() => undefined)
			else if (sessionId !== undefined) await this.#detachSession(sessionId)
			throw error
		}
	}

	async #reattach(
		targetId: string,
		url: string,
		viewport: BrowserViewport | undefined,
	): Promise<BrowserPage> {
		let sessionId: string | undefined
		let page: BrowserPage | undefined

		try {
			sessionId = await this.#openSession(targetId)
			await this.#enableSession(sessionId)
			const frameId = await this.#mainFrame(sessionId)
			page = new BrowserPage(
				this.#client,
				targetId,
				sessionId,
				this.#writer,
				url,
				frameId,
				this.#id,
			)
			await this.#configurePage(page)
			await this.#emulation.attach(page)
			if (viewport !== undefined) await this.#tryViewport(sessionId, viewport)
			this.#observe(page)

			return page
		} catch (error) {
			if (page !== undefined) await page.destroy().catch(() => undefined)
			else if (sessionId !== undefined) await this.#detachSession(sessionId)
			throw error
		}
	}

	async #destroyResources(): Promise<void> {
		try {
			await this.#settle()
			let failed = false
			let failure: unknown
			for (const page of this.#pages.values()) {
				try {
					await page.destroy()
				} catch (error) {
					if (!failed) {
						failed = true
						failure = error
					}
				}
			}
			this.#pages.clear()
			if (failed) throw failure
		} finally {
			this.#finish()
		}
	}

	async #closeResources(): Promise<void> {
		try {
			await this.#settle()
			let failed = false
			let failure: unknown
			for (const page of this.#pages.values()) {
				try {
					await page.close()
				} catch (error) {
					if (!failed) {
						failed = true
						failure = error
					}
				}
			}
			this.#pages.clear()

			if (this.#id !== undefined) {
				try {
					await this.#client.send('Target.disposeBrowserContext', {
						browserContextId: this.#id,
					})
				} catch (error) {
					if (!failed) {
						failed = true
						failure = error
					}
				}
			}
			if (failed) throw failure
		} finally {
			this.#finish()
		}
	}

	async #settle(): Promise<void> {
		await Promise.allSettled([...this.#creating])
		await this.#syncing?.catch(() => undefined)
	}

	async #openSession(targetId: string): Promise<string> {
		const result: unknown = await this.#client.send('Target.attachToTarget', {
			targetId,
			flatten: true,
		})
		if (!isRecord(result) || !isString(result['sessionId'])) {
			throw new BrowserError('Failed to attach to browser target')
		}
		return result['sessionId']
	}

	async #enableSession(sessionId: string): Promise<void> {
		await this.#client.send('Page.enable', undefined, sessionId)
		await this.#client.send('Runtime.enable', undefined, sessionId)
	}

	async #mainFrame(sessionId: string): Promise<string> {
		const result = await this.#client.send('Page.getFrameTree', undefined, sessionId)
		const frame = readBrowserFrames(result)[0]
		if (frame === undefined) throw new BrowserError('Failed to resolve the main browser frame')
		return frame.id
	}

	async #configurePage(page: BrowserPage): Promise<void> {
		await page.send('Target.setAutoAttach', {
			autoAttach: true,
			waitForDebuggerOnStart: false,
			flatten: true,
		})
		await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
		const download: Record<string, unknown> = {
			behavior:
				this.#downloads === undefined
					? 'default'
					: this.#downloads.named === true
						? 'allowAndName'
						: 'allow',
			eventsEnabled: true,
		}
		if (this.#id !== undefined) download['browserContextId'] = this.#id
		if (this.#downloads !== undefined) download['downloadPath'] = this.#downloads.path
		await this.#client.send('Browser.setDownloadBehavior', download)
		await page.network.start()
	}

	async #applyViewport(sessionId: string, viewport: BrowserViewport): Promise<void> {
		await this.#client.send(
			'Emulation.setDeviceMetricsOverride',
			{
				width: viewport.width,
				height: viewport.height,
				deviceScaleFactor: viewport.scale ?? 1,
				mobile: viewport.mobile ?? false,
				screenOrientation:
					viewport.landscape === undefined
						? undefined
						: {
								type: viewport.landscape ? 'landscapePrimary' : 'portraitPrimary',
								angle: viewport.landscape ? 90 : 0,
							},
			},
			sessionId,
		)
		await this.#client.send(
			'Emulation.setTouchEmulationEnabled',
			{ enabled: viewport.touch ?? false },
			sessionId,
		)
	}

	async #tryViewport(sessionId: string, viewport: BrowserViewport): Promise<void> {
		try {
			await this.#applyViewport(sessionId, viewport)
		} catch {
			// Reattached targets may not support viewport emulation.
		}
	}

	async #closeTarget(targetId: string): Promise<void> {
		try {
			await this.#client.send('Target.closeTarget', { targetId })
		} catch {
			// The target may already be gone.
		}
	}

	async #detachSession(sessionId: string): Promise<void> {
		try {
			await this.#client.send('Target.detachFromTarget', { sessionId })
		} catch {
			// The session may already be detached.
		}
	}

	#observe(page: BrowserPage): void {
		page.emitter.on('popup', (popup) => {
			if (this.#closed) {
				void popup.destroy().catch(() => undefined)
				return
			}
			if (instanceOf(BrowserPage)(popup)) {
				void this.#adoptPopup(popup)
				return
			}
			this.#emitter.emit('page', popup)
		})
		page.emitter.on('close', () => {
			if (this.#pages.get(page.target) === page) this.#pages.delete(page.target)
		})
	}

	async #adoptPopup(popup: BrowserPage): Promise<void> {
		try {
			await this.#emulation.attach(popup)
			if (this.#closed) {
				await popup.destroy()
				return
			}
			this.#pages.set(popup.target, popup)
			this.#observe(popup)
			this.#emitter.emit('page', popup)
		} catch {
			await popup.destroy().catch(() => undefined)
		}
	}

	#finish(): void {
		if (this.#emitter.destroyed) return
		this.#emitter.emit('close')
		this.#emitter.destroy()
	}
}
