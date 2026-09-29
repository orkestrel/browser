# Proposal: `@orkestrel/browser` as the agent's browser (objective lane)

## Lane

This is the objective lane: correctness, constraints, what the contracts and rules permit, what the DevTools Protocol permits, adverse orderings, and what the proofs must show. The Codex Astra bench is dark, so Opus holds the lane in a clean context. Names that appear in this proposal are placeholders an executor can build against. Every naming judgment is listed under `Tensions` for the subjective lane or the Orchestrator to rule.

## Design

### Summary

The package keeps the CDP client, `Browser` lifecycle, context, page, and frame entities. It adds one agent engine in `src/core`: `BrowserDriver`. The driver runs over a placement-supplied `BrowserSurfaceInterface` and publishes one tool vocabulary as `@orkestrel/tool` `ToolInterface` values. Two placements implement the surface:

- `CDPSurface` in `src/core`. It drives a `BrowserPageInterface` with native `Accessibility`, `DOM`, `Input`, `Page`, and `Runtime` commands.
- `DocumentSurface` in `src/browser`. It drives the document it runs in with native DOM APIs.

Around the driver:

- **Reading.** `BrowserReader` composes `@orkestrel/html` and `@orkestrel/markdown` over a surface's captured HTML. It holds the capture per document generation, applies a character bound, and drops captures on navigation events.
- **WebMCP outside the browser.** `BrowserRegistry` mirrors the page's own tools through the experimental `WebMCP` domain. The domain is the only route; the design refuses a `Runtime.evaluate` path over `document.modelContext`.
- **WebMCP inside the browser.** `@orkestrel/mcp`'s bridge already covers it. This package supplies the DOM-native tool set that bridge publishes and nothing else.
- **Waits and polling.** Every wait parks on a protocol event, a DOM observer, or an abort signal. The in-page `setInterval` and `setTimeout` pollers go. `waitForCDPReady` becomes a read of the child's stderr line. One bounded process-group drain has no event source and is listed under `Tensions`.

### Environment map

The following table gives each environment's ownership after the redesign and its import edges.

| Environment | Owns | Imports |
| --- | --- | --- |
| `src/core` (`ESNext`, `WebWorker`, no DOM, no Node) | `CDPClient` and `CDPTransportInterface`; `BrowserContext`, `BrowserPage`, `BrowserFrame`, and the retained managers; the surface contract `BrowserSurfaceInterface`; `CDPSurface` in `src/core/surfaces/`; `BrowserDriver` (refs, focus, serialization, dialogs, tool vocabulary); `BrowserReader`; `BrowserRegistry` (the `WebMCP` domain); compiled in-page expressions evaluated in an isolated world; tool copy and limits as constants | `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/markdown` (runtime, authorized), `@orkestrel/tool` (runtime, needs authorization; see `Tensions`) |
| `src/browser` (`ESNext`, `DOM`, `DOM.Iterable`) | `DocumentSurface` in `src/browser/surfaces/` (DOM-native outline, markup, click, type, select, wait); role and accessible-name computation helpers and tables; `SocketCDPTransport` in `src/browser/transports/` (native `WebSocket` CDP transport); `createDocumentDriver` | `@src/core` (published as `@orkestrel/browser`), `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/tool` (types and `createTool` through core) |
| `src/server` (`ESNext`, Node) | `Browser` (discover, connect, launch, adopt, disconnect, destroy, close, contexts, ownership, process groups); `WebSocketCDPTransport`; `FileBrowserWriter`; system-browser discovery; the stderr endpoint read that replaces `waitForCDPReady` | `@src/core`, `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/websocket`, `node:*` |

No environment imports `@orkestrel/mcp`. `src/browser` and `src/server` never import each other (`../scaffold/AGENTS.md:25`).

### Placements and reach (question 1)

The following list names each placement, the surface it uses, and how it reaches tools outside itself.

- **Node process over CDP.** `createBrowserDriver({ page })` builds a `CDPSurface` and a driver. A consumer puts `driver.tools` into its own `ToolManagerInterface`. It hosts that manager over MCP with `@orkestrel/mcp/server` (`createStdioServer`, `createMCPRoutes`) or hands it to an agent. No `browser → mcp` edge exists.
- **Page or same-origin iframe.** `createDocumentDriver({ document })` builds a `DocumentSurface` and a driver. Tools outside the browser are reached through the mcp browser face, which this package does not wrap:
  - an MCP client over `createWebSocketClientTransport` or `createHTTPClientTransport`, which can call a Node-hosted CDP driver published over MCP;
  - `createPageServer` or `createModelContext().publish(tools)` to hand the DOM tool set to other in-page or built-in agents.
- **Dedicated or service worker.** A worker has no `document`, so `DocumentSurface` cannot run there. A worker can host a `CDPSurface` over `SocketCDPTransport`, because `WebSocket` exists in workers. It is placed in `src/browser` because `src/core` admits no `WebSocket` (`guides/browser.md:1859-1861`).
- **Extension.**
  - A content script can host `DocumentSurface`. It runs in an isolated world, and P5 shows an isolated world cannot see `document.modelContext`, so a content script's `call` tool cannot adopt the page's WebMCP tools. That is a recorded limit.
  - An extension page or service worker can drive CDP through `SocketCDPTransport`, provided the driven Chrome is started with `--remote-allow-origins` naming the extension origin.
  - `chrome.debugger` is refused this round (see `Measurements`).

### Tool vocabulary (question 2)

**Naming rule.** A tool name is one lowercase English verb, matching `^[a-z]+$`, with no product prefix. A single word is the shortest name a small model copies reliably. It sits inside every provider's function-name charset (`[A-Za-z0-9_-]{1,64}`), and it mirrors the fleet's one-word member law in data. Page-registered WebMCP tools never become top-level names. They are reached through `call`, so no page can register a name that replaces a generic tool. `ToolManagerInterface.add` overwrites an existing name (`../tool/src/core/types.ts:207-219`), so a page tool named `click` added beside the generic set would replace the agent's `click`.

**Registry.** The registry is not a page member. `BrowserDriver.tools` is a readonly array of `ToolInterface` values, and the consumer adds it to the `ToolManagerInterface` it owns. The advertised set is static for a driver's life: 9 tools on the CDP placement and 7 on the DOM placement, because `open` and `press` are absent there. A static set needs no reading of whether an agent re-reads definitions per turn, and it keeps the prompt prefix stable.

**Scope.** A driver is scoped to one browser context through a focus page. It starts on the page it was given. Focus follows a popup opened by the focused page and returns to the opener when the popup closes. Every result that crossed a focus change names it.

The following table defines each tool. Results are text a model reads, and every result is bounded (see `Small-model fit`).

