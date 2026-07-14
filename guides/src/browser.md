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

| Constant                               | Kind  | Value                                                                                                                                                                                                                                             |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DEFAULT_TIMEOUT_MS`           | const | `30000` — default timeout for connection, requests, and navigation.                                                                                                                                                                               |
| `BROWSER_WAIT_POLL_INTERVAL_MS`        | const | `100` — poll interval (ms) while waiting for a selector to appear.                                                                                                                                                                                |
| `BROWSER_DEFAULT_VIEWPORT_WIDTH`       | const | `1280` — default viewport width in pixels.                                                                                                                                                                                                        |
| `BROWSER_DEFAULT_VIEWPORT_HEIGHT`      | const | `720` — default viewport height in pixels.                                                                                                                                                                                                        |
| `BROWSER_CODEGEN_BINDING_NAME`         | const | `'__orkestrelBrowserCodegen'` — name of the CDP runtime binding the recorder script calls.                                                                                                                                                        |
| `BROWSER_CODEGEN_SOURCE`               | const | The in-page recorder script source injected via CDP to capture click/fill/select actions (a `contenteditable` fill is captured via `input` events same as inputs/textareas).                                                                      |
| `BASE64_CHARS`                         | const | The 64-character base64 alphabet used to build the decode lookup table.                                                                                                                                                                           |
| `BASE64_LOOKUP`                        | const | Frozen character → 6-bit value lookup table derived from `BASE64_CHARS`.                                                                                                                                                                          |
| `BROWSER_RESULT_LIMIT`                 | const | `2_500_000` — maximum serialized-character length (UTF-16, not transport bytes) for an `evaluate()`/`content()` result, enforced in-page before the result reaches CDP (kept well under the ~3-4MB transport ceiling for UTF-8/framing headroom). |
| `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` | const | `'[[ORKESTREL_BROWSER_RESULT_LIMIT]]'` — distinctive prefix for the in-page result-limit sentinel error, immediately followed by the serialized length.                                                                                           |
| `BROWSER_RESULT_LIMIT_PATTERN`         | const | Regex anchored on `(?:Uncaught )?Error: [[ORKESTREL_BROWSER_RESULT_LIMIT]](\d+)`, recognizing only the guard's own sentinel throw (not a page error that merely mentions similar text).                                                           |
| `BROWSER_STOP_LOADING_TIMEOUT_MS`      | const | `1_000` — short cap (ms) on the best-effort `Page.stopLoading` call issued after a failed `navigate()`, so a wedged renderer cannot stretch the failure path out to the full per-call timeout.                                                    |

#### Errors

| Error                     | Kind  | Extends        | Code                           | Summary                                                                                                                                                                         |
| ------------------------- | ----- | -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserError`            | class | `Error`        | `BROWSER_ERROR`                | Base error for all browser automation operations (`code` + `context`).                                                                                                          |
| `BrowserSelectorError`    | class | `BrowserError` | `BROWSER_SELECTOR_ERROR`       | A selector-based lookup or wait timed out without the element appearing.                                                                                                        |
| `CDPError`                | class | `BrowserError` | `BROWSER_CDP_ERROR`            | A CDP request received an error response from the remote endpoint (context carries `method` / CDP `code` / `message` / `data`).                                                 |
| `CDPConnectionError`      | class | `BrowserError` | `BROWSER_CDP_CONNECTION_ERROR` | A CDP request could not be sent or completed because the client was not in a connectable state (not connected, closed while connecting, or the connection dropped mid-request). |
| `CDPTimeoutError`         | class | `BrowserError` | `BROWSER_CDP_TIMEOUT_ERROR`    | A pending CDP request was not answered within its timeout window.                                                                                                               |
| `BrowserResultLimitError` | class | `BrowserError` | `BROWSER_RESULT_LIMIT_ERROR`   | An `evaluate()`/`content()` result exceeded `BROWSER_RESULT_LIMIT` and was rejected in-page before it could overflow the CDP transport frame.                                   |

| Guard                       | Kind     | Narrows to                |
| --------------------------- | -------- | ------------------------- |
| `isBrowserError`            | function | `BrowserError`            |
| `isBrowserSelectorError`    | function | `BrowserSelectorError`    |
| `isCDPError`                | function | `CDPError`                |
| `isCDPConnectionError`      | function | `CDPConnectionError`      |
| `isCDPTimeoutError`         | function | `CDPTimeoutError`         |
| `isBrowserResultLimitError` | function | `BrowserResultLimitError` |

```ts
try {
	await page.wait('#missing')
} catch (error) {
	if (isBrowserSelectorError(error)) log(error.code)
	else if (isCDPError(error)) log(error.code, error.context)
	else if (isCDPConnectionError(error)) log(error.code)
	else if (isCDPTimeoutError(error)) log(error.code)
	else if (isBrowserResultLimitError(error)) log(error.code, error.context)
	else if (isBrowserError(error)) log(error.code)
}
```

#### Helpers

