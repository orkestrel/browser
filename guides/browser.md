# Browser

> A lightweight Chrome DevTools Protocol (CDP) automation layer, split into an
> environment-agnostic **core** and a Node **server** runtime. **Core**
> (`@orkestrel/browser`) is pure logic over an injected `CDPTransportInterface`
> — no `WebSocket`, no `node:*`, no filesystem — so it runs identically in
> Node or a browser: `CDPClient` frames JSON-RPC-shaped CDP messages over the
> transport, `BrowserContext` / `BrowserPage` model a CDP browser context and
> its pages, `BrowserSnapshot` turns a captured DOM snapshot into navigable
> serializable data, `BrowserCodegen` records page interactions for later
> script compilation. One capability reaches past the protocol: `article()`
> distills a captured document to its reader-facing prose through
> `@orkestrel/html` — content selection, not another whole-body text dump.
> **Server** (`@orkestrel/browser/server`) supplies the missing
> environment pieces: `WebSocketCDPTransport` (a Node `WebSocket`-backed CDP
> transport), `Browser` (discovery → connect → launch lifecycle, spawning a
> real Chromium-family process when nothing is already listening), and a
> filesystem-backed screenshot writer. Source:
> [`src/core`](../src/core) (via `@src/core`) +
> [`src/server`](../src/server) (via `@src/server`).

## Surface

Server quickstart — connect to (or launch) a browser, open a page, drive it:

```ts
import { createBrowser } from '@orkestrel/browser/server'

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
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()
const targets = await client.send('Target.getTargets')
await client.close()
```

### Core

#### Factories

| API                     | Kind     | Summary                                                                                 |
| ----------------------- | -------- | --------------------------------------------------------------------------------------- |
| `createCDPClient`       | function | Create a `CDPClientInterface` bound to the given `CDPTransportInterface`.               |
| `createBrowserSnapshot` | function | Create a navigable `BrowserSnapshotInterface` over decoded `BrowserSnapshotInput` data. |

#### Entities

| API               | Kind  | Summary                                                                                                                                   |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPClient`       | class | Lightweight CDP client over a `CDPTransportInterface` — JSON-RPC framing, `connect` / `send` / `subscribe` / `close`.                     |
| `BrowserContext`  | class | Isolated browser session over a CDP browser context — manages its `BrowserPage`s (`page` / `pages` / `create` / `sync`).                  |
| `BrowserFrame`    | class | One attached document frame with isolated-world evaluation and frame-scoped actions over its current CDP session.                         |
| `BrowserPage`     | class | A single browser page or frame — navigation, content extraction, screenshot, element interaction, codegen.                                |
| `BrowserCodegen`  | class | Records page interactions (navigate/click/fill/select) via CDP bindings, for later compilation into a replayable script.                  |
| `BrowserSnapshot` | class | A navigable, serializable capture of every attached document — walking, structural relationships, search, and paths over plain node data. |

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
| `BROWSER_FRAME_WORLD_NAME`             | const | `'__orkestrelBrowserFrame'` — isolated-world name used for frame-scoped evaluation.                                                                                                                                                               |
| `BROWSER_SNAPSHOT_NODE_LIMIT`          | const | `100_000` — default aggregate node limit for a decoded DOM snapshot.                                                                                                                                                                              |

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

| API                             | Kind     | Summary                                                                                                                                                                                         |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeBase64`                  | function | Decode a base64-encoded string into raw bytes (pure JS, no `Buffer`/`atob` — runs identically Node/browser).                                                                                    |
| `guardEvaluateExpression`       | function | Wrap a `Runtime.evaluate` expression so the in-page code stringifies its own result and throws a recognizable sentinel error before an oversized result would overflow the CDP transport frame. |
| `normalizeCodegenActions`       | function | Collapse consecutive `fill` actions on the same selector into the latest value.                                                                                                                 |
| `parseCodegenActionPayload`     | function | Parse a codegen binding payload string into a typed `BrowserCodegenAction`, or `undefined` if malformed.                                                                                        |
| `readCodegenNavigateAction`     | function | Derive a `navigate` codegen action from a `Page.frameNavigated` CDP event (top-level frame only).                                                                                               |
| `compileCodegenScript`          | function | Compile recorded codegen actions into a replayable JavaScript or TypeScript script.                                                                                                             |
| `readEvaluationResult`          | function | Decode a `Runtime.evaluate` result and map guarded oversize exceptions to `BrowserResultLimitError`.                                                                                            |
| `requireBrowserString`          | function | Narrow a browser-evaluated value to a required string.                                                                                                                                          |
| `readBrowserFrames`             | function | Decode `Page.getFrameTree` into depth-first frame metadata.                                                                                                                                     |
| `compileAttachedWaitExpression` | function | Compile an in-page attached-state wait.                                                                                                                                                         |
| `compileDetachedWaitExpression` | function | Compile an in-page detached-state wait.                                                                                                                                                         |
| `compileVisibleWaitExpression`  | function | Compile an in-page visible-state wait.                                                                                                                                                          |
| `compileHiddenWaitExpression`   | function | Compile an in-page hidden-state wait.                                                                                                                                                           |
| `compileClickExpression`        | function | Compile a strict, visibility-checked click expression.                                                                                                                                          |
| `compileFillExpression`         | function | Compile a strict, editable fill expression.                                                                                                                                                     |
| `compileSelectExpression`       | function | Compile a strict select expression.                                                                                                                                                             |
| `readNumberArray`               | function | Narrow an unknown protocol value to an all-number array.                                                                                                                                        |
| `readSnapshotString`            | function | Resolve an index from a DOMSnapshot string table.                                                                                                                                               |
| `decodeRareStringData`          | function | Decode sparse CDP string data into a node-index map.                                                                                                                                            |
| `decodeRareBooleanData`         | function | Decode sparse CDP boolean indexes into a set.                                                                                                                                                   |
| `decodeRareIntegerData`         | function | Decode sparse CDP integer data into a node-index map.                                                                                                                                           |
| `readBrowserRect`               | function | Decode a four-number CSS-pixel rectangle.                                                                                                                                                       |
| `decodeBrowserAttributes`       | function | Decode flattened name/value indexes into a frozen attribute record.                                                                                                                             |
| `decodeBrowserSnapshot`         | function | Validate and decode `DOMSnapshot.captureSnapshot` into a serializable `BrowserSnapshotInput`.                                                                                                   |
| `attributeOfBrowserNode`        | function | Read one captured node attribute.                                                                                                                                                               |
| `isBrowserNodeQuery`            | function | Test whether a browser-node matcher is a declarative query rather than a predicate.                                                                                                             |
| `matchesBrowserNode`            | function | Match a node against a declarative query.                                                                                                                                                       |
| `isBrowserNodeVisible`          | function | Test whether a node has a non-empty captured layout box.                                                                                                                                        |

```ts
import {
	guardEvaluateExpression,
	normalizeCodegenActions,
	parseCodegenActionPayload,
	readCodegenNavigateAction,
	compileCodegenScript,
	readEvaluationResult,
	requireBrowserString,
	readBrowserFrames,
	compileAttachedWaitExpression,
	compileDetachedWaitExpression,
	compileVisibleWaitExpression,
	compileHiddenWaitExpression,
	compileClickExpression,
	compileFillExpression,
	compileSelectExpression,
	readNumberArray,
	readSnapshotString,
	decodeRareStringData,
	decodeRareBooleanData,
	decodeRareIntegerData,
	readBrowserRect,
	decodeBrowserAttributes,
	decodeBrowserSnapshot,
	attributeOfBrowserNode,
	matchesBrowserNode,
	isBrowserNodeVisible,
} from '@orkestrel/browser'

const guarded = guardEvaluateExpression('document.title', 3_000_000) // wrapped expression string
const actions = normalizeCodegenActions(rawActions)
const action = parseCodegenActionPayload(payload) // BrowserCodegenAction | undefined
const navigate = readCodegenNavigateAction(frameNavigatedParams)
const script = compileCodegenScript(actions, { language: 'typescript' })
const value = readEvaluationResult(runtimeResult)
const title = requireBrowserString(value, 'Title')
const frames = readBrowserFrames(frameTreeResult)
const attached = compileAttachedWaitExpression('#result', true, 30_000)
const detached = compileDetachedWaitExpression('.spinner', true, 30_000)
const visible = compileVisibleWaitExpression('#result', true, 30_000)
const hidden = compileHiddenWaitExpression('.spinner', true, 30_000)
const click = compileClickExpression('#submit', true)
const fill = compileFillExpression('#query', 'browser', true)
const select = compileSelectExpression('#region', ['us'], true)
const numbers = readNumberArray([1, 2, 3])
const text = readSnapshotString(snapshotStrings, 1)
const rareStrings = decodeRareStringData(rawRareStrings, snapshotStrings)
const rareBooleans = decodeRareBooleanData(rawRareBooleans)
const rareIntegers = decodeRareIntegerData(rawRareIntegers)
const rect = readBrowserRect([0, 0, 100, 40])
const attributes = decodeBrowserAttributes(rawAttributes, snapshotStrings)
const decoded = decodeBrowserSnapshot(rawSnapshot, ['display']) // BrowserSnapshotInput
const node = decoded.documents[0].nodes[0]
const id = attributeOfBrowserNode(node, 'id')
const article = matchesBrowserNode(node, { name: 'article', visible: true })
const rendered = isBrowserNodeVisible(node)
```

Navigating decoded data is the `BrowserSnapshot` entity's job, not a helper
family's — see [`BrowserSnapshotInterface`](#browsersnapshotinterface) below.

#### Types

