# Browser

> A lightweight Chrome DevTools Protocol (CDP) automation layer, split into an
> environment-agnostic **core** and a Node **server** runtime. **Core**
> (`@orkestrel/browser`) is pure logic over an injected `CDPTransportInterface`
> — no `WebSocket`, no `node:*`, no filesystem — so it runs identically in
> Node or a browser: `CDPClient` frames JSON-RPC-shaped CDP messages over the
> transport, `BrowserContext` / `BrowserPage` model a CDP browser context and
> its pages, `BrowserCodegen` records page interactions for later script
> compilation. **Server** (`@orkestrel/browser/server`) supplies the missing
> environment pieces: `WebSocketCDPTransport` (a Node `WebSocket`-backed CDP
> transport), `Browser` (discovery → connect → launch lifecycle, spawning a
> real Chromium-family process when nothing is already listening), and a
> filesystem-backed screenshot writer. Source:
> [`src/core`](../../src/core) (via `@src/core`) +
> [`src/server`](../../src/server) (via `@src/server`).

## Surface

Server quickstart — connect to (or launch) a browser, open a page, drive it:

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ headless: true })
await browser.connect() // CDP endpoint discovery → connect, else launch
const page = await browser.create({ url: 'https://example.com' })
await page.click('#accept')
const shot = await page.screenshot({ path: './out.png' })
await browser.destroy()
```

Core quickstart — drive the CDP client directly over any transport that
satisfies `CDPTransportInterface`:

```ts
import { createCDPClient } from '@src/core'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()
const targets = await client.send('Target.getTargets')
await client.close()
```

### Core

#### Factories

| API               | Kind     | Summary                                                                   |
| ----------------- | -------- | ------------------------------------------------------------------------- |
| `createCDPClient` | function | Create a `CDPClientInterface` bound to the given `CDPTransportInterface`. |

#### Entities

| API              | Kind  | Summary                                                                                                                  |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `CDPClient`      | class | Lightweight CDP client over a `CDPTransportInterface` — JSON-RPC framing, `connect` / `send` / `subscribe` / `close`.    |
| `BrowserContext` | class | Isolated browser session over a CDP browser context — manages its `BrowserPage`s (`page` / `pages` / `create` / `sync`). |
| `BrowserPage`    | class | A single browser page or frame — navigation, content extraction, screenshot, element interaction, codegen.               |
| `BrowserCodegen` | class | Records page interactions (navigate/click/fill/select) via CDP bindings, for later compilation into a replayable script. |

#### Constants

| Constant                          | Kind  | Value                                                                                      |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `BROWSER_DEFAULT_TIMEOUT_MS`      | const | `30000` — default timeout for connection, requests, and navigation.                        |
| `BROWSER_WAIT_POLL_INTERVAL_MS`   | const | `100` — poll interval (ms) while waiting for a selector to appear.                         |
| `BROWSER_DEFAULT_VIEWPORT_WIDTH`  | const | `1280` — default viewport width in pixels.                                                 |
| `BROWSER_DEFAULT_VIEWPORT_HEIGHT` | const | `720` — default viewport height in pixels.                                                 |
| `BROWSER_CODEGEN_BINDING_NAME`    | const | `'__orkestrelBrowserCodegen'` — name of the CDP runtime binding the recorder script calls. |
| `BROWSER_CODEGEN_SOURCE`          | const | The in-page recorder script source injected via CDP to capture click/fill/select actions.  |
| `BASE64_CHARS`                    | const | The 64-character base64 alphabet used to build the decode lookup table.                    |
| `BASE64_LOOKUP`                   | const | Frozen character → 6-bit value lookup table derived from `BASE64_CHARS`.                   |

#### Errors

| Error                  | Kind  | Extends        | Code                     | Summary                                                                                                                         |
| ---------------------- | ----- | -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserError`         | class | `Error`        | `BROWSER_ERROR`          | Base error for all browser automation operations (`code` + `context`).                                                          |
| `BrowserSelectorError` | class | `BrowserError` | `BROWSER_SELECTOR_ERROR` | A selector-based lookup or wait timed out without the element appearing.                                                        |
| `CDPError`             | class | `BrowserError` | `BROWSER_CDP_ERROR`      | A CDP request received an error response from the remote endpoint (context carries `method` / CDP `code` / `message` / `data`). |