| API                         | Kind     | Summary                                                                                                                                                                                         |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeBase64`              | function | Decode a base64-encoded string into raw bytes (pure JS, no `Buffer`/`atob` — runs identically Node/browser).                                                                                    |
| `guardEvaluateExpression`   | function | Wrap a `Runtime.evaluate` expression so the in-page code stringifies its own result and throws a recognizable sentinel error before an oversized result would overflow the CDP transport frame. |
| `normalizeCodegenActions`   | function | Collapse consecutive `fill` actions on the same selector into the latest value.                                                                                                                 |
| `parseCodegenActionPayload` | function | Parse a codegen binding payload string into a typed `BrowserCodegenAction`, or `undefined` if malformed.                                                                                        |
| `readCodegenNavigateAction` | function | Derive a `navigate` codegen action from a `Page.frameNavigated` CDP event (top-level frame only).                                                                                               |
| `compileCodegenScript`      | function | Compile recorded codegen actions into a replayable JavaScript or TypeScript script.                                                                                                             |

```ts
import {
	guardEvaluateExpression,
	normalizeCodegenActions,
	parseCodegenActionPayload,
	readCodegenNavigateAction,
	compileCodegenScript,
} from '@src/core'

const guarded = guardEvaluateExpression('document.title', 3_000_000) // wrapped expression string
const actions = normalizeCodegenActions(rawActions)
const action = parseCodegenActionPayload(payload) // BrowserCodegenAction | undefined
const navigate = readCodegenNavigateAction(frameNavigatedParams)
const script = compileCodegenScript(actions, { language: 'typescript' })
```

#### Types

| Type                          | Kind      | Shape                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPTransportEventMap`        | type      | `{ message: [data: string]; close: []; error: [error: unknown] }` — the transport's observable surface.                                                                                                                                                                                                                                                     |
| `CDPTransportInterface`       | interface | `emitter` data member + `start` / `send` / `close` methods — the dumb text pipe a `CDPClientInterface` sends/receives JSON-RPC frames over.                                                                                                                                                                                                                 |
| `CDPClientOptions`            | interface | `{ transport: CDPTransportInterface; timeout?: number }` — options for `createCDPClient`.                                                                                                                                                                                                                                                                   |
| `CDPHandler`                  | type      | `(params: Readonly<Record<string, unknown>>) => void` — handler invoked for a subscribed CDP event.                                                                                                                                                                                                                                                         |
| `CDPTarget`                   | interface | `{ id: string; type: string; title: string; url: string }` — one entry of the CDP `Target.getTargets` result.                                                                                                                                                                                                                                               |
| `CDPClientInterface`          | interface | `connected` data member + `connect` / `reconnect` / `send` / `subscribe` / `unsubscribe` / `close` methods (`send` takes an optional per-call `timeout` overriding the client-wide default).                                                                                                                                                                |
| `ScreenshotWriterInterface`   | interface | `write(path, data)` — pluggable sink for persisting screenshot bytes to a path; core never touches a filesystem directly.                                                                                                                                                                                                                                   |
| `BrowserViewport`             | interface | `{ width: number; height: number }` — viewport dimensions for a browser page.                                                                                                                                                                                                                                                                               |
| `BrowserWaitUntil`            | type      | `'load' \| 'domcontentloaded'` — page load condition for navigation (the CDP load event `navigate()` awaits).                                                                                                                                                                                                                                               |
| `BrowserPageOptions`          | interface | `{ url?; viewport?; timeout? }` — options for creating a browser page.                                                                                                                                                                                                                                                                                      |
| `BrowserNavigationOptions`    | interface | `{ condition?: BrowserWaitUntil; timeout? }` — options for page navigation (default `'load'`).                                                                                                                                                                                                                                                              |
| `BrowserActionOptions`        | interface | `{ timeout? }` — options for element interaction (click, fill, select, wait).                                                                                                                                                                                                                                                                               |
| `BrowserScreenshotOptions`    | interface | `{ path?; full?; type?: 'png' \| 'jpeg'; quality? }` — options for taking a page screenshot.                                                                                                                                                                                                                                                                |
| `BrowserContentResult`        | interface | `{ url: string; title: string; html: string; text: string }` — result of page content extraction.                                                                                                                                                                                                                                                           |
| `BrowserScreenshotResult`     | interface | `{ bytes: Uint8Array; path: string \| undefined }` — result of a page screenshot.                                                                                                                                                                                                                                                                           |
| `BrowserCodegenAction`        | type      | Discriminated union — `navigate` / `click` / `fill` / `select` — one recorded browser action.                                                                                                                                                                                                                                                               |
| `BrowserCodegenEventMap`      | type      | `{ start: []; stop: [actions]; action: [action]; clear: [] }` — the observable surface of a `BrowserCodegenInterface`.                                                                                                                                                                                                                                      |
| `BrowserCodegenOptions`       | interface | `{ on?: EmitterHooks<BrowserCodegenEventMap> }` — options for creating a BrowserCodegen recorder.                                                                                                                                                                                                                                                           |
| `BrowserCodegenLanguage`      | type      | `'javascript' \| 'typescript'` — target language for a compiled codegen script.                                                                                                                                                                                                                                                                             |
| `BrowserCodegenScriptOptions` | interface | `{ language?: BrowserCodegenLanguage }` — options for compiling recorded actions into a script (default `'javascript'`).                                                                                                                                                                                                                                    |
| `BrowserCodegenInterface`     | interface | `emitter` / `started` data members + `start` / `stop` / `actions` / `script` / `clear` / `destroy` methods.                                                                                                                                                                                                                                                 |
| `BrowserFrame`                | type      | `{ id: string; parent?: string; name?: string; url: string }` — one frame in a page's frame tree, as reported by CDP `Page.getFrameTree`.                                                                                                                                                                                                                   |
| `BrowserPageInterface`        | interface | `url` / `closed` data members + `title` / `navigate` / `content` / `screenshot` / `click` / `fill` / `select` / `evaluate` / `wait` / `frame` / `frames` / `codegen` / `close` methods. `url` reports an optional constructor-seeded value (e.g. reattaching to an existing CDP target) immediately, before any `navigate()`/`content()` call refreshes it. |
| `BrowserContextInterface`     | interface | `id` data member + `page` / `pages` / `create` / `sync` / `close` methods.                                                                                                                                                                                                                                                                                  |