| Type                          | Kind      | Shape                                                                                                                                                                                        |
| ----------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPTransportEventMap`        | type      | `{ message: [data: string]; close: []; error: [error: unknown] }` — the transport's observable surface.                                                                                      |
| `CDPTransportInterface`       | interface | `emitter` data member + `start` / `send` / `close` methods — the dumb text pipe a `CDPClientInterface` sends/receives JSON-RPC frames over.                                                  |
| `CDPClientOptions`            | interface | `{ transport: CDPTransportInterface; timeout?: number }` — options for `createCDPClient`.                                                                                                    |
| `CDPHandler`                  | type      | `(params: Readonly<Record<string, unknown>>) => void` — handler invoked for a subscribed CDP event.                                                                                          |
| `CDPTarget`                   | interface | `{ id: string; type: string; title: string; url: string }` — one entry of the CDP `Target.getTargets` result.                                                                                |
| `CDPClientInterface`          | interface | `connected` data member + `connect` / `reconnect` / `send` / `subscribe` / `unsubscribe` / `close` methods (`send` takes an optional per-call `timeout` overriding the client-wide default). |
| `ScreenshotWriterInterface`   | interface | `write(path, data)` — pluggable sink for persisting screenshot bytes to a path; core never touches a filesystem directly.                                                                    |
| `BrowserViewport`             | interface | `{ width: number; height: number }` — viewport dimensions for a browser page.                                                                                                                |
| `BrowserWaitUntil`            | type      | `'load' \| 'domcontentloaded'` — page load condition for navigation (the CDP load event `navigate()` awaits).                                                                                |
| `BrowserPageOptions`          | interface | `{ url?; viewport?; timeout? }` — options for creating a browser page.                                                                                                                       |
| `BrowserNavigationOptions`    | interface | `{ condition?: BrowserWaitUntil; timeout? }` — options for page navigation (default `'load'`).                                                                                               |
| `BrowserActionOptions`        | interface | `{ timeout?; strict? }` — options for strict-by-default element interaction.                                                                                                                 |
| `BrowserWaitState`            | type      | `'attached' \| 'detached' \| 'visible' \| 'hidden'` — selector state awaited by a frame.                                                                                                     |
| `BrowserWaitOptions`          | interface | `{ timeout?; strict?; state? }` — options for selector-state waits.                                                                                                                          |
| `BrowserScreenshotOptions`    | interface | `{ path?; full?; type?: 'png' \| 'jpeg'; quality? }` — options for taking a page screenshot.                                                                                                 |
| `BrowserContentResult`        | interface | `{ url: string; title: string; html: string; text: string }` — result of page content extraction.                                                                                            |
| `BrowserScreenshotResult`     | interface | `{ bytes: Uint8Array; path: string \| undefined }` — result of a page screenshot.                                                                                                            |
| `BrowserCodegenAction`        | type      | Discriminated union — `navigate` / `click` / `fill` / `select` — one recorded browser action.                                                                                                |
| `BrowserCodegenEventMap`      | type      | `{ start: []; stop: [actions]; action: [action]; clear: [] }` — the observable surface of a `BrowserCodegenInterface`.                                                                       |
| `BrowserCodegenOptions`       | interface | `{ on?: EmitterHooks<BrowserCodegenEventMap>; error?: EmitterErrorHandler }` — options for creating a BrowserCodegen recorder.                                                               |
| `BrowserCodegenLanguage`      | type      | `'javascript' \| 'typescript'` — target language for a compiled codegen script.                                                                                                              |
| `BrowserCodegenScriptOptions` | interface | `{ language?: BrowserCodegenLanguage }` — options for compiling recorded actions into a script (default `'javascript'`).                                                                     |
| `BrowserCodegenInterface`     | interface | `emitter` / `started` data members + `start` / `stop` / `actions` / `script` / `clear` / `destroy` methods.                                                                                  |
| `BrowserSessionFunction`      | type      | `(frame: string) => Promise<string>` — resolves the current CDP target session for a frame.                                                                                                  |
| `BrowserFrameInfo`            | interface | Serializable `id` / `parent` / `name` / `url` metadata decoded from `Page.getFrameTree`.                                                                                                     |
| `BrowserFrameInterface`       | interface | Frame metadata plus title/content/actions/evaluation/waiting, usability assertion, observed-URL recording, and raw frame-session CDP access.                                                 |
| `BrowserRect`                 | type      | Readonly `[x, y, width, height]` CSS-pixel tuple.                                                                                                                                            |
| `BrowserLayout`               | interface | Optional layout box, computed styles, text, paint order, and DOM rectangles for a snapshot node.                                                                                             |
| `BrowserNode`                 | interface | One flattened serializable DOM node, including attributes, sparse state, frame identity, and layout.                                                                                         |
| `BrowserDocument`             | interface | One captured document with frame metadata, dimensions, and nodes.                                                                                                                            |
| `BrowserSnapshotInput`        | interface | `{ documents; styles }` — every captured document plus the requested computed-style names; the serializable form a `BrowserSnapshot` is built from and serializes back to.                   |
| `BrowserWalkOrder`            | type      | `'depth' \| 'breadth'` — structural ordering for a snapshot walk.                                                                                                                            |
| `BrowserWalkOptions`          | interface | `{ root?; order? }` — optional subtree root (included in the walk) and traversal order (default `'depth'`).                                                                                  |
| `BrowserSiblingRelation`      | type      | `'preceding' \| 'following'` — structural sibling side relative to a node.                                                                                                                   |
| `BrowserSnapshotInterface`    | interface | Extends `BrowserSnapshotInput`; adds walking, structural relationships, search, and path derivation over plain `BrowserNode` values.                                                         |
| `BrowserSnapshotOptions`      | interface | `{ styles?; paint?; rects?; limit? }` — DOM snapshot capture and decoding controls.                                                                                                          |
| `BrowserNodePredicate`        | type      | `(node: BrowserNode) => boolean` — traversal/search predicate.                                                                                                                               |
| `BrowserNodeQuery`            | interface | Declarative name/text/attribute/frame/visibility/clickability matcher.                                                                                                                       |
| `BrowserPageInterface`        | interface | Extends `BrowserFrameInterface`; adds `closed` plus navigation, screenshots, frame discovery, DOM snapshots, codegen, and target teardown.                                                   |
| `BrowserContextInterface`     | interface | `id` data member + `page` / `pages` / `create` / `sync` / `destroy` / `close` methods.                                                                                                       |

### Server

Server-side connection lifecycle — discover an already-running browser via
CDP, connect to it, or launch a fresh Chromium-family process:

```ts
import { createBrowser } from '@orkestrel/browser/server'

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

| Constant                          | Kind  | Value                                                                                                                                                                                                                  |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DEFAULT_CDP_PORT`        | const | `9222` — default CDP port probed for an existing browser and used for launches.                                                                                                                                        |
| `BROWSER_DEFAULT_HOST`            | const | `'127.0.0.1'` — default host probed/launched on (avoids `localhost` resolving to `::1`).                                                                                                                               |
| `BROWSER_CDP_PROTOCOL`            | const | `'http'` — protocol prefix for CDP discovery requests.                                                                                                                                                                 |
| `BROWSER_CDP_VERSION_PATH`        | const | `'/json/version'` — path appended to the CDP host to fetch version metadata.                                                                                                                                           |
| `BROWSER_CDP_LIST_PATH`           | const | `'/json/list'` — path appended to the CDP host to list open targets.                                                                                                                                                   |
| `BROWSER_LAUNCH_ARGS`             | const | Frozen flags always passed to a launched browser process, alongside the caller's own.                                                                                                                                  |
| `BROWSER_HEADLESS_ARG`            | const | `'--headless=new'` — flag enabling headless mode on a launched browser process.                                                                                                                                        |
| `BROWSER_PROFILE_PREFIX`          | const | `'orkestrel-browser-'` — guarded prefix for isolated launch profiles created beneath the operating-system temp directory.                                                                                              |
| `BROWSER_KILL_GRACE_MS`           | const | `3000` — bound for each launched-process exit window during TERM-to-KILL teardown. `destroy()` may apply it before and after hard-kill escalation; `close()` can first apply it while waiting for CDP `Browser.close`. |
| `BROWSER_PORT_PROBE_TIMEOUT_MS`   | const | `200` — bound for the `discover: false` port-occupancy probe before launching (short, since it only needs to detect an already-listening CDP endpoint).                                                                |
| `BROWSER_TRANSPORT_LOSS_DEFER_MS` | const | `50` — brief defer applied once when a transport loss is observed on an owned process, giving a near-simultaneous process-exit event first say over the diagnosis.                                                     |
| `BROWSER_PROCESS_EXIT_CAUSE`      | const | `'process-exit'` — machine-readable error-context cause for an owned browser process exiting.                                                                                                                          |
| `BROWSER_TRANSPORT_LOSS_CAUSE`    | const | `'transport-loss'` — machine-readable error-context cause for CDP transport loss while the browser remains alive.                                                                                                      |
| `BROWSER_ENV_PATH_KEYS`           | const | Frozen list of env vars checked (in order) for an explicit browser executable path override (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`).                                                                             |
| `BROWSER_EXECUTABLE_PATHS`        | const | Frozen record of well-known Chrome/Chromium/Edge paths with no platform-specific root, keyed by `process.platform` (win32 is empty — see `BROWSER_WINDOWS_SUFFIXES`).                                                  |
| `BROWSER_WINDOWS_SUFFIXES`        | const | Frozen list of Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root.                                                                                                    |
| `BROWSER_WINDOWS_ROOT_FALLBACKS`  | const | Frozen record of fallback Windows install roots used when `PROGRAMFILES` / `PROGRAMFILES(X86)` are unset.                                                                                                              |
| `BROWSER_EXECUTABLE_NAMES`        | const | Frozen list of command names probed on PATH when no well-known executable path exists.                                                                                                                                 |
| `BROWSER_STORE_ENV_KEY`           | const | `'PLAYWRIGHT_BROWSERS_PATH'` — env var naming an additional Playwright browser store base directory.                                                                                                                   |
| `BROWSER_STORE_DEFAULT_DIRS`      | const | Frozen list of well-known Playwright browser store base directories (e.g. `/opt/pw-browsers`).                                                                                                                         |
| `BROWSER_STORE_CACHE_DIRS`        | const | Frozen record of the per-OS default Playwright cache directory, relative to the home directory.                                                                                                                        |
| `BROWSER_STORE_LINK_NAME`         | const | `'chromium'` — name of the top-level Chromium symlink/binary inside a browser store base.                                                                                                                              |
| `BROWSER_STORE_GLOBS`             | const | Frozen record of the glob pattern matching a versioned Chromium binary, keyed by `process.platform`.                                                                                                                   |
| `BROWSER_ENGINE_HINTS`            | const | Frozen record of case-insensitive substrings identifying an executable's engine, keyed by `BrowserEngine` (checked edge → chromium → chrome by `parseBrowserEngine`).                                                  |

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
| `createBrowserProfile`    | function | Resolve a caller-owned persistent profile or create an isolated temporary user-data directory.                                                                                                                                                                                                                                                                 |
| `removeBrowserProfile`    | function | Remove a library-owned isolated profile after validating its guarded temp-directory shape; persistent profiles are untouched.                                                                                                                                                                                                                                  |
| `findEnvOverride`         | function | Check the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order for an existing file.                                                                                                                                                                                                                                                       |
| `findAllEnvOverrides`     | function | Check the env-override keys in order, returning every one that exists.                                                                                                                                                                                                                                                                                         |
| `defaultInstallPaths`     | function | Build the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                                                                                                                                                                                                                                     |
| `windowsRoots`            | function | Derive Windows install roots from env vars, falling back to well-known literals when absent.                                                                                                                                                                                                                                                                   |
| `findInstallPath`         | function | Return the first candidate path that exists on disk.                                                                                                                                                                                                                                                                                                           |
| `findAllInstallPaths`     | function | Return every candidate path that exists on disk, in the given order.                                                                                                                                                                                                                                                                                           |
| `probePathNames`          | function | Probe PATH (`which`/`where`) for the first resolvable command name.                                                                                                                                                                                                                                                                                            |
| `probeAllPathNames`       | function | Probe PATH for every resolvable command name, in the given order.                                                                                                                                                                                                                                                                                              |
| `readFirstLine`           | function | Return the first non-empty line of a command's output without its surrounding whitespace, so a `where` match on Windows keeps no trailing carriage return; may return `undefined`.                                                                                                                                                                             |
| `defaultStoreBases`       | function | Build the default Playwright browser store base directories to search for a managed Chromium.                                                                                                                                                                                                                                                                  |
| `findInStore`             | function | Search one store base for the top-level `chromium` link, else the highest-revision `chromium-*` install.                                                                                                                                                                                                                                                       |
| `findAllInStore`          | function | Search one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first.                                                                                                                                                                                                                                                |
| `launchBrowserProcess`    | function | Launch a browser process with raw-CDP debugging flags; a POSIX launch is detached into its own process group so teardown reaches every Chromium subprocess, and a Windows launch is not detached so teardown signals one process by identifier — the spawned process, or the one the launcher handed the endpoint to. Returns the spawned `ChildProcess`.      |
| `waitForCDPReady`         | function | Poll a browser's CDP version endpoint until it responds or the timeout elapses; returns the debugger URL.                                                                                                                                                                                                                                                      |
| `fetchCDPTargets`         | function | Fetch and normalize the current CDP target list from a browser's `/json/list` endpoint.                                                                                                                                                                                                                                                                        |

