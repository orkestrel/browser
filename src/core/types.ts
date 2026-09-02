import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

// === CDP transport

/**
 * Maps the events emitted by a {@link CDPTransportInterface} — the raw text pipe a
 * {@link CDPClientInterface} sends and receives JSON-RPC frames over.
 *
 * @remarks
 * `message` carries one raw text frame; `close` signals the underlying
 * connection ended; `error` carries a transport-level fault (unknown shape —
 * narrow before use).
 */
export type CDPTransportEventMap = {
	readonly message: readonly [data: string]
	readonly close: readonly []
	readonly error: readonly [error: unknown]
}

/**
 * Represents a dumb text transport CDPClient sends and receives JSON-RPC frames over.
 *
 * @remarks
 * The transport owns the connection (WebSocket, pipe, or any other duplex
 * channel) and the endpoint URL; it does no JSON framing of its own — that
 * stays in {@link CDPClientInterface}. Environment-specific transports
 * (a Node `WebSocket`, a browser `WebSocket`) live outside core and satisfy
 * this contract.
 */
export interface CDPTransportInterface {
	readonly emitter: EmitterInterface<CDPTransportEventMap>
	start(): Promise<void>
	send(data: string): Promise<void>
	close(): Promise<void>
}

// === CDP client

/**
 * Maps the events a {@link CDPClientInterface} emits.
 *
 * @remarks
 * `connect` fires once the transport started and dispatch began; `close`
 * fires after an explicit teardown, including one that interrupted a
 * pending `connect()`; `drop` fires when the transport ended without a
 * close request; `error` carries a transport-level fault (unknown shape —
 * narrow before use).
 */
export type CDPClientEventMap = {
	readonly connect: readonly []
	readonly close: readonly []
	readonly drop: readonly []
	readonly error: readonly [error: unknown]
}

/**
 * Describes the options for creating a CDPClient.
 *
 * @remarks
 * - `transport` — the text pipe the client sends/receives JSON-RPC frames over
 * - `timeout` — ms before a pending request or connection attempt fails (default from constants)
 * - `on` — initial event listeners wired at construction
 * - `error` — receives a throwing subscriber's error on both dispatch paths:
 *   a CDP event subscriber's throw arrives with the CDP method that raised it,
 *   and a lifecycle subscriber's throw arrives with the lifecycle event name
 *   (`connect`, `close`, `drop`, `error`) as the second argument. Without it a
 *   broken handler fails silently, because a throwing subscriber is never
 *   allowed to reach its siblings or the dispatch loop
 */
export interface CDPClientOptions {
	readonly transport: CDPTransportInterface
	readonly timeout?: number
	readonly on?: EmitterHooks<CDPClientEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Describes the options for one CDP method call.
 *
 * @remarks
 * - `session` — scope the call to one attached CDP session
 * - `timeout` — ms before this one request fails, overriding the client-wide default
 */
export interface CDPSendOptions {
	readonly session?: string
	readonly timeout?: number
}

/** Receives a subscribed CDP event with its params record. */
export type CDPHandler = (params: Readonly<Record<string, unknown>>) => void

/**
 * Represents one entry of the CDP `Target.getTargets` result.
 *
 * @remarks
 * `category` mirrors the protocol's `type` field — `'page'`, `'worker'`,
 * `'browser'`, and the rest of Chromium's target categories.
 */
export interface CDPTarget {
	readonly id: string
	readonly category: string
	readonly title: string
	readonly url: string
}

/**
 * Provides a lightweight Chrome DevTools Protocol client over a {@link CDPTransportInterface}.
 *
 * @remarks
 * - `emitter` — subscribe to the client's own connection lifecycle
 * - `connected` — true while the transport is active
 * - `connect` — start the transport and begin dispatching
 * - `reconnect` — close and re-establish the transport
 * - `send` — issue a CDP method call, optionally session-scoped, optionally
 *   bounded by a per-call timeout that overrides the client-wide default for
 *   this one request
 * - `subscribe` / `unsubscribe` — register/remove a handler for a CDP event,
 *   optionally session-scoped
 * - `close` — tear down the transport and reject all pending requests
 */
export interface CDPClientInterface {
	readonly emitter: EmitterInterface<CDPClientEventMap>
	readonly connected: boolean
	connect(): Promise<void>
	reconnect(): Promise<void>
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: CDPSendOptions,
	): Promise<unknown>
	subscribe(method: string, handler: CDPHandler, session?: string): void
	unsubscribe(method: string, handler: CDPHandler, session?: string): void
	close(): Promise<void>
}

// === Browser transition

/** Runs the work one {@link BrowserTransitionInterface} transition performs. */
export type BrowserTransitionFunction<T> = () => Promise<T>

/**
 * Represents one asynchronous transition shared by every caller that arrives while it runs.
 *
 * @remarks
 * `pending` is the promise of the transition in flight, or undefined when none
 * is running; an entity reads it to answer a question about its own state, such
 * as whether a close must wait for an in-flight connect. `execute` starts the
 * work when nothing is in flight, and joins the running transition otherwise.
 */
export interface BrowserTransitionInterface<T> {
	readonly pending: Promise<T> | undefined
	execute(work: BrowserTransitionFunction<T>): Promise<T>
}

// === Browser writer

/**
 * Provides a pluggable sink for persisting captured browser bytes to a path.
 *
 * @remarks
 * Core never touches a filesystem directly — a page accepts an optional
 * writer (server supplies an `fs`-backed implementation) and calls it when a
 * screenshot, PDF, trace, or HAR request carries a `path`.
 */
export interface BrowserWriterInterface {
	write(path: string, data: Uint8Array): Promise<void>
}

// === Browser shared

/** Describes the viewport dimensions for a browser page. */
export interface BrowserViewport {
	readonly width: number
	readonly height: number
	readonly scale?: number
	readonly mobile?: boolean
	readonly touch?: boolean
	readonly landscape?: boolean
}

/** Names the page load condition for navigation — the CDP load event awaited by `navigate()`. */
export type BrowserWaitUntil = 'commit' | 'load' | 'domcontentloaded'

/**
 * Describes the options for creating a browser page.
 *
 * @remarks
 * - `url` — navigate to this URL immediately after creation
 * - `viewport` — override the context-level default viewport
 * - `timeout` — navigation timeout for the initial URL
 */
export interface BrowserPageOptions {
	readonly url?: string
	readonly viewport?: BrowserViewport
	readonly timeout?: number
}

/**
 * Describes the options for page navigation.
 *
 * @remarks
 * - `condition` — page load condition to wait for (default `'load'`)
 * - `timeout` — bounds the whole navigate call (the `Page.navigate` send
 *   itself plus the load-event wait), in milliseconds
 */
export interface BrowserNavigationOptions {
	readonly condition?: BrowserWaitUntil
	readonly timeout?: number
}

/** Describes the outcome of a top-level navigation command. */
export interface BrowserNavigationResult {
	readonly url: string
	readonly response: BrowserResponse | undefined
	readonly same: boolean
}

/** Holds the state retained while correlating navigation with Network events. */
export interface BrowserNavigationWatch {
	readonly responses: readonly BrowserResponse[]
}