| Tool | Parameters | Annotations | Result | CDP implementation | DOM-native implementation |
| --- | --- | --- | --- | --- | --- |
| `look` | `ref?: string` (subtree root) | `pure`, `untrusted` | Header `page "TITLE" URL`, then one row per node, `role "name" [eN]`, with `value="…"` and states (`disabled`, `checked`, `expanded`, `selected`) appended. A trailing `page tools: NAME, NAME@f1 (use call)` line appears when the page registers tools. A truncation footer names how many rows were left out and how to scope with `ref`. | Wait for `DOMContentLoaded` of the current loader (`Page.lifecycleEvent`). `Accessibility.getFullAXTree({ frameId })` on the page session; for each `Iframe` row, repeat on that frame's session (an OOPIF has its own session). Drop ignored, `none`, `generic`, `StaticText`, and `InlineTextBox` rows (P8). Trim and collapse names (P8 `"Email "`). The node key is `SESSION:BACKEND` from `backendDOMNodeId`. | Walk `document` depth-first, entering open shadow roots and same-origin iframe documents. Skip nodes that fail `Element.checkVisibility()` and nodes with `hidden` or `aria-hidden="true"`. Role comes from the `role` attribute's first token or the HTML-AAM implicit-role table. Name comes from a bounded accessible-name computation: `aria-labelledby`, `aria-label`, `label`, `alt` and `title`, content for name-from-content roles, then `placeholder`. The key comes from a `WeakMap<Element, string>` counter. A cross-origin iframe row reads `iframe "TITLE" (cross-origin, not readable)`. |
| `read` | `ref?: string`, `offset?: number`, `whole?: boolean` | `pure`, `untrusted` | Markdown excerpt of at most `limit.reading` characters. When text remains, a footer names the next offset: `[N more characters; call read with offset M]`. | Through `BrowserReader`. `CDPSurface.markup` evaluates the guarded `document.documentElement.outerHTML` in a cached isolated world (`BROWSER_RESULT_LIMIT` guard). For a `ref`, `DOM.resolveNode({ backendNodeId, executionContextId })` then `Runtime.callFunctionOn` reads the guarded `this.outerHTML`; an `Iframe` ref reads that frame's document on its session. | Through `BrowserReader`. `DocumentSurface.markup` reads `outerHTML` in-page. The reader refuses a string longer than `BROWSER_RESULT_LIMIT` before parsing. |
| `click` | `ref: string` | none | `clicked ROLE "NAME" [eN]`, plus notes: a navigation started, a dialog was accepted or dismissed, focus moved to another tab | Actionability: the node is visible (non-empty `DOM.getContentQuads`), not `disabled`, and stable (two animation frames, `compileActionabilityFunction`). Then `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, the quad center plus OOPIF offsets, and a hit test that `elementFromPoint` at the frame-local center is the node or a descendant (the covering row is reported if not). Then `Input.dispatchMouseEvent` pressed and released on the page session (P4). Trusted, and grants user activation. | `element.scrollIntoView({ block: 'center' })`, then `HTMLElement.click()`. Activation behavior runs; `isTrusted` is `false` and no user activation is granted. The receipt ends `(untrusted event)`. |
| `type` | `ref: string`, `text: string`, `submit?: boolean` | none | `typed N characters into ROLE "NAME" [eN]`, plus `and pressed Enter` when submitted | `DOM.focus({ backendNodeId })`. Select the current content in the isolated world (`this.select()` for text controls, `Selection.selectAllChildren` for contenteditable). Then `Input.insertText(text)`, which is trusted and replaces the selection. When `submit` is true, `Input.dispatchKeyEvent` for `Enter`. | Native value setter from the prototype descriptor, then bubbling `input` and `change` events. When `submit` is true, `form.requestSubmit()`, which the receipt names. Contenteditable targets are refused (see `Tensions`). |
| `select` | `ref: string`, `values: string[]` (a lone string is accepted) | none | `selected "LABEL", … in ROLE "NAME" [eN]` | `Runtime.callFunctionOn` in the isolated world. Match `option.value`, then the label, then a case-insensitive label; set `selected`; dispatch bubbling `input` and `change`. Unmatched values are an error listing at most 10 options. These are synthetic events in both placements, and the receipt says so. | Same algorithm in-page. |
| `press` | `key: string` (`Enter`, `Escape`, `Tab`, arrows, `Control+a`) | none | `pressed KEY` | `normalizeBrowserKey` (case-insensitive aliases: `enter`/`return` map to `Enter`, `esc` to `Escape`, `ctrl` to `Control`), then `extractBrowserChord` and `keyToBrowserInput` (`src/core/helpers.ts:1468-1556`), then `Input.dispatchKeyEvent`. Trusted. | Absent. A dispatched `KeyboardEvent` performs no default action. |
| `open` | `url: string` | none | `opened URL "TITLE"`, or the `Page.navigate` `errorText` as an error | Check the scheme against `schemes` (default `http`, `https`) before any command is sent. Then `Page.navigate` and a wait for `DOMContentLoaded` of the returned `loaderId`. A `beforeunload` dialog is accepted. | Absent. Navigating the agent's own document ends the agent. |
| `wait` | `text: string` | `pure` | `found "TEXT"` or `not found "TEXT" after S s` | `Runtime.evaluate` with `awaitPromise` of `compileTextWaitExpression` in the isolated world. The expression checks immediately, then re-checks on `MutationObserver` batches coalesced to one `requestAnimationFrame`, until an in-page deadline. On `Execution context was destroyed`, it re-arms after the next `DOMContentLoaded`. On abort, the host evaluates a disconnect for the observer's key. | The same observer logic in-page. |
| `call` | `name?: string`, `input?: object` | `untrusted` | With no `name`, or an unknown one: the page-tool listing, one line per tool, `NAME — DESCRIPTION (params: A, B)`, flagged `[consequential]`, `[form eN]`, `[frame ORIGIN]`. Tools marked `debugging` are hidden. With a known name: `page tool NAME returned:` and the rendered output. With no registry: `This page exposes no tools.` | `BrowserRegistry.execute`: `WebMCP.invokeTool`, then the matching `WebMCP.toolResponded`. An abort sends `WebMCP.cancelInvocation`. | The consumer-supplied `registry` function returns `ToolInterface` values, for example from `@orkestrel/mcp/browser` `createModelContext()?.adopt()`. Each is executed with the tool context's signal. |

**Comparison with shipped servers.** The research report's vocabulary matrix (`tmp/units/webmcp-research-report.md:177-203`) is the basis for the following rulings.

- Matched:
  - the accessibility-outline snapshot with element identifiers (DevTools MCP `take_snapshot` uid, Playwright MCP `browser_snapshot` ref) and ref-driven `click`, `fill`, `select`, and `press_key`;
  - `navigate_page` as `open`, and `wait_for` text as `wait`;
  - the WebMCP pair `list_webmcp_tools` and `execute_webmcp_tool`, folded into one `call`.
- Refused, each for a stated reason:
  - `evaluate_script` and `browser_evaluate`: arbitrary code authored by a 2-billion-parameter model is a consequence no annotation bounds, and a consumer can add it.
  - Coordinate and vision tools (`click_at`, `browser_mouse_*_xy`) and screenshots: the probe model reads text.
  - Network, console, performance, heap, Lighthouse, extension, and PWA tools: developer tooling, reachable through the page API.
  - Tab tools: focus follows popups instead.
  - `handle_dialog`: the driver applies its `accept` option.
  - `upload_file`: the agent holds no files.
  - `fill_form`: nested arrays cost a small model more than repeated `type` calls.
  - `hover` and `drag`: absent in the DOM placement and outside the probe task (see `Tensions`).
  - The `browser_` prefix and snake_case: the consumer's MCP host can namespace.

### References and locating (question 3)

- **Spelling.** A reference is `e` followed by a positive integer, printed `[e12]`. `parseBrowserRef` accepts `e12`, `E12`, `[e12]`, `ref=e12`, `[ref=e12]`, `12`, and the integer `12`. Anything else is an error that tells the model to call `look`. The `e` prefix keeps a reference from reading as a count.
- **Identity.** The driver maps a surface key to a reference and back. CDP keys are `SESSION:BACKEND`, because backend node ids are per renderer and an OOPIF shares numeric ids with the main frame. DOM keys are per-surface counters over a `WeakMap`.
- **Stability.** The same node keeps its reference across `look` calls, because `backendDOMNodeId` is stable for a node's life.
- **Uniqueness.** Reference numbers are never reused within a driver's life. After a cross-document navigation a stale `e1` is refused as `e1 is gone (the page changed); call look`. It can never resolve to another document's first node.
- **Validity across mutations.** A reference stays valid while its node lives. A removed node fails `DOM.resolveNode` with a `CDPError` (P4 control) or fails `isConnected`, and the driver reports it as gone.
- **Invalidation.** A cross-document navigation of the main frame drops the whole table. A child frame's navigation or detachment makes its keys unresolvable, because a new process gets a new session.
- **Errors.** `BrowserReferenceError` (code `BROWSER_REFERENCE_ERROR`) replaces `BrowserSelectorError`. Its message is the model-facing text.

Fate of the current locating machinery:

- `BrowserLocator`, `BrowserSelectorManager`, the locator list, wait, click, fill, and select compilers, and the function wait are deleted.
- The locating capability survives as `driver.find({ role?, name?, css? })`, a typed method and not a tool, returning outline rows with references:
  - `role` and `name` filter the outline, so label and placeholder resolve through the accessible name;
  - `css` runs `DOM.querySelectorAll` over `DOM.getDocument({ depth: 0 })` then `DOM.describeNode` for backend ids, and `querySelectorAll` in the DOM placement;
  - the `testId` axis is `css: '[data-testid="ID"]'`;
  - the `text` axis is `role: 'StaticText'` with `name` on the CDP surface.
- Element-state waits survive as `driver.wait({ text?, css?, gone?, signal? })` on the same observer expression. The tool exposes `text` only.

`BrowserNavigationManager.until` is deleted. It polls an arbitrary predicate every 100 ms (`src/core/BrowserNavigationManager.ts:59-70`, `src/core/compilers.ts:25-47`). A predicate over non-DOM state has no event that could wake it, so an event-driven `until` cannot exist. A caller with an event-driven condition passes a promise expression to `page.evaluate`, which already awaits it. `navigation.wait(pattern)` is kept and gains a `signal`.

### Reading entity contract (question 4)

`BrowserReader` is a class in `src/core`, created by `createBrowserReader(surface)`. It holds the following state and contract.

- **Source.** `surface.markup(key, signal)` returns `{ url, title, html, generation }`. `generation` counts the surface's `navigate` events, same-document ones included.
- **Retention.** At most one entry per `(key, whole)`: the parsed `HTMLInterface`, the rendered Markdown, and the generation. The retained parsed handle is `@orkestrel/html`'s own `HTMLInterface`, handed out unwrapped by `capture`.
- **`read({ key?, whole?, offset?, limit?, signal? })`** returns `BrowserReading { url, text, offset, total, next }`:
  - `offset` 0 or absent always recaptures, so a fresh read is never stale.
  - A positive `offset` reuses the retained entry when its generation equals `surface.generation`. Otherwise it recaptures and answers from offset 0. The caller sees the reset in `reading.offset`.
  - `next` is `undefined` when the excerpt reaches `total`. No stored `truncated` flag exists; truncation is derived.
  - The excerpt ends at the last line break at or before `offset + limit` when one exists past `offset`, and hard-cuts otherwise.
- **Projection.** `renderMarkdown(htmlToMarkdown(document))` (`../markdown/src/core/helpers.ts:2756`, `../markdown/src/core/helpers.ts:1748`). The document is `handle.distill({ base: url }).document` by default (`../html/src/core/types.ts:368-378`) and `handle.document` when `whole` is true. Plain text is not re-exposed: a consumer calls `renderText(capture.html.document)` from `@orkestrel/html` itself.
- **`capture({ key?, signal? })`** returns `BrowserCapture { url, title, html: HTMLInterface, generation }`.
- **`clear()`** releases every retained entry. It is called on each surface `navigate` event and by the driver's `destroy`. There is no timer and no poll.
- **Bound.** Characters, never tokens. `BROWSER_RESULT_LIMIT` (2 500 000 characters) guards the capture itself in both placements: in-page on CDP, and by string length before parsing on DOM.
- **Frame ownership.** An absent key reads the main frame. An iframe reference reads that frame's document on its own session. A cross-origin iframe in the DOM placement is refused.

The reader passes the wrapper test (`../scaffold/.claude/rules/architecture.md:155-163`), because no member forwards one-to-one to html or markdown. It adds:

- the lifecycle: retention, generation-checked reuse, and event-driven release;
- the invariant that continuation offsets address one capture;
- the composition of capture, distill, project, render, and bound;
- a narrower contract than html's handle: bounded text with a derived continuation.

Fates of the current members:

- `content()` is deleted. `reader.capture()` carries URL, title, and HTML, and the consumer's own `page.evaluate` reads `innerText`.
- `article()` is deleted. Distillation lives in the reader and only there, which replaces the article clause of guide invariant 2 (`guides/browser.md:1862-1865`, `guides/browser.md:1879-1881`).
- `snapshot()` is kept unchanged (see `What goes`).

### WebMCP entity contract, outside the browser (question 5)

`createBrowserRegistry(page, options?)` returns `Promise<BrowserRegistryInterface | undefined>`. Feature detection is the return value, matching the mcp bridge's rule (`../mcp/src/browser/factories.ts:422-427`). The factory works in this order:

1. Subscribe `WebMCP.toolsAdded`, `WebMCP.toolsRemoved`, and `WebMCP.toolResponded` on the page session before sending `WebMCP.enable`. Enabling fires `toolsAdded` for every registered tool (`tmp/units/browser_protocol.json:30961`), and `CDPClient` dispatches events synchronously while a response resolves a promise whose continuation runs later (`src/core/CDPClient.ts:296-333`).
2. Send `WebMCP.enable`.
3. A `CDPError` whose `context.code` is `-32601` (method not found) unsubscribes everything and returns `undefined`. Any other error is rethrown.
4. Subscribe the page's `session` event (added by unit `page-events`) and send `WebMCP.enable` on each OOPIF session it reports. Subscribe `Page.frameNavigated` and `Page.frameDetached` on each session.

The registry holds the following contract.

- **Mirror.**
  - Entries are keyed by `(frameId, name)`.
  - The public key is the name for the main frame and `NAME@fN` for a child frame. `N` is an ordinal the registry assigns the first time a frame reports a tool, and it is never reused, so a key does not depend on the order in which duplicates arrive.
  - A `toolsAdded` entry for an existing key replaces it and emits `remove` then `add`. `toolsRemoved` removes and emits `remove`.
  - A cross-document `Page.frameNavigated` for a frame, or a `Page.frameDetached`, removes that frame's entries.
- **`BrowserPageTool`.** Fields are `name` (the public key), `description`, `parameters` (the `inputSchema` record or `undefined`), `annotations`, `frame`, `origin`, and `backend` (the declarative form's `backendNodeId`, or `undefined`).
  - Annotations are `BrowserToolAnnotations`, which extends `ToolAnnotations` with `debugging` and `autosubmit`. The projection is `readOnly` to `pure` and `consequential` to `consequential`.
  - `untrusted` is always `true`. The protocol states the output "is untrusted and poses a prompt injection risk" (`tmp/units/browser_protocol.json:31078`), and a page's own hint cannot lower that.
- **`execute(name, input, context)`.**
  1. Refuse an already-aborted signal with its reason.
  2. Increment the session's in-flight count.
  3. Send `WebMCP.invokeTool({ frameId, toolName, input })` without passing the signal to `send`, so the invocation id always arrives.
  4. Match `toolResponded` by `invocationId`. The protocol sends the command response before tool events (`tmp/units/browser_protocol.json:30990`). The transport can still deliver both frames in one synchronous burst, so a `toolResponded` whose id is unknown is buffered while that session has an invocation in flight. The buffer is cleared when the count returns to zero.
  5. On abort before the id arrives, record a pending cancel and send `WebMCP.cancelInvocation` when the id arrives. On abort after the id, send it immediately. Either way, reject with `signal.reason` without waiting for the `Canceled` response.
  6. A navigation or detachment of the tool's frame, `destroy`, or the operation timeout rejects the invocation. The timeout also sends `cancelInvocation`.
  7. Status `Completed` resolves `output` unchanged, as `unknown`, because its type is unsettled (see `Measurements`). `Error` rejects with `errorText`, or with the `exception` description. `Canceled` rejects with a coded `BrowserError`.
- **`adopt()`.** Projects each entry into a `ToolInterface` through `createTool`. The name is the public key, and `execute` routes to `this.execute`. Consumers who want page tools as top-level tools get them this way, and the collision decision stays theirs.
- **`destroy()`.** Sends `WebMCP.disable` on every enabled session, unsubscribes, and rejects every in-flight invocation.

The `Runtime.evaluate` path over `document.modelContext` (P5) is refused.

- It depends on page-visible `getTools` and `executeTool` members. The mcp bridge declares these from a 2026-09-15 reading (`../mcp/src/browser/types.ts:357-372`), but the 2026-09-29 draft does not name them, and Chrome's intent names `Navigator.modelContext` (Verified 10). A path built on that surface asserts a registry shape nobody has observed in a shipping browser.
- It must run in the main world, where the page controls every getter.
- Puppeteer and Chrome DevTools MCP both use the domain (`tmp/units/webmcp-cdp-domain.md:36-47`).

### WebMCP inside the browser (question 6)

This package adds a DOM-native tool set that the mcp bridge publishes, and it stops there. `createDocumentDriver(...).tools` is a `ToolInterface[]`. A consumer adds it to a `ToolManagerInterface` and passes that manager to `createModelContext()?.publish(manager)`, `createPageServer({ tools })`, or `createScopeServer({ tools })`. The DOM placement's `call` tool reads page tools through the consumer-supplied `registry` function, for example `() => bridge.adopt()`. The package keeps no registry client of its own.

### Trusted and DOM-native input (question 7)

The contract difference:

- A CDP `click`, `type`, or `press` goes through the `Input` domain. The page sees `isTrusted === true`, and the click grants transient user activation, so popups, fullscreen, clipboard, and media play succeed.
- A DOM-native action is `HTMLElement.click()`, a value setter plus dispatched events, or `form.requestSubmit()`. The page sees `isTrusted === false`, and no user activation is granted.

How the vocabulary declares it:

- The DOM placement's receipts end with `(untrusted event)`.
- `select` says `(synthetic events)` in both placements, because no trusted path selects an option without keyboard emulation.
- The DOM placement's `tools` omits `press` and `open` rather than advertising tools it cannot honor.

What the DOM placement refuses rather than fakes:

- key presses, because a dispatched `KeyboardEvent` inserts no text and submits no form;
- navigation of its own document;
- file choosers, because `input.click()` without activation opens nothing;
- hover, because synthetic `mouseover` does not apply `:hover`;
- typing into contenteditable;
- cross-origin frames.

It never overrides `window.alert`, `confirm`, or `prompt`. A DOM-placement click that triggers `alert()` blocks the agent's own thread until a person answers, and the guide records that limit.

### Event and invalidation model

Every wait parks on one of the sources in the following table. No site uses `setInterval` or a re-arming `setTimeout` to test a condition. A `setTimeout` survives only as a deadline that rejects.

| Event source | Consumer | Effect |
| --- | --- | --- |
| `Page.frameNavigated`, main frame | `BrowserPage` emits `navigate` `[url, false]`; the surface emits `navigate` `[false]` | Reader `clear()`; driver drops its reference table; registry drops main-frame tools; the isolated-world cache for the frame is dropped |
| `Page.navigatedWithinDocument`, main frame | `BrowserPage` updates `url` and emits `navigate` `[url, true]` (the handler at `src/core/BrowserPage.ts:802-808` emits nothing for it outside a wait today) | Reader `clear()`; references kept; `navigation.wait(pattern)` resolves on SPA routes |
| `Page.frameNavigated` or `Page.frameDetached`, child frame | Registry; surface isolated-world cache | That frame's tools removed; its world id dropped; its references resolve as gone |
| `Page.lifecycleEvent` (after `Page.setLifecycleEventsEnabled`, P6) | `CDPSurface` readiness | `look`, `read`, and `open` wait for `DOMContentLoaded` of the current `loaderId`. When enabled mid-load, the surface seeds once from `document.readyState` in the isolated world. A deadline reports `(page still loading)`. |
| `Runtime.executionContextDestroyed`, `Runtime.executionContextsCleared` | `CDPSurface` | The cached isolated world id is dropped. The next evaluation creates one with `Page.createIsolatedWorld`. |
| `Page.javascriptDialogOpening` | Page `dialog` event, then the driver | The dialog is accepted or dismissed per the `accept` option while the pending `Input` command waits on it, and the next receipt names it |
| `Target.attachedToTarget`, `type: 'page'` | Page `popup`, then the surface `popup`, then the driver | Focus moves to the popup; the receipt names it |
| `Target.attachedToTarget`, `type: 'iframe'` | Page `session` event (added) | Registry enables `WebMCP`; the surface can fetch that frame's accessibility tree |
| `Target.targetDestroyed` | Page `close`, then the driver | Focus returns to the opener; that surface's references are dropped |
| `WebMCP.toolsAdded`, `WebMCP.toolsRemoved`, `WebMCP.toolResponded` | Registry | Mirror and invocation settlement |
| In-page `MutationObserver` coalesced to `requestAnimationFrame` | `wait` through `Runtime.evaluate` `awaitPromise`, or in-page | Resolves on a match; an in-page deadline resolves `false` |
| DOM `popstate`, `hashchange`, and the Navigation API `navigatesuccess` | `DocumentSurface` emits `navigate` `[true]` | Reader `clear()` |
| Child stderr `DevTools listening on ws://…` line | `Browser` launch | Readiness without HTTP polling |
| `AbortSignal` from `ToolContext.signal` | Driver queue, `CDPClient.send` `signal`, registry cancel | A queued operation never starts; a pending command rejects with the reason; an invocation is cancelled |