```ts
import {
	createCDPTransport,
	createScreenshotWriter,
	findSystemBrowsers,
	findSystemBrowser,
	parseBrowserEngine,
	normalizeExecutablePath,
	browserToEngine,
	createBrowserProfile,
	removeBrowserProfile,
	findEnvOverride,
	findAllEnvOverrides,
	defaultInstallPaths,
	windowsRoots,
	findInstallPath,
	findAllInstallPaths,
	probePathNames,
	probeAllPathNames,
	readFirstLine,
	defaultStoreBases,
	findInStore,
	findAllInStore,
	launchBrowserProcess,
	waitForCDPReady,
	fetchCDPTargets,
} from '@orkestrel/browser/server'

const transport = createCDPTransport({ url: 'ws://localhost:9222/devtools/browser/abc' })
const writer = createScreenshotWriter()

const browsers = findSystemBrowsers() // readonly SystemBrowser[]
const found = findSystemBrowser() // SystemBrowser | undefined — first entry of findSystemBrowsers()
// findSystemBrowsers({ env: {}, paths: [], names: [], stores: [], engine: 'edge' }) — override any candidate source, narrow by engine

parseBrowserEngine('/usr/bin/msedge') // 'edge'
normalizeExecutablePath('/usr/bin/Chrome', process.platform) // string — case-folded on win32 only
browserToEngine('HeadlessChrome/120.0') // 'chrome' — classifies a /json/version Browser string
const profile = await createBrowserProfile()
await removeBrowserProfile(profile)

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
readFirstLine('C:\\bin\\chrome.exe\r\nC:\\other\\chrome.exe\r\n') // 'C:\\bin\\chrome.exe' — CRLF-safe
const stores = defaultStoreBases(env, process.platform) // readonly string[]
for (const store of stores) findInStore(store, process.platform) // string | undefined
for (const store of stores) findAllInStore(store, process.platform) // readonly string[]
if (found !== undefined) {
	const child = launchBrowserProcess(found.executable, 9222, true)
	const debuggerUrl = await waitForCDPReady(9222, 5000)
	const targets = await fetchCDPTargets(9222, 5000)
}
```

#### Types

| Type                           | Kind      | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserEngine`                | type      | `'chromium' \| 'chrome' \| 'edge'` — the supported browser engines (raw CDP targets Chromium-family browsers only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BrowserConnection`            | type      | `'cdp' \| 'launch' \| 'persistent'` — how the browser connection was established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `BrowserStatus`                | type      | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error'` — lifecycle status of a browser wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `BrowserDiscoveryResult`       | interface | `{ found: boolean; endpoint?; browser?; connection? }` — result of passive browser discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SystemBrowserOptions`         | interface | `{ env?; paths?; names?; stores?; engine? }` — overrides for `findSystemBrowsers`'s candidate sources (env-override keys/Windows roots, install paths, PATH-probe names, Playwright store base dirs) plus an engine filter; each field replaces its category's default, an explicit `[]`/`{}` disables it.                                                                                                                                                                                                                                                                               |
| `SystemBrowser`                | type      | `{ executable: string; engine: BrowserEngine }` — one discovered browser executable, as returned by `findSystemBrowsers`/`findSystemBrowser`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `BrowserProfileResult`         | interface | `{ path: string; temporary: boolean }` — resolved launch profile and its ownership state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BrowserCDPOptions`            | interface | `{ port?: number; host?: string; endpoint?: string; discover?: boolean }` — CDP connection configuration (`host` defaults to `BROWSER_DEFAULT_HOST`; `discover` defaults to `true` — `false` skips passive discovery, probes the port, and rejects if something is already listening there instead of silently attaching to it).                                                                                                                                                                                                                                                         |
| `BrowserEventMap`              | type      | `{ idle: []; discover: [result]; connect: [connection]; disconnect: []; launch: [engine]; page: [page]; error: [error]; destroy: [] }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `BrowserOptions`               | interface | `{ on?; error?; headless?; executable?; profile?; cdp?; timeout?; viewport?; signal?; args?; engine?; browsers? }` — options for `createBrowser` (`engine` prefers a browser engine for discovery when launching; ignored once `connect()` launches a process — before that, the `engine` getter may still reflect the supplied `engine` option even if `executable` is also set; `browsers` supplies `SystemBrowserOptions` candidate-source overrides consulted when launch discovery runs, ignored when `executable` is given, and `engine` takes precedence over `browsers.engine`). |
| `BrowserInterface`             | interface | `emitter` / `engine` / `status` / `connection` / `owned` / `connected` / `pid` data members + `discover` / `connect` / `adopt` / `disconnect` / `context` / `contexts` / `create` / `destroy` / `close` methods.                                                                                                                                                                                                                                                                                                                                                                         |
| `WebSocketCDPTransportOptions` | interface | `{ on?; error?; url: string; timeout?: number }` — options for creating a WebSocketCDPTransport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Extended Chromium automation surface

The focused CDP feature layer is grouped into small entities. Managers expose
single-word operations through `BrowserContextInterface` and
`BrowserPageInterface`; the helpers remain pure so protocol decoding,
validation, scraping, and compilation can be tested without a browser.

#### Extended constants and entities

| API                            | Kind  | Summary                                                            |
| ------------------------------ | ----- | ------------------------------------------------------------------ |
| `BROWSER_HAR_CREATOR`          | const | Frozen HAR 1.2 creator identity for persisted network archives.    |
| `BROWSER_KEY_MODIFIERS`        | const | Frozen Chromium keyboard modifier bit map.                         |
| `BROWSER_MOUSE_BUTTON_MASKS`   | const | Frozen Chromium pressed-button bit map.                            |
| `BROWSER_SCREENSHOT_ATTRIBUTE` | const | Temporary attribute used to scope screenshot preparation styles.   |
| `BROWSER_STABLE_FRAME_COUNT`   | const | Consecutive animation frames required by the stability check.      |
| `BROWSER_TEST_ID_ATTRIBUTE`    | const | Attribute used by test-id locators.                                |
| `BrowserAccessibility`         | class | Accessibility-domain snapshot reader.                              |
| `BrowserClock`                 | class | Chromium virtual-time lifecycle.                                   |
| `BrowserCookieManager`         | class | Context-scoped cookie manager.                                     |
| `BrowserCoverage`              | class | JavaScript and CSS coverage lifecycle.                             |
| `BrowserDiagnostics`           | class | Tracing, coverage, and performance composition root.               |
| `BrowserDialog`                | class | One JavaScript dialog with accept/dismiss operations.              |
| `BrowserDownload`              | class | One observable download with progress and cancellation.            |
| `BrowserEmulationManager`      | class | Context-inherited Chromium emulation overrides.                    |
| `BrowserFileChooser`           | class | One intercepted file chooser.                                      |
| `BrowserHARManager`            | class | HAR 1.2 recording, persistence, and replay.                        |
| `BrowserHandle`                | class | Remote JavaScript object handle.                                   |
| `BrowserKeyboard`              | class | Trusted Chromium keyboard input.                                   |
| `BrowserLocator`               | class | Strict, reusable, shadow-aware locator.                            |
| `BrowserMouse`                 | class | Trusted Chromium mouse input.                                      |
| `BrowserNavigationManager`     | class | URL/function waits and navigation-response observation.            |
| `BrowserNetworkManager`        | class | Network observation, bodies, interception, auth, HAR, and sockets. |
| `BrowserPerformance`           | class | Metrics and sampled CPU-profile lifecycle.                         |
| `BrowserPermissionManager`     | class | Context permission overrides.                                      |
| `BrowserRoute`                 | class | One paused Fetch-domain request.                                   |
| `BrowserScriptManager`         | class | Init scripts and host bindings.                                    |
| `BrowserSelectorManager`       | class | CSS and semantic locator factory.                                  |
| `BrowserStorageManager`        | class | Cookie and web-storage state import/export.                        |
| `BrowserTouch`                 | class | Trusted Chromium touch input.                                      |
| `BrowserTracing`               | class | Trace stream capture and persistence.                              |
| `BrowserWebSocket`             | class | Observable WebSocket lifecycle.                                    |
| `BrowserWorker`                | class | Attached worker target with evaluation and raw CDP access.         |