### Server

Server-side connection lifecycle — discover an already-running browser via
CDP, connect to it, or launch a fresh Chromium-family process:

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ cdp: { port: 9222 } })
const discovery = await browser.discover() // passive probe, no side effects
await browser.connect() // reuses discovery.endpoint if found, else launches
const ctx = browser.context() // the default context (created lazily on `create()`, or eagerly if connect() discovers existing pages)
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

| Constant                          | Kind  | Value                                                                                                                                                                                                                                                              |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BROWSER_DEFAULT_CDP_PORT`        | const | `9222` — default CDP port probed for an existing browser and used for launches.                                                                                                                                                                                    |
| `BROWSER_DEFAULT_HOST`            | const | `'127.0.0.1'` — default host probed/launched on (avoids `localhost` resolving to `::1`).                                                                                                                                                                           |
| `BROWSER_CDP_PROTOCOL`            | const | `'http'` — protocol prefix for CDP discovery requests.                                                                                                                                                                                                             |
| `BROWSER_CDP_VERSION_PATH`        | const | `'/json/version'` — path appended to the CDP host to fetch version metadata.                                                                                                                                                                                       |
| `BROWSER_CDP_LIST_PATH`           | const | `'/json/list'` — path appended to the CDP host to list open targets.                                                                                                                                                                                               |
| `BROWSER_NOT_FOUND_RESULT`        | const | Sentinel `BrowserDiscoveryResult` returned by discovery when no browser is reachable.                                                                                                                                                                              |
| `BROWSER_LAUNCH_ARGS`             | const | Frozen flags always passed to a launched browser process, alongside the caller's own.                                                                                                                                                                              |
| `BROWSER_HEADLESS_ARG`            | const | `'--headless=new'` — flag enabling headless mode on a launched browser process.                                                                                                                                                                                    |
| `BROWSER_KILL_GRACE_MS`           | const | `3000` — grace period after SIGTERM before a launched process is escalated to SIGKILL. `close()` can apply this grace period twice in the worst case (once waiting for exit after CDP `Browser.close`, again via the SIGTERM→SIGKILL path if that wait times out). |
| `BROWSER_PORT_PROBE_TIMEOUT_MS`   | const | `200` — bound for the `discover: false` port-occupancy probe before launching (short, since it only needs to detect an already-listening CDP endpoint).                                                                                                            |
| `BROWSER_TRANSPORT_LOSS_DEFER_MS` | const | `50` — brief defer applied once when a transport loss is observed on an owned process, giving a near-simultaneous process-exit event first say over the diagnosis.                                                                                                 |
| `BROWSER_ENV_PATH_KEYS`           | const | Frozen list of env vars checked (in order) for an explicit browser executable path override (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`).                                                                                                                         |
| `BROWSER_EXECUTABLE_PATHS`        | const | Frozen record of well-known Chrome/Chromium/Edge paths with no platform-specific root, keyed by `process.platform` (win32 is empty — see `BROWSER_WINDOWS_SUFFIXES`).                                                                                              |
| `BROWSER_WINDOWS_SUFFIXES`        | const | Frozen list of Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root.                                                                                                                                                |
| `BROWSER_WINDOWS_ROOT_FALLBACKS`  | const | Frozen record of fallback Windows install roots used when `PROGRAMFILES` / `PROGRAMFILES(X86)` are unset.                                                                                                                                                          |
| `BROWSER_EXECUTABLE_NAMES`        | const | Frozen list of command names probed on PATH when no well-known executable path exists.                                                                                                                                                                             |
| `BROWSER_STORE_ENV_KEY`           | const | `'PLAYWRIGHT_BROWSERS_PATH'` — env var naming an additional Playwright browser store base directory.                                                                                                                                                               |
| `BROWSER_STORE_DEFAULT_DIRS`      | const | Frozen list of well-known Playwright browser store base directories (e.g. `/opt/pw-browsers`).                                                                                                                                                                     |
| `BROWSER_STORE_CACHE_DIRS`        | const | Frozen record of the per-OS default Playwright cache directory, relative to the home directory.                                                                                                                                                                    |
| `BROWSER_STORE_LINK_NAME`         | const | `'chromium'` — name of the top-level Chromium symlink/binary inside a browser store base.                                                                                                                                                                          |
| `BROWSER_STORE_GLOBS`             | const | Frozen record of the glob pattern matching a versioned Chromium binary, keyed by `process.platform`.                                                                                                                                                               |
| `BROWSER_ENGINE_HINTS`            | const | Frozen record of case-insensitive substrings identifying an executable's engine, keyed by `BrowserEngine` (checked edge → chromium → chrome by `parseBrowserEngine`).                                                                                              |

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