| Guard                    | Kind     | Narrows to             |
| ------------------------ | -------- | ---------------------- |
| `isBrowserError`         | function | `BrowserError`         |
| `isBrowserSelectorError` | function | `BrowserSelectorError` |
| `isCDPError`             | function | `CDPError`             |

```ts
try {
	await page.wait('#missing')
} catch (error) {
	if (isBrowserSelectorError(error)) log(error.code)
	else if (isCDPError(error)) log(error.code, error.context)
	else if (isBrowserError(error)) log(error.code)
}
```

#### Helpers

| API                         | Kind     | Summary                                                                                                      |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `decodeBase64`              | function | Decode a base64-encoded string into raw bytes (pure JS, no `Buffer`/`atob` — runs identically Node/browser). |
| `normalizeCodegenActions`   | function | Collapse consecutive `fill` actions on the same selector into the latest value.                              |
| `parseCodegenActionPayload` | function | Parse a codegen binding payload string into a typed `BrowserCodegenAction`, or `undefined` if malformed.     |
| `readCodegenNavigateAction` | function | Derive a `navigate` codegen action from a `Page.frameNavigated` CDP event (top-level frame only).            |
| `compileCodegenScript`      | function | Compile recorded codegen actions into a replayable JavaScript or TypeScript script.                          |

```ts
import {
	normalizeCodegenActions,
	parseCodegenActionPayload,
	readCodegenNavigateAction,
	compileCodegenScript,
} from '@src/core'

const actions = normalizeCodegenActions(rawActions)
const action = parseCodegenActionPayload(payload) // BrowserCodegenAction | undefined
const navigate = readCodegenNavigateAction(frameNavigatedParams)
const script = compileCodegenScript(actions, { language: 'typescript' })
```

#### Types

| Type                          | Kind      | Shape                                                                                                                                                                                   |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPTransportEventMap`        | type      | `{ message: [data: string]; close: []; error: [error: unknown] }` — the transport's observable surface.                                                                                 |
| `CDPTransportInterface`       | interface | `emitter` data member + `start` / `send` / `close` methods — the dumb text pipe a `CDPClientInterface` sends/receives JSON-RPC frames over.                                             |
| `CDPClientOptions`            | interface | `{ transport: CDPTransportInterface; timeout?: number }` — options for `createCDPClient`.                                                                                               |
| `CDPHandler`                  | type      | `(params: Readonly<Record<string, unknown>>) => void` — handler invoked for a subscribed CDP event.                                                                                     |
| `CDPTarget`                   | interface | `{ id: string; type: string; title: string; url: string }` — one entry of the CDP `Target.getTargets` result.                                                                           |
| `CDPClientInterface`          | interface | `connected` data member + `connect` / `reconnect` / `send` / `subscribe` / `unsubscribe` / `close` methods.                                                                             |
| `ScreenshotWriterInterface`   | interface | `write(path, data)` — pluggable sink for persisting screenshot bytes to a path; core never touches a filesystem directly.                                                               |
| `BrowserViewport`             | interface | `{ width: number; height: number }` — viewport dimensions for a browser page.                                                                                                           |
| `BrowserWaitUntil`            | type      | `'load' \| 'domcontentloaded' \| 'networkidle' \| 'commit'` — page load condition for navigation.                                                                                       |
| `BrowserPageOptions`          | interface | `{ url?; viewport?; timeout? }` — options for creating a browser page.                                                                                                                  |
| `BrowserNavigationOptions`    | interface | `{ condition?: BrowserWaitUntil; timeout? }` — options for page navigation (default `'load'`).                                                                                          |
| `BrowserActionOptions`        | interface | `{ timeout? }` — options for element interaction (click, fill, select, wait).                                                                                                           |
| `BrowserScreenshotOptions`    | interface | `{ path?; full?; type?: 'png' \| 'jpeg'; quality? }` — options for taking a page screenshot.                                                                                            |
| `BrowserContentResult`        | interface | `{ url: string; title: string; html: string; text: string }` — result of page content extraction.                                                                                       |
| `BrowserScreenshotResult`     | interface | `{ bytes: Uint8Array; path: string \| undefined }` — result of a page screenshot.                                                                                                       |
| `BrowserCodegenAction`        | type      | Discriminated union — `navigate` / `click` / `fill` / `select` — one recorded browser action.                                                                                           |
| `BrowserCodegenEventMap`      | type      | `{ start: []; stop: [actions]; action: [action]; clear: [] }` — the observable surface of a `BrowserCodegenInterface`.                                                                  |
| `BrowserCodegenOptions`       | interface | `{ on?: EmitterHooks<BrowserCodegenEventMap> }` — options for creating a BrowserCodegen recorder.                                                                                       |
| `BrowserCodegenLanguage`      | type      | `'javascript' \| 'typescript'` — target language for a compiled codegen script.                                                                                                         |
| `BrowserCodegenScriptOptions` | interface | `{ language?: BrowserCodegenLanguage }` — options for compiling recorded actions into a script (default `'javascript'`).                                                                |
| `BrowserCodegenInterface`     | interface | `emitter` / `started` data members + `start` / `stop` / `actions` / `script` / `clear` / `destroy` methods.                                                                             |
| `BrowserFrame`                | type      | `{ id: string; parent?: string; name?: string; url: string }` — one frame in a page's frame tree, as reported by CDP `Page.getFrameTree`.                                               |
| `BrowserPageInterface`        | interface | `url` / `closed` data members + `title` / `navigate` / `content` / `screenshot` / `click` / `fill` / `select` / `evaluate` / `wait` / `frame` / `frames` / `codegen` / `close` methods. |
| `BrowserContextInterface`     | interface | `id` data member + `page` / `pages` / `create` / `sync` / `close` methods.                                                                                                              |

### Server

Server-side connection lifecycle — discover an already-running browser via
CDP, connect to it, or launch a fresh Chromium-family process:

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ cdp: { port: 9222 } })
const discovery = await browser.discover() // passive probe, no side effects
await browser.connect() // reuses discovery.endpoint if found, else launches
const ctx = browser.context() // the default context (created lazily on `create`)
await browser.destroy() // closes the process and releases resources
```

