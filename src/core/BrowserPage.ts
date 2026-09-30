import type {
	BrowserElementManagerInterface,
	BrowserPageElementInterface,
	BrowserReadinessWait,
	BrowserReferenceFunction,
	BrowserCallOptions,
	BrowserCodegenInterface,
	BrowserCodegenOptions,
	BrowserClockInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInfo,
	BrowserFrameInterface,
	BrowserKeyboardInterface,
	BrowserMouseInterface,
	BrowserNavigationOptions,
	BrowserNavigationManagerInterface,
	BrowserNavigationResult,
	BrowserNavigationWatch,
	BrowserNetworkManagerInterface,
	BrowserPDFOptions,
	BrowserPDFResult,
	BrowserPageInterface,
	BrowserPageEventMap,
	BrowserPageOptions,
	BrowserReadingInterface,
	BrowserRect,
	BrowserRegistryInterface,
	BrowserResponse,
	BrowserScreenshotOptions,
	BrowserScreenshotResult,
	BrowserScriptManagerInterface,
	BrowserSnapshotInterface,
	BrowserSnapshotOptions,
	BrowserTouchInterface,
	BrowserWaitUntil,
	BrowserWorkerCategory,
	BrowserAccessibilityInterface,
	CDPClientInterface,
	CDPHandler,
	BrowserWriterInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BrowserCodegen } from './BrowserCodegen.js'
