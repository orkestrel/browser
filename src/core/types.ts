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
	/** Starts the transport and begins dispatching. Idempotent. */
	connect(): Promise<void>
	/** Closes the transport and re-establishes it. */
	reconnect(): Promise<void>
	/**
	 * Issues a CDP method call with optional params and a trailing `CDPSendOptions` carrying
	 * the `session` to scope it to and a per-call `timeout` overriding the client-wide
	 * default; rejects on timeout.
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
export type BrowserWaitUntil = 'commit' | 'load' | 'domcontentloaded'

/**
 * Describes the options for creating a browser page.
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
	/**
	 * Resolves with the URL of the next navigation matching the `*` and `**` glob pattern.
	 * Rejects on timeout.
	 */
	wait(pattern: string, options?: BrowserNavigationWaitOptions): Promise<string>
	/**
	 * Polls an expression in the page until it returns a truthy value, and resolves with that
	 * value.
	 */
	until(expression: string, options?: BrowserNavigationWaitOptions): Promise<unknown>
}

/**
 * Describes the options for element interaction (click, fill, select, wait).
 *
 * @remarks
 * - `timeout` — maximum time to wait for the selector in milliseconds
 * - `strict` — require the selector to resolve to exactly one element (default `true`)
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
 * - `path` — file path to persist the screenshot to, through the page's writer
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
	value(): Promise<unknown>
	/** Runs a function declaration with the handle as `this`, by value. */
	call(declaration: string, args?: readonly unknown[]): Promise<unknown>
	/**
	 * Retains one own property as its own handle, or returns `undefined` when the property is
	 * absent.
	 */
	property(name: string): Promise<BrowserHandleInterface | undefined>
	/** Reads every own property by value. */
	properties(): Promise<Readonly<Record<string, unknown>>>
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
	/** Narrows to a descendant matching the CSS selector. */
	locator(selector: string): BrowserLocatorInterface
	/** Narrows to the matches satisfying the filter. */
	filter(options: BrowserLocatorFilter): BrowserLocatorInterface
	/** Narrows to the first match. */
	first(): BrowserLocatorInterface
	/** Narrows to the last match. */
	last(): BrowserLocatorInterface
	/** Narrows to the match at the given index. */
	item(index: number): BrowserLocatorInterface
	/** Counts the current matches. */
	count(): Promise<number>
	/** Resolves one indexed locator per current match. */
	all(): Promise<readonly BrowserLocatorInterface[]>
	/** Clicks the match with trusted input after its actionability checks pass. */
	click(options?: BrowserLocatorClickOptions): Promise<void>
	/** Replaces the match's value with the given text. */
	fill(value: string, options?: BrowserActionOptions): Promise<void>
	/** Selects the given option values on the match. */
	select(values: readonly string[], options?: BrowserActionOptions): Promise<void>
	/** Clicks the match unless it already reports checked. */
	check(options?: BrowserLocatorClickOptions): Promise<void>
	/** Clicks the match unless it already reports unchecked. */
	uncheck(options?: BrowserLocatorClickOptions): Promise<void>
	/** Moves trusted pointer input over the match. */
	hover(options?: BrowserPointerOptions): Promise<void>
	/** Gives the match keyboard focus. */
	focus(options?: BrowserActionOptions): Promise<void>
	/** Focuses the match and presses one key or chord. */
	press(key: string, options?: BrowserLocatorTypeOptions): Promise<void>
	/** Focuses the match and types the value one key at a time. */
	type(value: string, options?: BrowserLocatorTypeOptions): Promise<void>
	/** Empties the match's value. */
	clear(options?: BrowserActionOptions): Promise<void>
	/** Waits until the match reaches the requested state. Rejects on timeout. */
	wait(options?: BrowserWaitOptions): Promise<void>
	/** Reads the first match's rendered text. */
	text(): Promise<string>
	/** Reads the rendered text of every match. */
	texts(): Promise<readonly string[]>
	/** Reads the first match's inner HTML. */
	html(): Promise<string>
	/** Reads the first match's form value. */
	value(): Promise<string>
	/**
	 * Reads one attribute of the first match, or returns `undefined` when the match carries
	 * none.
	 */
	attribute(name: string): Promise<string | undefined>
	/** Reports whether the first match renders a non-empty box. */
	visible(): Promise<boolean>
	/** Reports whether the first match accepts input. */
	enabled(): Promise<boolean>
	/** Reports whether the first match accepts typed text. */
	editable(): Promise<boolean>
	/**
	 * Captures the first match's box, persisting it through the page writer when a path is
	 * given.
	 */
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	/** Sets the file selection on the matched file input. */
	upload(options: BrowserUploadOptions): Promise<void>
	/** Drags the match onto the target locator with trusted pointer input. */
	drag(target: BrowserLocatorInterface, options?: BrowserLocatorDragOptions): Promise<void>
}