#### Extended helpers

| API                                      | Kind     | Summary                                                        |
| ---------------------------------------- | -------- | -------------------------------------------------------------- |
| `browserHARHeadersToRecord`              | function | Convert HAR header entries to a Fetch header record.           |
| `browserHeadersToProtocol`               | function | Convert a header record to CDP name/value entries.             |
| `browserPDFToParams`                     | function | Validate and compile PDF options to CDP parameters.            |
| `browserScreenshotToParams`              | function | Validate and compile screenshot options to CDP parameters.     |
| `bytesToText`                            | function | Decode UTF-8 bytes.                                            |
| `compileActionabilityFunction`           | function | Compile element actionability checks for a remote handle.      |
| `compileAttachedLocatorWaitExpression`   | function | Compile a strict locator attached-state wait.                  |
| `compileBrowserBindingCleanup`           | function | Compile host-binding cleanup in a page.                        |
| `compileBrowserBindingResult`            | function | Compile host-binding settlement in a page.                     |
| `compileBrowserBindingSource`            | function | Compile a page-side host-binding facade.                       |
| `compileDetachedLocatorWaitExpression`   | function | Compile a strict locator detached-state wait.                  |
| `compileFunctionWaitExpression`          | function | Compile an auto-retrying page predicate.                       |
| `compileHiddenLocatorWaitExpression`     | function | Compile a strict locator hidden-state wait.                    |
| `compileLocatorExpression`               | function | Compile a query that returns its first element.                |
| `compileLocatorListExpression`           | function | Compile a deep, open-shadow-aware semantic query.              |
| `compileScreenshotCleanupExpression`     | function | Compile cleanup for temporary screenshot styles.               |
| `compileScreenshotPreparationExpression` | function | Compile screenshot masking, caret, and animation preparation.  |
| `compileStorageClearExpression`          | function | Compile origin storage clearing.                               |
| `compileStorageReadExpression`           | function | Compile origin storage extraction.                             |
| `compileStorageRestoreExpression`        | function | Compile origin storage restoration.                            |
| `compileVisibleLocatorWaitExpression`    | function | Compile a strict locator visible-state wait.                   |
| `computeBrowserButtons`                  | function | Compute the current Chromium mouse button bit mask.            |
| `computeBrowserModifiers`                | function | Compute Chromium keyboard modifier bits.                       |
| `concatBytes`                            | function | Concatenate byte chunks without a runtime-specific buffer.     |
| `cookieToProtocol`                       | function | Validate and project a public cookie into CDP input.           |
| `createBrowserHAREntry`                  | function | Build one standards-shaped HAR 1.2 exchange entry.             |
| `encodeBase64`                           | function | Encode bytes as base64 without Node or DOM globals.            |
| `keyToBrowserInput`                      | function | Normalize a key token to Chromium input metadata.              |
| `matchesBrowserCookieURL`                | function | Match a cookie against a URL using domain/path/security rules. |
| `matchesBrowserRoute`                    | function | Match an observed request against route criteria.              |
| `matchesBrowserURL`                      | function | Match a URL against the supported `*`/`**` glob grammar.       |
| `mediaToFeatures`                        | function | Project public media options to Chromium feature entries.      |
| `parseBrowserChord`                      | function | Parse a keyboard chord.                                        |
| `readBrowserAXString`                    | function | Decode an accessibility string property.                       |
| `readBrowserAXValue`                     | function | Decode an accessibility property value.                        |
| `readBrowserAccessibility`               | function | Decode an accessibility tree response.                         |
| `readBrowserBindingCall`                 | function | Decode a Runtime binding invocation.                           |
| `readBrowserConsoleMessage`              | function | Decode a console event.                                        |
| `readBrowserCookie`                      | function | Decode one CDP cookie.                                         |
| `readBrowserCookiePartition`             | function | Decode cookie partition metadata.                              |
| `readBrowserCookies`                     | function | Decode a cookie list response.                                 |
| `readBrowserCoverageRanges`              | function | Decode and normalize coverage ranges.                          |
| `readBrowserDownloadProgress`            | function | Decode download progress.                                      |
| `readBrowserDownloadStart`               | function | Decode download creation metadata.                             |
| `readBrowserHeaders`                     | function | Decode CDP headers to string values.                           |
| `readBrowserMetrics`                     | function | Decode performance metrics.                                    |
| `readBrowserPageError`                   | function | Decode an uncaught page exception.                             |
| `readBrowserProfile`                     | function | Decode a sampled CPU profile.                                  |
| `readBrowserProfileFrame`                | function | Decode a CPU-profile call frame.                               |
| `readBrowserQuad`                        | function | Decode and validate an element content quad.                   |
| `readBrowserRemoteValue`                 | function | Decode a Runtime remote value.                                 |
| `readBrowserRequest`                     | function | Decode a request event.                                        |
| `readBrowserRequestFailure`              | function | Decode a request failure.                                      |
| `readBrowserResponse`                    | function | Decode a response event.                                       |
| `readBrowserResponseRecord`              | function | Decode a response object with event identity.                  |
| `readBrowserScriptCoverage`              | function | Decode JavaScript coverage.                                    |
| `readBrowserScriptIdentifier`            | function | Decode an installed init-script identifier.                    |
| `readBrowserSecurity`                    | function | Decode TLS security details.                                   |
| `readBrowserStack`                       | function | Decode a browser stack trace.                                  |
| `readBrowserStorageEntries`              | function | Decode origin storage entries.                                 |
| `readBrowserStorageOrigin`               | function | Decode an origin storage result.                               |
| `readBrowserStreamChunk`                 | function | Decode an IO stream chunk.                                     |
| `readBrowserStyleCoverage`               | function | Decode CSS coverage.                                           |
| `readBrowserTiming`                      | function | Decode network timing phases.                                  |
| `readBrowserTimingRange`                 | function | Decode one network timing start/end pair.                      |
| `readBrowserWebSocketFrame`              | function | Decode a WebSocket frame event.                                |
| `textToBytes`                            | function | Encode UTF-8 text.                                             |
| `validateBrowserAccessibilityOptions`    | function | Validate accessibility snapshot bounds.                        |
| `validateBrowserActionOptions`           | function | Validate action timing, counts, steps, and position.           |
| `validateBrowserContextOptions`          | function | Validate isolated-context configuration before CDP mutation.   |
| `validateBrowserEmulationOptions`        | function | Validate emulation configuration before partial application.   |
| `validateBrowserHAR`                     | function | Validate the HAR 1.2 fields required for replay.               |
| `validateBrowserPoint`                   | function | Validate finite viewport coordinates.                          |
| `validateBrowserRange`                   | function | Validate an optional finite numeric range.                     |
| `validateBrowserTimeout`                 | function | Validate a non-negative finite timeout.                        |
| `validateBrowserViewport`                | function | Validate dimensions and device scale.                          |

The pure helpers can be composed around captured CDP payloads without creating
a browser entity. This compact fixture sketch intentionally shows every
helper family; production callers normally use the managers, which invoke
these decoders and compilers internally.

