import type { JSONValue } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { HTMLInterface } from '@orkestrel/html'
import type {
	ToolCall,
	ToolContext,
	ToolInterface,
	ToolManagerInterface,
	ToolResult,
} from '@orkestrel/tool'

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
 * Represents the text pipe a `CDPClient` sends and receives JSON-RPC frames over.
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
	/** Opens the underlying connection. */
	start(): Promise<void>
	/**
	 * Writes one raw text frame to the connection. Throws a coded `BrowserConnectionError`
	 * carrying the transport `url` when called before the connection opens or after it closes.
	 */
	send(data: string): Promise<void>
	/** Closes the underlying connection and releases its resources. */
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
 * Describes the options for creating a `CDPClient` instance.
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
 * - `signal` — aborts this one request; the promise rejects with `signal.reason`
 */
export interface CDPSendOptions {
	readonly session?: string
	readonly timeout?: number
	readonly signal?: AbortSignal
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
	/** Starts the transport and begins dispatching. Idempotent. */
	connect(): Promise<void>
	/** Closes the transport and re-establishes it. */
	reconnect(): Promise<void>
	/**
	 * Issues a CDP method call with optional params and a trailing `CDPSendOptions` carrying
	 * the `session` to scope it to, a per-call `timeout` overriding the client-wide
	 * default, and a `signal` that aborts the call; rejects on timeout or abort.
	 */
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: CDPSendOptions,
	): Promise<unknown>
	/** Registers a handler for a CDP event, optionally session-scoped. */
	subscribe(method: string, handler: CDPHandler, session?: string): void
	/** Removes a handler for a CDP event, optionally session-scoped. */
	unsubscribe(method: string, handler: CDPHandler, session?: string): void
	/** Tears down the transport and rejects every pending request. */
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
	/**
	 * Starts the work when nothing is in flight, and otherwise joins the running transition
	 * and returns its result.
	 */
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
	/** Persists the captured bytes to the given path, creating its parent directories. */
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
export type BrowserWaitUntil = 'commit' | 'load' | 'domcontentloaded' | 'idle'

/**
 * Describes the options for creating a `BrowserPage` instance.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 * - `url` — navigate to this URL immediately after creation
 * - `viewport` — override the context-level default viewport
 * - `timeout` — navigation timeout for the initial URL
 */