/**
 * Groups the locator factories by selector semantics.
 */
export interface BrowserSelectorManagerInterface {
	/** Locates by CSS selector. */
	css(value: string): BrowserLocatorInterface
	/** Locates by ARIA role, optionally by accessible name and exactness. */
	role(value: string, options?: BrowserRoleOptions): BrowserLocatorInterface
	/** Locates by rendered text, optionally exact. */
	text(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	/** Locates a labelled control by its label text, optionally exact. */
	label(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	/** Locates an input by its placeholder text, optionally exact. */
	placeholder(value: string, options?: BrowserTextOptions): BrowserLocatorInterface
	/** Locates by the test-id attribute. */
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
	/**
	 * Accepts the dialog, optionally supplying prompt text. Throws once the dialog is handled.
	 */
	accept(value?: string): Promise<void>
	/** Dismisses the dialog. Throws once the dialog is handled. */
	dismiss(): Promise<void>
}

/** Represents one intercepted file chooser. */
export interface BrowserFileChooserInterface {
	readonly multiple: boolean
	/**
	 * Sets the chosen files. Throws when a single-file chooser is given several, and once the
	 * chooser is already handled.
	 */
	upload(files: readonly string[]): Promise<void>
	/** Clears the selection. Throws once the chooser is already handled. */
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
	/**
	 * Sends CDP `Browser.cancelDownload` for this download, and is ignored unless the status
	 * is still pending.
	 */
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
	/** Evaluates a guarded expression in the worker and returns its value. */
	evaluate(expression: string, timeout?: number): Promise<unknown>
	/** Issues one CDP method call on the worker's session. */
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
	/** Stops driving the worker locally without closing its target. */
	detach(): void
	/** Closes the worker target, tolerating a worker that already terminated. Idempotent. */
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
	/**
	 * Begins recording on the page's session. A call after teardown is a silent no-op, because
	 * a torn-down recorder cannot be restarted and a fresh one is obtained through the page.
	 */
	start(): Promise<void>
	/** Stops recording and returns the captured actions. */
	stop(): Promise<readonly BrowserCodegenAction[]>
	/** Returns the current normalized action list. */
	actions(): readonly BrowserCodegenAction[]
	/** Compiles the captured actions into a script. */
	script(options?: BrowserCodegenScriptOptions): string
	/** Resets the captured action list. */
	clear(): void
	/** Tears down the recorder and detaches its CDP listeners. */
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
	/** Resolves the frame document title. */
	title(): Promise<string>
	/** Extracts the URL, title, HTML, and visible text under the result-size guards. */
	content(): Promise<BrowserContentResult>
	/**
	 * Distills the frame HTML to reader-facing plain text, with boilerplate and hidden regions
	 * pruned.
	 */
	article(): Promise<string>
	/**
	 * Clicks a CSS-selector match, strict by default and requiring it visible and enabled.
	 */
	click(selector: string, options?: BrowserActionOptions): Promise<void>
	/**
	 * Fills an editable input or contenteditable element, strict by default, dispatching input
	 * and change events.
	 */
	fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void>
	/** Selects options on an enabled `select` element, strict by default. */
	select(selector: string, values: readonly string[], options?: BrowserActionOptions): Promise<void>
	/** Evaluates an expression in the frame execution world under the result-size guard. */
	evaluate(expression: string, timeout?: number): Promise<unknown>
	/**
	 * Evaluates an expression by reference and returns a disposable remote object handle.
	 */
	handle(expression: string): Promise<BrowserHandleInterface>
	/** Waits for a selector to reach the attached, detached, visible, or hidden state. */
	wait(selector: string, options?: BrowserWaitOptions): Promise<void>
	/**
	 * Issues a raw CDP method in the frame's current target session, with a trailing
	 * `BrowserSendOptions` carrying a per-call `timeout` overriding the client-wide default.
	 */
	send(
		method: string,
		params?: Readonly<Record<string, unknown>>,
		options?: BrowserSendOptions,
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
	 * throws once the CDP client disconnects, and a page also throws once it closes. Every
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
	codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface>
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
