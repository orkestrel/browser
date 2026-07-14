# Browsers — Headless Browser Automation

> CDP-based browser automation — launch, connect, discover, and control Chromium pages.

**Package:** `@scsr/server`  
**Location:** `src/server/browsers/`  
**Types:** `src/server/types.ts`  
**Factories:** `src/server/factories.ts`

---

## Architecture

```
Browser (lifecycle, connection strategy, viewport passthrough)
    |
    +-- BrowserContext (isolated CDP context, viewport application)
         |
         +-- BrowserPage (page interaction — navigate, click, fill, evaluate, external close detection)
              |
              +-- BrowserPage (child frame — same interface)
              |
              +-- BrowserCodegen (record user actions, compile to runnable TypeScript)
```

The `Browser` manages the browser process or CDP connection. Each `BrowserContext` is equivalent to an incognito window with real CDP context isolation via `Target.createBrowserContext`. Pages created within a context share its session.

All communication uses the Chrome DevTools Protocol (CDP) over WebSocket, with a lightweight `CDPClient` class that supports session-scoped event subscriptions — no Playwright dependency.

---

## Overview

| Entity           | Interface                 | Purpose                                          |
| ---------------- | ------------------------- | ------------------------------------------------ |
| `CDPClient`      | `CdpClientInterface`      | CDP JSON-RPC over WebSocket with session scoping |
| `Browser`        | `BrowserInterface`        | Launch or connect to a browser, manage contexts  |
| `BrowserContext` | `BrowserContextInterface` | Isolated session with independent cookies/cache  |
| `BrowserPage`    | `BrowserPageInterface`    | Navigate, interact, and extract from a page      |
| `BrowserCodegen` | `BrowserCodegenInterface` | Record page actions and compile to a TS script   |
| `BrowserTool`    | `BrowserToolInterface`    | MCP tool wrapper with stores & stable page IDs   |

---

## CDPClient

Lightweight Chrome DevTools Protocol client over WebSocket.

### Key Features

- **Session-scoped subscriptions**: `subscribe(method, handler, sessionId?)` — when `sessionId` is provided, the handler only fires for CDP events carrying that sessionId. Global subscriptions (no sessionId) see ALL events.
- **Reconnect**: `reconnect()` closes and re-connects to the stored endpoint.
- **Endpoint tracking**: `endpoint` exposes the last-connected WebSocket URL.

### Properties

| Property    | Type                  | Description                       |
| ----------- | --------------------- | --------------------------------- |
| `connected` | `boolean`             | `true` when the WebSocket is open |
| `endpoint`  | `string \| undefined` | Last-connected WebSocket URL      |

### Methods

| Method                                     | Returns            | Description                              |
| ------------------------------------------ | ------------------ | ---------------------------------------- |
| `connect(endpoint)`                        | `Promise<void>`    | Open a WebSocket to the CDP endpoint     |
| `reconnect()`                              | `Promise<void>`    | Close and re-connect to stored endpoint  |
| `send(method, params?, sessionId?)`        | `Promise<unknown>` | Send a CDP command                       |
| `subscribe(method, handler, sessionId?)`   | `void`             | Listen for CDP events, optionally scoped |
| `unsubscribe(method, handler, sessionId?)` | `void`             | Remove CDP event listener                |
| `close()`                                  | `Promise<void>`    | Close the WebSocket connection           |

---

## Browser

Manages the browser lifecycle and connection strategy.

### Connection Strategy

`connect()` resolves the connection using this priority order:

1. If `cdp.endpoint` is set — connect directly via CDP WebSocket URL
2. Probe `localhost:{cdp.port}` for an existing browser (passive discovery)
3. If found — connect over CDP (preserves the existing session)
4. Otherwise, launch a new Chromium process with CDP enabled

A stable `--user-data-dir` is always passed to prevent Chrome's singleton mode from handing off to an existing running instance (which exits immediately with code 0). When no explicit `profile` is given, the temp dir `<tmpdir>/scsr-browser-<port>` is used.

### Status Transitions

```
idle -> connecting -> connected
                   -> disconnected  (disconnect() without destroy)
                   -> destroyed     (destroy())
```

The `connected` getter lazily detects external disconnects — when the CDP WebSocket closes while `status` is still `'connected'` (e.g., user closes the browser window), the getter resets state, kills any orphaned process, and emits `disconnect` + `idle` events. This allows the next `connect()` call to start fresh.

### Properties

| Property     | Type                                | Description                                            |
| ------------ | ----------------------------------- | ------------------------------------------------------ |
| `emitter`    | `EmitterInterface<BrowserEventMap>` | Typed event emitter                                    |
| `engine`     | `BrowserEngine`                     | Active engine (`chromium`)                             |
| `status`     | `BrowserStatus`                     | Current connection state                               |
| `connection` | `BrowserConnection \| undefined`    | Active connection descriptor, or `undefined` when idle |
| `connected`  | `boolean`                           | `true` when actively connected                         |

### Methods