export interface BrowserPageOptions {
	readonly on?: EmitterHooks<BrowserPageEventMap>
	readonly error?: EmitterErrorHandler
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
 * - `signal` — aborts the `Page.navigate` send
 */
export interface BrowserNavigationOptions extends BrowserCallOptions {
	readonly condition?: BrowserWaitUntil
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

/**
 * Represents one pending navigation or network-idle wait.
 *
 * @remarks
 * - `pattern` — the URL glob, undefined for a network-idle wait
 * - `listener` — the abort listener registered on `signal`, undefined without a signal
 */
export interface BrowserNavigationWait {
	readonly pattern: string | undefined
	readonly timer: ReturnType<typeof setTimeout>
	readonly signal: AbortSignal | undefined
	readonly listener: (() => void) | undefined
	readonly resolve: (url: string) => void
	readonly reject: (error: unknown) => void
}

/** Reads the loader id of the page's current document, undefined before the first commit. */
export type BrowserLoaderFunction = () => string | undefined

/** Provides URL and network-idle waits associated with one page. */
export interface BrowserNavigationManagerInterface {
	/**
	 * Resolves with the URL of the next navigation, same-document ones included, matching the `*`
	 * and `**` glob pattern. Rejects on timeout, and with `signal.reason` on abort.
	 */
	wait(pattern: string, options?: BrowserCallOptions): Promise<string>
	/**
	 * Resolves on the next `networkIdle` lifecycle event of the page's current loader. Rejects on
	 * timeout, and with `signal.reason` on abort.
	 */
	idle(options?: BrowserCallOptions): Promise<void>
	/**
	 * Opens a record of the navigations the page's frames start from this call on, for an input
	 * dispatched into `frame` next. Thrown when the page is closed: the page's closed error.
	 */
	record(frame: string): BrowserNavigationRecordInterface
}

/**
 * Settles the navigation an input into one frame started, from the steps the page accepted after
 * the record opened.
 *
 * @remarks
 * The record's eligible frames are its frame, every ancestor the page can name, and the main
 * frame, plus each frame a `settle` destination resolves to. The earliest eligible start is
 * selected; a later start in that frame before its commit supersedes it; the commit carries the
 * selected loader when both are known, else it is the frame's first commit after the start; the
 * load carries the commit's loader; and a same-document commit completes the navigation.
 */
export interface BrowserNavigationRecordInterface {
	/**
	 * Resolves when the record's frame or one of its ancestors starts a navigation after the record
	 * opened; `settle` reports that navigation's reason. Rejects at `timeout` with
	 * `BROWSER_NAVIGATION_TIMEOUT`, with `signal.reason` on abort, and when the record ends or the
	 * page closes.
	 */
	wait(options?: BrowserCallOptions): Promise<void>
	/**
	 * Follows the earliest navigation started after the record opened in the record's frame, one of
	 * its ancestors, or a frame `destinations` names, waiting within `timeout` for a destination to
	 * start one. Resolves with the stage reached at completion or at `timeout` and the reason
	 * `Page.frameRequestedNavigation` named for the navigation, or `undefined` when none started; a
	 * selected frame that detaches ends the wait with the stage it reached. Rejects with
	 * `signal.reason` on abort, and when the record ends or the page closes.
	 */
	settle(options?: BrowserSettlementOptions): Promise<BrowserSettlementResult | undefined>
	/** Ends the record and rejects a pending `wait` or `settle`. */
	destroy(): void
}

/** Opens the records that settle the popups an input into a page opens. */
export interface BrowserPopupManagerInterface {
	/**
	 * Opens a record of the popups the page opens from this call on, for an input dispatched next.
	 * Thrown when the page is closed: the page's closed error.
	 */
	record(): BrowserPopupRecordInterface
}

/**
 * Settles the popups an input opened, from the `Page.windowOpen` reports the page's own session
 * sends after the record opened.
 *
 * @remarks
 * Chromium 141 reports `Page.windowOpen` on the opener's session before it answers the input that
 * opened the window, and reports none for a `window.open` that names a window already open. Each
 * report names one popup: the record counts the reports, and a popup target the page begins to
 * adopt after the record opened concludes either announced, when the page emits it through
 * `popup`, or skipped, when it closes or fails its setup first. The record selects by arrival, not
 * by cause, so a popup another script opens while the record is open counts too. Chromium 141
 * reports such a popup only to target discovery, so a page constructed without a `reference`
 * function, which takes no part in discovery, counts no report.
 */
export interface BrowserPopupRecordInterface {
	/**
	 * Resolves at once with an empty list when no report arrived after the record opened; otherwise
	 * waits within `timeout` until as many adopted popups concluded as reports arrived, and resolves
	 * with the announced popups whose `opener` is this page, in announcement order, at that point or
	 * at `timeout`. Rejects with `signal.reason` on abort, and when the record ends or the page
	 * closes.
	 */
	settle(options?: BrowserCallOptions): Promise<readonly BrowserPageInterface[]>
	/** Ends the record and rejects a pending `settle`. */
	destroy(): void
}

/**
 * Names the frame a submission targets relative to the frame whose document submitted, mirroring
 * the HTML `_self`, `_parent`, and `_top` keywords.
 */
export type BrowserDestinationRelationship = 'self' | 'parent' | 'top'

/**
 * Pairs a document that recorded a surviving submission with the submission's destination.
 *
 * @remarks
 * - `frame` — the id of the frame whose document submitted
 * - `relationship` — the destination relative to that frame
 */
export interface BrowserDestination {
	readonly frame: string
	readonly relationship: BrowserDestinationRelationship
}

/**
 * Configures a record's settlement.
 *
 * @remarks
 * - `destinations` — the submissions whose destination frames become eligible; a destination
 *   whose parent the page cannot name makes the first start in any frame eligible
 * - `timeout` — bounds the settlement, which then resolves with the stage it reached
 */
export interface BrowserSettlementOptions extends BrowserCallOptions {
	readonly destinations?: readonly BrowserDestination[]
}

/** Names how far a settled navigation got: requested, committed, or loaded. */
export type BrowserNavigationStage = 'requested' | 'committed' | 'loaded'

/**
 * Names why a frame requested a navigation, mirroring the CDP `Page.ClientNavigationReason` values
 * that `Page.frameRequestedNavigation` carries as of Chromium 141.
 */
export type BrowserNavigationReason =
	| 'anchorClick'
	| 'formSubmissionGet'
	| 'formSubmissionPost'
	| 'httpHeaderRefresh'
	| 'initialFrameNavigation'
	| 'metaTagRefresh'
	| 'other'
	| 'pageBlockInterstitial'
	| 'reload'
	| 'scriptInitiated'

/**
 * Describes the navigation a record settled.
 *
 * @remarks
 * - `url` — the requested URL for `requested`, and the committed URL otherwise
 * - `stage` — how far the navigation got
 * - `reason` — why the frame requested the navigation, from `Page.frameRequestedNavigation`;
 *   undefined for a navigation the protocol announced with no reason, such as one the browser
 *   started
 */
export interface BrowserSettlementResult {
	readonly url: string
	readonly stage: BrowserNavigationStage
	readonly reason: BrowserNavigationReason | undefined
}

/**
 * Maps the navigation steps a page accepts from the session that owns each frame, which it hands to
 * its navigation and element managers.
 *
 * @remarks
 * - `request` — a frame started a navigation, with its loader when the protocol names one and its
 *   reason when the latest current-tab `Page.frameRequestedNavigation` for the frame since its
 *   previous start, from any session the page knows, named the same URL and a known reason and the
 *   start repeats no history entry
 * - `commit` — a frame committed a document, or a same-document navigation when `same` is `true`
 * - `load` — a frame's document loaded, with the loader of its commit
 * - `detach` — a frame left its document; `swapped` is `true` when the frame persists in another
 *   renderer
 */
export type BrowserNavigationEventMap = {
	readonly request: readonly [
		frame: string,
		url: string,
		loader: string | undefined,
		reason: BrowserNavigationReason | undefined,
	]
	readonly commit: readonly [frame: string, url: string, loader: string | undefined, same: boolean]
	readonly load: readonly [frame: string, loader: string | undefined]
	readonly detach: readonly [frame: string, swapped: boolean]
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
 * Describes the options for taking a page screenshot.
 *
 * @remarks
 * - `path` — file path to persist the screenshot to, through the page's writer
 * - `full` — capture the full scrollable page (default `false`)
 * - `format` — image format (default `'png'`)
 * - `quality` — JPEG quality 0–100 (ignored for PNG)
 * - `mask` — elements whose current boxes the capture covers with `color`; a gone element rejects the capture
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
	readonly mask?: readonly BrowserPageElementInterface[]
	readonly color?: string
}

/**
 * Describes the result of a page screenshot.
 *
 * @remarks
 * - `bytes` — raw image bytes
 * - `path` — file path if persisted through the page's writer, otherwise undefined
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
	/** Reads the object back by value. */
	value(options?: BrowserCallOptions): Promise<unknown>
	/** Runs a function declaration with the handle as `this`, by value. */
	call(
		declaration: string,
		args?: readonly unknown[],
		options?: BrowserCallOptions,
	): Promise<unknown>
	/**
	 * Retains one own property as its own handle, or returns `undefined` when the property is
	 * absent.
	 */
	property(name: string, options?: BrowserCallOptions): Promise<BrowserHandleInterface | undefined>
	/** Reads every own property by value. */
	properties(options?: BrowserCallOptions): Promise<Readonly<Record<string, unknown>>>
	/** Releases the retained remote object. Idempotent. */
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
	/** Installs a script evaluated on every new document, and returns its identifier. */
	add(source: string): Promise<string>
	/** Removes one installed script by identifier. */
	remove(id: string): Promise<void>
	/** Binds a host function to a page-global name, callable from page JavaScript. */
	expose(name: string, handler: BrowserBindingHandler): Promise<void>
	/** Removes one exposed binding and its installed bridge script. */
	revoke(name: string): Promise<void>
	/** Removes every installed script and binding this manager owns. */
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
	/** Reads the full accessibility tree, optionally pruned to the interesting nodes. */
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
	/**
	 * Begins tracing with the given categories. Throws a `BrowserError` when a trace is
	 * already active.
	 */
	start(options?: BrowserTracingOptions): Promise<void>
	/**
	 * Ends tracing, drains the IO stream, and writes it through the page writer when a path
	 * was set.
	 */
	stop(): Promise<BrowserTracingResult>
	/**
	 * Stops an active trace, discarding any failure, and does nothing when no trace is
	 * running.
	 */
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
	/**
	 * Arms the requested domains. Throws a `BrowserError` when collection is already active or
	 * when neither domain is requested.
	 */
	start(options?: BrowserCoverageOptions): Promise<void>
	/** Reads the collected usage and disarms every domain it armed. */
	stop(): Promise<BrowserCoverageResult>
	/**
	 * Stops an active collector, discarding any failure, and does nothing when no collection
	 * is running.
	 */
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
	/** Enables the domain, reads every metric, and disables the domain again. */
	metrics(): Promise<readonly BrowserMetric[]>
}

/** Drives the sampled CPU profile lifecycle. */
export interface BrowserProfilerInterface {
	readonly active: boolean
	/**
	 * Begins sampling, optionally at an explicit positive integer interval in microseconds.
	 */
	start(interval?: number): Promise<void>
	/** Ends sampling and decodes the profile's nodes, samples, and time deltas. */
	stop(): Promise<BrowserProfile>
	/**
	 * Stops an active profiler, discarding any failure, and does nothing when no profile is
	 * running.
	 */
	destroy(): Promise<void>
}

/** Groups the diagnostics by capability. */
export interface BrowserDiagnosticsInterface {
	readonly tracing: BrowserTracingInterface
	readonly coverage: BrowserCoverageInterface
	readonly performance: BrowserPerformanceInterface
	readonly profiler: BrowserProfilerInterface
	/** Tears down every diagnostics capability this page's group owns. */
	destroy(): Promise<void>
}

// === Browser clock

/** Controls Chromium virtual time for deterministic page timers. */
export interface BrowserClockInterface {
	readonly installed: boolean
	/** Takes over the page clock, optionally seeding it with an epoch time. */
	install(time?: number): Promise<void>
	/** Suspends virtual time so no page timer advances. */
	pause(): Promise<void>
	/** Continues virtual time after a pause. */
	resume(): Promise<void>
	/**
	 * Moves virtual time forward by the given milliseconds, firing the timers that fall due.
	 */
	advance(ms: number): Promise<void>
	/** Returns the page to the real clock, and does nothing when no clock was installed. */
	uninstall(): Promise<void>
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
 * validator answers for a mouse click, a mouse drag, and keyboard entry alike.
 */
export type BrowserOperationOptions = BrowserClickOptions & BrowserDragOptions

/** Provides keyboard input operations bound to one frame target session. */
export interface BrowserKeyboardInterface {
	/**
	 * Presses one key and holds it, retaining it in the modifier mask when it is a modifier.
	 */
	down(key: string): Promise<void>
	/**
	 * Releases one key, dropping it from the modifier mask even when the release frame fails.
	 */
	up(key: string): Promise<void>
	/**
	 * Presses a chord: holds its modifiers, presses and releases its terminal key, then
	 * releases the modifiers.
	 */
	press(key: string, options?: BrowserInputOptions): Promise<void>
	/** Types a string as one press and release per character. */
	type(value: string, options?: BrowserInputOptions): Promise<void>
	/** Inserts composed text in one frame, firing no per-key events. */
	insert(value: string): Promise<void>
}

/** Provides mouse input operations bound to one frame target session. */
export interface BrowserMouseInterface {
	/** Moves the pointer to a point, carrying the pressed buttons. */
	move(point: BrowserPoint): Promise<void>
	/** Presses a button at the current point, adding it to the pressed mask. */
	down(button?: BrowserMouseButton, count?: number): Promise<void>
	/**
	 * Releases a button at the current point, dropping it from the mask even when the frame
	 * fails.
	 */
	up(button?: BrowserMouseButton, count?: number): Promise<void>
	/** Moves to the given point, presses, optionally delays, and releases. */
	click(point: BrowserPoint, options?: BrowserClickOptions): Promise<void>
	/** Presses at the start, moves in the requested steps to the end, and releases. */
	drag(start: BrowserPoint, end: BrowserPoint, options?: BrowserDragOptions): Promise<void>
	/** Sends a wheel delta at the current point. */
	wheel(delta: BrowserPoint): Promise<void>
}

/** Provides touch input operations bound to one frame target session. */
export interface BrowserTouchInterface {
	/**
	 * Dispatches a touch start at the point and a touch end, cancelling the touch on failure.
	 */
	tap(point: BrowserPoint): Promise<void>
}

/** Describes the actionability checks performed before element input. */
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
	/**
	 * Accepts the dialog, optionally supplying prompt text. Throws when the dialog is already
	 * handled.
	 */
	accept(value?: string): Promise<void>
	/** Dismisses the dialog. Throws when the dialog is already handled. */
	dismiss(): Promise<void>
}

/** Represents one intercepted file chooser. */
export interface BrowserFileChooserInterface {
	readonly multiple: boolean
	/**
	 * Sets the chosen files. Throws when a single-file chooser is given several, and when the
	 * chooser is already handled.
	 */
	upload(files: readonly string[]): Promise<void>
	/** Dismisses the chooser with an empty selection. Throws when the chooser is already handled. */
	dismiss(): Promise<void>
}

/** Names a download lifecycle phase. */
export type BrowserDownloadStatus = 'pending' | 'complete' | 'aborted'

/** Maps the download progress events. */
export type BrowserDownloadEventMap = {
	readonly progress: readonly [received: number, total: number]
	readonly complete: readonly [path: string | undefined]
	readonly abort: readonly []
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
	/**
	 * Aborts the download by sending CDP `Browser.cancelDownload`, and is ignored unless the
	 * status is still pending. The status becomes `'aborted'` and the `abort` event fires.
	 */
	abort(): Promise<void>
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
	/** Evaluates a guarded expression in the worker and returns its value. */
	evaluate(expression: string, options?: BrowserCallOptions): Promise<unknown>
	/** Issues one CDP method call on the worker's session. */
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<unknown>
	/** Stops driving the worker locally without closing its target. */
	detach(): void
	/** Closes the worker target, tolerating a worker that already terminated. Idempotent. */
	close(): Promise<void>
}

/** Maps the typed page, frame, target, and user-visible browser events. */
export type BrowserPageEventMap = {
	readonly navigate: readonly [url: string, same: boolean]
	readonly session: readonly [frame: BrowserFrameInterface]
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
	/** Fails the request with a Chromium error reason, `'Failed'` by default. */
	abort(reason?: string): Promise<void>
	/**
	 * Lets the request proceed, optionally overriding its URL, method, headers, or post body.
	 */
	continue(options?: BrowserRouteContinueOptions): Promise<void>
	/**
	 * Answers the request locally. Throws when the status is not an integer from 100 to 999.
	 */
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
	/** Begins recording exchanges, optionally capturing response content. */
	start(options?: BrowserHAROptions): Promise<void>
	/** Ends recording and returns the archive, writing it when a path was given. */
	stop(): Promise<BrowserHAR>
	/** Serves matching requests from an archive instead of from the network. */
	replay(har: BrowserHAR, options?: BrowserHARReplayOptions): Promise<void>
	/** Drops the recorded entries and any active replay without ending the recording. */
	clear(): Promise<void>
}

/** Provides page-scoped network observation and interception. */
export interface BrowserNetworkManagerInterface {
	readonly emitter: EmitterInterface<BrowserNetworkEventMap>
	readonly har: BrowserHARManagerInterface
	/** Enables the Network domain and subscribes to its events. Idempotent. */
	start(): Promise<void>
	/** Reads one observed response body as bytes. */
	body(id: string): Promise<Uint8Array>
	/** Reads one observed response body as text. */
	text(id: string): Promise<string>
	/** Reads one observed response body as parsed JSON. */
	json(id: string): Promise<unknown>
	/** Intercepts requests matching the query and hands each one to the handler. */
	route(query: BrowserRouteQuery, handler: BrowserRouteHandler): Promise<void>
	/** Removes one handler's routes, or every route when given none. */
	unroute(handler?: BrowserRouteHandler): Promise<void>
	/** Applies extra HTTP headers to every request the page makes. */
	headers(headers: Readonly<Record<string, string>>): Promise<void>
	/** Emulates an offline connection, or restores connectivity. */
	offline(offline: boolean): Promise<void>
	/** Applies HTTP basic-auth credentials, or clears them when given none. */
	credentials(credentials?: BrowserCredentials): Promise<void>
	/** Removes every route, unsubscribes, and disables the domains this manager enabled. */
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
	/** Reads the context cookies, optionally narrowed to the given URLs. */
	cookies(urls?: readonly string[]): Promise<readonly BrowserCookie[]>
	/** Writes the given cookies into the context. */
	set(cookies: readonly BrowserCookieInput[]): Promise<void>
	/** Deletes the context cookies matching the filter, or every cookie when given none. */
	clear(filter?: BrowserCookieFilter): Promise<void>
}

/** Provides permission override operations scoped to one browser context. */
export interface BrowserPermissionManagerInterface {
	/** Grants each named permission, optionally for one origin, as its own CDP frame. */
	grant(permissions: readonly string[], origin?: string): Promise<void>
	/** Denies each named permission, optionally for one origin, as its own CDP frame. */
	deny(permissions: readonly string[], origin?: string): Promise<void>
	/** Resets every permission override on the context. */
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
	/** Reads the context cookies and the per-origin local and session storage. */
	state(options?: BrowserStorageOptions): Promise<BrowserStorageState>
	/** Writes a previously read state back into the context. */
	restore(state: BrowserStorageState): Promise<void>
	/** Drops the storage of one origin, or of every origin when given none. */
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
	/**
	 * Clears the superseded overrides and applies the given ones to every page of the context.
	 */
	apply(options: BrowserEmulationOptions): Promise<void>
	/** Removes every override this manager applied. */
	clear(): Promise<void>
	/** Applies the retained overrides to a newly created page. */
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

/**
 * Describes the options for creating and configuring an isolated browser context.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 * - `proxy` — proxy server and bypass list for the context
 * - `origins` — origins granted universal network access
 * - `downloads` — download policy for the context
 * - `emulation` — emulation overrides inherited by every page of the context
 */
export interface BrowserContextOptions {
	readonly on?: EmitterHooks<BrowserContextEventMap>
	readonly error?: EmitterErrorHandler
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

// === Browser journeys

/** Binds a native action's string argument to a literal or to one declared parameter by name. */
export type BrowserJourneyBinding = string | { readonly parameter: string }

/**
 * Declares one parameter a journey takes: its default, or none when it is a secret.
 *
 * @remarks
 * - `default` — the text a replay uses when its inputs omit the parameter
 * - `secret` — if `true`, the parameter binds `type.text` only, has no default, and makes every
 *   `type` step whose `text` binds it secret; if `false` or omitted, the parameter is plain text
 *
 * A parameter's name matches `BROWSER_JOURNEY_PARAMETER_PATTERN`.
 */
export interface BrowserJourneyParameter {
	readonly default?: string
	readonly secret?: boolean
}

/**
 * Names the element an acting step acts on the way a receipt names it, with the record-time
 * evidence a developer reads when a resolution is refused.
 *
 * @remarks
 * - `role` — the element's accessibility role
 * - `name` — the element's exact accessible name, as a literal or a binding
 * - `css` — a CSS selector recorded as evidence; resolution never reads it
 * - `reference` — the record-time element reference, as evidence; resolution never reads it
 */
export interface BrowserJourneyTarget {
	readonly role: string
	readonly name: BrowserJourneyBinding
	readonly css?: string
	readonly reference?: string
}

/**
 * Names the tab a `switch` step moves to, portably.
 *
 * @remarks
 * - `url` and `title` — the tab's address and document title, which resolve the tab from `tabs`
 */
export interface BrowserJourneyTab {
	readonly url: string
	readonly title: string
}

/**
 * Describes one step before it holds an id: a call of a toolset tool with its element or tab named
 * as data.
 *
 * @remarks
 * - `action` — `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page
 *   tool's name, or `unresolved`
 * - `arguments` — the call's arguments; for a native action without `ref` or `tab`, its string
 *   arguments binding a parameter; for a page tool, its literal JSON as sent
 * - `target` — present exactly when a native action takes `ref`
 * - `tab` — present exactly for `switch`
 * - `gap` — on `unresolved`, why the recorder could not express the gesture; preparation refuses
 *   the journey
 */
export interface BrowserJourneyStepInput {
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJourneyBinding | JSONValue>>
	readonly target?: BrowserJourneyTarget
	readonly tab?: BrowserJourneyTab
	readonly gap?: string
}

/**
 * Describes a step with its identity: `s` followed by a positive integer, stable across edits and
 * never reused.
 */
export interface BrowserJourneyStep extends BrowserJourneyStepInput {
	readonly id: string
}

/**
 * Describes one user intent as data; `next` is the number the next added step takes.
 *
 * @remarks
 * - `format` — the file format, `BROWSER_JOURNEY_FORMAT_VERSION`
 * - `name` — the journey's name, matching `BROWSER_JOURNEY_NAME_PATTERN`
 * - `description` — what the journey achieves, in one sentence
 * - `parameters` — the declared parameters by name
 * - `next` — the number the next added step takes, persisted so a removed id is never reused
 * - `steps` — the steps in order
 */
export interface BrowserJourney {
	readonly format: 1
	readonly name: string
	readonly description: string
	readonly parameters: Readonly<Record<string, BrowserJourneyParameter>>
	readonly next: number
	readonly steps: readonly BrowserJourneyStep[]
}

/**
 * Carries a journey with the revision the store assigned; `revision` is absent for a journey the
 * store never held.
 */
export interface BrowserJourneyRevision {
	readonly journey: BrowserJourney
	readonly revision?: number
}

/**
 * Describes one change to a journey; `editBrowserJourney` applies a batch to a copy, in order, and
 * refuses it whole on the first invalid edit.
 *
 * @remarks
 * - `add` — inserts `step` with the next id, before or after the step `before` or `after` names
 * - `remove` — removes the step `id` names
 * - `update` — merges `arguments` into the step `id` names by key, and replaces its `target` or
 *   `tab`
 * - `declare` — declares the parameter `name` names, which a step binds at the end of the batch
 *
 * A refused batch rejects with `BROWSER_JOURNEY_EDIT`, naming the edit's index and the reason.
 */
export type BrowserJourneyEdit =
	| {
			readonly operation: 'add'
			readonly step: BrowserJourneyStepInput
			readonly before?: string
			readonly after?: string
	  }
	| { readonly operation: 'remove'; readonly id: string }
	| {
			readonly operation: 'update'
			readonly id: string
			readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | JSONValue>>
			readonly target?: BrowserJourneyTarget
			readonly tab?: BrowserJourneyTab
	  }
	| {
			readonly operation: 'declare'
			readonly name: string
			readonly parameter: BrowserJourneyParameter
	  }

/**
 * Describes an edit as the `edit` tool receives it over the wire: an added or updated step can name
 * `ref` instead of a target, converted from the current view before the pure editor runs.
 */
export type BrowserJourneyEditRequest =
	| BrowserJourneyEdit
	| {
			readonly operation: 'add'
			readonly step: Omit<BrowserJourneyStepInput, 'target'> & { readonly ref?: string }
			readonly before?: string
			readonly after?: string
	  }
	| {
			readonly operation: 'update'
			readonly id: string
			readonly ref?: string
			readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | JSONValue>>
	  }

/**
 * Maps the events a recorder emits.
 *
 * @remarks
 * - `start` — recording started
 * - `step` — one step was recorded
 * - `stop` — recording stopped, carrying the recorded steps
 * - `clear` — the recorded steps were dropped
 */
export type BrowserRecorderEventMap = {
	readonly start: readonly []
	readonly step: readonly [step: BrowserJourneyStep]
	readonly stop: readonly [steps: readonly BrowserJourneyStep[]]
	readonly clear: readonly []
}

/**
 * Records the steps of a journey from one source as they happen and turns them into a journey.
 *
 * @remarks
 * - `emitter` — emits `start`, `step`, `stop`, and `clear`
 * - `started` — true while recording; false otherwise
 */
export interface BrowserRecorderInterface {
	readonly emitter: EmitterInterface<BrowserRecorderEventMap>
	readonly started: boolean
	/** Begins recording from the recorder's source. */
	start(): Promise<void>
	/** Stops recording and returns the recorded steps. */
	stop(): Promise<readonly BrowserJourneyStep[]>
	/** Returns the steps recorded so far. */
	steps(): readonly BrowserJourneyStep[]
	/**
	 * Returns the recorded steps as a journey with that name and description, with its parameters
	 * derived: every secret marker declares a secret parameter named after its control's accessible
	 * name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and
	 * so on when the derived name is invalid or taken; `next` is one past the highest id.
	 */
	journey(options: { readonly name: string; readonly description: string }): BrowserJourney
	/** Drops the recorded steps. */
	clear(): void
	/** Stops recording and releases the recorder's listeners. */
	destroy(): Promise<void>
}

/**
 * Configures a recorder.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 */
export interface BrowserRecorderOptions {
	readonly on?: EmitterHooks<BrowserRecorderEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Describes what became of one action the toolset performed.
 *
 * @remarks
 * - `action` — the tool's name
 * - `arguments` — the call's arguments, without the text of a secret `type`
 * - `target` — the element the call's reference resolved to, captured before the input was
 *   dispatched: its role, exact accessible name, reference, and, in the page placement, frame
 * - `tab` — the tab a `switch` moved to, or the popup a `click`, a `type` with `submit`, or a
 *   `press` of Enter opened and moved the view to
 * - `secret` — if `true`, the action was a secret `type`
 * - `outcome` — how the action ended
 * - `stage` and `reason` — the stage and reason of the navigation the action settled, when one
 *   started
 * - `receipt` — the receipt line the tool returned
 * - `elapsed` — the milliseconds the action took
 */
export interface BrowserAction {
	readonly action: string
	readonly arguments: Readonly<Record<string, JSONValue>>
	readonly target?: {
		readonly role: string
		readonly name: string
		readonly reference: string
		readonly frame?: string
	}
	readonly tab?: BrowserJourneyTab
	readonly secret?: boolean
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly receipt: string
	readonly elapsed: number
}

/**
 * Names how one step ended.
 *
 * @remarks
 * - `done` — the action completed
 * - `refused` — the toolset refused the action
 * - `timeout` — the text a `wait` names did not appear
 * - `interrupted` — a dialog opened during the input, which stays pending until a `dialog` step
 */
export type BrowserStepOutcome = 'done' | 'refused' | 'timeout' | 'interrupted'

/**
 * Names how a run ended.
 *
 * @remarks
 * - `complete` — every step completed
 * - `stopped` — a step did not complete, and no step after it ran
 * - `aborted` — the call's signal aborted the run
 */
export type BrowserRunOutcome = 'complete' | 'stopped' | 'aborted'

/**
 * Carries a performed call's tool result beside its structured action, present when the call
 * reached a handler.
 *
 * @remarks
 * - `result` — the tool result `tools.execute` returns for the same call
 * - `action` — what became of the action; absent for a call the manager refused before any handler
 */
export interface BrowserToolsetResult {
	readonly result: ToolResult
	readonly action?: BrowserAction
}

/**
 * Owns the toolset while a replay runs; `destroy` releases it.
 *
 * @remarks
 * - `token` — the caller identity an action carries as `context.caller` to run under the hold
 * - `name` — the name of the journey the hold replays
 */
export interface BrowserHoldInterface {
	readonly token: string
	readonly name: string
	/** Releases the toolset to the calls behind the hold. */
	destroy(): void
}

/**
 * Describes one replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's
 * `JournalStep` fields.
 *
 * @remarks
 * - `id` — the step's id
 * - `action` — the step's action
 * - `trigger` — a target's exact name for `click` and `type`; the key for `press`; the URL for
 *   `navigate`; the text for `wait`; the tab's title for `switch`; `accept` or `dismiss` for
 *   `dialog`; the tool's name for a page tool
 * - `arguments` — the call's arguments with the bindings substituted, without a secret's value
 * - `outcome`, `stage`, and `reason` — as the step's `BrowserAction` reports them
 * - `result` — the step's receipt, or the refusal that stopped the run at the step
 * - `capture` — the file name of the step's capture in the page placement, such as `s2.png`
 * - `elapsed` — the milliseconds the step took
 */
export interface BrowserRunStep {
	readonly id: string
	readonly action: string
	readonly trigger: string
	readonly arguments: Readonly<Record<string, JSONValue>>
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly result: string
	readonly capture?: string
	readonly elapsed: number
}

/**
 * Describes one run of a journey; `inputs` omits secret values; `fault` carries the run file's
 * write failure.
 *
 * @remarks
 * - `format` — the file format, `BROWSER_JOURNEY_FORMAT_VERSION`
 * - `id` — the run id, the ISO time with `-` for `:` followed by `-` and 4 hexadecimal digits
 * - `journey` and `revision` — the journey replayed and the revision the store held it at
 * - `inputs` — the parameter values the run used, without a secret's value
 * - `steps` — the replayed steps in order
 * - `outcome` — how the run ended
 * - `output` — the page's `console` and `error` events during the run, in the page placement;
 *   absent for a journey with a secret parameter
 * - `elapsed` — the milliseconds the run took
 * - `fault` — why writing the run file failed
 */
export interface BrowserRun {
	readonly format: 1
	readonly id: string
	readonly journey: BrowserJourney
	readonly revision?: number
	readonly inputs: Readonly<Record<string, string>>
	readonly steps: readonly BrowserRunStep[]
	readonly outcome: BrowserRunOutcome
	readonly output?: readonly string[]
	readonly elapsed: number
	readonly fault?: string
}

/**
 * Configures one replay.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 * - `inputs` — each parameter's value by name, merged over the parameters' defaults
 * - `runs` — the store the run is written to; omitting it writes no run
 */
export interface BrowserReplayOptions {
	readonly on?: EmitterHooks<BrowserReplayEventMap>
	readonly error?: EmitterErrorHandler
	readonly inputs?: Readonly<Record<string, string>>
	readonly runs?: BrowserRunStoreInterface
}

/**
 * Maps the events a replay emits.
 *
 * @remarks
 * - `step` — one step was replayed
 */
export type BrowserReplayEventMap = { readonly step: readonly [step: BrowserRunStep] }

/**
 * Replays one journey over a toolset.
 *
 * @remarks
 * - `emitter` — emits `step`
 */
export interface BrowserReplayInterface {
	readonly emitter: EmitterInterface<BrowserReplayEventMap>
	/**
	 * Prepares the journey, holds the toolset, performs each step in order, and resolves with the
	 * run, which stops at the first step that did not complete. Rejects with a coded `BrowserError`
	 * at preparation, before any side effect, and on a destroyed toolset.
	 */
	execute(options?: BrowserCallOptions): Promise<BrowserRun>
}

/**
 * Carries the signal a store call honours.
 *
 * @remarks
 * - `signal` — aborts the call; the promise rejects with `signal.reason`
 */
export interface BrowserStoreOptions {
	readonly signal?: AbortSignal
}

/**
 * Names one entry a listing could not read.
 *
 * @remarks
 * - `path` — the entry's path
 * - `message` — why the entry could not be read
 */
export interface BrowserStoreFault {
	readonly path: string
	readonly message: string
}

/**
 * Carries one page of a listing with the entries it could not read.
 *
 * @remarks
 * - `entries` — the entries of the page, in order
 * - `truncated` — true when more entries follow the page; false otherwise
 * - `faults` — the entries the listing could not read
 */
export interface BrowserStorePage<T> {
	readonly entries: readonly T[]
	readonly truncated: boolean
	readonly faults: readonly BrowserStoreFault[]
}

/** Keeps journeys by name with a revision per write. */
export interface BrowserJourneyStoreInterface {
	/**
	 * Returns the journey saved under `name` with its revision, or `undefined` when none is saved.
	 * Rejects with `BROWSER_JOURNEY_FILE` for a malformed entry, `BROWSER_JOURNEY_FORMAT` for an
	 * unknown format, and `BROWSER_JOURNEY_ACCESS` for a permission error, each naming the path.
	 */
	get(name: string, options?: BrowserStoreOptions): Promise<BrowserJourneyRevision | undefined>
	/**
	 * Saves the journey under its name with the next revision and returns it. Rejects with
	 * `BROWSER_JOURNEY_STALE` when `expected` differs from the stored revision, and with
	 * `BROWSER_JOURNEY_LOCKED` when another write holds the name.
	 */
	set(
		journey: BrowserJourney,
		expected?: number,
		options?: BrowserStoreOptions,
	): Promise<BrowserJourneyRevision>
	/**
	 * Removes the journey saved under `name` and keeps its revision count, so a recreated journey
	 * continues it; a missing name is a no-op. Rejects with `BROWSER_JOURNEY_LOCKED` when another
	 * write holds the name.
	 */
	delete(name: string, options?: BrowserStoreOptions): Promise<void>
	/**
	 * Returns one page of the saved journeys sorted by name, starting at `offset` and holding at
	 * most `limit` entries, with the entries it could not read in `faults`.
	 */
	list(
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserJourneyRevision>>
}

/**
 * Names the run directory a store opened, as data.
 *
 * @remarks
 * - `id` — the run id
 * - `directory` — the run directory the store created; absent for a store without directories.
 *   A capture is written through the store's `capture` method, never by the caller.
 */
export interface BrowserRunSlot {
	readonly id: string
	readonly directory?: string
}

/** Keeps runs by the journey name and run id the run carries. */
export interface BrowserRunStoreInterface {
	/** Mints a run id for the journey and creates its run directory exclusively. */
	open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot>
	/** Returns the run stored under the journey name and id, or `undefined` when none is stored. */
	get(name: string, id: string, options?: BrowserStoreOptions): Promise<BrowserRun | undefined>
	/** Writes the run under the journey name and the run id it carries. */
	set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void>
	/**
	 * Writes capture bytes under the name into the run directory `open` created for the slot.
	 * @param slot - Slot opened by this store
	 * @param name - Capture file name
	 * @param bytes - Screenshot bytes to persist
	 * @param options - Cancellation options
	 * @returns Name the step records, or `undefined` for a store without directories
	 * @throws {@link BrowserError} Thrown with `BROWSER_JOURNEY_PATH` when this store did not open the slot.
	 */
	capture(
		slot: BrowserRunSlot,
		name: string,
		bytes: Uint8Array,
		options?: BrowserStoreOptions,
	): Promise<string | undefined>
	/** Removes the run stored under the journey name and id; a missing run is a no-op. */
	delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void>
	/**
	 * Returns one page of the journey's runs, starting at `offset` and holding at most `limit`
	 * entries, with the entries it could not read in `faults`.
	 */
	list(
		name: string,
		options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number },
	): Promise<BrowserStorePage<BrowserRun>>
}

/**
 * Configures the journey toolset a toolset constructs.
 *
 * @remarks
 * - `store` — keeps the journeys the tools record, list, edit, and replay
 * - `runs` — keeps each replay's run; omitting it writes no run
 * - `readonly` — if `true`, refuses `record`, `save`, and `edit` before any store access, and
 *   `replay` still writes runs; if `false` or omitted, every tool runs
 */
export interface BrowserJourneyOptions {
	readonly store: BrowserJourneyStoreInterface
	readonly runs?: BrowserRunStoreInterface
	readonly readonly?: boolean
}

/**
 * Registers the five journey tools over a toolset and owns the recording and the active replay.
 *
 * @remarks
 * - `recording` — the name of the journey being recorded, or `undefined` when none is
 * - `replaying` — the name of the journey being replayed, or `undefined` when none is
 */
export interface BrowserJourneyToolsetInterface {
	readonly recording: string | undefined
	readonly replaying: string | undefined
	/** Aborts the active replay and removes the five journey tools from the manager. */
	destroy(): Promise<void>
}

// === Browser codegen

/** Names the target language for a compiled codegen script. */
export type BrowserCodegenLanguage = 'javascript' | 'typescript'

/**
 * Carries the module `compileBrowserJourney` emits with the gap steps that refuse it.
 *
 * @remarks
 * - `source` — the standalone module, which imports only `@orkestrel/browser`
 * - `gaps` — one entry per gap step, in step order; the module throws at the first before any
 *   step and marks each with a comment at its position
 */
export interface BrowserCodegenScript {
	readonly source: string
	readonly gaps: readonly string[]
}

/** Records semantic page gestures and compiles the resulting journey. */
export interface BrowserCodegenInterface extends BrowserRecorderInterface {
	/** Compiles the recorded journey into a standalone module and lists its gaps. */
	script(options: {
		readonly name: string
		readonly description: string
		readonly language?: BrowserCodegenLanguage
	}): BrowserCodegenScript
}

/** Carries a sanitized gesture from the page listener without password values. */
export interface BrowserCodegenGesture {
	readonly event: 'click' | 'input' | 'change' | 'keydown' | 'focusout' | 'submit' | 'unsupported'
	readonly index: number
	readonly top: boolean
	readonly control: 'text' | 'password' | 'select' | 'multiple' | 'option' | 'other'
	readonly form: boolean
	readonly detail?: number
	readonly key?: 'Enter'
	readonly value?: string
	readonly secret?: true
	readonly roundtrip?: boolean
	readonly gap?: string
}

// === Browser reading

/**
 * Describes the options for one slice of a reading's Markdown or plain-text projection.
 *
 * @remarks
 * - `distill` — if `true`, projects the distilled document; if `false`, projects the whole
 *   document. Default: `true`
 * - `offset` — the character index the slice starts at, a non-negative integer. Default: `0`
 * - `limit` — the most characters the slice holds, a positive integer. Default: unbounded
 *
 * Characters are UTF-16 code units, the unit `String.prototype.length` counts.
 */
export interface BrowserReadOptions {
	readonly distill?: boolean
	readonly offset?: number
	readonly limit?: number
}

/**
 * Describes one slice of a reading's projection.
 *
 * @remarks
 * - `text` — the characters of the slice
 * - `offset` — the character index the slice starts at
 * - `total` — the character count of the whole projection
 *
 * The projection continues past the slice while `offset + text.length < total`, and the next
 * slice starts at that sum.
 */
export interface BrowserReadResult {
	readonly text: string
	readonly offset: number
	readonly total: number
}

/**
 * Reads the navigation epoch of the frame a reading was captured from.
 *
 * @returns The frame's current navigation epoch
 */
export type BrowserEpochFunction = () => number

/**
 * Describes the captured document a reading is built from.
 *
 * @remarks
 * - `url` — the document URL, which distillation resolves relative links against
 * - `title` — the document title
 * - `html` — the serialized document HTML
 * - `epoch` — the navigation epoch recorded when the capture was issued. Default: the value
 *   `navigation` returns at construction
 * - `navigation` — reads the source's navigation epoch at the moment of the call; a reading
 *   built without it never reports stale
 */
export interface BrowserReadingInput {
	readonly url: string
	readonly title: string
	readonly html: string
	readonly epoch?: number
	readonly navigation?: BrowserEpochFunction
}

/**
 * Represents one captured document, parsed one time and projected to Markdown or plain text in
 * bounded slices.
 *
 * @remarks
 * - `url` — the document URL at capture
 * - `title` — the document title at capture
 * - `html` — the parsed document handle every projection reads
 * - `stale` — true when the source frame has navigated or detached since the capture; false
 *   otherwise
 *
 * Each projection runs over `html.distill({ base: url })` by default and over the whole document
 * with `distill: false`. A reading computes each projection one time and cuts every slice from
 * it, so successive slices of one reading and mode share one `total`.
 */
export interface BrowserReadingInterface {
	readonly url: string
	readonly title: string
	readonly html: HTMLInterface
	readonly stale: boolean
	/**
	 * Returns a slice of the document rendered as Markdown. A bounded slice ends after the
	 * last line break in its window when one lies past `offset`, and at `limit` characters
	 * otherwise.
	 */
	markdown(options?: BrowserReadOptions): BrowserReadResult
	/**
	 * Returns a slice of the document rendered as structural plain text, cut by the rule
	 * `markdown` applies.
	 */
	text(options?: BrowserReadOptions): BrowserReadResult
}

// === Browser frame

/** Resolves the current CDP session for a frame id. */
export type BrowserSessionFunction = (frame: string) => Promise<string>

/**
 * Resolves the isolated-world execution context a page caches for one frame document, creating
 * the world on the given session when none is cached.
 *
 * @param session - The CDP session that owns the frame
 * @param options - The deadline and signal for the creation call
 * @returns The isolated-world execution context id
 */
export type BrowserWorldFunction = (
	session: string,
	options?: BrowserCallOptions,
) => Promise<number>

/**
 * Describes an accessibility or CSS query within an optional element reference.
 *
 * @remarks
 * - `exact` — if `true`, `name` matches the whole accessible name after whitespace normalization,
 *   case-sensitively; if `false` or omitted, `name` matches a case-insensitive substring
 */
export interface BrowserElementQuery {
	readonly role?: string
	readonly name?: string
	readonly css?: string
	readonly within?: string
	readonly exact?: boolean
}

/** Configures an element wait, including whether absence satisfies it. */
export interface BrowserElementWaitOptions extends BrowserCallOptions {
	readonly absent?: boolean
}

/** Configures an outline's element limit and optional subtree. */
export interface BrowserOutlineOptions extends BrowserCallOptions {
	readonly limit?: number
	readonly within?: string
}

/** Carries a document-order outline and its included and available element counts. */
export interface BrowserOutline {
	readonly url: string
	readonly title: string
	readonly text: string
	readonly count: number
	readonly total: number
}

/** Associates an outline row with its frame, session, and optional actionable reference. */
export interface BrowserOutlineNode extends BrowserAXNode {
	readonly session: string
	readonly reference: string | undefined
	readonly tool?: string
}

/** Retains both session-local and page-composed element geometry. */
export interface BrowserElementGeometry {
	readonly local: BrowserQuad
	readonly page: BrowserQuad
}

/** Identifies a manager failure without inventing an element reference. */
export interface BrowserElementSubject {
	readonly subject: string
}

/**
 * Identifies the refusal an element action reports.
 *
 * @remarks
 * `UNTRUSTED` names an action an untrusted event cannot perform on a current reference, such as
 * opening a file chooser or another browsing context; a fresh reference changes nothing.
 */
export type BrowserElementReason =
	| 'GONE'
	| 'HIDDEN'
	| 'OCCLUDED'
	| 'DISABLED'
	| 'UNTRUSTED'
	| 'UNKNOWN'

/**
 * Describes how an element action reports one refusal its compiled in-page check throws: the
 * reason, and the detail that follows the element's name, or `undefined` for the reason's own
 * wording.
 */
export interface BrowserElementRefusal {
	readonly reason: BrowserElementReason
	readonly detail: string | undefined
}

/** Allocates the next reference from the owning browser context. */
export type BrowserReferenceFunction = () => string

/** Resolves the page-owned isolated world for a particular frame and session. */
export type BrowserElementWorldFunction = (
	frame: string,
	session: string,
	options?: BrowserCallOptions,
) => Promise<number>

/** Waits for the current document's DOM readiness. */
export type BrowserReadinessFunction = (options?: BrowserCallOptions) => Promise<void>

/** Composes a frame-local point into page coordinates. */
export type BrowserElementPointFunction = (
	frame: string,
	point: BrowserPoint,
	options?: BrowserCallOptions,
) => Promise<BrowserPoint>

/**
 * Provides the protocol and ownership boundaries used by a page element manager.
 *
 * @remarks
 * - `steps` — the navigation steps the page accepts from the session that owns each frame
 */
export interface BrowserElementManagerInput {
	readonly navigation: (frame: string) => number
	readonly steps: EmitterInterface<BrowserNavigationEventMap>
	readonly page: BrowserPageInterface
	readonly client: CDPClientInterface
	readonly session: string
	readonly resolve: BrowserSessionFunction
	readonly world: BrowserElementWorldFunction
	readonly reference: BrowserReferenceFunction
	readonly ready: BrowserReadinessFunction
}

/** Binds an element to its document identity and the page's shared protocol resources. */
export interface BrowserElementInput extends BrowserElementManagerInput {
	readonly description: () => BrowserOutlineNode
	readonly node: BrowserOutlineNode & { readonly reference: string }
	readonly backend: number
	readonly frame: string
	readonly current: () => boolean
	readonly point: BrowserElementPointFunction
}

/** Holds the resources of one lifecycle-event readiness wait. */
export interface BrowserReadinessWait {
	readonly resolve: () => void
	readonly reject: (error: unknown) => void
	readonly timer: ReturnType<typeof setTimeout>
	readonly signal: AbortSignal | undefined
	readonly listener: (() => void) | undefined
}

/** Provides actions and reading through a stable document element reference. */
export interface BrowserElementInterface {
	readonly reference: string
	readonly role: string
	readonly name: string
	/**
	 * Clicks the element, refusing with a coded `BrowserElementError` when it is gone, hidden,
	 * covered, or disabled.
	 */
	click(options?: BrowserCallOptions): Promise<void>
	/**
	 * Replaces the value of a text control with `value`, dispatching the input events that typing
	 * fires.
	 */
	fill(value: string, options?: BrowserCallOptions): Promise<void>
	/**
	 * Selects the options of a `select` element whose value or label matches `values`, dispatching
	 * `input` and `change`.
	 */
	select(values: readonly string[], options?: BrowserCallOptions): Promise<void>
	/** Moves focus to the element. */
	focus(options?: BrowserCallOptions): Promise<void>
	/**
	 * Captures the element's markup with its document's URL and title as a reading whose `stale` flag
	 * tracks later navigations of that document.
	 */
	read(options?: BrowserCallOptions): Promise<BrowserReadingInterface>
	/**
	 * Submits the form the element belongs to. The CDP placement focuses the element and presses
	 * Enter through a trusted key pair, sending the release even after an abort; the DOM
	 * placement calls the form's `requestSubmit()` and reports the outcome through a `submit`
	 * listener.
	 */
	submit(options?: BrowserCallOptions): Promise<void>
}

/** Provides trusted page input and capture for a referenced element. */
export interface BrowserPageElementInterface extends BrowserElementInterface {
	/** The id of the frame whose document holds the element. */
	readonly frame: string
	/** Moves the pointer onto the element with a trusted mouse event. */
	hover(options?: BrowserCallOptions): Promise<void>
	/**
	 * Focuses the element and presses `key` through a trusted key pair, sending the release even
	 * after an abort.
	 */
	press(key: string, options?: BrowserCallOptions): Promise<void>
	/** Sets the files of a file input to `files`, as paths the browser reads. */
	upload(files: readonly string[], options?: BrowserCallOptions): Promise<void>
	/** Drags the element onto the center of `target` with trusted pointer events. */
	drag(target: BrowserPageElementInterface, options?: BrowserCallOptions): Promise<void>
	/**
	 * Resolves the element's content quad in page coordinates, composed through every frame between
	 * the element and the page.
	 */
	quad(options?: BrowserCallOptions): Promise<BrowserQuad>
	/** Captures the page clipped to the element's box. */
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
}

/** Captures, queries, and retains references to a view's elements. */
export interface BrowserElementManagerInterface<
	TElement extends BrowserElementInterface = BrowserElementInterface,
> {
	/**
	 * Captures the view's document as a document-order outline, binding a reference to each
	 * interactive element and bounding the referenced rows by `limit`.
	 */
	outline(options?: BrowserOutlineOptions): Promise<BrowserOutline>
	/**
	 * Returns the elements matching `query` by role, case-insensitive accessible-name substring, or
	 * CSS selector, within an optional referenced element.
	 */
	find(query: BrowserElementQuery, options?: BrowserCallOptions): Promise<readonly TElement[]>
	/**
	 * Resolves with the elements matching `query` after a mutation produces a match, or after none
	 * matches when `absent` is set; rejects at the deadline or on abort.
	 */
	wait(
		query: BrowserElementQuery,
		options?: BrowserElementWaitOptions,
	): Promise<readonly TElement[]>
	/**
	 * Returns the element a reference names, or `undefined` when the reference is unknown or was
	 * dropped.
	 */
	element(reference: string): TElement | undefined
	/** Returns every element the manager holds a reference to. */
	elements(): readonly TElement[]
	/** Drops every reference the manager holds. */
	clear(): void
}

/** Provides the document operations shared by remote and DOM-native views. */
export interface BrowserViewInterface<E extends BrowserElementInterface = BrowserElementInterface> {
	readonly url: string
	readonly trusted: boolean
	readonly elements: BrowserElementManagerInterface<E>
	/** Resolves the document title. */
	title(options?: BrowserCallOptions): Promise<string>
	/**
	 * Captures the document URL, title, and markup as a reading whose `stale` flag tracks later
	 * navigations.
	 */
	read(options?: BrowserCallOptions): Promise<BrowserReadingInterface>
	/**
	 * Resolves when `text` is visible in the document; rejects with a `BrowserError` coded
	 * `BROWSER_WAIT_TIMEOUT` at the deadline, and with `signal.reason` on abort.
	 */
	wait(text: string, options?: BrowserCallOptions): Promise<void>
}

/**
 * Describes the options every asynchronous page, frame, handle, and worker call accepts.
 *
 * @remarks
 * - `timeout` — ms before this one call fails, overriding the client-wide default
 * - `signal` — aborts this one call; the promise rejects with `signal.reason`
 */
export interface BrowserCallOptions {
	readonly timeout?: number
	readonly signal?: AbortSignal
}

/** Transliterates the WebMCP protocol's `Annotation` type, retaining its wire spelling. */
export interface BrowserToolAnnotation {
	readonly readOnly?: boolean
	readonly untrustedContent?: boolean
	readonly consequential?: boolean
	readonly debugging?: boolean
	readonly autosubmit?: boolean
}

/** Describes a registered WebMCP tool and its owning document. */
export interface BrowserTool {
	readonly name: string
	readonly description: string
	readonly schema: Readonly<Record<string, unknown>> | undefined
	readonly annotation: BrowserToolAnnotation
	readonly frame: string
	readonly node: number | undefined
}

/** Identifies a removed WebMCP tool by document and name. */
export interface BrowserToolRemoval {
	readonly frame: string
	readonly name: string
}

/** Describes a WebMCP invocation observed on the protocol. */
export interface BrowserInvocation {
	readonly id: string
	readonly tool: string
	readonly frame: string
	readonly input: string
}

/** Carries a terminal WebMCP status and its untrusted output or error. */
export interface BrowserInvocationResult {
	readonly id: string
	readonly status: string
	readonly output: unknown
	readonly error: string | undefined
}

/** Maps registry changes and observed WebMCP invocation events. */
export type BrowserRegistryEventMap = {
	readonly change: readonly []
	readonly invoke: readonly [invocation: BrowserInvocation]
	readonly respond: readonly [result: BrowserInvocationResult]
}

/** Configures registry listeners and listener-error handling. */
export interface BrowserRegistryOptions {
	readonly on?: EmitterHooks<BrowserRegistryEventMap>
	readonly error?: EmitterErrorHandler
}

/** Mirrors the experimental WebMCP protocol domain for a page. */
export interface BrowserRegistryInterface {
	readonly emitter: EmitterInterface<BrowserRegistryEventMap>
	/** Enables observation; returns `false` only when the protocol domain is absent. */
	start(options?: BrowserCallOptions): Promise<boolean>
	/** Finds a tool; an omitted frame prefers the main document, then registration order. */
	tool(name: string, frame?: string): BrowserTool | undefined
	/** Returns every registered tool, including shadowed frame registrations. */
	tools(): readonly BrowserTool[]
	/** Projects tools as untrusted executable tools, omitting optional-what schemas. */
	adopt(): Promise<readonly ToolInterface[]>
	/** Invokes a tool and awaits its terminal event; rejects on abort, invalidation, or timeout. */
	execute(
		tool: BrowserTool,
		input: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<BrowserInvocationResult>
	/** Disables every enabled session, unsubscribes, and rejects pending invocations. */
	destroy(): Promise<void>
}

/** Holds one unsettled registry execution and its resource cleanup. */
export interface BrowserRegistryPending {
	readonly frame: string
	readonly session: string
	readonly signal: AbortSignal | undefined
	readonly controller: AbortController
	readonly timer: ReturnType<typeof setTimeout>
	readonly resolve: (result: BrowserInvocationResult) => void
	readonly reject: (error: unknown) => void
}

// === Browser toolset

/**
 * Names a tool the browser toolset reserves: the seven generic tools, the staged `dialog`, the
 * opt-in `tabs` and `switch`, and the journey tools `record`, `save`, `journeys`, `edit`, and
 * `replay`, which a toolset constructed with `journeys` reserves.
 */
export type BrowserToolName =
	| 'look'
	| 'read'
	| 'click'
	| 'type'
	| 'press'
	| 'navigate'
	| 'wait'
	| 'dialog'
	| 'tabs'
	| 'switch'
	| 'record'
	| 'save'
	| 'journeys'
	| 'edit'
	| 'replay'

/**
 * Names why a toolset declined a page tool.
 *
 * @remarks
 * - `reserved` — the name is one of the toolset's own tool names
 * - `held` — the manager holds the name under a tool the toolset did not add
 * - `pattern` — the name falls outside `BROWSER_TOOL_NAME_PATTERN`
 * - `schema` — the page's input schema declares `what` as optional
 * - `debugging` — the page marks the tool for developers
 */
export type BrowserToolsetReason = 'reserved' | 'held' | 'pattern' | 'schema' | 'debugging'

/** Maps the signal a tool source emits when its page's tools change. */
export type BrowserToolSourceEventMap = { readonly change: readonly [] }

/**
 * Supplies page-registered tools to a toolset through a contract free of protocol types.
 *
 * @remarks
 * - `emitter` — emits `change` when the page's tools change
 * - `adopt` — projects the current tools as executable tools
 * - `tools` — the census of registered tools; a toolset decides the `schema` and `debugging`
 *   skips from it, and applies only the name checks to a source that omits it
 *
 * `BrowserRegistry` satisfies this contract with its census; `@orkestrel/mcp`'s
 * `ModelContextInterface` satisfies it without one.
 */
export interface BrowserToolSourceInterface {
	readonly emitter: EmitterInterface<BrowserToolSourceEventMap>
	/** Projects the page's current tools as executable tools. */
	adopt(): Promise<readonly ToolInterface[]>
	/**
	 * Lists the registered tools, from which a toolset decides the `schema` and `debugging` skips.
	 */
	tools?(): readonly BrowserTool[]
}

/**
 * Maps the events a toolset emits.
 *
 * @remarks
 * - `adopt` — a page tool was added to the manager
 * - `skip` — a page tool was declined, with the reason
 * - `select` — the toolset's current view changed
 * - `action` — the toolset performed an action, carrying what became of it
 * - `hold` — a replay of the named journey took the toolset
 * - `release` — the hold of the named journey ended
 */
export type BrowserToolsetEventMap = {
	readonly adopt: readonly [tool: ToolInterface]
	readonly skip: readonly [name: string, reason: BrowserToolsetReason]
	readonly select: readonly [view: BrowserViewInterface]
	readonly action: readonly [action: BrowserAction]
	readonly hold: readonly [name: string]
	readonly release: readonly [name: string]
}

/**
 * Configures a browser toolset.
 *
 * @remarks
 * - `tools` — the manager the toolset fills. Default: a manager the toolset creates
 * - `page` — the page behind the view, which adds `press`, `navigate`, the staged `dialog`,
 *   popup following, and the protocol subscriptions; omitting it leaves the five view tools
 * - `source` — a fixed source of page tools. Default: `page.registry` when `page` is supplied,
 *   which the toolset starts and which follows the current page; no source otherwise
 * - `context` — the browser context whose pages the `tabs` and `switch` tools list and select;
 *   it requires `page`, and omitting it leaves both tools unadvertised
 * - `limit` — the most characters of a result or error message before its footer, a positive
 *   integer. Default: `BROWSER_TOOL_LIMIT`
 * - `schemes` — the URL schemes `navigate` accepts, each with its colon. Default:
 *   `BROWSER_SCHEMES`
 * - `release` — releases a resource the caller hands to the toolset, such as a view created for
 *   it alone; `destroy()` calls it one time, after the toolset's own teardown, and rejects with
 *   its rejection. A view or page supplied without it stays the caller's to end. Default: nothing
 *   is released
 * - `journeys` — the stores behind the journey tools, which the toolset registers and reserves
 *   through a journey toolset it constructs; omitting it leaves the journey tools unadvertised
 */
export interface BrowserToolsetOptions {
	readonly on?: EmitterHooks<BrowserToolsetEventMap>
	readonly error?: EmitterErrorHandler
	readonly tools?: ToolManagerInterface
	readonly page?: BrowserPageInterface
	readonly source?: BrowserToolSourceInterface
	readonly context?: BrowserContextInterface
	readonly limit?: number
	readonly schemes?: readonly string[]
	readonly release?: () => Promise<void> | void
	readonly journeys?: BrowserJourneyOptions
}

/**
 * Publishes the browser vocabulary as tools over one current view and adopts the page's own
 * tools beside them.
 *
 * @remarks
 * - `emitter` — emits `adopt`, `skip`, and `select`
 * - `tools` — the manager the toolset fills
 * - `native` — the generic tools alone, which a consumer publishes to a built-in agent: the
 *   seven for a page-backed toolset, and `look`, `read`, `click`, `type`, and `wait` for a
 *   view-backed one
 * - `view` — the view the tools act on
 */
export interface BrowserToolsetInterface {
	readonly emitter: EmitterInterface<BrowserToolsetEventMap>
	readonly tools: ToolManagerInterface
	readonly native: readonly ToolInterface[]
	readonly view: BrowserViewInterface
	/** Performs a tool call and returns its structured action when a handler ran. */
	perform(call: ToolCall, context?: ToolContext): Promise<BrowserToolsetResult>
	/** Takes a queue turn and reserves action admission for the returned caller token. */
	hold(name: string, options?: BrowserCallOptions): Promise<BrowserHoldInterface>
	/**
	 * Adds the tools, follows the view, and adopts the page's tools; concurrent calls share one
	 * startup. Rejects with a coded `BrowserError` and adds nothing when the manager holds a
	 * reserved name under a tool the toolset did not add, and rejects with
	 * `the browser session ended` when `destroy()` runs before startup finishes.
	 */
	start(options?: BrowserCallOptions): Promise<void>
	/**
	 * Stops following the view, rejects queued actions, and removes every tool the toolset added
	 * that the manager still holds, then calls the `release` option one time; a second call
	 * returns the first call's promise.
	 */
	destroy(): Promise<void>
}

/**
 * Runs one toolset tool inside the toolset's boundary.
 *
 * @param args - The arguments the caller supplied
 * @param context - The call's context, whose signal also aborts when the toolset is destroyed
 * @returns The result body, which the boundary bounds, and a footer it appends after the bound
 */
export type BrowserToolsetHandler = (
	args: Readonly<Record<string, unknown>>,
	context: ToolContext,
) => Promise<readonly [body: string, footer: string]>

/** Holds the listeners a toolset attaches to one followed page. */
export interface BrowserToolsetWatch {
	readonly dialog: (dialog: BrowserDialogInterface) => void
	readonly popup: (page: BrowserPageInterface) => void
	readonly close: () => void
	readonly closed: CDPHandler
}

/**
 * Describes one tool receipt before rendering.
 *
 * @remarks
 * - `action` — what the tool did, without a closing period, such as `Clicked e4 button "Save"`;
 *   empty when the tool did nothing the receipt names
 * - `status` — a clause joined to the action with a semicolon, such as
 *   `the page is still loading URL`
 * - `dialog` — the dialog that interrupted the tool
 * - `view` — the fresh view that follows the receipt line
 * - `trusted` — if `false`, the receipt line ends with ` (untrusted event)`, which a click or type
 *   over a DOM view reports; if `true` or omitted, the line carries no marker
 */
export interface BrowserReceipt {
	readonly action: string
	readonly status?: string
	readonly dialog?: { readonly category: BrowserDialogCategory; readonly message: string }
	readonly view?: string
	readonly trusted?: boolean
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
 * - `read` — capture the document URL, title, and HTML as a reading
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
	/** Resolves the frame document title. */
	title(options?: BrowserCallOptions): Promise<string>
	/**
	 * Captures the document URL, title, and HTML in one size-guarded evaluation in the frame's
	 * isolated world and returns them as a reading whose `stale` flag tracks later navigations.
	 * A frame constructed without an epoch source (a standalone `BrowserFrame` with no `epoch`
	 * argument) returns readings whose `stale` stays `false`, because no navigation counter is
	 * available to it.
	 */
	read(options?: BrowserCallOptions): Promise<BrowserReadingInterface>
	/** Evaluates an expression in the frame execution world under the result-size guard. */
	evaluate(expression: string, options?: BrowserCallOptions): Promise<unknown>
	/**
	 * Evaluates an expression by reference and returns a disposable remote object handle.
	 */
	handle(expression: string, options?: BrowserCallOptions): Promise<BrowserHandleInterface>
	/**
	 * Issues a raw CDP method in the frame's current target session, with a trailing
	 * `BrowserCallOptions` carrying a per-call `timeout` overriding the client-wide default and a
	 * `signal` that aborts the call.
	 */
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<unknown>
	/** Subscribes to a CDP event in the frame's current target session. */
	subscribe(method: string, handler: CDPHandler): Promise<void>
	/** Removes a frame-session CDP event subscription. */
	unsubscribe(method: string, handler: CDPHandler): Promise<void>
	/**
	 * Persists bytes through a page writer; a child frame rejects because it owns no writer.
	 */
	save(path: string, bytes: Uint8Array): Promise<void>
	/**
	 * Throws a coded `BrowserError` when the frame can no longer accept protocol work: a frame
	 * throws after the CDP client disconnects, and a page also throws after it closes. Every
	 * other member here calls it first.
	 */
	assert(): void
	/**
	 * Records an externally observed URL as the frame's current `url`, which a page calls from
	 * its own `Page.frameNavigated` handler.
	 */
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

/**
 * Describes the serializable input for a navigable browser snapshot — the form a
 * `BrowserSnapshot` is built from and serializes back to.
 */
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

/**
 * Represents a navigable, serializable snapshot of every document attached to a page,
 * extending `BrowserSnapshotInput` with walking, structural relationships, search, and path
 * derivation over plain `BrowserNode` values.
 */
export interface BrowserSnapshotInterface extends BrowserSnapshotInput {
	/**
	 * Traverses the whole capture, or one subtree when `root` is given and yielded first, in
	 * `'depth'` order by default or in `'breadth'` order. Visits each node exactly once.
	 */
	walk(options?: BrowserWalkOptions): Generator<BrowserNode, void, unknown>
	/** Traverses one node's subtree in depth-first order, excluding the node itself. */
	descendants(node: BrowserNode): Generator<BrowserNode, void, unknown>
	/** Resolves the captured document a node belongs to. */
	document(node: BrowserNode): BrowserDocument | undefined
	/**
	 * Returns the direct children of a node, entering a linked iframe's content document.
	 */
	children(node: BrowserNode): readonly BrowserNode[]
	/**
	 * Returns the structural parent of a node, crossing a document boundary to the owning
	 * iframe.
	 */
	parent(node: BrowserNode): BrowserNode | undefined
	/**
	 * Returns the structural siblings of a node; `'preceding'` or `'following'` narrows to one
	 * side, and omitting the relation returns every sibling but the node itself.
	 */
	siblings(node: BrowserNode, relation?: BrowserSiblingRelation): readonly BrowserNode[]
	/**
	 * Returns the ancestors of a node, nearest first, across document and iframe boundaries.
	 */
	ancestors(node: BrowserNode): readonly BrowserNode[]
	/**
	 * Returns the nearest common ancestor of two nodes, counting each node as its own
	 * candidate.
	 */
	common(first: BrowserNode, second: BrowserNode): BrowserNode | undefined
	/**
	 * Returns the structural edge count between two nodes, or `undefined` when they share no
	 * ancestor.
	 */
	distance(first: BrowserNode, second: BrowserNode): number | undefined
	/** Returns the first node matching a `BrowserNodeQuery` or a `BrowserNodePredicate`. */
	find(query: BrowserNodeQuery | BrowserNodePredicate): BrowserNode | undefined
	/**
	 * Returns every matching node, bounded by an optional `limit`; a negative or fractional
	 * limit throws a coded `BrowserError`.
	 */
	filter(query: BrowserNodeQuery | BrowserNodePredicate, limit?: number): readonly BrowserNode[]
	/**
	 * Returns the nearest match from a node through its ancestors, testing the node first.
	 */
	closest(
		node: BrowserNode,
		query: BrowserNodeQuery | BrowserNodePredicate,
	): BrowserNode | undefined
	/** Returns a deterministic frame-qualified structural path for one node. */
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
 * Abstracts a single top-level browser page, extending `BrowserFrameInterface` with
 * navigation, screenshots, frame discovery, DOM snapshots, codegen, and target teardown.
 *
 * @remarks
 * Inherits every {@link BrowserFrameInterface} document operation for the
 * main frame.
 *
 * - `closed` — true after `close()` is called
 * - `popups` — opens the record that settles the popups an input opens
 * - `navigate` — go to a URL and wait for the specified load condition
 * - `screenshot` — capture a PNG or JPEG image of the page
 * - `frame` — look up a frame by name or URL in the page's flattened frame tree
 * - `frames` — list the page's flattened frame tree, main frame first
 * - `snapshot` — capture every attached document as serializable DOM data
 * - `codegen` — start (or return the existing) action recorder for this page
 * - `destroy` — release local resources and detach from the target
 * - `close` — close the remote target and release local resources
 */
export interface BrowserPageInterface
	extends BrowserFrameInterface, BrowserViewInterface<BrowserPageElementInterface> {
	readonly elements: BrowserElementManagerInterface<BrowserPageElementInterface>
	readonly trusted: true
	readonly keyboard: BrowserKeyboardInterface
	readonly mouse: BrowserMouseInterface
	readonly touch: BrowserTouchInterface
	/** Waits for visible text in the main document, rejecting at the deadline or on abort. */
	wait(text: string, options?: BrowserCallOptions): Promise<void>
	readonly emitter: EmitterInterface<BrowserPageEventMap>
	readonly registry: BrowserRegistryInterface
	readonly network: BrowserNetworkManagerInterface
	readonly navigation: BrowserNavigationManagerInterface
	readonly popups: BrowserPopupManagerInterface
	readonly scripts: BrowserScriptManagerInterface
	readonly accessibility: BrowserAccessibilityInterface
	readonly diagnostics: BrowserDiagnosticsInterface
	readonly clock: BrowserClockInterface
	readonly opener: BrowserPageInterface | undefined
	readonly target: string
	readonly closed: boolean
	/**
	 * Goes to a URL, waits for the requested load condition, and returns the final URL with
	 * its response correlation.
	 */
	navigate(url: string, options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	/** Reloads the page and returns the final URL with its response correlation. */
	reload(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	/**
	 * Navigates to the previous history entry, or returns the unchanged URL when none exists.
	 */
	back(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	/**
	 * Navigates to the next history entry, or returns the unchanged URL when none exists.
	 */
	forward(options?: BrowserNavigationOptions): Promise<BrowserNavigationResult>
	/**
	 * Captures PNG or JPEG bytes, optionally full-page and persisted through an injected
	 * writer.
	 */
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	/** Prints the page to PDF bytes, optionally persisted through the injected writer. */
	pdf(options?: BrowserPDFOptions): Promise<BrowserPDFResult>
	/** Looks up a first-class frame by name or URL. */
	frame(name: string): Promise<BrowserFrameInterface | undefined>
	/** Decodes the flattened frame tree, main frame first. */
	frames(): Promise<readonly BrowserFrameInterface[]>
	/**
	 * Captures and decodes every attached document, shadow root, template content, layout box,
	 * and requested computed style.
	 */
	snapshot(options?: BrowserSnapshotOptions): Promise<BrowserSnapshotInterface>
	/** Starts the action recorder, or returns the running one. */
	codegen(options?: BrowserRecorderOptions): Promise<BrowserCodegenInterface>
	/** Releases local resources and detaches without closing the remote target. */
	destroy(): Promise<void>
	/** Closes the remote target and releases its resources. */
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
	/** Returns one page by index, or the first page. */
	page(index?: number): BrowserPageInterface | undefined
	/** Returns every page in creation order. */
	pages(): readonly BrowserPageInterface[]
	/** Opens a page in this context. */
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	/**
	 * Synchronizes pages from the given CDP targets, which the server discovers and core never
	 * fetches. Performs a destructive diff rather than an additive merge: a page whose target
	 * id is missing from `targets` is closed and dropped, and a target that is not yet tracked
	 * is attached and added.
	 */
	sync(targets: readonly CDPTarget[]): Promise<void>
	/**
	 * Releases local pages and detaches their sessions without disposing the remote browser
	 * context.
	 */
	destroy(): Promise<void>
	/**
	 * Closes remote pages, disposes the remote browser context, and releases local resources.
	 */
	close(): Promise<void>
}