| API                       | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findSystemBrowsers`      | function | Enumerate every Chrome/Chromium/Edge executable discoverable (env override → well-known install paths → PATH probe → Playwright browser stores), deduplicated by normalized path; each entry classified into a `SystemBrowser`, optionally narrowed by `options.engine` — unclassifiable executables default to engine `'chromium'` rather than being dropped. |
| `findSystemBrowser`       | function | The first entry of `findSystemBrowsers`; may return `undefined`.                                                                                                                                                                                                                                                                                               |
| `parseBrowserEngine`      | function | Classify an executable path/name into a `BrowserEngine` by case-insensitive hint (edge → chromium → chrome); may return `undefined`.                                                                                                                                                                                                                           |
| `normalizeExecutablePath` | function | Normalize an executable path for cross-source deduplication (case-insensitive on Windows).                                                                                                                                                                                                                                                                     |
| `browserToEngine`         | function | Classify a `/json/version` `Browser` string into a `BrowserEngine` (`Edg/` → edge, `Chrome/` → chrome, else chromium).                                                                                                                                                                                                                                         |
| `findEnvOverride`         | function | Check the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order for an existing file.                                                                                                                                                                                                                                                       |
| `findAllEnvOverrides`     | function | Check the env-override keys in order, returning every one that exists.                                                                                                                                                                                                                                                                                         |
| `defaultInstallPaths`     | function | Build the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                                                                                                                                                                                                                                     |
| `windowsRoots`            | function | Derive Windows install roots from env vars, falling back to well-known literals when absent.                                                                                                                                                                                                                                                                   |
| `findInstallPath`         | function | Return the first candidate path that exists on disk.                                                                                                                                                                                                                                                                                                           |
| `findAllInstallPaths`     | function | Return every candidate path that exists on disk, in the given order.                                                                                                                                                                                                                                                                                           |
| `probePathNames`          | function | Probe PATH (`which`/`where`) for the first resolvable command name.                                                                                                                                                                                                                                                                                            |
| `probeAllPathNames`       | function | Probe PATH for every resolvable command name, in the given order.                                                                                                                                                                                                                                                                                              |
| `defaultStoreBases`       | function | Build the default Playwright browser store base directories to search for a managed Chromium.                                                                                                                                                                                                                                                                  |
| `findInStore`             | function | Search one store base for the top-level `chromium` link, else the highest-revision `chromium-*` install.                                                                                                                                                                                                                                                       |
| `findAllInStore`          | function | Search one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first.                                                                                                                                                                                                                                                |
| `launchBrowserProcess`    | function | Launch a browser process with raw-CDP debugging flags; returns the spawned `ChildProcess`.                                                                                                                                                                                                                                                                     |
| `waitForCdpReady`         | function | Poll a browser's CDP version endpoint until it responds or the timeout elapses; returns the debugger URL.                                                                                                                                                                                                                                                      |
| `fetchCdpTargets`         | function | Fetch and normalize the current CDP target list from a browser's `/json/list` endpoint.                                                                                                                                                                                                                                                                        |

```ts
import {
	createCDPTransport,
	createScreenshotWriter,
	findSystemBrowsers,
	findSystemBrowser,
	parseBrowserEngine,
	normalizeExecutablePath,
	browserToEngine,
	findEnvOverride,
	findAllEnvOverrides,
	defaultInstallPaths,
	windowsRoots,
	findInstallPath,
	findAllInstallPaths,
	probePathNames,
	probeAllPathNames,
	defaultStoreBases,
	findInStore,
	findAllInStore,
	launchBrowserProcess,
	waitForCdpReady,
	fetchCdpTargets,
} from '@src/server'

const transport = createCDPTransport({ url: 'ws://localhost:9222/devtools/browser/abc' })
const writer = createScreenshotWriter()

const browsers = findSystemBrowsers() // readonly SystemBrowser[]
const found = findSystemBrowser() // SystemBrowser | undefined — first entry of findSystemBrowsers()
// findSystemBrowsers({ env: {}, paths: [], names: [], stores: [], engine: 'edge' }) — override any candidate source, narrow by engine

parseBrowserEngine('/usr/bin/msedge') // 'edge'
normalizeExecutablePath('/usr/bin/Chrome', process.platform) // string — case-folded on win32 only
browserToEngine('HeadlessChrome/120.0') // 'chrome' — classifies a /json/version Browser string