```ts
import {
	browserHARHeadersToRecord,
	browserHeadersToProtocol,
	browserPDFToParams,
	browserScreenshotToParams,
	bytesToText,
	compileActionabilityFunction,
	compileAttachedLocatorWaitExpression,
	compileBrowserBindingCleanup,
	compileBrowserBindingResult,
	compileBrowserBindingSource,
	compileDetachedLocatorWaitExpression,
	compileFunctionWaitExpression,
	compileHiddenLocatorWaitExpression,
	compileLocatorExpression,
	compileLocatorListExpression,
	compileScreenshotCleanupExpression,
	compileScreenshotPreparationExpression,
	compileStorageClearExpression,
	compileStorageReadExpression,
	compileStorageRestoreExpression,
	compileVisibleLocatorWaitExpression,
	computeBrowserButtons,
	computeBrowserModifiers,
	concatBytes,
	cookieToProtocol,
	createBrowserHAREntry,
	encodeBase64,
	keyToBrowserInput,
	matchesBrowserCookieURL,
	matchesBrowserRoute,
	matchesBrowserURL,
	mediaToFeatures,
	parseBrowserChord,
	readBrowserAXString,
	readBrowserAXValue,
	readBrowserAccessibility,
	readBrowserBindingCall,
	readBrowserConsoleMessage,
	readBrowserCookie,
	readBrowserCookiePartition,
	readBrowserCookies,
	readBrowserCoverageRanges,
	readBrowserDownloadProgress,
	readBrowserDownloadStart,
	readBrowserHeaders,
	readBrowserMetrics,
	readBrowserPageError,
	readBrowserProfile,
	readBrowserProfileFrame,
	readBrowserQuad,
	readBrowserRemoteValue,
	readBrowserRequest,
	readBrowserRequestFailure,
	readBrowserResponse,
	readBrowserResponseRecord,
	readBrowserScriptCoverage,
	readBrowserScriptIdentifier,
	readBrowserSecurity,
	readBrowserStack,
	readBrowserStorageEntries,
	readBrowserStorageOrigin,
	readBrowserStreamChunk,
	readBrowserStyleCoverage,
	readBrowserTiming,
	readBrowserTimingRange,
	readBrowserWebSocketFrame,
	textToBytes,
	validateBrowserAccessibilityOptions,
	validateBrowserActionOptions,
	validateBrowserContextOptions,
	validateBrowserEmulationOptions,
	validateBrowserHAR,
	validateBrowserPoint,
	validateBrowserRange,
	validateBrowserTimeout,
	validateBrowserViewport,
} from '@orkestrel/browser'

const query = { selector: 'css', value: 'main' }
const bytes = textToBytes('hello')
bytesToText(bytes)
encodeBase64(bytes)
concatBytes([bytes])
browserHeadersToProtocol({ accept: 'application/json' })
browserHARHeadersToRecord([{ name: 'content-type', value: 'text/plain' }])
browserPDFToParams({ landscape: true })
browserScreenshotToParams({ type: 'png' })
compileActionabilityFunction({ visible: true, stable: true })
compileLocatorListExpression(query)
compileLocatorExpression(query)
compileAttachedLocatorWaitExpression(query, true, 1000)
compileDetachedLocatorWaitExpression(query, true, 1000)
compileVisibleLocatorWaitExpression(query, true, 1000)
compileHiddenLocatorWaitExpression(query, true, 1000)
compileFunctionWaitExpression('() => document.readyState === "complete"', 1000)
compileBrowserBindingSource('lookup')
compileBrowserBindingResult('lookup', 'call-1', true, { found: true })
compileBrowserBindingCleanup('lookup')
compileScreenshotPreparationExpression({ animations: false })
compileScreenshotCleanupExpression('1')
compileStorageReadExpression()
compileStorageRestoreExpression({
	origin: 'https://example.com',
	local: [{ name: 'theme', value: 'dark' }],
	session: [],
})
compileStorageClearExpression()
computeBrowserButtons(['left'])
computeBrowserModifiers(['Control'])
cookieToProtocol({ name: 'session', value: 'value', url: 'https://example.com/' })
keyToBrowserInput('Control+Enter')
parseBrowserChord('Control+Enter')
matchesBrowserURL('https://example.com/api', '**/api')
mediaToFeatures({ color: 'dark', motion: 'reduce' })

const request = readBrowserRequest({
	requestId: 'request-1',
	request: { url: 'https://example.com/api', method: 'GET', headers: {} },
})
if (request !== undefined) {
	matchesBrowserRoute(request, { url: '**/api' })
	createBrowserHAREntry(
		{ request, started: Date.now(), response: undefined },
		10,
		undefined,
		'Request failed',
	)
}

const cookie = readBrowserCookie(
	{
		name: 'session',
		value: 'value',
		domain: 'example.com',
		path: '/',
		expires: -1,
		size: 12,
		httpOnly: true,
		secure: true,
		session: true,
		priority: 'Medium',
	},
	0,
)
matchesBrowserCookieURL(cookie, 'https://example.com/')

const payload: unknown = {}
readBrowserAXString(payload)
readBrowserAXValue(payload)
readBrowserAccessibility(payload)
readBrowserBindingCall(payload)
readBrowserConsoleMessage(payload)
readBrowserCookiePartition(payload)
readBrowserCookies(payload)
readBrowserCoverageRanges([], 0)
readBrowserDownloadProgress(payload)
readBrowserDownloadStart(payload)
readBrowserHeaders(payload)
readBrowserMetrics(payload)
readBrowserPageError(payload)
readBrowserProfile(payload)
readBrowserProfileFrame(payload, 0)
readBrowserQuad(payload)
readBrowserRemoteValue(payload)
readBrowserRequestFailure(payload)
readBrowserResponse(payload)
readBrowserResponseRecord(payload, 'request-1', 'loader-1', undefined, 0)
readBrowserScriptCoverage(payload)
readBrowserScriptIdentifier(payload)
readBrowserSecurity(payload)
readBrowserStack(payload)
readBrowserStorageEntries([], 'https://example.com', 'local')
readBrowserStorageOrigin(payload, 'https://example.com')
readBrowserStreamChunk(payload)
readBrowserStyleCoverage(payload)
readBrowserTiming(payload)
readBrowserTimingRange(payload, 'dnsStart', 'dnsEnd')
readBrowserWebSocketFrame(payload)
validateBrowserAccessibilityOptions({ depth: 3 })
validateBrowserActionOptions({ timeout: 1000 })
validateBrowserContextOptions({ origins: ['https://example.com'] })
validateBrowserEmulationOptions({ locale: 'en-US' })
validateBrowserHAR({
	log: { version: '1.2', creator: { name: 'fixture', version: '1' }, entries: [] },
})
validateBrowserPoint({ x: 10, y: 20 })
validateBrowserRange(50, 'quality', 0, 100)
validateBrowserTimeout(1000)
validateBrowserViewport({ width: 1280, height: 720 })
```

#### Extended types

