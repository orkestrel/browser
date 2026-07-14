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
import { isRecord, isString } from '@orkestrel/contract'

// === BrowserContext

export class BrowserContext implements BrowserContextInterface {
	#client: CDPClientInterface
	#id: string | undefined
	#viewport: BrowserViewport | undefined
	#writer: ScreenshotWriterInterface | undefined
	#pages: Map<string, BrowserPage> = new Map()

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

	// === Property accessors

	get id(): string | undefined {
		return this.#id
	}

	// === Public API

	page(index?: number): BrowserPageInterface | undefined {
		const i = index ?? 0
		const values = [...this.#pages.values()]
		return i >= 0 && i < values.length ? values[i] : undefined
	}

	pages(): readonly BrowserPageInterface[] {
		return [...this.#pages.values()]
	}

	async create(options?: BrowserPageOptions): Promise<BrowserPageInterface> {
		// Build createTarget params — include browserContextId if we have a real CDP context
		const createParams: Record<string, unknown> = { url: 'about:blank' }
		if (this.#id !== undefined) {
			createParams['browserContextId'] = this.#id
		}

		const result: unknown = await this.#client.send('Target.createTarget', createParams)

		if (!isRecord(result) || !isString(result['targetId'])) {
			throw new Error('Failed to create new browser target')
		}

		const targetId = result['targetId']

		// Attach to the target to get a session
		const attachResult: unknown = await this.#client.send('Target.attachToTarget', {
			targetId,
			flatten: true,
		})

		if (!isRecord(attachResult) || !isString(attachResult['sessionId'])) {
			throw new Error('Failed to attach to browser target')
		}

		const sessionId = attachResult['sessionId']

		// Enable required CDP domains on the session
		await this.#client.send('Page.enable', undefined, sessionId)
		await this.#client.send('Runtime.enable', undefined, sessionId)

		// Apply viewport (from page options, context default, or neither)
		const viewport = options?.viewport ?? this.#viewport
		if (viewport !== undefined) {
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

		const page = new BrowserPage(this.#client, targetId, sessionId, this.#writer, options?.url)

		// Navigate if url was provided
		if (options?.url !== undefined && options.url !== 'about:blank') {
			await page.navigate(options.url, { timeout: options.timeout })
		}

		this.#pages.set(targetId, page)
		return page
	}

	async sync(targets: readonly CDPTarget[]): Promise<void> {
		const pageTargets = targets.filter((t) => t.type === 'page')
		const targetIds = new Set(pageTargets.map((t) => t.id))

		// Close and drop pages whose targets are no longer present
		for (const [id, page] of this.#pages) {
			if (targetIds.has(id)) continue
			try {
				await page.close()
			} catch {
				// Swallow errors during teardown of a removed target
			}
			this.#pages.delete(id)
		}

		// Attach only to targets we don't already have a page for
		for (const target of pageTargets) {
			if (this.#pages.has(target.id)) continue

			try {
				// Attach to existing target
				const attachResult: unknown = await this.#client.send('Target.attachToTarget', {
					targetId: target.id,
					flatten: true,
				})

				if (!isRecord(attachResult) || !isString(attachResult['sessionId'])) {
					continue
				}

				const sessionId = attachResult['sessionId']

				// Enable required CDP domains
				await this.#client.send('Page.enable', undefined, sessionId)
				await this.#client.send('Runtime.enable', undefined, sessionId)

				// Apply viewport if configured
				if (this.#viewport !== undefined) {
					try {
						await this.#client.send(
							'Emulation.setDeviceMetricsOverride',
							{
								width: this.#viewport.width,
								height: this.#viewport.height,
								deviceScaleFactor: 1,
								mobile: false,
							},
							sessionId,
						)
					} catch {
						// Non-fatal — viewport may not be supported on this target
					}
				}

				this.#pages.set(
					target.id,
					new BrowserPage(this.#client, target.id, sessionId, this.#writer, target.url),
				)
			} catch {
				// Skip targets we cannot attach to
			}
		}
	}

	async close(): Promise<void> {
		for (const page of this.#pages.values()) {
			try {
				await page.close()
			} catch {
				// Swallow errors during teardown
			}
		}
		this.#pages.clear()

		// Dispose real CDP browser context if we have one
		if (this.#id !== undefined) {
			try {
				await this.#client.send('Target.disposeBrowserContext', {
					browserContextId: this.#id,
				})
			} catch {
				// Context may already be disposed
			}
		}
	}
}
