import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserViewport,
	CDPClientInterface,
	CDPTarget,
	ScreenshotWriterInterface,
} from './types.js'
import { BrowserPage } from './BrowserPage.js'
import { BrowserError } from './errors.js'
import { isRecord, isString } from '@orkestrel/contract'

// === BrowserContext

export class BrowserContext implements BrowserContextInterface {
	readonly #client: CDPClientInterface
	readonly #id: string | undefined
	readonly #viewport: BrowserViewport | undefined
	readonly #writer: ScreenshotWriterInterface | undefined
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
	) {
		this.#client = client
		this.#id = id
		this.#viewport = viewport
		this.#writer = writer
	}

	get id(): string | undefined {
		return this.#id
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

		try {
			sessionId = await this.#openSession(targetId)
			await this.#enableSession(sessionId)
			if (viewport !== undefined) await this.#applyViewport(sessionId, viewport)

			return new BrowserPage(this.#client, targetId, sessionId, this.#writer, url)
		} catch (error) {
			if (sessionId !== undefined) await this.#detachSession(sessionId)
			throw error
		}
	}

	async #reattach(
		targetId: string,
		url: string,
		viewport: BrowserViewport | undefined,
	): Promise<BrowserPage> {
		let sessionId: string | undefined

		try {
			sessionId = await this.#openSession(targetId)
			await this.#enableSession(sessionId)
			if (viewport !== undefined) await this.#tryViewport(sessionId, viewport)

			return new BrowserPage(this.#client, targetId, sessionId, this.#writer, url)
		} catch (error) {
			if (sessionId !== undefined) await this.#detachSession(sessionId)
			throw error
		}
	}

	async #destroyResources(): Promise<void> {
		await this.#settle()
		for (const page of this.#pages.values()) {
			await page.destroy()
		}
		this.#pages.clear()
	}

	async #closeResources(): Promise<void> {
		await this.#settle()
		for (const page of this.#pages.values()) {
			await page.close()
		}
		this.#pages.clear()

		if (this.#id === undefined) return
		try {
			await this.#client.send('Target.disposeBrowserContext', {
				browserContextId: this.#id,
			})
		} catch {
			// The context may already be disposed.
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

	async #applyViewport(sessionId: string, viewport: BrowserViewport): Promise<void> {
		await this.#client.send(
			'Emulation.setDeviceMetricsOverride',
			{
				width: viewport.width,
				height: viewport.height,
				deviceScaleFactor: 1,
				mobile: false,
			},
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
}