#### Factories

| API                      | Kind     | Summary                                                                                            |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `createBrowser`          | function | Create a raw-CDP `BrowserInterface` façade with discovery, connection, and lifecycle management.   |
| `createCDPTransport`     | function | Create a Node `WebSocket`-backed `CDPTransportInterface` for the given CDP debugger URL.           |
| `createScreenshotWriter` | function | Create a filesystem-backed `ScreenshotWriterInterface` that persists bytes via `node:fs/promises`. |

#### Entities

| API                     | Kind  | Summary                                                                                                     |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `Browser`               | class | Browser wrapper with discovery, connection management, and lifecycle control (discover → connect → launch). |
| `WebSocketCDPTransport` | class | Node `WebSocket`-backed `CDPTransportInterface` — connects to a CDP WebSocket debugger URL.                 |

#### Constants

| Constant                         | Kind  | Value                                                                                                                                                                 |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DEFAULT_CDP_PORT`       | const | `9222` — default CDP port probed for an existing browser and used for launches.                                                                                       |
| `BROWSER_DEFAULT_HOST`           | const | `'127.0.0.1'` — default host probed/launched on (avoids `localhost` resolving to `::1`).                                                                              |
| `BROWSER_CDP_PROTOCOL`           | const | `'http'` — protocol prefix for CDP discovery requests.                                                                                                                |
| `BROWSER_CDP_VERSION_PATH`       | const | `'/json/version'` — path appended to the CDP host to fetch version metadata.                                                                                          |
| `BROWSER_CDP_LIST_PATH`          | const | `'/json/list'` — path appended to the CDP host to list open targets.                                                                                                  |
| `BROWSER_NOT_FOUND_RESULT`       | const | Sentinel `BrowserDiscoveryResult` returned by discovery when no browser is reachable.                                                                                 |
| `BROWSER_LAUNCH_ARGS`            | const | Frozen flags always passed to a launched browser process, alongside the caller's own.                                                                                 |
| `BROWSER_HEADLESS_ARG`           | const | `'--headless=new'` — flag enabling headless mode on a launched browser process.                                                                                       |
| `BROWSER_KILL_GRACE_MS`          | const | `3000` — grace period after SIGTERM before a launched process is escalated to SIGKILL.                                                                                |
| `BROWSER_ENV_PATH_KEYS`          | const | Frozen list of env vars checked (in order) for an explicit browser executable path override (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`).                            |
| `BROWSER_EXECUTABLE_PATHS`       | const | Frozen record of well-known Chrome/Chromium/Edge paths with no platform-specific root, keyed by `process.platform` (win32 is empty — see `BROWSER_WINDOWS_SUFFIXES`). |
| `BROWSER_WINDOWS_SUFFIXES`       | const | Frozen list of Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root.                                                   |
| `BROWSER_WINDOWS_ROOT_FALLBACKS` | const | Frozen record of fallback Windows install roots used when `PROGRAMFILES` / `PROGRAMFILES(X86)` are unset.                                                             |
| `BROWSER_EXECUTABLE_NAMES`       | const | Frozen list of command names probed on PATH when no well-known executable path exists.                                                                                |
| `BROWSER_STORE_ENV_KEY`          | const | `'PLAYWRIGHT_BROWSERS_PATH'` — env var naming an additional Playwright browser store base directory.                                                                  |
| `BROWSER_STORE_DEFAULT_DIRS`     | const | Frozen list of well-known Playwright browser store base directories (e.g. `/opt/pw-browsers`).                                                                        |
| `BROWSER_STORE_CACHE_DIRS`       | const | Frozen record of the per-OS default Playwright cache directory, relative to the home directory.                                                                       |
| `BROWSER_STORE_LINK_NAME`        | const | `'chromium'` — name of the top-level Chromium symlink/binary inside a browser store base.                                                                             |
| `BROWSER_STORE_GLOBS`            | const | Frozen record of the glob pattern matching a versioned Chromium binary, keyed by `process.platform`.                                                                  |

