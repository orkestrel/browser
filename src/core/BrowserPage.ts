import type {
	BrowserCodegenInterface,
	BrowserCodegenOptions,
	BrowserClockInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInfo,
	BrowserFrameInterface,
	BrowserNavigationOptions,
	BrowserNavigationManagerInterface,
	BrowserNavigationResult,
	BrowserNavigationWatch,
	BrowserNetworkManagerInterface,
	BrowserPDFOptions,
	BrowserPDFResult,
	BrowserPageInterface,
	BrowserPageEventMap,
	BrowserResponse,
	BrowserScreenshotOptions,
	BrowserScreenshotResult,
	BrowserScriptManagerInterface,
	BrowserSnapshotInterface,
	BrowserSnapshotOptions,
	BrowserWaitUntil,
	BrowserWorkerCategory,
	BrowserAccessibilityInterface,
	CDPClientInterface,
	BrowserWriterInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BrowserCodegen } from './BrowserCodegen.js'
import { BrowserTransition } from './BrowserTransition.js'
import { BrowserAccessibility } from './BrowserAccessibility.js'
import { BrowserClock } from './BrowserClock.js'
import { BrowserDiagnostics } from './BrowserDiagnostics.js'
import { BrowserDialog } from './BrowserDialog.js'
import { BrowserDownload } from './BrowserDownload.js'
import { BrowserFrame } from './BrowserFrame.js'
import { BrowserFileChooser } from './BrowserFileChooser.js'
import { BrowserNetworkManager } from './BrowserNetworkManager.js'
import { BrowserNavigationManager } from './BrowserNavigationManager.js'
import { BrowserScriptManager } from './BrowserScriptManager.js'
import { BrowserSnapshot } from './BrowserSnapshot.js'
import { BrowserWorker } from './BrowserWorker.js'
import { BrowserError } from './errors.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_SNAPSHOT_NODE_LIMIT,
	BROWSER_STOP_LOADING_TIMEOUT_MS,
} from './constants.js'
import {
	compileScreenshotCleanupExpression,
	compileScreenshotPreparationExpression,
} from './compilers.js'
import {
	decodeBase64,
	readBrowserSnapshot,
	browserPDFToParams,
	browserScreenshotToParams,
	readBrowserFrames,
	requireBrowserString,
	validateBrowserTimeout,
} from './helpers.js'
import {
	parseBrowserConsoleMessage,
	parseBrowserDownloadProgress,
	parseBrowserDownloadStart,
	parseBrowserPageError,
} from './parsers.js'
import { isArray, isFiniteNumber, isInteger, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'

/**
 * Represents a top-level browser page, including its target lifecycle and child frames.
 *
 * @example
 * ```ts
 * import { BrowserPage } from '@orkestrel/browser'
 *
 * const page = new BrowserPage(client, 'target-1', 'session-1')
 * await page.navigate('https://example.com')
 * const shot = await page.screenshot({ format: 'png' })
 * await page.close()
 * ```
 */
export class BrowserPage extends BrowserFrame implements BrowserPageInterface {
	readonly #client: CDPClientInterface
	readonly #targetId: string
	readonly #sessionId: string
	readonly #writer: BrowserWriterInterface | undefined
	readonly #contextId: string | undefined
	readonly #opener: BrowserPageInterface | undefined
	readonly #emitter: Emitter<BrowserPageEventMap>
	readonly #network: BrowserNetworkManager
	readonly #navigationManager: BrowserNavigationManager
	readonly #scripts: BrowserScriptManager
	readonly #accessibility: BrowserAccessibility
	readonly #diagnostics: BrowserDiagnostics
	readonly #clock: BrowserClock
	readonly #frameSessions: Map<string, Promise<string>> = new Map()
	readonly #frameIds: Map<string, string> = new Map()
	readonly #downloads: Map<string, BrowserDownload> = new Map()
	readonly #workers: Map<string, BrowserWorker> = new Map()
	readonly #popups: Map<string, BrowserPage> = new Map()
	#closed = false
	#codegen: BrowserCodegen | undefined
	readonly #codegenStart: BrowserTransition<BrowserCodegen> = new BrowserTransition()
	#navigation: Promise<BrowserNavigationResult> | undefined
	#closing: Promise<void> | undefined
	#releasing: Promise<void> | undefined
	#loadEvents: readonly string[] = []
	#sameDocument = false
	#loadTimer: ReturnType<typeof setTimeout> | undefined
	#loadResolve: (() => void) | undefined
	#loadReject: ((error: unknown) => void) | undefined
	#responses: BrowserResponse[] | undefined
	readonly #navigationResponseHandler = this.#handleNavigationResponse.bind(this)
	readonly #destroyHandler = this.#handleDestroy.bind(this)
	readonly #loadHandler = this.#handleLoad.bind(this)
	readonly #frameAttachedHandler = this.#handleFrameAttached.bind(this)
	readonly #frameNavigatedHandler = this.#handleFrameNavigated.bind(this)
	readonly #frameDetachedHandler = this.#handleFrameDetached.bind(this)
	readonly #dialogHandler = this.#handleDialog.bind(this)
	readonly #chooserHandler = this.#handleChooser.bind(this)
	readonly #consoleHandler = this.#handleConsole.bind(this)
	readonly #errorHandler = this.#handleError.bind(this)
	readonly #crashHandler = this.#handleCrash.bind(this)
	readonly #downloadHandler = this.#handleDownload.bind(this)
	readonly #downloadProgressHandler = this.#handleDownloadProgress.bind(this)
	readonly #attachedHandler = this.#handleAttached.bind(this)
	readonly #detachedHandler = this.#handleDetached.bind(this)

	constructor(
		client: CDPClientInterface,
		targetId: string,
		sessionId: string,
		writer?: BrowserWriterInterface,
		url?: string,
		frameId?: string,
		contextId?: string,
		opener?: BrowserPageInterface,
	) {
		super(client, sessionId, frameId ?? targetId, url ?? 'about:blank', undefined, undefined, false)
		this.#client = client
		this.#targetId = targetId
		this.#sessionId = sessionId
		this.#writer = writer
		this.#contextId = contextId
		this.#opener = opener
		this.#emitter = new Emitter()
		this.#network = new BrowserNetworkManager(this, writer)
		this.#navigationManager = new BrowserNavigationManager(this)
		this.#scripts = new BrowserScriptManager(this)
		this.#accessibility = new BrowserAccessibility(this)
		this.#diagnostics = new BrowserDiagnostics(this, writer)
		this.#clock = new BrowserClock(this)
		this.#network.emitter.on('request', (request) => this.#emitter.emit('request', request))
		this.#network.emitter.on('response', (response) => this.#emitter.emit('response', response))
		this.#network.emitter.on('failure', (failure) => this.#emitter.emit('failure', failure))
		this.#network.emitter.on('socket', (socket) => this.#emitter.emit('socket', socket))

		this.#client.subscribe('Target.targetDestroyed', this.#destroyHandler)
		this.#client.subscribe('Target.attachedToTarget', this.#attachedHandler, this.#sessionId)
		this.#client.subscribe('Target.detachedFromTarget', this.#detachedHandler, this.#sessionId)
		this.#client.subscribe('Page.frameAttached', this.#frameAttachedHandler, this.#sessionId)
		this.#client.subscribe('Page.frameNavigated', this.#frameNavigatedHandler, this.#sessionId)
		this.#client.subscribe('Page.frameDetached', this.#frameDetachedHandler, this.#sessionId)
		this.#client.subscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.subscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.subscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.subscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.subscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
		this.#client.subscribe('Browser.downloadWillBegin', this.#downloadHandler)
		this.#client.subscribe('Browser.downloadProgress', this.#downloadProgressHandler)
	}

	get emitter(): EmitterInterface<BrowserPageEventMap> {
		return this.#emitter
	}

	get network(): BrowserNetworkManagerInterface {
		return this.#network
	}

	get navigation(): BrowserNavigationManagerInterface {
		return this.#navigationManager
	}

	get scripts(): BrowserScriptManagerInterface {
		return this.#scripts
	}

	get accessibility(): BrowserAccessibilityInterface {
		return this.#accessibility
	}

	get diagnostics(): BrowserDiagnosticsInterface {
		return this.#diagnostics
	}

	get clock(): BrowserClockInterface {
		return this.#clock
	}

	get opener(): BrowserPageInterface | undefined {
		return this.#opener
	}

	get target(): string {
		return this.#targetId
	}

	get closed(): boolean {
		return this.#closed
	}

	async navigate(
		url: string,
		options?: BrowserNavigationOptions,
	): Promise<BrowserNavigationResult> {
		this.assert()
		while (this.#navigation !== undefined) {
			await this.#navigation.catch(() => undefined)
		}
		this.assert()
		const navigation = this.#navigate(url, options)
		this.#navigation = navigation

		try {
			return await navigation
		} finally {
			if (this.#navigation === navigation) this.#navigation = undefined
		}
	}

	async reload(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult> {
		this.assert()
		while (this.#navigation !== undefined) {
			await this.#navigation.catch(() => undefined)
		}
		this.assert()
		const navigation = this.#reload(options)
		this.#navigation = navigation

		try {
			return await navigation
		} finally {
			if (this.#navigation === navigation) this.#navigation = undefined
		}
	}

	async back(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult> {
		return await this.#history(-1, options)
	}

	async forward(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult> {
		return await this.#history(1, options)
	}

	async screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
		this.assert()
		const params: Record<string, unknown> = { ...browserScreenshotToParams(options) }

		if (options?.full === true) {
			const metrics = await this.send('Page.getLayoutMetrics')
			const size =
				isRecord(metrics) && isRecord(metrics['cssContentSize'])
					? metrics['cssContentSize']
					: isRecord(metrics) && isRecord(metrics['contentSize'])
						? metrics['contentSize']
						: undefined
			const width = size?.['width']
			const height = size?.['height']
			if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) {
				throw new BrowserError('Browser full-page screenshot metrics are malformed')
			}
			params['clip'] = { x: 0, y: 0, width, height, scale: 1 }
			params['captureBeyondViewport'] = true
		}

		if (options?.scale !== undefined) {
			const ratio = options.scale === 'css' ? 1 : await this.evaluate('devicePixelRatio')
			if (!isFiniteNumber(ratio) || ratio <= 0) {
				throw new BrowserError('Browser screenshot device scale is malformed')
			}
			if (!isRecord(params['clip'])) {
				const metrics = await this.send('Page.getLayoutMetrics')
				const viewport =
					isRecord(metrics) && isRecord(metrics['cssVisualViewport'])
						? metrics['cssVisualViewport']
						: undefined
				if (
					viewport === undefined ||
					!isFiniteNumber(viewport['pageX']) ||
					!isFiniteNumber(viewport['pageY']) ||
					!isFiniteNumber(viewport['clientWidth']) ||
					viewport['clientWidth'] <= 0 ||
					!isFiniteNumber(viewport['clientHeight']) ||
					viewport['clientHeight'] <= 0
				) {
					throw new BrowserError('Browser screenshot viewport metrics are malformed')
				}
				params['clip'] = {
					x: viewport['pageX'],
					y: viewport['pageY'],
					width: viewport['clientWidth'],
					height: viewport['clientHeight'],
					scale: ratio,
				}
			} else {
				params['clip']['scale'] = ratio
			}
		}

		let token: string | undefined
		let transparent = false
		try {
			const preparation = compileScreenshotPreparationExpression(options)
			if (preparation !== undefined) {
				const value = await this.evaluate(preparation)
				if (!isString(value)) throw new BrowserError('Browser screenshot preparation failed')
				token = value
			}
			if (options?.transparent === true) {
				await this.send('Emulation.setDefaultBackgroundColorOverride', {
					color: { r: 0, g: 0, b: 0, a: 0 },
				})
				transparent = true
			}
			const result = await this.send('Page.captureScreenshot', params)
			if (!isRecord(result) || !isString(result['data'])) {
				throw new BrowserError('Screenshot failed: no data returned')
			}

			const bytes = decodeBase64(result['data'])
			if (options?.path !== undefined) await this.save(options.path, bytes)
			return { bytes, path: options?.path }
		} finally {
			if (transparent) {
				await this.send('Emulation.setDefaultBackgroundColorOverride').catch(() => undefined)
			}
			if (token !== undefined) {
				await this.evaluate(compileScreenshotCleanupExpression(token)).catch(() => undefined)
			}
		}
	}

	async pdf(options?: BrowserPDFOptions): Promise<BrowserPDFResult> {
		this.assert()
		const result = await this.send('Page.printToPDF', browserPDFToParams(options))
		if (!isRecord(result) || !isString(result['data'])) {
			throw new BrowserError('PDF failed: no data returned')
		}
		const bytes = decodeBase64(result['data'])
		if (options?.path !== undefined) await this.save(options.path, bytes)
		return { bytes, path: options?.path }
	}

	override async save(path: string, bytes: Uint8Array): Promise<void> {
		if (this.#writer === undefined) {
			throw new BrowserError('Browser page has no configured file writer', undefined, { path })
		}
		await this.#writer.write(path, bytes)
	}

	async frame(name: string): Promise<BrowserFrameInterface | undefined> {
		const frames = await this.frames()
		return frames.find((frame) => frame.name === name || frame.url === name)
	}

	async frames(): Promise<readonly BrowserFrameInterface[]> {
		this.assert()
		const result = await this.send('Page.getFrameTree')
		return readBrowserFrames(result).map((frame) => this.#frame(frame))
	}

	async snapshot(options?: BrowserSnapshotOptions): Promise<BrowserSnapshotInterface> {
		this.assert()
		const styles = options?.styles ?? []
		const result = await this.send('DOMSnapshot.captureSnapshot', {
			computedStyles: [...styles],
			includePaintOrder: options?.paint ?? false,
			includeDOMRects: options?.rects ?? false,
		})
		return new BrowserSnapshot(
			readBrowserSnapshot(result, styles, options?.limit ?? BROWSER_SNAPSHOT_NODE_LIMIT),
		)
	}

	async codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface> {
		this.assert()
		if (this.#codegen !== undefined) return this.#codegen
		const active = this.#codegenStart.pending
		if (active !== undefined) return await active

		return await this.#codegenStart.execute(() => this.#startCodegen(options))
	}

	destroy(): Promise<void> {
		const active = this.#closing
		if (active !== undefined) return active

		this.#closed = true
		const closing = this.#destroy()
		this.#closing = closing
		return closing
	}

	close(): Promise<void> {
		const active = this.#closing
		if (active !== undefined) return active

		if (this.#closed) {
			const closing = this.#release()
			this.#closing = closing
			return closing
		}

		this.#closed = true
		const closing = this.#close()
		this.#closing = closing
		return closing
	}

	override assert(): void {
		super.assert()
		if (this.#closed) throw new BrowserError('Browser page is closed')
	}

	async #navigate(
		url: string,
		options?: BrowserNavigationOptions,
	): Promise<BrowserNavigationResult> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const watch = this.#watchNavigation()
		const condition = options?.condition ?? 'load'
		const wait = this.#waitForLoadEvent(condition, timeout)
		void wait.catch(() => undefined)
		let loader: string | undefined

		try {
			const result = await this.send('Page.navigate', { url }, { timeout })
			if (isRecord(result) && isString(result['errorText'])) {
				throw new BrowserError(`Navigation failed: ${result['errorText']}`)
			}
			if (isRecord(result) && isString(result['loaderId'])) loader = result['loaderId']
			await wait
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}

		return await this.#completeNavigation(watch, loader)
	}

	async #reload(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const watch = this.#watchNavigation()
		const wait = this.#waitForLoadEvent(options?.condition ?? 'load', timeout)
		void wait.catch(() => undefined)

		try {
			await this.send('Page.reload', undefined, { timeout })
			await wait
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}

		return await this.#completeNavigation(watch)
	}

	async #history(
		offset: -1 | 1,
		options?: BrowserNavigationOptions,
	): Promise<BrowserNavigationResult> {
		this.assert()
		while (this.#navigation !== undefined) {
			await this.#navigation.catch(() => undefined)
		}
		this.assert()
		const navigation = this.#navigateHistory(offset, options)
		this.#navigation = navigation

		try {
			return await navigation
		} finally {
			if (this.#navigation === navigation) this.#navigation = undefined
		}
	}

	async #navigateHistory(
		offset: -1 | 1,
		options?: BrowserNavigationOptions,
	): Promise<BrowserNavigationResult> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const history = await this.send('Page.getNavigationHistory')
		if (!isRecord(history) || !isInteger(history['currentIndex']) || !isArray(history['entries'])) {
			throw new BrowserError('Navigation history is malformed')
		}
		const entry = history['entries'][history['currentIndex'] + offset]
		if (!isRecord(entry) || !isInteger(entry['id'])) {
			return { url: this.url, response: undefined, same: false }
		}

		const watch = this.#watchNavigation()
		const wait = this.#waitForLoadEvent(options?.condition ?? 'load', timeout)
		void wait.catch(() => undefined)
		try {
			await this.send('Page.navigateToHistoryEntry', { entryId: entry['id'] }, { timeout })
			await wait
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}

		return await this.#completeNavigation(watch)
	}

	#watchNavigation(): BrowserNavigationWatch {
		const responses: BrowserResponse[] = []
		this.#responses = responses
		this.#network.emitter.on('response', this.#navigationResponseHandler)
		return { responses }
	}

	#clearNavigationWatch(watch: BrowserNavigationWatch): void {
		this.#network.emitter.off('response', this.#navigationResponseHandler)
		if (this.#responses === watch.responses) this.#responses = undefined
	}

	#navigationResult(
		watch: BrowserNavigationWatch,
		url: string,
		loader?: string,
	): BrowserNavigationResult {
		this.#clearNavigationWatch(watch)
		const response =
			loader === undefined
				? watch.responses.findLast((candidate) => candidate.url === url)
				: watch.responses.findLast((candidate) => candidate.loader === loader)
		return {
			url,
			response,
			same: this.#sameDocument,
		}
	}

	async #completeNavigation(
		watch: BrowserNavigationWatch,
		loader?: string,
	): Promise<BrowserNavigationResult> {
		try {
			const currentUrl = await this.evaluate('location.href')
			const resolved = requireBrowserString(currentUrl, 'Navigation URL')
			this.update(resolved)
			return this.#navigationResult(watch, resolved, loader)
		} catch (error) {
			this.#clearNavigationWatch(watch)
			throw error
		}
	}

	async #startCodegen(options?: BrowserCodegenOptions): Promise<BrowserCodegen> {
		const codegen = new BrowserCodegen(this.#client, this.#sessionId, options)
		await codegen.start()
		if (this.#closed) {
			await codegen.destroy()
			throw new BrowserError('Browser page is closed')
		}
		this.#codegen = codegen
		return codegen
	}

	async #destroy(): Promise<void> {
		await this.#release()
		try {
			await this.#client.send('Target.detachFromTarget', { sessionId: this.#sessionId })
		} catch {
			// The session may already be detached.
		}
	}

	async #close(): Promise<void> {
		await this.#release()
		try {
			await this.#client.send('Target.closeTarget', { targetId: this.#targetId })
		} catch {
			// The target may already be closed.
		}
	}

	#release(): Promise<void> {
		const active = this.#releasing
		if (active !== undefined) return active
		const release = this.#releaseResources()
		this.#releasing = release
		return release
	}

	async #releaseResources(): Promise<void> {
		this.#cancelLoad()
		await this.#codegenStart.pending?.catch(() => undefined)
		await this.#scripts.destroy().catch(() => undefined)
		await this.#diagnostics.destroy().catch(() => undefined)
		await this.#clock.uninstall().catch(() => undefined)
		await this.#network.destroy().catch(() => undefined)

		if (this.#codegen !== undefined) {
			try {
				await this.#codegen.destroy()
			} catch {
				// The recorder's session may already be unavailable.
			}
			this.#codegen = undefined
		}

		this.#frameSessions.clear()
		this.#frameIds.clear()
		for (const worker of this.#workers.values()) worker.detach()
		this.#workers.clear()
		this.#popups.clear()
		this.#downloads.clear()
		this.#client.unsubscribe('Target.targetDestroyed', this.#destroyHandler)
		this.#client.unsubscribe('Target.attachedToTarget', this.#attachedHandler, this.#sessionId)
		this.#client.unsubscribe('Target.detachedFromTarget', this.#detachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.frameAttached', this.#frameAttachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.frameNavigated', this.#frameNavigatedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.frameDetached', this.#frameDetachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.unsubscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.unsubscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
		this.#client.unsubscribe('Browser.downloadWillBegin', this.#downloadHandler)
		this.#client.unsubscribe('Browser.downloadProgress', this.#downloadProgressHandler)
		if (!this.#emitter.destroyed) {
			this.#emitter.emit('close')
			this.#emitter.destroy()
		}
	}

	#frame(frame: BrowserFrameInfo): BrowserFrameInterface {
		return new BrowserFrame(
			this.#client,
			(id) => this.#resolveFrameSession(id),
			frame.id,
			frame.url,
			frame.parent,
			frame.name,
		)
	}

	async #resolveFrameSession(frame: string): Promise<string> {
		const session = this.#frameSessions.get(frame)
		return session === undefined ? this.#sessionId : await session
	}

	async #enableFrameSession(session: string): Promise<string> {
		await this.#client.send('Page.enable', undefined, { session })
		await this.#client.send('Runtime.enable', undefined, { session })
		return session
	}

	async #attachWorker(
		session: string,
		id: string,
		url: string,
		category: BrowserWorkerCategory,
	): Promise<void> {
		try {
			await this.#client.send('Runtime.enable', undefined, { session })
			if (this.#closed) {
				await this.#detachChild(session)
				return
			}
			const worker = new BrowserWorker(this.#client, session, id, url, category)
			this.#workers.set(id, worker)
			this.#emitter.emit('worker', worker)
		} catch {
			// A worker can terminate before its session is enabled.
			await this.#detachChild(session)
		}
	}

	async #attachPopup(session: string, id: string, url: string): Promise<void> {
		let popup: BrowserPage | undefined
		try {
			await this.#client.send('Page.enable', undefined, { session })
			await this.#client.send('Runtime.enable', undefined, { session })
			const result = await this.#client.send('Page.getFrameTree', undefined, { session })
			const frame = readBrowserFrames(result)[0]
			if (frame === undefined || this.#closed) {
				await this.#detachChild(session)
				return
			}
			popup = new BrowserPage(
				this.#client,
				id,
				session,
				this.#writer,
				url,
				frame.id,
				this.#contextId,
				this,
			)
			await popup.send('Target.setAutoAttach', {
				autoAttach: true,
				waitForDebuggerOnStart: false,
				flatten: true,
			})
			await popup.send('Page.setInterceptFileChooserDialog', { enabled: true })
			await popup.network.start()
			if (this.#closed) {
				await popup.destroy()
				return
			}
			this.#popups.set(id, popup)
			this.#emitter.emit('popup', popup)
		} catch {
			// A popup can close before its session initialization completes.
			if (popup !== undefined) await popup.destroy()
			else await this.#detachChild(session)
		}
	}

	async #detachChild(session: string): Promise<void> {
		await this.#client
			.send('Target.detachFromTarget', { sessionId: session })
			.catch(() => undefined)
	}

	async #stopLoading(timeout: number): Promise<void> {
		try {
			await this.send('Page.stopLoading', undefined, { timeout })
		} catch {
			// Best-effort only — the original navigation error wins.
		}
	}

	#handleNavigationResponse(response: BrowserResponse): void {
		if (response.frame === this.id) this.#responses?.push(response)
	}

	#handleDestroy(params: Readonly<Record<string, unknown>>): void {
		if (!isString(params['targetId']) || params['targetId'] !== this.#targetId) return
		this.#closed = true
		void this.#release().catch(() => undefined)
	}

	#handleLoad(params: Readonly<Record<string, unknown>>): void {
		if (this.#loadEvents.includes('Page.navigatedWithinDocument')) {
			const frame = params['frameId']
			if (isString(frame) && frame === this.id) {
				this.#sameDocument = true
				this.#resolveLoad()
				return
			}
		}
		if (this.#loadEvents.includes('Page.frameNavigated')) {
			const frame = params['frame']
			if (isRecord(frame) && frame['id'] === this.id) this.#resolveLoad()
			return
		}
		if (
			this.#loadEvents.includes('Page.loadEventFired') ||
			this.#loadEvents.includes('Page.domContentEventFired')
		) {
			this.#resolveLoad()
		}
	}

	#handleFrameAttached(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const parent = params['parentFrameId']
		if (!isString(frame)) return
		this.#emitter.emit(
			'attach',
			new BrowserFrame(
				this.#client,
				(id) => this.#resolveFrameSession(id),
				frame,
				'about:blank',
				isString(parent) ? parent : undefined,
			),
		)
	}

	#handleFrameNavigated(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frame']
		if (!isRecord(frame) || !isString(frame['id']) || !isString(frame['url'])) return
		if (frame['id'] === this.id) {
			this.update(frame['url'])
			this.#emitter.emit('navigate', frame['url'])
		}
	}

	#handleFrameDetached(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		if (!isString(frame)) return
		this.#frameSessions.delete(frame)
		this.#emitter.emit('detach', frame)
	}

	#handleDialog(params: Readonly<Record<string, unknown>>): void {
		const category = params['type']
		if (
			(category !== 'alert' &&
				category !== 'confirm' &&
				category !== 'prompt' &&
				category !== 'beforeunload') ||
			!isString(params['message'])
		) {
			return
		}
		this.#emitter.emit(
			'dialog',
			new BrowserDialog(
				this,
				category,
				params['message'],
				isString(params['defaultPrompt']) ? params['defaultPrompt'] : '',
			),
		)
	}

	#handleChooser(params: Readonly<Record<string, unknown>>): void {
		const backend = params['backendNodeId']
		const mode = params['mode']
		if (!isInteger(backend)) return
		this.#emitter.emit('chooser', new BrowserFileChooser(this, backend, mode === 'selectMultiple'))
	}

	#handleConsole(params: Readonly<Record<string, unknown>>): void {
		const message = parseBrowserConsoleMessage(params)
		if (message !== undefined) this.#emitter.emit('console', message)
	}

	#handleError(params: Readonly<Record<string, unknown>>): void {
		const error = parseBrowserPageError(params)
		if (error !== undefined) this.#emitter.emit('error', error)
	}

	#handleCrash(): void {
		this.#emitter.emit('crash')
	}

	#handleDownload(params: Readonly<Record<string, unknown>>): void {
		const start = parseBrowserDownloadStart(params)
		if (start === undefined || (start.frame !== this.id && !this.#frameSessions.has(start.frame))) {
			return
		}
		const download = new BrowserDownload(
			this.#client,
			start.id,
			start.url,
			start.name,
			this.#contextId,
		)
		this.#downloads.set(start.id, download)
		this.#emitter.emit('download', download)
	}

	#handleDownloadProgress(params: Readonly<Record<string, unknown>>): void {
		const decoded = parseBrowserDownloadProgress(params)
		if (decoded === undefined) return
		const [id, progress] = decoded
		const download = this.#downloads.get(id)
		if (download === undefined) return
		download.update(progress)
		if (progress.status !== 'pending') this.#downloads.delete(id)
	}

	#handleAttached(params: Readonly<Record<string, unknown>>): void {
		const target = params['targetInfo']
		const session = params['sessionId']
		if (!isRecord(target) || !isString(target['targetId']) || !isString(session)) {
			return
		}

		const category = target['type']
		if (category === 'worker' || category === 'service_worker' || category === 'shared_worker') {
			void this.#attachWorker(
				session,
				target['targetId'],
				isString(target['url']) ? target['url'] : '',
				category,
			)
			return
		}
		if (category === 'page') {
			void this.#attachPopup(
				session,
				target['targetId'],
				isString(target['url']) ? target['url'] : 'about:blank',
			)
			return
		}
		if (category !== 'iframe') return

		const frame = target['targetId']
		const attempt = this.#enableFrameSession(session)
		this.#frameSessions.set(frame, attempt)
		this.#frameIds.set(session, frame)
		void attempt.catch(() => {
			if (this.#frameSessions.get(frame) === attempt) this.#frameSessions.delete(frame)
			if (this.#frameIds.get(session) === frame) this.#frameIds.delete(session)
			void this.#detachChild(session)
		})
	}

	#handleDetached(params: Readonly<Record<string, unknown>>): void {
		const session = params['sessionId']
		const target = params['targetId']
		if (isString(target)) {
			const worker = this.#workers.get(target)
			if (worker !== undefined) {
				worker.detach()
				this.#workers.delete(target)
			}
			const popup = this.#popups.get(target)
			if (popup !== undefined) {
				this.#popups.delete(target)
				void popup.destroy().catch(() => undefined)
			}
		}
		const frame = isString(target)
			? target
			: isString(session)
				? this.#frameIds.get(session)
				: undefined
		if (frame !== undefined) this.#frameSessions.delete(frame)
		if (isString(session)) this.#frameIds.delete(session)
	}

	#waitForLoadEvent(condition: BrowserWaitUntil, timeout: number): Promise<void> {
		const eventName =
			condition === 'commit'
				? 'Page.frameNavigated'
				: condition === 'domcontentloaded'
					? 'Page.domContentEventFired'
					: 'Page.loadEventFired'
		const deferred = Promise.withResolvers<void>()
		this.#sameDocument = false
		this.#loadEvents = [eventName, 'Page.navigatedWithinDocument']
		this.#loadResolve = deferred.resolve
		this.#loadReject = deferred.reject
		this.#loadTimer = setTimeout(() => {
			this.#rejectLoad(new BrowserError(`Navigation timeout after ${timeout}ms`))
		}, timeout)
		for (const event of this.#loadEvents) {
			this.#client.subscribe(event, this.#loadHandler, this.#sessionId)
		}
		return deferred.promise
	}

	#resolveLoad(): void {
		const resolve = this.#loadResolve
		this.#clearLoad()
		resolve?.()
	}

	#rejectLoad(error: unknown): void {
		const reject = this.#loadReject
		this.#clearLoad()
		reject?.(error)
	}

	#cancelLoad(): void {
		this.#rejectLoad(new BrowserError('Navigation cancelled'))
	}

	#clearLoad(): void {
		if (this.#loadTimer !== undefined) clearTimeout(this.#loadTimer)
		for (const event of this.#loadEvents) {
			this.#client.unsubscribe(event, this.#loadHandler, this.#sessionId)
		}
		this.#loadEvents = []
		this.#loadTimer = undefined
		this.#loadResolve = undefined
		this.#loadReject = undefined
	}
}