/** Represents one pending URL-pattern wait. */
export interface BrowserNavigationWait {
	readonly pattern: string
	readonly timer: ReturnType<typeof setTimeout>
	readonly resolve: (url: string) => void
	readonly reject: (error: unknown) => void
}

/** Describes the options for URL and predicate waits. */
export interface BrowserNavigationWaitOptions {
	readonly timeout?: number
}

/** Provides URL and in-page predicate waits associated with one page. */
export interface BrowserNavigationManagerInterface {
	wait(pattern: string, options?: BrowserNavigationWaitOptions): Promise<string>
	until(expression: string, options?: BrowserNavigationWaitOptions): Promise<unknown>
}

/**
 * Describes the options for element interaction (click, fill, select, wait).
 *
 * @remarks
 * - `timeout` — maximum time to wait for the selector in milliseconds
 * - `strict` — require the selector to resolve to exactly one element
 * - `force` — skip the actionability checks
 * - `trial` — run the checks and stop before dispatching input
 */
export interface BrowserActionOptions {
	readonly timeout?: number
	readonly strict?: boolean
	readonly force?: boolean
	readonly trial?: boolean
}

/**
 * Describes the options shared by every trusted input operation.
 *
 * @remarks
 * - `delay` — milliseconds between the transitions the operation dispatches
 */
export interface BrowserInputOptions {
	readonly delay?: number
}

/**
 * Describes the options for a trusted mouse click.
 *
 * @remarks
 * - `button` — pressed mouse button (default `'left'`)
 * - `count` — click count reported to the page (default `1`)
 */
export interface BrowserClickOptions extends BrowserInputOptions {
	readonly button?: BrowserMouseButton
	readonly count?: number
}

/**
 * Describes the options for a trusted mouse drag.
 *
 * @remarks
 * - `button` — pressed mouse button (default `'left'`)
 * - `steps` — interpolated move events between start and end (default `10`)
 */
export interface BrowserDragOptions extends BrowserInputOptions {
	readonly button?: BrowserMouseButton
	readonly steps?: number
}

/**
 * Describes the options for a locator operation that aims at a point inside the element.
 *
 * @remarks
 * - `position` — offset from the element's top-left corner, in CSS pixels
 */
export interface BrowserPointerOptions extends BrowserActionOptions {
	readonly position?: BrowserPoint
}

/** Describes the options for a locator click, combining element resolution with mouse input. */
export interface BrowserLocatorClickOptions extends BrowserPointerOptions, BrowserClickOptions {}

/** Describes the options for a locator drag, combining element resolution with mouse input. */
export interface BrowserLocatorDragOptions extends BrowserPointerOptions, BrowserDragOptions {}

/** Describes the options for locator keyboard entry, combining element resolution with key input. */
export interface BrowserLocatorTypeOptions extends BrowserActionOptions, BrowserInputOptions {}

/** Names an element state a frame or page can wait for. */
export type BrowserWaitState = 'attached' | 'detached' | 'visible' | 'hidden'

/**
 * Describes the options for waiting on an element.
 *
 * @remarks
 * - `timeout` — maximum time to wait in milliseconds
 * - `strict` — require the selector to resolve to exactly one element
 * - `state` — target state (default `'attached'`)
 */
export interface BrowserWaitOptions extends BrowserActionOptions {
	readonly state?: BrowserWaitState
}

/**
 * Describes the options for taking a page screenshot.
 *
 * @remarks
 * - `path` — file path to persist the screenshot to, via the page's writer
 * - `full` — capture the full scrollable page (default `false`)
 * - `format` — image format (default `'png'`)
 * - `quality` — JPEG quality 0–100 (ignored for PNG)
 */
export interface BrowserScreenshotOptions {
	readonly path?: string
	readonly full?: boolean
	readonly format?: 'png' | 'jpeg'
	readonly quality?: number
	readonly clip?: BrowserRect
	readonly transparent?: boolean
	readonly animations?: boolean
	readonly caret?: boolean
	readonly scale?: BrowserScreenshotScale
	readonly mask?: readonly BrowserLocatorInterface[]
	readonly color?: string
}

/**
 * Describes the result of page content extraction.
 *
 * @remarks
 * - `url` — current page URL after navigation
 * - `title` — document title
 * - `html` — full HTML source
 * - `text` — visible text content (no markup)
 */
export interface BrowserContentResult {
	readonly url: string
	readonly title: string
	readonly html: string
	readonly text: string
}

/**
 * Describes the result of a page screenshot.
 *
 * @remarks
 * - `bytes` — raw image bytes
 * - `path` — file path if persisted via the page's writer, otherwise undefined
 */
export interface BrowserScreenshotResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

/** Runs one teardown step to settlement while the first failure is retained. */
export type BrowserTeardownFunction = () => Promise<unknown>

// === Browser handles

/**
 * Represents a remote JavaScript object retained in one frame execution context.
 */
export interface BrowserHandleInterface {
	readonly id: string
	value(): Promise<unknown>
	call(declaration: string, args?: readonly unknown[]): Promise<unknown>
	property(name: string): Promise<BrowserHandleInterface | undefined>
	properties(): Promise<Readonly<Record<string, unknown>>>
	dispose(): Promise<void>
}

/** Runs a host function exposed into page JavaScript. */
export type BrowserBindingHandler = (...args: unknown[]) => unknown | Promise<unknown>

/** Describes a decoded page-to-host binding call. */
export interface BrowserBindingCall {
	readonly id: string
	readonly name: string
	readonly args: readonly unknown[]
	readonly context: number
}

/** Manages initialization scripts and host bindings for one page. */
export interface BrowserScriptManagerInterface {
	add(source: string): Promise<string>
	remove(id: string): Promise<void>
	expose(name: string, handler: BrowserBindingHandler): Promise<void>
	revoke(name: string): Promise<void>
	destroy(): Promise<void>
}

/** Represents one installed new-document script and its optional host binding owner. */
export interface BrowserScriptEntry {
	readonly source: string
	readonly binding: string | undefined
}

// === Browser accessibility

/** Represents one decoded Chromium accessibility node. */
export interface BrowserAXNode {
	readonly id: string
	readonly parent: string | undefined
	readonly children: readonly string[]
	readonly backend: number | undefined
	readonly frame: string | undefined
	readonly ignored: boolean
	readonly role: string | undefined
	readonly name: string | undefined
	readonly description: string | undefined
	readonly value: unknown
	readonly properties: Readonly<Record<string, unknown>>
}

/** Describes a serializable accessibility-tree snapshot. */
export interface BrowserAccessibilitySnapshot {
	readonly roots: readonly string[]
	readonly nodes: readonly BrowserAXNode[]
}

/** Describes the options for an accessibility snapshot. */
export interface BrowserAccessibilityOptions {
	readonly root?: number
	readonly depth?: number
}

/** Inspects the accessibility tree. */
export interface BrowserAccessibilityInterface {
	snapshot(options?: BrowserAccessibilityOptions): Promise<BrowserAccessibilitySnapshot>
}

// === Browser diagnostics