// findSystemBrowsers's internal resolution steps, exposed for composition/testing:
const env = process.env
findEnvOverride(env) // string | undefined — PLAYWRIGHT_EXECUTABLE_PATH / CHROME_PATH
findAllEnvOverrides(env) // readonly string[] — every matching override that exists
const roots = windowsRoots(env) // readonly string[] — PROGRAMFILES / PROGRAMFILES(X86) / LOCALAPPDATA
defaultInstallPaths('win32', env) // readonly string[] — well-known Chrome/Edge/Chromium paths
findInstallPath(defaultInstallPaths(process.platform, env)) // string | undefined
findAllInstallPaths(defaultInstallPaths(process.platform, env)) // readonly string[]
probePathNames(['google-chrome'], process.platform) // string | undefined — which/where probe
probeAllPathNames(['google-chrome', 'msedge'], process.platform) // readonly string[]
const stores = defaultStoreBases(env, process.platform) // readonly string[]
for (const store of stores) findInStore(store, process.platform) // string | undefined
for (const store of stores) findAllInStore(store, process.platform) // readonly string[]
if (found !== undefined) {
	const child = launchBrowserProcess(found.executable, 9222, true)
	const debuggerUrl = await waitForCdpReady(9222, 5000)
	const targets = await fetchCdpTargets(9222, 5000)
}
```

#### Types

| Type                           | Kind      | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserEngine`                | type      | `'chromium' \| 'chrome' \| 'edge'` — the supported browser engines (raw CDP targets Chromium-family browsers only).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `BrowserConnection`            | type      | `'cdp' \| 'launch' \| 'persistent'` — how the browser connection was established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BrowserStatus`                | type      | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error'` — lifecycle status of a browser wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `BrowserDiscoveryResult`       | interface | `{ found: boolean; endpoint?; browser?; connection? }` — result of passive browser discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SystemBrowserOptions`         | interface | `{ env?; paths?; names?; stores?; engine? }` — overrides for `findSystemBrowsers`'s candidate sources (env-override keys/Windows roots, install paths, PATH-probe names, Playwright store base dirs) plus an engine filter; each field replaces its category's default, an explicit `[]`/`{}` disables it.                                                                                                                                                                                                                                                                       |
| `SystemBrowser`                | type      | `{ executable: string; engine: BrowserEngine }` — one discovered browser executable, as returned by `findSystemBrowsers`/`findSystemBrowser`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `BrowserCdpOptions`            | interface | `{ port?: number; host?: string; endpoint?: string; discover?: boolean }` — CDP connection configuration (`host` defaults to `BROWSER_DEFAULT_HOST`; `discover` defaults to `true` — `false` skips passive discovery, probes the port, and rejects if something is already listening there instead of silently attaching to it).                                                                                                                                                                                                                                                 |
| `BrowserEventMap`              | type      | `{ idle: []; discover: [result]; connect: [connection]; disconnect: []; launch: [engine]; page: [page]; error: [error]; destroy: [] }`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `BrowserOptions`               | interface | `{ on?; headless?; executable?; profile?; cdp?; timeout?; viewport?; signal?; args?; engine?; browsers? }` — options for `createBrowser` (`engine` prefers a browser engine for discovery when launching; ignored once `connect()` launches a process — before that, the `engine` getter may still reflect the supplied `engine` option even if `executable` is also set; `browsers` supplies `SystemBrowserOptions` candidate-source overrides consulted when launch discovery runs, ignored when `executable` is given, and `engine` takes precedence over `browsers.engine`). |
| `BrowserInterface`             | interface | `emitter` / `engine` / `status` / `connection` / `connected` / `pid` data members + `discover` / `connect` / `disconnect` / `context` / `contexts` / `create` / `destroy` / `close` methods.                                                                                                                                                                                                                                                                                                                                                                                     |
| `WebSocketCDPTransportOptions` | interface | `{ url: string; timeout?: number }` — options for creating a WebSocketCDPTransport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

| Method  | Returns         | Behavior                                                                                                                                                                                        |
| ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` | `Promise<void>` | Open the underlying connection.                                                                                                                                                                 |
| `send`  | `Promise<void>` | Write one raw text frame to the connection. Throws a plain `Error('WebSocket CDP transport is not open')` (not a coded `BrowserConnectionError`) if called before `start()` or after `close()`. |
| `close` | `Promise<void>` | Close the underlying connection and release resources.                                                                                                                                          |

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

| Method        | Returns            | Behavior                                                                                                                                                                 |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connect`     | `Promise<void>`    | Start the transport and begin dispatching. Idempotent.                                                                                                                   |
| `reconnect`   | `Promise<void>`    | Close and re-establish the transport.                                                                                                                                    |
| `send`        | `Promise<unknown>` | Issue a CDP method call with optional params, optionally scoped to a session, and an optional per-call `timeout` overriding the client-wide default; rejects on timeout. |
| `subscribe`   | `void`             | Register a handler for a CDP event, optionally session-scoped.                                                                                                           |
| `unsubscribe` | `void`             | Remove a handler for a CDP event, optionally session-scoped.                                                                                                             |
| `close`       | `Promise<void>`    | Tear down the transport and reject all pending requests.                                                                                                                 |

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

| Method   | Returns                             | Behavior                                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`   | `BrowserPageInterface \| undefined` | One page by index, or the first page.                                                                                                                                                                                                                                                                    |
| `pages`  | `readonly BrowserPageInterface[]`   | All pages in creation order.                                                                                                                                                                                                                                                                             |
| `create` | `Promise<BrowserPageInterface>`     | Open a new page in this context.                                                                                                                                                                                                                                                                         |
| `sync`   | `Promise<void>`                     | Synchronize pages from the given CDP targets (server discovers the targets, core never fetches them). Performs a destructive diff, not an additive merge: pages whose target id is missing from `targets` are closed and dropped; pages present in `targets` but not yet tracked are attached and added. |
| `close`  | `Promise<void>`                     | Close the context and all its pages.                                                                                                                                                                                                                                                                     |