| API                                 | Kind      | Summary                                                           |
| ----------------------------------- | --------- | ----------------------------------------------------------------- |
| `BrowserAXNode`                     | interface | Decoded Chromium accessibility node.                              |
| `BrowserAccessibilityInterface`     | interface | Accessibility snapshot contract.                                  |
| `BrowserAccessibilityOptions`       | interface | Root/depth accessibility options.                                 |
| `BrowserAccessibilitySnapshot`      | interface | Serializable accessibility forest.                                |
| `BrowserActionabilityOptions`       | interface | Internal actionability checks and optional position.              |
| `BrowserBindingCall`                | interface | One decoded page-to-host binding call.                            |
| `BrowserBindingHandler`             | type      | Host function exposed to a page.                                  |
| `BrowserChord`                      | interface | Parsed keyboard modifiers and key.                                |
| `BrowserClockInterface`             | interface | Chromium virtual-time contract.                                   |
| `BrowserConsoleMessage`             | interface | Typed page console event.                                         |
| `BrowserContextEventMap`            | type      | Context page/close events.                                        |
| `BrowserContextOptions`             | interface | Proxy, origin, download, and emulation context options.           |
| `BrowserCookie`                     | interface | Cookie returned by Chromium.                                      |
| `BrowserCookieFilter`               | interface | Name/domain/path cookie-clear filter.                             |
| `BrowserCookieInput`                | interface | Cookie creation input.                                            |
| `BrowserCookieManagerInterface`     | interface | Context cookie contract.                                          |
| `BrowserCookiePartition`            | interface | Partitioned-cookie key.                                           |
| `BrowserCoverageInterface`          | interface | JavaScript/CSS coverage lifecycle.                                |
| `BrowserCoverageOptions`            | interface | Coverage collection options.                                      |
| `BrowserCoverageRange`              | interface | Covered source range and execution count.                         |
| `BrowserCoverageResult`             | interface | Combined script/style coverage result.                            |
| `BrowserCredentials`                | interface | HTTP basic-auth credentials.                                      |
| `BrowserDiagnosticsInterface`       | interface | Tracing/coverage/performance group.                               |
| `BrowserDialogCategory`             | type      | JavaScript dialog category.                                       |
| `BrowserDialogInterface`            | interface | Dialog data and settlement contract.                              |
| `BrowserDownloadEventMap`           | type      | Download progress/finish/abort events.                            |
| `BrowserDownloadInterface`          | interface | Download state and operations.                                    |
| `BrowserDownloadOptions`            | interface | Context download path/policy.                                     |
| `BrowserDownloadProgress`           | interface | Decoded download progress event.                                  |
| `BrowserDownloadStart`              | interface | Decoded download creation event.                                  |
| `BrowserDownloadStatus`             | type      | Download lifecycle state.                                         |
| `BrowserEmulationManagerInterface`  | interface | Context emulation lifecycle.                                      |
| `BrowserEmulationOptions`           | interface | Viewport, identity, location, media, network, and auth emulation. |
| `BrowserFileChooserInterface`       | interface | File chooser metadata and file selection.                         |
| `BrowserFilterOptions`              | interface | Locator text/visibility filter.                                   |
| `BrowserFunctionCoverage`           | interface | Per-function JavaScript coverage.                                 |
| `BrowserGeolocation`                | interface | Latitude, longitude, and accuracy override.                       |
| `BrowserHAR`                        | interface | Standards-shaped HAR 1.2 document.                                |
| `BrowserHARContent`                 | interface | HAR response body metadata.                                       |
| `BrowserHARCookie`                  | interface | HAR cookie value.                                                 |
| `BrowserHARCreator`                 | interface | HAR creator name/version.                                         |
| `BrowserHAREntry`                   | interface | One HAR HTTP exchange.                                            |
| `BrowserHARLog`                     | interface | HAR version, creator, and entries.                                |
| `BrowserHARManagerInterface`        | interface | HAR recording/replay contract.                                    |
| `BrowserHAROptions`                 | interface | HAR content/persistence options.                                  |
| `BrowserHARPending`                 | interface | Request state awaiting completion.                                |
| `BrowserHARPost`                    | interface | HAR request body metadata.                                        |
| `BrowserHARReplayOptions`           | interface | Archive-miss replay behavior.                                     |
| `BrowserHARRequest`                 | interface | HAR 1.2 request.                                                  |
| `BrowserHARResponse`                | interface | HAR 1.2 response.                                                 |
| `BrowserHARTimings`                 | interface | HAR 1.2 phase timings.                                            |
| `BrowserHARValue`                   | interface | HAR name/value entry.                                             |
| `BrowserHandleInterface`            | interface | Remote object evaluation/disposal contract.                       |
| `BrowserKey`                        | interface | Normalized Chromium keyboard input data.                          |
| `BrowserKeyboardInterface`          | interface | Trusted keyboard input contract.                                  |
| `BrowserLocatorFilter`              | interface | Serializable locator filter.                                      |
| `BrowserLocatorInterface`           | interface | Reusable strict locator contract.                                 |
| `BrowserMargin`                     | interface | PDF paper margins.                                                |
| `BrowserMedia`                      | interface | Media and user-preference emulation.                              |
| `BrowserMetric`                     | interface | Named performance metric.                                         |
| `BrowserMouseButton`                | type      | Supported Chromium mouse button.                                  |
| `BrowserMouseInterface`             | interface | Trusted mouse input contract.                                     |
| `BrowserNavigationManagerInterface` | interface | Navigation observation/wait contract.                             |
| `BrowserNavigationResult`           | interface | Final navigation URL and matching response.                       |
| `BrowserNavigationWaitOptions`      | interface | URL/function navigation wait options.                             |
| `BrowserNavigationWatch`            | interface | Pending request/response correlation state.                       |
| `BrowserNavigationWait`             | interface | Pending URL-pattern waiter state.                                 |
| `BrowserNetworkEventMap`            | type      | Request/response/failure/finish/socket events.                    |
| `BrowserNetworkManagerInterface`    | interface | Page network lifecycle contract.                                  |
| `BrowserPDFOptions`                 | interface | Chromium print-to-PDF options.                                    |
| `BrowserPDFResult`                  | interface | PDF bytes and optional path.                                      |
| `BrowserPageError`                  | interface | Uncaught page exception.                                          |
| `BrowserPageEventMap`               | type      | Page, frame, target, input, and network events.                   |
| `BrowserPerformanceInterface`       | interface | Metrics and CPU-profile contract.                                 |
| `BrowserPermissionManagerInterface` | interface | Context permission contract.                                      |
| `BrowserPoint`                      | interface | CSS-pixel coordinate.                                             |
| `BrowserProfile`                    | interface | Sampled CPU profile.                                              |
| `BrowserProfileFrame`               | interface | CPU-profile call frame.                                           |
| `BrowserProfileNode`                | interface | CPU-profile call-tree node.                                       |
| `BrowserProxy`                      | interface | Context proxy server and bypass list.                             |
| `BrowserQuad`                       | interface | Element content quad and actionable center.                       |
| `BrowserQuery`                      | interface | Serializable locator query tree.                                  |
| `BrowserRequest`                    | interface | Observed HTTP request.                                            |
| `BrowserRequestFailure`             | interface | Observed request failure.                                         |
| `BrowserResponse`                   | interface | Observed HTTP response with timing/security metadata.             |
| `BrowserRoleOptions`                | interface | Role locator accessible-name options.                             |
| `BrowserRouteContinueOptions`       | interface | Request continuation overrides.                                   |
| `BrowserRouteDefinition`            | interface | Installed route query/handler.                                    |
| `BrowserRouteFulfillOptions`        | interface | Synthetic response options.                                       |
| `BrowserRouteHandler`               | type      | Function handling a paused request.                               |
| `BrowserRouteInterface`             | interface | Paused-request settlement contract.                               |
| `BrowserRouteQuery`                 | interface | URL/method/resource route criteria.                               |
| `BrowserSameSite`                   | type      | Cookie same-site policy.                                          |
| `BrowserScreenshotScale`            | type      | CSS/device screenshot coordinate scale.                           |
| `BrowserScriptCoverage`             | interface | Per-script JavaScript coverage.                                   |
| `BrowserScriptEntry`                | interface | Installed script and optional binding owner.                      |
| `BrowserScriptManagerInterface`     | interface | Init-script/binding lifecycle contract.                           |
| `BrowserSecurity`                   | interface | TLS protocol, issuer, and validity.                               |
| `BrowserSelector`                   | type      | CSS/role/text/label/placeholder/test locator axis.                |
| `BrowserSelectorManagerInterface`   | interface | Semantic locator factory contract.                                |
| `BrowserStackFrame`                 | interface | Browser-side exception stack frame.                               |
| `BrowserStorageEntry`               | interface | Web-storage key/value pair.                                       |
| `BrowserStorageManagerInterface`    | interface | Storage state lifecycle contract.                                 |
| `BrowserStorageOptions`             | interface | Origins selected for storage capture.                             |
| `BrowserStorageOrigin`              | interface | Local/session storage for one origin.                             |
| `BrowserStorageState`               | interface | Cookies and selected web-storage origins.                         |
| `BrowserStreamChunk`                | interface | Decoded CDP IO chunk.                                             |
| `BrowserStyleCoverage`              | interface | Per-style-sheet CSS coverage.                                     |
| `BrowserTextOptions`                | interface | Exactness for text-like locators.                                 |
| `BrowserTextResultOptions`          | interface | Single/all locator text selection.                                |
| `BrowserTiming`                     | interface | CDP network timing phases.                                        |
| `BrowserTimingRange`                | interface | Start/end pair for one network timing phase.                      |
| `BrowserTouchInterface`             | interface | Trusted touch input contract.                                     |
| `BrowserTracingInterface`           | interface | Chromium tracing lifecycle contract.                              |
| `BrowserTracingOptions`             | interface | Categories/screenshots/sampling/path tracing options.             |
| `BrowserTracingResult`              | interface | Trace bytes and optional path.                                    |
| `BrowserUploadOptions`              | interface | File paths plus action options.                                   |
| `BrowserUserAgent`                  | interface | User-agent string/language/platform override.                     |
| `BrowserWebSocketEventMap`          | type      | WebSocket frame/error/close events.                               |
| `BrowserWebSocketFrame`             | interface | WebSocket opcode/payload/mask/timestamp.                          |
| `BrowserWebSocketInterface`         | interface | Observable WebSocket contract.                                    |
| `BrowserWorkerCategory`             | type      | Dedicated/service/shared worker category.                         |
| `BrowserWorkerInterface`            | interface | Attached worker evaluation/CDP contract.                          |

## Methods

The public methods of the layer's behavioral interfaces — every call-signature
member listed (their `readonly` data members stay Surface rows). Each
implementing class exposes EXACTLY its interface's methods: `CDPClient` ↔
`CDPClientInterface`, `BrowserContext` ↔ `BrowserContextInterface`,
`BrowserFrame` ↔ `BrowserFrameInterface`, `BrowserPage` ↔
`BrowserPageInterface`, `BrowserSnapshot` ↔ `BrowserSnapshotInterface`,
`BrowserCodegen` ↔ `BrowserCodegenInterface`, `Browser` ↔
`BrowserInterface`, `WebSocketCDPTransport` ↔
`CDPTransportInterface`.

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
import { createCDPClient } from '@orkestrel/browser'

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

