import type { EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserViewport,
} from '@src/core'

// === Browser shared

/** Supported browser engine (raw CDP targets Chromium-family browsers only). */
export type BrowserEngine = 'chromium'

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
 * CDP (Chrome DevTools Protocol) connection configuration.
 *
 * @remarks
 * - `port` — port number to probe for an existing CDP endpoint (default `9222`)
 * - `endpoint` — explicit CDP WebSocket URL; when provided, skips discovery
 */
export interface BrowserCdpOptions {
	readonly port?: number
	readonly endpoint?: string
}

/**
 * Event map for a {@link BrowserInterface}.
 *
 * @remarks
 * - `idle` — no active connection (initial state, or after disconnect)
 * - `discover` — passive CDP probe completed
 * - `connect` — a connection was established, carrying the mode used
 * - `disconnect` — the connection was detached (browser process kept alive)
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
 * - `disconnect` — detach from the browser WITHOUT closing it (CDP only)
 * - `destroy` — close the browser process and release all resources
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
	discover(): Promise<BrowserDiscoveryResult>
	connect(): Promise<void>
	disconnect(): void
	context(index?: number): BrowserContextInterface | undefined
	contexts(): readonly BrowserContextInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	destroy(): Promise<void>
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