**Serialization.** The driver runs one operation at a time in first-in, first-out order. An operation whose signal aborts while queued leaves the queue without sending anything. Without this, two concurrent `click` calls from a batch `execute` interleave `mousePressed` and `mouseReleased` pairs.

### Lifecycle and ownership (question 8)

- **`Browser`.** It keeps `discover`, `connect`, `adopt`, `disconnect`, `destroy`, `close`, `context`, `contexts`, `isolate`, `create`, ownership, the endpoint, `pid`, and process-group termination, with guide invariants 5, 6, 12, and 13 unchanged. One change: an owned launch reads its endpoint from the child's stderr. Every call the known consumer makes is kept (`/home/user/orkestrel/ollama/tests/setupServer.ts:1106-1124`).
- **`BrowserContext`.** It keeps `page(index?)` and `pages()` as the tab manager (`src/core/types.ts:2114-2117`). `browser.tabs` would repeat that accessor, so none is added.
- **`BrowserPage` and `BrowserFrame`.** They keep `destroy` (local release) and `close`. `close` transliterates the protocol's `Target.closeTarget` and `Browser.close` (`../scaffold/.claude/rules/names.md:120`).
- **`BrowserDriver`.**
  - `destroy()` stops following the focus pages, destroys the reader and any registry the driver created, rejects queued operations, and destroys its emitter last (`../scaffold/.claude/rules/patterns.md:79`).
  - A tool called after `destroy` fails with `the browser session ended`.
  - The driver never closes a page it did not open. A page it opened through a popup belongs to the context.
- **`BrowserRegistry`.** `destroy()` as specified in the WebMCP contract.
- **`BrowserReader`.** `clear()` resets its captures without destroying it.
- **`BrowserDownload`.** `cancel` becomes `abort`, because the fixed vocabulary bans `cancel` (`../scaffold/.claude/rules/names.md:232`).

### What goes (question 9)

`AGENTS.md` binds every row: a symbol is removed only when the capability itself must not exist (`../scaffold/AGENTS.md:63`). The following table rules on every current entity.

| Entity | Ruling | Reason |
| --- | --- | --- |
| `CDPClient`, `CDPTransportInterface`, `createCDPClient` | Keep; change `CDPSendOptions` to add `signal` | Tool calls carry `ToolContext.signal`. The consumer's page proof records that page commands "take a per-call `timeout` and no signal" (`/home/user/orkestrel/ollama/tests/service/page.test.ts:16-22`). |
| `WebSocketCDPTransport` (server), `createCDPTransport` | Keep | Owned launch and attach transport |
| `BrowserTransition` | Keep | Shared in-flight transitions |
| `Browser` | Keep; change launch readiness | See `Lifecycle and ownership` |
| `BrowserContext` and its manager accessors | Keep | Tab manager and context isolation |
| `BrowserPage` | Keep; change: `navigate` payload `[url, same]`, same-document emission, a `session` event, `content`, `article`, and `codegen` removed | Invalidation needs both navigation kinds, and the registry needs OOPIF sessions |
| `BrowserFrame` | Keep; change: `click`, `fill`, `select`, `wait`, `selectors`, `content`, and `article` removed; `send` gains `signal` | Actions go through references. `evaluate` keeps the main world, because the consumer reads `globalThis.ready` there (`/home/user/orkestrel/ollama/tests/setupServer.ts:1128`). |
| `BrowserHandle` | Keep | Retained remote objects |
| `BrowserWorker` | Keep | Worker targets |
| `BrowserDialog` | Keep | The driver's dialog policy uses it |
| `BrowserFileChooser` | Keep | Consumers set files; there is no agent tool |
| `BrowserDownload` | Keep; rename `cancel` to `abort` | Fixed lifecycle vocabulary |
| `BrowserCookieManager`, `BrowserPermissionManager`, `BrowserStorageManager`, `BrowserEmulationManager` | Keep | Context mechanisms; no polling |
| `BrowserLocator`, `BrowserSelectorManager` | Delete | Built on in-page 100 ms polling (`src/core/compilers.ts:467`, `501`, `540`, `579`). The locating capability survives as `driver.find` and `driver.wait`. |
| The `css`, `role`, `text`, `label`, `placeholder`, and `testId` axes | Change | Folded into `find` (`role` and `name` from the outline, `css` from `DOM.querySelectorAll`), as specified in `References and locating` |
| `compilers.ts` | Change | Delete the locator list, locator waits, CSS waits, click, fill, select, function wait, and codegen compilers. Keep guarded evaluate, binding source, result, and cleanup, screenshot preparation and cleanup, storage, and actionability. Add `compileTextWaitExpression`, `compileMarkupFunction`, `compileHitFunction`, and `compileSelectFunction`. |
| `BrowserNavigationManager` | Keep `wait` (gains `signal`); delete `until` | `until` is a poll with no possible event source |
| `BrowserScriptManager` | Keep | Bindings and init scripts (P3) |
| `BrowserAccessibility` | Keep | The raw decode; `CDPSurface` composes it |
| `BrowserKeyboard`, `BrowserMouse`, `BrowserTouch` | Keep | Trusted input primitives the surface uses |
| `BrowserCodegen` with its types, constants, parsers, and helpers | Delete | Its compiled scripts call `page.click(selector)` and `fill(selector)`, which this design removes. References are identities within one document, so a recorded reference replays against nothing. A recorder whose output cannot run must not exist. See `Tensions`. |
| `BrowserSnapshot`, `createBrowserSnapshot`, `page.snapshot()`, node query helpers | Keep | Correct, bounded by `BROWSER_SNAPSHOT_NODE_LIMIT`, no polling, invariant 14 (`guides/browser.md:2054-2065`). Owner permission is not a reason to delete (`../scaffold/AGENTS.md:63`). |
| `BrowserNetworkManager`, network observation | Keep | The consumer calls `network.start()` and listens to `request` |
| `BrowserRoute` | Keep | Fetch interception; HAR replay depends on it |
| `BrowserHARManager` and HAR helpers | Keep | Recording and replay mechanism |
| `BrowserWebSocket` observation | Keep | Network mechanism |
| `BrowserDiagnostics`, `BrowserTracing`, `BrowserCoverage`, `BrowserPerformance`, `BrowserProfiler` | Keep | Event-completed mechanisms (`Tracing.tracingComplete`) |
| `BrowserClock` | Keep | Virtual time settled by `Emulation.virtualTimeBudgetExpired` |
| PDF (`page.pdf`) and screenshot (`page.screenshot`) | Keep | Consumer mechanisms; not in the vocabulary |
| `BrowserWriterInterface`, `FileBrowserWriter` | Keep | Invariant 4 |
| `BrowserSelectorError`, `isBrowserSelectorError` | Delete; add `BrowserReferenceError`, `isBrowserReferenceError` | The selector engine is gone |
| `waitForCDPReady` | Delete; add `readBrowserEndpoint(stream, signal)` | A poll (`src/server/helpers.ts:358-396`) with an event source available |
| `BROWSER_WAIT_POLL_INTERVAL_MS` | Move to `src/server/constants.ts` as the drain interval, or delete | Only the process-group drain uses it after the change (see `Tensions`) |
| `BROWSER_TEST_ID_ATTRIBUTE`, `BROWSER_VISIBILITY_SOURCE`, codegen constants | Delete | Their users are deleted |

