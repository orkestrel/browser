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
> filesystem-backed browser writer. Source:
> [`src/core`](../src/core) (through `@src/core`) +
> [`src/server`](../src/server) (through `@src/server`).

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
| `BrowserCodegen`  | class | Records page interactions (navigate/click/fill/select) through CDP bindings, for later compilation into a replayable script.              |
| `BrowserSnapshot` | class | A navigable, serializable capture of every attached document — walking, structural relationships, search, and paths over plain node data. |

#### Constants

| Constant                               | Kind  | Value                                                                                                                                                                                                                                             |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DEFAULT_TIMEOUT_MS`           | const | `30000` — default timeout for connection, requests, and navigation.                                                                                                                                                                               |
| `BROWSER_WAIT_POLL_INTERVAL_MS`        | const | `100` — the interval (ms) every in-page DOM wait polls at, the slack a wait adds to its own CDP call timeout, and the delay between host-side CDP readiness probes.                                                                               |
| `BROWSER_DEFAULT_VIEWPORT_WIDTH`       | const | `1280` — default viewport width in pixels.                                                                                                                                                                                                        |
| `BROWSER_DEFAULT_VIEWPORT_HEIGHT`      | const | `720` — default viewport height in pixels.                                                                                                                                                                                                        |
| `BROWSER_CODEGEN_BINDING_NAME`         | const | `'__orkestrelBrowserCodegen'` — name of the CDP runtime binding the recorder script calls.                                                                                                                                                        |
| `BROWSER_CODEGEN_SOURCE`               | const | The in-page recorder script source injected through CDP to capture click/fill/select actions (a `contenteditable` fill is captured through `input` events same as inputs/textareas).                                                              |
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

| API                                | Kind     | Summary                                                                                                                                                                                            |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeBase64`                     | function | Decode a base64-encoded string into raw bytes (pure JS, no `Buffer`/`atob` — runs identically Node/browser).                                                                                       |
| `compileGuardedEvaluateExpression` | function | Compile a `Runtime.evaluate` expression so the in-page code stringifies its own result and throws a recognizable sentinel error before an oversized result would overflow the CDP transport frame. |
| `normalizeCodegenActions`          | function | Collapse consecutive `fill` actions on the same selector into the latest value.                                                                                                                    |
| `parseCodegenActionPayload`        | function | Coerce a codegen binding payload string to a `BrowserCodegenAction`, or `undefined` off-shape.                                                                                                     |
| `parseCodegenNavigateAction`       | function | Coerce a `Page.frameNavigated` CDP event to a `navigate` codegen action, or `undefined` off-shape and for every frame but the top-level one.                                                       |
| `compileCodegenScript`             | function | Compile recorded codegen actions into a replayable JavaScript or TypeScript script.                                                                                                                |
| `readEvaluationResult`             | function | Read a `Runtime.evaluate` result. Throws a `BrowserError` on a failed evaluation, and a `BrowserResultLimitError` past the guarded result size.                                                    |
| `requireBrowserString`             | function | Narrow a browser-evaluated value to a required string.                                                                                                                                             |
| `readBrowserFrames`                | function | Read `Page.getFrameTree` into depth-first frame metadata, skipping every off-shape frame.                                                                                                          |
| `compileAttachedWaitExpression`    | function | Compile an in-page attached-state wait.                                                                                                                                                            |
| `compileDetachedWaitExpression`    | function | Compile an in-page detached-state wait.                                                                                                                                                            |
| `compileVisibleWaitExpression`     | function | Compile an in-page visible-state wait.                                                                                                                                                             |
| `compileHiddenWaitExpression`      | function | Compile an in-page hidden-state wait.                                                                                                                                                              |
| `compileClickExpression`           | function | Compile a strict, visibility-checked click expression.                                                                                                                                             |
| `compileFillExpression`            | function | Compile a strict, editable fill expression.                                                                                                                                                        |
| `compileSelectExpression`          | function | Compile a strict select expression.                                                                                                                                                                |
| `parseNumberArray`                 | function | Coerce an unknown protocol value to an all-number array, or `undefined` off-shape.                                                                                                                 |
| `parseSnapshotString`              | function | Coerce one DOMSnapshot string-table index to its string, or `undefined` off-shape.                                                                                                                 |
| `readRareStringData`               | function | Read sparse CDP string data into a node-index map, skipping every off-shape entry.                                                                                                                 |
| `readRareBooleanData`              | function | Read sparse CDP boolean indexes into a set, skipping every off-shape entry.                                                                                                                        |
| `readRareIntegerData`              | function | Read sparse CDP integer data into a node-index map, skipping every off-shape entry.                                                                                                                |
| `parseBrowserRect`                 | function | Coerce a four-number CSS-pixel rectangle to a `BrowserRect`, or `undefined` off-shape.                                                                                                             |
| `readBrowserAttributes`            | function | Read flattened name/value indexes into a frozen attribute record, skipping every off-shape pair.                                                                                                   |
| `readBrowserSnapshot`              | function | Read a `DOMSnapshot.captureSnapshot` response into a serializable `BrowserSnapshotInput`. Throws a `BrowserError` off-shape, and a `BrowserResultLimitError` past the configured node limit.       |
| `isBrowserNodeQuery`               | function | Test whether a browser-node matcher is a declarative query rather than a predicate.                                                                                                                |
| `matchesBrowserNode`               | function | Match a node against a declarative query.                                                                                                                                                          |
| `isBrowserNodeVisible`             | function | Test whether a node has a non-empty captured layout box.                                                                                                                                           |

```ts
import {
	compileGuardedEvaluateExpression,
	normalizeCodegenActions,
	parseCodegenActionPayload,
	parseCodegenNavigateAction,
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
	parseNumberArray,
	parseSnapshotString,
	readRareStringData,
	readRareBooleanData,
	readRareIntegerData,
	parseBrowserRect,
	readBrowserAttributes,
	readBrowserSnapshot,
	matchesBrowserNode,
	isBrowserNodeVisible,
} from '@orkestrel/browser'

const guarded = compileGuardedEvaluateExpression('document.title', 3_000_000) // wrapped expression string
const actions = normalizeCodegenActions(rawActions)
const action = parseCodegenActionPayload(payload) // BrowserCodegenAction | undefined
const navigate = parseCodegenNavigateAction(frameNavigatedParams)
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
const numbers = parseNumberArray([1, 2, 3])
const text = parseSnapshotString(snapshotStrings, 1)
const rareStrings = readRareStringData(rawRareStrings, snapshotStrings)
const rareBooleans = readRareBooleanData(rawRareBooleans)
const rareIntegers = readRareIntegerData(rawRareIntegers)
const rect = parseBrowserRect([0, 0, 100, 40])
const attributes = readBrowserAttributes(rawAttributes, snapshotStrings)
const decoded = readBrowserSnapshot(rawSnapshot, ['display']) // BrowserSnapshotInput
const node = decoded.documents[0].nodes[0]
const id = node.attributes['id']
const article = matchesBrowserNode(node, { name: 'article', visible: true })
const rendered = isBrowserNodeVisible(node)
```

Navigating decoded data is the `BrowserSnapshot` entity's job, not a helper
family's — see [`BrowserSnapshotInterface`](#browsersnapshotinterface) below.

#### Types