#### Errors

| Error                      | Kind  | Extends        | Code                          | Summary                                                                       |
| -------------------------- | ----- | -------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `BrowserConnectionError`   | class | `BrowserError` | `BROWSER_CONNECTION_ERROR`    | A CDP connection, discovery, or launch attempt failed.                        |
| `BrowserNotConnectedError` | class | `BrowserError` | `BROWSER_NOT_CONNECTED_ERROR` | An operation requiring an active connection was attempted while disconnected. |
| `BrowserDestroyedError`    | class | `BrowserError` | `BROWSER_DESTROYED_ERROR`     | An operation was attempted after the Browser was destroyed.                   |

| Guard                        | Kind     | Narrows to                 |
| ---------------------------- | -------- | -------------------------- |
| `isBrowserConnectionError`   | function | `BrowserConnectionError`   |
| `isBrowserNotConnectedError` | function | `BrowserNotConnectedError` |
| `isBrowserDestroyedError`    | function | `BrowserDestroyedError`    |

```ts
try {
	await browser.connect()
} catch (error) {
	if (isBrowserConnectionError(error)) log(error.code)
	else if (isBrowserNotConnectedError(error)) log(error.code)
	else if (isBrowserDestroyedError(error)) log(error.code)
}
```

#### Helpers

| API                    | Kind     | Summary                                                                                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findSystemBrowser`    | function | Locate a Chrome/Chromium/Edge executable (env override → well-known install paths → PATH probe → Playwright browser stores); may return `undefined`. |
| `findEnvOverride`      | function | Check the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order for an existing file.                                             |
| `defaultInstallPaths`  | function | Build the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                           |
| `windowsRoots`         | function | Derive Windows install roots from env vars, falling back to well-known literals when absent.                                                         |
| `findInstallPath`      | function | Return the first candidate path that exists on disk.                                                                                                 |
| `probePathNames`       | function | Probe PATH (`which`/`where`) for the first resolvable command name.                                                                                  |
| `defaultStoreBases`    | function | Build the default Playwright browser store base directories to search for a managed Chromium.                                                        |
| `findInStore`          | function | Search one store base for the top-level `chromium` link, else the highest-revision `chromium-*` install.                                             |
| `launchBrowserProcess` | function | Launch a browser process with raw-CDP debugging flags; returns the spawned `ChildProcess`.                                                           |
| `waitForCdpReady`      | function | Poll a browser's CDP version endpoint until it responds or the timeout elapses; returns the debugger URL.                                            |
| `fetchCdpTargets`      | function | Fetch and normalize the current CDP target list from a browser's `/json/list` endpoint.                                                              |

```ts
import {
	createCDPTransport,
	createScreenshotWriter,
	findSystemBrowser,
	findEnvOverride,
	defaultInstallPaths,
	windowsRoots,
	findInstallPath,
	probePathNames,
	defaultStoreBases,
	findInStore,
	launchBrowserProcess,
	waitForCdpReady,
	fetchCdpTargets,
} from '@src/server'