| Method             | Returns                                | Description                                  |
| ------------------ | -------------------------------------- | -------------------------------------------- |
| `discover()`       | `Promise<BrowserDiscoveryResult>`      | Passive CDP probe — no side effects          |
| `connect()`        | `Promise<void>`                        | Connect using the strategy above             |
| `disconnect()`     | `void`                                 | Detach from browser without closing it       |
| `context(index?)`  | `BrowserContextInterface \| undefined` | One context by index (default: first)        |
| `contexts()`       | `readonly BrowserContextInterface[]`   | All contexts in creation order               |
| `create(options?)` | `Promise<BrowserPageInterface>`        | Shortcut — open page in default context      |
| `destroy()`        | `Promise<void>`                        | Close browser process, release all resources |

### Events (`BrowserEventMap`)

| Event        | Args                             | When                                 |
| ------------ | -------------------------------- | ------------------------------------ |
| `idle`       | (none)                           | Browser transitions to idle status   |
| `connect`    | `connection: BrowserConnection`  | Connection established               |
| `disconnect` | (none)                           | Browser disconnected (not destroyed) |
| `launch`     | `engine: BrowserEngine`          | New browser process launched         |
| `discover`   | `result: BrowserDiscoveryResult` | CDP discovery probe completed        |
| `error`      | `error: unknown`                 | Connection attempt failed            |
| `destroy`    | (none)                           | Browser permanently destroyed        |
| `page`       | `page: BrowserPageInterface`     | A new page created via `create()`    |

### Create

```ts
import { createBrowser } from '@scsr/server'

const browser = createBrowser({
	engine: 'chromium',
	headless: true,
	timeout: 30_000,
	on: {
		connect: (connection) => console.log('connected:', connection),
		error: (error) => console.error('browser error:', error),
		page: (page) => console.log('new page:', page.url),
	},
})
```

---

## BrowserContext

An isolated browsing session with independent cookies, storage, and cache — equivalent to an incognito window.

### Properties

| Property | Type                  | Description                                                  |
| -------- | --------------------- | ------------------------------------------------------------ |
| `id`     | `string \| undefined` | CDP browser context ID (`undefined` for the default context) |

### Methods

| Method             | Returns                             | Description                        |
| ------------------ | ----------------------------------- | ---------------------------------- |
| `page(index?)`     | `BrowserPageInterface \| undefined` | One page by index (default: first) |
| `pages()`          | `readonly BrowserPageInterface[]`   | All pages in creation order        |
| `create(options?)` | `Promise<BrowserPageInterface>`     | Open a new page in this context    |
| `close()`          | `Promise<void>`                     | Close context and all its pages    |

### Viewport Application

When a viewport is configured (via `BrowserPageOptions.viewport` or the context default), `create()` sends `Emulation.setDeviceMetricsOverride` to the CDP session after enabling page and runtime domains. This ensures the viewport is applied before any navigation.

### Real CDP Context Isolation

When a `BrowserContext` has an `id` (assigned via `Target.createBrowserContext`), new pages include `browserContextId` in `Target.createTarget`. On close, the context is disposed via `Target.disposeBrowserContext`.

---

## BrowserPage

Individual page or frame with full interaction capabilities. Child frames expose the same `BrowserPageInterface`.

### Properties

| Property | Type      | Description                                       |
| -------- | --------- | ------------------------------------------------- |
| `id`     | `string`  | CDP target ID — stable identifier for this page   |
| `url`    | `string`  | Current page URL                                  |
| `closed` | `boolean` | `true` after `close()` or external close detected |

### External Close Detection

Each page subscribes to `Target.targetDestroyed` on construction. When the target is closed externally (e.g. user closes a tab), the `closed` property becomes `true` automatically. The subscription is removed when `close()` is called to prevent duplicate cleanup.

### Session-Scoped Load Events

The `#waitForLoadEvent` helper subscribes to `Page.domContentEventFired` or `Page.loadEventFired` with the page's sessionId. This means load events from other pages do not trigger the handler, preventing non-deterministic behavior in multi-page scenarios.

### Selector Error Classification

When `#waitForSelector` times out, it throws `BrowserSelectorError` instead of the generic `BrowserError`, enabling error categorization in the BrowserTool.

### Methods

| Method                               | Returns                             | Description                            |
| ------------------------------------ | ----------------------------------- | -------------------------------------- |
| `title()`                            | `Promise<string>`                   | Resolve document title                 |
| `navigate(url, options?)`            | `Promise<void>`                     | Navigate and wait for load condition   |
| `content()`                          | `Promise<BrowserContentResult>`     | Extract URL, title, HTML, and text     |
| `screenshot(options?)`               | `Promise<BrowserScreenshotResult>`  | Capture PNG or JPEG image              |
| `click(selector, options?)`          | `Promise<void>`                     | Click element matching selector        |
| `fill(selector, value, options?)`    | `Promise<void>`                     | Type text into input element           |
| `select(selector, values, options?)` | `Promise<void>`                     | Choose options in a `<select>` element |
| `evaluate(expression)`               | `Promise<unknown>`                  | Execute JavaScript in page context     |
| `wait(selector, options?)`           | `Promise<void>`                     | Wait for element to appear             |
| `frame(name)`                        | `BrowserPageInterface \| undefined` | Look up child frame by name            |
| `frames()`                           | `readonly BrowserPageInterface[]`   | All child frames                       |
| `codegen(options?)`                  | `Promise<BrowserCodegenInterface>`  | Start (or retrieve) the page recorder  |
| `close()`                            | `Promise<void>`                     | Close the page (no-op on frames)       |

