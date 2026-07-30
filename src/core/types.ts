import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

// === CDP transport

/**
 * Event map for a {@link CDPTransportInterface} — the raw text pipe a
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
 * A dumb text transport CDPClient sends and receives JSON-RPC frames over.
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
 * Options for creating a CDPClient.
 *
 * @remarks
 * - `transport` — the text pipe the client sends/receives JSON-RPC frames over
 * - `timeout` — ms before a pending request or connection attempt fails (default from constants)
 */
export interface CDPClientOptions {
	readonly transport: CDPTransportInterface
	readonly timeout?: number
}

/** Handler invoked for a subscribed CDP event with its params record. */
export type CDPHandler = (params: Readonly<Record<string, unknown>>) => void

/** One entry of the CDP `Target.getTargets` result. */
export interface CDPTarget {
	readonly id: string
	readonly type: string
	readonly title: string
	readonly url: string
}

/**
 * Lightweight Chrome DevTools Protocol client over a {@link CDPTransportInterface}.
 *
 * @remarks
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
	readonly connected: boolean
	connect(): Promise<void>
	reconnect(): Promise<void>
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		sessionId?: string,
		timeout?: number,
	): Promise<unknown>
	subscribe(method: string, handler: CDPHandler, sessionId?: string): void
	unsubscribe(method: string, handler: CDPHandler, sessionId?: string): void
	close(): Promise<void>
}

// === Screenshot writer

/**
 * Pluggable sink for persisting screenshot bytes to a path.
 *
 * @remarks
 * Core never touches a filesystem directly — a page accepts an optional
 * writer (server supplies an `fs`-backed implementation) and calls it when a
 * screenshot request carries a `path`.
 */
export interface ScreenshotWriterInterface {
	write(path: string, data: Uint8Array): Promise<void>
}

// === Browser shared

/** Viewport dimensions for a browser page. */
export interface BrowserViewport {
	readonly width: number
	readonly height: number
	readonly scale?: number
	readonly mobile?: boolean
	readonly touch?: boolean
	readonly landscape?: boolean
}

/** Page load condition for navigation — the CDP load event awaited by `navigate()`. */
export type BrowserWaitUntil = 'commit' | 'load' | 'domcontentloaded'

/**
 * Options for creating a browser page.
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
 * Options for page navigation.
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

/** Outcome of a top-level navigation command. */
export interface BrowserNavigationResult {
	readonly url: string
	readonly response: BrowserResponse | undefined
	readonly same: boolean
}

/** State retained while correlating navigation with Network events. */
export interface BrowserNavigationWatch {
	readonly responses: BrowserResponse[]
}

/** One pending URL-pattern wait. */
export interface BrowserNavigationWait {
	readonly pattern: string
	readonly timer: ReturnType<typeof setTimeout>
	readonly resolve: (url: string) => void
	readonly reject: (error: unknown) => void
}

/** Options for URL and predicate waits. */
export interface BrowserNavigationWaitOptions {
	readonly timeout?: number
}

/** URL and in-page predicate waits associated with one page. */
export interface BrowserNavigationManagerInterface {
	wait(pattern: string, options?: BrowserNavigationWaitOptions): Promise<string>
	until(expression: string, options?: BrowserNavigationWaitOptions): Promise<unknown>
}

/**
 * Options for element interaction (click, fill, select, wait).
 *
 * @remarks
 * - `timeout` — maximum time to wait for the selector in milliseconds
 */
export interface BrowserActionOptions {
	readonly timeout?: number
	readonly strict?: boolean
	readonly force?: boolean
	readonly trial?: boolean
	readonly delay?: number
	readonly button?: BrowserMouseButton
	readonly count?: number
	readonly position?: BrowserPoint
	readonly steps?: number
}

/** Element state a frame or page can wait for. */
export type BrowserWaitState = 'attached' | 'detached' | 'visible' | 'hidden'

