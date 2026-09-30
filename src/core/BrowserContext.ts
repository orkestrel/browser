import type {
	BrowserContextEventMap,
	BrowserContextInterface,
	BrowserContextOptions,
	BrowserCookieManagerInterface,
	BrowserDownloadOptions,
	BrowserEmulationManagerInterface,
	BrowserEmulationOptions,
	BrowserPageEventMap,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserPermissionManagerInterface,
	BrowserStorageManagerInterface,
	BrowserViewport,
	CDPClientInterface,
	CDPTarget,
	BrowserWriterInterface,
} from './types.js'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import { BrowserCookieManager } from './BrowserCookieManager.js'
import { BrowserTransition } from './BrowserTransition.js'
import { BrowserEmulationManager } from './BrowserEmulationManager.js'
import { BrowserPage } from './BrowserPage.js'
import { BrowserPermissionManager } from './BrowserPermissionManager.js'
import { BrowserStorageManager } from './BrowserStorageManager.js'
import { BrowserError } from './errors.js'
import { BROWSER_REFERENCE_PREFIX } from './constants.js'
import { readBrowserFrames, settleBrowserTeardown, validateBrowserViewport } from './helpers.js'
import { instanceOf, isRecord, isString } from '@orkestrel/contract'
import { Emitter, extractKeys } from '@orkestrel/emitter'

// === BrowserContext

/**
 * Owns pages and shared state inside one Chromium browser context.
 *
 * @remarks
 * Every page a context constructs holds its target on the client's connection, so `sync` and a
 * popup that discovery reports for the same target yield one page, and the first such page on a
 * connection enables `Target.setDiscoverTargets` for it. The context adopts every popup its pages
 * publish into `pages()` after its opener, and emits `page` once per page; a popup that closed
 * before its adoption completed is not adopted.
 *
 * @example
 * ```ts
 * import { BrowserContext } from '@orkestrel/browser'
 *
 * const context = new BrowserContext(client)
 * const page = await context.create({ url: 'https://example.com' })
 * await context.destroy()
 * ```
 */
export class BrowserContext implements BrowserContextInterface {
	readonly #client: CDPClientInterface
	readonly #id: string | undefined
	readonly #viewport: BrowserViewport | undefined
	readonly #writer: BrowserWriterInterface | undefined
	readonly #downloads: BrowserDownloadOptions | undefined
	readonly #emitter: Emitter<BrowserContextEventMap>
	readonly #cookies: BrowserCookieManager
	readonly #permissions: BrowserPermissionManager
	readonly #storage: BrowserStorageManager
	readonly #emulation: BrowserEmulationManager
	readonly #pages: Map<string, BrowserPage> = new Map()
	readonly #creating: Set<Promise<BrowserPage>> = new Set()
	readonly #syncing: BrowserTransition = new BrowserTransition()
	// The attach by `create` or `sync` in flight for each target, which a popup adoption waits for.
	readonly #publishing: Map<string, Promise<void>> = new Map()
	readonly #observed: WeakSet<BrowserPage> = new WeakSet()
	#shutdown: Promise<void> | undefined
	#reference = 0