| Type                          | Kind      | Shape                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPTransportEventMap`        | type      | `{ message: [data: string]; close: []; error: [error: unknown] }` — the transport's observable surface.                                                                                                                                                                                  |
| `CDPTransportInterface`       | interface | `emitter` data member + `start` / `send` / `close` methods — the dumb text pipe a `CDPClientInterface` sends/receives JSON-RPC frames over.                                                                                                                                              |
| `CDPClientOptions`            | interface | `{ transport: CDPTransportInterface; timeout?: number; on?: EmitterHooks<CDPClientEventMap>; error?: EmitterErrorHandler }` — options for `createCDPClient`; `error` receives a subscriber throw with the CDP event method, or with the lifecycle event name for a lifecycle subscriber. |
| `CDPHandler`                  | type      | `(params: Readonly<Record<string, unknown>>) => void` — handler invoked for a subscribed CDP event.                                                                                                                                                                                      |
| `CDPClientEventMap`           | type      | `{ connect: []; close: []; drop: []; error: [error: unknown] }` — the client's own connection lifecycle.                                                                                                                                                                                 |
| `CDPTarget`                   | interface | `{ id: string; category: string; title: string; url: string }` — one entry of the CDP `Target.getTargets` result; `category` mirrors the protocol's `type` field.                                                                                                                        |
| `CDPClientInterface`          | interface | `emitter` / `connected` data members + `connect` / `reconnect` / `send` / `subscribe` / `unsubscribe` / `close` methods (`send` takes a trailing `CDPSendOptions`).                                                                                                                      |
| `CDPSendOptions`              | interface | `{ session?: string; timeout?: number }` — options for one CDP method call.                                                                                                                                                                                                              |
| `BrowserWriterInterface`      | interface | `write(path, data)` — pluggable sink for persisting captured browser bytes to a path; core never touches a filesystem directly.                                                                                                                                                          |
| `BrowserViewport`             | interface | `{ width: number; height: number }` — viewport dimensions for a browser page.                                                                                                                                                                                                            |
| `BrowserWaitUntil`            | type      | `'commit' \| 'load' \| 'domcontentloaded'` — page load condition for navigation (the CDP load event `navigate()` awaits).                                                                                                                                                                |
| `BrowserPageOptions`          | interface | `{ on?; error?; url?; viewport?; timeout? }` — options for creating a browser page.                                                                                                                                                                                                      |
| `BrowserNavigationOptions`    | interface | `{ condition?: BrowserWaitUntil; timeout? }` — options for page navigation (default `'load'`).                                                                                                                                                                                           |
| `BrowserActionOptions`        | interface | `{ timeout?; strict?; force?; trial? }` — options for strict-by-default element interaction.                                                                                                                                                                                             |
| `BrowserWaitState`            | type      | `'attached' \| 'detached' \| 'visible' \| 'hidden'` — selector state awaited by a frame.                                                                                                                                                                                                 |
| `BrowserWaitOptions`          | interface | `{ timeout?; strict?; state? }` — options for selector-state waits.                                                                                                                                                                                                                      |
| `BrowserScreenshotOptions`    | interface | `{ path?; full?; format?: 'png' \| 'jpeg'; quality? }` — options for taking a page screenshot.                                                                                                                                                                                           |
| `BrowserContentResult`        | interface | `{ url: string; title: string; html: string; text: string }` — result of page content extraction.                                                                                                                                                                                        |
| `BrowserScreenshotResult`     | interface | `{ bytes: Uint8Array; path: string \| undefined }` — result of a page screenshot.                                                                                                                                                                                                        |
| `BrowserCodegenAction`        | type      | Discriminated union — `navigate` / `click` / `fill` / `select` — one recorded browser action.                                                                                                                                                                                            |
| `BrowserCodegenEventMap`      | type      | `{ start: []; stop: [actions]; action: [action]; clear: [] }` — the observable surface of a `BrowserCodegenInterface`.                                                                                                                                                                   |
| `BrowserCodegenOptions`       | interface | `{ on?: EmitterHooks<BrowserCodegenEventMap>; error?: EmitterErrorHandler }` — options for creating a BrowserCodegen recorder.                                                                                                                                                           |
| `BrowserCodegenLanguage`      | type      | `'javascript' \| 'typescript'` — target language for a compiled codegen script.                                                                                                                                                                                                          |
| `BrowserCodegenScriptOptions` | interface | `{ language?: BrowserCodegenLanguage }` — options for compiling recorded actions into a script (default `'javascript'`).                                                                                                                                                                 |
| `BrowserCodegenInterface`     | interface | `emitter` / `started` data members + `start` / `stop` / `actions` / `script` / `clear` / `destroy` methods.                                                                                                                                                                              |
| `BrowserSessionFunction`      | type      | `(frame: string) => Promise<string>` — resolves the current CDP target session for a frame.                                                                                                                                                                                              |
| `BrowserFrameInfo`            | interface | Serializable `id` / `parent` / `name` / `url` metadata decoded from `Page.getFrameTree`.                                                                                                                                                                                                 |
| `BrowserFrameInterface`       | interface | Frame metadata plus title/content/actions/evaluation/waiting, usability assertion, observed-URL recording, and raw frame-session CDP access.                                                                                                                                             |
| `BrowserSendOptions`          | interface | `{ timeout?: number }` — options for one raw CDP call in a frame's target session.                                                                                                                                                                                                       |
| `BrowserRect`                 | type      | Readonly `[x, y, width, height]` CSS-pixel tuple.                                                                                                                                                                                                                                        |
| `BrowserLayout`               | interface | Optional layout box, computed styles, text, paint order, and DOM rectangles for a snapshot node.                                                                                                                                                                                         |
| `BrowserNode`                 | interface | One flattened serializable DOM node, including attributes, sparse state, frame identity, layout, and the `category` that mirrors the DOM `nodeType`.                                                                                                                                     |
| `BrowserDocument`             | interface | One captured document with frame metadata, dimensions, and nodes.                                                                                                                                                                                                                        |
| `BrowserSnapshotInput`        | interface | `{ documents; styles }` — every captured document plus the requested computed-style names; the serializable form a `BrowserSnapshot` is built from and serializes back to.                                                                                                               |
| `BrowserWalkOrder`            | type      | `'depth' \| 'breadth'` — structural ordering for a snapshot walk.                                                                                                                                                                                                                        |
| `BrowserWalkOptions`          | interface | `{ root?; order? }` — optional subtree root (included in the walk) and traversal order (default `'depth'`).                                                                                                                                                                              |
| `BrowserSiblingRelation`      | type      | `'preceding' \| 'following'` — structural sibling side relative to a node.                                                                                                                                                                                                               |
| `BrowserSnapshotInterface`    | interface | Extends `BrowserSnapshotInput`; adds walking, structural relationships, search, and path derivation over plain `BrowserNode` values.                                                                                                                                                     |
| `BrowserSnapshotOptions`      | interface | `{ styles?; paint?; rects?; limit? }` — DOM snapshot capture and decoding controls.                                                                                                                                                                                                      |
| `BrowserNodePredicate`        | type      | `(node: BrowserNode) => boolean` — traversal/search predicate.                                                                                                                                                                                                                           |
| `BrowserNodeQuery`            | interface | Declarative name/text/attribute/frame/visibility/clickability matcher.                                                                                                                                                                                                                   |
| `BrowserPageInterface`        | interface | Extends `BrowserFrameInterface`; adds `closed` plus navigation, screenshots, frame discovery, DOM snapshots, codegen, and target teardown.                                                                                                                                               |
| `BrowserContextInterface`     | interface | `emitter` / `id` / `cookies` / `permissions` / `storage` / `emulation` data members + `page` / `pages` / `create` / `sync` / `destroy` / `close` methods.                                                                                                                                |

### Server

Server-side connection lifecycle — discover an already-running browser through
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

| API                   | Kind     | Summary                                                                                             |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `createBrowser`       | function | Create a raw-CDP `BrowserInterface` façade with discovery, connection, and lifecycle management.    |
| `createCDPTransport`  | function | Create a Node `WebSocket`-backed `CDPTransportInterface` for the given CDP debugger URL.            |
| `createBrowserWriter` | function | Create a filesystem-backed `BrowserWriterInterface` that persists bytes through `node:fs/promises`. |

#### Entities

| API                     | Kind  | Summary                                                                                                     |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `Browser`               | class | Browser wrapper with discovery, connection management, and lifecycle control (discover → connect → launch). |
| `WebSocketCDPTransport` | class | Node `WebSocket`-backed `CDPTransportInterface` — connects to a CDP WebSocket debugger URL.                 |
| `FileBrowserWriter`     | class | Filesystem-backed `BrowserWriterInterface` — persists captured bytes, creating missing parent directories.  |

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
| `BROWSER_PORT_PROBE_TIMEOUT_MS`   | const | `200` — bound for the `discover: false` port-occupancy probe before launching (short — it only needs to detect an already-listening CDP endpoint).                                                                     |
| `BROWSER_TRANSPORT_LOSS_DEFER_MS` | const | `50` — brief defer applied once when a transport loss is observed on an owned process, giving a near-simultaneous process-exit event first say over the diagnosis.                                                     |
| `BROWSER_PROCESS_EXIT_CAUSE`      | const | `'process-exit'` — machine-readable error-context cause for an owned browser process exiting.                                                                                                                          |
| `BROWSER_TRANSPORT_LOSS_CAUSE`    | const | `'transport-loss'` — machine-readable error-context cause for CDP transport loss while the browser remains alive.                                                                                                      |
| `BROWSER_ENV_PATH_KEYS`           | const | Frozen list of env vars checked (in order) for an explicit browser executable path override (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`).                                                                             |
| `BROWSER_EXECUTABLE_PATHS`        | const | Frozen record of well-known Chrome/Chromium/Edge paths with no platform-specific root, keyed by `process.platform` (win32 is empty — see `BROWSER_WINDOWS_SUFFIXES`).                                                  |
| `BROWSER_WINDOWS_SUFFIXES`        | const | Frozen list of Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root.                                                                                                    |
| `BROWSER_WINDOWS_ROOT_FALLBACKS`  | const | Frozen record of fallback Windows install roots used when `PROGRAMFILES` / `PROGRAMFILES(X86)` are unset.                                                                                                              |
| `BROWSER_EXECUTABLE_NAMES`        | const | Frozen list of command names probed on PATH when no well-known executable path exists.                                                                                                                                 |
| `BROWSER_STORE_ENV_KEY`           | const | `'PLAYWRIGHT_BROWSERS_PATH'` — env var naming an additional Playwright browser store base directory.                                                                                                                   |
| `BROWSER_STORE_DEFAULT_DIRS`      | const | Frozen list of well-known Playwright browser store base directories (for example `/opt/pw-browsers`).                                                                                                                  |
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
| `findEnvOverrides`        | function | Check the env-override keys in order, returning every one that exists.                                                                                                                                                                                                                                                                                         |
| `buildInstallPaths`       | function | Build the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                                                                                                                                                                                                                                     |
| `buildWindowsRoots`       | function | Derive Windows install roots from env vars, falling back to well-known literals when absent.                                                                                                                                                                                                                                                                   |
| `findInstallPaths`        | function | Return every candidate path that exists on disk, in the given order.                                                                                                                                                                                                                                                                                           |
| `probePathNames`          | function | Probe PATH for every resolvable command name, in the given order.                                                                                                                                                                                                                                                                                              |
| `readFirstLine`           | function | Return the first non-empty line of a command's output without its surrounding whitespace, so a `where` match on Windows keeps no trailing carriage return; may return `undefined`.                                                                                                                                                                             |
| `buildStoreBases`         | function | Build the default Playwright browser store base directories to search for a managed Chromium.                                                                                                                                                                                                                                                                  |
| `findStorePaths`          | function | Search one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first.                                                                                                                                                                                                                                                |
| `launchBrowserProcess`    | function | Launch a browser process with raw-CDP debugging flags; a POSIX launch is detached into its own process group so teardown reaches every Chromium subprocess, and a Windows launch is not detached so teardown signals one process by identifier — the spawned process, or the one the launcher handed the endpoint to. Returns the spawned `ChildProcess`.      |
| `waitForCDPReady`         | function | Poll a browser's CDP version endpoint until it responds or the timeout elapses; returns the debugger URL.                                                                                                                                                                                                                                                      |
| `fetchCDPTargets`         | function | Fetch and normalize the current CDP target list from a browser's `/json/list` endpoint, as a `Result` carrying either the targets or a coded `BrowserConnectionError`.                                                                                                                                                                                         |

```ts
import {
	createCDPTransport,
	createBrowserWriter,
	findSystemBrowsers,
	findSystemBrowser,
	parseBrowserEngine,
	normalizeExecutablePath,
	browserToEngine,
	createBrowserProfile,
	removeBrowserProfile,
	findEnvOverrides,
	buildInstallPaths,
	buildWindowsRoots,
	findInstallPaths,
	probePathNames,
	readFirstLine,
	buildStoreBases,
	findStorePaths,
	launchBrowserProcess,
	waitForCDPReady,
	fetchCDPTargets,
} from '@orkestrel/browser/server'

const transport = createCDPTransport({ url: 'ws://localhost:9222/devtools/browser/abc' })
const writer = createBrowserWriter()

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
findEnvOverrides(env) // readonly string[] — every matching override that exists
const roots = buildWindowsRoots(env) // readonly string[] — PROGRAMFILES / PROGRAMFILES(X86) / LOCALAPPDATA
buildInstallPaths('win32', env) // readonly string[] — well-known Chrome/Edge/Chromium paths
findInstallPaths(buildInstallPaths(process.platform, env)) // readonly string[]
probePathNames(['google-chrome', 'msedge'], process.platform) // readonly string[]
readFirstLine('C:\\bin\\chrome.exe\r\nC:\\other\\chrome.exe\r\n') // 'C:\\bin\\chrome.exe' — CRLF-safe
const stores = buildStoreBases(env, process.platform) // readonly string[]
for (const store of stores) findStorePaths(store, process.platform) // readonly string[]
if (found !== undefined) {
	const child = launchBrowserProcess(found.executable, 9222, true)
	const debuggerUrl = await waitForCDPReady(9222, 5000)
	const targets = await fetchCDPTargets(9222, 5000) // Result<readonly CDPTarget[], BrowserError>
}
```

#### Types

