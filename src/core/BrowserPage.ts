import type {
	BrowserElementManagerInterface,
	BrowserPageElementInterface,
	BrowserReadinessWait,
	BrowserReferenceFunction,
	BrowserCallOptions,
	BrowserWaitOptions,
	BrowserCodegenInterface,
	BrowserRecorderOptions,
	BrowserClockInterface,
	BrowserDiagnosticsInterface,
	BrowserFrameInfo,
	BrowserFrameInterface,
	BrowserKeyboardInterface,
	BrowserMouseInterface,
	BrowserNavigationEventMap,
	BrowserNavigationReason,
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
	BrowserPopupManagerInterface,
	BrowserPopupRecordInterface,
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
import { BrowserCodegen } from './recorders/BrowserCodegen.js'
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
	BROWSER_NAVIGATION_REASONS,
	BROWSER_RELOAD_NAVIGATION_TYPES,
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
import {
	isArray,
	isError,
	isFiniteNumber,
	isInteger,
	isRecord,
	isString,
} from '@orkestrel/contract'
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
	// The latest current-tab request per frame that no start has taken yet, from any session the
	// page knows, because the document that initiates a navigation reports the request even when
	// another session owns the navigating frame; the owning session's start for the same URL takes
	// its reason unless it repeats a history entry. The next request replaces an entry, and every
	// start of the frame, a same-document commit, the frame's removal, and the page's teardown delete
	// it, so the map holds at most one entry per attached frame.
	readonly #pending: Map<
		string,
		{ readonly url: string; readonly reason: BrowserNavigationReason | undefined }
	> = new Map()
	readonly #downloads: Map<string, BrowserDownload> = new Map()
	readonly #workers: Map<string, BrowserWorker> = new Map()
	readonly #popups: Map<string, BrowserPage> = new Map()
	// A popup target an attach is initializing, so the attach that arrives second, through discovery
	// or through an attachment event, initializes nothing.
	readonly #claimed: Set<string> = new Set()
	// Each open popup record's observations since it opened, replaced on every change: the
	// `Page.windowOpen` reports counted, the popup targets the page began to adopt, and each of those
	// targets that concluded, mapped to its page when announced and to undefined when skipped.
	readonly #records: Map<
		symbol,
		{
			readonly opened: number
			readonly targets: ReadonlySet<string>
			readonly outcomes: ReadonlyMap<string, BrowserPage | undefined>
		}
	> = new Map()
	// Wakes every pending popup settle after a record changes or ends.
	readonly #wakes: Set<() => void> = new Set()
	readonly #popupManager: BrowserPopupManagerInterface = {
		record: this.#recordPopups.bind(this),
	}
	readonly #openHandler = this.#handleOpen.bind(this)
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
			readonly detached: CDPHandler
			readonly attached: CDPHandler
			readonly requested: CDPHandler
			readonly started: CDPHandler
			readonly lifecycle: CDPHandler
			readonly stopped: CDPHandler
			readonly target: CDPHandler
			readonly released: CDPHandler
		}
	> = new Map()
	// The navigation steps each frame's owning session reports, which the navigation and element
	// managers consume; see `#accepts` for the ownership rule.
	readonly #steps = new Emitter<BrowserNavigationEventMap>()
	// The parent of each frame whose attach, frame tree, or target named one.
	readonly #parents: Map<string, string> = new Map()
	// The loader of each frame's latest accepted commit, so a stop is a load only for a commit that
	// named no loader.
	readonly #loaders: Map<string, string | undefined> = new Map()
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
	readonly #dialogHandler = this.#handleDialog.bind(this)
	readonly #chooserHandler = this.#handleChooser.bind(this)
	readonly #consoleHandler = this.#handleConsole.bind(this)
	readonly #errorHandler = this.#handleError.bind(this)
	readonly #crashHandler = this.#handleCrash.bind(this)
	readonly #downloadHandler = this.#handleDownload.bind(this)
	readonly #downloadProgressHandler = this.#handleDownloadProgress.bind(this)

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
			steps: this.#steps,
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
			this.#steps,
			this.#parents.get.bind(this.#parents),
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
		this.#watchSession(this.#sessionId)
		this.#client.subscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.subscribe('Page.windowOpen', this.#openHandler, this.#sessionId)
		this.#client.subscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.subscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.subscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.subscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
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

	async wait(text: string, options?: BrowserWaitOptions): Promise<void> {
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
						expression: compileTextWaitExpression(text, remaining, key, options?.absent === true),
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
					!isError(error) ||
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

	get popups(): BrowserPopupManagerInterface {
		return this.#popupManager
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
		const frames = readBrowserFrames(result, [...this.#iframes.values()])
		for (const { id, parent } of frames) if (parent !== undefined) this.#parents.set(id, parent)
		return frames.map((frame) => this.#frame(frame))
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

	async codegen(options?: BrowserRecorderOptions): Promise<BrowserCodegenInterface> {
		this.assert()
		const active = this.#codegenStart.pending
		if (active !== undefined) return await active
		if (this.#codegen !== undefined) return this.#codegen

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
		const signal = options?.signal
		const call = { timeout, ...(signal === undefined ? {} : { signal }) }
		const watch = this.#watchNavigation()
		const condition = options?.condition ?? 'load'
		const wait = this.#waitForLoadEvent(condition, timeout, signal)
		void wait.catch(() => undefined)
		let loader: string | undefined

		// A load or a completion read that settles in the same tick as an abort leaves the signal as
		// the only witness, so cancellation is checked after the wait and after the completion read.
		try {
			const result = await this.send('Page.navigate', { url }, call)
			if (isRecord(result) && isString(result['errorText'])) {
				throw new BrowserError(`Navigation failed: ${result['errorText']}`)
			}
			if (isRecord(result) && isString(result['loaderId'])) {
				loader = result['loaderId']
				this.#loader = loader
			}
			await wait
			signal?.throwIfAborted()
			const completed = await this.#completeNavigation(watch, loader, call)
			signal?.throwIfAborted()
			return completed
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}
	}

	async #reload(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const signal = options?.signal
		const call = { timeout, ...(signal === undefined ? {} : { signal }) }
		const watch = this.#watchNavigation()
		const wait = this.#waitForLoadEvent(options?.condition ?? 'load', timeout, signal)
		void wait.catch(() => undefined)

		// Cancellation is checked after the wait and after the completion read, as `#navigate` does.
		try {
			await this.send('Page.reload', undefined, call)
			await wait
			signal?.throwIfAborted()
			const completed = await this.#completeNavigation(watch, undefined, call)
			signal?.throwIfAborted()
			return completed
		} catch (error) {
			this.#clearNavigationWatch(watch)
			this.#cancelLoad()
			await this.#stopLoading(Math.min(timeout, BROWSER_STOP_LOADING_TIMEOUT_MS))
			throw error
		}
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

	async #startCodegen(options?: BrowserRecorderOptions): Promise<BrowserCodegen> {
		const codegen = new BrowserCodegen(this.#client, this.#sessionId, options, () =>
			[...this.#frameSessions.values()].map(({ session }) => session),
		)
		this.#codegen = codegen
		try {
			await codegen.start()
		} catch (error) {
			this.#codegen = undefined
			await codegen.destroy()
			throw error
		}
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
		this.#unwatchSession(this.#sessionId)
		this.#client.unsubscribe('Page.javascriptDialogOpening', this.#dialogHandler, this.#sessionId)
		this.#client.unsubscribe('Page.windowOpen', this.#openHandler, this.#sessionId)
		this.#records.clear()
		this.#wakePopups()
		this.#client.unsubscribe('Page.fileChooserOpened', this.#chooserHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.consoleAPICalled', this.#consoleHandler, this.#sessionId)
		this.#client.unsubscribe('Runtime.exceptionThrown', this.#errorHandler, this.#sessionId)
		this.#client.unsubscribe('Inspector.targetCrashed', this.#crashHandler, this.#sessionId)
		this.#client.unsubscribe('Browser.downloadWillBegin', this.#downloadHandler)
		this.#client.unsubscribe('Browser.downloadProgress', this.#downloadProgressHandler)
		this.#parents.clear()
		this.#loaders.clear()
		this.#pending.clear()
		if (!this.#emitter.destroyed) {
			this.#emitter.emit('close')
			this.#emitter.destroy()
		}
		this.#steps.destroy()
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
		readonly detached: CDPHandler
		readonly attached: CDPHandler
		readonly requested: CDPHandler
		readonly started: CDPHandler
		readonly lifecycle: CDPHandler
		readonly stopped: CDPHandler
		readonly target: CDPHandler
		readonly released: CDPHandler
	} {
		const existing = this.#sessionHandlers.get(session)
		if (existing !== undefined) return existing
		const created = {
			destroyed: this.#handleContextDestroyed.bind(this, session),
			cleared: this.#handleContextsCleared.bind(this, session),
			navigated: this.#handleSessionNavigated.bind(this, session),
			routed: this.#handleSessionRouted.bind(this, session),
			detached: this.#handleFrameDetached.bind(this, session),
			attached: this.#handleFrameAttached.bind(this, session),
			requested: this.#handleRequested.bind(this, session),
			started: this.#handleStarted.bind(this, session),
			lifecycle: this.#handleSessionLifecycle.bind(this, session),
			stopped: this.#handleStopped.bind(this, session),
			target: this.#handleAttached.bind(this, session),
			released: this.#handleDetached.bind(this),
		}
		this.#sessionHandlers.set(session, created)
		return created
	}

	// Every session the page follows, its own included, reports its frames' steps through the same
	// persistent handlers from the moment it is watched until it is unwatched; no action subscribes.
	#watchSession(session: string): void {
		const handlers = this.#resolveSessionHandlers(session)
		for (const [method, handler] of this.#pairSessionHandlers(handlers))
			this.#client.subscribe(method, handler, session)
	}

	#unwatchSession(session: string): void {
		const handlers = this.#resolveSessionHandlers(session)
		for (const [method, handler] of this.#pairSessionHandlers(handlers))
			this.#client.unsubscribe(method, handler, session)
		this.#sessionHandlers.delete(session)
	}

	#pairSessionHandlers(handlers: {
		readonly destroyed: CDPHandler
		readonly cleared: CDPHandler
		readonly navigated: CDPHandler
		readonly routed: CDPHandler
		readonly detached: CDPHandler
		readonly attached: CDPHandler
		readonly requested: CDPHandler
		readonly started: CDPHandler
		readonly lifecycle: CDPHandler
		readonly stopped: CDPHandler
		readonly target: CDPHandler
		readonly released: CDPHandler
	}): ReadonlyArray<readonly [method: string, handler: CDPHandler]> {
		return [
			['Target.attachedToTarget', handlers.target],
			['Target.detachedFromTarget', handlers.released],
			['Page.frameAttached', handlers.attached],
			['Page.frameDetached', handlers.detached],
			['Page.frameRequestedNavigation', handlers.requested],
			['Page.frameStartedNavigating', handlers.started],
			['Page.frameNavigated', handlers.navigated],
			['Page.navigatedWithinDocument', handlers.routed],
			['Page.lifecycleEvent', handlers.lifecycle],
			['Page.frameStoppedLoading', handlers.stopped],
			['Runtime.executionContextDestroyed', handlers.destroyed],
			['Runtime.executionContextsCleared', handlers.cleared],
		]
	}

	async #resolveFrameSession(frame: string): Promise<string> {
		const owner = this.#frameSessions.get(frame)
		return owner === undefined ? this.#sessionId : await owner.attempt
	}

	// A frame session reports its frame's load only with lifecycle events enabled, and a nested
	// out-of-process frame attaches only through its parent frame's own auto-attach; a refusal fails
	// the enablement. The target waits for the debugger until both are in effect, so the commit and
	// the load of the document it holds arrive on this session after the resume.
	async #enableFrameSession(session: string): Promise<string> {
		await this.#client.send('Page.enable', undefined, { session })
		await this.#codegen?.attach(session)
		await this.#client.send('Runtime.enable', undefined, { session })
		await this.#client.send('Page.setLifecycleEventsEnabled', { enabled: true }, { session })
		await this.#client.send(
			'Target.setAutoAttach',
			{
				autoAttach: true,
				waitForDebuggerOnStart: true,
				flatten: true,
				filter: [{ type: 'iframe' }],
			},
			{ session },
		)
		this.#resumeTarget(session)
		return session
	}

	// Every target the page's auto-attach reaches waits for the debugger until the page resumes it;
	// a target gone before its resume ends with its detach.
	#resumeTarget(session: string): void {
		void this.#client
			.send('Runtime.runIfWaitingForDebugger', undefined, { session })
			.catch(() => undefined)
	}

	// A detach alone leaves a paused target waiting, so a target the page releases runs uninstrumented
	// rather than frozen. The wait ends when the resume attempt settles: a reply shows the renderer
	// processed the resume before the browser processes the detach that follows, and a refusal, the
	// client's timeout, or the connection's close lets the detach go ahead as best-effort cleanup.
	async #releaseTarget(session: string): Promise<void> {
		await this.#client
			.send('Runtime.runIfWaitingForDebugger', undefined, { session })
			.catch(() => undefined)
	}

	// A target that names no parent frame is placed by its own frame tree, whose root supplies the
	// parent, the URL, and the name; a navigation the session reported since the attach replaced
	// `attached` with a URL newer than the tree's snapshot, which the record keeps.
	async #readFrameTree(session: string, attached: BrowserFrameInfo, named: boolean): Promise<void> {
		if (named) return
		const result = await this.#client
			.send('Page.getFrameTree', undefined, { session })
			.catch(() => undefined)
		const [root] = readBrowserFrames(result)
		if (root === undefined || root.id !== attached.id || this.#attaching.get(session) !== attached)
			return
		const parent = root.parent ?? attached.parent
		if (parent !== undefined) this.#parents.set(attached.id, parent)
		this.#attaching.set(session, {
			...attached,
			parent,
			url: root.url,
			name: root.name ?? attached.name,
		})
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
			this.#resumeTarget(session)
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
			else this.#concludePopup(id)
			return
		}
		const result: unknown = await this.#client
			.send('Target.attachToTarget', { targetId: id, flatten: true })
			.catch(() => undefined)
		// A popup can close before the attach reaches it.
		if (!isRecord(result) || !isString(result['sessionId'])) {
			this.#claimed.delete(id)
			this.#concludePopup(id)
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
				this.#concludePopup(id)
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
				else this.#concludePopup(id)
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
				waitForDebuggerOnStart: true,
				flatten: true,
			})
			await popup.send('Page.setInterceptFileChooserDialog', { enabled: true })
			await popup.network.start()
			if (this.#closed) throw new BrowserError('Browser page is closed')
			this.#resumeTarget(session)
			setup.resolve()
			this.#publish(popup)
		} catch (error) {
			// A popup can close before its session initialization completes.
			this.#concludePopup(id)
			if (popup !== undefined) {
				setup.reject(error)
				await this.#releaseTarget(session)
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
		if (this.#popups.get(id) === popup) return
		if (popup.#closed) {
			this.#concludePopup(id)
			return
		}
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
		this.#concludePopup(id, popup)
	}

	#recordPopups(): BrowserPopupRecordInterface {
		this.assert()
		const key = Symbol('popups')
		this.#records.set(key, { opened: 0, targets: new Set(), outcomes: new Map() })
		return {
			settle: this.#settlePopups.bind(this, key),
			destroy: this.#endPopups.bind(this, key),
		}
	}

	// Parks until as many popup targets adopted since the record opened concluded as
	// `Page.windowOpen` reports arrived, or until `timeout`, which ends the wait with the popups
	// announced so far.
	async #settlePopups(
		key: symbol,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserPageInterface[]> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		// The platform deadline takes whole milliseconds.
		const deadline = AbortSignal.timeout(Math.ceil(timeout))
		while (true) {
			options?.signal?.throwIfAborted()
			const record = this.#records.get(key)
			if (record === undefined)
				throw new BrowserError(
					this.#closed
						? 'Browser popup record ended because the page closed'
						: 'Browser popup record ended',
				)
			if (record.opened === 0) return []
			if (record.outcomes.size >= record.opened || deadline.aborted)
				return [...record.outcomes.values()].filter(
					(popup): popup is BrowserPage => popup !== undefined && popup.#opener === this,
				)
			await this.#parkPopups(deadline, options?.signal)
		}
	}

	// Resolves on the next change to a popup record or when `deadline` aborts; rejects with the
	// signal's reason on abort.
	async #parkPopups(deadline: AbortSignal, signal: AbortSignal | undefined): Promise<void> {
		const wake = Promise.withResolvers<void>()
		const abort = this.#abandonPopups.bind(this, wake, signal)
		this.#wakes.add(wake.resolve)
		deadline.addEventListener('abort', abort, { once: true })
		signal?.addEventListener('abort', abort, { once: true })
		try {
			await wake.promise
		} finally {
			this.#wakes.delete(wake.resolve)
			deadline.removeEventListener('abort', abort)
			signal?.removeEventListener('abort', abort)
		}
	}

	// The caller's abort rejects a parked settle with its reason; the deadline's wakes it.
	#abandonPopups(wake: PromiseWithResolvers<void>, signal: AbortSignal | undefined): void {
		if (signal?.aborted === true) wake.reject(signal.reason)
		else wake.resolve()
	}

	#endPopups(key: symbol): void {
		if (this.#records.delete(key)) this.#wakePopups()
	}

	#wakePopups(): void {
		for (const wake of [...this.#wakes]) wake()
	}

	// Chromium 141 reports a window this page's document opens on this page's session before it
	// answers the input that opened it; a report names no target, so each one counts. Chromium 141
	// announces such a window only to discovery, so a page that takes no part in it counts none.
	#handleOpen(): void {
		if (this.#holder(this.#targetId) !== this) return
		for (const [key, record] of this.#records)
			this.#records.set(key, { ...record, opened: record.opened + 1 })
		this.#wakePopups()
	}

	// Names a popup target this page begins to adopt in every open popup record.
	#expectPopup(id: string): void {
		for (const [key, record] of this.#records)
			this.#records.set(key, { ...record, targets: new Set([...record.targets, id]) })
	}

	// Concludes a popup target in every open record that expects it: announced with its page, or
	// skipped without one when it closed or failed its setup first.
	#concludePopup(id: string, popup?: BrowserPage): void {
		for (const [key, record] of this.#records)
			if (record.targets.has(id) && !record.outcomes.has(id))
				this.#records.set(key, { ...record, outcomes: new Map([...record.outcomes, [id, popup]]) })
		this.#wakePopups()
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

	// A session attached through a page session detaches only through that session, after the page
	// releases its target.
	async #detachChild(session: string, owner: string | undefined): Promise<void> {
		await this.#releaseTarget(session)
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

	// Every session that owns a frame names the parent of a frame it attaches; only the page
	// session's frames are announced, as before a frame session reported any.
	#handleFrameAttached(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const parent = params['parentFrameId']
		if (!isString(frame) || !this.#accepts(session, frame)) return
		if (isString(parent)) this.#parents.set(frame, parent)
		if (session !== this.#sessionId) return
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
				(owner, call) => this.#world(frame, owner, call),
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
	// The ownership check precedes every change, so a report the page rejects leaves the frame's
	// epoch, world, and parent as they were.
	#handleSessionNavigated(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frame']
		if (!isRecord(frame) || !isString(frame['id']) || !isString(frame['url'])) return
		if (!this.#accepts(session, frame['id'])) return
		this.#handleFrameNavigated(params)
		this.#updateFrame(session, frame['id'], {
			url: frame['url'],
			name: isString(frame['name']) && frame['name'] !== '' ? frame['name'] : undefined,
		})
		if (isString(frame['parentId'])) this.#parents.set(frame['id'], frame['parentId'])
		const loader = isString(frame['loaderId']) ? frame['loaderId'] : undefined
		this.#loaders.set(frame['id'], loader)
		this.#steps.emit('commit', frame['id'], frame['url'], loader, false)
	}

	#handleSessionRouted(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const url = params['url']
		if (!isString(frame) || !this.#accepts(session, frame)) return
		this.#pending.delete(frame)
		this.#handleSameDocument(params)
		if (!isString(url)) return
		this.#updateFrame(session, frame, { url })
		this.#steps.emit('commit', frame, url, undefined, true)
	}

	// The one ownership rule every navigation step passes: the page session reports every frame in
	// the page's process and every swap, and a frame session reports the frame it owns and any frame
	// no session owns, until another session supersedes it.
	#accepts(session: string, frame: string): boolean {
		if (session === this.#sessionId) return true
		if (!this.#frameIds.has(session)) return false
		const owner = this.#frameSessions.get(frame)?.session
		return owner === undefined || owner === session
	}

	// A start the protocol announces with its loader is the step; the request that precedes it in the
	// current tab is the step on a host that announces no start, and carries the navigation's reason
	// when it is a `BROWSER_NAVIGATION_REASONS` value.
	#handleRequested(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const url = params['url']
		if (params['disposition'] !== 'currentTab' || !isString(frame) || !isString(url)) return
		const reason = BROWSER_NAVIGATION_REASONS.find((candidate) => candidate === params['reason'])
		if (session === this.#sessionId || this.#frameIds.has(session))
			this.#pending.set(frame, { url, reason })
		if (!this.#accepts(session, frame)) return
		this.#steps.emit('request', frame, url, undefined, reason)
	}

	#handleStarted(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const url = params['url']
		const loader = params['loaderId']
		if (!isString(frame) || !isString(url) || !isString(loader) || !this.#accepts(session, frame))
			return
		// A reload or a history traversal repeats an entry rather than following a request.
		const repeated = BROWSER_RELOAD_NAVIGATION_TYPES.some(
			(type) => type === params['navigationType'],
		)
		// Every start ends the frame's pending request, and only the start it requested takes its reason.
		const requested = this.#pending.get(frame)
		this.#pending.delete(frame)
		this.#steps.emit(
			'request',
			frame,
			url,
			loader,
			!repeated && requested?.url === url ? requested.reason : undefined,
		)
	}

	// Enabling lifecycle events replays earlier lifecycle names under a loader of no navigation, so a
	// load step carries its loader for the consumer to match.
	#handleSessionLifecycle(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		const loader = params['loaderId']
		if (params['name'] !== 'load' || !isString(frame) || !this.#accepts(session, frame)) return
		this.#steps.emit('load', frame, isString(loader) ? loader : undefined)
	}

	// A stop carries no loader, so it is a load only for a commit that named none.
	#handleStopped(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		if (
			!isString(frame) ||
			!this.#loaders.has(frame) ||
			this.#loaders.get(frame) !== undefined ||
			!this.#accepts(session, frame)
		)
			return
		this.#steps.emit('load', frame, undefined)
	}

	// Only the frame's owning session describes its document, so an event from a superseded session
	// or about a nested frame leaves the record alone. A commit reports the frame's name, which a
	// same-document navigation leaves as it was.
	#updateFrame(
		session: string,
		frame: string,
		update: Pick<BrowserFrameInfo, 'url'> & Partial<Pick<BrowserFrameInfo, 'name'>>,
	): void {
		if (this.#frameSessions.get(frame)?.session !== session) return
		const attaching = this.#attaching.get(session)
		if (attaching !== undefined) this.#attaching.set(session, { ...attaching, ...update })
		const listed = this.#iframes.get(frame)
		if (listed !== undefined) this.#iframes.set(frame, { ...listed, ...update })
	}

	#handleSameDocument(params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		if (!isString(frame)) return
		this.#advanceFrame(frame)
		if (frame !== this.id || !isString(params['url'])) return
		this.update(params['url'])
		this.#emitter.emit('navigate', params['url'], true)
	}

	#handleFrameDetached(session: string, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frameId']
		// The page session is entitled to report any frame's swap or removal, which `#accepts` grants
		// it; a frame session reports only a frame it owns.
		if (!isString(frame) || !this.#accepts(session, frame)) return
		const swapped = params['reason'] === 'swap'
		this.#advanceFrame(frame)
		this.#worlds.delete(frame)
		this.#creating.delete(frame)
		// CDP reports a process replacement as `swap`: the frame persists in another renderer, whose
		// session `Target.attachedToTarget` can have registered before this detach arrives.
		if (!swapped) {
			this.#frameSessions.delete(frame)
			this.#pending.delete(frame)
			this.#parents.delete(frame)
			this.#loaders.delete(frame)
			this.#emitter.emit('detach', frame)
		}
		this.#steps.emit('detach', frame, swapped)
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
		this.#expectPopup(id)
		const url = target['url']
		void this.#discoverPopup(id, isString(url) && url !== '' ? url : undefined)
	}

	// `owner` is the session that reported the attach: the page session for a page, a worker, or a
	// frame the page's process embeds, and a frame session for a frame nested in its frame.
	#handleAttached(owner: string, params: Readonly<Record<string, unknown>>): void {
		const target = params['targetInfo']
		const session = params['sessionId']
		if (!isRecord(target) || !isString(target['targetId']) || !isString(session)) {
			return
		}

		const category = target['type']
		if (owner !== this.#sessionId && category !== 'iframe') return
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
			this.#expectPopup(id)
			void this.#attachPopup(
				session,
				id,
				isString(target['url']) ? target['url'] : 'about:blank',
				this.#sessionId,
			)
			return
		}
		if (category !== 'iframe') {
			this.#resumeTarget(session)
			return
		}

		const frame = target['targetId']
		const named = isString(target['parentFrameId'])
		const parent = isString(target['parentFrameId'])
			? target['parentFrameId']
			: this.#parents.get(frame)
		if (parent !== undefined) this.#parents.set(frame, parent)
		const attached: BrowserFrameInfo = {
			id: frame,
			parent,
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
		void attempt.then(this.#readFrameTree.bind(this, session, attached, named)).then(
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
				void this.#detachChild(session, owner)
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
			this.#pending.delete(frame)
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