```ts
const ctx = browser.context()
const page = await ctx?.create({ url: 'https://example.com' })
const all = ctx?.pages() // readonly BrowserPageInterface[]
await ctx?.sync(targets) // reconcile pages from discovered CDP targets
await ctx?.close()
```

#### `BrowserPageInterface`

Abstraction over a single browser page or frame.

| Method       | Returns                              | Behavior                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`      | `Promise<string>`                    | Resolve the document title.                                                                                                                                                                                                                                                                                                                        |
| `navigate`   | `Promise<void>`                      | Go to a URL and wait for the specified load condition (default `'load'`). The `timeout` bounds the entire call (CDP send + load-event wait combined, not summed); on failure the pending load wait is canceled and a best-effort `Page.stopLoading` (capped at `BROWSER_STOP_LOADING_TIMEOUT_MS`) is issued before the original error is rethrown. |
| `content`    | `Promise<BrowserContentResult>`      | Extract page URL, title, HTML, and visible text. Both the HTML (`outerHTML`) and text (`innerText`) sub-evaluations are guarded by `BROWSER_RESULT_LIMIT`/`guardEvaluateExpression` — title and url are not size-guarded.                                                                                                                          |
| `screenshot` | `Promise<BrowserScreenshotResult>`   | Capture a PNG or JPEG image of the page.                                                                                                                                                                                                                                                                                                           |
| `click`      | `Promise<void>`                      | Click an element matching the selector.                                                                                                                                                                                                                                                                                                            |
| `fill`       | `Promise<void>`                      | Type text into an input element. Supports `contenteditable` elements (sets `textContent`, dispatches `input` only) in addition to standard inputs/textareas (sets `value`, dispatches `input` and `change`).                                                                                                                                       |
| `select`     | `Promise<void>`                      | Choose option(s) in a `<select>` element.                                                                                                                                                                                                                                                                                                          |
| `evaluate`   | `Promise<unknown>`                   | Execute a JavaScript expression in the page context. Result is guarded against exceeding `BROWSER_RESULT_LIMIT`; an oversized result rejects with `BrowserResultLimitError` rather than returning a value.                                                                                                                                         |
| `wait`       | `Promise<void>`                      | Wait for an element matching the selector to appear.                                                                                                                                                                                                                                                                                               |
| `frame`      | `Promise<BrowserFrame \| undefined>` | Look up a frame by name or URL in the page's flattened frame tree.                                                                                                                                                                                                                                                                                 |
| `frames`     | `Promise<readonly BrowserFrame[]>`   | List the page's flattened frame tree, main frame first.                                                                                                                                                                                                                                                                                            |
| `codegen`    | `Promise<BrowserCodegenInterface>`   | Start (or return the existing) action recorder for this page.                                                                                                                                                                                                                                                                                      |
| `close`      | `Promise<void>`                      | Close the page.                                                                                                                                                                                                                                                                                                                                    |

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

| Method    | Returns                                    | Behavior                                                                                                                                                                                                        |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                            | Begin recording on the page's session. Calling `start()` after `destroy()` is a silent no-op — a destroyed `BrowserCodegenInterface` cannot be restarted; a new recorder must be obtained via `page.codegen()`. |
| `stop`    | `Promise<readonly BrowserCodegenAction[]>` | Stop recording and return the captured actions.                                                                                                                                                                 |
| `actions` | `readonly BrowserCodegenAction[]`          | Current normalized action list.                                                                                                                                                                                 |
| `script`  | `string`                                   | Compile the captured actions into a script.                                                                                                                                                                     |
| `clear`   | `void`                                     | Reset the captured action list.                                                                                                                                                                                 |
| `destroy` | `Promise<void>`                            | Tear down the recorder and detach CDP listeners.                                                                                                                                                                |

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

| Method       | Returns                                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover`   | `Promise<BrowserDiscoveryResult>`      | Passive CDP probe — does not change connection state or launch/attach anything, but emits a `discover` event with the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `connect`    | `Promise<void>`                        | Establish a connection using the strategy above (endpoint → discovery → launch). Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `disconnect` | `Promise<void>`                        | Detach the client-side connection and release it — the remote browser keeps running. For `'cdp'` and `'persistent'` (profile-backed launch) connections this closes the client and releases the process WITHOUT killing it, so a persistent session can be reattached later via CDP discovery on the same port. Rejects with `BrowserConnectionError` for `'launch'` (ephemeral, no profile) connections — use `destroy()` instead. An external disconnect (transport loss while the owned process stays alive, or the owned process exiting on its own) drives the same released/disconnected state automatically, preceded by a coded `error`; transport loss (process still alive) is resumable — `connect()` on the SAME instance can reattach afterward. |
| `context`    | `BrowserContextInterface \| undefined` | One context by index, or the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `contexts`   | `readonly BrowserContextInterface[]`   | All contexts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `create`     | `Promise<BrowserPageInterface>`        | Shortcut to open a page in the default context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `destroy`    | `Promise<void>`                        | Release local resources. On an owned (`'launch'`/`'persistent'`) browser this closes pages/contexts then kills the process (SIGTERM, escalating to SIGKILL). On a `'cdp'`-attached browser this is a LOCAL DETACH ONLY — no remote close is sent, since other clients may share those targets. Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `close`      | `Promise<void>`                        | Graceful REMOTE shutdown: best-effort sends CDP `Browser.close` (whether attached or owned), and when owned also awaits the process's exit (escalating to a kill only if it doesn't exit in time), then closes every tracked context/page (sending remote `Target.closeTarget`/`disposeBrowserContext` regardless of ownership — unlike `destroy()`, which skips remote context/page closes on a non-owned CDP-attached browser) before releasing the CDP client. Use this to shut down a browser this instance doesn't own but wants to terminate anyway.                                                                                                                                                                                                    |

