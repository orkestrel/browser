import type { EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

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
}

/** Page load condition for navigation. */
export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'

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

/**
 * Options for element interaction (click, fill, select, wait).
 *
 * @remarks
 * - `timeout` — maximum time to wait for the selector in milliseconds
 */
export interface BrowserActionOptions {
	readonly timeout?: number
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
 */
export interface BrowserCodegenOptions {
	readonly on?: EmitterHooks<BrowserCodegenEventMap>
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

// === Browser page

/**
 * One frame in a page's frame tree, as reported by CDP `Page.getFrameTree`.
 *
 * @remarks
 * - `id` — the frame's CDP frame id
 * - `parent` — the parent frame's id, undefined for the main frame
 * - `name` — the frame's `name`/`id` HTML attribute, undefined when not set
 * - `url` — the frame's current URL
 */
export type BrowserFrame = {
	readonly id: string
	readonly parent?: string
	readonly name?: string
	readonly url: string
}

/**
 * Abstraction over a single browser page or frame.
 *
 * @remarks
 * - `url` — current URL; when the page was constructed with a seeded url
 *   (e.g. reattaching to an existing CDP target), reports that url
 *   immediately, before any `navigate()`/`content()` call refreshes it
 * - `closed` — true after `close()` is called
 * - `title` — resolve the document title
 * - `navigate` — go to a URL and wait for the specified load condition
 * - `content` — extract page URL, title, HTML, and visible text
 * - `screenshot` — capture a PNG or JPEG image of the page
 * - `click` — click an element matching the selector
 * - `fill` — type text into an input element
 * - `select` — choose option(s) in a `<select>` element
 * - `evaluate` — execute a JavaScript expression in the page context
 * - `wait` — wait for an element matching the selector to appear
 * - `frame` — look up a frame by name or URL in the page's flattened frame tree
 * - `frames` — list the page's flattened frame tree, main frame first
 * - `codegen` — start (or return the existing) action recorder for this page
 * - `close` — close the page
 */
export interface BrowserPageInterface {
	readonly url: string
	readonly closed: boolean
	title(): Promise<string>
	navigate(url: string, options?: BrowserNavigationOptions): Promise<void>
	content(): Promise<BrowserContentResult>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	click(selector: string, options?: BrowserActionOptions): Promise<void>
	fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void>
	select(selector: string, values: readonly string[], options?: BrowserActionOptions): Promise<void>
	evaluate(expression: string): Promise<unknown>
	wait(selector: string, options?: BrowserActionOptions): Promise<void>
	frame(name: string): Promise<BrowserFrame | undefined>
	frames(): Promise<readonly BrowserFrame[]>
	codegen(options?: BrowserCodegenOptions): Promise<BrowserCodegenInterface>
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
 * - `close` — close the context and all its pages
 */
export interface BrowserContextInterface {
	readonly id: string | undefined
	page(index?: number): BrowserPageInterface | undefined
	pages(): readonly BrowserPageInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	sync(targets: readonly CDPTarget[]): Promise<void>
	close(): Promise<void>
}