const transport = createCDPTransport({ url: 'ws://localhost:9222/devtools/browser/abc' })
const writer = createScreenshotWriter()

const executable = findSystemBrowser() // string | undefined
// findSystemBrowser({ env: {}, paths: [], names: [], stores: [] }) — override any candidate source

// findSystemBrowser's internal resolution steps, exposed for composition/testing:
const env = process.env
findEnvOverride(env) // string | undefined — PLAYWRIGHT_EXECUTABLE_PATH / CHROME_PATH
const roots = windowsRoots(env) // readonly string[] — PROGRAMFILES / PROGRAMFILES(X86) / LOCALAPPDATA
defaultInstallPaths('win32', env) // readonly string[] — well-known Chrome/Edge/Chromium paths
findInstallPath(defaultInstallPaths(process.platform, env)) // string | undefined
probePathNames(['google-chrome'], process.platform) // string | undefined — which/where probe
const stores = defaultStoreBases(env, process.platform) // readonly string[]
for (const store of stores) findInStore(store, process.platform) // string | undefined
if (executable !== undefined) {
	const child = launchBrowserProcess(executable, 9222, true)
	const debuggerUrl = await waitForCdpReady(9222, 5000)
	const targets = await fetchCdpTargets(9222, 5000)
}
```

#### Types

| Type                           | Kind      | Shape                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserEngine`                | type      | `'chromium'` — the supported browser engine (raw CDP targets Chromium-family browsers only).                                                                                                                                                                               |
| `BrowserConnection`            | type      | `'cdp' \| 'launch' \| 'persistent'` — how the browser connection was established.                                                                                                                                                                                          |
| `BrowserStatus`                | type      | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error'` — lifecycle status of a browser wrapper.                                                                                                                                                              |
| `BrowserDiscoveryResult`       | interface | `{ found: boolean; endpoint?; browser?; connection? }` — result of passive browser discovery.                                                                                                                                                                              |
| `SystemBrowserOptions`         | interface | `{ env?; paths?; names?; stores? }` — overrides for `findSystemBrowser`'s candidate sources (env-override keys/Windows roots, install paths, PATH-probe names, Playwright store base dirs); each field replaces its category's default, an explicit `[]`/`{}` disables it. |
| `BrowserCdpOptions`            | interface | `{ port?: number; host?: string; endpoint?: string }` — CDP connection configuration (`host` defaults to `BROWSER_DEFAULT_HOST`).                                                                                                                                          |
| `BrowserEventMap`              | type      | `{ idle: []; discover: [result]; connect: [connection]; disconnect: []; launch: [engine]; page: [page]; error: [error]; destroy: [] }`.                                                                                                                                    |
| `BrowserOptions`               | interface | `{ on?; headless?; executable?; profile?; cdp?; timeout?; viewport?; signal?; args? }` — options for `createBrowser`.                                                                                                                                                      |
| `BrowserInterface`             | interface | `emitter` / `engine` / `status` / `connection` / `connected` data members + `discover` / `connect` / `disconnect` / `context` / `contexts` / `create` / `destroy` methods.                                                                                                 |
| `WebSocketCDPTransportOptions` | interface | `{ url: string; timeout?: number }` — options for creating a WebSocketCDPTransport.                                                                                                                                                                                        |

## Methods

The public methods of the layer's behavioral interfaces — every call-signature
member listed (their `readonly` data members stay Surface rows). Each
implementing class exposes EXACTLY its interface's methods: `CDPClient` ↔
`CDPClientInterface`, `BrowserContext` ↔ `BrowserContextInterface`,
`BrowserPage` ↔ `BrowserPageInterface`, `BrowserCodegen` ↔
`BrowserCodegenInterface`, `Browser` ↔ `BrowserInterface`,
`WebSocketCDPTransport` ↔ `CDPTransportInterface`.

#### `CDPTransportInterface`

The text pipe a `CDPClientInterface` sends and receives JSON-RPC frames over.

| Method  | Returns         | Behavior                                               |
| ------- | --------------- | ------------------------------------------------------ |
| `start` | `Promise<void>` | Open the underlying connection.                        |
| `send`  | `Promise<void>` | Write one raw text frame to the connection.            |
| `close` | `Promise<void>` | Close the underlying connection and release resources. |