| Method    | Returns                             | Behavior                                                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`    | `BrowserPageInterface \| undefined` | One page by index, or the first page.                                                                                                                                                                                                                                                                    |
| `pages`   | `readonly BrowserPageInterface[]`   | All pages in creation order.                                                                                                                                                                                                                                                                             |
| `create`  | `Promise<BrowserPageInterface>`     | Open a new page in this context.                                                                                                                                                                                                                                                                         |
| `sync`    | `Promise<void>`                     | Synchronize pages from the given CDP targets (server discovers the targets, core never fetches them). Performs a destructive diff, not an additive merge: pages whose target id is missing from `targets` are closed and dropped; pages present in `targets` but not yet tracked are attached and added. |
| `destroy` | `Promise<void>`                     | Release local pages and detach their sessions without disposing the remote browser context.                                                                                                                                                                                                              |
| `close`   | `Promise<void>`                     | Close remote pages, dispose the remote browser context, and release local resources.                                                                                                                                                                                                                     |

```ts
const ctx = browser.context()
const page = await ctx?.create({ url: 'https://example.com' })
const all = ctx?.pages() // readonly BrowserPageInterface[]
await ctx?.sync(targets) // reconcile pages from discovered CDP targets
await ctx?.destroy() // local detach
```

#### `BrowserFrameInterface`

Operations shared by a top-level page and an iframe document. Child-frame
evaluation uses a named isolated world and automatically follows an attached
out-of-process iframe session when Chromium splits the frame into another
target.

| Method        | Returns                           | Behavior                                                                                                                                                                                                                           |
| ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | `Promise<string>`                 | Resolve the frame document title.                                                                                                                                                                                                  |
| `content`     | `Promise<BrowserContentResult>`   | Extract URL, title, HTML, and visible text with result-size guards.                                                                                                                                                                |
| `article`     | `Promise<string>`                 | Distill the frame HTML to reader-facing plain text, boilerplate and hidden regions pruned.                                                                                                                                         |
| `click`       | `Promise<void>`                   | Strict-by-default visible and enabled CSS-selector click.                                                                                                                                                                          |
| `fill`        | `Promise<void>`                   | Strict-by-default editable input or contenteditable fill, dispatching input/change events.                                                                                                                                         |
| `select`      | `Promise<void>`                   | Strict-by-default option selection on an enabled `<select>`.                                                                                                                                                                       |
| `evaluate`    | `Promise<unknown>`                | Evaluate an expression in the frame execution world with result-size guarding.                                                                                                                                                     |
| `handle`      | `Promise<BrowserHandleInterface>` | Evaluate an expression by reference and return a disposable remote object handle.                                                                                                                                                  |
| `wait`        | `Promise<void>`                   | Wait for attached, detached, visible, or hidden selector state.                                                                                                                                                                    |
| `send`        | `Promise<unknown>`                | Issue a raw CDP method in the frame's current target session, with an optional per-call `timeout` overriding the client-wide default.                                                                                              |
| `subscribe`   | `Promise<void>`                   | Subscribe to a CDP event in the frame's current target session.                                                                                                                                                                    |
| `unsubscribe` | `Promise<void>`                   | Remove a frame-session CDP event subscription.                                                                                                                                                                                     |
| `save`        | `Promise<void>`                   | Persist bytes through a page writer; child frames reject because they own no writer.                                                                                                                                               |
| `assert`      | `void`                            | Throw a coded `BrowserError` when the frame can no longer accept protocol work: `BrowserFrame` throws once the CDP client disconnects, and `BrowserPage` also throws once the page closes. Every other method here calls it first. |
| `update`      | `void`                            | Record an externally observed URL as the frame's current `url`. `BrowserPage` calls it from its own `Page.frameNavigated` handler.                                                                                                 |

```ts
const child = await page.frame('checkout')
const title = await child?.title()
await child?.wait('form', { state: 'visible' })
await child?.fill('[name=email]', 'ada@example.com')
await child?.click('button[type=submit]')
await child?.select('select', ['business'])
const content = await child?.content()
const article = await child?.article() // its own HTML capture, distilled to plain text
const result = await child?.evaluate('document.readyState')
const handle = await child?.handle('document.body')
await handle?.dispose()
const onLoad = () => log('loaded')
await child?.subscribe('Page.loadEventFired', onLoad)
await child?.unsubscribe('Page.loadEventFired', onLoad)
const root = await child?.send('DOM.getDocument')
const tree = await child?.send('DOM.getDocument', { depth: 1 }, 5_000) // per-call timeout
await page.save('./artifact.bin', new Uint8Array([1, 2, 3]))
child?.assert() // throws once the client disconnects, or the page closes
child?.update('https://example.com/checkout') // record a URL observed elsewhere
```

#### `BrowserPageInterface`

A top-level page. It inherits the complete `BrowserFrameInterface` document
surface above and declares only page/target-specific operations here.

| Method       | Returns                                       | Behavior                                                                                                          |
| ------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `navigate`   | `Promise<BrowserNavigationResult>`            | Go to a URL, wait for the requested load condition, and return final URL/response correlation.                    |
| `reload`     | `Promise<BrowserNavigationResult>`            | Reload and return final URL/response correlation.                                                                 |
| `back`       | `Promise<BrowserNavigationResult>`            | Navigate to the previous history entry, or return the unchanged URL when none exists.                             |
| `forward`    | `Promise<BrowserNavigationResult>`            | Navigate to the next history entry, or return the unchanged URL when none exists.                                 |
| `screenshot` | `Promise<BrowserScreenshotResult>`            | Capture PNG/JPEG bytes, optionally full-page and persisted through an injected writer.                            |
| `pdf`        | `Promise<BrowserPDFResult>`                   | Print the page to PDF bytes, optionally persisted through the injected writer.                                    |
| `frame`      | `Promise<BrowserFrameInterface \| undefined>` | Look up a first-class frame by name or URL.                                                                       |
| `frames`     | `Promise<readonly BrowserFrameInterface[]>`   | Decode the flattened frame tree, main frame first.                                                                |
| `snapshot`   | `Promise<BrowserSnapshotInterface>`           | Capture and decode all attached documents, shadow roots, template contents, layout, and optional computed styles. |
| `codegen`    | `Promise<BrowserCodegenInterface>`            | Start or return the current action recorder.                                                                      |
| `destroy`    | `Promise<void>`                               | Release local resources and detach without closing the remote target.                                             |
| `close`      | `Promise<void>`                               | Close the remote target and release resources.                                                                    |

```ts
await page.navigate('https://example.com')
await page.reload()
await page.back()
await page.forward()
const heading = await page.title()
await page.click('#submit')
await page.fill('#name', 'Ada')
await page.select('#lang', ['en'])
const content = await page.content()
const result = await page.evaluate('document.title')
const shot = await page.screenshot({ full: true, type: 'png' })
const pdf = await page.pdf({ landscape: true })
const child = await page.frame('checkout') // BrowserFrameInterface | undefined
const children = await page.frames() // readonly BrowserFrameInterface[]
const snapshot = await page.snapshot({ styles: ['display'], rects: true })
await page.close()
```

#### `BrowserSnapshotInterface`

One page capture as navigable data. Its two `readonly` members — `documents`
and `styles`, inherited from the Surface `BrowserSnapshotInput` row — are the
entire serialized form; every method below derives structure from them on
demand, storing nothing that could drift. Nodes stay
plain `BrowserNode` data — passed in as arguments and handed back unwrapped —
so a snapshot survives `JSON.stringify` and comes back through
`createBrowserSnapshot`. Walks are lazy generators, so `find` stops at the
first match and `filter` stops at its limit.

| Method        | Returns                                 | Behavior                                                                                                                                                                     |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk`        | `Generator<BrowserNode, void, unknown>` | Traverse the whole capture, or one subtree when `root` is given (the root is yielded first), in `'depth'` (default) or `'breadth'` order. Each node is visited exactly once. |
| `descendants` | `Generator<BrowserNode, void, unknown>` | Traverse one node's subtree in depth-first order, excluding the node itself.                                                                                                 |
| `document`    | `BrowserDocument \| undefined`          | Resolve the captured document a node belongs to.                                                                                                                             |
| `children`    | `readonly BrowserNode[]`                | Direct children, entering a linked iframe's content document.                                                                                                                |
| `parent`      | `BrowserNode \| undefined`              | Structural parent, crossing a document boundary to the owning iframe.                                                                                                        |
| `siblings`    | `readonly BrowserNode[]`                | Structural siblings — `'preceding'` or `'following'` narrows to one side; omitting the relation returns every sibling except the node itself.                                |
| `ancestors`   | `readonly BrowserNode[]`                | Nearest-first ancestors across document and iframe boundaries.                                                                                                               |
| `common`      | `BrowserNode \| undefined`              | Nearest common ancestor of two nodes, counting each node as its own candidate.                                                                                               |
| `distance`    | `number \| undefined`                   | Structural edge count between two nodes; `undefined` when they share no ancestor.                                                                                            |
| `find`        | `BrowserNode \| undefined`              | First node matching a `BrowserNodeQuery` or a `BrowserNodePredicate`.                                                                                                        |
| `filter`      | `readonly BrowserNode[]`                | Every matching node, bounded by an optional `limit`; a negative or fractional limit throws a coded `BrowserError`.                                                           |
| `closest`     | `BrowserNode \| undefined`              | Nearest match from a node through its ancestors, testing the node first.                                                                                                     |
| `path`        | `string`                                | Deterministic frame-qualified structural path for one node.                                                                                                                  |

```ts
import type { BrowserSnapshotInput } from '@orkestrel/browser'
import { createBrowserSnapshot, matchesBrowserNode } from '@orkestrel/browser'

const captured = await page.snapshot({ styles: ['display'], rects: true })
const stored: BrowserSnapshotInput = JSON.parse(JSON.stringify(captured)) // { documents, styles }
const snapshot = createBrowserSnapshot(stored) // navigable again, same data

const main = snapshot.find({ name: 'main', visible: true }) // declarative query
const heading = snapshot.find((node) => node.name === 'H1') // predicate
const clickable = snapshot.filter({ clickable: true }, 20) // first 20 matches

if (main !== undefined && heading !== undefined) {
	snapshot.document(main)?.url // the document holding a node
	snapshot.children(main) // direct children, entering iframe content
	snapshot.parent(heading) // structural parent, iframe owner included
	snapshot.siblings(heading, 'preceding') // one structural side
	snapshot.ancestors(heading) // nearest-first, across frames
	snapshot.common(main, heading) // nearest shared ancestor
	snapshot.distance(main, heading) // structural edge count
	snapshot.closest(heading, { name: 'section' }) // self, then ancestors
	snapshot.path(heading) // frame("frame-main") > #document:0 > html:1 > ...

	const perLevel = [...snapshot.walk({ root: main, order: 'breadth' })]
	const links = [...snapshot.descendants(main)].filter((node) =>
		matchesBrowserNode(node, { name: 'a', visible: true }),
	) // subtree search: descendants + matchesBrowserNode
}
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

| Method       | Returns                                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover`   | `Promise<BrowserDiscoveryResult>`      | Passive CDP probe — does not change connection state or launch/attach anything, but emits a `discover` event with the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `connect`    | `Promise<void>`                        | Establish a connection using the strategy above (endpoint → discovery → launch). Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `adopt`      | `void`                                 | Assume responsibility for terminating the currently connected browser. This is explicit for a CDP attachment; launched browsers are owned automatically. Rejects unless a live connection supplies an endpoint to retain.                                                                                                                                                                                                                                                                                                                                                                                  |
| `disconnect` | `Promise<void>`                        | Detach the client-side transport while the remote browser keeps running. A merely attached CDP session forgets the endpoint and ownership becomes `undefined`. Every launched or explicitly adopted session retains ownership and its endpoint, so the SAME instance can reconnect and remains responsible for eventual termination. Transport loss while an owned browser remains alive is likewise resumable.                                                                                                                                                                                            |
| `context`    | `BrowserContextInterface \| undefined` | One context by index, or the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `contexts`   | `readonly BrowserContextInterface[]`   | All contexts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `isolate`    | `Promise<BrowserContextInterface>`     | Create and register an isolated CDP context with validated proxy, download, origin, and emulation options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `create`     | `Promise<BrowserPageInterface>`        | Shortcut to open a page in the default context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `destroy`    | `Promise<void>`                        | Release local resources. For a launched browser this terminates the process serving its CDP endpoint and awaits its exit — on POSIX that terminate reaches the launch's whole process group and awaits its drain, and on Windows it terminates one process by identifier, the spawned process or the one a launcher handed the endpoint to — which leaves the profile unlocked before cleanup. For an adopted attachment it sends CDP `Browser.close`. For a merely attached browser this is a LOCAL DETACH ONLY because other clients may share its targets. Idempotent.                                  |
| `close`      | `Promise<void>`                        | Graceful REMOTE shutdown: best-effort sends CDP `Browser.close` (whether attached or owned), and when owned also awaits the exit of the process serving the CDP endpoint plus its POSIX process-group drain (escalating to a kill only if needed), then closes every tracked context/page (sending remote `Target.closeTarget`/`disposeBrowserContext` regardless of ownership — unlike `destroy()`, which skips remote context/page closes on a non-owned CDP-attached browser) before releasing the CDP client. Use this to shut down a browser this instance doesn't own but wants to terminate anyway. |

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ profile: './profile', cdp: { port: 9222 } })
browser.emitter.on('connect', (mode) => log(mode))
await browser.connect()
const owned = browser.owned // true for this launched session
const page = await browser.create({ url: 'https://example.com' })
const isolated = await browser.isolate({ emulation: { locale: 'en-US' } })
const all = browser.contexts() // readonly BrowserContextInterface[]
const pid = browser.pid // number | undefined — the process serving the CDP endpoint, when this instance owns one
await browser.disconnect() // retains ownership and endpoint for this persistent launch
await browser.connect() // reconnect the same owner
await isolated.close()
await browser.destroy() // terminates and awaits the owned process
```

## Contract

These invariants hold across the browser layer (`src/core` + `src/server`) ↔ `browser.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `class` / `const` /
   `interface` / `type` / error row in the `### Core` and `### Server`
   `## Surface` tables is a real export of the browser layer (`src/core` or
   `src/server`), and every export of either appears as a Surface row —
   exhaustive, both directions.
