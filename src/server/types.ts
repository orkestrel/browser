import type { EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserViewport,
} from '@src/core'

// === Browser shared

/** Supported browser engine (raw CDP targets Chromium-family browsers only). */
export type BrowserEngine = 'chromium' | 'chrome' | 'edge'

/** How the browser connection was established. */
export type BrowserConnection = 'cdp' | 'launch' | 'persistent'

/** Lifecycle status of a browser wrapper. */
export type BrowserStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * Result of passive browser discovery.
 *
 * @remarks
 * Returned by `discover()` to report whether an existing browser is
 * reachable via CDP without actually connecting to it.
 *
 * - `found` — true when a browser responded on the CDP endpoint
 * - `endpoint` — the CDP WebSocket URL when found
 * - `browser` — browser product name reported by the endpoint
 * - `connection` — the connection mode that would be used
 */
export interface BrowserDiscoveryResult {
	readonly found: boolean
	readonly endpoint: string | undefined
	readonly browser: string | undefined
	readonly connection: BrowserConnection | undefined
}

/**
 * Options overriding `findSystemBrowsers`'/`findSystemBrowser`'s candidate sources.
 *
 * @remarks
 * Each field replaces the default candidate list for its category — a field
 * left `undefined` falls back to the platform default, an explicit `[]` (or
 * empty `env`) disables that category entirely. Zero-arg `findSystemBrowsers()`
 * uses full default resolution.
 *
 * - `env` — environment record consulted for both the override keys
 *   (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) and Windows install roots
 *   (`PROGRAMFILES`, `PROGRAMFILES(X86)`, `LOCALAPPDATA`); defaults to `process.env`
 * - `paths` — candidate install paths checked in order; defaults to the
 *   platform's well-known Chrome/Edge/Chromium locations
 * - `names` — command names probed on PATH (`which`/`where`); defaults to
 *   `BROWSER_EXECUTABLE_NAMES`
 * - `stores` — Playwright browser store base directories searched for a
 *   managed Chromium; defaults to `PLAYWRIGHT_BROWSERS_PATH`, the well-known
 *   store dirs, and the per-OS Playwright cache directory
 * - `engine` — when set, narrows results to candidates classified as this engine
 */
export interface SystemBrowserOptions {
	readonly env?: Readonly<Record<string, string | undefined>>
	readonly paths?: readonly string[]
	readonly names?: readonly string[]
	readonly stores?: readonly string[]
	readonly engine?: BrowserEngine
}

/**
 * One discovered browser executable on this machine.
 *
 * @remarks
 * Returned by `findSystemBrowsers`/`findSystemBrowser` — pairs the resolved
 * absolute executable path with its classified engine.
 */
export type SystemBrowser = {
	readonly executable: string
	readonly engine: BrowserEngine
}

/**
 * CDP (Chrome DevTools Protocol) connection configuration.
 *
 * @remarks
 * - `port` — port number to probe for an existing CDP endpoint (default `9222`)
 * - `host` — host to probe/launch on (default `127.0.0.1`; avoids `localhost`
 *   resolving to `::1` when Chromium binds `127.0.0.1`)
 * - `endpoint` — explicit CDP WebSocket URL; when provided, skips discovery
 * - `discover` — whether `connect()` passively probes for an existing browser
 *   before launching (default `true`); set `false` to skip discovery and go
 *   straight to launch — a short probe of `port` still runs first and rejects
 *   with a coded error naming the occupied port if something is already
 *   listening there, so a demanded fresh launch never silently attaches to a
 *   stranger browser
 */
export interface BrowserCdpOptions {
	readonly port?: number
	readonly host?: string
	readonly endpoint?: string
	readonly discover?: boolean
}

/**
 * Event map for a {@link BrowserInterface}.
 *
 * @remarks
 * - `idle` — no active connection (initial state, or after disconnect)
 * - `discover` — passive CDP probe completed
 * - `connect` — a connection was established, carrying the mode used
 * - `disconnect` — the connection was detached — either explicitly, or after
 *   an external disconnect (process exit or transport loss); always preceded
 *   by a coded `error` describing the cause
 * - `launch` — a new browser process was launched, carrying the engine
 * - `page` — a new page was created via the `create()` shortcut
 * - `error` — a connection or launch fault
 * - `destroy` — the browser and all resources were torn down
 */
export type BrowserEventMap = {
	readonly idle: readonly []
	readonly discover: readonly [result: BrowserDiscoveryResult]
	readonly connect: readonly [connection: BrowserConnection]
	readonly disconnect: readonly []
	readonly launch: readonly [engine: BrowserEngine]
	readonly page: readonly [page: BrowserPageInterface]
	readonly error: readonly [error: unknown]
	readonly destroy: readonly []
}