```ts
import { createBrowser } from '@src/server'

const browser = createBrowser({ profile: './profile', cdp: { port: 9222 } })
browser.emitter.on('connect', (mode) => log(mode))
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })
const all = browser.contexts() // readonly BrowserContextInterface[]
const pid = browser.pid // number | undefined — the launched process id, when this instance owns one
await browser.disconnect() // detach without closing the browser (cdp/persistent only)
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
   order: an explicit `cdp.endpoint`; a passive probe of
   `{cdp.host}:{cdp.port}` (defaulting to `127.0.0.1:{cdp.port}` via
   `BROWSER_DEFAULT_HOST`) (`discover()`); then launching a new browser
   process with raw-CDP flags
   (`findSystemBrowser` / `launchBrowserProcess` / `waitForCdpReady`). A
   found existing browser is preferred over a fresh launch. `engine` is
   classified via `parseBrowserEngine` (explicit `executable`) or the
   discovered `SystemBrowser`'s engine (launch) or `browserToEngine` on the
   discovered `/json/version` browser string (CDP discovery); `BrowserOptions.engine`
   narrows `findSystemBrowser` discovery to a preferred engine when launching,
   and the thrown `BrowserConnectionError` carries the requested `engine` in
   `context` when no matching browser is found; launch discovery also consults
   `BrowserOptions.browsers` candidate-source overrides when given. A `disconnect()` on a
   `'persistent'` (profile-backed) launch releases its process WITHOUT
   killing it — the browser stays alive for reattachment via CDP discovery on
   the same port; an ephemeral `'launch'` (no profile) instead rejects
   `disconnect()`, since it has no reattachment path. `BrowserCdpOptions.discover`
   (default `true`) set to `false` skips passive discovery and probes the
   port directly, rejecting with a coded `BrowserConnectionError` naming the
   occupied port if something is already listening there, rather than
   silently attaching to it.
6. **Lifecycle events are observable, never inferred from state polling.**
   `BrowserInterface.emitter` fires `idle` / `discover` / `connect` /
   `disconnect` / `launch` / `page` / `error` / `destroy`; `BrowserCodegenInterface.emitter`
   fires `start` / `stop` / `action` / `clear`. Both isolate a listener throw
   via `@orkestrel/emitter`'s emitter, never a domain event. An external
   disconnect (transport loss while an owned process stays alive, or the
   owned process exiting on its own) always emits a coded `error` before
   `disconnect`; transport loss with the process still alive is RESUMABLE —
   the browser is not killed and the same `Browser` instance can `connect()`
   again (e.g. rediscovering it over CDP), while a process exit is terminal
   for that instance.
7. **Errors carry a machine-readable `code` + optional `context`.**
   `BrowserError` (core) is the base; `BrowserSelectorError` / `CDPError` /
   `CDPConnectionError` / `CDPTimeoutError` / `BrowserResultLimitError` (core)
   narrow selector, protocol, connectivity, timeout, and oversized-result
   faults; `BrowserConnectionError` / `BrowserNotConnectedError` /
   `BrowserDestroyedError` (server) narrow connection-lifecycle faults. Each
   ships an `is*` type guard.
8. **Oversized evaluate/content results fail clean, never crash the session.**
   `BrowserPage.evaluate()` wraps its expression with
   `guardEvaluateExpression(expression, BROWSER_RESULT_LIMIT)`, and
   `.content()` wraps BOTH its HTML (`outerHTML`) and visible-text
   (`innerText`) sub-evaluations the same way — only `title` and `url` are
   NOT size-guarded. The guard stringifies the in-page result and throws a
   `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` (`[[ORKESTREL_BROWSER_RESULT_LIMIT]]`)
   followed by the serialized length before an oversized result could
   overflow the CDP transport frame; `BrowserPage` recognizes that
   sentinel (`BROWSER_RESULT_LIMIT_PATTERN`) and rejects with a coded
   `BrowserResultLimitError` instead — the underlying CDP connection and
   browser process are unaffected. The crash-safety guarantee therefore
   applies to `evaluate()` and to both the HTML and text fields of
   `.content()`.
9. **Codegen normalizes and compiles deterministically.**
   `normalizeCodegenActions` collapses consecutive `fill`s on the same
   selector to the latest value (including `contenteditable` fills, captured
   the same way as inputs/textareas); `compileCodegenScript` emits one
   `page.<action>(...)` statement per normalized action, `'javascript'`
   (bare `async function run(page) {...}`) or `'typescript'`
   (`import('@orkestrel/browser').BrowserPageInterface`-typed) per
   `BrowserCodegenScriptOptions.language` (default `'javascript'`).
10. **DOC ↔ SOURCE method bijection.** The `## Methods` tables list exactly
    the public methods of each behavioral interface — `CDPTransportInterface`,
    `CDPClientInterface`, `BrowserContextInterface`, `BrowserPageInterface`,
    `BrowserCodegenInterface`, `BrowserInterface` — exhaustive, both
    directions, and each implementing class (`WebSocketCDPTransport`,
    `CDPClient`, `BrowserContext`, `BrowserPage`, `BrowserCodegen`, `Browser`)
    exposes the same public methods, no more. The remaining exports add no
    behavioral interface with methods (the factories, `decodeBase64` /
    `guardEvaluateExpression` / `parseCodegenActionPayload` /
    `readCodegenNavigateAction` / `compileCodegenScript` / `findSystemBrowser` /
    `launchBrowserProcess` / `waitForCdpReady` / `fetchCdpTargets` are
    functions; the options interfaces / event maps / results / `CDPTarget` /
    `BrowserViewport` are data bags), so they contribute no `## Methods` row.