| Type                           | Kind      | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserEngine`                | type      | `'chromium' \| 'chrome' \| 'edge'` — the supported browser engines (raw CDP targets Chromium-family browsers only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BrowserConnection`            | type      | `'cdp' \| 'launch' \| 'persistent'` — how the browser connection was established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `BrowserStatus`                | type      | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error'` — lifecycle status of a browser wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `BrowserDiscoveryResult`       | interface | `{ endpoint: string \| undefined; browser: string \| undefined }` — result of passive browser discovery; a defined `endpoint` is the whole answer.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SystemBrowserOptions`         | interface | `{ env?; paths?; names?; stores?; engine? }` — overrides for `findSystemBrowsers`'s candidate sources (env-override keys/Windows roots, install paths, PATH-probe names, Playwright store base dirs) plus an engine filter; each field replaces its category's default, an explicit `[]`/`{}` disables it.                                                                                                                                                                                                                                                                               |
| `SystemBrowser`                | type      | `{ executable: string; engine: BrowserEngine }` — one discovered browser executable, as returned by `findSystemBrowsers`/`findSystemBrowser`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `BrowserProfileResult`         | interface | `{ path: string; temporary: boolean }` — resolved launch profile and its ownership state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BrowserCDPOptions`            | interface | `{ port?: number; host?: string; endpoint?: string; discover?: boolean }` — CDP connection configuration (`host` defaults to `BROWSER_DEFAULT_HOST`; `discover` defaults to `true` — `false` skips passive discovery, probes the port, and rejects if something is already listening there instead of silently attaching to it).                                                                                                                                                                                                                                                         |
| `BrowserEventMap`              | type      | `{ idle: []; discover: [result]; connect: [connection]; disconnect: []; launch: [engine]; page: [page]; context: [context]; error: [error]; destroy: [] }`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `BrowserOptions`               | interface | `{ on?; error?; headless?; executable?; profile?; cdp?; timeout?; viewport?; signal?; args?; engine?; browsers? }` — options for `createBrowser` (`engine` prefers a browser engine for discovery when launching; ignored once `connect()` launches a process — before that, the `engine` getter may still reflect the supplied `engine` option even if `executable` is also set; `browsers` supplies `SystemBrowserOptions` candidate-source overrides consulted when launch discovery runs, ignored when `executable` is given, and `engine` takes precedence over `browsers.engine`). |
| `BrowserInterface`             | interface | `emitter` / `engine` / `status` / `connection` / `owned` / `pid` data members + `discover` / `connect` / `adopt` / `disconnect` / `context` / `contexts` / `isolate` / `create` / `destroy` / `close` methods.                                                                                                                                                                                                                                                                                                                                                                           |
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
| `BROWSER_VISIBILITY_SOURCE`    | const | In-page visibility predicate source shared by every compiler.      |
| `BrowserAccessibility`         | class | Accessibility-domain snapshot reader.                              |
| `BrowserClock`                 | class | Chromium virtual-time lifecycle.                                   |
| `BrowserCookieManager`         | class | Context-scoped cookie manager.                                     |
| `BrowserCoverage`              | class | JavaScript and CSS coverage lifecycle.                             |
| `BrowserDiagnostics`           | class | Tracing, coverage, and performance composition root.               |
| `BrowserEmulationManager`      | class | Context-inherited Chromium emulation overrides.                    |
| `BrowserHARManager`            | class | HAR 1.2 recording, persistence, and replay.                        |
| `BrowserKeyboard`              | class | Trusted Chromium keyboard input.                                   |
| `BrowserLocator`               | class | Strict, reusable, shadow-aware locator.                            |
| `BrowserMouse`                 | class | Trusted Chromium mouse input.                                      |
| `BrowserNavigationManager`     | class | URL/function waits and navigation-response observation.            |
| `BrowserNetworkManager`        | class | Network observation, bodies, interception, auth, HAR, and sockets. |
| `BrowserPerformance`           | class | Performance-domain metrics reader.                                 |
| `BrowserPermissionManager`     | class | Context permission overrides.                                      |
| `BrowserProfiler`              | class | Sampled CPU-profile lifecycle.                                     |
| `BrowserScriptManager`         | class | Init scripts and host bindings.                                    |
| `BrowserSelectorManager`       | class | CSS and semantic locator factory.                                  |
| `BrowserStorageManager`        | class | Cookie and web-storage state import/export.                        |
| `BrowserTouch`                 | class | Trusted Chromium touch input.                                      |
| `BrowserTracing`               | class | Trace stream capture and persistence.                              |
| `BrowserTransition`            | class | One asynchronous transition shared by every caller that joins it.  |
| `BrowserWebSocket`             | class | Observable WebSocket lifecycle.                                    |

#### Extended helpers

| API                                      | Kind     | Summary                                                                                                                                                               |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browserHARHeadersToRecord`              | function | Convert HAR header entries to a Fetch header record.                                                                                                                  |
| `browserHeadersToProtocol`               | function | Convert a header record to CDP name/value entries.                                                                                                                    |
| `browserPDFToParams`                     | function | Validate and compile PDF options to CDP parameters.                                                                                                                   |
| `browserScreenshotToParams`              | function | Validate and compile screenshot options to CDP parameters.                                                                                                            |
| `bytesToText`                            | function | Decode UTF-8 bytes.                                                                                                                                                   |
| `compileActionabilityFunction`           | function | Compile element actionability checks for a remote handle.                                                                                                             |
| `compileAttachedLocatorWaitExpression`   | function | Compile a strict locator attached-state wait.                                                                                                                         |
| `compileBrowserBindingCleanup`           | function | Compile host-binding cleanup in a page.                                                                                                                               |
| `compileBrowserBindingResult`            | function | Compile host-binding settlement in a page.                                                                                                                            |
| `compileBrowserBindingSource`            | function | Compile a page-side host-binding facade.                                                                                                                              |
| `compileDetachedLocatorWaitExpression`   | function | Compile a strict locator detached-state wait.                                                                                                                         |
| `compileFunctionWaitExpression`          | function | Compile an auto-retrying page predicate.                                                                                                                              |
| `compileHiddenLocatorWaitExpression`     | function | Compile a strict locator hidden-state wait.                                                                                                                           |
| `compileLocatorExpression`               | function | Compile a query that returns its first element.                                                                                                                       |
| `compileLocatorListExpression`           | function | Compile a deep, open-shadow-aware semantic query.                                                                                                                     |
| `compileScreenshotCleanupExpression`     | function | Compile cleanup for temporary screenshot styles.                                                                                                                      |
| `compileScreenshotPreparationExpression` | function | Compile screenshot masking, caret, and animation preparation.                                                                                                         |
| `compileStorageClearExpression`          | function | Compile origin storage clearing.                                                                                                                                      |
| `compileStorageReadExpression`           | function | Compile origin storage extraction.                                                                                                                                    |
| `compileStorageRestoreExpression`        | function | Compile origin storage restoration.                                                                                                                                   |
| `compileVisibleLocatorWaitExpression`    | function | Compile a strict locator visible-state wait.                                                                                                                          |
| `computeBrowserButtons`                  | function | Compute the current Chromium mouse button bit mask.                                                                                                                   |
| `computeBrowserModifiers`                | function | Compute Chromium keyboard modifier bits.                                                                                                                              |
| `concatBytes`                            | function | Concatenate byte chunks without a runtime-specific buffer.                                                                                                            |
| `cookieToProtocol`                       | function | Validate and project a public cookie into CDP input.                                                                                                                  |
| `createBrowserHAREntry`                  | function | Build one standards-shaped HAR 1.2 exchange entry.                                                                                                                    |
| `encodeBase64`                           | function | Encode bytes as base64 without Node or DOM globals.                                                                                                                   |
| `extractBrowserChord`                    | function | Extract a keyboard chord such as `Control+Shift+P` into canonical modifiers and a terminal key. Throws a `BrowserError` on an empty chord or an unsupported modifier. |
| `keyToBrowserInput`                      | function | Normalize a key token to Chromium input metadata.                                                                                                                     |
| `matchesBrowserCookieURL`                | function | Match a cookie against a URL using domain/path/security rules.                                                                                                        |
| `matchesBrowserRoute`                    | function | Match an observed request against route criteria.                                                                                                                     |
| `matchesBrowserURL`                      | function | Match a URL against the supported `*`/`**` glob grammar.                                                                                                              |
| `mediaToFeatures`                        | function | Project public media options to Chromium feature entries.                                                                                                             |
| `parseBrowserAXString`                   | function | Coerce a string-valued Accessibility AXValue to a string, or `undefined` off-shape.                                                                                   |
| `parseBrowserBindingCall`                | function | Coerce a Runtime binding invocation to a `BrowserBindingCall`, or `undefined` off-shape.                                                                              |
| `parseBrowserConsoleMessage`             | function | Coerce a `Runtime.consoleAPICalled` event to a `BrowserConsoleMessage`, or `undefined` off-shape.                                                                     |
| `parseBrowserCookiePartition`            | function | Coerce a cookie partition key to a `BrowserCookiePartition`, or `undefined` off-shape.                                                                                |
| `parseBrowserDownloadProgress`           | function | Coerce a `Browser.downloadProgress` event to a `BrowserDownloadProgress`, or `undefined` off-shape.                                                                   |
| `parseBrowserDownloadStart`              | function | Coerce a `Browser.downloadWillBegin` event to a `BrowserDownloadStart`, or `undefined` off-shape.                                                                     |
| `parseBrowserPageError`                  | function | Coerce a `Runtime.exceptionThrown` event to a `BrowserPageError`, or `undefined` off-shape.                                                                           |
| `parseBrowserRequest`                    | function | Coerce a `Network.requestWillBeSent` or `Fetch.requestPaused` event to a `BrowserRequest`, or `undefined` off-shape.                                                  |
| `parseBrowserRequestFailure`             | function | Coerce a `Network.loadingFailed` event to a `BrowserRequestFailure`, or `undefined` off-shape.                                                                        |
| `parseBrowserResponse`                   | function | Coerce a `Network.responseReceived` event to a `BrowserResponse`, or `undefined` off-shape.                                                                           |
| `parseBrowserResponseRecord`             | function | Coerce a Chromium response object plus its event identity to a `BrowserResponse`, or `undefined` off-shape.                                                           |
| `parseBrowserSecurity`                   | function | Coerce Chromium TLS security details to a `BrowserSecurity`, or `undefined` off-shape.                                                                                |
| `parseBrowserTiming`                     | function | Coerce Chromium response timing to a `BrowserTiming`, or `undefined` off-shape.                                                                                       |
| `parseBrowserTimingRange`                | function | Coerce one named start/end pair of Chromium network timing to a `BrowserTimingRange`, or `undefined` off-shape.                                                       |
| `parseBrowserWebSocketFrame`             | function | Coerce a WebSocket frame event to a `BrowserWebSocketFrame`, or `undefined` off-shape.                                                                                |
| `readBrowserAXValue`                     | function | Read the underlying value of an Accessibility AXValue, `undefined` when the record carries none.                                                                      |
| `readBrowserAccessibility`               | function | Read an `Accessibility.getFullAXTree` response into a snapshot. Throws a `BrowserError` off-shape.                                                                    |
| `readBrowserCookie`                      | function | Read one Chromium cookie. Throws a `BrowserError` off-shape.                                                                                                          |
| `readBrowserCookies`                     | function | Read a `Network.getCookies` response into cookies. Throws a `BrowserError` off-shape.                                                                                 |
| `readBrowserCoverageRanges`              | function | Read and normalize coverage ranges. Throws a `BrowserError` off-shape.                                                                                                |
| `readBrowserHeaders`                     | function | Read a Chromium Headers object into string values, skipping every entry that is neither a string nor a finite number.                                                 |
| `readBrowserMetrics`                     | function | Read Performance-domain metrics. Throws a `BrowserError` off-shape.                                                                                                   |
| `readBrowserProfile`                     | function | Read a sampled CPU profile. Throws a `BrowserError` off-shape.                                                                                                        |
| `readBrowserProfileFrame`                | function | Read one CPU-profile call frame. Throws a `BrowserError` off-shape.                                                                                                   |
| `readBrowserQuad`                        | function | Read the first `DOM.getContentQuads` quad and its center. Throws a `BrowserError` off-shape.                                                                          |
| `readBrowserRemoteValue`                 | function | Read a Runtime remote value, falling back to its unserializable form and its description, `undefined` when it carries none.                                           |
| `readBrowserScriptCoverage`              | function | Read JavaScript coverage. Throws a `BrowserError` off-shape.                                                                                                          |
| `readBrowserScriptIdentifier`            | function | Read an installed init-script identifier. Throws a `BrowserError` off-shape.                                                                                          |
| `readBrowserStack`                       | function | Read a Chromium runtime stack trace, skipping every off-shape call frame.                                                                                             |
| `readBrowserStorageEntries`              | function | Read origin storage entries. Throws a `BrowserError` off-shape.                                                                                                       |
| `readBrowserStorageOrigin`               | function | Read an origin storage result. Throws a `BrowserError` off-shape.                                                                                                     |
| `readBrowserStreamChunk`                 | function | Read one `IO.read` response. Throws a `BrowserError` off-shape.                                                                                                       |
| `readBrowserStyleCoverage`               | function | Read CSS coverage. Throws a `BrowserError` off-shape.                                                                                                                 |
| `settleBrowserTeardown`                  | function | Run teardown steps to settlement and return the first failure.                                                                                                        |
| `textToBytes`                            | function | Encode UTF-8 text.                                                                                                                                                    |
| `validateBrowserAccessibilityOptions`    | function | Validate accessibility snapshot bounds.                                                                                                                               |
| `validateBrowserContextOptions`          | function | Validate isolated-context configuration before CDP mutation.                                                                                                          |
| `validateBrowserEmulationOptions`        | function | Validate emulation configuration before partial application.                                                                                                          |
| `validateBrowserHAR`                     | function | Validate the HAR 1.2 fields required for replay.                                                                                                                      |
| `validateBrowserInputOptions`            | function | Validate the bounded delay, count, steps, and position of one trusted-input operation.                                                                                |
| `validateBrowserPoint`                   | function | Validate finite viewport coordinates.                                                                                                                                 |
| `validateBrowserRange`                   | function | Validate an optional finite numeric range.                                                                                                                            |
| `validateBrowserTimeout`                 | function | Validate a non-negative finite timeout.                                                                                                                               |
| `validateBrowserViewport`                | function | Validate dimensions and device scale.                                                                                                                                 |

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
	extractBrowserChord,
	keyToBrowserInput,
	matchesBrowserCookieURL,
	matchesBrowserRoute,
	matchesBrowserURL,
	mediaToFeatures,
	parseBrowserAXString,
	parseBrowserBindingCall,
	parseBrowserConsoleMessage,
	parseBrowserCookiePartition,
	parseBrowserDownloadProgress,
	parseBrowserDownloadStart,
	parseBrowserPageError,
	parseBrowserRequest,
	parseBrowserRequestFailure,
	parseBrowserResponse,
	parseBrowserResponseRecord,
	parseBrowserSecurity,
	parseBrowserTiming,
	parseBrowserTimingRange,
	parseBrowserWebSocketFrame,
	readBrowserAXValue,
	readBrowserAccessibility,
	readBrowserCookie,
	readBrowserCookies,
	readBrowserCoverageRanges,
	readBrowserHeaders,
	readBrowserMetrics,
	readBrowserProfile,
	readBrowserProfileFrame,
	readBrowserQuad,
	readBrowserRemoteValue,
	readBrowserScriptCoverage,
	readBrowserScriptIdentifier,
	readBrowserStack,
	readBrowserStorageEntries,
	readBrowserStorageOrigin,
	readBrowserStreamChunk,
	readBrowserStyleCoverage,
	settleBrowserTeardown,
	textToBytes,
	validateBrowserAccessibilityOptions,
	validateBrowserContextOptions,
	validateBrowserEmulationOptions,
	validateBrowserHAR,
	validateBrowserInputOptions,
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
browserScreenshotToParams({ format: 'png' })
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
keyToBrowserInput('Enter')
extractBrowserChord('Control+Enter')
matchesBrowserURL('https://example.com/api', '**/api')
mediaToFeatures({ scheme: 'dark', motion: 'reduce' })