2. **Core is environment-agnostic.** `src/core` imports only
   `@orkestrel/emitter`, `@orkestrel/contract`, and `@orkestrel/html` — no
   `node:*`, no `WebSocket`, no filesystem. `@orkestrel/html` is string → AST →
   string work with no host of its own, so `article()` distills a captured
   document without leaving core: `content()` and `article()` share ONE
   size-guarded `outerHTML` capture, and `article()` evaluates nothing else —
   no URL, no title, no body text. Every CDP method call
   and event flows through the injected `CDPTransportInterface`; core never
   assumes a runtime.
   Host-side CDP boundaries use `@orkestrel/contract` total guards for
   records, arrays, strings, finite numbers, integers, booleans, errors, and
   class instances. Synchronous JSON and URL operations cross through
   `parseJSON` or `attempt`; asynchronous `try` / `catch` remains only where
   promise rejection and transactional cleanup must be coordinated. Raw
   `typeof` and `instanceof` checks appear only inside compiled expressions
   that execute in the remote page, where host package imports are
   unavailable.
   The `browser → html` edge is one-way and stays that way: `@orkestrel/browser`
   must never become a dependency of `@orkestrel/html`. `BrowserSnapshot`
   navigates CDP DOM snapshots rather than HTML source, so it never moves into
   `@orkestrel/html`. Nor does the snapshot entity ever gain rendering,
   extraction, or distillation — `article()` on the frame is where distillation
   lives, and it is the only place it lives.
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
   (`findSystemBrowser` / `launchBrowserProcess` / `waitForCDPReady`). A
   found existing browser is preferred over a fresh launch. `engine` is
   classified via `parseBrowserEngine` (explicit `executable`) or the
   discovered `SystemBrowser`'s engine (launch) or `browserToEngine` on the
   discovered `/json/version` browser string (CDP discovery); `BrowserOptions.engine`
   narrows `findSystemBrowser` discovery to a preferred engine when launching,
   and the thrown `BrowserConnectionError` carries the requested `engine` in
   `context` when no matching browser is found; launch discovery also consults
   `BrowserOptions.browsers` candidate-source overrides when given. A
   `disconnect()` on either kind of launch retains process ownership WITHOUT
   killing it — the same instance can reconnect through the retained endpoint
   and remains responsible for termination. `BrowserCDPOptions.discover`
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
   NOT size-guarded. `article()` shares that one HTML capture and so inherits
   its guard exactly: an oversized document fails `content()` and `article()`
   identically. It does NOT inherit the body-text guard, because it never
   evaluates `innerText` — a document whose visible text alone exceeds the
   limit fails `content()` while `article()` still returns.
   The guard stringifies the in-page result and throws a
   `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` (`[[ORKESTREL_BROWSER_RESULT_LIMIT]]`)
   followed by the serialized length before an oversized result could
   overflow the CDP transport frame; `BrowserPage` recognizes that
   sentinel (`BROWSER_RESULT_LIMIT_PATTERN`) and rejects with a coded
   `BrowserResultLimitError` instead — the underlying CDP connection and
   browser process are unaffected. The crash-safety guarantee therefore
   applies to `evaluate()`, to both the HTML and text fields of `.content()`,
   and to `article()`'s HTML capture.
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
    `CDPClientInterface`, `BrowserContextInterface`, `BrowserFrameInterface`,
    `BrowserPageInterface`, `BrowserSnapshotInterface`,
    `BrowserCodegenInterface`, `BrowserInterface` — exhaustive, both
    directions, and each implementing class (`WebSocketCDPTransport`,
    `CDPClient`, `BrowserContext`, `BrowserFrame`, `BrowserPage`,
    `BrowserSnapshot`, `BrowserCodegen`, `Browser`) exposes the same public
    methods, no more. The remaining exports add no
    behavioral interface with methods (the factories, `decodeBase64` /
    `guardEvaluateExpression` / `parseCodegenActionPayload` /
    `readCodegenNavigateAction` / `compileCodegenScript` / `findSystemBrowser` /
    `launchBrowserProcess` / `waitForCDPReady` / `fetchCDPTargets` are
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
    On POSIX, each launch owns an isolated process group so Chromium
    subprocesses cannot outlive their parent and keep writing the profile.
    `destroy()` sends `SIGTERM` to the process serving the endpoint, which on
    POSIX means that process's whole group; if it has not exited or the group
    has not drained after `BROWSER_KILL_GRACE_MS`, the same target is
    force-killed with `SIGKILL` and given the same bounded exit window.
    On Windows a launch owns no process group, so each step signals one process
    by identifier. Node ignores the signal name there and terminates that
    process abruptly, so the `SIGTERM` step is already an uncatchable terminate
    and the `SIGKILL` step repeats the terminate only when the process is still
    running after the grace period. Terminating a Chromium browser process
    takes its renderer, GPU, and utility subprocesses with it, so that single
    signal drains the tree the launch created.
    `close()` instead sends CDP `Browser.close` first (best-effort, whether
    the process is owned or merely CDP-attached) and only escalates to the
    same kill sequence if an owned process fails to exit within the grace
    period — the graceful path for shutting down a browser this instance may
    not own. In the worst case an owned, unresponsive process tree makes
    `close()` apply `BROWSER_KILL_GRACE_MS` three times: after
    `Browser.close`, after `SIGTERM`, and after `SIGKILL`.
    `BrowserInterface.connected` is a pure, derived getter
    (`status === 'connected'`) — never separately tracked state.
    `BrowserInterface.owned` is `true` for a launched or explicitly adopted
    session, `false` for an active attachment, and `undefined` when no session
    is represented. `BrowserInterface.pid` is the id of the process serving the
    session's CDP endpoint; it stays readable across a `'persistent'` session's
    `disconnect()` and only becomes `undefined` after `destroy()`/`close()` or
    an observed process exit — never on `disconnect()` alone. It is
    `undefined` from the start on a plain CDP attach (`connection === 'cdp'`),
    which never owns a process.
13. **A launch owns the process that serves its endpoint, not the process it
    spawned.** Those are the same process for Chrome and Chromium, whose
    spawned process is the browser. Microsoft Edge on Windows instead
    re-executes itself with the same `--remote-debugging-port` and exits 0
    before the endpoint answers, so `connect()` treats that clean exit as a
    hand-off rather than a death: it keeps waiting for the endpoint on the same
    `timeout` budget, then reads the `browser` entry of CDP
    `SystemInfo.getProcessInfo` and owns the process named there. That process
    is what `pid` reports and what `destroy()` terminates, and the isolated
    profile is removable because nothing in the tree still holds it. The
    failure path is unchanged: a spawned process that exits with a nonzero code
    or a signal rejects immediately with a `BrowserConnectionError` naming the
    exit, a clean exit that produces no endpoint within `timeout` rejects with
    the readiness failure, and an endpoint that names no browser process
    rejects after a best-effort CDP `Browser.close`, rather than owning a
    browser it cannot terminate.
14. **A snapshot is serializable data plus navigation.** `BrowserSnapshot`
    holds exactly the two `BrowserSnapshotInput` members, so
    `JSON.stringify(snapshot)` yields `{ documents, styles }` and nothing else,
    and `createBrowserSnapshot(parsed)` turns that JSON back into a navigable
    entity whose walks and `path()` results match the original's. Navigation
    reads plain data: every method takes and returns bare `BrowserNode` values,
    never a wrapper node entity, and the constructor copies and freezes both
    arrays so a caller's later mutation cannot reach the snapshot. Containment
    is derived, not declared — a node contains a candidate exactly when
    `snapshot.ancestors(candidate)` includes it — so no membership flag or
    `contains`-style member can drift from the ancestry walk.

## Patterns

### Automate a page end-to-end

```ts
import { createBrowser } from '@orkestrel/browser/server'

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
import { createBrowser } from '@orkestrel/browser/server'

const port = 9222
const browser = createBrowser({ profile: './profile', cdp: { port } })
await browser.connect() // launches (no browser yet listening on `port`)
const pid = browser.pid // supervise this process externally if desired

await browser.disconnect() // retains ownership WITHOUT killing the browser

// ...later, in this process or another...
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP
const urls = reattached
	.context()
	?.pages()
	.map((page) => page.url) // correct immediately, no navigate()/content() needed
await reattached.destroy() // LOCAL DETACH ONLY — the browser process keeps running
await browser.destroy() // the original owner terminates and awaits its process
```

An ephemeral launch (no `profile`) can also disconnect and reconnect while its
owning `Browser` instance and process remain alive. A transport-loss disconnect
is likewise resumable — the SAME `browser` instance can `connect()` again
without a fresh `createBrowser()`.

When the original owner is unavailable, a connected CDP client can explicitly
assume responsibility before disconnecting. Ownership is state, not a string
mode: `owned` is `true` for launched/adopted sessions, `false` for an active
attachment, and `undefined` when no session is represented.

```ts
const browser = createBrowser({ cdp: { port } })
await browser.connect()
browser.adopt()
await browser.disconnect()
await browser.connect()
await browser.destroy() // closes the adopted remote browser
```

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
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport: myTransport })
await client.connect()

const result = await client.send('Page.navigate', { url: 'https://example.com' })
client.subscribe('Page.frameNavigated', (params) => log(params))

await client.close()
```