11. **The WebSocket CDP transport is a thin bridge (`src/server`).**
    `WebSocketCDPTransport` connects a Node `WebSocket` to the given CDP
    debugger URL, races the connection attempt against `timeout`
    (default `BROWSER_DEFAULT_TIMEOUT_MS`), and bridges the socket's
    `message` / `close` / `error` events onto its `CDPTransportEventMap`
    emitter unchanged (no framing of its own). `start()` rejects with a
    `BrowserConnectionError` (URL in `context`) on socket error, non-open
    close, or timeout — never a bare error.
12. **`Browser.destroy()` escalates SIGTERM → SIGKILL; `close()` is graceful.**
    `destroy()` sends a launched process `SIGTERM`; if it has not exited
    after `BROWSER_KILL_GRACE_MS`, it is force-killed with `SIGKILL`.
    `close()` instead sends CDP `Browser.close` first (best-effort, whether
    the process is owned or merely CDP-attached) and only escalates to the
    same kill sequence if an owned process fails to exit within the grace
    period — the graceful path for shutting down a browser this instance may
    not own. In the worst case an owned, unresponsive process makes `close()`
    apply `BROWSER_KILL_GRACE_MS` twice: once waiting for exit after
    `Browser.close`, and again (via the same SIGTERM→SIGKILL path as
    `destroy()`) if that first wait times out. `BrowserInterface.connected` is a pure, derived getter
    (`status === 'connected'`) — never separately tracked state.
    `BrowserInterface.pid` is the launched process's id (`ChildProcess.pid`);
    it stays readable (the last-known pid) across a `'persistent'` session's
    `disconnect()` and only becomes `undefined` after `destroy()`/`close()` or
    an observed process exit — never on `disconnect()` alone. It is
    `undefined` from the start on a plain CDP attach (`connection === 'cdp'`),
    which never owns a process.

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

### Reattach to a running session

A `'persistent'` (profile-backed) launch survives `disconnect()` — the
browser process keeps running, so a later `Browser` can reattach to it via
CDP discovery on the same fixed port. A reattached instance connects as
`'cdp'`, so its own `destroy()` is a LOCAL DETACH ONLY — it never sends a
remote close, since another client may still be using the browser:

```ts
import { createBrowser } from '@src/server'

const port = 9222
const browser = createBrowser({ profile: './profile', cdp: { port } })
await browser.connect() // launches (no browser yet listening on `port`)
const pid = browser.pid // supervise this process externally if desired

await browser.disconnect() // releases ownership WITHOUT killing the browser

// ...later, in this process or another...
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP
const urls = reattached
	.context()
	?.pages()
	.map((page) => page.url) // correct immediately, no navigate()/content() needed
await reattached.destroy() // LOCAL DETACH ONLY — the browser process keeps running
```

An ephemeral launch (no `profile`) has no reattachment path — its
`disconnect()` rejects with a coded `BrowserConnectionError`; use `destroy()`
to release it instead. A transport-loss disconnect (the connection dropping
while an owned process stays alive) is likewise resumable — the SAME
`browser` instance can `connect()` again without a fresh `createBrowser()`.

### Gracefully shut down a reattached session

Use `close()` instead of `destroy()` when this instance should actually
terminate a browser it merely attached to (or launched) — it sends CDP
`Browser.close` and, when this instance owns the process, awaits its exit
before falling back to the kill-escalation `destroy()` uses:

```ts
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP

await reattached.close() // best-effort CDP Browser.close; since this instance never owned the process, it does NOT wait for the remote exit
// a further connect() on this instance throws BrowserDestroyedError, same as after destroy()
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
