import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { StdioServerOptions } from '@orkestrel/mcp/server'
import type { ToolDefinition, ToolInterface } from '@orkestrel/tool'
import type { PoolToken } from '@orkestrel/pool'
import type {
	BrowserCallOptions,
	BrowserContextInterface,
	BrowserContextOptions,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserToolsetInterface,
	BrowserViewport,
	CDPTransportEventMap,
} from '@src/core'

// === Browser shared

/** Names a supported browser engine (raw CDP targets Chromium-family browsers only). */
export type BrowserEngine = 'chromium' | 'chrome' | 'edge'

/** Names how the browser connection was established. */
export type BrowserConnection = 'cdp' | 'launch' | 'persistent'

/** Names the lifecycle status of a browser wrapper. */
export type BrowserStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * Describes the result of passive browser discovery.
 *
 * @remarks
 * Returned by `discover()` to report whether an existing browser is
 * reachable through CDP without actually connecting to it. A defined
 * `endpoint` is the whole answer — no separate flag repeats it.
 *
 * - `endpoint` — the CDP WebSocket URL, or undefined when nothing answered
 * - `browser` — browser product name reported by the endpoint
 */
export interface BrowserDiscoveryResult {
	readonly endpoint: string | undefined
	readonly browser: string | undefined
}

/**
 * Describes the options overriding `findSystemBrowsers`'/`findSystemBrowser`'s candidate sources.
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
 * Represents one discovered browser executable on this machine.
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
 * Describes the resolved browser profile directory used for a Chromium-family launch.
 *
 * @remarks
 * `temporary` is true only for an isolated profile created by
 * {@link createBrowserProfile}; caller-supplied persistent profiles are
 * never removed by the library.
 */
export interface BrowserProfileResult {
	readonly path: string
	readonly temporary: boolean
}

/** Names the browser a browse profile serves, which a later start's sweep reads. */
export interface BrowserProfileRecord {
	readonly pid: number
	readonly endpoint: string
}

/**
 * Configures the CDP (Chrome DevTools Protocol) connection.
 *
 * @remarks
 * - `port` — port number to probe for an existing CDP endpoint (default `9222`)
 * - `host` — host to probe/launch on (default `127.0.0.1`; avoids `localhost`
 *   resolving to `::1` when Chromium binds `127.0.0.1`)
 * - `endpoint` — explicit CDP WebSocket URL; when provided, skips discovery
 * - `discover` — whether `connect()` passively probes for an existing browser
 *   before launching (default `true`); set `false` to skip discovery and go
 *   straight to launch — when `port` is explicit, a short probe runs first and rejects
 *   with a coded error naming the occupied port if something is already
 *   listening there, so a demanded fresh launch never silently attaches to a
 *   stranger browser
 */
export interface BrowserCDPOptions {
	readonly port?: number
	readonly host?: string
	readonly endpoint?: string
	readonly discover?: boolean
}