### Codegen Lifecycle

`page.codegen()` memoizes a single `BrowserCodegen` per page. Calling it twice returns the same instance; the recorder is torn down automatically by `page.close()`. See the [BrowserCodegen](#browsercodegen) section below for full details.

---

## BrowserCodegen

Records user interactions against a live page and compiles them into a runnable `@scsr/server` script. The recorder installs a runtime binding (`__scsrBrowserCodegen`) plus an injected listener that forwards trusted `click`, `input`, and `change` events — no patching of `document.addEventListener`, no synthetic dispatch, and no external dependencies.

### Key Features

- **Trusted events only**: the injected listener filters `event.isTrusted`, so programmatic scripts do not pollute the recording. Tests invoke the binding directly via `globalThis.__scsrBrowserCodegen(...)` to bypass this.
- **Stable selectors**: priority chain — `data-testid` > `id` > `name` > `aria-label` > structural path (`tag:nth-of-type(n) > ...`).
- **Navigation capture**: main-frame `Page.frameNavigated` events become `navigate` actions; subframe navigations are ignored.
- **Normalization**: consecutive `fill` / `select` on the same selector collapse into the latest value; duplicate consecutive `navigate` to the same URL is deduped.
- **Script compilation**: pure helper emits TypeScript that imports `createBrowser`, or just the body when `wrap: false` is passed.
- **Session-scoped CDP**: every subscription is scoped to the page sessionId — other pages do not leak actions into this recorder.

### Properties

| Property  | Type                                       | Description                     |
| --------- | ------------------------------------------ | ------------------------------- |
| `emitter` | `EmitterInterface<BrowserCodegenEventMap>` | Typed event emitter             |
| `started` | `boolean`                                  | `true` after `start()` resolved |

### Methods

| Method             | Returns                                    | Description                                        |
| ------------------ | ------------------------------------------ | -------------------------------------------------- |
| `start()`          | `Promise<void>`                            | Install the binding and subscriptions (idempotent) |
| `stop()`           | `Promise<readonly BrowserCodegenAction[]>` | Detach listeners and return the action snapshot    |
| `actions()`        | `readonly BrowserCodegenAction[]`          | Normalized snapshot of recorded actions            |
| `script(options?)` | `string`                                   | Compile actions into TypeScript (see options)      |
| `clear()`          | `void`                                     | Drop the action log and emit `clear`               |
| `destroy()`        | `Promise<void>`                            | Stop, clear the log, and destroy the emitter       |

### Events (`BrowserCodegenEventMap`)

| Event    | Args                                       | When                                   |
| -------- | ------------------------------------------ | -------------------------------------- |
| `start`  | (none)                                     | `start()` completed for the first time |
| `action` | `action: BrowserCodegenAction`             | An action was appended to the log      |
| `stop`   | `actions: readonly BrowserCodegenAction[]` | `stop()` detached listeners            |
| `clear`  | (none)                                     | `clear()` emptied the action log       |

### Actions (`BrowserCodegenAction`)

Discriminated union on `type`:

| Type       | Shape                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| `click`    | `{ type: 'click', selector: string, timestamp: number }`                             |
| `fill`     | `{ type: 'fill', selector: string, value: string, timestamp: number }`               |
| `select`   | `{ type: 'select', selector: string, values: readonly string[], timestamp: number }` |
| `navigate` | `{ type: 'navigate', url: string, timestamp: number }`                               |

### Script Options (`BrowserCodegenScriptOptions`)

| Property   | Type      | Default          | Description                                                  |
| ---------- | --------- | ---------------- | ------------------------------------------------------------ |
| `engine`   | `string`  | `'chromium'`     | Engine name inserted into `createBrowser({ engine })`        |
| `headless` | `boolean` | `true`           | Headless flag inserted into the emitted `createBrowser` call |
| `import`   | `string`  | `'@scsr/server'` | Module specifier for the emitted `import { createBrowser }`  |
| `wrap`     | `boolean` | `true`           | When `false`, emit only the action body (no boilerplate)     |

---

## BrowserTool

MCP tool wrapper for browser automation with stable page IDs, store integration, error categorization, and content truncation.

### Key Features

- **Stable page IDs**: Pages tracked by Map with auto-incrementing IDs (`page-1`, `page-2`, etc.) that survive close operations
- **Store integration**: Session snapshots persist to `MCPStoreManagerInterface` on page creation, navigation, and close
- **Error categorization**: Every failure includes a `BrowserErrorCategory` for LLM strategy adjustment
- **Content truncation**: Text extraction capped at `maxContentLength` (default 50k chars) to prevent token overflow
- **New operations**: `create`, `scroll`, `hover`, `disconnect`, `reconnect`

### Properties

| Property      | Type                                    | Description                           |
| ------------- | --------------------------------------- | ------------------------------------- |
| `name`        | `string`                                | Tool name                             |
| `summary`     | `string`                                | Short summary                         |
| `description` | `string`                                | Full description for the LLM          |
| `parameters`  | `JsonSchemaObject`                      | JSON Schema for tool arguments        |
| `browser`     | `BrowserInterface`                      | Underlying browser instance           |
| `connected`   | `boolean`                               | Whether the browser is connected      |
| `stores`      | `MCPStoreManagerInterface \| undefined` | Store manager for session persistence |

### Public Accessors

| Method     | Returns                                     | Description                   |
| ---------- | ------------------------------------------- | ----------------------------- |
| `page(id)` | `BrowserPageInterface \| undefined`         | Look up ONE page by stable ID |
| `pages()`  | `ReadonlyMap<string, BrowserPageInterface>` | All tracked pages             |

### Operations

| Operation    | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `launch`     | Connect browser, sync pages, create default if empty        |
| `create`     | Create a new page with optional URL, returns stable page ID |
| `navigate`   | Navigate a page to URL with optional load condition         |
| `content`    | Extract text content (truncated), title, URL                |
| `screenshot` | Capture PNG/JPEG, returns base64                            |
| `click`      | Click element by CSS selector                               |
| `fill`       | Fill input by selector with value                           |
| `select`     | Select option(s) in a `<select>` element                    |
| `evaluate`   | Execute JavaScript expression in page context               |
| `wait`       | Wait for element matching CSS selector                      |
| `scroll`     | Scroll to element by selector or x/y coordinates            |
| `hover`      | Hover over element by CSS selector                          |
| `pages`      | List all tracked pages with IDs, URLs, and indices          |
| `close`      | Close page by index, remove from tracking                   |
| `disconnect` | Disconnect from browser without destroying                  |
| `reconnect`  | Re-establish browser connection                             |
| `status`     | Connection status, engine, pages, contexts count            |

### Error Categories (`BrowserErrorCategory`)

| Category     | When                                                       |
| ------------ | ---------------------------------------------------------- |
| `connection` | Browser not connected, connection failed, WebSocket closed |
| `navigation` | Page navigation failed (bad URL, refused, net error)       |
| `timeout`    | Any operation exceeded the configured timeout              |
| `selector`   | CSS selector did not match any element within timeout      |
| `evaluation` | JavaScript evaluation threw an exception                   |
| `screenshot` | Screenshot capture failed (no data returned)               |
| `destroyed`  | Browser or page has been destroyed                         |
| `unknown`    | Unclassified error                                         |

### Session Persistence (`BrowserSessionSnapshot`)

```ts
interface BrowserSessionSnapshot {
	readonly id: string // 'browser-session'
	readonly created: number // timestamp
	readonly pages: readonly BrowserPageInfo[]
	readonly connected: boolean
}
```

Snapshots are written to the store on page creation, navigation, close, and destroy. They are NOT used to auto-reopen pages on restart — the browser process from the previous run is dead. The snapshot provides context the LLM can inspect via the `status` operation.

### BrowserToolInput

| Property           | Type                       | Default     | Description                           |
| ------------------ | -------------------------- | ----------- | ------------------------------------- |
| `name`             | `string`                   | (required)  | Tool name                             |
| `summary`          | `string`                   | (required)  | Short summary                         |
| `description`      | `string`                   | (required)  | Full description for the LLM          |
| `browser`          | `BrowserInterface`         | (auto)      | Pre-existing browser instance         |
| `headless`         | `boolean`                  | `true`      | Launch in headless mode               |
| `executable`       | `string`                   | (auto)      | Path to browser executable            |
| `profile`          | `string`                   | `undefined` | Persistent profile directory          |
| `cdp`              | `BrowserCdp`               | `undefined` | CDP connection options                |
| `timeout`          | `number`                   | `30_000`    | Default timeout                       |
| `viewport`         | `BrowserViewport`          | `undefined` | Default viewport dimensions           |
| `args`             | `readonly string[]`        | `[]`        | Additional browser CLI flags          |
| `stores`           | `MCPStoreManagerInterface` | `undefined` | Store manager for session persistence |
| `maxContentLength` | `number`                   | `50_000`    | Max chars for content extraction      |

### BrowserToolResult

| Field       | Type                                | Description                            |
| ----------- | ----------------------------------- | -------------------------------------- |
| `operation` | `BrowserToolOperation`              | The operation that was executed        |
| `ok`        | `boolean`                           | `true` when the operation succeeded    |
| `output`    | `unknown`                           | Structured result data                 |
| `error`     | `string \| undefined`               | Error message when `ok` is false       |
| `category`  | `BrowserErrorCategory \| undefined` | Error category, `undefined` on success |
| `duration`  | `number`                            | Wall-clock time in milliseconds        |

---

## BrowserContext

An isolated browsing session with independent cookies, storage, and cache — equivalent to an incognito window.

### Properties

| Property | Type                  | Description                                                  |
| -------- | --------------------- | ------------------------------------------------------------ |
| `id`     | `string \| undefined` | CDP browser context ID (`undefined` for the default context) |

### Methods

| Method             | Returns                             | Description                        |
| ------------------ | ----------------------------------- | ---------------------------------- |
| `page(index?)`     | `BrowserPageInterface \| undefined` | One page by index (default: first) |
| `pages()`          | `readonly BrowserPageInterface[]`   | All pages in creation order        |
| `create(options?)` | `Promise<BrowserPageInterface>`     | Open a new page in this context    |
| `close()`          | `Promise<void>`                     | Close context and all its pages    |

### Viewport Application

When a viewport is configured (via `BrowserPageOptions.viewport` or the context default), `create()` sends `Emulation.setDeviceMetricsOverride` to the CDP session after enabling page and runtime domains. This ensures the viewport is applied before any navigation.

### Real CDP Context Isolation

When a `BrowserContext` has an `id` (assigned via `Target.createBrowserContext`), new pages include `browserContextId` in `Target.createTarget`. On close, the context is disposed via `Target.disposeBrowserContext`.

---

## BrowserPage

Individual page or frame with full interaction capabilities. Child frames expose the same `BrowserPageInterface`.

### Properties

| Property | Type      | Description                                       |
| -------- | --------- | ------------------------------------------------- |
| `id`     | `string`  | CDP target ID — stable identifier for this page   |
| `url`    | `string`  | Current page URL                                  |
| `closed` | `boolean` | `true` after `close()` or external close detected |

### External Close Detection

Each page subscribes to `Target.targetDestroyed` on construction. When the target is closed externally (e.g. user closes a tab), the `closed` property becomes `true` automatically. The subscription is removed when `close()` is called to prevent duplicate cleanup.

### Session-Scoped Load Events

The `#waitForLoadEvent` helper subscribes to `Page.domContentEventFired` or `Page.loadEventFired` with the page's sessionId. This means load events from other pages do not trigger the handler, preventing non-deterministic behavior in multi-page scenarios.

### Selector Error Classification

When `#waitForSelector` times out, it throws `BrowserSelectorError` instead of the generic `BrowserError`, enabling error categorization in the BrowserTool.

### Methods

| Method             | Returns                                | Description                                  |
| ------------------ | -------------------------------------- | -------------------------------------------- |
| `discover()`       | `Promise<BrowserDiscoveryResult>`      | Passive CDP probe — no side effects          |
| `connect()`        | `Promise<void>`                        | Connect using the strategy above             |
| `disconnect()`     | `void`                                 | Detach from browser without closing it       |
| `context(index?)`  | `BrowserContextInterface \| undefined` | One context by index (default: first)        |
| `contexts()`       | `readonly BrowserContextInterface[]`   | All contexts in creation order               |
| `create(options?)` | `Promise<BrowserPageInterface>`        | Shortcut — open page in default context      |
| `destroy()`        | `Promise<void>`                        | Close browser process, release all resources |

### Events (`BrowserEventMap`)

| Event        | Args                             | When                                 |
| ------------ | -------------------------------- | ------------------------------------ |
| `idle`       | (none)                           | Browser transitions to idle status   |
| `connect`    | `connection: BrowserConnection`  | Connection established               |
| `disconnect` | (none)                           | Browser disconnected (not destroyed) |
| `launch`     | `engine: BrowserEngine`          | New browser process launched         |
| `discover`   | `result: BrowserDiscoveryResult` | CDP discovery probe completed        |
| `error`      | `error: unknown`                 | Connection attempt failed            |
| `destroy`    | (none)                           | Browser permanently destroyed        |
| `page`       | `page: BrowserPageInterface`     | A new page created via `create()`    |

### Create

```ts
import { createBrowser } from '@scsr/server'

const browser = createBrowser({
	engine: 'chromium',
	headless: true,
	timeout: 30_000,
	on: {
		connect: (connection) => console.log('connected:', connection),
		error: (error) => console.error('browser error:', error),
		page: (page) => console.log('new page:', page.url),
	},
})
```

---

## BrowserTool

MCP tool wrapper for browser automation with stable page IDs, store integration, error categorization, and content truncation.

### Key Features

- **Stable page IDs**: Pages tracked by Map with auto-incrementing IDs (`page-1`, `page-2`, etc.) that survive close operations
- **Store integration**: Session snapshots persist to `MCPStoreManagerInterface` on page creation, navigation, and close
- **Error categorization**: Every failure includes a `BrowserErrorCategory` for LLM strategy adjustment
- **Content truncation**: Text extraction capped at `maxContentLength` (default 50k chars) to prevent token overflow
- **New operations**: `create`, `scroll`, `hover`, `disconnect`, `reconnect`

### Properties

| Property      | Type                                    | Description                           |
| ------------- | --------------------------------------- | ------------------------------------- |
| `name`        | `string`                                | Tool name                             |
| `summary`     | `string`                                | Short summary                         |
| `description` | `string`                                | Full description for the LLM          |
| `parameters`  | `JsonSchemaObject`                      | JSON Schema for tool arguments        |
| `browser`     | `BrowserInterface`                      | Underlying browser instance           |
| `connected`   | `boolean`                               | Whether the browser is connected      |
| `stores`      | `MCPStoreManagerInterface \| undefined` | Store manager for session persistence |

### Public Accessors

| Method     | Returns                                     | Description                   |
| ---------- | ------------------------------------------- | ----------------------------- |
| `page(id)` | `BrowserPageInterface \| undefined`         | Look up ONE page by stable ID |
| `pages()`  | `ReadonlyMap<string, BrowserPageInterface>` | All tracked pages             |

### Operations

| Operation    | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `launch`     | Connect browser, sync pages, create default if empty        |
| `create`     | Create a new page with optional URL, returns stable page ID |
| `navigate`   | Navigate a page to URL with optional load condition         |
| `content`    | Extract text content (truncated), title, URL                |
| `screenshot` | Capture PNG/JPEG, returns base64                            |
| `click`      | Click element by CSS selector                               |
| `fill`       | Fill input by selector with value                           |
| `select`     | Select option(s) in a `<select>` element                    |
| `evaluate`   | Execute JavaScript expression in page context               |
| `wait`       | Wait for element matching CSS selector                      |
| `scroll`     | Scroll to element by selector or x/y coordinates            |
| `hover`      | Hover over element by CSS selector                          |
| `pages`      | List all tracked pages with IDs, URLs, and indices          |
| `close`      | Close page by index, remove from tracking                   |
| `disconnect` | Disconnect from browser without destroying                  |
| `reconnect`  | Re-establish browser connection                             |
| `status`     | Connection status, engine, pages, contexts count            |

### Error Categories (`BrowserErrorCategory`)

| Category     | When                                                       |
| ------------ | ---------------------------------------------------------- |
| `connection` | Browser not connected, connection failed, WebSocket closed |
| `navigation` | Page navigation failed (bad URL, refused, net error)       |
| `timeout`    | Any operation exceeded the configured timeout              |
| `selector`   | CSS selector did not match any element within timeout      |
| `evaluation` | JavaScript evaluation threw an exception                   |
| `screenshot` | Screenshot capture failed (no data returned)               |
| `destroyed`  | Browser or page has been destroyed                         |
| `unknown`    | Unclassified error                                         |

### Session Persistence (`BrowserSessionSnapshot`)

```ts
interface BrowserSessionSnapshot {
	readonly id: string // 'browser-session'
	readonly created: number // timestamp
	readonly pages: readonly BrowserPageInfo[]
	readonly connected: boolean
}
```

Snapshots are written to the store on page creation, navigation, close, and destroy. They are NOT used to auto-reopen pages on restart — the browser process from the previous run is dead. The snapshot provides context the LLM can inspect via the `status` operation.

### BrowserToolInput

| Property           | Type                       | Default     | Description                           |
| ------------------ | -------------------------- | ----------- | ------------------------------------- |
| `name`             | `string`                   | (required)  | Tool name                             |
| `summary`          | `string`                   | (required)  | Short summary                         |
| `description`      | `string`                   | (required)  | Full description for the LLM          |
| `browser`          | `BrowserInterface`         | (auto)      | Pre-existing browser instance         |
| `headless`         | `boolean`                  | `true`      | Launch in headless mode               |
| `executable`       | `string`                   | (auto)      | Path to browser executable            |
| `profile`          | `string`                   | `undefined` | Persistent profile directory          |
| `cdp`              | `BrowserCdp`               | `undefined` | CDP connection options                |
| `timeout`          | `number`                   | `30_000`    | Default timeout                       |
| `viewport`         | `BrowserViewport`          | `undefined` | Default viewport dimensions           |
| `args`             | `readonly string[]`        | `[]`        | Additional browser CLI flags          |
| `stores`           | `MCPStoreManagerInterface` | `undefined` | Store manager for session persistence |
| `maxContentLength` | `number`                   | `50_000`    | Max chars for content extraction      |

### BrowserToolResult

| Field       | Type                                | Description                            |
| ----------- | ----------------------------------- | -------------------------------------- |
| `operation` | `BrowserToolOperation`              | The operation that was executed        |
| `ok`        | `boolean`                           | `true` when the operation succeeded    |
| `output`    | `unknown`                           | Structured result data                 |
| `error`     | `string \| undefined`               | Error message when `ok` is false       |
| `category`  | `BrowserErrorCategory \| undefined` | Error category, `undefined` on success |
| `duration`  | `number`                            | Wall-clock time in milliseconds        |

---

## Options Reference

### BrowserOptions

| Property     | Type                            | Default      | Description                            |
| ------------ | ------------------------------- | ------------ | -------------------------------------- |
| `engine`     | `BrowserEngine`                 | `'chromium'` | Browser engine to use                  |
| `headless`   | `boolean`                       | `true`       | Launch in headless mode                |
| `executable` | `string`                        | (auto)       | Absolute path to custom browser binary |
| `profile`    | `string`                        | `undefined`  | Persistent profile directory path      |
| `cdp`        | `BrowserCdp`                    | `undefined`  | CDP options: `{ port?, endpoint? }`    |
| `timeout`    | `number`                        | `30_000`     | Connection and navigation timeout (ms) |
| `viewport`   | `BrowserViewport`               | `undefined`  | Default viewport dimensions            |
| `signal`     | `AbortSignal`                   | `undefined`  | External signal for cancellation       |
| `args`       | `readonly string[]`             | `[]`         | Additional browser process CLI flags   |
| `on`         | `EmitterHooks<BrowserEventMap>` | `undefined`  | Initial event listeners                |

### BrowserPageOptions

| Property   | Type              | Default     | Description                         |
| ---------- | ----------------- | ----------- | ----------------------------------- |
| `url`      | `string`          | `undefined` | Navigate to this URL after creation |
| `viewport` | `BrowserViewport` | `undefined` | Override default viewport           |
| `timeout`  | `number`          | `undefined` | Navigation timeout for initial URL  |

### BrowserNavigationOptions

| Property    | Type          | Default     | Description                     |
| ----------- | ------------- | ----------- | ------------------------------- |
| `condition` | `BrowserLoad` | `'load'`    | Page load condition to wait for |
| `timeout`   | `number`      | `undefined` | Navigation timeout (ms)         |

### BrowserScreenshotOptions

| Property  | Type              | Default     | Description                  |
| --------- | ----------------- | ----------- | ---------------------------- |
| `path`    | `string`          | `undefined` | Save screenshot to this path |
| `full`    | `boolean`         | `false`     | Capture full scrollable page |
| `type`    | `'png' \| 'jpeg'` | `'png'`     | Image format                 |
| `quality` | `number`          | `undefined` | JPEG quality 0–100           |

---

## Factory Functions

| Factory         | Creates            | Package        |
| --------------- | ------------------ | -------------- |
| `createBrowser` | `BrowserInterface` | `@scsr/server` |

---

## File Layout

```
src/server/browsers/
├── Browser.ts         # Browser lifecycle, connection strategy, external disconnect detection
├── BrowserContext.ts  # Isolated browsing session (incognito-equivalent)
├── BrowserPage.ts     # Page and frame interaction API
├── BrowserCodegen.ts  # Action recorder + TypeScript script compiler
└── CDPClient.ts       # Lightweight CDP JSON-RPC client over WebSocket
```

Shared pure logic lives in the centralized files: the injected recorder source and binding name live in `src/server/constants.ts`, and the action parser / normalizer / script compiler live in `src/server/helpers.ts`.

---

## Types Reference

| Type                          | Purpose                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `BrowserEngine`               | `'chromium'`                                                                                 |
| `BrowserStatus`               | `'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error'`                         |
| `BrowserLoad`                 | Page load wait condition: `'load'`, `'domcontentloaded'`, `'networkidle'`                    |
| `BrowserErrorCategory`        | Error classification: `'connection'`, `'navigation'`, `'timeout'`, `'selector'`, etc.        |
| `BrowserViewport`             | `{ width: number, height: number }` viewport dimensions                                      |
| `BrowserCdp`                  | CDP options: `{ port?: number, endpoint?: string }`                                          |
| `BrowserConnection`           | Active connection descriptor with mode and endpoint                                          |
| `BrowserDiscoveryResult`      | Result of passive CDP probe (found flag, endpoint)                                           |
| `BrowserContentResult`        | `{ url, title, html, text }` extracted page content                                          |
| `BrowserScreenshotResult`     | `{ bytes: Uint8Array, path: string \| undefined }`                                           |
| `BrowserPageInfo`             | `{ id, url, title, index }` serializable page snapshot                                       |
| `BrowserSessionSnapshot`      | `{ id, created, pages, connected }` persisted session state                                  |
| `BrowserToolOperation`        | All 17 operations: `launch`, `create`, `navigate`, `content`, etc.                           |
| `BrowserToolInput`            | Input for constructing a BrowserTool (with stores, maxContentLength)                         |
| `BrowserToolResult`           | Typed result with operation, ok, output, error, category, duration                           |
| `BrowserEventMap`             | Event map: `idle`, `connect`, `disconnect`, `launch`, `discover`, `error`, `destroy`, `page` |
| `BrowserOptions`              | Options for creating a Browser                                                               |
| `BrowserPageOptions`          | Options for creating a page (`url`, `viewport`, `timeout`)                                   |
| `BrowserNavigationOptions`    | Navigation options (`condition`, `timeout`)                                                  |
| `BrowserActionOptions`        | Element interaction options (`timeout`)                                                      |
| `BrowserScreenshotOptions`    | Screenshot options (`path`, `full`, `type`, `quality`)                                       |
| `CdpClientInterface`          | CDP client with session-scoped subscriptions, reconnect, endpoint                            |
| `BrowserInterface`            | Browser lifecycle with context management and typed emitter                                  |
| `BrowserContextInterface`     | Isolated session with id, page management (`page`, `pages`, `create`, `close`)               |
| `BrowserPageInterface`        | Full page interaction with id property — navigate, click, fill, evaluate, screenshot, frames |
| `BrowserCodegenAction`        | Discriminated union of recorded actions (`click`, `fill`, `select`, `navigate`)              |
| `BrowserCodegenEventMap`      | Event map: `start`, `action`, `stop`, `clear`                                                |
| `BrowserCodegenOptions`       | Options for the recorder (`on` hooks)                                                        |
| `BrowserCodegenScriptOptions` | Options controlling `script()` output (`engine`, `headless`, `import`, `wrap`)               |
| `BrowserCodegenInterface`     | Recorder API — `start`, `stop`, `actions`, `script`, `clear`, `destroy`                      |
| `BrowserToolInterface`        | MCP tool with stores, page/pages accessors, init/destroy lifecycle                           |

---

## Usage

### Launch and Scrape

```ts
import { createBrowser } from '@scsr/server'

const browser = createBrowser({ engine: 'chromium', headless: true })
await browser.connect()

const page = await browser.create({ url: 'https://example.com' })
const result = await page.content()

console.log(result.title)
console.log(result.text)

await browser.destroy()
```

### Connect to Running Browser via CDP

```ts
const browser = createBrowser({
	engine: 'chromium',
	cdp: { port: 9222 }, // probe localhost:9222 for existing browser
})

await browser.connect()
// Connects to the existing session — does not close it on disconnect()
```

### Isolated Contexts

```ts
await browser.connect()

// Default context — shared session
const ctx = browser.context()
const page1 = await ctx.create()

// New isolated context — independent cookies and storage
const page2 = await browser.create()
```

### Page Interaction

```ts
const page = await browser.create()

await page.navigate('https://example.com/login')
await page.fill('#email', 'user@example.com')
await page.fill('#password', 'secret')
await page.click('#submit')

// Wait for navigation to complete
await page.wait('.dashboard')
const result = await page.content()
console.log(result.url) // https://example.com/dashboard
```

### Screenshots

```ts
const page = await browser.create({ url: 'https://example.com' })

// Capture to memory
const result = await page.screenshot({ type: 'png' })
// result.bytes → Uint8Array

// Save full-page screenshot to disk
await page.screenshot({ path: 'capture.png', full: true })
```

### JavaScript Evaluation

```ts
const page = await browser.create({ url: 'https://example.com' })

const links = await page.evaluate(`
    Array.from(document.querySelectorAll('a'))
        .map(a => ({ text: a.textContent, href: a.href }))
`)
```

### Record and Generate a Script

```ts
const page = await browser.create({ url: 'https://example.com/login' })

// Start the recorder; options.on attaches typed hooks
const codegen = await page.codegen({
	on: {
		action: (action) => console.log('recorded:', action),
	},
})

// ... user interacts with the page ...

// Snapshot the actions and compile to TypeScript
const script = codegen.script({ headless: false })
console.log(script)

// Emit just the action body (no boilerplate)
const body = codegen.script({ wrap: false })

// Stop or tear down when done
await codegen.destroy()
```

Calling `page.codegen()` a second time returns the same recorder instance; `page.close()` tears it down automatically.

### Event Observation

```ts
const browser = createBrowser({
	engine: 'chromium',
	on: {
		connect: (conn) => logger.info('browser connected', conn),
		disconnect: () => logger.warn('browser disconnected'),
		error: (err) => logger.error('browser error', err),
		page: (page) => logger.debug('new page', page.url),
	},
})

await browser.connect()
```

---

## Test Structure

| Test                                               | Source                                  |
| -------------------------------------------------- | --------------------------------------- |
| `tests/src/server/browsers/Browser.test.ts`        | `src/server/browsers/Browser.ts`        |
| `tests/src/server/browsers/BrowserContext.test.ts` | `src/server/browsers/BrowserContext.ts` |
| `tests/src/server/browsers/BrowserPage.test.ts`    | `src/server/browsers/BrowserPage.ts`    |
| `tests/src/server/browsers/BrowserCodegen.test.ts` | `src/server/browsers/BrowserCodegen.ts` |
| `tests/src/server/mcp/tools/BrowserTool.test.ts`   | `src/server/mcp/tools/BrowserTool.ts`   |

---

## Best Practices

1. **Always call `destroy()` after use** — closes the browser process and releases CDP resources
2. **Use `disconnect()` for CDP connections** — detaches without closing the existing browser session
3. **Use isolated contexts for parallel sessions** — each context has independent cookies and storage
4. **Set `timeout` appropriately** — default is 30 seconds; increase for slow networks
5. **Check `connected` before creating pages** — detects external disconnects lazily before calling `create()`
6. **Use `wait(selector)` before interaction** — ensures elements are rendered before `click()` or `fill()`
7. **Use `discover()` to probe before connecting** — passive and side-effect-free
8. **Subscribe to `error` events** — connection failures emit here rather than throwing
9. **Non-headless mode works reliably** — the singleton prevention via `--user-data-dir` ensures the launched browser stays alive
10. **Use stable page IDs from `create` results** — survive across close operations
11. **Pass `stores` to BrowserTool** — enables session persistence across server restarts
12. **Check `category` on failures** — enables LLM strategy adjustment (reconnect vs different selector vs wait longer)
13. **Use `maxContentLength`** — prevents token overflow when extracting from large pages