```ts
transport.emitter.on('message', (data) => log(data))
await transport.start()
await transport.send('{"id":1,"method":"Target.getTargets"}')
await transport.close()
```

#### `CDPClientInterface`

Frames JSON-RPC-shaped CDP method calls and events over an injected
`CDPTransportInterface`. `connect` starts the transport and begins
dispatching; `send` issues a CDP method call (optionally session-scoped);
`subscribe` / `unsubscribe` register or remove a handler for a CDP event
(optionally session-scoped). Subscriptions are client-level registrations,
not connection-level state — they survive `close()` and a subsequent
`reconnect()` / `connect()`, and resume firing once reconnected. Calling
`close()` while a `connect()` is still in flight rejects that in-flight
connect attempt.

| Method        | Returns            | Behavior                                                                                          |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `connect`     | `Promise<void>`    | Start the transport and begin dispatching. Idempotent.                                            |
| `reconnect`   | `Promise<void>`    | Close and re-establish the transport.                                                             |
| `send`        | `Promise<unknown>` | Issue a CDP method call with optional params, optionally scoped to a session; rejects on timeout. |
| `subscribe`   | `void`             | Register a handler for a CDP event, optionally session-scoped.                                    |
| `unsubscribe` | `void`             | Remove a handler for a CDP event, optionally session-scoped.                                      |
| `close`       | `Promise<void>`    | Tear down the transport and reject all pending requests.                                          |

```ts
import { createCDPClient } from '@src/core'

const client = createCDPClient({ transport })
await client.connect()
const targets = await client.send('Target.getTargets')
const onCreated = (params) => log(params)
client.subscribe('Target.targetCreated', onCreated)
client.unsubscribe('Target.targetCreated', onCreated)
await client.reconnect()
await client.close()
```

#### `BrowserContextInterface`

An isolated browser session over a CDP browser context; follows the manager
accessor pattern (`page(index?)` / `pages()`).

| Method   | Returns                             | Behavior                                                                                              |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `page`   | `BrowserPageInterface \| undefined` | One page by index, or the first page.                                                                 |
| `pages`  | `readonly BrowserPageInterface[]`   | All pages in creation order.                                                                          |
| `create` | `Promise<BrowserPageInterface>`     | Open a new page in this context.                                                                      |
| `sync`   | `Promise<void>`                     | Synchronize pages from the given CDP targets (server discovers the targets, core never fetches them). |
| `close`  | `Promise<void>`                     | Close the context and all its pages.                                                                  |

```ts
const ctx = browser.context()
const page = await ctx?.create({ url: 'https://example.com' })
const all = ctx?.pages() // readonly BrowserPageInterface[]
await ctx?.sync(targets) // reconcile pages from discovered CDP targets
await ctx?.close()
```

#### `BrowserPageInterface`

Abstraction over a single browser page or frame.

| Method       | Returns                              | Behavior                                                                  |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| `title`      | `Promise<string>`                    | Resolve the document title.                                               |
| `navigate`   | `Promise<void>`                      | Go to a URL and wait for the specified load condition (default `'load'`). |
| `content`    | `Promise<BrowserContentResult>`      | Extract page URL, title, HTML, and visible text.                          |
| `screenshot` | `Promise<BrowserScreenshotResult>`   | Capture a PNG or JPEG image of the page.                                  |
| `click`      | `Promise<void>`                      | Click an element matching the selector.                                   |
| `fill`       | `Promise<void>`                      | Type text into an input element.                                          |
| `select`     | `Promise<void>`                      | Choose option(s) in a `<select>` element.                                 |
| `evaluate`   | `Promise<unknown>`                   | Execute a JavaScript expression in the page context.                      |
| `wait`       | `Promise<void>`                      | Wait for an element matching the selector to appear.                      |
| `frame`      | `Promise<BrowserFrame \| undefined>` | Look up a frame by name or URL in the page's flattened frame tree.        |
| `frames`     | `Promise<readonly BrowserFrame[]>`   | List the page's flattened frame tree, main frame first.                   |
| `codegen`    | `Promise<BrowserCodegenInterface>`   | Start (or return the existing) action recorder for this page.             |
| `close`      | `Promise<void>`                      | Close the page.                                                           |