/**
 * Maps the events a {@link BrowserInterface} emits.
 *
 * @remarks
 * - `idle` — no active connection (initial state, or after disconnect)
 * - `discover` — passive CDP probe completed
 * - `connect` — a connection was established, carrying the mode used
 * - `disconnect` — the connection was detached — either explicitly, or after
 *   an external disconnect (process exit or transport loss); always preceded
 *   by a coded `error` describing the cause
 * - `launch` — a new browser process was launched, carrying the engine
 * - `page` — a new page was created through the `create()` shortcut
 * - `context` — an isolated browser context was created, carrying the context
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
	readonly context: readonly [context: BrowserContextInterface]
	readonly error: readonly [error: unknown]
	readonly destroy: readonly []
}

/**
 * Describes the options for creating a `Browser` instance.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
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
	readonly error?: EmitterErrorHandler
	readonly headless?: boolean
	readonly executable?: string
	readonly profile?: string
	readonly cdp?: BrowserCDPOptions
	readonly timeout?: number
	readonly viewport?: BrowserViewport
	readonly signal?: AbortSignal
	readonly args?: readonly string[]
	readonly engine?: BrowserEngine
	readonly browsers?: SystemBrowserOptions
}

/**
 * Wraps a browser with discovery, connection management, and lifecycle control.
 *
 * @remarks
 * Encapsulates the full raw-CDP browser lifecycle behind a clean interface:
 *
 * **Connection strategy** (executed by `connect()`):
 * 1. If `cdp.endpoint` is set, connect directly through CDP
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
 * - `adopt` — explicitly assume responsibility for terminating the connected
 *   browser, including a browser this instance attached to over CDP
 * - `disconnect` — detach from the browser. For attached CDP connections this
 *   closes only the client. For owned launches and adopted connections, it
 *   retains ownership and the endpoint so the same instance can reconnect
 *   and remains responsible for eventual termination. An external disconnect
 *   (transport loss while the owned process is still alive, or the owned
 *   process exiting on its own) drives the disconnected state, preceded by
 *   a coded `error` — `connect()` on the same instance can reattach afterward.
 * - `destroy` — release local resources. On a launched browser this closes
 *   pages/contexts, then kills and awaits the process serving the CDP endpoint
 *   plus its POSIX process group. On an adopted browser it sends
 *   `Browser.close`. On a merely
 *   attached browser this is a local detach only, because other clients may
 *   share its targets. Idempotent.
 * - `close` — graceful remote shutdown: best-effort sends CDP `Browser.close`
 *   (works whether attached or owned), and when owned also awaits the exit of
 *   the process serving the CDP endpoint plus its POSIX process-group drain
 *   (escalating to a kill only if needed), then performs the same local cleanup
 *   as `destroy()`. Use this to shut down a browser this instance doesn't own
 *   but wants to terminate anyway.
 *
 * **Page management:**
 * - `context(index?)` → one context or first
 * - `contexts()` → all contexts
 * - `isolate` — create and register an isolated CDP context with validated
 *   proxy, download, origin, and emulation options
 * - `create(options?)` → shortcut to open a page in the default context
 */
export interface BrowserInterface {
	/** Reports the CDP WebSocket endpoint of the represented session, or undefined when none is. */
	readonly endpoint: string | undefined
	/** Sends CDP `Browser.getVersion` and resolves when the browser answers, changing no state. */
	ping(options?: BrowserCallOptions): Promise<void>
	readonly emitter: EmitterInterface<BrowserEventMap>
	readonly engine: BrowserEngine
	readonly status: BrowserStatus
	readonly connection: BrowserConnection | undefined
	/**
	 * Reports whether this instance is responsible for terminating the represented browser.
	 *
	 * @remarks
	 * `true` for launched and explicitly adopted sessions, `false` for an
	 * active attachment, and `undefined` when no session is represented.
	 */
	readonly owned: boolean | undefined
	/**
	 * Reports the process serving this session's CDP endpoint, if any, while it is
	 * believed alive.
	 *
	 * @remarks
	 * A launch owns the process behind its endpoint rather than the process it
	 * spawned. The two are the same until the spawned process is a launcher
	 * that re-executes the browser and exits before the endpoint answers —
	 * Microsoft Edge on Windows — in which case this reports the process the
	 * launcher handed the endpoint to. Remains readable after a persistent
	 * disconnect (the process keeps running, detached from the transport)
	 * until `destroy()` or an observed process exit clears it.
	 */
	readonly pid: number | undefined
	/**
	 * Probes CDP passively, changing no connection state and neither launching nor attaching,
	 * and emits a `discover` event with the result.
	 */
	discover(): Promise<BrowserDiscoveryResult>
	/**
	 * Establishes a connection through the endpoint, then discovery, then a launch.
	 * Idempotent.
	 */
	connect(): Promise<void>
	/** Assumes responsibility for terminating the connected browser. */
	adopt(): void
	/**
	 * Detaches the client-side transport while the remote browser keeps running. An attached CDP
	 * session that this instance neither launched nor adopted forgets the endpoint and its
	 * ownership becomes `undefined`. A launched or explicitly adopted session retains ownership
	 * and its endpoint, so the same instance can reconnect and stays responsible for eventual
	 * termination. Transport loss while an owned browser remains alive is resumable the same way.
	 */
	disconnect(): Promise<void>
	/** Returns one context by index, or the first. */
	context(index?: number): BrowserContextInterface | undefined
	/** Returns every context. */
	contexts(): readonly BrowserContextInterface[]
	/**
	 * Creates and registers an isolated CDP context with validated proxy, download, origin,
	 * and emulation options.
	 */
	isolate(options?: BrowserContextOptions): Promise<BrowserContextInterface>
	/** Opens a page in the default context. */
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	/**
	 * Releases local resources. A launched browser has the process serving its CDP endpoint
	 * terminated and its exit awaited — on POSIX that terminate reaches the launch's whole
	 * process group and awaits its drain, and on Windows it terminates one process by
	 * identifier, the spawned process or the one a launcher handed the endpoint to — which
	 * leaves the profile unlocked before cleanup. An adopted attachment is sent CDP
	 * `Browser.close`. An attached browser that this instance neither launched nor adopted is
	 * detached locally and nothing more, because other clients might share its targets.
	 * Idempotent.
	 */
	destroy(): Promise<void>
	/**
	 * Shuts the remote browser down: sends CDP `Browser.close` best-effort whether attached or
	 * owned, and for an owned browser also awaits the exit of the process serving the CDP
	 * endpoint plus its POSIX process-group drain, escalating to a kill only where needed.
	 * Then closes every tracked context and page, sending remote `Target.closeTarget` and
	 * `disposeBrowserContext` whatever the ownership, before releasing the CDP client. This is
	 * the way to shut down a browser the instance does not own and still wants terminated.
	 */
	close(): Promise<void>
}