/** Describes the options for a Chromium trace capture. */
export interface BrowserTracingOptions {
	readonly path?: string
	readonly categories?: readonly string[]
	readonly screenshots?: boolean
	readonly sampling?: boolean
}

/** Describes the result of a trace capture. */
export interface BrowserTracingResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

/** Represents one decoded IO stream read. */
export interface BrowserStreamChunk {
	readonly bytes: Uint8Array
	readonly eof: boolean
}

/** Drives the trace capture lifecycle. */
export interface BrowserTracingInterface {
	readonly active: boolean
	start(options?: BrowserTracingOptions): Promise<void>
	stop(): Promise<BrowserTracingResult>
	destroy(): Promise<void>
}

/** Describes a source range reported by JavaScript or CSS coverage. */
export interface BrowserCoverageRange {
	readonly start: number
	readonly end: number
	readonly count: number
}

/** Describes function coverage inside one script. */
export interface BrowserFunctionCoverage {
	readonly name: string
	readonly ranges: readonly BrowserCoverageRange[]
	readonly block: boolean
}

/** Describes JavaScript script coverage. */
export interface BrowserScriptCoverage {
	readonly id: string
	readonly url: string
	readonly functions: readonly BrowserFunctionCoverage[]
}

/** Describes CSS stylesheet coverage. */
export interface BrowserStyleCoverage {
	readonly id: string
	readonly ranges: readonly BrowserCoverageRange[]
}

/** Describes the options for a coverage capture. */
export interface BrowserCoverageOptions {
	readonly javascript?: boolean
	readonly css?: boolean
	readonly detailed?: boolean
}

/** Describes combined JavaScript and CSS usage. */
export interface BrowserCoverageResult {
	readonly scripts: readonly BrowserScriptCoverage[]
	readonly styles: readonly BrowserStyleCoverage[]
}

/** Drives the coverage capture lifecycle. */
export interface BrowserCoverageInterface {
	readonly active: boolean
	start(options?: BrowserCoverageOptions): Promise<void>
	stop(): Promise<BrowserCoverageResult>
	destroy(): Promise<void>
}

/** Represents one Performance-domain metric. */
export interface BrowserMetric {
	readonly name: string
	readonly value: number
}

/** Describes a JavaScript call frame from a CPU profile. */
export interface BrowserProfileFrame {
	readonly function: string
	readonly script: string
	readonly url: string
	readonly line: number
	readonly column: number
}

/** Represents one node in a sampled CPU profile. */
export interface BrowserProfileNode {
	readonly id: number
	readonly frame: BrowserProfileFrame
	readonly hit: number | undefined
	readonly children: readonly number[]
}

/** Describes a sampled CPU profile. */
export interface BrowserProfile {
	readonly start: number
	readonly end: number
	readonly nodes: readonly BrowserProfileNode[]
	readonly samples: readonly number[]
	readonly deltas: readonly number[]
}

/**
 * Reads Performance-domain metrics.
 *
 * @remarks
 * Each call enables the Performance domain and disables it again, so the
 * reader holds no protocol state and needs no teardown. Sampled CPU profiling
 * is {@link BrowserProfilerInterface}, its peer under `diagnostics`.
 */
export interface BrowserPerformanceInterface {
	metrics(): Promise<readonly BrowserMetric[]>
}

/** Drives the sampled CPU profile lifecycle. */
export interface BrowserProfilerInterface {
	readonly active: boolean
	start(interval?: number): Promise<void>
	stop(): Promise<BrowserProfile>
	destroy(): Promise<void>
}

/** Groups the diagnostics by capability. */
export interface BrowserDiagnosticsInterface {
	readonly tracing: BrowserTracingInterface
	readonly coverage: BrowserCoverageInterface
	readonly performance: BrowserPerformanceInterface
	readonly profiler: BrowserProfilerInterface
	destroy(): Promise<void>
}

// === Browser clock

/** Controls Chromium virtual time for deterministic page timers. */
export interface BrowserClockInterface {
	readonly installed: boolean
	install(time?: number): Promise<void>
	pause(): Promise<void>
	resume(): Promise<void>
	advance(ms: number): Promise<void>
	uninstall(): Promise<void>
}

// === Browser selectors and locators

/**
 * Names a selector axis supported by {@link BrowserSelectorManagerInterface}.
 *
 * @remarks
 * `testId` mirrors the `data-testid` attribute {@link BROWSER_TEST_ID_ATTRIBUTE} names.
 */
export type BrowserSelector = 'css' | 'role' | 'text' | 'label' | 'placeholder' | 'testId'

/** Describes a declarative locator filter applied after selector resolution. */
export interface BrowserLocatorFilter {
	readonly text?: string
	readonly exact?: boolean
	readonly visible?: boolean
}

/** Describes a serializable selector query, including optional ancestry and filtering. */
export interface BrowserQuery {
	readonly selector: BrowserSelector
	readonly value: string
	readonly name?: string
	readonly exact?: boolean
	readonly parent?: BrowserQuery
	readonly filter?: BrowserLocatorFilter
	readonly index?: number
}

/** Describes the options for role-based locator creation. */
export interface BrowserRoleOptions {
	readonly name?: string
	readonly exact?: boolean
}

/** Describes the options for text-like locator creation. */
export interface BrowserTextOptions {
	readonly exact?: boolean
}

/** Describes the options for setting files on a file input. */
export interface BrowserUploadOptions extends BrowserActionOptions {
	readonly files: readonly string[]
}

/**
 * Represents a reusable strict locator over one frame.
 */
export interface BrowserLocatorInterface {
	readonly frame: BrowserFrameInterface
	readonly query: BrowserQuery
	locator(selector: string): BrowserLocatorInterface
	filter(options: BrowserLocatorFilter): BrowserLocatorInterface
	first(): BrowserLocatorInterface
	last(): BrowserLocatorInterface
	item(index: number): BrowserLocatorInterface
	count(): Promise<number>
	all(): Promise<readonly BrowserLocatorInterface[]>
	click(options?: BrowserLocatorClickOptions): Promise<void>
	fill(value: string, options?: BrowserActionOptions): Promise<void>
	select(values: readonly string[], options?: BrowserActionOptions): Promise<void>
	check(options?: BrowserLocatorClickOptions): Promise<void>
	uncheck(options?: BrowserLocatorClickOptions): Promise<void>
	hover(options?: BrowserPointerOptions): Promise<void>
	focus(options?: BrowserActionOptions): Promise<void>
	press(key: string, options?: BrowserLocatorTypeOptions): Promise<void>
	type(value: string, options?: BrowserLocatorTypeOptions): Promise<void>
	clear(options?: BrowserActionOptions): Promise<void>
	wait(options?: BrowserWaitOptions): Promise<void>
	text(): Promise<string>
	texts(): Promise<readonly string[]>
	html(): Promise<string>
	value(): Promise<string>
	attribute(name: string): Promise<string | undefined>
	visible(): Promise<boolean>
	enabled(): Promise<boolean>
	editable(): Promise<boolean>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	upload(options: BrowserUploadOptions): Promise<void>
	drag(target: BrowserLocatorInterface, options?: BrowserLocatorDragOptions): Promise<void>
}

/**
 * Groups the locator factories by selector semantics.
 */