import { BrowserElementManager } from './elements/BrowserElementManager.js'
import { BrowserRegistry } from './BrowserRegistry.js'
import { BrowserTransition } from './BrowserTransition.js'
import { BrowserAccessibility } from './BrowserAccessibility.js'
import { BrowserClock } from './BrowserClock.js'
import { BrowserDiagnostics } from './BrowserDiagnostics.js'
import { BrowserDialog } from './BrowserDialog.js'
import { BrowserDownload } from './BrowserDownload.js'
import { BrowserFrame } from './BrowserFrame.js'
import { BrowserFileChooser } from './BrowserFileChooser.js'
import { BrowserKeyboard } from './BrowserKeyboard.js'
import { BrowserMouse } from './BrowserMouse.js'
import { BrowserTouch } from './BrowserTouch.js'
import { BrowserNetworkManager } from './BrowserNetworkManager.js'
import { BrowserNavigationManager } from './BrowserNavigationManager.js'
import { BrowserScriptManager } from './BrowserScriptManager.js'
import { BrowserSnapshot } from './BrowserSnapshot.js'
import { BrowserWorker } from './BrowserWorker.js'
import { BrowserError } from './errors.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_REFERENCE_PREFIX,
	BROWSER_FRAME_WORLD_NAME,
	BROWSER_SNAPSHOT_NODE_LIMIT,
	BROWSER_STOP_LOADING_TIMEOUT_MS,
} from './constants.js'
import {
	compileTextWaitExpression,
	compileScreenshotCleanupExpression,
	compileScreenshotPreparationExpression,
} from './compilers.js'
import {
	decodeBase64,
	readBrowserSnapshot,
	browserPDFToParams,
	browserScreenshotToParams,
	readBrowserFrames,
	readBrowserWorld,
	readEvaluationResult,
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
 * @remarks
 * Only a page constructed with a `reference` function, as `BrowserContext` constructs every page,
 * takes part in target ownership and discovery. Such a page holds its target on the client's
 * current connection until it closes, its connection ends, or the `ready` promise its constructing
 * path passes rejects: constructing a second such page for a target a live page holds throws
 * `BROWSER_TARGET_HELD`, and the first such page on a connection enables
 * `Target.setDiscoverTargets` for it. A page constructed without `ready`, with or without an
 * `opener`, is complete as constructed; `ready` is the constructing path's completion, and a
 * popup a page constructs is complete when that page emits it.
 *
 * A page publishes each page it opens through `popup` once, never a closed one, and only after it
 * is complete itself. An unattached page target that discovery reports with this page as
 * `openerId`, live or before this page existed, is attached on the browser session, so the popup
 * outlives its opener; an attachment on this page's session is taken as it arrives; a target
 * another page holds is published as that page after its `ready` resolves, while it still holds
 * the target; and the second session for one target is detached. A page detaches its own session
 * through the session it was attached through.
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
	// Per client, the pages that hold a target on its current connection and the discovery reports
	// whose opener no held page is yet; the end of a connection and a new one clear both.
	static readonly #held: WeakMap<CDPClientInterface, Map<string, BrowserPage>> = new WeakMap()
	static readonly #reports: WeakMap<
		CDPClientInterface,
		Map<string, Readonly<Record<string, unknown>>>
	> = new WeakMap()
	static readonly #discovered: WeakSet<CDPClientInterface> = new WeakSet()
	readonly #client: CDPClientInterface
	readonly #targetId: string
	readonly #sessionId: string
	readonly #writer: BrowserWriterInterface | undefined
	readonly #contextId: string | undefined
	#opener: BrowserPageInterface | undefined
	// The session this page's session was attached through; undefined for the browser session.
	#owner: string | undefined
	// Settles when the path that constructed this page completes it, or rejects when that path fails:
	// for a context page, when the context publishes it; for a popup, when its setup finishes; for a
	// page constructed without `ready`, at once.
	readonly #setup: Promise<void>
	// Resolves when this page is published, which a popup this page publishes and a discovery report
	// waiting for this page wait for; rejects when the page releases.
	readonly #announcement = Promise.withResolvers<void>()
	readonly #emitter: Emitter<BrowserPageEventMap>
	readonly #elements: BrowserElementManager
	readonly #keyboard: BrowserKeyboard
	readonly #mouse: BrowserMouse
	readonly #touch: BrowserTouch
	readonly #reference: BrowserReferenceFunction
	readonly #readiness = new Map<symbol, BrowserReadinessWait>()
	#referenceSequence = 0
	#waitSequence = 0
	#dom: string | undefined
	#seed: Promise<void> | undefined
	readonly #lifecycleHandler = this.#handleLifecycle.bind(this)
	readonly #network: BrowserNetworkManager
	readonly #navigationManager: BrowserNavigationManager
	readonly #scripts: BrowserScriptManager
	readonly #accessibility: BrowserAccessibility
	readonly #diagnostics: BrowserDiagnostics
	readonly #clock: BrowserClock
	// Each frame has one owning session, whose attempt settles to that session once its domains enable.
	readonly #frameSessions: Map<
		string,
		{ readonly session: string; readonly attempt: Promise<string> }
	> = new Map()
	readonly #frameIds: Map<string, string> = new Map()
	readonly #iframes: Map<string, BrowserFrameInfo> = new Map()
	readonly #downloads: Map<string, BrowserDownload> = new Map()
	readonly #workers: Map<string, BrowserWorker> = new Map()
	readonly #popups: Map<string, BrowserPage> = new Map()
	// A popup target an attach is initializing, so the attach that arrives second, through discovery
	// or through an attachment event, initializes nothing.
	readonly #claimed: Set<string> = new Set()
	// A frame with no entry has not changed since the last page-frame document change, whose
	// epoch `#floor` holds, so the map holds only the frames of the current document.
	readonly #epochs: Map<string, number> = new Map()
	readonly #worlds: Map<string, { readonly session: string; readonly context: number }> = new Map()
	// A pending creation records its session so a context-cleared event on that session can
	// invalidate it before it publishes.
	readonly #creating: Map<string, { readonly session: string; readonly promise: Promise<number> }> =
		new Map()
	readonly #sessionHandlers: Map<
		string,
		{
			readonly destroyed: CDPHandler
			readonly cleared: CDPHandler
			readonly navigated: CDPHandler
			readonly routed: CDPHandler
		}
	> = new Map()
	// The frame of each attach whose domain enable has not settled, keyed by its frame session, so a
	// navigation the frame session reports before publication reaches the published record.
	readonly #attaching: Map<string, BrowserFrameInfo> = new Map()
	#epoch = 0
	#floor = 0
	#closed = false
	#codegen: BrowserCodegen | undefined
	#registry: BrowserRegistry | undefined
	readonly #codegenStart: BrowserTransition<BrowserCodegen> = new BrowserTransition()
	#navigation: Promise<BrowserNavigationResult> | undefined
	#closing: Promise<void> | undefined
	#releasing: Promise<void> | undefined
	#loadEvents: readonly string[] = []
	#sameDocument = false
	#loader: string | undefined
	#loadTimer: ReturnType<typeof setTimeout> | undefined
	#loadResolve: (() => void) | undefined
	#loadReject: ((error: unknown) => void) | undefined
	#loadAbort: { readonly signal: AbortSignal; readonly listener: () => void } | undefined
	#responses: BrowserResponse[] | undefined
	readonly #navigationResponseHandler = this.#handleNavigationResponse.bind(this)
	readonly #destroyHandler = this.#handleDestroy.bind(this)
	readonly #loadHandler = this.#handleLoad.bind(this)
	readonly #restoreHandler = this.#handleRestore.bind(this)
	readonly #frameAttachedHandler = this.#handleFrameAttached.bind(this)
	readonly #frameNavigatedHandler = this.#handleFrameNavigated.bind(this)
	readonly #sameDocumentHandler = this.#handleSameDocument.bind(this)
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
		options?: BrowserPageOptions,
		reference?: BrowserReferenceFunction,
		ready?: Promise<void>,
	) {
		super(
			client,
			sessionId,
			frameId ?? targetId,
			url ?? 'about:blank',
			undefined,
			undefined,
			false,
			() => this.#epochOf(this.id),
			(session, call) => this.#world(this.id, session, call),
		)
		const held = reference === undefined ? undefined : BrowserPage.#track(client)
		const holder = held?.get(targetId)
		if (holder !== undefined && !holder.#closed)
			throw new BrowserError('Browser target already has a page', 'BROWSER_TARGET_HELD', {
				target: targetId,
			})
		this.#client = client
		this.#targetId = targetId
		this.#sessionId = sessionId
		this.#writer = writer
		this.#contextId = contextId
		this.#opener = opener
		this.#setup = ready ?? Promise.resolve()
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
		this.#reference = reference ?? this.#nextReference.bind(this)
		this.#elements = new BrowserElementManager({
			navigation: this.#epochOf.bind(this),
			page: this,
			client,
			session: sessionId,
			resolve: this.#resolveFrameSession.bind(this),
			world: this.#world.bind(this),
			reference: this.#reference,
			ready: this.#ready.bind(this),
		})
		this.#keyboard = new BrowserKeyboard(this)
		this.#mouse = new BrowserMouse(this)
		this.#touch = new BrowserTouch(this)
		this.#client.subscribe('Page.lifecycleEvent', this.#lifecycleHandler, sessionId)
		this.#network = new BrowserNetworkManager(this, writer)
		this.#navigationManager = new BrowserNavigationManager(
			this,
			client,
			sessionId,
			() => this.#loader,
		)
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
		this.#client.subscribe(
			'Page.navigatedWithinDocument',
			this.#sameDocumentHandler,
			this.#sessionId,
		)
		this.#client.subscribe('Page.frameDetached', this.#frameDetachedHandler, this.#sessionId)
		this.#client.subscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.subscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.subscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.subscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.subscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
		const handlers = this.#resolveSessionHandlers(this.#sessionId)
		this.#client.subscribe('Runtime.executionContextDestroyed', handlers.destroyed, this.#sessionId)
		this.#client.subscribe('Runtime.executionContextsCleared', handlers.cleared, this.#sessionId)
		this.#client.subscribe('Browser.downloadWillBegin', this.#downloadHandler)
		this.#client.subscribe('Browser.downloadProgress', this.#downloadProgressHandler)
		void this.#announcement.promise.catch(() => undefined)
		void this.#setup.then(
			() => {
				if (ready === undefined || opener === undefined) this.#announcement.resolve()
			},
			() => this.#unhold(),
		)
		if (held === undefined) return
		held.set(targetId, this)
		if (!BrowserPage.#discovered.has(client)) {
			BrowserPage.#discovered.add(client)
			void client
				.send('Target.setDiscoverTargets', { discover: true })
				.catch(() => BrowserPage.#discovered.delete(client))
		}
		void this.#announcement.promise.then(
			() => this.#drain(),
			() => undefined,
		)
	}

	get emitter(): EmitterInterface<BrowserPageEventMap> {
		return this.#emitter
	}

	get elements(): BrowserElementManagerInterface<BrowserPageElementInterface> {
		return this.#elements
	}

	get trusted(): true {
		return true
	}

	get keyboard(): BrowserKeyboardInterface {
		return this.#keyboard
	}

	get mouse(): BrowserMouseInterface {
		return this.#mouse
	}

	get touch(): BrowserTouchInterface {
		return this.#touch
	}

	// The page's reading waits for the current document's DOMContentLoaded, as the outline does,
	// so a read issued while a navigation loads captures the loaded document.
	override async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		await this.#ready(options)
		return await super.read(options)
	}

	async wait(text: string, options?: BrowserCallOptions): Promise<void> {
		this.assert()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const end = performance.now() + timeout
		while (true) {
			options?.signal?.throwIfAborted()
			const remaining = Math.max(0, end - performance.now())
			await this.#ready({ ...options, timeout: remaining })
			const context = await this.#world(this.id, this.#sessionId, options)
			const key = `__browserTextWait${++this.#waitSequence}`
			try {
				const result = await this.send(
					'Runtime.evaluate',
					{
						expression: compileTextWaitExpression(text, remaining, key),
						contextId: context,
						returnByValue: true,
						awaitPromise: true,
					},
					{ ...options, timeout: remaining + 1000 },
				)
				if (readEvaluationResult(result) !== true)
					throw new BrowserError('Browser text wait timed out', 'BROWSER_WAIT_TIMEOUT', {
						text,
						timeout,
					})
				return
			} catch (error) {
				if (options?.signal?.aborted === true) {
					await this.send(
						'Runtime.evaluate',
						{
							expression: `globalThis[${JSON.stringify(key)}]?.()`,
							contextId: context,
							returnByValue: true,
						},
						{ timeout: 1000 },
					).catch(() => undefined)
					throw options.signal.reason
				}
				if (
					!(error instanceof Error) ||
					!/execution context was destroyed|cannot find context with specified id/i.test(
						error.message,
					)
				)
					throw error
				this.#dom = undefined
				if (performance.now() >= end)
					throw new BrowserError('Browser text wait timed out', 'BROWSER_WAIT_TIMEOUT', {
						text,
						timeout,
					})
				await this.#parkReadiness({ ...options, timeout: Math.max(0, end - performance.now()) })
			}
		}
	}

	get network(): BrowserNetworkManagerInterface {
		return this.#network
	}

	get registry(): BrowserRegistryInterface {
		this.assert()
		this.#registry ??= new BrowserRegistry(this, this.#client, this.#sessionId, this.#frameIds)
		return this.#registry
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
			const masks: BrowserRect[] = []
			for (const element of options?.mask ?? []) {
				const { points } = await element.quad()
				const xs = points.filter((_value, index) => index % 2 === 0)
				const ys = points.filter((_value, index) => index % 2 !== 0)
				const left = Math.min(...xs)
				const top = Math.min(...ys)
				masks.push([left, top, Math.max(...xs) - left, Math.max(...ys) - top])
			}
			const preparation = compileScreenshotPreparationExpression(options, masks)
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
		return readBrowserFrames(result, [...this.#iframes.values()]).map((frame) => this.#frame(frame))
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
		const wait = this.#waitForLoadEvent(condition, timeout, options?.signal)
		void wait.catch(() => undefined)
		let loader: string | undefined

		try {
			const result = await this.send(
				'Page.navigate',
				{ url },
				{ timeout, ...(options?.signal !== undefined ? { signal: options.signal } : {}) },
			)
			if (isRecord(result) && isString(result['errorText'])) {
				throw new BrowserError(`Navigation failed: ${result['errorText']}`)
			}
			if (isRecord(result) && isString(result['loaderId'])) {
				loader = result['loaderId']
				this.#loader = loader
			}
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
		const wait = this.#waitForLoadEvent(options?.condition ?? 'load', timeout, options?.signal)
		void wait.catch(() => undefined)

		try {
			await this.send('Page.reload', undefined, {
				timeout,
				...(options?.signal === undefined ? {} : { signal: options.signal }),
			})
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
		options?.signal?.throwIfAborted()
		while (this.#navigation !== undefined) {
			await this.#navigation.catch(() => undefined)
		}
		this.assert()
		options?.signal?.throwIfAborted()
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
		const signal = options?.signal
		const call = { timeout, ...(signal === undefined ? {} : { signal }) }
		const history = await this.send('Page.getNavigationHistory', undefined, call)
		signal?.throwIfAborted()
		if (!isRecord(history) || !isInteger(history['currentIndex']) || !isArray(history['entries'])) {
			throw new BrowserError('Navigation history is malformed')
		}
		const entry = history['entries'][history['currentIndex'] + offset]
		if (!isRecord(entry) || !isInteger(entry['id'])) {
			return { url: this.url, response: undefined, same: false }
		}

		const watch = this.#watchNavigation()
		const condition = options?.condition ?? 'load'
		const wait = this.#waitForLoadEvent(condition, timeout, signal)
		void wait.catch(() => undefined)
		// A back-forward cache restore commits a document that already loaded, so Chromium fires no
		// load or DOMContentLoaded event for it and the restore itself settles those two conditions.
		const restorable = condition === 'load' || condition === 'domcontentloaded'
		if (restorable)
			this.#client.subscribe('Page.frameNavigated', this.#restoreHandler, this.#sessionId)
		// A restore or load that settles the wait in the same tick as an abort leaves the signal as the
		// only witness, so cancellation is checked after the wait and after the completion read.
		try {
			await this.send('Page.navigateToHistoryEntry', { entryId: entry['id'] }, call)
			await wait
			signal?.throwIfAborted()
			const result = await this.#completeNavigation(watch, undefined, call)
			signal?.throwIfAborted()
			return result
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		} finally {
			if (restorable)
				this.#client.unsubscribe('Page.frameNavigated', this.#restoreHandler, this.#sessionId)
		}
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
		options?: BrowserCallOptions,
	): Promise<BrowserNavigationResult> {
		try {
			const currentUrl = await this.evaluate('location.href', options)
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
			await this.#client.send(
				'Target.detachFromTarget',
				{ sessionId: this.#sessionId },
				this.#owner === undefined ? undefined : { session: this.#owner },
			)
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
		this.#unhold()
		this.#announcement.reject(new BrowserError('Browser session ended'))
		this.#client.unsubscribe('Page.lifecycleEvent', this.#lifecycleHandler, this.#sessionId)
		for (const id of this.#readiness.keys())
			this.#settleReadiness(id)?.reject(new BrowserError('Browser session ended'))
		this.#cancelLoad()
		await this.#registry?.destroy().catch(() => undefined)
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

		this.#advancePage()
		for (const session of this.#frameIds.keys()) this.#unwatchSession(session)
		this.#frameSessions.clear()
		this.#frameIds.clear()
		this.#attaching.clear()
		this.#iframes.clear()
		for (const worker of this.#workers.values()) worker.detach()
		this.#workers.clear()
		this.#popups.clear()
		this.#claimed.clear()
		this.#downloads.clear()
		this.#client.unsubscribe('Target.targetDestroyed', this.#destroyHandler)
		this.#client.unsubscribe('Target.attachedToTarget', this.#attachedHandler, this.#sessionId)
		this.#client.unsubscribe('Target.detachedFromTarget', this.#detachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.frameAttached', this.#frameAttachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.frameNavigated', this.#frameNavigatedHandler, this.#sessionId)
		this.#client.unsubscribe(
			'Page.navigatedWithinDocument',
			this.#sameDocumentHandler,
			this.#sessionId,
		)
		this.#client.unsubscribe('Page.frameDetached', this.#frameDetachedHandler, this.#sessionId)
		this.#client.unsubscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.unsubscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.unsubscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
		const handlers = this.#resolveSessionHandlers(this.#sessionId)
		this.#client.unsubscribe(
			'Runtime.executionContextDestroyed',
			handlers.destroyed,
			this.#sessionId,
		)
		this.#client.unsubscribe('Runtime.executionContextsCleared', handlers.cleared, this.#sessionId)
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
			true,
			() => this.#epochOf(frame.id),
			(session, call) => this.#world(frame.id, session, call),
		)
	}

	#epochOf(frame: string): number {
		return this.#epochs.get(frame) ?? this.#floor
	}

	#advanceFrame(frame: string): void {
		this.#epoch += 1
		this.#epochs.set(frame, this.#epoch)
	}

	// A page-frame document change replaces every frame document, so it advances them together.
	#advancePage(): void {
		this.#dom = undefined
		this.#seed = undefined
		this.#epoch += 1
		this.#floor = this.#epoch
		this.#epochs.clear()
		this.#worlds.clear()
		this.#creating.clear()
	}

	#nextReference(): string {
		return `${BROWSER_REFERENCE_PREFIX}${++this.#referenceSequence}`
	}

	async #ready(options?: BrowserCallOptions): Promise<void> {
		this.assert()
		options?.signal?.throwIfAborted()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const end = performance.now() + timeout
		if (this.#loader === undefined && this.#seed === undefined) {
			const seed = this.#seedReadiness({ timeout: BROWSER_DEFAULT_TIMEOUT_MS })
			this.#seed = seed
			void seed.catch(this.#rejectSeed.bind(this, seed))
		}
		if (this.#seed !== undefined) await this.#parkReadiness(options, this.#seed)
		if (this.#dom !== undefined && this.#dom === (this.#loader ?? 'initial')) return
		await this.#parkReadiness({ ...options, timeout: Math.max(0, end - performance.now()) })
	}

	#rejectSeed(seed: Promise<void>): void {
		if (this.#seed === seed) this.#seed = undefined
	}

	// The seed answers for the document it was issued against: `#floor` changes only when the
	// page frame's document changes, so a same-document navigation during the seed keeps its
	// answer.
	async #seedReadiness(options?: BrowserCallOptions): Promise<void> {
		const document = this.#floor
		const context = await this.#world(this.id, this.#sessionId, options)
		const result = await this.send(
			'Runtime.evaluate',
			{ expression: 'document.readyState', contextId: context, returnByValue: true },
			options,
		)
		const state = readEvaluationResult(result)
		if (document === this.#floor && (state === 'interactive' || state === 'complete'))
			this.#dom = this.#loader ?? 'initial'
	}

	#parkReadiness(options?: BrowserCallOptions, seed?: Promise<void>): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		options?.signal?.throwIfAborted()
		const deferred = Promise.withResolvers<void>()
		const id = Symbol('readiness')
		const timer = setTimeout(
			() =>
				this.#settleReadiness(id)?.reject(
					new BrowserError('Browser DOM readiness timed out', 'BROWSER_WAIT_TIMEOUT'),
				),
			timeout,
		)
		const signal = options?.signal
		const listener = signal === undefined ? undefined : this.#abortReadiness.bind(this, id, signal)
		this.#readiness.set(id, {
			resolve: deferred.resolve,
			reject: deferred.reject,
			timer,
			signal,
			listener,
		})
		if (listener !== undefined) signal?.addEventListener('abort', listener, { once: true })
		if (seed !== undefined)
			void seed.then(
				() => this.#settleReadiness(id)?.resolve(),
				(error: unknown) => this.#settleReadiness(id)?.reject(error),
			)
		return deferred.promise
	}

	#abortReadiness(id: symbol, signal: AbortSignal): void {
		this.#settleReadiness(id)?.reject(signal.reason)
	}

	#settleReadiness(id: symbol): BrowserReadinessWait | undefined {
		const wait = this.#readiness.get(id)
		if (wait === undefined) return undefined
		clearTimeout(wait.timer)
		if (wait.listener !== undefined) wait.signal?.removeEventListener('abort', wait.listener)
		this.#readiness.delete(id)
		return wait
	}

	#handleLifecycle(params: Readonly<Record<string, unknown>>): void {
		if (
			params['frameId'] !== this.id ||
			params['name'] !== 'DOMContentLoaded' ||
			!isString(params['loaderId'])
		)
			return
		if (this.#loader !== undefined && params['loaderId'] !== this.#loader) return
		this.#dom = this.#loader ?? 'initial'
		for (const id of this.#readiness.keys()) this.#settleReadiness(id)?.resolve()
	}

	#world(frame: string, session: string, options?: BrowserCallOptions): Promise<number> {
		const cached = this.#worlds.get(frame)
		if (cached !== undefined) return Promise.resolve(cached.context)
		const existing = this.#creating.get(frame)
		if (existing !== undefined) return existing.promise
		const pending: Promise<number> = this.#client
			.send(
				'Page.createIsolatedWorld',
				{ frameId: frame, worldName: BROWSER_FRAME_WORLD_NAME },
				{ session, ...options },
			)
			.then(this.#decodeWorld.bind(this, frame))
		this.#creating.set(frame, { session, promise: pending })
		void pending.then(
			this.#publishWorld.bind(this, frame, session, pending),
			this.#settleWorld.bind(this, frame, pending),
		)
		return pending
	}

	#decodeWorld(frame: string, world: unknown): number {
		return readBrowserWorld(world, frame)
	}

	// Publication requires the creation to be the frame's current one, so an invalidation that
	// landed while the request was in flight discards its context.
	#publishWorld(frame: string, session: string, pending: Promise<number>, context: number): void {
		if (this.#creating.get(frame)?.promise === pending && !this.#closed) {
			this.#worlds.set(frame, { session, context })
		}
		this.#settleWorld(frame, pending)
	}

	#settleWorld(frame: string, pending: Promise<number>): void {
		if (this.#creating.get(frame)?.promise === pending) this.#creating.delete(frame)
	}

	#resolveSessionHandlers(session: string): {
		readonly destroyed: CDPHandler
		readonly cleared: CDPHandler
		readonly navigated: CDPHandler
		readonly routed: CDPHandler
	} {
		const existing = this.#sessionHandlers.get(session)
		if (existing !== undefined) return existing
		const created = {
			destroyed: this.#handleContextDestroyed.bind(this, session),
			cleared: this.#handleContextsCleared.bind(this, session),
			navigated: this.#handleSessionNavigated.bind(this, session),
			routed: this.#handleSessionRouted.bind(this, session),
		}
		this.#sessionHandlers.set(session, created)
		return created
	}

	#watchSession(session: string): void {
		const handlers = this.#resolveSessionHandlers(session)
		this.#client.subscribe('Page.frameDetached', this.#frameDetachedHandler, session)
		this.#client.subscribe('Page.frameNavigated', handlers.navigated, session)
		this.#client.subscribe('Page.navigatedWithinDocument', handlers.routed, session)
		this.#client.subscribe('Runtime.executionContextDestroyed', handlers.destroyed, session)
		this.#client.subscribe('Runtime.executionContextsCleared', handlers.cleared, session)
	}

	#unwatchSession(session: string): void {
		const handlers = this.#resolveSessionHandlers(session)
		this.#client.unsubscribe('Page.frameDetached', this.#frameDetachedHandler, session)
		this.#client.unsubscribe('Page.frameNavigated', handlers.navigated, session)
		this.#client.unsubscribe('Page.navigatedWithinDocument', handlers.routed, session)
		this.#client.unsubscribe('Runtime.executionContextDestroyed', handlers.destroyed, session)
		this.#client.unsubscribe('Runtime.executionContextsCleared', handlers.cleared, session)
		this.#sessionHandlers.delete(session)
	}

	async #resolveFrameSession(frame: string): Promise<string> {
		const owner = this.#frameSessions.get(frame)
		return owner === undefined ? this.#sessionId : await owner.attempt
	}

	async #enableFrameSession(session: string): Promise<string> {
		await this.#client.send('Page.enable', undefined, { session })
		await this.#client.send('Runtime.enable', undefined, { session })
		return session
	}

	// The frame's first commit can precede its session's `Page.enable`, which never replays it, so
	// the session's own frame tree supplies the committed URL and name before publication. A
	// session gone between its enable and this read publishes the record it already holds, and a
	// navigation the session reported since the attach replaced `attached` and is newer than
	// the tree's snapshot.
	async #readFrameTree(session: string, attached: BrowserFrameInfo): Promise<void> {
		const result = await this.#client
			.send('Page.getFrameTree', undefined, { session })
			.catch(() => undefined)
		const [root] = readBrowserFrames(result)
		if (root === undefined || root.id !== attached.id || this.#attaching.get(session) !== attached)
			return
		this.#attaching.set(session, { ...attached, url: root.url, name: root.name ?? attached.name })
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
				await this.#detachChild(session, this.#sessionId)
				return
			}
			const worker = new BrowserWorker(this.#client, session, id, url, category)
			this.#workers.set(id, worker)
			this.#emitter.emit('worker', worker)
		} catch {
			// A worker can terminate before its session is enabled.
			await this.#detachChild(session, this.#sessionId)
		}
	}

	// Discovery attaches a popup on the browser session, which keeps the popup's session alive after
	// its opener closes; a session attached through this page's session would end with it.
	async #discoverPopup(id: string, url: string | undefined): Promise<void> {
		const held = this.#holder(id)
		if (held !== undefined) {
			const ready = await held.#setup.then(
				() => true,
				() => false,
			)
			this.#claimed.delete(id)
			if (ready && this.#holder(id) === held) this.#publish(held)
			return
		}
		const result: unknown = await this.#client
			.send('Target.attachToTarget', { targetId: id, flatten: true })
			.catch(() => undefined)
		// A popup can close before the attach reaches it.
		if (!isRecord(result) || !isString(result['sessionId'])) {
			this.#claimed.delete(id)
			return
		}
		await this.#attachPopup(result['sessionId'], id, url, undefined)
	}

	// `owner` is the session the popup's session was attached through, undefined for the browser
	// session; a discovered popup reports no URL before its first commit, so its frame tree does.
	async #attachPopup(
		session: string,
		id: string,
		url: string | undefined,
		owner: string | undefined,
	): Promise<void> {
		let popup: BrowserPage | undefined
		const setup = Promise.withResolvers<void>()
		try {
			await this.#client.send('Page.enable', undefined, { session })
			await this.#client.send('Runtime.enable', undefined, { session })
			await this.#client.send('Page.setLifecycleEventsEnabled', { enabled: true }, { session })
			const result = await this.#client.send('Page.getFrameTree', undefined, { session })
			const frame = readBrowserFrames(result)[0]
			if (frame === undefined || this.#closed) {
				await this.#detachChild(session, owner)
				return
			}
			const held = this.#holder(id)
			if (held !== undefined) {
				await this.#detachChild(session, owner)
				const ready = await held.#setup.then(
					() => true,
					() => false,
				)
				if (ready && !this.#closed && this.#holder(id) === held) this.#publish(held)
				return
			}
			popup = new BrowserPage(
				this.#client,
				id,
				session,
				this.#writer,
				url ?? frame.url,
				frame.id,
				this.#contextId,
				this,
				undefined,
				this.#reference,
				setup.promise,
			)
			popup.#owner = owner
			await popup.send('Target.setAutoAttach', {
				autoAttach: true,
				waitForDebuggerOnStart: false,
				flatten: true,
			})
			await popup.send('Page.setInterceptFileChooserDialog', { enabled: true })
			await popup.network.start()
			if (this.#closed) throw new BrowserError('Browser page is closed')
			setup.resolve()
			this.#publish(popup)
		} catch (error) {
			// A popup can close before its session initialization completes.
			if (popup !== undefined) {
				setup.reject(error)
				await popup.destroy()
			} else await this.#detachChild(session, owner)
		} finally {
			this.#claimed.delete(id)
		}
	}

	// Publishes a page this page opened once this page is published itself, so the observer of this
	// page sees it before any page it opened.
	#publish(popup: BrowserPage): void {
		void this.#announcement.promise.then(
			() => this.#emitPopup(popup),
			() => this.#emitPopup(popup),
		)
	}

	// Emits one popup once; a closed popup is never emitted, and a popup this page constructed is
	// released when this page closed first.
	#emitPopup(popup: BrowserPage): void {
		const id = popup.#targetId
		if (popup.#closed || this.#popups.get(id) === popup) return
		if (this.#closed) {
			if (popup.#opener === this) void popup.destroy().catch(() => undefined)
			return
		}
		popup.#opener ??= this
		this.#popups.set(id, popup)
		popup.emitter.on('close', () => {
			if (this.#popups.get(id) === popup) this.#popups.delete(id)
		})
		this.#emitter.emit('popup', popup)
		popup.#announcement.resolve()
	}

	// Reads the live page that holds a target on this page's connection.
	#holder(id: string): BrowserPage | undefined {
		const held = BrowserPage.#held.get(this.#client)?.get(id)
		return held === undefined || held.#closed ? undefined : held
	}

	#unhold(): void {
		const held = BrowserPage.#held.get(this.#client)
		if (held?.get(this.#targetId) === this) held.delete(this.#targetId)
	}

	// Takes the discovery reports that waited for this page's target.
	#drain(): void {
		const reports = BrowserPage.#reports.get(this.#client)
		if (reports === undefined) return
		for (const [id, target] of reports) {
			if (target['openerId'] !== this.#targetId) continue
			reports.delete(id)
			this.#discover(target)
		}
	}

	// A session attached through a page session detaches only through that session.
	async #detachChild(session: string, owner: string | undefined): Promise<void> {
		await this.#client
			.send(
				'Target.detachFromTarget',
				{ sessionId: session },
				owner === undefined ? undefined : { session: owner },
			)
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
		if (isString(params['name'])) {
			if (params['name'] === 'networkIdle' && this.#loader !== undefined) {
				if (params['loaderId'] === this.#loader) this.#resolveLoad()
			}
			return
		}
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

	#handleRestore(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frame']
		if (params['type'] === 'BackForwardCacheRestore' && isRecord(frame) && frame['id'] === this.id)
			this.#resolveLoad()
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
				undefined,
				true,
				() => this.#epochOf(frame),
				(session, call) => this.#world(frame, session, call),
			),
		)
	}

	#handleFrameNavigated(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frame']
		if (!isRecord(frame) || !isString(frame['id']) || !isString(frame['url'])) return
		if (frame['id'] !== this.id) {
			this.#advanceFrame(frame['id'])
			this.#worlds.delete(frame['id'])
			this.#creating.delete(frame['id'])
			return
		}
		this.#advancePage()
		if (isString(frame['loaderId'])) this.#loader = frame['loaderId']
		if (params['type'] === 'BackForwardCacheRestore') {
			this.#dom = this.#loader ?? 'initial'
			for (const id of this.#readiness.keys()) this.#settleReadiness(id)?.resolve()
		}
		this.update(frame['url'])
		this.#emitter.emit('navigate', frame['url'], false)
	}

	// A frame session reports its own frame's committed URL, which `Target.attachedToTarget` does
	// not carry before the framed document commits.
	#handleSessionNavigated(session: string, params: Readonly<Record<string, unknown>>): void {
		this.#handleFrameNavigated(params)
		const frame = params['frame']
		if (isRecord(frame)) this.#updateFrameURL(session, frame['id'], frame['url'])
	}

	#handleSessionRouted(session: string, params: Readonly<Record<string, unknown>>): void {
		this.#handleSameDocument(params)
		this.#updateFrameURL(session, params['frameId'], params['url'])
	}

	// Only the frame's owning session describes its document, so an event from a superseded session
	// or about a nested frame leaves the record alone.
	#updateFrameURL(session: string, frame: unknown, url: unknown): void {
		if (!isString(frame) || !isString(url) || this.#frameSessions.get(frame)?.session !== session)
			return
		const attaching = this.#attaching.get(session)
		if (attaching !== undefined) this.#attaching.set(session, { ...attaching, url })
		const listed = this.#iframes.get(frame)
		if (listed !== undefined) this.#iframes.set(frame, { ...listed, url })
	}

	#handleSameDocument(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		if (!isString(frame)) return
		this.#advanceFrame(frame)
		if (frame !== this.id || !isString(params['url'])) return
		this.update(params['url'])
		this.#emitter.emit('navigate', params['url'], true)
	}

	#handleFrameDetached(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		if (!isString(frame)) return
		this.#advanceFrame(frame)
		this.#worlds.delete(frame)
		this.#creating.delete(frame)
		// CDP reports a process replacement as `swap`: the frame persists in another renderer, whose
		// session `Target.attachedToTarget` can have registered before this detach arrives.
		if (params['reason'] === 'swap') return
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

	// Registers a client's discovery routing with its first held page; the end of each connection
	// and each later connection leave no held page and no waiting report, and discovery enables
	// again.
	static #track(client: CDPClientInterface): Map<string, BrowserPage> {
		const known = BrowserPage.#held.get(client)
		if (known !== undefined) return known
		const held = new Map<string, BrowserPage>()
		const reports = new Map<string, Readonly<Record<string, unknown>>>()
		BrowserPage.#held.set(client, held)
		BrowserPage.#reports.set(client, reports)
		client.subscribe('Target.targetCreated', (params) => BrowserPage.#route(client, params))
		client.subscribe('Target.targetDestroyed', (params) => {
			if (isString(params['targetId'])) reports.delete(params['targetId'])
		})
		for (const event of ['connect', 'close', 'drop'] as const)
			client.emitter.on(event, () => {
				held.clear()
				reports.clear()
				BrowserPage.#discovered.delete(client)
			})
		return held
	}

	// Chromium 141 reports a `window.open` page only to browser-session discovery, whose `openerId`
	// names the page that opened it, and enumerates existing targets when discovery turns on; a
	// report whose opener no page holds yet waits for that page.
	static #route(client: CDPClientInterface, params: Readonly<Record<string, unknown>>): void {
		const target = params['targetInfo']
		if (
			!isRecord(target) ||
			target['type'] !== 'page' ||
			target['attached'] === true ||
			!isString(target['targetId']) ||
			!isString(target['openerId'])
		)
			return
		const opener = BrowserPage.#held.get(client)?.get(target['openerId'])
		if (opener === undefined || opener.#closed) {
			BrowserPage.#reports.get(client)?.set(target['targetId'], target)
			return
		}
		opener.#discover(target)
	}

	#discover(target: Readonly<Record<string, unknown>>): void {
		const id = target['targetId']
		const context = target['browserContextId']
		if (
			!isString(id) ||
			(this.#contextId !== undefined && isString(context) && context !== this.#contextId)
		)
			return
		if (this.#closed || this.#popups.has(id) || this.#claimed.has(id)) return
		this.#claimed.add(id)
		const url = target['url']
		void this.#discoverPopup(id, isString(url) && url !== '' ? url : undefined)
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
			const id = target['targetId']
			if (this.#popups.has(id) || this.#claimed.has(id)) {
				void this.#detachChild(session, this.#sessionId)
				return
			}
			this.#claimed.add(id)
			void this.#attachPopup(
				session,
				id,
				isString(target['url']) ? target['url'] : 'about:blank',
				this.#sessionId,
			)
			return
		}
		if (category !== 'iframe') return

		const frame = target['targetId']
		const attached: BrowserFrameInfo = {
			id: frame,
			parent: undefined,
			name: undefined,
			url: isString(target['url']) ? target['url'] : 'about:blank',
		}
		this.#attaching.set(session, attached)
		this.#worlds.delete(frame)
		this.#creating.delete(frame)
		// A later attach for the same frame supersedes every earlier session, which stops describing
		// the frame here and keeps no pending record to publish.
		for (const [other, owned] of this.#frameIds) {
			if (owned !== frame || other === session) continue
			this.#attaching.delete(other)
			this.#frameIds.delete(other)
			this.#unwatchSession(other)
		}
		this.#watchSession(session)
		const attempt = this.#enableFrameSession(session)
		this.#frameSessions.set(frame, { session, attempt })
		this.#frameIds.set(session, frame)
		void attempt.then(this.#readFrameTree.bind(this, session, attached)).then(
			() => {
				const info = this.#attaching.get(session)
				this.#attaching.delete(session)
				if (
					info === undefined ||
					this.#closed ||
					this.#frameSessions.get(frame)?.attempt !== attempt
				)
					return
				this.#iframes.set(frame, info)
				this.#emitter.emit('session', this.#frame(info))
			},
			() => {
				this.#attaching.delete(session)
				if (this.#frameSessions.get(frame)?.attempt === attempt) this.#frameSessions.delete(frame)
				if (this.#frameIds.get(session) === frame) this.#frameIds.delete(session)
				this.#unwatchSession(session)
				void this.#detachChild(session, this.#sessionId)
			},
		)
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
			// A detached second session of a popup leaves the popup on the session it was published on.
			if (popup !== undefined && popup.#sessionId === session) {
				this.#popups.delete(target)
				void popup.destroy().catch(() => undefined)
			}
		}
		const frame = isString(target)
			? target
			: isString(session)
				? this.#frameIds.get(session)
				: undefined
		const owner = frame === undefined ? undefined : this.#frameSessions.get(frame)?.session
		// A superseded session's detach leaves the frame to the session that replaced it.
		const superseded = isString(session) && owner !== undefined && owner !== session
		if (frame !== undefined && !superseded) {
			if (this.#frameSessions.delete(frame)) this.#advanceFrame(frame)
			this.#iframes.delete(frame)
			this.#worlds.delete(frame)
			this.#creating.delete(frame)
		}
		if (isString(session) && this.#frameIds.delete(session)) this.#unwatchSession(session)
	}

	#handleContextDestroyed(session: string, params: Readonly<Record<string, unknown>>): void {
		const context = params['executionContextId']
		if (!isInteger(context)) return
		for (const [frame, world] of this.#worlds) {
			if (world.session === session && world.context === context) this.#worlds.delete(frame)
		}
	}

	#handleContextsCleared(session: string): void {
		for (const [frame, world] of this.#worlds) {
			if (world.session === session) this.#worlds.delete(frame)
		}
		for (const [frame, pending] of this.#creating) {
			if (pending.session === session) this.#creating.delete(frame)
		}
	}

	// A signal ends the load wait with its reason, so an abort after `Page.navigate` replied is
	// reported as the abort rather than as the navigation timeout.
	#waitForLoadEvent(
		condition: BrowserWaitUntil,
		timeout: number,
		signal?: AbortSignal,
	): Promise<void> {
		const eventName =
			condition === 'commit'
				? 'Page.frameNavigated'
				: condition === 'domcontentloaded'
					? 'Page.domContentEventFired'
					: condition === 'idle'
						? 'Page.lifecycleEvent'
						: 'Page.loadEventFired'
		const deferred = Promise.withResolvers<void>()
		this.#sameDocument = false
		if (condition === 'idle') this.#loader = undefined
		this.#loadEvents = [eventName, 'Page.navigatedWithinDocument']
		this.#loadResolve = deferred.resolve
		this.#loadReject = deferred.reject
		this.#loadTimer = setTimeout(() => {
			this.#rejectLoad(new BrowserError(`Navigation timeout after ${timeout}ms`))
		}, timeout)
		for (const event of this.#loadEvents) {
			this.#client.subscribe(event, this.#loadHandler, this.#sessionId)
		}
		if (signal !== undefined) {
			const listener = this.#abortLoad.bind(this, signal)
			this.#loadAbort = { signal, listener }
			signal.addEventListener('abort', listener, { once: true })
		}
		return deferred.promise
	}

	#abortLoad(signal: AbortSignal): void {
		this.#rejectLoad(signal.reason)
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
		this.#loadAbort?.signal.removeEventListener('abort', this.#loadAbort.listener)
		this.#loadAbort = undefined
		this.#loadTimer = undefined
		this.#loadResolve = undefined
		this.#loadReject = undefined
	}
}