// === WebSocket CDP transport

/**
 * Describes the options for creating a `WebSocketCDPTransport` instance.
 *
 * @remarks
 * - `on` — initial event listeners wired at construction
 * - `error` — observer error handler forwarded to the emitter
 * - `url` — the CDP WebSocket debugger URL to connect to
 * - `timeout` — ms before the connection attempt fails (default from constants)
 */
export interface WebSocketCDPTransportOptions {
	readonly on?: EmitterHooks<CDPTransportEventMap>
	readonly error?: EmitterErrorHandler
	readonly url: string
	readonly timeout?: number
}

// === Browser journey stores

/**
 * Configures a file store: its root under the checkout and the listing cap.
 *
 * @remarks
 * - `root` — the directory the store keeps its entries under, such as `tmp/browsers`, resolved
 *   through `realpath` one time; every path the store reads or writes lies inside it
 * - `limit` — the most entries one `list` page holds
 */
export interface FileBrowserStoreOptions {
	readonly root: string
	readonly limit?: number
}

// === Browser MCP server

/**
 * Creates a browser a browse server connects while warming its pool.
 *
 * @param options - The launch the server composes: `headless`, `executable`, the profile it
 *   owns, the optional `viewport`, `cdp.discover` set to `false`, and the signal its `destroy()` aborts
 * @returns A browser whose `connect()` launches it
 */
export type BrowserLaunchFunction = (options: BrowserOptions) => BrowserInterface

/** Holds one pooled browser and its exclusively owned profile. */
export interface BrowserSlot {
	readonly browser: BrowserInterface
	readonly profile: string
}

/** Holds one prepared or assigned context generation and its downloads directory. */
export interface BrowserServerContext {
	readonly context: BrowserContextInterface
	readonly toolset: BrowserToolsetInterface
	readonly directory: string
}

/** Binds a holder generation to the exact browser lease reserved for its lifetime. */
export interface BrowserServerLease {
	readonly token: PoolToken<BrowserSlot>
	readonly generation: BrowserServerContext
}

/** Records a lost generation's cause and its own last URL. */
export interface BrowserServerLoss {
	readonly cause: unknown
	readonly url: string
}