```ts
await page.navigate('https://example.com')
const heading = await page.title()
await page.click('#submit')
await page.fill('#name', 'Ada')
await page.select('#lang', ['en'])
const content = await page.content()
const result = await page.evaluate('document.title')
const shot = await page.screenshot({ full: true, type: 'png' })
const child = await page.frame('checkout') // BrowserFrame | undefined
const children = await page.frames() // readonly BrowserFrame[]
await page.close()
```

#### `BrowserCodegenInterface`

Records page interactions as a session runs, for later compilation into a
replayable script.

| Method    | Returns                                    | Behavior                                         |
| --------- | ------------------------------------------ | ------------------------------------------------ |
| `start`   | `Promise<void>`                            | Begin recording on the page's session.           |
| `stop`    | `Promise<readonly BrowserCodegenAction[]>` | Stop recording and return the captured actions.  |
| `actions` | `readonly BrowserCodegenAction[]`          | Current normalized action list.                  |
| `script`  | `string`                                   | Compile the captured actions into a script.      |
| `clear`   | `void`                                     | Reset the captured action list.                  |
| `destroy` | `Promise<void>`                            | Tear down the recorder and detach CDP listeners. |

```ts
const codegen = await page.codegen()
await page.click('#next')
const actions = await codegen.stop()
const script = codegen.script({ language: 'typescript' })
codegen.clear() // reset the captured action list
await codegen.destroy()
```

#### `BrowserInterface`

Browser wrapper with discovery, connection management, and lifecycle control.
Connection strategy (executed by `connect()`): explicit `cdp.endpoint` →
passive discovery on `cdp.port` → launch a new process.

| Method       | Returns                                | Behavior                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover`   | `Promise<BrowserDiscoveryResult>`      | Passive CDP probe, no side effects.                                                                                                                                                                                                           |
| `connect`    | `Promise<void>`                        | Establish a connection using the strategy above (endpoint → discovery → launch). Idempotent.                                                                                                                                                  |
| `disconnect` | `Promise<void>`                        | Detach the client-side connection and release it (CDP only) — the remote browser keeps running. Rejects with `BrowserConnectionError` if this instance launched the session (a live process); use `destroy()` for a launched session instead. |
| `context`    | `BrowserContextInterface \| undefined` | One context by index, or the first.                                                                                                                                                                                                           |
| `contexts`   | `readonly BrowserContextInterface[]`   | All contexts.                                                                                                                                                                                                                                 |
| `create`     | `Promise<BrowserPageInterface>`        | Shortcut to open a page in the default context.                                                                                                                                                                                               |
| `destroy`    | `Promise<void>`                        | Close the browser process and release all resources.                                                                                                                                                                                          |

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ cdp: { port: 9222 } })
browser.emitter.on('connect', (mode) => log(mode))
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })
const all = browser.contexts() // readonly BrowserContextInterface[]
await browser.disconnect() // detach from CDP without closing the browser
await browser.destroy()
```

## Contract

These invariants hold across the browser layer (`src/core` + `src/server`) ↔ `browser.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `class` / `const` /
   `interface` / `type` / error row in the `### Core` and `### Server`
   `## Surface` tables is a real export of the browser layer (`src/core` or
   `src/server`), and every export of either appears as a Surface row —
   exhaustive, both directions.
2. **Core is environment-agnostic.** `src/core` imports only
   `@orkestrel/emitter` and `@orkestrel/contract` — no `node:*`, no
   `WebSocket`, no filesystem. Every CDP method call and event flows through
   the injected `CDPTransportInterface`; core never assumes a runtime.
3. **The transport is a dumb text pipe.** `CDPTransportInterface` does no
   JSON framing of its own — `CDPClient` owns request/response correlation
   (`id`), timeout handling, and event dispatch (global + session-scoped
   subscriptions) over the transport's raw `message` / `close` / `error`
   events.
4. **Screenshots never touch a filesystem in core.** `BrowserPage.screenshot`
   accepts an optional `ScreenshotWriterInterface` (injected via
   `BrowserContext`) and calls `write(path, bytes)` only when a `path` is
   given; the server supplies `createScreenshotWriter` (an `fs`-backed
   implementation) via `Browser`.
5. **Server owns the connection lifecycle.** `Browser.connect()` tries, in
   order: an explicit `cdp.endpoint`; a passive probe of `localhost:{cdp.port}`
   (`discover()`); then launching a new browser process with raw-CDP flags
   (`findSystemBrowser` / `launchBrowserProcess` / `waitForCdpReady`). A
   found existing browser is preferred over a fresh launch.