export interface BrowserSelectorManagerInterface {
	css(value: string): BrowserLocatorInterface
	role(value: string, options?: BrowserRoleOptions): BrowserLocatorInterface
	text(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	label(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	placeholder(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	testId(value: string): BrowserLocatorInterface
}

// === Browser input

/** Describes a point in viewport CSS pixels. */
export interface BrowserPoint {
	readonly x: number
	readonly y: number
}

/** Names a mouse button understood by Chromium's Input domain. */
export type BrowserMouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward'

/** Names a screenshot coordinate scale. */
export type BrowserScreenshotScale = 'css' | 'device'

/** Describes normalized CDP keyboard key data. */
export interface BrowserKey {
	readonly key: string
	readonly code: string
	readonly text: string | undefined
	readonly number: number
}

/** Describes a parsed keyboard chord. */
export interface BrowserChord {
	readonly modifiers: readonly string[]
	readonly key: string
}

/**
 * Collects every option a trusted-input operation can carry.
 *
 * @remarks
 * The intersection of each option type that carries a bounded key, so one
 * validator answers for a locator click, a locator drag, a mouse click, a
 * mouse drag, and keyboard entry alike.
 */
export type BrowserOperationOptions = BrowserPointerOptions &
	BrowserClickOptions &
	BrowserDragOptions

/** Provides keyboard input operations bound to one frame target session. */
export interface BrowserKeyboardInterface {
	down(key: string): Promise<void>
	up(key: string): Promise<void>
	press(key: string, options?: BrowserInputOptions): Promise<void>
	type(value: string, options?: BrowserInputOptions): Promise<void>
	insert(value: string): Promise<void>
}

/** Provides mouse input operations bound to one frame target session. */
export interface BrowserMouseInterface {
	move(point: BrowserPoint): Promise<void>
	down(button?: BrowserMouseButton, count?: number): Promise<void>
	up(button?: BrowserMouseButton, count?: number): Promise<void>
	click(point: BrowserPoint, options?: BrowserClickOptions): Promise<void>
	drag(start: BrowserPoint, end: BrowserPoint, options?: BrowserDragOptions): Promise<void>
	wheel(delta: BrowserPoint): Promise<void>
}

/** Provides touch input operations bound to one frame target session. */
export interface BrowserTouchInterface {
	tap(point: BrowserPoint): Promise<void>
}

/** Describes the actionability checks performed before locator input. */
export interface BrowserActionabilityOptions {
	readonly visible?: boolean
	readonly stable?: boolean
	readonly events?: boolean
	readonly enabled?: boolean
	readonly editable?: boolean
	readonly position?: BrowserPoint
}

/** Describes a decoded content quad and its actionable center. */
export interface BrowserQuad {
	readonly points: readonly [number, number, number, number, number, number, number, number]
	readonly center: BrowserPoint
}

// === Browser PDF

/** Describes the paper margin lengths accepted by Chromium print-to-PDF. */
export interface BrowserMargin {
	readonly top?: number
	readonly right?: number
	readonly bottom?: number
	readonly left?: number
}

/** Describes the options for printing a Chromium page to PDF. */
export interface BrowserPDFOptions {
	readonly path?: string
	readonly landscape?: boolean
	readonly background?: boolean
	readonly scale?: number
	readonly width?: number
	readonly height?: number
	readonly margin?: BrowserMargin
	readonly ranges?: string
	readonly header?: string
	readonly footer?: string
	readonly tagged?: boolean
	readonly outline?: boolean
}

/** Describes the result of printing a page to PDF. */
export interface BrowserPDFResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

// === Browser page events

/** Names a JavaScript dialog category reported by Chromium. */
export type BrowserDialogCategory = 'alert' | 'confirm' | 'prompt' | 'beforeunload'

/** Represents one active JavaScript dialog. */
export interface BrowserDialogInterface {
	readonly category: BrowserDialogCategory
	readonly message: string
	readonly default: string
	accept(value?: string): Promise<void>
	dismiss(): Promise<void>
}

/** Represents one intercepted file chooser. */
export interface BrowserFileChooserInterface {
	readonly multiple: boolean
	upload(files: readonly string[]): Promise<void>
	cancel(): Promise<void>
}

/** Names a download lifecycle phase. */
export type BrowserDownloadStatus = 'pending' | 'complete' | 'cancelled'

/** Maps the download progress events. */
export type BrowserDownloadEventMap = {
	readonly progress: readonly [received: number, total: number]
	readonly complete: readonly [path: string | undefined]
	readonly cancel: readonly []
}

/** Describes a protocol-neutral download progress update. */
export interface BrowserDownloadProgress {
	readonly status: BrowserDownloadStatus
	readonly received: number
	readonly total: number
	readonly path?: string
}

/** Describes a decoded `Browser.downloadWillBegin` event. */
export interface BrowserDownloadStart {
	readonly id: string
	readonly url: string
	readonly name: string
	readonly frame: string
}

/**
 * Represents one context download tracked through Chromium's Browser domain.
 *
 * @remarks
 * Progress arrives from the owning page, which drives the concrete
 * `BrowserDownload`. `update` is on this contract because the class exposes
 * exactly its interface methods.
 */
export interface BrowserDownloadInterface {
	readonly emitter: EmitterInterface<BrowserDownloadEventMap>
	readonly id: string
	readonly url: string
	readonly name: string
	readonly status: BrowserDownloadStatus
	readonly received: number
	readonly total: number
	readonly path: string | undefined
	cancel(): Promise<void>
	/** Records one step of the download's progress. The owning page drives it. */
	update(progress: BrowserDownloadProgress): void
}

/** Represents one console API call. */
export interface BrowserConsoleMessage {
	readonly level: string
	readonly text: string
	readonly values: readonly unknown[]
	readonly timestamp: number
	readonly stack: readonly BrowserStackFrame[]
}

/** Represents one browser-side stack frame. */
export interface BrowserStackFrame {
	readonly url: string
	readonly function: string
	readonly line: number
	readonly column: number
}

/** Represents one uncaught page exception. */
export interface BrowserPageError {
	readonly message: string
	readonly stack: readonly BrowserStackFrame[]
	readonly timestamp: number
}

/** Names a worker target category. */
export type BrowserWorkerCategory = 'worker' | 'service_worker' | 'shared_worker'

/** Represents a script worker attached to a page target. */
export interface BrowserWorkerInterface {
	readonly id: string
	readonly url: string
	readonly category: BrowserWorkerCategory
	evaluate(expression: string, timeout?: number): Promise<unknown>
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
	detach(): void
	close(): Promise<void>
}

/** Maps the typed page, frame, target, and user-visible browser events. */
export type BrowserPageEventMap = {
	readonly navigate: readonly [url: string]
	readonly attach: readonly [frame: BrowserFrameInterface]
	readonly detach: readonly [frame: string]
	readonly popup: readonly [page: BrowserPageInterface]
	readonly dialog: readonly [dialog: BrowserDialogInterface]
	readonly chooser: readonly [chooser: BrowserFileChooserInterface]
	readonly download: readonly [download: BrowserDownloadInterface]
	readonly console: readonly [message: BrowserConsoleMessage]
	readonly error: readonly [error: BrowserPageError]
	readonly crash: readonly []
	readonly worker: readonly [worker: BrowserWorkerInterface]
	readonly request: readonly [request: BrowserRequest]
	readonly response: readonly [response: BrowserResponse]
	readonly failure: readonly [failure: BrowserRequestFailure]
	readonly socket: readonly [socket: BrowserWebSocketInterface]
	readonly close: readonly []
}

// === Browser network

/** Represents one observed browser request. */
export interface BrowserRequest {
	readonly id: string
	readonly loader: string | undefined
	readonly frame: string | undefined
	readonly url: string
	readonly method: string
	readonly headers: Readonly<Record<string, string>>
	readonly post: string | undefined
	readonly resource: string | undefined
	readonly timestamp: number | undefined
	readonly walltime: number | undefined
	readonly redirect: BrowserResponse | undefined
}

/** Describes the TLS details supplied with a browser response. */
export interface BrowserSecurity {
	readonly protocol: string
	readonly issuer: string
	readonly from: number
	readonly to: number
}

/** Describes the start/end pair for one network timing phase. */
export interface BrowserTimingRange {
	readonly start: number
	readonly end: number
}

/** Holds network timing values in milliseconds relative to request time. */
export interface BrowserTiming {
	readonly request: number
	readonly proxy: BrowserTimingRange | undefined
	readonly dns: BrowserTimingRange | undefined
	readonly connect: BrowserTimingRange | undefined
	readonly ssl: BrowserTimingRange | undefined
	readonly send: BrowserTimingRange | undefined
	readonly receive: number | undefined
}

/** Represents one observed browser response. */
export interface BrowserResponse {
	readonly id: string
	readonly loader: string
	readonly frame: string | undefined
	readonly url: string
	readonly status: number
	readonly phrase: string
	readonly headers: Readonly<Record<string, string>>
	readonly mime: string
	readonly protocol: string
	readonly address: string | undefined
	readonly port: number | undefined
	readonly cached: boolean
	readonly worker: boolean
	readonly timestamp: number
	readonly timing: BrowserTiming | undefined
	readonly security: BrowserSecurity | undefined
}

/** Represents one failed browser request. */
export interface BrowserRequestFailure {
	readonly id: string
	readonly error: string
	readonly cancelled: boolean
	readonly blocked: string | undefined
}

/** Describes a WebSocket frame payload. */
export interface BrowserWebSocketFrame {
	readonly opcode: number
	readonly data: string
	readonly masked: boolean
	readonly timestamp: number
}

/** Maps the WebSocket lifecycle events. */
export type BrowserWebSocketEventMap = {
	readonly receive: readonly [frame: BrowserWebSocketFrame]
	readonly transmit: readonly [frame: BrowserWebSocketFrame]
	readonly error: readonly [message: string]
	readonly close: readonly [timestamp: number]
}

/**
 * Represents one observed WebSocket connection.
 *
 * @remarks
 * The connection is an observation: a page's network manager reconstructs it
 * from Network-domain events and drives the concrete `BrowserWebSocket`. The
 * drive methods are on this contract because the class exposes exactly its
 * interface methods.
 */
export interface BrowserWebSocketInterface {
	readonly emitter: EmitterInterface<BrowserWebSocketEventMap>
	readonly id: string
	readonly url: string
	/** Reports one received frame. The page's network manager drives it. */
	receive(frame: BrowserWebSocketFrame): void
	/** Reports one sent frame. The page's network manager drives it. */
	transmit(frame: BrowserWebSocketFrame): void
	/** Reports a connection fault. The page's network manager drives it. */
	fail(message: string): void
	/** Reports the connection closing and destroys the emitter. The page's network manager drives it. */
	close(timestamp: number): void
}

/** Maps the network events a page's network manager emits. */
export type BrowserNetworkEventMap = {
	readonly request: readonly [request: BrowserRequest]
	readonly response: readonly [response: BrowserResponse]
	readonly failure: readonly [failure: BrowserRequestFailure]
	readonly finish: readonly [id: string]
	readonly socket: readonly [socket: BrowserWebSocketInterface]
}

/** Describes route matching criteria. Omitted fields match all values. */
export interface BrowserRouteQuery {
	readonly url?: string
	readonly method?: string
	readonly resource?: string
}

/** Describes the overrides supplied when continuing an intercepted request. */
export interface BrowserRouteContinueOptions {
	readonly url?: string
	readonly method?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly post?: string
}

/** Describes the synthetic response supplied when fulfilling an intercepted request. */
export interface BrowserRouteFulfillOptions {
	readonly status?: number
	readonly phrase?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly body?: string | Uint8Array
}

/** Represents one paused Fetch-domain request. */
export interface BrowserRouteInterface {
	readonly id: string
	readonly request: BrowserRequest
	readonly handled: boolean
	abort(reason?: string): Promise<void>
	continue(options?: BrowserRouteContinueOptions): Promise<void>
	fulfill(options: BrowserRouteFulfillOptions): Promise<void>
}

/** Runs for a matching intercepted request. */
export type BrowserRouteHandler = (route: BrowserRouteInterface) => void | Promise<void>

/** Represents one installed network route. */
export interface BrowserRouteDefinition {
	readonly query: BrowserRouteQuery
	readonly handler: BrowserRouteHandler
}

/** Describes the options for a HAR recording. */
export interface BrowserHAROptions {
	readonly path?: string
	readonly content?: boolean
}

/** Represents one name/value pair in an HTTP archive. */
export interface BrowserHARValue {
	readonly name: string
	readonly value: string
}

/**
 * Represents one cookie in an HTTP archive.
 *
 * @remarks
 * HAR data preserves the official HAR 1.2 JSON field names. These compound
 * properties are external wire-schema keys, so archives remain interoperable
 * without a lossy projection layer.
 */
export interface BrowserHARCookie extends BrowserHARValue {
	readonly path?: string
	readonly domain?: string
	readonly expires?: string
	readonly httpOnly?: boolean
	readonly secure?: boolean
}

/** Describes request body metadata in an HTTP archive. */
export interface BrowserHARPost {
	readonly mimeType: string
	readonly text: string
}

/** Describes response body metadata in an HTTP archive. */
export interface BrowserHARContent {
	readonly size: number
	readonly mimeType: string
	readonly text?: string
	readonly encoding?: 'base64'
}

/** Describes a HAR 1.2 request entry. */
export interface BrowserHARRequest {
	readonly method: string
	readonly url: string
	readonly httpVersion: string
	readonly cookies: readonly BrowserHARCookie[]
	readonly headers: readonly BrowserHARValue[]
	readonly queryString: readonly BrowserHARValue[]
	readonly postData?: BrowserHARPost
	readonly headersSize: number
	readonly bodySize: number
}

/** Describes a HAR 1.2 response entry. */
export interface BrowserHARResponse {
	readonly status: number
	readonly statusText: string
	readonly httpVersion: string
	readonly cookies: readonly BrowserHARCookie[]
	readonly headers: readonly BrowserHARValue[]
	readonly content: BrowserHARContent
	readonly redirectURL: string
	readonly headersSize: number
	readonly bodySize: number
}

/** Holds HAR 1.2 phase timings in milliseconds. */
export interface BrowserHARTimings {
	readonly blocked: number
	readonly dns: number
	readonly connect: number
	readonly send: number
	readonly wait: number
	readonly receive: number
	readonly ssl: number
}

/** Represents one completed HTTP exchange in a HAR recording. */
export interface BrowserHAREntry {
	readonly startedDateTime: string
	readonly time: number
	readonly request: BrowserHARRequest
	readonly response: BrowserHARResponse
	readonly cache: Readonly<Record<string, unknown>>
	readonly timings: BrowserHARTimings
}

/** Holds recording state until a request finishes; a new value replaces it on each update. */
export interface BrowserHARPending {
	readonly request: BrowserRequest
	readonly started: number
	readonly response: BrowserResponse | undefined
}

/** Describes the tool identity embedded in an HTTP archive. */
export interface BrowserHARCreator {
	readonly name: string
	readonly version: string
}

/** Describes the HAR 1.2 log object. */
export interface BrowserHARLog {
	readonly version: '1.2'
	readonly creator: BrowserHARCreator
	readonly entries: readonly BrowserHAREntry[]
}

/** Describes the standards-shaped HAR 1.2 document produced by the network manager. */
export interface BrowserHAR {
	readonly log: BrowserHARLog
}

/** Describes HAR replay behavior. */
export interface BrowserHARReplayOptions {
	readonly fallback?: boolean
}

/** Provides HAR recording and replay operations. */
export interface BrowserHARManagerInterface {
	readonly recording: boolean
	start(options?: BrowserHAROptions): Promise<void>
	stop(): Promise<BrowserHAR>
	replay(har: BrowserHAR, options?: BrowserHARReplayOptions): Promise<void>
	clear(): Promise<void>
}

/** Provides page-scoped network observation and interception. */
export interface BrowserNetworkManagerInterface {
	readonly emitter: EmitterInterface<BrowserNetworkEventMap>
	readonly har: BrowserHARManagerInterface
	start(): Promise<void>
	body(id: string): Promise<Uint8Array>
	text(id: string): Promise<string>
	json(id: string): Promise<unknown>
	route(query: BrowserRouteQuery, handler: BrowserRouteHandler): Promise<void>
	unroute(handler?: BrowserRouteHandler): Promise<void>
	headers(headers: Readonly<Record<string, string>>): Promise<void>
	offline(offline: boolean): Promise<void>
	credentials(credentials?: BrowserCredentials): Promise<void>
	destroy(): Promise<void>
}

// === Browser context state

/** Names a cookie same-site policy understood by Chromium. */
export type BrowserSameSite = 'Strict' | 'Lax' | 'None'

/** Describes a cookie partition key used by CHIPS-partitioned cookies. */
export interface BrowserCookiePartition {
	readonly site: string
	readonly ancestor?: boolean
}

/** Represents one cookie returned from a browser context. */
export interface BrowserCookie {
	readonly name: string
	readonly value: string
	readonly domain: string
	readonly path: string
	readonly expires: number
	readonly http: boolean
	readonly secure: boolean
	readonly site: BrowserSameSite | undefined
	readonly partition: BrowserCookiePartition | undefined
}

/** Describes the input used to create or replace a browser cookie. */
export interface BrowserCookieInput {
	readonly name: string
	readonly value: string
	readonly url?: string
	readonly domain?: string
	readonly path?: string
	readonly expires?: number
	readonly http?: boolean
	readonly secure?: boolean
	readonly site?: BrowserSameSite
	readonly priority?: 'Low' | 'Medium' | 'High'
	readonly partition?: BrowserCookiePartition
}

/** Describes optional narrowing criteria for clearing context cookies. */
export interface BrowserCookieFilter {
	readonly name?: string
	readonly domain?: string
	readonly path?: string
}

/** Provides cookie operations scoped to one browser context. */
export interface BrowserCookieManagerInterface {
	cookies(urls?: readonly string[]): Promise<readonly BrowserCookie[]>
	set(cookies: readonly BrowserCookieInput[]): Promise<void>
	clear(filter?: BrowserCookieFilter): Promise<void>
}

/** Provides permission override operations scoped to one browser context. */
export interface BrowserPermissionManagerInterface {
	grant(permissions: readonly string[], origin?: string): Promise<void>
	deny(permissions: readonly string[], origin?: string): Promise<void>
	clear(): Promise<void>
}

/** Represents one key/value pair from web storage. */
export interface BrowserStorageEntry {
	readonly name: string
	readonly value: string
}

/** Describes an origin-scoped local and session storage snapshot. */
export interface BrowserStorageOrigin {
	readonly origin: string
	readonly local: readonly BrowserStorageEntry[]
	readonly session: readonly BrowserStorageEntry[]
}

/** Describes a portable browser authentication and storage snapshot. */
export interface BrowserStorageState {
	readonly cookies: readonly BrowserCookieInput[]
	readonly origins: readonly BrowserStorageOrigin[]
}

/** Describes the options for collecting storage state from selected origins. */
export interface BrowserStorageOptions {
	readonly origins?: readonly string[]
}

/** Provides storage-state import, export, and clearing operations. */
export interface BrowserStorageManagerInterface {
	state(options?: BrowserStorageOptions): Promise<BrowserStorageState>
	restore(state: BrowserStorageState): Promise<void>
	clear(origin?: string): Promise<void>
}

/** Describes the HTTP basic-auth credentials applied to context pages. */
export interface BrowserCredentials {
	readonly username: string
	readonly password: string
}

/** Describes a geographic location override. */
export interface BrowserGeolocation {
	readonly latitude: number
	readonly longitude: number
	readonly accuracy?: number
}

/**
 * Describes browser color and media feature overrides.
 *
 * @remarks
 * - `output` — emulated output medium, mirroring the CSS `media` type
 * - `scheme` — emulated `prefers-color-scheme` value
 * - `contrast` — emulated `prefers-contrast` value
 * - `motion` — emulated `prefers-reduced-motion` value
 * - `colors` — emulated `forced-colors` value, keeping the CSS feature's word
 */
export interface BrowserMedia {
	readonly output?: 'screen' | 'print'
	readonly scheme?: 'light' | 'dark' | 'no-preference'
	readonly contrast?: 'more' | 'less' | 'no-preference'
	readonly motion?: 'reduce' | 'no-preference'
	readonly colors?: 'active' | 'none'
}

/** Describes user-agent metadata accepted by Chromium emulation. */
export interface BrowserUserAgent {
	readonly value: string
	readonly language?: string
	readonly platform?: string
}

/** Describes network and rendering overrides inherited by context pages. */
export interface BrowserEmulationOptions {
	readonly viewport?: BrowserViewport
	readonly user?: BrowserUserAgent
	readonly locale?: string
	readonly timezone?: string
	readonly geolocation?: BrowserGeolocation
	readonly media?: BrowserMedia
	readonly offline?: boolean
	readonly headers?: Readonly<Record<string, string>>
	readonly credentials?: BrowserCredentials
}

/** Returns the context's live pages at call time. */
export type BrowserPagesFunction = () => readonly BrowserPageInterface[]

/** Configures context-scoped emulation. */
export interface BrowserEmulationManagerInterface {
	apply(options: BrowserEmulationOptions): Promise<void>
	clear(): Promise<void>
	attach(page: BrowserPageInterface): Promise<void>
}

/** Describes proxy settings used when creating an isolated browser context. */
export interface BrowserProxy {
	readonly server: string
	readonly bypass?: readonly string[]
}

/** Describes the download policy for a browser context. */
export interface BrowserDownloadOptions {
	readonly path: string
	readonly named?: boolean
}

/** Describes the options for creating and configuring an isolated browser context. */
export interface BrowserContextOptions {
	readonly proxy?: BrowserProxy
	readonly origins?: readonly string[]
	readonly downloads?: BrowserDownloadOptions
	readonly emulation?: BrowserEmulationOptions
}

/** Maps the browser-context lifecycle events. */
export type BrowserContextEventMap = {
	readonly page: readonly [page: BrowserPageInterface]
	readonly close: readonly []
}

// === Browser codegen

/** Represents one recorded browser action captured during a codegen session. */
export type BrowserCodegenAction =
	| { readonly action: 'navigate'; readonly url: string }
	| { readonly action: 'click'; readonly selector: string }
	| { readonly action: 'fill'; readonly selector: string; readonly value: string }
	| { readonly action: 'select'; readonly selector: string; readonly values: readonly string[] }

/**
 * Maps the events a {@link BrowserCodegenInterface} emits.
 *
 * @remarks
 * - `start` — recording started
 * - `stop` — recording stopped, carrying the final action list
 * - `action` — one new action was captured
 * - `clear` — recorded actions were reset
 */
export type BrowserCodegenEventMap = {
	readonly start: readonly []
	readonly stop: readonly [actions: readonly BrowserCodegenAction[]]
	readonly action: readonly [action: BrowserCodegenAction]
	readonly clear: readonly []
}

/**
 * Describes the options for creating a BrowserCodegen recorder.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 */
export interface BrowserCodegenOptions {
	readonly on?: EmitterHooks<BrowserCodegenEventMap>
	readonly error?: EmitterErrorHandler
}

/** Names the target language for a compiled codegen script. */
export type BrowserCodegenLanguage = 'javascript' | 'typescript'

/**
 * Describes the options for compiling recorded actions into a script.
 *
 * @remarks
 * - `language` — target output language (default `'javascript'`)
 */
export interface BrowserCodegenScriptOptions {
	readonly language?: BrowserCodegenLanguage
}

/**
 * Records page interactions (navigation, click, fill, select) as a session
 * runs, for later compilation into a replayable script.
 *
 * @remarks
 * - `emitter` — subscribe to recording lifecycle and capture events
 * - `started` — true while actively recording
 * - `start` — begin recording on the page's session
 * - `stop` — stop recording and return the captured actions
 * - `actions` — current normalized action list
 * - `script` — compile the captured actions into a script
 * - `clear` — reset the captured action list
 * - `destroy` — tear down the recorder and detach CDP listeners
 */
export interface BrowserCodegenInterface {
	readonly emitter: EmitterInterface<BrowserCodegenEventMap>
	readonly started: boolean
	start(): Promise<void>
	stop(): Promise<readonly BrowserCodegenAction[]>
	actions(): readonly BrowserCodegenAction[]
	script(options?: BrowserCodegenScriptOptions): string
	clear(): void
	destroy(): Promise<void>
}

// === Browser frame

/** Resolves the current CDP session for a frame id. */
export type BrowserSessionFunction = (frame: string) => Promise<string>

/**
 * Describes the options for one raw CDP method call issued in a frame's target session.
 *
 * @remarks
 * The frame supplies its own session, so a caller bounds the call and nothing
 * else.
 *
 * - `timeout` — ms before this one request fails, overriding the client-wide default
 */
export interface BrowserSendOptions {
	readonly timeout?: number
}

/**
 * Describes serializable frame metadata decoded from CDP `Page.getFrameTree`.
 *
 * @remarks
 * - `id` — the frame's CDP frame id
 * - `parent` — the parent frame's id, undefined for the main frame
 * - `name` — the frame's `name`/`id` HTML attribute, undefined when not set
 * - `url` — the frame's current URL
 */
export interface BrowserFrameInfo {
	readonly id: string
	readonly parent: string | undefined
	readonly name: string | undefined
	readonly url: string
}

/**
 * Provides the operations shared by a top-level page and an iframe document.
 *
 * @remarks
 * - `id` — CDP frame id
 * - `parent` — parent frame id, undefined for the main frame
 * - `name` — frame `name`/`id`, undefined when absent
 * - `url` — current frame URL
 * - `title` — resolve the document title
 * - `content` — extract page URL, title, HTML, and visible text
 * - `article` — the page's reader-facing prose, boilerplate and hidden regions pruned (not `content()`'s whole-body text)
 * - `click` — click an element matching the selector
 * - `fill` — type text into an input element
 * - `select` — choose option(s) in a `<select>` element
 * - `evaluate` — execute a JavaScript expression in the page context
 * - `wait` — wait for an element state
 * - `send` — issue a raw CDP method in the frame's current target session, with an optional per-call timeout
 * - `assert` — throw when the frame can no longer accept protocol work
 * - `update` — record an externally observed URL as the frame's current URL
 */
export interface BrowserFrameInterface {
	readonly id: string
	readonly parent: string | undefined
	readonly name: string | undefined
	readonly url: string
	readonly selectors: BrowserSelectorManagerInterface
	readonly keyboard: BrowserKeyboardInterface
	readonly mouse: BrowserMouseInterface
	readonly touch: BrowserTouchInterface
	title(): Promise<string>
	content(): Promise<BrowserContentResult>
	article(): Promise<string>
	click(selector: string, options?: BrowserActionOptions): Promise<void>
	fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void>
	select(selector: string, values: readonly string[], options?: BrowserActionOptions): Promise<void>
	evaluate(expression: string, timeout?: number): Promise<unknown>
	handle(expression: string): Promise<BrowserHandleInterface>
	wait(selector: string, options?: BrowserWaitOptions): Promise<void>
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserSendOptions,
	): Promise<unknown>
	subscribe(method: string, handler: CDPHandler): Promise<void>
	unsubscribe(method: string, handler: CDPHandler): Promise<void>
	save(path: string, bytes: Uint8Array): Promise<void>
	assert(): void
	update(url: string): void
}

// === Browser snapshot

/** Represents a rectangle in CSS pixels: x, y, width, height. */
export type BrowserRect = readonly [x: number, y: number, width: number, height: number]

/** Describes layout data associated with one captured DOM node. */
export interface BrowserLayout {
	readonly bounds: BrowserRect | undefined
	readonly styles: Readonly<Record<string, string>>
	readonly text: string | undefined
	readonly paint: number | undefined
	readonly offset: BrowserRect | undefined
	readonly scroll: BrowserRect | undefined
	readonly client: BrowserRect | undefined
}

/**
 * Represents one serializable DOM node decoded from a CDP DOM snapshot.
 *
 * @remarks
 * `category` mirrors the DOM `nodeType` value — `1` for an element, `3` for
 * text, `9` for a document, and the rest of the DOM node categories.
 */
export interface BrowserNode {
	readonly document: number
	readonly frame: string
	readonly index: number
	readonly id: number | undefined
	readonly parent: number | undefined
	readonly category: number
	readonly name: string
	readonly value: string
	readonly attributes: Readonly<Record<string, string>>
	readonly text: string | undefined
	readonly input: string | undefined
	readonly checked: boolean | undefined
	readonly selected: boolean | undefined
	readonly clickable: boolean | undefined
	readonly shadow: string | undefined
	readonly content: number | undefined
	readonly pseudo: string | undefined
	readonly source: string | undefined
	readonly origin: string | undefined
	readonly layout: BrowserLayout | undefined
}

/** Represents one document captured in a CDP DOM snapshot. */
export interface BrowserDocument {
	readonly index: number
	readonly frame: string
	readonly url: string
	readonly title: string
	readonly nodes: readonly BrowserNode[]
	readonly scroll: readonly [x: number | undefined, y: number | undefined]
	readonly width: number | undefined
	readonly height: number | undefined
}

/** Describes the serializable input for a navigable browser snapshot. */
export interface BrowserSnapshotInput {
	readonly documents: readonly BrowserDocument[]
	readonly styles: readonly string[]
}

/** Names the structural ordering for a browser snapshot walk. */
export type BrowserWalkOrder = 'depth' | 'breadth'

/**
 * Describes the options for walking a browser snapshot.
 *
 * @remarks
 * - `root` — optional subtree root, included in the walk
 * - `order` — structural traversal order, defaulting to depth-first
 */
export interface BrowserWalkOptions {
	readonly root?: BrowserNode
	readonly order?: BrowserWalkOrder
}

/** Names a structural sibling relationship relative to a browser node. */
export type BrowserSiblingRelation = 'preceding' | 'following'

/** Represents a navigable, serializable snapshot of every document attached to a page. */
export interface BrowserSnapshotInterface extends BrowserSnapshotInput {
	walk(options?: BrowserWalkOptions): Generator<BrowserNode, void, unknown>
	descendants(node: BrowserNode): Generator<BrowserNode, void, unknown>
	document(node: BrowserNode): BrowserDocument | undefined
	children(node: BrowserNode): readonly BrowserNode[]
	parent(node: BrowserNode): BrowserNode | undefined
	siblings(node: BrowserNode, relation?: BrowserSiblingRelation): readonly BrowserNode[]
	ancestors(node: BrowserNode): readonly BrowserNode[]
	common(first: BrowserNode, second: BrowserNode): BrowserNode | undefined
	distance(first: BrowserNode, second: BrowserNode): number | undefined
	find(query: BrowserNodeQuery | BrowserNodePredicate): BrowserNode | undefined
	filter(query: BrowserNodeQuery | BrowserNodePredicate, limit?: number): readonly BrowserNode[]
	closest(
		node: BrowserNode,
		query: BrowserNodeQuery | BrowserNodePredicate,
	): BrowserNode | undefined
	path(node: BrowserNode): string
}

/**
 * Describes the options configuring capture through {@link BrowserPageInterface} `snapshot()`.
 * The snapshot entity's creation input is {@link BrowserSnapshotInput}.
 *
 * @remarks
 * - `styles` — computed CSS property names to capture
 * - `paint` — include global paint order
 * - `rects` — include offset, scroll, and client rectangles
 * - `limit` — maximum decoded node count
 */
export interface BrowserSnapshotOptions {
	readonly styles?: readonly string[]
	readonly paint?: boolean
	readonly rects?: boolean
	readonly limit?: number
}

/** Names the predicate form accepted by {@link BrowserSnapshotInterface} find, filter, and closest methods. */
export type BrowserNodePredicate = (node: BrowserNode) => boolean

/**
 * Describes a declarative browser-node matcher used by {@link matchesBrowserNode}.
 *
 * @remarks
 * Every supplied field must match. `name` is case-insensitive, `text`
 * searches layout text and node value, and `attributes` requires every
 * supplied name/value pair.
 */
export interface BrowserNodeQuery {
	readonly name?: string
	readonly text?: string
	readonly attributes?: Readonly<Record<string, string>>
	readonly frame?: string
	readonly visible?: boolean
	readonly clickable?: boolean
}

// === Browser page

/**
 * Abstracts a single top-level browser page.
 *
 * @remarks
 * Inherits every {@link BrowserFrameInterface} document operation for the
 * main frame.
 *
 * - `closed` — true after `close()` is called
 * - `navigate` — go to a URL and wait for the specified load condition
 * - `screenshot` — capture a PNG or JPEG image of the page
 * - `frame` — look up a frame by name or URL in the page's flattened frame tree
 * - `frames` — list the page's flattened frame tree, main frame first
 * - `snapshot` — capture every attached document as serializable DOM data
 * - `codegen` — start (or return the existing) action recorder for this page
 * - `destroy` — release local resources and detach from the target
 * - `close` — close the remote target and release local resources
 */
export interface BrowserPageInterface extends BrowserFrameInterface {
	readonly emitter: EmitterInterface<BrowserPageEventMap>
	readonly network: BrowserNetworkManagerInterface
	readonly navigation: BrowserNavigationManagerInterface
	readonly scripts: BrowserScriptManagerInterface
	readonly accessibility: BrowserAccessibilityInterface
	readonly diagnostics: BrowserDiagnosticsInterface
	readonly clock: BrowserClockInterface
	readonly opener: BrowserPageInterface | undefined
	readonly target: string
	readonly closed: boolean
	navigate(url: string, options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	reload(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	back(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	forward(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	pdf(options?: BrowserPDFOptions): Promise<BrowserPDFResult>
	frame(name: string): Promise<BrowserFrameInterface | undefined>
	frames(): Promise<readonly BrowserFrameInterface[]>
	snapshot(options?: BrowserSnapshotOptions): Promise<BrowserSnapshotInterface>
	codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface>
	destroy(): Promise<void>
	close(): Promise<void>
}

// === Browser context

/**
 * Represents an isolated browser session over a CDP browser context.
 *
 * @remarks
 * Follows the manager accessor pattern:
 * - `page(index?)` → one page by index or the first page
 * - `pages()` → all pages in creation order
 *
 * - `create` — open a new page in this context
 * - `sync` — synchronize pages from the given CDP targets (server discovers
 *   the targets; core never fetches them itself)
 * - `destroy` — release local pages and detach their sessions
 * - `close` — close remote pages and dispose the remote context
 */
export interface BrowserContextInterface {
	readonly emitter: EmitterInterface<BrowserContextEventMap>
	readonly id: string | undefined
	readonly cookies: BrowserCookieManagerInterface
	readonly permissions: BrowserPermissionManagerInterface
	readonly storage: BrowserStorageManagerInterface
	readonly emulation: BrowserEmulationManagerInterface
	page(index?: number): BrowserPageInterface | undefined
	pages(): readonly BrowserPageInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	sync(targets: readonly CDPTarget[]): Promise<void>
	destroy(): Promise<void>
	close(): Promise<void>
}