### Tests and proofs (question 10)

- **`src:core`.** In-memory `createCDPTestTransport` (`tests/setup.ts:84-155`), extended so `fail` carries a numeric `code`. It covers:
  - `CDPClient` signal handling;
  - page navigation events;
  - `CDPSurface` outline decode, key composition, isolated-world caching, and hit-test refusal;
  - the driver's references, serialization, dialogs, focus, receipts, and bounds;
  - the reader's paging and invalidation;
  - the registry's absence, mirror, ordinals, burst ordering, cancellation, and destroy.
  
  `reply` followed by `event` inside one `onSend` handler reproduces the same-tick burst.
- **`src:server`.** A protocol-faithful `WebMCP` fixture on `CDPTestServer` (`tests/setupServer.ts:262`), in `tests/src/server/integration.test.ts`: a real `Browser` connects, then `createBrowserRegistry` runs. The fixture writes the `invokeTool` response and `toolResponded` in one socket write, which proves the burst path over a real WebSocket. The fake browser process prints the `DevTools listening on` line for the launch proof.
- **`service`, against the host Chromium 141.** One driver task end to end through `createToolManager().execute`, plus:
  - an OOPIF click (`127.0.0.1` against `localhost` origins);
  - an overlay-covered click refusal;
  - `confirm()` during a click;
  - a popup focus move and return;
  - `read` distilled against whole, and paging;
  - `wait` for text inserted 200 ms later;
  - `createBrowserRegistry` returning `undefined` (`-32601`);
  - the promoted P2 through P8 relationships.
  
  The live `WebMCP` case is a conditional skip whose reason cites the `-32601` reading on this host (`../scaffold/.claude/rules/tests.md:39`). It is recorded as a limit until a host with Chrome 150 or later and `--enable-features=WebMCP` exists.
- **`src:browser` on the Playwright provider.** Covers `DocumentSurface` on real DOM, and `SocketCDPTransport` against a Chromium that `tests/setupGlobal.ts` launches through this package's `createBrowser` with `--remote-allow-origins=*`, passing the endpoint through `provide`. Creating `src/browser` forces that project and its setup (`tests/config.test.ts:153-158`, `tests/config.test.ts:591-606`), and the provider needs `playwright` and `@vitest/browser-playwright` (`../scaffold/package.json:114`, `../scaffold/package.json:117`). This needs the owner's authorization (see `Tensions`). A second proof in `service` serves the built `dist/src/browser` entry to a page driven by the server face, and compares the DOM outline's interactive `(role, name)` set with the CDP outline's. That is a second mechanism that could disagree.
- **End-to-end MCP proof.** Not in this package. Hosting a `ToolManagerInterface` over MCP is mcp's proven contract. The composition of this vocabulary, an agent, and a model belongs to the consumer that composes them, `@orkestrel/ollama`'s service axis, which already holds this package as a development dependency.

### Dependencies and names (question 11)

The following list rules on each dependency edge.

- **`@orkestrel/tool`, runtime.** Required: `ToolInterface`, `ToolContext`, `ToolAnnotations`, and `createTool`. Without it the package would declare a second tool shape, which the reuse rule forbids (`../scaffold/AGENTS.md:43`). It keeps the package at L3, because `tool` is L2 (`../scaffold/.claude/agents/orkestrel.md:92`). It is not authorized: `PROPOSAL.md:21-22` authorizes `@orkestrel/markdown` alone, and `../scaffold/AGENTS.md:36` forbids an unrequested package. This blocks the `contract` unit.
- **`@orkestrel/markdown`, runtime.** Authorized (`PROPOSAL.md:21-22`); L2 (`../scaffold/.claude/agents/orkestrel.md:65`).
- **`@orkestrel/mcp`.** None at runtime and none in development. The DOM placement's `registry` option and the consumer's MCP host make both edges unnecessary.
- **Development.** `playwright` and `@vitest/browser-playwright`, only if `src/browser` is authorized. No browser binary is added: the provider resolves the host's `/opt/pw-browsers` store.

The following list names each fleet-owned bare-name family and how the design avoids it (`../scaffold/.claude/rules/names.md:124-137`).

- **`Tool*`** (`tool`). The design uses `ToolInterface`, `ToolContext`, and `ToolAnnotations` by type import and never re-exports them (`../scaffold/.claude/rules/architecture.md:161`). Its own names are `BrowserToolAnnotations` and `BrowserPageTool`.
- **`WebMCP*`, `ModelContext*`** (`mcp`). The domain entity is `BrowserRegistry`. No exported name contains `WebMCP` or `ModelContext`. The wire parsers are `parseBrowserPageTool` and `parseBrowserInvocation`.
- **`Markdown*`, `HTML*`.** None declared. `BrowserCapture.html` is typed with html's `HTMLInterface` by import.
- **Within this package.** The browser-face transport cannot be `WebSocketCDPTransport` without the guide carrying two contracts under one name, so it is `SocketCDPTransport`. `createCDPTransport` exists only in `src/server`. The browser face's factory is `createSocketCDPTransport`.

### Blast radius and sequencing (question 12)

- **Version.** `@orkestrel/browser` goes from `0.0.18` to `0.0.19`.
- **Consumer re-pin.** `@orkestrel/ollama` pins `^0.0.18` (`/home/user/orkestrel/ollama/package.json:84`), and a caret on `0.0.x` admits `0.0.18` alone, so it must re-pin to `^0.0.19`. Every call in Verified 18 survives unchanged, so the re-pin needs no source change there.
- **Catalog.** The scaffold catalog row (`../scaffold/.claude/agents/orkestrel.md:51`) gains `tool` and `markdown` edges in a scaffold commit.
- **No other dependents.** No other fleet package declares this one.

Units, dependency order, and the exit criterion are in `Units`.

### Small-model fit (question 13)

The design serves a 2-billion-parameter model in the following ways.

- **Tool count.** 9 tools on CDP and 7 on DOM, advertised statically. Page tools never add to the count; they sit behind `call`, whose listing arrives as an `untrusted` tool result rather than as page-authored text in the tool definitions.
- **Descriptions.** One sentence each, at most 100 characters, held as data in `BROWSER_TOOL_COPY` so the probe can tune them without code changes.
- **Parameters.** At most 3 per tool, all flat except `call.input`. Only `ref`, `url`, `text`, `key`, and `name` are ever required.
- **Result lengths.** Defaults are `limit.outline` 4 000 characters, `limit.reading` 4 000 characters, and `limit.receipt` 300 characters. These are provisional until the effective `num_ctx` is read (see `Measurements`).
- **Result shapes.** Outlines are line-per-node with references. Readings are Markdown with an explicit continuation. Receipts are one line.
- **Errors.** Every error names the next call: `call look`, or `call read with offset M`.
- **References.** `[e12]`, copied back as `e12`, with lenient parsing.

The real-model probe counts the vocabulary as tuned only when `qwen3.5:2b-q4_K_M` on `http://localhost:11434` (`/home/user/orkestrel/ollama/tests/setupService.ts:13`), driven through `@orkestrel/agent` with `driver.tools` at temperature 0, meets every criterion in the following list against the host Chromium.

1. **Form task.** A served page with `Name` and `Email` textboxes and a `Subscribe` button. The page mints a random confirmation code and shows it 200 ms after submit. The final answer contains the code within 8 tool calls. The page's own event record shows exactly the two fields typed and one click on the button's element. At most one call carries malformed arguments.
2. **Reading task.** An article of about 3 000 characters inside navigation and footer noise, with a random token in one paragraph. The answer contains the token within 3 tool calls. No `read` result exceeds `limit.reading` plus its footer.
3. **Paging task.** The token sits past the first `limit.reading` characters. The answer contains it within 4 calls, including one `read` with the offset the footer named.
4. **Attempt bound.** A bounded `retryUntil` of at most 3 attempts, following `/home/user/orkestrel/ollama/tests/service/page.test.ts:186-276`. Each attempt's transcript records every result's character length, and the sum of prompt tokens reported by the daemon stays under its `num_ctx`.
5. **WebMCP task.** Recorded as a limit until a registry exists on a host: Chrome 150 or later for the domain, or the DOM placement with the mcp bridge over a real `document.modelContext`.

## Alternatives

The following list names at most two alternatives per major decision and why the design wins.

- **Agent vocabulary shape.**
  - (a) Adopt page WebMCP tools as top-level tools beside the generic set. This loses because `ToolManagerInterface.add` replaces a same-named tool (`../tool/src/core/types.ts:207-219`), letting a page hijack `click`. Page-authored descriptions would sit in the tool definitions as trusted-looking text. The advertised set would change mid-run, which requires agents to re-read definitions per turn, an unmeasured behavior.
  - (b) Playwright MCP's snapshot after every action. This loses on token cost for a context of unknown size (see `Measurements`). It stays open as a `Tensions` item for the probe to settle.
- **Locating and acting.**
  - (a) Rewrite the compiled CSS and role locators as event-driven in-page expressions. This loses because it keeps a second matching engine in the page, where a hostile page can patch the prototypes the matcher calls. It also still gives the agent nothing to copy back.
  - (b) Stream the `DOM` domain's mutation events (P2) to track nodes. This loses because `DOM.getDocument({ depth: -1 })` pushes the whole tree and every later mutation over the wire. An in-page observer resolving one promise sends one message.
- **Reading.**
  - (a) Frame methods `tree()` and `markdown()` (the first shape in `PROPOSAL.md:34-39`). These lose because a continuation offset over a re-captured document addresses different text, which is the capture-consistency question `PROPOSAL.md:47-48` leaves open.
  - (b) `DOM.getOuterHTML` instead of an evaluated `outerHTML`. This resists main-world getter patching without an isolated world, but loses the in-page size guard that keeps an oversized result off the transport (`guides/browser.md:1932-1950`). The isolated world gives both.