/**
 * Options for creating a Browser.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `headless` — launch in headless mode (default `true`; ignored for CDP connections)
 * - `executable` — absolute path to a browser executable; when provided, skips
 *   system browser discovery and launches this binary directly
 * - `profile` — persistent browser profile (user-data) directory
 * - `cdp` — CDP connection options (port and endpoint)
 * - `timeout` — connection, discovery, and launch timeout in milliseconds (default `30_000`)
 * - `viewport` — default viewport dimensions for new pages
 * - `signal` — external AbortSignal for cancelling the connection attempt
 * - `args` — additional command-line flags passed to the launched browser process
 * - `engine` — preferred browser engine to launch; narrows system browser
 *   discovery to this engine (ignored when `executable` is given); takes
 *   precedence over `browsers.engine`
 * - `browsers` — candidate-source overrides consulted when `connect()` needs
 *   to launch (same shape `findSystemBrowsers` takes); ignored when
 *   `executable` is given, which bypasses discovery entirely
 */
export interface BrowserOptions {
	readonly on?: EmitterHooks<BrowserEventMap>
	readonly headless?: boolean
	readonly executable?: string
	readonly profile?: string
	readonly cdp?: BrowserCdpOptions
	readonly timeout?: number
	readonly viewport?: BrowserViewport
	readonly signal?: AbortSignal
	readonly args?: readonly string[]
	readonly engine?: BrowserEngine
	readonly browsers?: SystemBrowserOptions
}

/**
 * Browser wrapper with discovery, connection management, and lifecycle control.
 *
 * @remarks
 * Encapsulates the full raw-CDP browser lifecycle behind a clean interface:
 *
 * **Connection strategy** (executed by `connect()`):
 * 1. If `cdp.endpoint` is set, connect directly via CDP
 * 2. Probe `localhost:{cdp.port}` for an existing browser (passive discovery)
 * 3. If found, connect over CDP (preserves the existing browser session)
 * 4. Otherwise, launch a new browser process with raw-CDP flags
 *
 * This lets automation reuse an already-running browser before falling back
 * to a fresh launch.
 *
 * **Lifecycle:**
 * - `discover` — passive CDP probe, no side effects
 * - `connect` — establish connection using the strategy above
 * - `disconnect` — detach from the browser. For `'cdp'` and `'persistent'`
 *   connections this closes the client WITHOUT killing the browser process —
 *   a `'persistent'` (profile-backed) launch releases ownership of its process
 *   (no kill, no exit listener) so the browser stays alive for later
 *   reattachment via CDP discovery on the same port. Rejects with the coded
 *   `BrowserConnectionError` for `'launch'` (ephemeral, no profile) sessions —
 *   use `destroy()` instead. An external disconnect (transport loss while the
 *   owned process is still alive, or the owned process exiting on its own)
 *   drives this same released/disconnected state automatically, preceded by
 *   a coded `error` — `connect()` on the same instance can reattach afterward.
 * - `destroy` — release local resources. On an owned (`'launch'`/`'persistent'`)
 *   browser this closes pages/contexts, then kills the process (SIGTERM,
 *   escalating to SIGKILL). On a `'cdp'`-attached browser this is a LOCAL
 *   DETACH ONLY — the client is closed and local context/page objects are
 *   dropped WITHOUT sending any remote close to the browser, since other
 *   clients may share those targets. Idempotent.
 * - `close` — graceful REMOTE shutdown: best-effort sends CDP `Browser.close`
 *   (works whether attached or owned), and when owned also awaits the
 *   process's exit (escalating to a kill only if it doesn't exit in time),
 *   then performs the same local cleanup as `destroy()`. Use this to shut
 *   down a browser this instance doesn't own but wants to terminate anyway.
 *
 * **Page management:**
 * - `context(index?)` → one context or first
 * - `contexts()` → all contexts
 * - `create(options?)` → shortcut to open a page in the default context
 */
export interface BrowserInterface {
	readonly emitter: EmitterInterface<BrowserEventMap>
	readonly engine: BrowserEngine
	readonly status: BrowserStatus
	readonly connection: BrowserConnection | undefined
	readonly connected: boolean
	/**
	 * The process this instance launched, if any, while it is believed alive.
	 *
	 * @remarks
	 * Remains readable after a persistent disconnect-release (the process
	 * keeps running, detached from this instance) until `destroy()` or an
	 * observed process exit clears it.
	 */
	readonly pid: number | undefined
	discover(): Promise<BrowserDiscoveryResult>
	connect(): Promise<void>
	disconnect(): Promise<void>
	context(index?: number): BrowserContextInterface | undefined
	contexts(): readonly BrowserContextInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	destroy(): Promise<void>
	close(): Promise<void>
}

// === WebSocket CDP transport

/**
 * Options for creating a WebSocketCDPTransport.
 *
 * @remarks
 * - `url` — the CDP WebSocket debugger URL to connect to
 * - `timeout` — ms before the connection attempt fails (default from constants)
 */
export interface WebSocketCDPTransportOptions {
	readonly url: string
	readonly timeout?: number
}