	constructor(
		client: CDPClientInterface,
		id?: string,
		viewport?: BrowserViewport,
		writer?: BrowserWriterInterface,
		emulation?: BrowserEmulationOptions,
		downloads?: BrowserDownloadOptions,
		options?: BrowserContextOptions,
	) {
		this.#client = client
		if (viewport !== undefined) validateBrowserViewport(viewport)
		this.#id = id
		this.#viewport = viewport
		this.#writer = writer
		this.#downloads = downloads
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
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
		if (this.#shutdown !== undefined)
			throw new BrowserError('Browser context is closed', 'BROWSER_CONTEXT_CLOSED')

		const attempt = this.#create(options)
		this.#creating.add(attempt)
		try {
			return await attempt
		} finally {
			this.#creating.delete(attempt)
		}
	}

	async sync(targets: readonly CDPTarget[]): Promise<void> {
		let active = this.#syncing.pending
		while (active !== undefined) {
			await active
			active = this.#syncing.pending
		}
		if (this.#shutdown !== undefined)
			throw new BrowserError('Browser context is closed', 'BROWSER_CONTEXT_CLOSED')

		await this.#syncing.execute(() => this.#sync(targets))
	}

	destroy(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active

		const shutdown = this.#destroyResources()
		this.#shutdown = shutdown
		return shutdown
	}

	close(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active

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
		const published = await this.#acquire(targetId)
		if (published === undefined) return await this.#join(targetId, options)

		try {
			const viewport = options?.viewport ?? this.#viewport
			page = await this.#attach(
				targetId,
				options?.url ?? 'about:blank',
				viewport,
				published.promise,
				options,
			)

			if (options?.url !== undefined && options.url !== 'about:blank') {
				await page.navigate(options.url, {
					...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
				})
			}
			if (this.#shutdown !== undefined) {
				throw new BrowserError(
					'Browser context closed during page creation',
					'BROWSER_CONTEXT_CLOSED',
				)
			}

			if (!this.#publish(page)) throw this.#refuse(targetId)
			published.resolve()
			return page
		} catch (error) {
			if (page !== undefined) {
				await page.close()
				throw error
			}
			// A target another path already holds stays open; the creation joins that path's page.
			if (instanceOf(BrowserError)(error) && error.code === 'BROWSER_TARGET_HELD') {
				this.#unreserve(targetId, published)
				const retry = await this.#acquire(targetId)
				if (retry === undefined) return await this.#join(targetId, options)
				this.#unreserve(targetId, retry)
				throw error
			}
			await this.#closeTarget(targetId)
			throw error
		} finally {
			this.#unreserve(targetId, published)
		}
	}

	async #sync(targets: readonly CDPTarget[]): Promise<void> {
		const pageTargets = targets.filter((target) => target.category === 'page')
		const targetIds = new Set(pageTargets.map((target) => target.id))

		for (const [id, page] of this.#pages) {
			if (targetIds.has(id)) continue
			await page.destroy()
			this.#pages.delete(id)
		}

		for (const target of pageTargets) {
			if (this.#shutdown !== undefined) continue
			const published = await this.#acquire(target.id)
			if (published === undefined) continue
			try {
				const page = await this.#reattach(target.id, target.url, this.#viewport, published.promise)
				if (this.#shutdown !== undefined) {
					await page.destroy()
					continue
				}
				// A page that closed before its publication settles the reservation as a failure.
				if (this.#publish(page)) published.resolve()
			} catch {
				// A disappearing or unsupported target, or one a popup attach already holds, does not
				// invalidate its siblings.
			} finally {
				this.#unreserve(target.id, published)
			}
		}
	}

	async #attach(
		targetId: string,
		url: string,
		viewport: BrowserViewport | undefined,
		ready: Promise<void>,
		options?: BrowserPageOptions,
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
				undefined,
				options,
				this.#nextReference.bind(this),
				ready,
			)
			this.#observe(page)
			await this.#configurePage(page)
			await this.#emulation.attach(page)
			if (viewport !== undefined) await this.#applyViewport(page, viewport)

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
		ready: Promise<void>,
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
				undefined,
				undefined,
				this.#nextReference.bind(this),
				ready,
			)
			this.#observe(page)
			await this.#configurePage(page)
			await this.#emulation.attach(page)
			if (viewport !== undefined) await this.#tryViewport(page, viewport)

			return page
		} catch (error) {
			if (page !== undefined) await page.destroy().catch(() => undefined)
			else if (sessionId !== undefined) await this.#detachSession(sessionId)
			throw error
		}
	}

	#nextReference(): string {
		return `${BROWSER_REFERENCE_PREFIX}${++this.#reference}`
	}

	async #destroyResources(): Promise<void> {
		try {
			await this.#settle()
			const failure = await settleBrowserTeardown(
				...[...this.#pages.values()].map((page) => () => page.destroy()),
			)
			this.#pages.clear()
			if (failure !== undefined) throw failure
		} finally {
			this.#finish()
		}
	}

	async #closeResources(): Promise<void> {
		try {
			await this.#settle()
			let failure = await settleBrowserTeardown(
				...[...this.#pages.values()].map((page) => () => page.close()),
			)
			this.#pages.clear()

			const id = this.#id
			if (id !== undefined) {
				const settled = await settleBrowserTeardown(() =>
					this.#client.send('Target.disposeBrowserContext', { browserContextId: id }),
				)
				failure ??= settled
			}
			if (failure !== undefined) throw failure
		} finally {
			this.#finish()
		}
	}

	async #settle(): Promise<void> {
		await Promise.allSettled([...this.#creating])
		await this.#syncing.pending?.catch(() => undefined)
	}

	// Acquires a target's reservation for `create` or `sync`: after every wait for the current
	// reservation to settle, the check for a held page and for a current reservation and the
	// installation of this one run as one synchronous step, so a waiter that resumes never installs
	// over a reservation another path installed while it waited. Undefined when the context holds
	// a page for the target.
	async #acquire(target: string): Promise<PromiseWithResolvers<void> | undefined> {
		for (
			let current = this.#publishing.get(target);
			current !== undefined;
			current = this.#publishing.get(target)
		)
			await Promise.allSettled([current])
		return this.#pages.has(target) ? undefined : this.#reserve(target)
	}

	// Joins a creation to the page another path published for its target, applying the creation's
	// hooks, viewport, and navigation to it; a page that closed first or meanwhile rejects.
	async #join(target: string, options?: BrowserPageOptions): Promise<BrowserPage> {
		const page = this.#pages.get(target)
		if (page === undefined || page.closed) throw this.#refuse(target)
		const hooks = options?.on
		if (hooks !== undefined)
			for (const event of extractKeys(hooks)) this.#hook(page, event, hooks, options?.error)
		try {
			if (options?.viewport !== undefined) await this.#applyViewport(page, options.viewport)
			// A joined page can have left the blank document the target was created at.
			if (options?.url !== undefined) {
				await page.navigate(options.url, {
					...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
				})
			}
		} catch (error) {
			if (page.closed) throw this.#refuse(target)
			throw error
		}
		if (page.closed || this.#pages.get(target) !== page) throw this.#refuse(target)
		return page
	}

	// Registers one creation hook on a joined page, reporting its throw to the creation's own
	// `error` handler, as the emitter a creation constructs would, and never to the page's.
	#hook<K extends keyof BrowserPageEventMap>(
		page: BrowserPage,
		event: K,
		hooks: EmitterHooks<BrowserPageEventMap>,
		report: EmitterErrorHandler | undefined,
	): void {
		const handler = hooks[event]
		if (handler === undefined) return
		page.emitter.on(event, (...args) => {
			try {
				handler(...args)
			} catch (error) {
				try {
					report?.(error, String(event))
				} catch {
					// A throwing reporter is swallowed, as the emitter swallows its own.
				}
			}
		})
	}

	#refuse(target: string): BrowserError {
		return new BrowserError('Browser page closed during creation', 'BROWSER_PAGE_CLOSED', {
			target,
		})
	}

	// Installs a target's reservation, which a popup adoption of a descendant waits for; the page it
	// passes as `ready` holds its target until the publication fails. `create` and `sync` install
	// one only through `#acquire`; an adoption replaces the current one and waits for it.
	#reserve(target: string): PromiseWithResolvers<void> {
		const published = Promise.withResolvers<void>()
		void published.promise.catch(() => undefined)
		this.#publishing.set(target, published.promise)
		return published
	}

	#unreserve(target: string, published: PromiseWithResolvers<void>): void {
		if (this.#publishing.get(target) === published.promise) this.#publishing.delete(target)
		published.reject(new BrowserError('Browser page was not published'))
	}

	// Publishes a live page once; true if the context holds it afterwards, false for a closed page.
	#publish(page: BrowserPage): boolean {
		if (page.closed) return false
		if (this.#pages.get(page.target) === page) return true
		this.#pages.set(page.target, page)
		this.#emitter.emit('page', page)
		return true
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
		await this.#client.send('Page.enable', undefined, { session: sessionId })
		await this.#client.send('Runtime.enable', undefined, { session: sessionId })
	}

	async #mainFrame(sessionId: string): Promise<string> {
		const result = await this.#client.send('Page.getFrameTree', undefined, { session: sessionId })
		const frame = readBrowserFrames(result)[0]
		if (frame === undefined) throw new BrowserError('Failed to resolve the main browser frame')
		return frame.id
	}

	async #configurePage(page: BrowserPage): Promise<void> {
		await page.send('Target.setAutoAttach', {
			autoAttach: true,
			waitForDebuggerOnStart: true,
			flatten: true,
		})
		await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
		await page.send('Page.setLifecycleEventsEnabled', { enabled: true })
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

	async #applyViewport(page: BrowserPage, viewport: BrowserViewport): Promise<void> {
		await page.send('Emulation.setDeviceMetricsOverride', {
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
		})
		await page.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch ?? false })
	}

	async #tryViewport(page: BrowserPage, viewport: BrowserViewport): Promise<void> {
		try {
			await this.#applyViewport(page, viewport)
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
		if (this.#observed.has(page)) return
		this.#observed.add(page)
		page.emitter.on('popup', (popup) => {
			if (this.#shutdown !== undefined) {
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

	// An adoption takes over its target's reservation for as long as it runs, after the `create` or
	// `sync` reservation it replaced settles; a popup that attach holds is published by it. Each
	// adoption waits for its opener's publication, so each `page` event follows its opener's.
	async #adoptPopup(popup: BrowserPage): Promise<void> {
		this.#observe(popup)
		const predecessor = this.#publishing.get(popup.target)
		const published = this.#reserve(popup.target)
		try {
			await Promise.allSettled([this.#publishing.get(popup.opener?.target ?? ''), predecessor])
			if (this.#pages.get(popup.target) === popup) return
			await this.#emulation.attach(popup)
			if (this.#shutdown !== undefined || popup.closed) {
				await popup.destroy()
				return
			}
			this.#publish(popup)
			published.resolve()
		} catch {
			await popup.destroy().catch(() => undefined)
		} finally {
			this.#unreserve(popup.target, published)
		}
	}

	#finish(): void {
		if (this.#emitter.destroyed) return
		this.#emitter.emit('close')
		this.#emitter.destroy()
	}
}