const request = parseBrowserRequest({
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
parseBrowserAXString(payload)
readBrowserAXValue(payload)
readBrowserAccessibility(payload)
parseBrowserBindingCall(payload)
parseBrowserConsoleMessage(payload)
parseBrowserCookiePartition(payload)
readBrowserCookies(payload)
readBrowserCoverageRanges([], 0)
parseBrowserDownloadProgress(payload)
parseBrowserDownloadStart(payload)
readBrowserHeaders(payload)
readBrowserMetrics(payload)
parseBrowserPageError(payload)
readBrowserProfile(payload)
readBrowserProfileFrame(payload, 0)
readBrowserQuad(payload)
readBrowserRemoteValue(payload)
parseBrowserRequestFailure(payload)
parseBrowserResponse(payload)
parseBrowserResponseRecord(payload, 'request-1', 'loader-1', undefined, 0)
readBrowserScriptCoverage(payload)
readBrowserScriptIdentifier(payload)
parseBrowserSecurity(payload)
readBrowserStack(payload)
readBrowserStorageEntries([], 'https://example.com', 'local')
readBrowserStorageOrigin(payload, 'https://example.com')
readBrowserStreamChunk(payload)
readBrowserStyleCoverage(payload)
await settleBrowserTeardown(
	async () => undefined,
	async () => undefined,
) // unknown — the value the first failing step threw, or undefined
parseBrowserTiming(payload)
parseBrowserTimingRange(payload, 'dnsStart', 'dnsEnd')
parseBrowserWebSocketFrame(payload)
validateBrowserAccessibilityOptions({ depth: 3 })
validateBrowserInputOptions({ delay: 10, count: 2 })
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

| API                                 | Kind      | Summary                                                                                          |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `BrowserAXNode`                     | interface | Decoded Chromium accessibility node.                                                             |
| `BrowserAccessibilityInterface`     | interface | Accessibility snapshot contract.                                                                 |
| `BrowserAccessibilityOptions`       | interface | Root/depth accessibility options.                                                                |
| `BrowserAccessibilitySnapshot`      | interface | Serializable accessibility forest.                                                               |
| `BrowserActionabilityOptions`       | interface | Internal actionability checks and optional position.                                             |
| `BrowserBindingCall`                | interface | One decoded page-to-host binding call.                                                           |
| `BrowserBindingHandler`             | type      | Host function exposed to a page.                                                                 |
| `BrowserChord`                      | interface | Parsed keyboard modifiers and key.                                                               |
| `BrowserClickOptions`               | interface | Mouse button, click count, and inter-transition delay for a click.                               |
| `BrowserClockInterface`             | interface | Chromium virtual-time contract.                                                                  |
| `BrowserConsoleMessage`             | interface | Typed page console event.                                                                        |
| `BrowserContextEventMap`            | type      | Context page/close events.                                                                       |
| `BrowserContextOptions`             | interface | Emitter hook, proxy, origin, download, and emulation context options.                            |
| `BrowserCookie`                     | interface | Cookie returned by Chromium.                                                                     |
| `BrowserCookieFilter`               | interface | Name/domain/path cookie-clear filter.                                                            |
| `BrowserCookieInput`                | interface | Cookie creation input.                                                                           |
| `BrowserCookieManagerInterface`     | interface | Context cookie contract: `cookies` / `set` / `clear`.                                            |
| `BrowserCookiePartition`            | interface | Partitioned-cookie key.                                                                          |
| `BrowserCoverageInterface`          | interface | JavaScript/CSS coverage lifecycle.                                                               |
| `BrowserCoverageOptions`            | interface | Coverage collection options.                                                                     |
| `BrowserCoverageRange`              | interface | Covered source range and execution count.                                                        |
| `BrowserCoverageResult`             | interface | Combined script/style coverage result.                                                           |
| `BrowserCredentials`                | interface | HTTP basic-auth credentials.                                                                     |
| `BrowserDiagnosticsInterface`       | interface | Diagnostics group contract: `tracing` / `coverage` / `performance` / `profiler`.                 |
| `BrowserDialogCategory`             | type      | JavaScript dialog category.                                                                      |
| `BrowserDialogInterface`            | interface | Dialog data and settlement contract.                                                             |
| `BrowserDownloadEventMap`           | type      | Download progress/finish/abort events.                                                           |
| `BrowserDownloadInterface`          | interface | Download state, `cancel`, and the progress update its page drives.                               |
| `BrowserDownloadOptions`            | interface | Context download path/policy.                                                                    |
| `BrowserDownloadProgress`           | interface | Decoded download progress event.                                                                 |
| `BrowserDownloadStart`              | interface | Decoded download creation event.                                                                 |
| `BrowserDownloadStatus`             | type      | Download lifecycle state.                                                                        |
| `BrowserDragOptions`                | interface | Mouse button, interpolation steps, and inter-move delay for a drag.                              |
| `BrowserEmulationManagerInterface`  | interface | Context emulation lifecycle.                                                                     |
| `BrowserEmulationOptions`           | interface | Viewport, identity, location, media, network, and auth emulation.                                |
| `BrowserFileChooserInterface`       | interface | File chooser metadata and file selection.                                                        |
| `BrowserFunctionCoverage`           | interface | Per-function JavaScript coverage.                                                                |
| `BrowserGeolocation`                | interface | Latitude, longitude, and accuracy override.                                                      |
| `BrowserHAR`                        | interface | Standards-shaped HAR 1.2 document.                                                               |
| `BrowserHARContent`                 | interface | HAR response body metadata.                                                                      |
| `BrowserHARCookie`                  | interface | HAR cookie value.                                                                                |
| `BrowserHARCreator`                 | interface | HAR creator name/version.                                                                        |
| `BrowserHAREntry`                   | interface | One HAR HTTP exchange.                                                                           |
| `BrowserHARLog`                     | interface | HAR version, creator, and entries.                                                               |
| `BrowserHARManagerInterface`        | interface | HAR recording/replay contract.                                                                   |
| `BrowserHAROptions`                 | interface | HAR content/persistence options.                                                                 |
| `BrowserHARPending`                 | interface | Request state awaiting completion.                                                               |
| `BrowserHARPost`                    | interface | HAR request body metadata.                                                                       |
| `BrowserHARReplayOptions`           | interface | Archive-miss replay behavior.                                                                    |
| `BrowserHARRequest`                 | interface | HAR 1.2 request.                                                                                 |
| `BrowserHARResponse`                | interface | HAR 1.2 response.                                                                                |
| `BrowserHARTimings`                 | interface | HAR 1.2 phase timings.                                                                           |
| `BrowserHARValue`                   | interface | HAR name/value entry.                                                                            |
| `BrowserHandleInterface`            | interface | Remote object evaluation/disposal contract.                                                      |
| `BrowserInputOptions`               | interface | The delay every trusted input operation shares.                                                  |
| `BrowserKey`                        | interface | Normalized Chromium keyboard input data.                                                         |
| `BrowserKeyboardInterface`          | interface | Trusted keyboard input contract.                                                                 |
| `BrowserLocatorClickOptions`        | interface | Element resolution plus mouse-click input.                                                       |
| `BrowserLocatorDragOptions`         | interface | Element resolution plus mouse-drag input.                                                        |
| `BrowserLocatorFilter`              | interface | Serializable locator filter.                                                                     |
| `BrowserLocatorInterface`           | interface | Reusable strict locator contract, including `text` and `texts`.                                  |
| `BrowserLocatorTypeOptions`         | interface | Element resolution plus key input.                                                               |
| `BrowserMargin`                     | interface | PDF paper margins.                                                                               |
| `BrowserMedia`                      | interface | Media and user-preference emulation: `output`, `scheme`, `contrast`, `motion`, `colors`.         |
| `BrowserMetric`                     | interface | Named performance metric.                                                                        |
| `BrowserMouseButton`                | type      | Supported Chromium mouse button.                                                                 |
| `BrowserMouseInterface`             | interface | Trusted mouse input contract.                                                                    |
| `BrowserNavigationManagerInterface` | interface | Navigation observation/wait contract.                                                            |
| `BrowserNavigationResult`           | interface | Final navigation URL and matching response.                                                      |
| `BrowserNavigationWait`             | interface | Pending URL-pattern waiter state.                                                                |
| `BrowserNavigationWaitOptions`      | interface | URL/function navigation wait options.                                                            |
| `BrowserNavigationWatch`            | interface | Pending request/response correlation state.                                                      |
| `BrowserNetworkEventMap`            | type      | Request/response/failure/finish/socket events.                                                   |
| `BrowserNetworkManagerInterface`    | interface | Page network lifecycle contract.                                                                 |
| `BrowserOperationOptions`           | type      | Every option a trusted-input operation can carry.                                                |
| `BrowserPDFOptions`                 | interface | Chromium print-to-PDF options.                                                                   |
| `BrowserPDFResult`                  | interface | PDF bytes and optional path.                                                                     |
| `BrowserPageError`                  | interface | Uncaught page exception.                                                                         |
| `BrowserPageEventMap`               | type      | Page, frame, target, input, and network events.                                                  |
| `BrowserPagesFunction`              | type      | Returns a context's live pages at call time.                                                     |
| `BrowserPerformanceInterface`       | interface | Performance-domain metrics contract.                                                             |
| `BrowserPermissionManagerInterface` | interface | Context permission contract.                                                                     |
| `BrowserPoint`                      | interface | CSS-pixel coordinate.                                                                            |
| `BrowserPointerOptions`             | interface | Element resolution plus an in-element target point.                                              |
| `BrowserProfile`                    | interface | Sampled CPU profile.                                                                             |
| `BrowserProfileFrame`               | interface | CPU-profile call frame.                                                                          |
| `BrowserProfileNode`                | interface | CPU-profile call-tree node.                                                                      |
| `BrowserProfilerInterface`          | interface | Sampled CPU-profile lifecycle contract.                                                          |
| `BrowserProxy`                      | interface | Context proxy server and bypass list.                                                            |
| `BrowserQuad`                       | interface | Element content quad and actionable center.                                                      |
| `BrowserQuery`                      | interface | Serializable locator query tree.                                                                 |
| `BrowserRequest`                    | interface | Observed HTTP request.                                                                           |
| `BrowserRequestFailure`             | interface | Observed request failure.                                                                        |
| `BrowserResponse`                   | interface | Observed HTTP response with timing/security metadata.                                            |
| `BrowserRoleOptions`                | interface | Role locator accessible-name options.                                                            |
| `BrowserRouteContinueOptions`       | interface | Request continuation overrides.                                                                  |
| `BrowserRouteDefinition`            | interface | Installed route query/handler.                                                                   |
| `BrowserRouteFulfillOptions`        | interface | Synthetic response options.                                                                      |
| `BrowserRouteHandler`               | type      | Function handling a paused request.                                                              |
| `BrowserRouteInterface`             | interface | Paused-request settlement contract.                                                              |
| `BrowserRouteQuery`                 | interface | URL/method/resource route criteria.                                                              |
| `BrowserSameSite`                   | type      | Cookie same-site policy.                                                                         |
| `BrowserScreenshotScale`            | type      | CSS/device screenshot coordinate scale.                                                          |
| `BrowserScriptCoverage`             | interface | Per-script JavaScript coverage.                                                                  |
| `BrowserScriptEntry`                | interface | Installed script and optional binding owner.                                                     |
| `BrowserScriptManagerInterface`     | interface | Init-script/binding lifecycle contract.                                                          |
| `BrowserSecurity`                   | interface | TLS protocol, issuer, and validity.                                                              |
| `BrowserSelector`                   | type      | CSS/role/text/label/placeholder/testId locator axis.                                             |
| `BrowserSelectorManagerInterface`   | interface | Semantic locator factory contract: `css` / `role` / `text` / `label` / `placeholder` / `testId`. |
| `BrowserStackFrame`                 | interface | Browser-side exception stack frame.                                                              |
| `BrowserStorageEntry`               | interface | Web-storage key/value pair.                                                                      |
| `BrowserStorageManagerInterface`    | interface | Storage state lifecycle contract.                                                                |
| `BrowserStorageOptions`             | interface | Origins selected for storage capture.                                                            |
| `BrowserStorageOrigin`              | interface | Local/session storage for one origin.                                                            |
| `BrowserStorageState`               | interface | Cookies and selected web-storage origins.                                                        |
| `BrowserStreamChunk`                | interface | Decoded CDP IO chunk.                                                                            |
| `BrowserStyleCoverage`              | interface | Per-style-sheet CSS coverage.                                                                    |
| `BrowserTeardownFunction`           | type      | One teardown step run to settlement.                                                             |
| `BrowserTextOptions`                | interface | Exactness for text-like locators.                                                                |
| `BrowserTiming`                     | interface | CDP network timing phases.                                                                       |
| `BrowserTimingRange`                | interface | Start/end pair for one network timing phase.                                                     |
| `BrowserTouchInterface`             | interface | Trusted touch input contract.                                                                    |
| `BrowserTracingInterface`           | interface | Chromium tracing lifecycle contract.                                                             |
| `BrowserTracingOptions`             | interface | Categories/screenshots/sampling/path tracing options.                                            |
| `BrowserTracingResult`              | interface | Trace bytes and optional path.                                                                   |
| `BrowserTransitionFunction`         | type      | The work one transition performs.                                                                |
| `BrowserTransitionInterface`        | interface | One shared asynchronous transition contract.                                                     |
| `BrowserUploadOptions`              | interface | File paths plus action options.                                                                  |
| `BrowserUserAgent`                  | interface | User-agent string/language/platform override.                                                    |
| `BrowserWebSocketEventMap`          | type      | WebSocket frame/error/close events.                                                              |
| `BrowserWebSocketFrame`             | interface | WebSocket opcode/payload/mask/timestamp.                                                         |
| `BrowserWebSocketInterface`         | interface | Observable WebSocket contract — identity, emitter, and the frame updates its manager drives.     |
| `BrowserWorkerCategory`             | type      | Dedicated/service/shared worker category.                                                        |
| `BrowserWorkerInterface`            | interface | Attached worker evaluation/CDP contract.                                                         |

## Methods

The public methods of the layer's behavioral interfaces — every call-signature
member listed (their `readonly` data members stay Surface rows). The Core and
Server tables come first, then one table per behavioral interface the Extended
Chromium automation surface introduces, in source declaration order. Each
implementing class exposes EXACTLY its interface's methods: `CDPClient` ↔
`CDPClientInterface`, `BrowserContext` ↔ `BrowserContextInterface`,
`BrowserFrame` ↔ `BrowserFrameInterface`, `BrowserPage` ↔
`BrowserPageInterface`, `BrowserSnapshot` ↔ `BrowserSnapshotInterface`,
`BrowserCodegen` ↔ `BrowserCodegenInterface`, `BrowserTransition` ↔
`BrowserTransitionInterface`, `Browser` ↔
`BrowserInterface`, `BrowserWebSocket` ↔ `BrowserWebSocketInterface`,
`BrowserDownload` ↔ `BrowserDownloadInterface`, `WebSocketCDPTransport` ↔
`CDPTransportInterface`, `FileBrowserWriter` ↔ `BrowserWriterInterface`,
`BrowserNavigationManager` ↔ `BrowserNavigationManagerInterface`,
`BrowserHandle` ↔ `BrowserHandleInterface`, `BrowserScriptManager` ↔
`BrowserScriptManagerInterface`, `BrowserAccessibility` ↔
`BrowserAccessibilityInterface`, `BrowserTracing` ↔ `BrowserTracingInterface`,
`BrowserCoverage` ↔ `BrowserCoverageInterface`, `BrowserPerformance` ↔
`BrowserPerformanceInterface`, `BrowserProfiler` ↔ `BrowserProfilerInterface`,
`BrowserDiagnostics` ↔ `BrowserDiagnosticsInterface`, `BrowserClock` ↔
`BrowserClockInterface`, `BrowserLocator` ↔ `BrowserLocatorInterface`,
`BrowserSelectorManager` ↔ `BrowserSelectorManagerInterface`,
`BrowserKeyboard` ↔ `BrowserKeyboardInterface`, `BrowserMouse` ↔
`BrowserMouseInterface`, `BrowserTouch` ↔ `BrowserTouchInterface`,
`BrowserDialog` ↔ `BrowserDialogInterface`, `BrowserFileChooser` ↔
`BrowserFileChooserInterface`, `BrowserWorker` ↔ `BrowserWorkerInterface`,
`BrowserRoute` ↔ `BrowserRouteInterface`, `BrowserHARManager` ↔
`BrowserHARManagerInterface`, `BrowserNetworkManager` ↔
`BrowserNetworkManagerInterface`, `BrowserCookieManager` ↔
`BrowserCookieManagerInterface`, `BrowserPermissionManager` ↔
`BrowserPermissionManagerInterface`, `BrowserStorageManager` ↔
`BrowserStorageManagerInterface`, `BrowserEmulationManager` ↔
`BrowserEmulationManagerInterface`.

#### `CDPTransportInterface`

The text pipe a `CDPClientInterface` sends and receives JSON-RPC frames over.

| Method  | Returns         | Behavior                                                                                                                                                        |
| ------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` | `Promise<void>` | Open the underlying connection.                                                                                                                                 |
| `send`  | `Promise<void>` | Write one raw text frame to the connection. Throws a coded `BrowserConnectionError` carrying the transport `url` if called before `start()` or after `close()`. |
| `close` | `Promise<void>` | Close the underlying connection and release resources.                                                                                                          |

```ts
transport.emitter.on('message', (data) => log(data))
await transport.start()
await transport.send('{"id":1,"method":"Target.getTargets"}')
await transport.close()
```

#### `CDPClientInterface`

Frames JSON-RPC-shaped CDP method calls and events over an injected
`CDPTransportInterface`. `connect` starts the transport and begins
dispatching; `send` issues a CDP method call, taking its session and per-call
timeout in a trailing `CDPSendOptions`; `emitter` reports the client's own
`connect` / `close` / `drop` / `error` transitions;
`subscribe` / `unsubscribe` register or remove a handler for a CDP event
(optionally session-scoped). Subscriptions are client-level registrations,
not connection-level state — they survive `close()` and a subsequent
`reconnect()` / `connect()`, and resume firing once reconnected. Calling
`close()` while a `connect()` is still in flight rejects that in-flight
connect attempt.

| Method        | Returns            | Behavior                                                                                                                                                                                            |
| ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect`     | `Promise<void>`    | Start the transport and begin dispatching. Idempotent.                                                                                                                                              |
| `reconnect`   | `Promise<void>`    | Close and re-establish the transport.                                                                                                                                                               |
| `send`        | `Promise<unknown>` | Issue a CDP method call with optional params and a trailing `CDPSendOptions` carrying the `session` to scope it to and a per-call `timeout` overriding the client-wide default; rejects on timeout. |
| `subscribe`   | `void`             | Register a handler for a CDP event, optionally session-scoped.                                                                                                                                      |
| `unsubscribe` | `void`             | Remove a handler for a CDP event, optionally session-scoped.                                                                                                                                        |
| `close`       | `Promise<void>`    | Tear down the transport and reject all pending requests.                                                                                                                                            |

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
| `send`        | `Promise<unknown>`                | Issue a raw CDP method in the frame's current target session, with a trailing `BrowserSendOptions` carrying a per-call `timeout` overriding the client-wide default.                                                               |
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
const tree = await child?.send('DOM.getDocument', { depth: 1 }, { timeout: 5_000 })
await page.save('./artifact.bin', new Uint8Array([1, 2, 3]))
child?.assert() // throws once the client disconnects, or the page closes
child?.update('https://example.com/checkout') // record a URL observed elsewhere
```

#### `BrowserPageInterface`

A top-level page. Its page/target-specific operations come first, then every
member it inherits from `BrowserFrameInterface`, whose own behavior the table
above states.

| Method        | Returns                                       | Behavior                                                                                                          |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `navigate`    | `Promise<BrowserNavigationResult>`            | Go to a URL, wait for the requested load condition, and return final URL/response correlation.                    |
| `reload`      | `Promise<BrowserNavigationResult>`            | Reload and return final URL/response correlation.                                                                 |
| `back`        | `Promise<BrowserNavigationResult>`            | Navigate to the previous history entry, or return the unchanged URL when none exists.                             |
| `forward`     | `Promise<BrowserNavigationResult>`            | Navigate to the next history entry, or return the unchanged URL when none exists.                                 |
| `screenshot`  | `Promise<BrowserScreenshotResult>`            | Capture PNG/JPEG bytes, optionally full-page and persisted through an injected writer.                            |
| `pdf`         | `Promise<BrowserPDFResult>`                   | Print the page to PDF bytes, optionally persisted through the injected writer.                                    |
| `frame`       | `Promise<BrowserFrameInterface \| undefined>` | Look up a first-class frame by name or URL.                                                                       |
| `frames`      | `Promise<readonly BrowserFrameInterface[]>`   | Decode the flattened frame tree, main frame first.                                                                |
| `snapshot`    | `Promise<BrowserSnapshotInterface>`           | Capture and decode all attached documents, shadow roots, template contents, layout, and optional computed styles. |
| `codegen`     | `Promise<BrowserCodegenInterface>`            | Start or return the current action recorder.                                                                      |
| `destroy`     | `Promise<void>`                               | Release local resources and detach without closing the remote target.                                             |
| `close`       | `Promise<void>`                               | Close the remote target and release resources.                                                                    |
| `title`       | `Promise<string>`                             | Inherited from `BrowserFrameInterface`.                                                                           |
| `content`     | `Promise<BrowserContentResult>`               | Inherited from `BrowserFrameInterface`.                                                                           |
| `article`     | `Promise<string>`                             | Inherited from `BrowserFrameInterface`.                                                                           |
| `click`       | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `fill`        | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `select`      | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `evaluate`    | `Promise<unknown>`                            | Inherited from `BrowserFrameInterface`.                                                                           |
| `handle`      | `Promise<BrowserHandleInterface>`             | Inherited from `BrowserFrameInterface`.                                                                           |
| `wait`        | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `send`        | `Promise<unknown>`                            | Inherited from `BrowserFrameInterface`.                                                                           |
| `subscribe`   | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `unsubscribe` | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `save`        | `Promise<void>`                               | Inherited from `BrowserFrameInterface`.                                                                           |
| `assert`      | `void`                                        | Inherited from `BrowserFrameInterface`.                                                                           |
| `update`      | `void`                                        | Inherited from `BrowserFrameInterface`.                                                                           |

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
const shot = await page.screenshot({ full: true, format: 'png' })
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

| Method    | Returns                                    | Behavior                                                                                                                                                                                                            |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                            | Begin recording on the page's session. Calling `start()` after `destroy()` is a silent no-op — a destroyed `BrowserCodegenInterface` cannot be restarted; a new recorder must be obtained through `page.codegen()`. |
| `stop`    | `Promise<readonly BrowserCodegenAction[]>` | Stop recording and return the captured actions.                                                                                                                                                                     |
| `actions` | `readonly BrowserCodegenAction[]`          | Current normalized action list.                                                                                                                                                                                     |
| `script`  | `string`                                   | Compile the captured actions into a script.                                                                                                                                                                         |
| `clear`   | `void`                                     | Reset the captured action list.                                                                                                                                                                                     |
| `destroy` | `Promise<void>`                            | Tear down the recorder and detach CDP listeners.                                                                                                                                                                    |

```ts
const codegen = await page.codegen()
await page.click('#next')
const actions = await codegen.stop()
const script = codegen.script({ language: 'typescript' })
codegen.clear() // reset the captured action list
await codegen.destroy()
```

#### `BrowserTransitionInterface`

One asynchronous transition at a time, shared by every caller that joins it
while it runs. An entity keeps its own entry guards — what makes a transition
unnecessary is the entity's own state — and holds one `BrowserTransition` per
transition, so the in-flight identity check is written once instead of once per
lifecycle.

| Method    | Returns      | Behavior                                                                                               |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `execute` | `Promise<T>` | Start the work when nothing is in flight, otherwise join the running transition and return its result. |

```ts
import { BrowserTransition } from '@orkestrel/browser'

const starting = new BrowserTransition()
await starting.execute(() => transport.start())
const joined = starting.pending // the in-flight promise, or undefined
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

#### `BrowserWebSocketInterface`

One WebSocket connection a page's network manager reconstructs from
Network-domain events. The manager owns the connection and drives every method
here; a consumer reads `id` and `url` and subscribes through `emitter`.

| Method     | Returns | Behavior                                                                                                           |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `receive`  | `void`  | Emit `receive` for one frame the page received. Ignored after `close`.                                             |
| `transmit` | `void`  | Emit `transmit` for one frame the page sent. Ignored after `close`.                                                |
| `fail`     | `void`  | Emit `error` with the connection's fault message. Ignored after `close`.                                           |
| `close`    | `void`  | Emit `close` with the closing timestamp, then destroy the emitter. Every later call on this connection is ignored. |

```ts
page.network.emitter.on('socket', (socket) => {
	log(socket.id, socket.url)
	socket.emitter.on('receive', (frame) => log(frame.data))
	socket.emitter.on('transmit', (frame) => log(frame.data))
	socket.emitter.on('error', (message) => log(message))
	socket.emitter.on('close', (timestamp) => log(timestamp))
})
// The page's network manager drives the connection from Network-domain events:
socket.receive({ opcode: 1, data: 'pong', masked: false, timestamp: 4 })
socket.transmit({ opcode: 1, data: 'ping', masked: false, timestamp: 3 })
socket.fail('handshake rejected')
socket.close(6)
```

#### `BrowserDownloadInterface`

One context download tracked through Chromium's Browser domain. The owning page
drives `update` from `Browser.downloadProgress`; a consumer calls `cancel` and
reads the observed state.

| Method   | Returns         | Behavior                                                                                                                                                      |
| -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cancel` | `Promise<void>` | Send CDP `Browser.cancelDownload` for this download. Ignored unless the status is still `pending`.                                                            |
| `update` | `void`          | Record one progress update, emit `progress`, and settle the download by emitting `complete` or `cancel` and destroying the emitter. Ignored after it settles. |

```ts
page.emitter.on('download', (download) => {
	log(download.id, download.url, download.name)
	download.emitter.on('progress', (received, total) => log(received, total))
	download.emitter.on('complete', (path) => log(path))
	download.emitter.on('cancel', () => log('cancelled'))
})
// The owning page drives progress from Browser.downloadProgress:
download.update({ status: 'pending', received: 512, total: 2_048 })
download.update({ status: 'complete', received: 2_048, total: 2_048, path: './report.pdf' })
await download.cancel() // ignored once the download settled
```

#### `BrowserWriterInterface`

The pluggable sink a page persists captured bytes through. Core never touches a
filesystem; server supplies `FileBrowserWriter`.

| Method  | Returns         | Behavior                                                            |
| ------- | --------------- | ------------------------------------------------------------------- |
| `write` | `Promise<void>` | Persist the captured bytes to the given path, creating its parents. |

```ts
import { FileBrowserWriter } from '@orkestrel/browser/server'

const writer = new FileBrowserWriter()
await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
```

#### `BrowserNavigationManagerInterface`

Waits for a navigation the page performs on its own, rather than one the caller
started.

| Method  | Returns            | Behavior                                                                                            |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `wait`  | `Promise<string>`  | Resolve with the URL of the next navigation matching the `*`/`**` glob pattern. Rejects on timeout. |
| `until` | `Promise<unknown>` | Poll an expression in the page until it returns a truthy value, and resolve with it.                |

```ts
const navigated = page.navigation.wait('**/checkout')
await page.click('#buy')
log(await navigated)
await page.navigation.until('document.readyState === "complete"')
```

#### `BrowserHandleInterface`

A retained remote JavaScript object. Release it with `dispose` when done.

| Method       | Returns                                        | Behavior                                                               |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `value`      | `Promise<unknown>`                             | Read the object back by value.                                         |
| `call`       | `Promise<unknown>`                             | Run a function declaration with the handle as `this`, by value.        |
| `property`   | `Promise<BrowserHandleInterface \| undefined>` | Retain one own property as its own handle, or `undefined` when absent. |
| `properties` | `Promise<Readonly<Record<string, unknown>>>`   | Read every own property by value.                                      |
| `dispose`    | `Promise<void>`                                | Release the retained remote object. Idempotent.                        |

```ts
const handle = await page.handle('document.body')
log(await handle.value())
log(await handle.call('function() { return this.tagName }'))
const dataset = await handle.property('dataset')
log(await handle.properties())
await dataset?.dispose()
await handle.dispose()
```

#### `BrowserScriptManagerInterface`

Installs new-document scripts and exposes host functions into page JavaScript.

| Method    | Returns           | Behavior                                                                    |
| --------- | ----------------- | --------------------------------------------------------------------------- |
| `add`     | `Promise<string>` | Install a script evaluated on every new document, returning its identifier. |
| `remove`  | `Promise<void>`   | Remove one installed script by identifier.                                  |
| `expose`  | `Promise<void>`   | Bind a host function to a page-global name, callable from page JavaScript.  |
| `revoke`  | `Promise<void>`   | Remove one exposed binding and its installed bridge script.                 |
| `destroy` | `Promise<void>`   | Remove every installed script and binding this manager owns.                |

```ts
const id = await page.scripts.add('window.__seeded = true')
await page.scripts.expose('add', (a, b) => Number(a) + Number(b))
log(await page.evaluate('add(1, 2)'))
await page.scripts.revoke('add')
await page.scripts.remove(id)
await page.scripts.destroy()
```

#### `BrowserAccessibilityInterface`

Reads the page's accessibility tree as a serializable snapshot.

| Method     | Returns                                 | Behavior                                                                |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `snapshot` | `Promise<BrowserAccessibilitySnapshot>` | Read the full AX tree, optionally pruned to the interesting nodes only. |

```ts
const tree = await page.accessibility.snapshot({ interesting: true })
log(tree.nodes.map((node) => node.name))
```

#### `BrowserTracingInterface`

Captures a Chromium trace streamed back through the IO domain.

| Method    | Returns                         | Behavior                                                                                    |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                 | Begin tracing with the given categories. Throws a `BrowserError` when already active.       |
| `stop`    | `Promise<BrowserTracingResult>` | End tracing, drain the IO stream, and write it through the page writer when a path was set. |
| `destroy` | `Promise<void>`                 | Stop an active trace, discarding any failure. A no-op when nothing is tracing.              |

```ts
await page.diagnostics.tracing.start({ screenshots: true })
const trace = await page.diagnostics.tracing.stop() // { bytes, path }
await page.diagnostics.tracing.destroy()
```

#### `BrowserCoverageInterface`

Collects JavaScript precise coverage and CSS rule usage together.

| Method    | Returns                          | Behavior                                                                                     |
| --------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                  | Arm the requested domains. Throws a `BrowserError` when already active or when both are off. |
| `stop`    | `Promise<BrowserCoverageResult>` | Read the collected usage and disarm every domain it armed.                                   |
| `destroy` | `Promise<void>`                  | Stop an active collector, discarding any failure. A no-op when nothing is collecting.        |

```ts
await page.diagnostics.coverage.start({ javascript: true, css: true })
const usage = await page.diagnostics.coverage.stop() // { scripts, styles }
await page.diagnostics.coverage.destroy()
```

#### `BrowserPerformanceInterface`

Reads Performance-domain metrics for one frame.

| Method    | Returns                             | Behavior                                                    |
| --------- | ----------------------------------- | ----------------------------------------------------------- |
| `metrics` | `Promise<readonly BrowserMetric[]>` | Enable the domain, read every metric, and disable it again. |

```ts
const metrics = await page.diagnostics.performance.metrics()
log(metrics.map((metric) => [metric.name, metric.value]))
```

#### `BrowserProfilerInterface`

Records a sampled JavaScript CPU profile.

| Method    | Returns                   | Behavior                                                                             |
| --------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `start`   | `Promise<void>`           | Begin sampling, optionally at an explicit positive integer interval in microseconds. |
| `stop`    | `Promise<BrowserProfile>` | End sampling and decode the profile's nodes, samples, and time deltas.               |
| `destroy` | `Promise<void>`           | Stop an active profiler, discarding any failure. A no-op when nothing is profiling.  |

```ts
await page.diagnostics.profiler.start(100)
const profile = await page.diagnostics.profiler.stop() // { start, end, nodes, samples, deltas }
await page.diagnostics.profiler.destroy()
```

#### `BrowserDiagnosticsInterface`

Groups the per-page diagnostics capabilities and owns their teardown. `tracing`,
`coverage`, `performance`, and `profiler` are Surface data members.

| Method    | Returns         | Behavior                                                       |
| --------- | --------------- | -------------------------------------------------------------- |
| `destroy` | `Promise<void>` | Tear down every diagnostics capability this page's group owns. |

```ts
await page.diagnostics.destroy()
```

#### `BrowserClockInterface`

Controls Chromium virtual time so page timers become deterministic.

| Method      | Returns         | Behavior                                                                |
| ----------- | --------------- | ----------------------------------------------------------------------- |
| `install`   | `Promise<void>` | Take over the page clock, optionally seeding it with an epoch time.     |
| `pause`     | `Promise<void>` | Suspend virtual time so no page timer advances.                         |
| `resume`    | `Promise<void>` | Continue virtual time after a pause.                                    |
| `advance`   | `Promise<void>` | Move virtual time forward by the given milliseconds, firing due timers. |
| `uninstall` | `Promise<void>` | Return the page to the real clock. A no-op when nothing was installed.  |

```ts
await page.clock.install(Date.parse('2026-01-01T00:00:00Z'))
await page.clock.pause()
await page.clock.advance(5_000)
await page.clock.resume()
await page.clock.uninstall()
```

#### `BrowserLocatorInterface`

A lazily resolved element query. Every accessor returns a new locator rather than
mutating this one, and every action re-resolves the query before acting.

| Method       | Returns                                       | Behavior                                                                                   |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `locator`    | `BrowserLocatorInterface`                     | Narrow to a descendant matching the CSS selector.                                          |
| `filter`     | `BrowserLocatorInterface`                     | Narrow to the matches satisfying the filter.                                               |
| `first`      | `BrowserLocatorInterface`                     | Narrow to the first match.                                                                 |
| `last`       | `BrowserLocatorInterface`                     | Narrow to the last match.                                                                  |
| `item`       | `BrowserLocatorInterface`                     | Narrow to the match at the given index.                                                    |
| `count`      | `Promise<number>`                             | Count the current matches.                                                                 |
| `all`        | `Promise<readonly BrowserLocatorInterface[]>` | Resolve one indexed locator per current match.                                             |
| `click`      | `Promise<void>`                               | Click the match with trusted input after its actionability checks pass.                    |
| `fill`       | `Promise<void>`                               | Replace the match's value with the given text.                                             |
| `select`     | `Promise<void>`                               | Select the given option values on the match.                                               |
| `check`      | `Promise<void>`                               | Click the match unless it already reports checked.                                         |
| `uncheck`    | `Promise<void>`                               | Click the match unless it already reports unchecked.                                       |
| `hover`      | `Promise<void>`                               | Move trusted pointer input over the match.                                                 |
| `focus`      | `Promise<void>`                               | Give the match keyboard focus.                                                             |
| `press`      | `Promise<void>`                               | Focus the match and press one key or chord.                                                |
| `type`       | `Promise<void>`                               | Focus the match and type the value one key at a time.                                      |
| `clear`      | `Promise<void>`                               | Empty the match's value.                                                                   |
| `wait`       | `Promise<void>`                               | Wait until the match reaches the requested state. Rejects on timeout.                      |
| `text`       | `Promise<string>`                             | Read the first match's rendered text.                                                      |
| `texts`      | `Promise<readonly string[]>`                  | Read the rendered text of every match.                                                     |
| `html`       | `Promise<string>`                             | Read the first match's inner HTML.                                                         |
| `value`      | `Promise<string>`                             | Read the first match's form value.                                                         |
| `attribute`  | `Promise<string \| undefined>`                | Read one attribute of the first match, or `undefined` when it carries none.                |
| `visible`    | `Promise<boolean>`                            | True if the first match renders a non-empty box; false otherwise.                          |
| `enabled`    | `Promise<boolean>`                            | True if the first match accepts input; false otherwise.                                    |
| `editable`   | `Promise<boolean>`                            | True if the first match accepts typed text; false otherwise.                               |
| `screenshot` | `Promise<BrowserScreenshotResult>`            | Capture the first match's box, persisting it through the page writer when a path is given. |
| `upload`     | `Promise<void>`                               | Set the file selection on the matched file input.                                          |
| `drag`       | `Promise<void>`                               | Drag the match onto the target locator with trusted pointer input.                         |

```ts
const rows = page.selectors.role('row')
log(await rows.count())
const first = rows.first()
const last = rows.last()
const second = rows.item(1)
const named = rows.filter({ text: 'Ada' }).locator('td')
for (const row of await rows.all()) log(await row.text())
log(await named.texts(), await named.html(), await named.value())
log(await named.attribute('data-id'))
log(await named.visible(), await named.enabled(), await named.editable())
await named.wait({ state: 'visible' })
await named.click()
await named.hover()
await named.focus()
await named.fill('Ada')
await named.clear()
await named.type('Grace')
await named.press('Enter')
await named.select(['us'])
await named.check()
await named.uncheck()
await named.upload({ files: ['./avatar.png'] })
await named.screenshot({ path: './row.png' })
await first.drag(last)
```

#### `BrowserSelectorManagerInterface`

Creates one locator per selector semantics. Every accessor is pure — it builds a
query and performs no protocol call.

| Method        | Returns                   | Behavior                                                          |
| ------------- | ------------------------- | ----------------------------------------------------------------- |
| `css`         | `BrowserLocatorInterface` | Locate by CSS selector.                                           |
| `role`        | `BrowserLocatorInterface` | Locate by ARIA role, optionally by accessible name and exactness. |
| `text`        | `BrowserLocatorInterface` | Locate by rendered text, optionally exact.                        |
| `label`       | `BrowserLocatorInterface` | Locate a labelled control by its label text, optionally exact.    |
| `placeholder` | `BrowserLocatorInterface` | Locate an input by its placeholder text, optionally exact.        |
| `testId`      | `BrowserLocatorInterface` | Locate by the `data-testid` attribute.                            |

```ts
await page.selectors.css('#hero').click()
await page.selectors.role('button', { name: 'Save', exact: true }).click()
await page.selectors.text('Continue').click()
await page.selectors.label('Email', { exact: true }).fill('ada@example.com')
await page.selectors.placeholder('Search').fill('browser')
await page.selectors.testId('checkout').click()
```

#### `BrowserKeyboardInterface`

Sends trusted keyboard input on the frame's own session. Held modifiers persist
between calls until released.

| Method   | Returns         | Behavior                                                                                           |
| -------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `down`   | `Promise<void>` | Press one key and hold it, retaining it in the modifier mask when it is a modifier.                |
| `up`     | `Promise<void>` | Release one key, dropping it from the modifier mask even when the release frame fails.             |
| `press`  | `Promise<void>` | Press a chord: hold its modifiers, press and release its terminal key, then release the modifiers. |
| `type`   | `Promise<void>` | Type a string as one press and release per character.                                              |
| `insert` | `Promise<void>` | Insert composed text in one frame, firing no per-key events.                                       |

```ts
await page.keyboard.down('Shift')
await page.keyboard.up('Shift')
await page.keyboard.press('Control+Enter')
await page.keyboard.type('orkestrel', { delay: 10 })
await page.keyboard.insert('pasted text')
```

#### `BrowserMouseInterface`

Sends trusted mouse input on the frame's own session, tracking the pointer
position and the pressed-button mask between calls.

| Method  | Returns         | Behavior                                                                                    |
| ------- | --------------- | ------------------------------------------------------------------------------------------- |
| `move`  | `Promise<void>` | Move the pointer to a point, carrying the currently pressed buttons.                        |
| `down`  | `Promise<void>` | Press a button at the current point, adding it to the pressed mask.                         |
| `up`    | `Promise<void>` | Release a button at the current point, dropping it from the mask even when the frame fails. |
| `click` | `Promise<void>` | Move, press, optionally delay, and release at the given point.                              |
| `drag`  | `Promise<void>` | Press at the start, move in the requested steps to the end, and release.                    |
| `wheel` | `Promise<void>` | Send a wheel delta at the current point.                                                    |

```ts
await page.mouse.move({ x: 50, y: 20 })
await page.mouse.down('left')
await page.mouse.up('left')
await page.mouse.click({ x: 50, y: 20 }, { button: 'left', count: 2 })
await page.mouse.drag({ x: 10, y: 10 }, { x: 90, y: 90 }, { steps: 20 })
await page.mouse.wheel({ x: 0, y: -120 })
```

#### `BrowserTouchInterface`

Sends trusted touch input on the frame's own session.

| Method | Returns         | Behavior                                                                              |
| ------ | --------------- | ------------------------------------------------------------------------------------- |
| `tap`  | `Promise<void>` | Dispatch a touch start at the point and a touch end, cancelling the touch on failure. |

```ts
await page.touch.tap({ x: 120, y: 240 })
```

#### `BrowserDialogInterface`

One JavaScript dialog awaiting a decision. `category`, `message`, and `default`
are Surface data members.

| Method    | Returns         | Behavior                                                                                |
| --------- | --------------- | --------------------------------------------------------------------------------------- |
| `accept`  | `Promise<void>` | Accept the dialog, optionally supplying prompt text. Throws once the dialog is handled. |
| `dismiss` | `Promise<void>` | Dismiss the dialog. Throws once the dialog is handled.                                  |

```ts
page.emitter.on('dialog', async (dialog) => {
	if (dialog.category === 'prompt') await dialog.accept('Ada')
	else await dialog.dismiss()
})
```

#### `BrowserFileChooserInterface`

One intercepted file input selection. `multiple` is a Surface data member.

| Method   | Returns         | Behavior                                                                                           |
| -------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `upload` | `Promise<void>` | Set the chosen files. Throws when a single-file chooser is given several, or once already handled. |
| `cancel` | `Promise<void>` | Clear the selection. Throws once already handled.                                                  |

```ts
page.emitter.on('chooser', async (chooser) => {
	if (chooser.multiple) await chooser.upload(['one.txt', 'two.txt'])
	else await chooser.cancel()
})
```

#### `BrowserWorkerInterface`

A dedicated, shared, or service worker attached through its own flattened
session. `id`, `url`, and `category` are Surface data members.

| Method     | Returns            | Behavior                                                                          |
| ---------- | ------------------ | --------------------------------------------------------------------------------- |
| `evaluate` | `Promise<unknown>` | Evaluate a guarded expression in the worker and return its value.                 |
| `send`     | `Promise<unknown>` | Issue one CDP method call on the worker's session.                                |
| `detach`   | `void`             | Stop driving the worker locally without closing its target.                       |
| `close`    | `Promise<void>`    | Close the worker target, tolerating a worker that already terminated. Idempotent. |

```ts
page.emitter.on('worker', async (worker) => {
	log(await worker.evaluate('self.location.href'))
	await worker.send('Runtime.enable')
	worker.detach()
	await worker.close()
})
```

#### `BrowserRouteInterface`

One paused request, decided exactly once. `id`, `request`, and `handled` are
Surface data members.

| Method     | Returns         | Behavior                                                                               |
| ---------- | --------------- | -------------------------------------------------------------------------------------- |
| `abort`    | `Promise<void>` | Fail the request with a Chromium error reason. Default: `'Failed'`.                    |
| `continue` | `Promise<void>` | Let the request proceed, optionally overriding its url, method, headers, or post body. |
| `fulfill`  | `Promise<void>` | Answer the request locally. Throws when the status is not an integer from 100 to 999.  |

```ts
await page.network.route({ url: '**/api' }, async (route) => {
	if (route.handled) return
	await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' })
})
await page.network.route({ url: '**/slow' }, (route) => route.abort('TimedOut'))
await page.network.route({ url: '**/pass' }, (route) => route.continue({ method: 'POST' }))
```

#### `BrowserHARManagerInterface`

Records observed exchanges as a HAR 1.2 archive and replays one back.
`recording` is a Surface data member.

| Method   | Returns               | Behavior                                                                      |
| -------- | --------------------- | ----------------------------------------------------------------------------- |
| `start`  | `Promise<void>`       | Begin recording exchanges, optionally capturing response content.             |
| `stop`   | `Promise<BrowserHAR>` | End recording and return the archive, writing it when a path was given.       |
| `replay` | `Promise<void>`       | Serve matching requests from an archive instead of the network.               |
| `clear`  | `Promise<void>`       | Drop the recorded entries and any active replay without ending the recording. |

```ts
await page.network.har.start({ content: true })
const har = await page.network.har.stop()
await page.network.har.replay(har, { strict: true })
await page.network.har.clear()
```

#### `BrowserNetworkManagerInterface`

Page-scoped network observation and interception. `emitter` and `har` are
Surface data members. Every method starts the Network domain first, so the page
begins reporting `request` / `response` / `failure` from the first call.

| Method        | Returns               | Behavior                                                                       |
| ------------- | --------------------- | ------------------------------------------------------------------------------ |
| `start`       | `Promise<void>`       | Enable the Network domain and subscribe to its events. Idempotent.             |
| `body`        | `Promise<Uint8Array>` | Read one observed response body as bytes.                                      |
| `text`        | `Promise<string>`     | Read one observed response body as text.                                       |
| `json`        | `Promise<unknown>`    | Read one observed response body as parsed JSON.                                |
| `route`       | `Promise<void>`       | Intercept requests matching the query and hand each to the handler.            |
| `unroute`     | `Promise<void>`       | Remove one handler's routes, or every route when given none.                   |
| `headers`     | `Promise<void>`       | Apply extra HTTP headers to every request the page makes.                      |
| `offline`     | `Promise<void>`       | Emulate offline or restore connectivity.                                       |
| `credentials` | `Promise<void>`       | Apply HTTP basic-auth credentials, or clear them when given none.              |
| `destroy`     | `Promise<void>`       | Remove every route, unsubscribe, and disable the domains this manager enabled. |

```ts
await page.network.start()
page.emitter.on('response', async (response) => {
	log(await page.network.body(response.id))
	log(await page.network.text(response.id))
	log(await page.network.json(response.id))
})
const handler = (route) => route.continue()
await page.network.route({ url: '**/api' }, handler)
await page.network.unroute(handler)
await page.network.headers({ 'x-trace': 'on' })
await page.network.offline(true)
await page.network.credentials({ username: 'ada', password: 'secret' })
await page.network.destroy()
```

#### `BrowserCookieManagerInterface`

Cookie state scoped to one browser context.

| Method    | Returns                             | Behavior                                                                   |
| --------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `cookies` | `Promise<readonly BrowserCookie[]>` | Read the context cookies, optionally narrowed to the given URLs.           |
| `set`     | `Promise<void>`                     | Write the given cookies into the context.                                  |
| `clear`   | `Promise<void>`                     | Delete the context cookies matching the filter, or every cookie with none. |

```ts
await context.cookies.set([{ name: 'session', value: 'abc', url: 'https://example.com/' }])
log(await context.cookies.cookies(['https://example.com/']))
await context.cookies.clear({ name: 'session' })
```

#### `BrowserPermissionManagerInterface`

Permission overrides scoped to one browser context.

| Method  | Returns         | Behavior                                                                      |
| ------- | --------------- | ----------------------------------------------------------------------------- |
| `grant` | `Promise<void>` | Grant each named permission, optionally for one origin, as its own CDP frame. |
| `deny`  | `Promise<void>` | Deny each named permission, optionally for one origin, as its own CDP frame.  |
| `clear` | `Promise<void>` | Reset every permission override on the context.                               |

```ts
await context.permissions.grant(['geolocation'], 'https://example.com')
await context.permissions.deny(['notifications'], 'https://example.com')
await context.permissions.clear()
```

#### `BrowserStorageManagerInterface`

Cookie and web-storage state for one browser context, as one serializable value.

| Method    | Returns                        | Behavior                                                               |
| --------- | ------------------------------ | ---------------------------------------------------------------------- |
| `state`   | `Promise<BrowserStorageState>` | Read the context cookies and the per-origin local and session storage. |
| `restore` | `Promise<void>`                | Write a previously read state back into the context.                   |
| `clear`   | `Promise<void>`                | Drop the storage of one origin, or of every origin when given none.    |

```ts
const state = await context.storage.state({ origins: ['https://example.com'] })
await context.storage.restore(state)
await context.storage.clear('https://example.com')
```

#### `BrowserEmulationManagerInterface`

Emulation overrides inherited by every page of one context. The offline and
header overrides route through each page's network manager, so applying either
starts that page's Network domain.

| Method   | Returns         | Behavior                                                                              |
| -------- | --------------- | ------------------------------------------------------------------------------------- |
| `apply`  | `Promise<void>` | Clear the superseded overrides and apply the given ones to every page of the context. |
| `clear`  | `Promise<void>` | Remove every override this manager applied.                                           |
| `attach` | `Promise<void>` | Apply the retained overrides to a newly created page.                                 |

```ts
await context.emulation.apply({ locale: 'fr-FR', offline: true, headers: { 'x-test': 'one' } })
await context.emulation.attach(page)
await context.emulation.clear()
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
4. **Captured bytes never touch a filesystem in core.** A page accepts an
   optional `BrowserWriterInterface`, injected through `BrowserContext`, and
   calls `write(path, bytes)` only when a screenshot, PDF, trace, or HAR
   request carries a `path`; the server supplies `createBrowserWriter`, an
   `fs`-backed implementation, through `Browser`.
5. **Server owns the connection lifecycle.** `Browser.connect()` tries, in
   order: an explicit `cdp.endpoint`; a passive probe of
   `{cdp.host}:{cdp.port}` (defaulting to `127.0.0.1:{cdp.port}` through
   `BROWSER_DEFAULT_HOST`) (`discover()`); then launching a new browser
   process with raw-CDP flags
   (`findSystemBrowser` / `launchBrowserProcess` / `waitForCDPReady`). A
   found existing browser is preferred over a fresh launch. `engine` is
   classified through `parseBrowserEngine` (explicit `executable`) or the
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
   `disconnect` / `launch` / `page` / `context` / `error` / `destroy`; `BrowserCodegenInterface.emitter`
   fires `start` / `stop` / `action` / `clear`; `CDPClientInterface.emitter`
   fires `connect` / `close` / `drop` / `error`. Each isolates a listener throw
   through `@orkestrel/emitter`'s emitter, never a domain event. An external
   disconnect (transport loss while an owned process stays alive, or the
   owned process exiting on its own) always emits a coded `error` before
   `disconnect`; transport loss with the process still alive is RESUMABLE —
   the browser is not killed and the same `Browser` instance can `connect()`
   again (for example, rediscovering it over CDP), while a process exit is terminal
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
   `compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT)`, and
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
    `BrowserCodegenInterface`, `BrowserTransitionInterface`,
    `BrowserInterface`, `BrowserWebSocketInterface`,
    `BrowserDownloadInterface`, `BrowserWriterInterface`,
    `BrowserNavigationManagerInterface`, `BrowserHandleInterface`,
    `BrowserScriptManagerInterface`, `BrowserAccessibilityInterface`,
    `BrowserTracingInterface`, `BrowserCoverageInterface`,
    `BrowserPerformanceInterface`, `BrowserProfilerInterface`,
    `BrowserDiagnosticsInterface`, `BrowserClockInterface`,
    `BrowserLocatorInterface`, `BrowserSelectorManagerInterface`,
    `BrowserKeyboardInterface`, `BrowserMouseInterface`,
    `BrowserTouchInterface`, `BrowserDialogInterface`,
    `BrowserFileChooserInterface`, `BrowserWorkerInterface`,
    `BrowserRouteInterface`, `BrowserHARManagerInterface`,
    `BrowserNetworkManagerInterface`, `BrowserCookieManagerInterface`,
    `BrowserPermissionManagerInterface`, `BrowserStorageManagerInterface`,
    `BrowserEmulationManagerInterface` — exhaustive, both directions, and each
    implementing class (`WebSocketCDPTransport`, `CDPClient`, `BrowserContext`,
    `BrowserFrame`, `BrowserPage`, `BrowserSnapshot`, `BrowserCodegen`,
    `BrowserTransition`, `Browser`, `BrowserWebSocket`, `BrowserDownload`,
    `FileBrowserWriter`, `BrowserNavigationManager`, `BrowserHandle`,
    `BrowserScriptManager`, `BrowserAccessibility`, `BrowserTracing`,
    `BrowserCoverage`, `BrowserPerformance`, `BrowserProfiler`,
    `BrowserDiagnostics`, `BrowserClock`, `BrowserLocator`,
    `BrowserSelectorManager`, `BrowserKeyboard`, `BrowserMouse`,
    `BrowserTouch`, `BrowserDialog`, `BrowserFileChooser`, `BrowserWorker`,
    `BrowserRoute`, `BrowserHARManager`, `BrowserNetworkManager`,
    `BrowserCookieManager`, `BrowserPermissionManager`,
    `BrowserStorageManager`, `BrowserEmulationManager`) exposes the same public
    methods, no more.
    `BrowserPageInterface` extends `BrowserFrameInterface`, so its table
    repeats every inherited member and points at the frame's own table for the
    behavior. Every remaining export is a function or a data bag rather than a
    behavioral interface with methods — the factories, `decodeBase64` /
    `compileGuardedEvaluateExpression` / `parseCodegenActionPayload` /
    `parseCodegenNavigateAction` / `compileCodegenScript` / `findSystemBrowser` /
    `launchBrowserProcess` / `waitForCDPReady` / `fetchCDPTargets` are
    functions; the options interfaces / event maps / results / `CDPTarget` /
    `BrowserViewport` are data bags — so they contribute no `## Methods` row.
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
browser process keeps running, so a later `Browser` can reattach to it through
CDP discovery on the same fixed port. A reattached instance connects as
`'cdp'`, so its own `destroy()` is a LOCAL DETACH ONLY — it never sends a
remote close, because another client may still be using the browser:

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

Use `close()` instead of `destroy()` to terminate a browser this instance
merely attached to (or launched) — it sends CDP
`Browser.close` and, when this instance owns the process, awaits its exit
before falling back to the kill-escalation `destroy()` uses:

```ts
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP

await reattached.close() // best-effort CDP Browser.close; because this instance never owned the process, it does NOT wait for the remote exit
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