- **WebMCP outside the browser.**
  - (a) The domain plus the `Runtime.evaluate` path over `document.modelContext`. Refused, as argued in the WebMCP contract.
  - (b) A registry client polling `getTools`. Refused, because polling is foreclosed (`../scaffold/AGENTS.md:66`).
- **The in-browser placement.**
  - (a) No `src/browser`; the mcp bridge alone. This loses because the owner asks for native in-browser control, and the bridge publishes tools without supplying any that drive the DOM.
  - (b) A DOM surface over a structural element interface in `src/core`. This loses because it restates DOM types in a DOM-free environment, and still needs a real browser to prove it.

## Constraints

The following list gives each constraint with its source, resolvable from `/home/user/browser`.

1. User instruction outranks defaults. `../scaffold/AGENTS.md:8`
2. No npm package without an explicit request, which binds `@orkestrel/tool`, `playwright`, and `@vitest/browser-playwright`. `../scaffold/AGENTS.md:36`; only markdown is authorized: `PROPOSAL.md:21-22`
3. No mocks or behavioral fakes: protocol-faithful fixtures and real browsers only. `../scaffold/AGENTS.md:40`; `../scaffold/.claude/rules/tests.md:27-31`
4. Inspect installed `@orkestrel/*` before writing overlapping logic. `../scaffold/AGENTS.md:43`; installed: tool 0.0.17, markdown 0.0.16, html 0.0.11, mcp 0.0.33 under `node_modules/@orkestrel/`
5. Single-word members; derived state; `undefined` absence; named discriminants. `../scaffold/AGENTS.md:50`, `../scaffold/AGENTS.md:55-57`
6. Remove a symbol only when the capability must not exist. `../scaffold/AGENTS.md:63`
7. No compatibility shims. `../scaffold/AGENTS.md:64`; `../scaffold/.claude/rules/architecture.md:304`
8. No polling architecture. `../scaffold/AGENTS.md:66`; `../scaffold/.claude/rules/architecture.md:305`
9. Core compiles with no DOM and no Node. `../scaffold/.claude/rules/workspace.md:217-221`; `guides/browser.md:1859-1867`
10. `src/browser` forces the `src:browser` project, `tests/setupBrowser.ts`, and the `DOM` lib. `tests/config.test.ts:153-158`, `tests/config.test.ts:591-606`; the provider needs `playwright` and `@vitest/browser-playwright`: `../scaffold/.claude/rules/workspace.md:70-73`, `../scaffold/package.json:114`, `../scaffold/package.json:117`
11. Fleet name ownership. `../scaffold/.claude/rules/names.md:124-137`
12. Fixed lifecycle vocabulary; `cancel` banned. `../scaffold/.claude/rules/names.md:218-232`; the violation today: `BrowserDownload.cancel` (`tmp/cursor/browser-absorb-answer.md:31`, citing `src/core/BrowserDownload.ts:67`)
13. Wrapper test; no re-export of a dependency symbol. `../scaffold/.claude/rules/architecture.md:155-163`
14. Extension categories get folders (`surfaces/`, `transports/`). `../scaffold/.claude/rules/architecture.md:232-238`
15. Stateful emitter pattern for driver, surface, and registry. `../scaffold/.claude/rules/patterns.md:69-81`
16. Foreign data (WebMCP wire, adopted tools) is validated where dereferenced, and no further. `../scaffold/.claude/rules/patterns.md:133-141`
17. Conditional skip must cite its mechanism. `../scaffold/.claude/rules/tests.md:39`
18. Live service proofs live in `service` with hard readiness. `../scaffold/.claude/rules/tests.md:144-157`
19. The transport is a text pipe; `CDPClient` owns framing. `guides/browser.md:1882-1886`
20. Oversized results fail clean. `guides/browser.md:1932-1950`; `src/core/BrowserFrame.ts:162-168`
21. The page frame evaluates in the main world; child frames create a world per call. `src/core/BrowserPage.ts:144`; `src/core/BrowserFrame.ts:258-271`
22. `CDPSendOptions` carries no signal. `src/core/types.ts:90-93`; `src/core/CDPClient.ts:111-152`
23. Events dispatch synchronously; responses settle promises. `src/core/CDPClient.ts:296-333`
24. `BrowserPageEventMap.navigate` carries the URL alone. `src/core/types.ts:1085-1102`
25. `until` polls. `src/core/BrowserNavigationManager.ts:59-70`; `src/core/compilers.ts:25-47`
26. Launch readiness polls `/json/version`; the child's stdio is ignored. `src/server/helpers.ts:341-344`, `src/server/helpers.ts:358-396`; `src/server/Browser.ts:724-745`
27. The process-group drain probes liveness with no exit event. `src/server/Browser.ts:1059-1078`
28. Key names are case-sensitive. `src/core/helpers.ts:1542-1544`
29. `WebMCP.enable` fires `toolsAdded` for existing tools. `tmp/units/browser_protocol.json:30961`
30. The `invokeTool` response precedes tool events. `tmp/units/browser_protocol.json:30990`
31. `InvocationStatus` is `Completed`, `Canceled`, or `Error`. `tmp/units/browser_protocol.json:30885-30892`
32. The `toolResponded.output` type is `any` and marked untrusted. `tmp/units/browser_protocol.json:31076-31080`
33. mcp detects the registry by return value, with no polyfill. `../mcp/src/browser/factories.ts:422-427`, `../mcp/src/browser/factories.ts:452-461`
34. mcp's registry surface is `registerTool`, `getTools`, `executeTool`, `toolchange`. `../mcp/src/browser/types.ts:357-372`; annotation naming: `../mcp/src/browser/types.ts:229-233`
35. The tool contract: context signal, annotations, handler failure semantics, replacement on add. `../tool/src/core/types.ts:5-20`, `../tool/src/core/types.ts:136`, `../tool/src/core/types.ts:207-219`
36. Distill options and the handle contract. `../html/src/core/types.ts:368-378`, `../html/src/core/types.ts:478`
37. The HTML to Markdown projection and renderer. `../markdown/src/core/helpers.ts:2756`, `../markdown/src/core/helpers.ts:1748`
38. The consumer's calls and its main-world read. `/home/user/orkestrel/ollama/tests/setupServer.ts:1106-1128`; pin: `/home/user/orkestrel/ollama/package.json:84`
39. Probe model and tool-loop options. `/home/user/orkestrel/ollama/tests/setupService.ts:13`, `/home/user/orkestrel/ollama/tests/setupService.ts:189`
40. The mirror sweep flags a test without a module, and not the reverse. `tests/setupPolicy.ts:475-516`
41. The in-memory transport's `fail` carries no code. `tests/setup.ts:140-142`

## Refusals

The following list names each option a rule forecloses, with the rule quoted.

- **A runtime `browser → mcp` edge**, and adding `@orkestrel/tool` or the Playwright provider packages without the owner's word. "**NEVER** add an npm package unless the user explicitly requests it; prefer native APIs." (`../scaffold/AGENTS.md:36`)
- **Keeping `until`, the locator pollers, or `waitForCDPReady` as polls.** "**No polling architecture.** Park idle work on events and abort signals." (`../scaffold/AGENTS.md:66`)
- **Aliases for `content`, `article`, `click(selector)`, `fill`, `select`, `wait(selector)`, or `cancel`.** "**No compatibility shims.** Update every consumer in the same change." (`../scaffold/AGENTS.md:64`)
- **Re-exporting `createTool`, `ToolInterface`, or `HTMLInterface` from this package's barrels.** "Do not re-export a dependency's symbol from this package." (`../scaffold/.claude/rules/architecture.md:161`)
- **Naming any export `WebMCP*`, `ModelContext*`, `Tool*`, `Markdown*`, or `HTML*`.** "Give every bare exported name one owning package across the `@orkestrel` fleet." (`../scaffold/.claude/rules/names.md:126`)
- **Placing `DocumentSurface` or `SocketCDPTransport` in `src/core`.** Core admits "WHATWG web interop … no DOM, no Node" (`../scaffold/.claude/rules/workspace.md:219`), and "`src/core` imports only … no `WebSocket`" (`guides/browser.md:1859-1861`).
- **`cancel` for download or invocation verbs.** "Never introduce synonyms such as `cancel`, `reset`, or `run` for these meanings." (`../scaffold/.claude/rules/names.md:232`)
- **A stored `truncated` flag beside `next`.** "**Derive state.** Compute facts from existing fields; never store a second flag or label that can drift." (`../scaffold/AGENTS.md:56`)
- **A `kind` or `type` field on receipts or page tools.** "**Named discriminants.** Name the axis (`relationship`, `command`, `category`), never `kind` or `type`." (`../scaffold/AGENTS.md:57`)
- **A mocked CDP peer or a stubbed DOM for the `WebMCP` and DOM proofs.** "**NEVER** use mocks, behavioral fakes, module replacement, framework spies, or fake clocks for project-owned behavior. Use real implementations, recorders, temporary resources, protocol-faithful fixture servers, and inert data stubs." (`../scaffold/AGENTS.md:40`), and "Do not replace DOM events, storage, observers, viewports, layout methods, pointer, or drag APIs unless the browser genuinely lacks one." (`../scaffold/.claude/rules/tests.md:288`)
- **Deleting `BrowserSnapshot`, HAR, routes, diagnostics, or the clock on the owner's general permission.** "Remove a symbol only when the capability itself must not exist." (`../scaffold/AGENTS.md:63`)

## Measurements

**Readings supplied.**

- P1 through P8 on Chromium 141.0.7390.37 (Verified 1 through 8; `tmp/units/probe-cdp-native-3.log:4-11`, 8 passed in 4.43 s).
- P8's first run failed `expect(compact.length * 3).toBeLessThan(html.length)` with `747` against `397`, so the compact outline was 249 characters on a 397-character page (`tmp/units/probe-cdp-native-2.log:11-12`). The outline is not 3 times smaller on a tiny page; it is on the bloated page.
- The service baseline passed 14 proofs in 39.26 s (Verified 16; `tmp/units/ledger.md:24`).
- The `WebMCP` domain's schema, including the `InvocationStatus` enum and the response-before-events note (`tmp/units/browser_protocol.json:30839-31094`).
- Installed versions under `node_modules/@orkestrel/`: tool 0.0.17, markdown 0.0.16, html 0.0.11, mcp 0.0.33, websocket 0.0.14.

**Substitution.** `tmp/cursor/prior-absorb-answer.md` is absent (Glob of `tmp/**/*`, 2026-09-29). The sibling sources were read directly instead: `../tool/src/core/types.ts`, `../mcp/src/browser/types.ts`, `../mcp/src/browser/factories.ts` (lines 360-461 plus the export census of `../mcp/src/browser` and `../mcp/src/server`), `../html/src/core/types.ts` (the interface and distill options), `../markdown/src/core/helpers.ts:1725-1748` and `2712-2769`, and the manifests of tool, markdown, and browser. The ollama clone is present and was read at `tests/service/page.test.ts`, `tests/setupServer.ts:1080-1156`, and `tests/setupService.ts:1-60`.

**Readings missing.** Each reading below names what would settle it.