6. **Lifecycle events are observable, never inferred from state polling.**
   `BrowserInterface.emitter` fires `idle` / `discover` / `connect` /
   `disconnect` / `launch` / `page` / `error` / `destroy`; `BrowserCodegenInterface.emitter`
   fires `start` / `stop` / `action` / `clear`. Both isolate a listener throw
   via `@orkestrel/emitter`'s emitter, never a domain event.
7. **Errors carry a machine-readable `code` + optional `context`.**
   `BrowserError` (core) is the base; `BrowserSelectorError` (core) narrows a
   selector timeout; `BrowserConnectionError` / `BrowserNotConnectedError` /
   `BrowserDestroyedError` (server) narrow connection-lifecycle faults. Each
   ships an `is*` type guard.
8. **Codegen normalizes and compiles deterministically.**
   `normalizeCodegenActions` collapses consecutive `fill`s on the same
   selector to the latest value; `compileCodegenScript` emits one
   `page.<action>(...)` statement per normalized action, `'javascript'`
   (bare `async function run(page) {...}`) or `'typescript'`
   (`import('@orkestrel/browser').BrowserPageInterface`-typed) per
   `BrowserCodegenScriptOptions.language` (default `'javascript'`).
9. **DOC ↔ SOURCE method bijection.** The `## Methods` tables list exactly
   the public methods of each behavioral interface — `CDPTransportInterface`,
   `CDPClientInterface`, `BrowserContextInterface`, `BrowserPageInterface`,
   `BrowserCodegenInterface`, `BrowserInterface` — exhaustive, both
   directions, and each implementing class (`WebSocketCDPTransport`,
   `CDPClient`, `BrowserContext`, `BrowserPage`, `BrowserCodegen`, `Browser`)
   exposes the same public methods, no more. The remaining exports add no
   behavioral interface with methods (the factories, `decodeBase64` /
   `parseCodegenActionPayload` / `readCodegenNavigateAction` /
   `compileCodegenScript` / `findSystemBrowser` / `launchBrowserProcess` /
   `waitForCdpReady` / `fetchCdpTargets` are functions; the options
   interfaces / event maps / results / `CDPTarget` / `BrowserViewport` are
   data bags), so they contribute no `## Methods` row.
10. **The WebSocket CDP transport is a thin bridge (`src/server`).**
    `WebSocketCDPTransport` connects a Node `WebSocket` to the given CDP
    debugger URL, races the connection attempt against `timeout`
    (default `BROWSER_DEFAULT_TIMEOUT_MS`), and bridges the socket's
    `message` / `close` / `error` events onto its `CDPTransportEventMap`
    emitter unchanged (no framing of its own). `start()` rejects with a
    `BrowserConnectionError` (URL in `context`) on socket error, non-open
    close, or timeout — never a bare error.
11. **`Browser.destroy()` escalates SIGTERM → SIGKILL.** A launched process
    is sent `SIGTERM`; if it has not exited after `BROWSER_KILL_GRACE_MS`, it
    is force-killed with `SIGKILL`. `BrowserInterface.connected` is a pure,
    derived getter (`status === 'connected'`) — never separately tracked
    state.

## Patterns

### Automate a page end-to-end

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ headless: true })
await browser.connect()

const page = await browser.create({ url: 'https://example.com' })
await page.fill('#search', 'orkestrel')
await page.click('#submit')
await page.wait('#results')
const content = await page.content()

await browser.destroy()
```

### Record and replay interactions with codegen

```ts
const page = await browser.create({ url: 'https://example.com' })
const codegen = await page.codegen()

await page.click('#menu')
await page.fill('#search', 'orkestrel')

const actions = await codegen.stop()
const script = codegen.script({ language: 'typescript' })
await codegen.destroy()
```

### Drive the core client directly over an injected transport

Useful when embedding in a non-Node environment, or in a test with a fake
transport that satisfies `CDPTransportInterface`.

```ts
import { createCDPClient } from '@src/core'

const client = createCDPClient({ transport: myTransport })
await client.connect()

const result = await client.send('Page.navigate', { url: 'https://example.com' })
client.subscribe('Page.frameNavigated', (params) => log(params))

await client.close()
```