/** Holds the listeners and resolver of one browser slot's loss watch. */
export interface BrowserSlotWatch {
	readonly resolve: (cause: unknown) => void
	readonly disconnect: () => void
	readonly subscription: Disposable
}

/** Holds page subscriptions for one prepared or assigned context generation. */
export interface BrowserServerWatch {
	readonly page: (page: BrowserPageInterface) => void
	readonly crashes: ReadonlyMap<BrowserPageInterface, () => void>
}

/**
 * Configures the browse server.
 *
 * @remarks
 * - `root` — the directory the journeys, the runs, and the browser profiles live under, resolved
 *   against the working directory at construction. Default: `tmp/browsers`
 * - `headless` — if `true`, launches Chromium without a window; if `false`, with one. Default:
 *   `true`
 * - `executable` — the path of the Chromium executable the server launches. Default: the browser
 *   `findSystemBrowser` finds
 * - `viewport` — the default viewport for every page in each browser's isolated context;
 *   omission keeps the browser's launch default
 * - `readonly` — if `true`, refuses `record`, `save`, `edit`, and `forget`, and `replay` still writes runs;
 *   if `false` or omitted, every tool runs
 * - `launch` — creates each browser the pool warms. Default: `createBrowser`
 * - `stdio` — the streams the server reads requests from and writes answers to; the end of
 *   `input` destroys the server. Default: `process.stdin` and `process.stdout`
 * - `pool.size` — the integer number of browsers kept warm, from 1 through
 *   `BROWSER_SERVER_POOL_LIMIT`. Default: `BROWSER_SERVER_POOL_SIZE`.
 * - `pool.contexts` — the integer context capacity per browser, shared holder included, from 1
 *   through `BROWSER_SERVER_CONTEXTS_LIMIT`. Default: `BROWSER_SERVER_CONTEXTS`.
 * - `log` — receives diagnostic lines. Default: `process.stderr`
 * @throws Thrown when `pool.size` or `pool.contexts` is outside its range or is not an integer, with `BROWSER_SERVER_OPTIONS`
 */
export interface BrowserMCPServerOptions {
	readonly root?: string
	readonly headless?: boolean
	readonly executable?: string
	readonly viewport?: BrowserViewport
	readonly readonly?: boolean
	readonly launch?: BrowserLaunchFunction
	readonly stdio?: StdioServerOptions
	readonly pool?: { readonly size?: number; readonly contexts?: number }
	readonly log?: NodeJS.WritableStream
}

/** Names the server tools that manage independent browser holders. */
export type BrowserServerToolName = 'acquire' | 'execute' | 'tools' | 'destroy'

/** Identifies one admitted browser lifetime independently of its current pool token. */
export interface BrowserServerHolder {
	readonly id: string
	readonly purpose: string
	readonly abort: AbortController
}

/** Describes the JSON catalog returned by the holder tools. */
export interface BrowserServerCatalog {
	readonly holder: string
	readonly tools: readonly ToolDefinition[]
}

/** Binds shared catalog subscriptions to the exact generation that published them. */
export interface BrowserServerMirror {
	readonly lease: BrowserServerLease
	readonly added: (tool: ToolInterface) => void
	readonly removed: (tool: ToolInterface) => void
	readonly cleared: (tools: readonly ToolInterface[]) => void
}

/** Serves the browser vocabulary and the journey tools over MCP on stdio. */
export interface BrowserMCPServerInterface {
	/**
	 * Serves stdio, sweeps the profiles ended servers left, warms the pool, and resolves after the
	 * shared holder consumes a prepared context on a warm browser; the legacy handshake and every tool call await the same setup.
	 * Rejects with `BROWSER_SERVER_UNAVAILABLE` when no browser can serve and with
	 * `BROWSER_TOOLSET_ENDED` after `destroy()`, and resolves when `destroy()` interrupts setup.
	 */
	start(): Promise<void>
	/**
	 * Stops admission, tears down every browser, its toolset, and its profile, then rechecks the folders it answers for.
	 */
	destroy(): Promise<void>
}