- `document.modelContext` against `navigator.modelContext` in a shipping Chrome. Settled by `'modelContext' in document` and `'modelContext' in navigator` on Chrome 149 or later with the origin-trial token, or Chrome 157 stable.
- Whether a shipping Chrome exposes registered tools to an extension, and through which API. Settled by an extension on Chrome 149 or later reading from a content script, the service worker, and `chrome.debugger` with `WebMCP.enable`.
- The runtime type of `WebMCP.toolResponded.output`. Settled by one `invokeTool` on Chrome 150 or later with `--enable-features=WebMCP` against a tool returning a string, and one returning `{ content: [...] }`.
- `chrome.debugger` as a transport: whether it carries flattened `sessionId` routing, and whether a structural interface can name it without `@types/chrome`. Settled by an extension on the host sending `Target.setAutoAttach({ flatten: true })` through `chrome.debugger.sendCommand` and reading `onEvent` for a child `sessionId`.
- The code Chromium 141 returns for `WebMCP.enable`. Expected `-32601`, with `'WebMCP.enable' wasn't found`. Settled by one `page.send('WebMCP.enable')` in the probe project, with a control command known to exist.
- Whether a WebSocket upgrade from a page origin to Chromium 141's debugger port is refused without `--remote-allow-origins`. Settled by a Playwright-provider page opening `ws://127.0.0.1:PORT/devtools/browser/ID` with and without the flag.
- OOPIF quad coordinates. Whether `DOM.getContentQuads` in an OOPIF session is frame-local, and whether `Input.dispatchMouseEvent` on the page session with parent-offset coordinates reaches the OOPIF node. Settled by a click proof on a `localhost` frame inside a `127.0.0.1` page.
- Whether `Input.dispatchMouseEvent` (`mouseReleased`) stays pending while a `confirm()` dialog is open, and resolves after `Page.handleJavaScriptDialog`. Settled by a service case recording command settlement order.
- Whether Chromium reuses a `backendDOMNodeId` within a renderer after a node is collected. Settled by recording ids across 10 000 create-and-remove cycles and a `look` after garbage collection (`HeapProfiler.collectGarbage`).
- The duration and size of `Accessibility.getFullAXTree` on a heavy page. Settled by timing the call and the message size on a captured large page served locally.
- Whether the `DevTools listening on` stderr line reaches the parent through Microsoft Edge's Windows launcher re-exec. Settled by the Edge-launcher launch on a Windows host with Edge installed.
- The daemon's effective `num_ctx` for `qwen3.5:2b-q4_K_M`. Settled by `/api/show` or `ollama ps` on the host. It fixes the `limit` defaults.
- Whether `num_predict: 64` (`/home/user/orkestrel/ollama/tests/setupService.ts:189`) leaves room for a tool call after the model's reasoning tokens. Settled by the real-model probe's per-turn `eval_count`.
- Whether `@orkestrel/agent` re-reads tool definitions each turn. Settled by reading `@orkestrel/agent`'s installed declarations. The static set does not depend on the answer.
- Exact outline and HTML sizes on the bloated page. P8 asserted a ratio above 3 and logged no values. Settled by re-running P8 with the values printed.

## Units

Engines: `builder` is Sonnet (mechanical). `opus` is Opus 5.5 (subjective judgment). `astra` is GPT-6 Astra for constraint-heavy units; while Astra is dark those run on `opus` with an objective-lane `reviewer`. Every unit ends with its touched file and project tests green and reports the commands it ran.

### 1. `contract` — core types

- **Role and engine:** `opus`.
- **Owned files:** `src/core/types.ts`, `src/core/errors.ts`, `package.json` (the `dependencies` block only), `package-lock.json`, `tests/src/core/errors.test.ts`.
- **Dependencies:** owner authorization of `@orkestrel/tool` at runtime.
- **Brief:**
  - Add `@orkestrel/tool` `^0.0.17` and `@orkestrel/markdown` `^0.0.16` to `dependencies`.
  - Add `signal?: AbortSignal` to `CDPSendOptions` and `BrowserSendOptions`.
  - Change `BrowserPageEventMap.navigate` to `readonly [url: string, same: boolean]` and add `session: readonly [frame: BrowserFrameInterface]`.
  - Declare the following, each with TSDoc:
    - `BrowserOutlineNode` (`key`, `role`, `name`, `value: string | undefined`, `states: readonly string[]`, `depth`, `frame: string | undefined`);
    - `BrowserSurfaceEventMap` (`navigate: [same: boolean]`, `popup: [surface]`, `dialog: [dialog: BrowserDialogInterface]`, `close: []`);
    - `BrowserMarkup` (`url`, `title`, `html`, `generation`);
    - `BrowserSurfaceInterface` (`emitter`, `url`, `generation`, `outline(key, signal)`, `markup(key, signal)`, `query?(css, signal)`, `click(key, signal)`, `type(key, text, submit, signal)`, `select(key, values, signal)`, `wait(target, timeout, signal)`, optional `press(key, signal)`, optional `navigate(url, timeout, signal)`, `destroy()`);
    - `BrowserReading`, `BrowserCapture`, `BrowserReadOptions`, `BrowserReaderInterface` as specified in `Reading entity contract`;
    - `BrowserLimit` (`outline?`, `reading?`, `receipt?`), `BrowserRegistryFunction`, `BrowserDriverOptions`, `BrowserDriverEventMap` (`focus: [url: string]`, `dialog: [message: string, accepted: boolean]`), `BrowserOutlineRow` (a node plus `ref`), `BrowserOutline`, `BrowserReceipt`, `BrowserDriverInterface` (`emitter`, `tools`, `look`, `read`, `find`, `click`, `type`, `select`, `press`, `open`, `wait`, `call`, `destroy`);
    - `BrowserToolAnnotations` (extends `ToolAnnotations`), `BrowserPageTool`, `BrowserRegistryEventMap`, `BrowserRegistryInterface`.
  - Add `BrowserReferenceError` (code `BROWSER_REFERENCE_ERROR`) and `isBrowserReferenceError`. Delete nothing in this unit.
- **Acceptance criteria:**
  1. `npm run check:src:core` exits 0.
  2. A Grep of `src/core/types.ts` for `^export (interface|type) (Tool|WebMCP|ModelContext|Markdown|HTML)` matches nothing.
  3. `tests/src/core/errors.test.ts` proves the guard accepts a `BrowserReferenceError` and refuses a `BrowserError`.
  4. `npm ci` reproduces the lockfile.

### 2. `abort` — CDP signal propagation

- **Role and engine:** `builder`.
- **Owned files:** `src/core/CDPClient.ts`, `src/core/BrowserFrame.ts` (the `send` method only), `tests/src/core/CDPClient.test.ts`, `tests/src/core/BrowserFrame.test.ts`, `tests/setup.ts` (`fail` gains an optional numeric `code` written into `error.code`).
- **Dependencies:** `contract`.
- **Acceptance criteria:**
  1. A pre-aborted signal rejects with `signal.reason`, and `transport.sent` stays empty.
  2. An abort after send rejects with the reason, deletes the pending entry, and clears its timer. A later reply for that id changes nothing, and no `CDPTimeoutError` follows (the test waits for the timeout plus 10 ms).
  3. A send without a signal behaves as before (the existing tests pass unchanged).
  4. `frame.send(method, params, { signal })` forwards the signal (assert the rejection reason).
  5. `fail(id, message, -32601)` produces a `CDPError` whose `context.code` is `-32601`.

### 3. `page-events` — navigation and session events

- **Role and engine:** `builder`.
- **Owned files:** `src/core/BrowserPage.ts`, `src/core/BrowserNavigationManager.ts`, `tests/src/core/BrowserPage.test.ts`, `tests/src/core/BrowserNavigationManager.test.ts`.
- **Dependencies:** `contract`.
- **Acceptance criteria:**
  1. `Page.frameNavigated` for the page frame emits `navigate` `[url, false]`.
  2. `Page.navigatedWithinDocument` for the page frame updates `page.url` and emits `[url, true]`, including outside a navigation wait. A child frame's event emits nothing.
  3. `Target.attachedToTarget` with `type: 'iframe'` emits `session` after `Page.enable` and `Runtime.enable` succeed. That frame's `send` carries the attached `sessionId` (assert on `transport.sent`).
  4. `navigation.wait(pattern, { signal })` resolves on a same-document navigation, and rejects with the reason on abort.

### 4. `reader` — reading entity

- **Role and engine:** `astra`; `opus` while Astra is dark.
- **Owned files:** `src/core/BrowserReader.ts`, `src/core/helpers.ts` (add `extractBrowserExcerpt(text, offset, limit)`), `src/core/factories.ts` (add `createBrowserReader`), `src/core/index.ts`, `tests/src/core/BrowserReader.test.ts`, `tests/src/core/helpers.test.ts`, `tests/setup.ts` (add `createMarkupSurface(pages)`, a minimal `BrowserSurfaceInterface` returning the inert markup list and counting `markup` calls, whose `emitter` the test drives).
- **Dependencies:** `contract`.
- **Acceptance criteria:**
  1. Distilled reading of the P7 page contains `A paragraph the reader wants.` and neither `Footer chrome` nor `One`; `whole: true` contains `Footer chrome`.
  2. For a 10 000-character document and `limit` 4 000, successive reads following `next` concatenate to exactly the full Markdown, each `text.length` is at most 4 000, and the last `next` is `undefined`.
  3. Two reads (offset 0, then `next`) on one generation call `markup` once.
  4. After the stub emits `navigate`, a read at a positive offset calls `markup` again and returns `offset` 0.
  5. `clear()` forces a recapture.
  6. Markup longer than `BROWSER_RESULT_LIMIT` rejects with `BrowserResultLimitError` before `createHTML` runs, shown by a markup string whose parse would throw.
  7. An aborted signal rejects with its reason.
  8. `capture().html.document` deep-equals `createHTML(stub html).document`.

### 5. `surface-read` — `CDPSurface` outline, markup, and readiness

- **Role and engine:** `astra`; `opus` while Astra is dark.
- **Owned files:** `src/core/surfaces/CDPSurface.ts`, `src/core/compilers.ts` (add `compileMarkupFunction`), `src/core/constants.ts` (add `BROWSER_OUTLINE_SKIPPED_ROLES`), `src/core/helpers.ts` (add `filterBrowserOutline` and `normalizeBrowserName`), `src/core/factories.ts` (add `createCDPSurface`), `src/core/index.ts`, `tests/src/core/surfaces/CDPSurface.test.ts`, `tests/setup.ts` (add `createAXTreeResult(page)` fixtures for the P8 page, including one `Iframe` node).
- **Dependencies:** `abort`, `page-events`.
- **Acceptance criteria:**
  1. The outline excludes ignored, `none`, `generic`, `StaticText`, and `InlineTextBox` rows. It contains `button "Save"` and `textbox "Email"` with the name trimmed.
  2. Keys read `SESSION:BACKEND`.
  3. An `Iframe` row triggers `Accessibility.getFullAXTree` with that `frameId`, on the session a preceding `session` event bound.
  4. `markup` issues exactly one `Page.createIsolatedWorld` per document. It issues another after `Runtime.executionContextsCleared`, and every `Runtime.evaluate` carries that `contextId`.
  5. `outline` and `markup` wait until a `Page.lifecycleEvent` `DOMContentLoaded` for the current `loaderId` has been seen. The test emits it 20 ms after the call and asserts no evaluation was sent before it.
  6. The surface emits `navigate` `[false]` and `[true]` from the page's events, and `generation` increments on each.

### 6. `surface-act` — `CDPSurface` actions and waits