/**
 * Options for waiting on an element.
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
 * Options for taking a page screenshot.
 *
 * @remarks
 * - `path` — file path to persist the screenshot to, via the page's writer
 * - `full` — capture the full scrollable page (default `false`)
 * - `type` — image format (default `'png'`)
 * - `quality` — JPEG quality 0–100 (ignored for PNG)
 */
export interface BrowserScreenshotOptions {
	readonly path?: string
	readonly full?: boolean
	readonly type?: 'png' | 'jpeg'
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
 * Result of page content extraction.
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
 * Result of a page screenshot.
 *
 * @remarks
 * - `bytes` — raw image bytes
 * - `path` — file path if persisted via the page's writer, otherwise undefined
 */
export interface BrowserScreenshotResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

// === Browser handles

/**
 * A remote JavaScript object retained in one frame execution context.
 */
export interface BrowserHandleInterface {
	readonly id: string
	value(): Promise<unknown>
	call(declaration: string, args?: readonly unknown[]): Promise<unknown>
	property(name: string): Promise<BrowserHandleInterface | undefined>
	properties(): Promise<Readonly<Record<string, unknown>>>
	dispose(): Promise<void>
}

/** Host function exposed into page JavaScript. */
export type BrowserBindingHandler = (...args: unknown[]) => unknown | Promise<unknown>

/** Decoded page-to-host binding call. */
export interface BrowserBindingCall {
	readonly id: string
	readonly name: string
	readonly args: readonly unknown[]
	readonly context: number
}

/** Initialization scripts and host bindings for one page. */
export interface BrowserScriptManagerInterface {
	add(source: string): Promise<string>
	remove(id: string): Promise<void>
	expose(name: string, handler: BrowserBindingHandler): Promise<void>
	revoke(name: string): Promise<void>
	destroy(): Promise<void>
}

/** One installed new-document script and its optional host binding owner. */
export interface BrowserScriptEntry {
	readonly source: string
	readonly binding: string | undefined
}

// === Browser accessibility

/** One decoded Chromium accessibility node. */
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

/** Serializable accessibility-tree snapshot. */
export interface BrowserAccessibilitySnapshot {
	readonly roots: readonly string[]
	readonly nodes: readonly BrowserAXNode[]
}

/** Accessibility snapshot options. */
export interface BrowserAccessibilityOptions {
	readonly root?: number
	readonly depth?: number
}

/** Accessibility tree inspection. */
export interface BrowserAccessibilityInterface {
	snapshot(options?: BrowserAccessibilityOptions): Promise<BrowserAccessibilitySnapshot>
}

// === Browser diagnostics

/** Chromium trace capture options. */
export interface BrowserTracingOptions {
	readonly path?: string
	readonly categories?: readonly string[]
	readonly screenshots?: boolean
	readonly sampling?: boolean
}

/** Trace capture result. */
export interface BrowserTracingResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

/** One decoded IO stream read. */
export interface BrowserStreamChunk {
	readonly bytes: Uint8Array
	readonly eof: boolean
}

/** Trace capture lifecycle. */
export interface BrowserTracingInterface {
	readonly active: boolean
	start(options?: BrowserTracingOptions): Promise<void>
	stop(): Promise<BrowserTracingResult>
	destroy(): Promise<void>
}

/** Source range reported by JavaScript or CSS coverage. */
export interface BrowserCoverageRange {
	readonly start: number
	readonly end: number
	readonly count: number
}

/** Function coverage inside one script. */
export interface BrowserFunctionCoverage {
	readonly name: string
	readonly ranges: readonly BrowserCoverageRange[]
	readonly block: boolean
}

/** JavaScript script coverage. */
export interface BrowserScriptCoverage {
	readonly id: string
	readonly url: string
	readonly functions: readonly BrowserFunctionCoverage[]
}

/** CSS stylesheet coverage. */
export interface BrowserStyleCoverage {
	readonly id: string
	readonly ranges: readonly BrowserCoverageRange[]
}

/** Coverage capture options. */
export interface BrowserCoverageOptions {
	readonly javascript?: boolean
	readonly css?: boolean
	readonly detailed?: boolean
}

/** Combined JavaScript and CSS usage. */
export interface BrowserCoverageResult {
	readonly scripts: readonly BrowserScriptCoverage[]
	readonly styles: readonly BrowserStyleCoverage[]
}

/** Coverage capture lifecycle. */
export interface BrowserCoverageInterface {
	readonly active: boolean
	start(options?: BrowserCoverageOptions): Promise<void>
	stop(): Promise<BrowserCoverageResult>
	destroy(): Promise<void>
}

/** One Performance-domain metric. */
export interface BrowserMetric {
	readonly name: string
	readonly value: number
}

/** JavaScript call frame from a CPU profile. */
export interface BrowserProfileFrame {
	readonly function: string
	readonly script: string
	readonly url: string
	readonly line: number
	readonly column: number
}

/** One node in a sampled CPU profile. */
export interface BrowserProfileNode {
	readonly id: number
	readonly frame: BrowserProfileFrame
	readonly hit: number | undefined
	readonly children: readonly number[]
}

/** Sampled CPU profile. */
export interface BrowserProfile {
	readonly start: number
	readonly end: number
	readonly nodes: readonly BrowserProfileNode[]
	readonly samples: readonly number[]
	readonly deltas: readonly number[]
}

/** Performance metrics and CPU profile lifecycle. */
export interface BrowserPerformanceInterface {
	readonly active: boolean
	metrics(): Promise<readonly BrowserMetric[]>
	start(interval?: number): Promise<void>
	stop(): Promise<BrowserProfile>
	destroy(): Promise<void>
}

/** Diagnostics grouped by capability. */
export interface BrowserDiagnosticsInterface {
	readonly tracing: BrowserTracingInterface
	readonly coverage: BrowserCoverageInterface
	readonly performance: BrowserPerformanceInterface
	destroy(): Promise<void>
}

// === Browser clock

/** Chromium virtual-time control for deterministic page timers. */
export interface BrowserClockInterface {
	readonly installed: boolean
	install(time?: number): Promise<void>
	pause(): Promise<void>
	resume(): Promise<void>
	advance(ms: number): Promise<void>
	uninstall(): Promise<void>
}

// === Browser selectors and locators

/** Selector axis supported by {@link BrowserSelectorManagerInterface}. */
export type BrowserSelector = 'css' | 'role' | 'text' | 'label' | 'placeholder' | 'test'

/** Declarative locator filter applied after selector resolution. */
export interface BrowserLocatorFilter {
	readonly text?: string
	readonly exact?: boolean
	readonly visible?: boolean
}

/** Serializable selector query, including optional ancestry and filtering. */
export interface BrowserQuery {
	readonly selector: BrowserSelector
	readonly value: string
	readonly name?: string
	readonly exact?: boolean
	readonly parent?: BrowserQuery
	readonly filter?: BrowserLocatorFilter
	readonly index?: number
}

/** Options for role-based locator creation. */
export interface BrowserRoleOptions {
	readonly name?: string
	readonly exact?: boolean
}

/** Options for text-like locator creation. */
export interface BrowserTextOptions {
	readonly exact?: boolean
}

/** Options for filtering a locator. */
export interface BrowserFilterOptions extends BrowserLocatorFilter {}

/** Options for locator text extraction. */
export interface BrowserTextResultOptions {
	readonly all?: boolean
}

/** Options for setting files on a file input. */
export interface BrowserUploadOptions extends BrowserActionOptions {
	readonly files: readonly string[]
}

/**
 * Reusable strict locator over one frame.
 */
export interface BrowserLocatorInterface {
	readonly frame: BrowserFrameInterface
	readonly query: BrowserQuery
	locator(selector: string): BrowserLocatorInterface
	filter(options: BrowserFilterOptions): BrowserLocatorInterface
	first(): BrowserLocatorInterface
	last(): BrowserLocatorInterface
	item(index: number): BrowserLocatorInterface
	count(): Promise<number>
	all(): Promise<readonly BrowserLocatorInterface[]>
	click(options?: BrowserActionOptions): Promise<void>
	fill(value: string, options?: BrowserActionOptions): Promise<void>
	select(values: readonly string[], options?: BrowserActionOptions): Promise<void>
	check(options?: BrowserActionOptions): Promise<void>
	uncheck(options?: BrowserActionOptions): Promise<void>
	hover(options?: BrowserActionOptions): Promise<void>
	focus(options?: BrowserActionOptions): Promise<void>
	press(key: string, options?: BrowserActionOptions): Promise<void>
	type(value: string, options?: BrowserActionOptions): Promise<void>
	clear(options?: BrowserActionOptions): Promise<void>
	wait(options?: BrowserWaitOptions): Promise<void>
	text(options?: BrowserTextResultOptions): Promise<string | readonly string[]>
	html(): Promise<string>
	value(): Promise<string>
	attribute(name: string): Promise<string | undefined>
	visible(): Promise<boolean>
	enabled(): Promise<boolean>
	editable(): Promise<boolean>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	upload(options: BrowserUploadOptions): Promise<void>
	drag(target: BrowserLocatorInterface, options?: BrowserActionOptions): Promise<void>
}

/**
 * Locator factory grouped by selector semantics.
 */
export interface BrowserSelectorManagerInterface {
	css(value: string): BrowserLocatorInterface
	role(value: string, options?: BrowserRoleOptions): BrowserLocatorInterface
	text(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	label(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	placeholder(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	test(value: string): BrowserLocatorInterface
}

// === Browser input

/** Point in viewport CSS pixels. */
export interface BrowserPoint {
	readonly x: number
	readonly y: number
}

/** Mouse button understood by Chromium's Input domain. */
export type BrowserMouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward'

/** Screenshot coordinate scale. */
export type BrowserScreenshotScale = 'css' | 'device'

/** Normalized CDP keyboard key data. */
export interface BrowserKey {
	readonly key: string
	readonly code: string
	readonly text: string | undefined
	readonly number: number
}

/** Parsed keyboard chord. */
export interface BrowserChord {
	readonly modifiers: readonly string[]
	readonly key: string
}

/** Keyboard input operations bound to one frame target session. */
export interface BrowserKeyboardInterface {
	down(key: string): Promise<void>
	up(key: string): Promise<void>
	press(key: string, options?: BrowserActionOptions): Promise<void>
	type(value: string, options?: BrowserActionOptions): Promise<void>
	insert(value: string): Promise<void>
}

/** Mouse input operations bound to one frame target session. */
export interface BrowserMouseInterface {
	move(point: BrowserPoint): Promise<void>
	down(button?: BrowserMouseButton, count?: number): Promise<void>
	up(button?: BrowserMouseButton, count?: number): Promise<void>
	click(point: BrowserPoint, options?: BrowserActionOptions): Promise<void>
	drag(start: BrowserPoint, end: BrowserPoint, options?: BrowserActionOptions): Promise<void>
	wheel(delta: BrowserPoint): Promise<void>
}

/** Touch input operations bound to one frame target session. */
export interface BrowserTouchInterface {
	tap(point: BrowserPoint): Promise<void>
}

/** Actionability checks performed before locator input. */
export interface BrowserActionabilityOptions {
	readonly visible?: boolean
	readonly stable?: boolean
	readonly events?: boolean
	readonly enabled?: boolean
	readonly editable?: boolean
	readonly position?: BrowserPoint
}

/** Decoded content quad and its actionable center. */
export interface BrowserQuad {
	readonly points: readonly [number, number, number, number, number, number, number, number]
	readonly center: BrowserPoint
}

// === Browser PDF

/** Paper margin lengths accepted by Chromium print-to-PDF. */
export interface BrowserMargin {
	readonly top?: number
	readonly right?: number
	readonly bottom?: number
	readonly left?: number
}

/** Options for printing a Chromium page to PDF. */
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

/** Result of printing a page to PDF. */
export interface BrowserPDFResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

// === Browser page events

/** JavaScript dialog category reported by Chromium. */
export type BrowserDialogCategory = 'alert' | 'confirm' | 'prompt' | 'beforeunload'

/** One active JavaScript dialog. */
export interface BrowserDialogInterface {
	readonly category: BrowserDialogCategory
	readonly message: string
	readonly default: string
	accept(value?: string): Promise<void>
	dismiss(): Promise<void>
}

/** One intercepted file chooser. */
export interface BrowserFileChooserInterface {
	readonly multiple: boolean
	upload(files: readonly string[]): Promise<void>
	cancel(): Promise<void>
}

/** Download lifecycle phase. */
export type BrowserDownloadStatus = 'pending' | 'complete' | 'cancelled'

/** Download progress events. */
export type BrowserDownloadEventMap = {
	readonly progress: readonly [received: number, total: number]
	readonly complete: readonly [path: string | undefined]
	readonly cancel: readonly []
}

/** Protocol-neutral download progress update. */
export interface BrowserDownloadProgress {
	readonly status: BrowserDownloadStatus
	readonly received: number
	readonly total: number
	readonly path?: string
}

/** Decoded `Browser.downloadWillBegin` event. */
export interface BrowserDownloadStart {
	readonly id: string
	readonly url: string
	readonly name: string
	readonly frame: string
}

/** One context download tracked through Chromium's Browser domain. */
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
	update(progress: BrowserDownloadProgress): void
}

/** One console API call. */
export interface BrowserConsoleMessage {
	readonly level: string
	readonly text: string
	readonly values: readonly unknown[]
	readonly timestamp: number
	readonly stack: readonly BrowserStackFrame[]
}

/** One browser-side stack frame. */
export interface BrowserStackFrame {
	readonly url: string
	readonly function: string
	readonly line: number
	readonly column: number
}

/** One uncaught page exception. */
export interface BrowserPageError {
	readonly message: string
	readonly stack: readonly BrowserStackFrame[]
	readonly timestamp: number
}

/** Worker target category. */
export type BrowserWorkerCategory = 'worker' | 'service_worker' | 'shared_worker'

/** Script worker attached to a page target. */
export interface BrowserWorkerInterface {
	readonly id: string
	readonly url: string
	readonly category: BrowserWorkerCategory
	evaluate(expression: string, timeout?: number): Promise<unknown>
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
	detach(): void
	close(): Promise<void>
}

/** Typed page, frame, target, and user-visible browser events. */
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

/** One observed browser request. */
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

/** TLS details supplied with a browser response. */
export interface BrowserSecurity {
	readonly protocol: string
	readonly issuer: string
	readonly from: number
	readonly to: number
}

/** Start/end pair for one network timing phase. */
export interface BrowserTimingRange {
	readonly start: number
	readonly end: number
}

/** Network timing values in milliseconds relative to request time. */
export interface BrowserTiming {
	readonly request: number
	readonly proxy: BrowserTimingRange | undefined
	readonly dns: BrowserTimingRange | undefined
	readonly connect: BrowserTimingRange | undefined
	readonly ssl: BrowserTimingRange | undefined
	readonly send: BrowserTimingRange | undefined
	readonly receive: number | undefined
}

/** One observed browser response. */
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

/** One failed browser request. */
export interface BrowserRequestFailure {
	readonly id: string
	readonly error: string
	readonly cancelled: boolean
	readonly blocked: string | undefined
}

/** WebSocket frame payload. */
export interface BrowserWebSocketFrame {
	readonly opcode: number
	readonly data: string
	readonly masked: boolean
	readonly timestamp: number
}

/** WebSocket lifecycle events. */
export type BrowserWebSocketEventMap = {
	readonly receive: readonly [frame: BrowserWebSocketFrame]
	readonly transmit: readonly [frame: BrowserWebSocketFrame]
	readonly error: readonly [message: string]
	readonly close: readonly [timestamp: number]
}

/** One observed WebSocket connection. */
export interface BrowserWebSocketInterface {
	readonly emitter: EmitterInterface<BrowserWebSocketEventMap>
	readonly id: string
	readonly url: string
	receive(frame: BrowserWebSocketFrame): void
	transmit(frame: BrowserWebSocketFrame): void
	fail(message: string): void
	close(timestamp: number): void
}

/** Network events emitted by a page's network manager. */
export type BrowserNetworkEventMap = {
	readonly request: readonly [request: BrowserRequest]
	readonly response: readonly [response: BrowserResponse]
	readonly failure: readonly [failure: BrowserRequestFailure]
	readonly finish: readonly [id: string]
	readonly socket: readonly [socket: BrowserWebSocketInterface]
}

/** Route matching criteria. Omitted fields match all values. */
export interface BrowserRouteQuery {
	readonly url?: string
	readonly method?: string
	readonly resource?: string
}

/** Overrides supplied when continuing an intercepted request. */
export interface BrowserRouteContinueOptions {
	readonly url?: string
	readonly method?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly post?: string
}

/** Synthetic response supplied when fulfilling an intercepted request. */
export interface BrowserRouteFulfillOptions {
	readonly status?: number
	readonly phrase?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly body?: string | Uint8Array
}

/** One paused Fetch-domain request. */
export interface BrowserRouteInterface {
	readonly id: string
	readonly request: BrowserRequest
	readonly handled: boolean
	abort(reason?: string): Promise<void>
	continue(options?: BrowserRouteContinueOptions): Promise<void>
	fulfill(options: BrowserRouteFulfillOptions): Promise<void>
}

/** Function invoked for a matching intercepted request. */
export type BrowserRouteHandler = (route: BrowserRouteInterface) => void | Promise<void>

/** One installed network route. */
export interface BrowserRouteDefinition {
	readonly query: BrowserRouteQuery
	readonly handler: BrowserRouteHandler
}

/** HAR recording options. */
export interface BrowserHAROptions {
	readonly path?: string
	readonly content?: boolean
}

/** One name/value pair in an HTTP archive. */
export interface BrowserHARValue {
	readonly name: string
	readonly value: string
}

/**
 * One cookie in an HTTP archive.
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

/** Request body metadata in an HTTP archive. */
export interface BrowserHARPost {
	readonly mimeType: string
	readonly text: string
}

/** Response body metadata in an HTTP archive. */
export interface BrowserHARContent {
	readonly size: number
	readonly mimeType: string
	readonly text?: string
	readonly encoding?: 'base64'
}

/** HAR 1.2 request entry. */
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

/** HAR 1.2 response entry. */
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

/** HAR 1.2 phase timings in milliseconds. */
export interface BrowserHARTimings {
	readonly blocked: number
	readonly dns: number
	readonly connect: number
	readonly send: number
	readonly wait: number
	readonly receive: number
	readonly ssl: number
}

/** One completed HTTP exchange in a HAR recording. */
export interface BrowserHAREntry {
	readonly startedDateTime: string
	readonly time: number
	readonly request: BrowserHARRequest
	readonly response: BrowserHARResponse
	readonly cache: Readonly<Record<string, unknown>>
	readonly timings: BrowserHARTimings
}

/** Mutable recording state held until a request finishes. */
export interface BrowserHARPending {
	readonly request: BrowserRequest
	readonly started: number
	readonly response: BrowserResponse | undefined
}

/** Tool identity embedded in an HTTP archive. */
export interface BrowserHARCreator {
	readonly name: string
	readonly version: string
}

/** HAR 1.2 log object. */
export interface BrowserHARLog {
	readonly version: '1.2'
	readonly creator: BrowserHARCreator
	readonly entries: readonly BrowserHAREntry[]
}

/** Standards-shaped HAR 1.2 document produced by the network manager. */
export interface BrowserHAR {
	readonly log: BrowserHARLog
}

/** HAR replay behavior. */
export interface BrowserHARReplayOptions {
	readonly fallback?: boolean
}

/** HAR recording and replay operations. */
export interface BrowserHARManagerInterface {
	readonly recording: boolean
	start(options?: BrowserHAROptions): Promise<void>
	stop(): Promise<BrowserHAR>
	replay(har: BrowserHAR, options?: BrowserHARReplayOptions): Promise<void>
	clear(): Promise<void>
}

/** Page-scoped network observation and interception. */
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

/** Cookie same-site policy understood by Chromium. */
export type BrowserSameSite = 'Strict' | 'Lax' | 'None'

/** Cookie partition key used by CHIPS-partitioned cookies. */
export interface BrowserCookiePartition {
	readonly site: string
	readonly ancestor?: boolean
}

/** One cookie returned from a browser context. */
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

/** Input used to create or replace a browser cookie. */
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

/** Optional narrowing criteria for clearing context cookies. */
export interface BrowserCookieFilter {
	readonly name?: string
	readonly domain?: string
	readonly path?: string
}

/** Cookie operations scoped to one browser context. */
export interface BrowserCookieManagerInterface {
	list(urls?: readonly string[]): Promise<readonly BrowserCookie[]>
	set(cookies: readonly BrowserCookieInput[]): Promise<void>
	clear(filter?: BrowserCookieFilter): Promise<void>
}

/** Permission override operations scoped to one browser context. */
export interface BrowserPermissionManagerInterface {
	grant(permissions: readonly string[], origin?: string): Promise<void>
	deny(permissions: readonly string[], origin?: string): Promise<void>
	clear(): Promise<void>
}

/** One key/value pair from web storage. */
export interface BrowserStorageEntry {
	readonly name: string
	readonly value: string
}

/** Origin-scoped local and session storage snapshot. */
export interface BrowserStorageOrigin {
	readonly origin: string
	readonly local: readonly BrowserStorageEntry[]
	readonly session: readonly BrowserStorageEntry[]
}

/** Portable browser authentication and storage snapshot. */
export interface BrowserStorageState {
	readonly cookies: readonly BrowserCookieInput[]
	readonly origins: readonly BrowserStorageOrigin[]
}

/** Options for collecting storage state from selected origins. */
export interface BrowserStorageOptions {
	readonly origins?: readonly string[]
}

/** Storage-state import, export, and clearing operations. */
export interface BrowserStorageManagerInterface {
	state(options?: BrowserStorageOptions): Promise<BrowserStorageState>
	restore(state: BrowserStorageState): Promise<void>
	clear(origin?: string): Promise<void>
}

/** HTTP basic-auth credentials applied to context pages. */
export interface BrowserCredentials {
	readonly username: string
	readonly password: string
}

/** Geographic location override. */
export interface BrowserGeolocation {
	readonly latitude: number
	readonly longitude: number
	readonly accuracy?: number
}

/** Browser color and media feature overrides. */
export interface BrowserMedia {
	readonly media?: 'screen' | 'print'
	readonly color?: 'light' | 'dark' | 'no-preference'
	readonly contrast?: 'more' | 'less' | 'no-preference'
	readonly motion?: 'reduce' | 'no-preference'
	readonly colors?: 'active' | 'none'
}

/** User-agent metadata accepted by Chromium emulation. */
export interface BrowserUserAgent {
	readonly value: string
	readonly language?: string
	readonly platform?: string
}

/** Network and rendering overrides inherited by context pages. */
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

/** Context-scoped emulation configuration. */
export interface BrowserEmulationManagerInterface {
	apply(options: BrowserEmulationOptions): Promise<void>
	clear(): Promise<void>
	attach(page: BrowserPageInterface): Promise<void>
}

/** Proxy settings used when creating an isolated browser context. */
export interface BrowserProxy {
	readonly server: string
	readonly bypass?: readonly string[]
}

/** Download policy for a browser context. */
export interface BrowserDownloadOptions {
	readonly path: string
	readonly named?: boolean
}

/** Options for creating and configuring an isolated browser context. */
export interface BrowserContextOptions {
	readonly proxy?: BrowserProxy
	readonly origins?: readonly string[]
	readonly downloads?: BrowserDownloadOptions
	readonly emulation?: BrowserEmulationOptions
}

/** Browser-context lifecycle events. */
export type BrowserContextEventMap = {
	readonly page: readonly [page: BrowserPageInterface]
	readonly close: readonly []
}

// === Browser codegen

/** One recorded browser action captured during a codegen session. */
export type BrowserCodegenAction =
	| { readonly action: 'navigate'; readonly url: string }
	| { readonly action: 'click'; readonly selector: string }
	| { readonly action: 'fill'; readonly selector: string; readonly value: string }
	| { readonly action: 'select'; readonly selector: string; readonly values: readonly string[] }

/**
 * Event map for a {@link BrowserCodegenInterface}.
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
 * Options for creating a BrowserCodegen recorder.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 */
export interface BrowserCodegenOptions {
	readonly on?: EmitterHooks<BrowserCodegenEventMap>
	readonly error?: EmitterErrorHandler
}

/** Target language for a compiled codegen script. */
export type BrowserCodegenLanguage = 'javascript' | 'typescript'

/**
 * Options for compiling recorded actions into a script.
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

/** Resolve the current CDP session for a frame id. */
export type BrowserSessionFunction = (frame: string) => Promise<string>

/**
 * Serializable frame metadata decoded from CDP `Page.getFrameTree`.
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
 * Operations shared by a top-level page and an iframe document.
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
 * - `send` — issue a raw CDP method in the frame's current target session
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
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
	subscribe(method: string, handler: CDPHandler): Promise<void>
	unsubscribe(method: string, handler: CDPHandler): Promise<void>
	save(path: string, bytes: Uint8Array): Promise<void>
}

// === Browser snapshot

/** A rectangle in CSS pixels: x, y, width, height. */
export type BrowserRect = readonly [x: number, y: number, width: number, height: number]

/** Layout data associated with one captured DOM node. */
export interface BrowserLayout {
	readonly bounds: BrowserRect | undefined
	readonly styles: Readonly<Record<string, string>>
	readonly text: string | undefined
	readonly paint: number | undefined
	readonly offset: BrowserRect | undefined
	readonly scroll: BrowserRect | undefined
	readonly client: BrowserRect | undefined
}

/** One serializable DOM node decoded from a CDP DOM snapshot. */
export interface BrowserNode {
	readonly document: number
	readonly frame: string
	readonly index: number
	readonly id: number | undefined
	readonly parent: number | undefined
	readonly type: number
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

/** One document captured in a CDP DOM snapshot. */
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

/** Serializable input for a navigable browser snapshot. */
export interface BrowserSnapshotInput {
	readonly documents: readonly BrowserDocument[]
	readonly styles: readonly string[]
}

/** Structural ordering for a browser snapshot walk. */
export type BrowserWalkOrder = 'depth' | 'breadth'

/**
 * Options for walking a browser snapshot.
 *
 * @remarks
 * - `root` — optional subtree root, included in the walk
 * - `order` — structural traversal order, defaulting to depth-first
 */
export interface BrowserWalkOptions {
	readonly root?: BrowserNode
	readonly order?: BrowserWalkOrder
}

/** Structural sibling relationship relative to a browser node. */
export type BrowserSiblingRelation = 'preceding' | 'following'

/** A navigable, serializable snapshot of every document attached to a page. */
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
 * Options configuring capture through {@link BrowserPageInterface} `snapshot()`.
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

/** Predicate form accepted by {@link BrowserSnapshotInterface} find, filter, and closest methods. */
export type BrowserNodePredicate = (node: BrowserNode) => boolean

/**
 * Declarative browser-node matcher used by {@link matchesBrowserNode}.
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
 * Abstraction over a single top-level browser page.
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
 * Isolated browser session over a CDP browser context.
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