- **Role and engine:** `astra`; `opus` while Astra is dark.
- **Owned files:** `src/core/surfaces/CDPSurface.ts` (action members), `src/core/compilers.ts` (add `compileHitFunction`, `compileSelectFunction`, `compileTextWaitExpression`; keep `compileActionabilityFunction`), `src/core/helpers.ts` (add `normalizeBrowserKey`), `tests/src/core/surfaces/CDPSurface.test.ts`, `tests/src/core/compilers.test.ts`, `tests/src/core/helpers.test.ts`.
- **Dependencies:** `surface-read`.
- **Acceptance criteria:**
  1. `click` sends, in order: `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, the hit check, then `Input.dispatchMouseEvent` `mousePressed` and `mouseReleased` at the quad center.
  2. An empty quad list rejects `BrowserReferenceError` with `is hidden`. A hit check returning a covering description rejects with `is covered by`. A `DOM.resolveNode` `CDPError` rejects with `is gone`.
  3. `type` sends `DOM.focus`, the selection function, and `Input.insertText` with the text. When `submit` is true it also sends a `keyDown` and `keyUp` pair for `Enter`.
  4. `normalizeBrowserKey` maps `enter`, `Return`, and `ENTER` to `Enter`, `esc` to `Escape`, and `ctrl+a` to `Control+a`. An unknown key throws a message listing the accepted names.
  5. `navigate` rejects `Page.navigate`'s `errorText` as a `BrowserError`.
  6. `wait` resolves `true` when the evaluation resolves `true`. After a `CDPError` `Execution context was destroyed` followed by a `DOMContentLoaded` lifecycle event, it re-sends the evaluation. It resolves `false` at the deadline, and on abort it sends the disconnect evaluation.
  7. `compileTextWaitExpression` contains no `setInterval` and at most one `setTimeout`, used for the deadline (Grep in the test).

### 7. `driver` — engine and vocabulary

- **Role and engine:** `opus` (vocabulary copy), with an objective `reviewer`.
- **Owned files:** `src/core/BrowserDriver.ts`, `src/core/parsers.ts` (add `parseBrowserRef`), `src/core/helpers.ts` (add `renderBrowserOutline`, `renderBrowserReceipt`, `renderBrowserPageTools`), `src/core/constants.ts` (add `BROWSER_TOOL_COPY`, `BROWSER_OUTLINE_LIMIT`, `BROWSER_READING_LIMIT`, `BROWSER_RECEIPT_LIMIT`, `BROWSER_SCHEMES`, `BROWSER_REFERENCE_PREFIX`), `src/core/factories.ts` (add `createBrowserDriver({ page, ...options })`), `src/core/index.ts`, `tests/src/core/BrowserDriver.test.ts`, `tests/src/core/parsers.test.ts`, `tests/src/core/helpers.test.ts`.
- **Dependencies:** `reader`, `surface-act`.
- **Acceptance criteria:**
  1. `driver.tools.map((tool) => tool.name)` equals `['look', 'read', 'click', 'type', 'select', 'press', 'open', 'wait', 'call']` over `CDPSurface`.
  2. `look` and `read` annotate `pure` and `untrusted`; `wait` annotates `pure`; `call` annotates `untrusted`; the rest carry none. Every `parameters` is a JSON Schema object, and every description is at most 100 characters.
  3. `parseBrowserRef` accepts every spelling in `References and locating` and refuses `x12`, `e0`, `e-1`, and `''`.
  4. Two `look` calls give one node the same reference. After a main-frame `navigate` `[false]`, `click('e1')` rejects with a message containing `gone` and `call look`, and the next `look` numbers from the previous maximum plus 1.
  5. Two `execute` calls issued together through `createToolManager().execute([a, b])` produce `Input.dispatchMouseEvent` frames in the order pressed-A, released-A, pressed-B, released-B.
  6. A queued call whose signal aborts sends nothing.
  7. `Page.javascriptDialogOpening` during a click sends `Page.handleJavaScriptDialog` with `accept` equal to the option (default `false`), and the receipt names the message.
  8. A `popup` moves focus and the receipt names its URL. The popup's `close` returns focus.
  9. `open('file:///etc/hosts')` rejects without sending `Page.navigate`.
  10. Every tool result's length is at most its limit plus its footer.

### 8. `registry` — `WebMCP` domain

- **Role and engine:** `astra`; `opus` while Astra is dark.
- **Owned files:** `src/core/BrowserRegistry.ts`, `src/core/parsers.ts` (add `parseBrowserPageTool` and `parseBrowserInvocation`), `src/core/constants.ts` (add `BROWSER_WEBMCP_ABSENT_CODE`), `src/core/factories.ts` (add `createBrowserRegistry`), `src/core/BrowserDriver.ts` (lazy registry wiring for `call` and the `look` footer), `src/core/index.ts`, `tests/src/core/BrowserRegistry.test.ts`, `tests/src/server/integration.test.ts`, `tests/setupServer.ts` (a `WebMCP` script for `CDPTestServer` that writes a response and an event in one socket write).
- **Dependencies:** `driver`.
- **Acceptance criteria:**
  1. A `-32601` failure on `WebMCP.enable` returns `undefined` and leaves no `WebMCP.*` subscription (a later `toolsAdded` event changes nothing).
  2. `toolsAdded`, emitted in the same `onSend` handler as the enable reply, is mirrored.
  3. A main-frame tool is named verbatim, and a child-frame tool is named `NAME@f1`. A second child frame is `@f2` whatever the arrival order of equal names.
  4. `toolsRemoved` and a child `Page.frameNavigated` remove entries and emit `remove`.
  5. `Completed` resolves `output`; `Error` rejects with `errorText`; `Canceled` rejects with a coded `BrowserError`.
  6. A `toolResponded` delivered before the `invokeTool` continuation (same handler as the reply) settles the call.
  7. An abort before the reply sends `WebMCP.cancelInvocation` with the id after the reply, and rejects with the reason. An abort after the reply sends it at once.
  8. `adopt()` tools carry `untrusted: true` when the wire hint is `false`.
  9. `destroy()` sends `WebMCP.disable` on every enabled session.
  10. Over the `CDPTestServer` WebSocket, the one-write burst settles `execute` (`tests/src/server/integration.test.ts`).

### 9. `removal` — clean breaks

- **Role and engine:** `builder`.
- **Owned files:**
  - `src/core/BrowserLocator.ts`, `src/core/BrowserSelectorManager.ts`, `src/core/BrowserCodegen.ts` and their tests (delete);
  - `src/core/BrowserFrame.ts`, `src/core/BrowserPage.ts`, `src/core/BrowserNavigationManager.ts`, `src/core/BrowserDownload.ts`, `src/core/compilers.ts`, `src/core/constants.ts`, `src/core/helpers.ts`, `src/core/parsers.ts`, `src/core/types.ts` (deletions and the `abort` rename only), `src/core/errors.ts`, `src/core/index.ts`;
  - the affected `tests/src/core/*.test.ts`;
  - `tests/service/browser.test.ts` (the locator and codegen cases move to reference actions or are deleted with their capability);
  - `guides/browser.md` (the deleted rows and methods, and invariants 2, 7, 8, 9, and 10 rewritten for the deletions).
- **Dependencies:** `driver`.
- **Acceptance criteria:**
  1. A Grep of `src` for `setInterval|BROWSER_WAIT_POLL_INTERVAL_MS|compileFunctionWaitExpression|Locator|Selector|Codegen|article\(|content\(|\.until\(|cancel\(` matches nothing except `src/server/Browser.ts` drain lines and `compileActionabilityFunction`.
  2. `BrowserDownload.abort` sends `Browser.cancelDownload`.
  3. `npm run check`, `npm run test:src`, and `npm run test:guides` exit 0.

### 10. `launch` — event-driven readiness

- **Role and engine:** `builder`.
- **Owned files:** `src/server/helpers.ts`, `src/server/Browser.ts` (`#waitForLaunch` and the drain interval constant import), `src/server/constants.ts` (add `BROWSER_DEVTOOLS_PATTERN`; move the drain interval here), `tests/src/server/helpers.test.ts`, `tests/src/server/Browser.test.ts`, `tests/setupServer.ts` (the fake process prints `DevTools listening on ws://…` to stderr).
- **Dependencies:** none; this unit can run in parallel with `contract`.
- **Brief:**
  - `launchBrowserProcess` spawns with `stdio: ['ignore', 'ignore', 'pipe']`.
  - `readBrowserEndpoint(stream, signal)` splits arrived text on `/\r\n|\n/` across chunks, resolves the first match, and keeps draining the stream after resolving.
  - Delete `waitForCDPReady`.
- **Acceptance criteria:**
  1. A launch against the fake process resolves with no `GET /json/version` recorded during launch.
  2. A line split across two chunks, and one ending `\r\n`, both resolve.
  3. An exit before the line rejects with the coded launch-exit error.
  4. A fixture writing 1 MB to stderr after readiness still answers `Browser.getVersion`.
  5. An abort rejects with the reason.
  6. The Edge-style launcher fixture still launches.

### 11. `browser-env` — `src/browser` scaffold

- **Role and engine:** `builder`.
- **Owned files:** `configs/src/tsconfig.browser.json`, `configs/src/vite.browser.config.ts`, `configs/browsers.ts` (staged by `scaffold repair`), `vite.config.ts`, `tsconfig.json` (paths), `package.json` (`exports['./browser']`, scripts `check:src:browser`, `build:src:browser`, `test:src:browser`, `test:src`, `devDependencies`), `tests/setupBrowser.ts`, `tests/setupGlobal.ts`, `src/browser/index.ts`, `src/browser/types.ts`, `src/browser/constants.ts`, `src/browser/helpers.ts`, `src/browser/factories.ts`.
- **Dependencies:** owner authorization of `playwright` and `@vitest/browser-playwright`; `contract`.
- **Acceptance criteria:**
  1. `npm run test:config` exits 0.
  2. `npm run check:src:browser` exits 0.
  3. `npm run test:src:browser` collects `tests/src/browser/helpers.test.ts` and passes.
  4. `npm run build` emits `dist/src/browser/index.js` and `index.d.ts`.

### 12. `document-surface` — DOM-native placement

- **Role and engine:** `opus`.
- **Owned files:** `src/browser/surfaces/DocumentSurface.ts`, `src/browser/helpers.ts` (`computeElementRole`, `computeElementName`), `src/browser/constants.ts` (`BROWSER_IMPLICIT_ROLES`, `BROWSER_CONTENT_NAMED_ROLES`), `src/browser/factories.ts` (`createDocumentSurface`, `createDocumentDriver`), `src/browser/index.ts`, `tests/src/browser/surfaces/DocumentSurface.test.ts`, `tests/src/browser/helpers.test.ts`, `tests/setupBrowser.ts` (`createProbeElements`, which builds the P7 and P8 page).
- **Dependencies:** `browser-env`, `driver`.
- **Acceptance criteria:**
  1. The outline contains `button "Save"`, `textbox "Email"`, and `link "One"`, and omits elements with `hidden`, `aria-hidden="true"`, or `display: none`.
  2. `click` toggles a checkbox, and a listener records `isTrusted === false`; the receipt ends `(untrusted event)`.
  3. `type` fires an `input` event that a listener installed on the prototype-setter path observes, with the value set.
  4. `tools` names equal `['look', 'read', 'click', 'type', 'select', 'wait', 'call']`.
  5. `wait` resolves after an element is appended 30 ms later, with no timer beyond the deadline (Grep).
  6. A removed element's reference rejects as gone.
  7. A `srcdoc` same-origin iframe's button appears. A cross-origin iframe row reads `(cross-origin, not readable)`.

### 13. `socket-transport` — browser-face CDP transport

- **Role and engine:** `builder`.
- **Owned files:** `src/browser/transports/SocketCDPTransport.ts`, `src/browser/types.ts`, `src/browser/factories.ts` (`createSocketCDPTransport`), `src/browser/index.ts`, `tests/src/browser/transports/SocketCDPTransport.test.ts`, `tests/setupGlobal.ts` (launch through `createBrowser` with `--remote-allow-origins=*`, then `provide` the endpoint).
- **Dependencies:** `browser-env`; the Orchestrator's ruling on the `Tensions` item for this transport.
- **Acceptance criteria:**
  1. A `CDPClient` over the transport receives `Browser.getVersion` `product`.
  2. A remote close emits `close`, and the client reports `drop`.
  3. `send` before `start` throws a coded `BrowserConnectionError` carrying `url`.
  4. The control: a second browser launched without the flag makes `start` reject.

### 14. `service` — real-browser proofs

- **Role and engine:** `opus`, with an objective `reviewer`.
- **Owned files:** `tests/service/driver.test.ts`, `tests/service/browser.test.ts`, `tests/setupService.ts`, `tests/setupServer.ts` (fixture pages: form, OOPIF pair on `127.0.0.1` and `localhost`, overlay, confirm, popup, async text, long article).
- **Dependencies:** `registry`, `removal`, `launch`; `document-surface` for the served-page comparison case.
- **Acceptance criteria:**
  1. `npm run test:service` passes on the host Chromium 141, and every case listed in `Tests and proofs` is collected.
  2. The live `WebMCP` case skips only when `WebMCP.enable` answered `-32601`, and names that reading.
  3. Each promoted P-case keeps its control.

### 15. `guide` — documentation

- **Role and engine:** `opus`.
- **Owned files:** `guides/browser.md`, `README.md`, `tests/guides.test.ts`, `PROPOSAL.md` (deleted, with the ruling in the commit).
- **Dependencies:** `service`.
- **Acceptance criteria:**
  1. `npm run test:guides` exits 0.
  2. The Contract section states the reference, reader, registry, serialization, and placement invariants.
  3. Invariant 2 names `markdown` and `tool`.
  4. The trusted-input and `alert()` limits and the `WebMCP` host limit are stated.
  5. The flagship fence driving `createBrowserDriver` is transcribed and asserted.

### 16. `repin` — consumer

- **Role and engine:** `builder`, in `/home/user/orkestrel/ollama`.
- **Owned files:** `/home/user/orkestrel/ollama/package.json`, `/home/user/orkestrel/ollama/package-lock.json`.
- **Dependencies:** `0.0.19` published.
- **Acceptance criteria:** `npm ci` then `npm run test:service -- tests/service/page.test.ts` passes unchanged.

### 17. `model-probe` — real-model fit

- **Role and engine:** the Orchestrator.
- **Owned files:** `tmp/probes/` in the ollama checkout.
- **Dependencies:** `service`.
- **Acceptance criteria:** criteria 1 through 4 of `Small-model fit` hold, and criterion 5 is recorded as a limit.

### Exit criterion

The campaign closes when every one of the following holds:

- units `contract` through `model-probe` are accepted;
- `npm run format:check`, `npm run lint:check`, `npm run check`, `npm run build`, `npm test`, and `npm run test:service` are green on this host, run bare by `verifier`;
- a Grep of `src` for `setInterval` and for condition-testing `setTimeout` loops finds only the process-group drain the Orchestrator ruled on;
- the ollama page proof is green on `^0.0.19`;
- the real-model probe's criteria are met.

## Tensions

The following items are judgment calls for the subjective lane or the Orchestrator.

1. **`@orkestrel/tool` at runtime** needs the owner's authorization (`PROPOSAL.md:21-22`, `../scaffold/AGENTS.md:36`). Without it the vocabulary cannot ship as `ToolInterface` values, and unit `contract` is blocked.
2. **`src/browser` requires `playwright` and `@vitest/browser-playwright`** as development dependencies (`tests/config.test.ts:153-158`). The owner said "stay away from pulling in binaries like playwright does." The provider uses the host's existing browser store, but the ruling is the owner's. If refused, the in-browser placement reduces to the mcp bridge, and units `browser-env`, `document-surface`, and `socket-transport` drop.
3. **`SocketCDPTransport` has no consumer.** The owner's environment-agnostic wording against the creation gate (`../scaffold/AGENTS.md:63`).
4. **Class and member names** are placeholders: `BrowserDriver`, `BrowserSurfaceInterface`, `CDPSurface`, `DocumentSurface`, `BrowserReader`, `BrowserRegistry`, `BrowserPageTool`, `SocketCDPTransport`, `createDocumentDriver`, the `registry` option, the page `session` event, the `navigate` payload `[url, same]` against two event names, and `find`.
5. **`consequential` on generic input tools.** Omitting it leaves confirmation to the consumer, while marking `click` makes every click need confirmation. The objective reading is that the annotation cannot be `true` for every click without being false for most.
6. **Receipts only, or an outline after each action.** Receipts cost fewer tokens. An automatic outline saves a `look` call, which a small model may forget. The probe decides.
7. **Dialog policy.** A driver `accept` option, default dismiss, against a `dialog` tool (one more tool).
8. **Focus follows popups automatically** against an explicit tab tool.
9. **Deleting codegen** against re-targeting its output to `find` plus reference actions.
10. **Keeping `BrowserSnapshot`** against the owner's "nothing is sacred". The law keeps it.
11. **The process-group drain** (`src/server/Browser.ts:1059-1078`) has no event source in Node for a non-child process. Keep it as a bounded probe named in `@remarks`, or route termination through `@orkestrel/process`, which needs authorization.
12. **Tool naming:** one lowercase word against namespacing. Generic names such as `read`, `open`, and `call` can collide with other tool sets in a consumer's manager, and a `prefix` option would add one option.
13. **Lenient reference parsing** in the handler, with a JSON Schema and no `contract`, against strict contract refusal.
14. **`wait` scope.** The main frame only, or same-origin frames too.
15. **DOM `type` on contenteditable:** refused, or supported through `InputEvent` with `insertText` semantics.
16. **`hover` and `drag` omitted** from the CDP vocabulary.
17. **Bound defaults** of 4 000, 4 000, and 300 characters, pending `num_ctx`.
18. **Scheme allowlist** default `http` and `https`, refusing `file:`, `data:`, and `chrome:`.
19. **`debugging` page tools hidden** from the `call` listing.
20. **Where the end-to-end MCP proof lives:** ollama's service axis, as proposed, or mcp.

## Risks

Each attack below was made against a load-bearing claim, with its input or ordering and the outcome the design carries.

1. **A stale reference after navigation.** Input: `look` on page A gives `e1`; the model opens B, then clicks `e1`. With per-document renumbering, `e1` would name B's first node and click the wrong element silently. Outcome: numbers are never reused within a driver, and the table drops on cross-document navigation, so `e1` reports gone.
2. **OOPIF id collision.** Input: the main frame and an OOPIF both hold `backendDOMNodeId` 7. Outcome: keys carry the session.
3. **A click on a covered element.** Input: a cookie banner overlays the target. Without a hit test the trusted click lands on the banner. Outcome: the hit check reports `covered by`. A residual risk remains: an OOPIF's frame-local hit test against page-level coordinates is unmeasured (see `Measurements`).
4. **A dialog blocks input.** Ordering: `mouseReleased` is pending, `confirm()` opens, and the command would stay pending until the timeout. Outcome: the driver handles the page's `dialog` event concurrently with the pending command. That the command resolves afterward is unmeasured.
5. **Concurrent tool calls.** Input: a batch `execute` of two clicks. Interleaved `Input` events would produce a drag. Outcome: first-in, first-out serialization.
6. **WebMCP enable race.** Ordering: `toolsAdded` arrives in the same tick as the `enable` reply. A subscription made after `await send` would miss it. Outcome: subscribe first.
7. **WebMCP response burst.** Ordering: the `invokeTool` reply and `toolResponded` are parsed in one synchronous loop, so the event handler runs before the continuation learns the id. Outcome: a buffer that lives while an invocation is in flight. The buffer cannot grow without bound, because it clears when the count returns to zero; responses to other clients' invocations are dropped then.
8. **Abort before the invocation id.** If the signal were passed to `send`, the pending entry would be deleted, the browser would still run the tool, and nothing could cancel it. Outcome: no signal on `invokeTool`, and a pending cancel sent when the id arrives.
9. **Page-tool hijack.** Input: a page registers `click`. Outcome: `call` indirection; `adopt()` leaves the collision choice to the consumer.
10. **Prompt injection through tool descriptions.** Page descriptions arrive only as an `untrusted` tool result. Outputs are `untrusted` regardless of the page's hint.
11. **Reading consistency.** Input: `read` offset 4 000 after the SPA route changed. Offsets from the old capture would splice two documents. Outcome: generation check and reset to 0. A residual risk remains: DOM mutation without navigation leaves a retained capture older than the page. Reads at offset 0 always recapture, and continuation reads state the capture's generation, not live freshness.
12. **Main-world tampering.** Input: a page overrides `Element.prototype.outerHTML`. Outcome: the surface evaluates in an isolated world. `page.evaluate` stays in the main world for consumers, a limit the guide states.
13. **Isolated-world leak.** `BrowserFrame` creates a world per evaluation (`src/core/BrowserFrame.ts:258-271`), and a long agent session would accumulate worlds. Outcome: the surface caches one world per document and drops it on the `Runtime` context events. `BrowserFrame`'s own child-frame path keeps the per-call behavior (see `Tensions` for a follow-up).
14. **`wait` across navigation.** Ordering: text appears in the next document before the observer re-arms. Outcome: the expression checks on arming.
15. **Lifecycle seeding.** Ordering: `Page.setLifecycleEventsEnabled` arrives after `DOMContentLoaded`. Waiting for the event would hang to the deadline. Outcome: a single `document.readyState` read seeds the state.
16. **Stderr pipe backpressure.** Chromium's logging fills an undrained pipe and blocks the browser. Outcome: the stream is drained for the process life (unit `launch`, criterion 4).
17. **Windows Edge launcher.** The re-executed browser might not inherit stderr, so no line would arrive and launch would fail. The risk is unmeasured (see `Measurements`). The launch-exit race still fails loudly rather than hanging.
18. **DOM placement blocking.** A click that triggers `alert()` blocks the agent. The guide records it, and the package does not patch globals.
19. **DOM outline divergence.** A home-grown accessible-name computation differs from Chromium's. Outcome: the service comparison asserts the interactive `(role, name)` set, and exact text equality is not asserted.
20. **Small-model reference errors.** Input: `"ref": 12`, `"[e12]"`, or `"e12 "`. Outcome: lenient parse. A residual risk remains: a model inventing references is caught as unknown, which costs one call.
21. **Context overflow.** At an unknown `num_ctx`, 9 definitions plus a 4 000-character reading might exceed the window. Outcome: bounds are options, and the probe records prompt tokens per turn.
22. **Silent tool replacement in the consumer's manager.** Generic names such as `read` collide with a file tool's `read`. The design leaves the choice to the consumer and lists it under `Tensions`.
23. **`backendDOMNodeId` reuse.** If Chromium reused ids, a gone reference could resolve to an unrelated node. This is unmeasured (see `Measurements`). Reference numbers never repeat, but the underlying key could.
24. **`-32601` misclassification.** A timeout or disconnect during `WebMCP.enable` read as "absent" would hide a live registry. Outcome: only `context.code === -32601` maps to `undefined`.
