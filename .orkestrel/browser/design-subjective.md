# Proposal: `@orkestrel/browser` as the agent's browser (subjective lane)

## Lane

This proposal holds the subjective lane: shape, naming, ergonomics, and design fit. Where a question turns on what the protocol or a contract permits, I give the shape I recommend and record the correctness question under `Tensions` for the objective lane. I didn't look for or reconcile the other lane's answer.

## Design

The package stays one package with three environments. They share one engine: one reference-based element model, one bounded reading value, and one tool vocabulary built on `@orkestrel/tool`. The CDP placement drives Chromium from outside through the protocol's native domains (`Accessibility`, `DOM`, `Input`, `Page` lifecycle, `WebMCP`). The DOM placement runs the same engine over a live `Document` inside a page. Every wait parks on an event or a signal. Every text result a model sees is bounded in characters and reports its own truncation. The in-page compiled locator engine, the polling waits, and the selector-script recorder are deleted rather than aliased.

### Environment map

Each environment owns and imports the following after the redesign.

| Environment | Owns | Imports |
| --- | --- | --- |
| `src/core` (ESNext + WebWorker, no DOM) | `CDPTransportInterface` and `CDPClient` (gains `signal`); `BrowserContext`, `BrowserPage`, `BrowserFrame` over CDP; the element model (`BrowserElementManager`, `BrowserElement` under `src/core/elements/`); the reading value (`BrowserReading`); the page's WebMCP registry over the CDP domain (`BrowserRegistry`); the shared tool engine (`BrowserToolset`, `createBrowserToolset`); every kept manager (network, routes, HAR, cookies, permissions, storage, emulation, diagnostics, clock, scripts, accessibility, snapshot); outline and receipt rendering helpers; the reference parser | `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/markdown`, `@orkestrel/tool` |
| `src/browser` (DOM; created by this design) | `BrowserDOMView` (one reachable `Document`); `BrowserDOMElementManager` and `BrowserDOMElement` under `src/browser/elements/`; role and name computation helpers; `createBrowserDOMView` and `createDocumentToolset` | `@src/core` (the engine, the reading value, the shared types), `@orkestrel/tool` (types) |
| `src/server` (Node) | `Browser` (discover, connect, launch, adopt, disconnect, destroy, close, ownership, process groups); `WebSocketCDPTransport`; `FileBrowserWriter`; `findSystemBrowser` family; launch readiness from the child's stderr | `@src/core`, `@orkestrel/websocket`, `@orkestrel/contract`, `@orkestrel/emitter`, `node:*` |

`src/browser` exists, and its content is the DOM-native implementation of the agent vocabulary and nothing else. It ships no CDP transport over the host `WebSocket`: no consumer asks for a page or an extension driving CDP, and Chrome's `--remote-allow-origins` gate makes a page-driven debugger socket a configuration hazard rather than a mechanism (see `Tensions` T19). The in-browser placement reaches tools outside the browser through `@orkestrel/mcp`'s browser-face clients, which already exist, so this package adds nothing for that direction. A consumer registers those clients' tools in the same `ToolManagerInterface` the toolset writes into.

### Page surface after the redesign

The frame and page contracts change as follows. Everything not listed keeps its current shape.

- `BrowserFrameInterface` keeps `id`, `parent`, `name`, `url`, `title`, `evaluate`, `handle`, `send`, `subscribe`, `unsubscribe`, `save`, `assert`, and `update`, and gains `read`. It loses `selectors`, `keyboard`, `mouse`, `touch`, `content`, `article`, `click`, `fill`, `select`, and `wait` (`src/core/types.ts:1776-1807`).
- `BrowserPageInterface` gains `elements` (the element manager), `registry` (the page's WebMCP registry), `keyboard`, `mouse`, and `touch` (moved from the frame, because one tab has one input stream and Chromium routes page coordinates into out-of-process frames), `trusted` (a constant `true`), and `wait(text, options)`. It loses `codegen` (`src/core/types.ts:2084`).
- Every asynchronous page, frame, element, and registry member takes a trailing `BrowserCallOptions` carrying `timeout` and `signal`. That replaces the positional `timeout` on `evaluate` (`src/core/types.ts:1801`) and the timeout-only `BrowserSendOptions` (`src/core/types.ts:1731-1733`). The known consumer documents the gap it works around: page commands take "a per-call `timeout` and no signal" (`/home/user/orkestrel/ollama/tests/service/page.test.ts:17-22`). A tool handler also needs `ToolContext.signal` (`../tool/src/core/types.ts:5-10`) to reach the CDP call it issued.

The added core contracts are shown in the following fence. Members are one word, collections are readonly, and absence is `undefined`.

```ts
// src/core/types.ts — added contracts (excerpt)
export interface BrowserCallOptions {
	readonly timeout?: number
	readonly signal?: AbortSignal
}

export interface BrowserElementQuery {
	readonly role?: string
	readonly name?: string
	readonly css?: string
	readonly within?: string
}

export interface BrowserElementWaitOptions extends BrowserCallOptions {
	readonly absent?: boolean
}

export interface BrowserOutlineOptions extends BrowserCallOptions {
	readonly limit?: number
	readonly within?: string
}

export interface BrowserOutline {
	readonly url: string
	readonly title: string
	readonly text: string
	readonly count: number
	readonly total: number
}

export interface BrowserElementInterface {
	readonly ref: string
	readonly role: string
	readonly name: string
	click(options?: BrowserCallOptions): Promise<void>
	fill(value: string, options?: BrowserCallOptions): Promise<void>
	select(values: readonly string[], options?: BrowserCallOptions): Promise<void>
	focus(options?: BrowserCallOptions): Promise<void>
	read(options?: BrowserCallOptions): Promise<BrowserReadingInterface>
}

export interface BrowserPageElementInterface extends BrowserElementInterface {
	hover(options?: BrowserCallOptions): Promise<void>
	press(key: string, options?: BrowserCallOptions): Promise<void>
	upload(files: readonly string[], options?: BrowserCallOptions): Promise<void>
	drag(target: BrowserPageElementInterface, options?: BrowserCallOptions): Promise<void>
	quad(options?: BrowserCallOptions): Promise<BrowserQuad>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
}

export interface BrowserElementManagerInterface<
	TElement extends BrowserElementInterface = BrowserElementInterface,
> {
	outline(options?: BrowserOutlineOptions): Promise<BrowserOutline>
	find(query: BrowserElementQuery, options?: BrowserCallOptions): Promise<readonly TElement[]>
	wait(query: BrowserElementQuery, options?: BrowserElementWaitOptions): Promise<readonly TElement[]>
	element(ref: string): TElement | undefined
	elements(): readonly TElement[]
	clear(): void
}

export interface BrowserViewInterface {
	readonly url: string
	readonly trusted: boolean
	readonly elements: BrowserElementManagerInterface
	title(options?: BrowserCallOptions): Promise<string>
	read(options?: BrowserCallOptions): Promise<BrowserReadingInterface>
	wait(text: string, options?: BrowserCallOptions): Promise<void>
}
```

`BrowserPageInterface` extends both `BrowserFrameInterface` and `BrowserViewInterface`, and it narrows `elements` to `BrowserElementManagerInterface<BrowserPageElementInterface>`. `BrowserDOMView` implements `BrowserViewInterface` with `trusted` set to the constant `false`.

### Tool vocabulary

**Naming rule.** Tool names are data advertised to a model, so the one-word entity law doesn't bind them. I apply one rule: `browser_` followed by one lowercase English verb, in snake_case, using Playwright MCP's verb wherever the capability is the same (`../browser/tmp/units/webmcp-research-report.md:149-156`). The fixed prefix does three jobs:

- It keeps the generic set disjoint from a mixed agent registry, where a workspace `read` tool would collide with a bare `read`.
- It reserves a namespace that a page's own WebMCP tools can't shadow.
- It reuses spellings a small model has seen in Playwright MCP transcripts.

Descriptions are one sentence under 100 characters. Parameter schemas carry at most three properties, and a model always sends at most two required strings.

**Registry home and scope.** The registry is `@orkestrel/tool`'s own `ToolManagerInterface` (`../tool/src/core/types.ts:221-313`). This package neither wraps it nor re-exports it. The entity that fills and follows it is `BrowserToolset`, with this interface: `emitter`, `tools` (the manager), `view` (the current view), `start(options?)`, and `destroy()`. It follows `BrowserToolsetEventMap` with the events `adopt`, `skip`, and `select`. Scope is one current view: one tab in the CDP placement, and one document in the DOM placement. With the `context` option, the toolset follows tabs across the context and moves the page tools with the cursor. `options.tools` accepts the consumer's existing manager, so the browser tools join an agent registry without a copy. A consumer hosts it over MCP by passing `toolset.tools` to `createPageServer`, `createScopeServer`, or the mcp server face (`../mcp/src/browser/types.ts:174-179`). This package gains no edge to `@orkestrel/mcp`.

Two factories create the one engine, split by placement input:

- `createBrowserToolset(page, options?)` in `src/core`.
- `createDocumentToolset(options?)` in `src/browser`, where `options.document` defaults to `globalThis.document` and `options.source` takes a page-tool source.

The advertised set follows. The default CDP set is 7 tools, and the DOM set is 5. "Not advertised" means the placement doesn't list the tool at all, rather than listing it and failing every call.

| Tool | Parameters | Annotations | Result (text, bounded) | CDP implementation | DOM-native implementation |
| --- | --- | --- | --- | --- | --- |
| `browser_navigate` | `url` (string, required) | none | `Opened "TITLE" at URL.` | `page.navigate(url, { condition: 'load', signal })`; clears the reference table | Not advertised: navigating the caller's own document ends the caller |
| `browser_outline` | none | `pure`, `untrusted` | Header line, then one line per element, then a count footer | `page.elements.outline()`: `Accessibility.getFullAXTree` per frame session, filtered, with references from `backendDOMNodeId` | `BrowserDOMElementManager.outline()`: `TreeWalker` over the document, with role and name from the DOM helpers and references held through `WeakRef` |
| `browser_read` | `offset` (integer, optional), `ref` (string, optional) | `pure`, `untrusted` | A Markdown slice of the distilled page, plus a footer when truncated | `frame.read()` then `reading.markdown({ offset, limit })`; with `ref`, `element.read()` through `DOM.getOuterHTML` by backend node under the result guard | `view.read()` from `document.documentElement.outerHTML`; with `ref`, the element's `outerHTML` |
| `browser_click` | `ref` (string, required) | none | `Clicked ROLE "NAME" [ref=REF].` plus at most one follow-up sentence | `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, hit test at the quad center with `DOM.getNodeForLocation`, then `Input.dispatchMouseEvent` | `scrollIntoView`, then `HTMLElement.click()`; refuses a disabled element |
| `browser_type` | `ref` (string, required), `text` (string, required), `submit` (boolean, optional) | none | `Typed "TEXT" into ROLE "NAME" [ref=REF].` or `Selected "TEXT" in ...` | Text field: `DOM.focus`, select-all chord, `Input.insertText`, trusted `Enter` when `submit`. `select` element: the option matching label or value, set through `Runtime.callFunctionOn` (programmatic in both placements) | Native value setter plus `input` and `change` events; `select` by option; `submit` through `form.requestSubmit()` |
| `browser_press` | `key` (string, required, for example `Enter` or `Control+A`) | none | `Pressed KEY.` | `page.keyboard.press(key)` | Not advertised: no untrusted key event performs a default action |
| `browser_wait` | `text` (string, required), `timeout` (integer seconds, optional, default 5, most 30) | `pure` | `"TEXT" is on the page.` | `page.wait(text)`: mutation reports through a host binding (P3), each report re-checking guarded `innerText` | `MutationObserver` on the document, each record batch re-checking `innerText` |
| `browser_dialog` (staged: listed only while a dialog is open) | `accept` (boolean, required), `text` (string, optional) | none | `Accepted the confirm dialog "MESSAGE".` | `BrowserDialogInterface.accept` or `dismiss` | Not advertised: a page's own dialog blocks its own thread |
| `browser_tabs` (opt-in through `context`) | none | `pure` | One line per tab: `[tab=t1] "TITLE" URL (current)` | `context.pages()` | Not advertised |
| `browser_switch` (opt-in through `context`) | `tab` (string, required) | none | `Switched to "TITLE".` | Moves the toolset cursor, then `Page.bringToFront` | Not advertised |
| Page tools (staged: listed while the page registers them) | The page's `inputSchema` | `untrusted` always, plus `pure` from `readOnly` and `consequential` from `consequential` | Rendered output, bounded by `limit` | `page.registry.adopt()`; `execute` runs `WebMCP.invokeTool`, and an abort sends `WebMCP.cancelInvocation` | `options.source.adopt()`; `@orkestrel/mcp`'s `createModelContext()` satisfies the source shape structurally |

The result text formats are shown in the following fence. Every placeholder is upper snake case: `TITLE` is the document title, `URL` is the address, `ROLE` and `NAME` are the accessible role and name, `REF` is an element reference, and `START`, `END`, and `TOTAL` are character positions.

```text
Page: TITLE — URL
- heading "Your cart" [ref=e1] [level=1]
- textbox "Email" [ref=e4]: "sam@example.test"
- checkbox "Gift wrap" [ref=e5] [checked]
- button "Place order" [ref=e6] [disabled]
- form "Search cars" [ref=e9] [tool=search-cars]
(24 of 24 elements shown)

[Showing characters START–END of TOTAL. Call browser_read with offset END for more.]

Clicked link "Next" [ref=e3]. The page changed to "Step 2" at URL; call browser_outline for fresh refs.
Clicked button "Delete" [ref=e7]. A confirm dialog is open: "Delete the draft?"; call browser_dialog to answer it.
```

**Comparison with the shipped servers.** I match a small set of their features and refuse others, as follows.

- *Match:* accessibility-first references (DevTools `uid`, Playwright `ref`), the `browser_` spelling, reference-based click and type, a text wait, and dialog handling.
- *Refuse coordinate tools* (`click_at`, `browser_mouse_*`): they need vision and bypass the reference contract.
- *Refuse `evaluate_script`, `browser_evaluate`, and `browser_run_code_unsafe`:* arbitrary code sidesteps every annotation and every result bound. A consumer composes it from `page.evaluate` when they want it.
- *Refuse network, console, emulation, storage, tracing, performance, and heap tools:* they serve a debugging human, not a browsing model. The mechanisms stay on the programmatic surface.
- *Refuse `list_webmcp_tools` and `execute_webmcp_tool`:* page tools become first-class tools with their own schemas. A 2-billion-parameter model fills a schema more reliably than it JSON-stringifies an `input` argument into a meta-tool.
- *Merge select into `browser_type`:* choosing an option by its label is the same operation as setting a field's value.

### Locating and acting

**References.** A reference is `e` followed by a positive integer, minted by the page's element manager from one monotonic counter.

- *Stability:* a reference stays bound to one element while that element exists.
- *No reuse:* a number is never reused on that page, so a stale reference can never alias a later element.
- *CDP binding:* the table maps each reference to `{ frame, session, backend }`, where `backend` is the accessibility node's `backendDOMNodeId` (P4, `src/core/types.ts:469-481`).
- *DOM binding:* the table maps each reference to a `WeakRef<Element>`.
- *Spelling:* `[ref=e12]` in an outline puts the parameter name beside its value, which is the string a small model copies into `{"ref":"e12"}`.
- *Input tolerance:* `parseBrowserReference` accepts `e12`, `E12`, `12`, `ref=e12`, and `[ref=e12]` and returns `e12`, or `undefined` for anything else.

**Queries.** `elements.find(query)` resolves natively with no in-page locator engine:

- Role and name queries go through `Accessibility.queryAXTree` (`tmp/units/browser_protocol.json:524-526`, marked experimental).
- `css` queries go through `DOM.querySelectorAll` on the document node.
- `within` scopes either query to a referenced element.

The six locator axes fold into those two paths: `role` and `label` are role and name, `text` and `placeholder` are the accessible name, and `testId` and `css` are CSS. Every element a query returns receives a reference.

**Actions.** A trusted CDP click takes four steps:

1. `DOM.scrollIntoViewIfNeeded`.
2. `DOM.getContentQuads`; no quad raises `BrowserElementError` code `HIDDEN`.
3. `DOM.getNodeForLocation` at the quad center; a hit outside the element and its descendants raises code `OCCLUDED`.
4. `Input.dispatchMouseEvent`.

A disabled element, read from the accessibility node's `disabled` property, raises code `DISABLED`. A reference that no longer resolves raises code `GONE`, and its message names the next step: `Element e12 is gone because the page changed; call browser_outline for fresh refs.` The two-frame "stable" check (`compileActionabilityFunction`) goes away; the hit test covers the occlusion case it served (see `Tensions` T12).

**Waits.** The element manager installs one main-world mutation reporter per page through `page.scripts.expose` and `page.scripts.add`, and coalesces reports so one query runs at a time (P3). `elements.wait(query)` re-runs `find` on each report and resolves on the first match, or on the first empty result when `absent` is set. `page.wait(text)` re-checks guarded `innerText` on each report. Both settle on `signal` or `timeout` and poll nothing.

**What remains of the locator stack.** `BrowserLocator`, `BrowserSelectorManager`, the `css`, `role`, `text`, `label`, `placeholder`, and `testId` axes (`src/core/types.ts:698`), the locator and wait compilers (`src/core/compilers.ts:301-889`), and `BROWSER_WAIT_POLL_INTERVAL_MS` are deleted, and nothing of them remains. The screenshot `mask` option changes from `readonly BrowserLocatorInterface[]` (`src/core/types.ts:378`) to `readonly BrowserPageElementInterface[]`.

**`BrowserNavigationManager.until`** is deleted. An arbitrary predicate carries no event, and every predicate a consumer actually waits on has one: an element appearing or leaving (`elements.wait`), text appearing (`page.wait`), a URL (`navigation.wait`), or the network settling (the `idle` lifecycle). `BrowserNavigationManager` keeps `wait(pattern)` and gains `idle(options)`, which resolves on the next `Page.lifecycleEvent` named `networkIdle` for the main frame's current loader (P6). `BrowserWaitUntil` gains `'idle'` (`src/core/types.ts:203`).

### Reading entity contract

Reading is a value entity, `BrowserReading`. Its contract is shown in the following fence.

```ts
export interface BrowserReadOptions {
	readonly distill?: boolean
	readonly offset?: number
	readonly limit?: number
}

export interface BrowserReadResult {
	readonly text: string
	readonly offset: number
	readonly total: number
}

export interface BrowserReadingInterface {
	readonly url: string
	readonly title: string
	readonly html: HTMLInterface
	readonly stale: boolean
	markdown(options?: BrowserReadOptions): BrowserReadResult
	text(options?: BrowserReadOptions): BrowserReadResult
}
```

**Capture.** `frame.read()` issues one guarded `Runtime.evaluate` returning `{ url, title, html }`. That resolves the distillate's contradiction I.1: one capture under `BROWSER_RESULT_LIMIT`, with the `BrowserResultLimitError` crash guard kept (`guides/browser.md:1932-1950`). The DOM view reads the same three facts from its document.

**Retention.** The value holds the capture string and html's own handle (`html`, created by `createHTML`). It exposes that handle rather than re-wrapping html's query surface (`../html/src/core/types.ts:409-478`). It holds no remote object, so release is dropping the reference. The toolset retains the last reading so `browser_read` with an `offset` continues the same capture.

**Projections.**

- `markdown` is `renderMarkdown(htmlToMarkdown(handle.document))` (`../markdown/src/core/helpers.ts:2756`, `:1748`).
- `text` is html's `renderText`.
- Both run over `html.distill({ base: url })` when `distill` is true, which is the default, or over the whole document when it's false.
- Each mode is parsed and rendered at most once per reading, and every later slice reuses it.

**Bound.** `limit` counts characters, and so does `offset`. The result carries `offset` and `total`, and truncation is derived as `offset + text.length < total`, never stored. The tool default is `BROWSER_TOOL_LIMIT` (4 000 characters). The programmatic default is unbounded.

**Invalidation.** `stale` is derived: the reading records the frame's navigation epoch at capture, and the getter compares it with the frame's current epoch. The page increments that epoch from `Page.frameNavigated` for that frame and on detach, so the check is event-driven. In the DOM placement, `stale` turns true after the document's `pagehide`. A DOM mutation doesn't mark a reading stale: offsets stay valid over the captured text, and the next fresh read (`offset` 0) takes a fresh capture.

**Frame ownership.** A reading belongs to the frame that produced it. `browser_read` reads the main frame, or the frame that owns `ref`.

**Wrapper test.** The entity composes a bounded remote capture, parsing, optional distilling, and two projections. It adds a lifecycle (derived staleness), an invariant (one parse and one render per mode across every slice), and a narrower contract (bounded slices with an offset and a total). It forwards nothing one-to-one.

**Fate of the old members.** `content()` and `article()` are deleted, and `read()` replaces both: `article()` becomes `(await frame.read()).text()`. `snapshot()` stays, with the reasoning under What goes.

### WebMCP entity contract, outside the browser

`page.registry` is `BrowserRegistry`, which drives the experimental `WebMCP` domain (`tmp/units/webmcp-cdp-domain.md:9-34`). Its contract is shown in the following fence.

```ts
export interface BrowserToolAnnotation {
	readonly readOnly?: boolean
	readonly untrustedContent?: boolean
	readonly consequential?: boolean
	readonly debugging?: boolean
	readonly autosubmit?: boolean
}

export interface BrowserTool {
	readonly name: string
	readonly description: string
	readonly schema: Readonly<Record<string, unknown>> | undefined
	readonly annotation: BrowserToolAnnotation
	readonly frame: string
	readonly node: number | undefined
}

export interface BrowserInvocation {
	readonly id: string
	readonly tool: string
	readonly frame: string
	readonly input: string
}

export interface BrowserInvocationResult {
	readonly id: string
	readonly status: string
	readonly output: unknown
	readonly error: string | undefined
}

export type BrowserRegistryEventMap = {
	readonly change: readonly []
	readonly invoke: readonly [invocation: BrowserInvocation]
	readonly respond: readonly [result: BrowserInvocationResult]
}

export interface BrowserRegistryInterface {
	readonly emitter: EmitterInterface<BrowserRegistryEventMap>
	start(options?: BrowserCallOptions): Promise<boolean>
	tool(name: string, frame?: string): BrowserTool | undefined
	tools(): readonly BrowserTool[]
	adopt(): Promise<readonly ToolInterface[]>
	execute(
		tool: BrowserTool,
		input: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<BrowserInvocationResult>
	destroy(): Promise<void>
}

export type BrowserToolSourceEventMap = { readonly change: readonly [] }

export interface BrowserToolSourceInterface {
	readonly emitter: EmitterInterface<BrowserToolSourceEventMap>
	adopt(): Promise<readonly ToolInterface[]>
}
```

**Detection.** `start()` sends `WebMCP.enable` and resolves `true`. When the browser lacks the domain, it resolves `false` and emits nothing. Feature detection is the return value, as in the mcp bridge (`../mcp/src/browser/factories.ts:422-427`); there's no polyfill and no `supported` flag.

**Events.** `toolsAdded` and `toolsRemoved` update the table keyed by `(frame, name)` and emit `change`. `toolInvoked` emits `invoke`, and `toolResponded` emits `respond`.

**Execution.** `execute` sends `WebMCP.invokeTool` and resolves on the `toolResponded` whose `invocationId` matches. An abort of `options.signal` sends `WebMCP.cancelInvocation` and rejects with the abort reason. No member is named `cancel`.

**Adoption.** `adopt()` projects each `BrowserTool` to a `ToolInterface`:

- `name`, `description`, and `parameters` come from `schema`.
- `untrusted` is always true; `pure` comes from `readOnly`, and `consequential` from `consequential`.
- The handler calls `execute` with `ToolContext.signal`.
- A response whose status isn't success throws a message naming `error`.
- `renderBrowserToolOutput` renders `output`: a string passes through, an MCP content array joins its text blocks, and anything else becomes bounded JSON.

**Adoption policy in the toolset.** On `change`, the toolset re-adopts and diffs by name into `tools` through `add` and `remove`. Tools skip in three cases, each emitting `skip`:

- A name under the reserved `browser_` prefix.
- A name another frame's tool already holds; the main frame wins, then the earlier registration.
- A tool marked `debugging`, which the toolset doesn't adopt.

A declarative form tool (`node` defined) receives a reference, and the outline marks its form `[tool=NAME]`.

**Runtime evaluation path.** The `Runtime.evaluate` path over `document.modelContext` (P5) is refused as a second mechanism. The domain is the platform's external-agent path: it carries `frameId`, declarative `backendNodeId`, and invocation cancel, which the in-page registry doesn't. Main-world evaluation would impersonate the page's own scripts. A browser that ships the registry without the domain reports `start()` as `false`, and that's the documented limit (see `Tensions` T5).

### WebMCP inside the browser

The answer is a DOM-native tool set that the mcp bridge publishes, and this package adds no registry client of its own. `createDocumentToolset({ source })` accepts any `BrowserToolSourceInterface`. `createModelContext()` returns a `ModelContextInterface` whose `emitter` is typed over `{ change: readonly [] }` and whose `adopt()` returns `ToolInterface[]` (`../mcp/src/browser/types.ts:411-414`, `:551`), so it satisfies the source shape without an import. A consumer publishes the toolset's `tools` with the same bridge's `publish` when built-in browser agents need them.

### Trusted against DOM-native input

The two placements differ as follows.

- **CDP (trusted).** The page reports `trusted` as `true`. Clicks, keys, and hovers are `Input` domain events with `isTrusted` true, so they grant user activation and run every default action. Value setting on `select` elements is programmatic in both placements, and the guide says so.
- **DOM (untrusted).** The view reports `trusted` as `false`.
  - `click` is `HTMLElement.click()`, which runs activation behavior (links, checkboxes, form submission) with `isTrusted` false and grants no user activation.
  - `fill` is the native value setter plus `input` and `change`.
  - `submit` is `requestSubmit()`, a platform action with the same validation and events a user gets.
- **Refused in the DOM placement.** `press`, `hover`, `upload`, `drag`, `quad`, and `screenshot` don't exist on `BrowserDOMElement`, because they sit on `BrowserPageElementInterface` only. The toolset doesn't advertise `browser_press`, `browser_navigate`, `browser_dialog`, or the tabs tools there. A `dispatchEvent`-based stand-in performs no default action, so it would report success for input that didn't happen.

### Event and invalidation model

Each state below is invalidated by the listed event, and no row reads state on a timer.

| State | Invalidated by | Effect |
| --- | --- | --- |
| Reference table entries of a frame | `Page.frameNavigated` for that frame (cross-document), `Page.frameDetached`, `Target.detachedFromTarget` for its session | Entries dropped; the counter continues |
| Whole reference table | Main-frame `Page.frameNavigated`, page `close` | `elements.clear()`; the toolset's next receipt says the page changed |
| One reference | Its node removed without navigation | Detected at use as `GONE` (`DOM.resolveNode` or `DOM.getContentQuads` error, P4 control) |
| Reading | Frame navigation epoch changes; DOM `pagehide` | `stale` turns true; the next `browser_read` offset 0 captures again |
| Registry table | `WebMCP.toolsAdded` and `WebMCP.toolsRemoved`; main-frame navigation | `change` emitted; the toolset re-adopts |
| Toolset page tools | Registry `change`; `select` (tab switch) | Diffed into `tools` |
| Staged `browser_dialog` | Page `dialog` event; dialog handled | Added, then removed |
| Element and text waits | Mutation reports through the binding (P3); `signal`; `timeout` | Re-check per report |
| Navigation `idle` | `Page.lifecycleEvent` `networkIdle` (P6) | Resolves |
| Launch readiness (server) | The child's stderr line `DevTools listening on ws://...`; child `exit` | Resolves with the endpoint, or rejects |

### Lifecycle and ownership

The fixed vocabulary applies as follows.

- `Browser` keeps its surface: `discover`, `connect`, `adopt`, `disconnect`, `destroy`, `close`, `owned`, `pid`, process groups, and the endpoint-then-discover-then-launch order (`guides/browser.md:1892-1912`).
  - Launch readiness changes from polling `/json/version` (`src/server/helpers.ts:358-395`) to reading the child's stderr endpoint line. Launching with `--remote-debugging-port=0` removes the port-reservation race too.
  - `waitForCDPReady` is deleted.
  - `discover()` stays a single probe.
- `BrowserContext` stays the tab owner. `page(index)` and `pages()` already meet the manager accessor law (`src/core/types.ts:2114-2117`), so I add no `browser.tabs`.
- `BrowserPage.destroy` detaches and `close` closes the target, as today.
- `BrowserRegistry` has `start`, where a later call restarts, and `destroy`.
- `BrowserToolset` has `start`, which is idempotent and starts the registry and the dialog and popup listeners, and `destroy`, which releases subscriptions, removes the tools it added from a consumer-supplied manager, and destroys a manager it created.
- `BrowserDOMView` has `destroy`, which disconnects the observer.
- `BrowserDownload.cancel` becomes `abort`, and `BrowserFileChooser.cancel` becomes `dismiss`, matching `BrowserDialog` (`src/core/types.ts:979-988`, `:1037`).

### What goes

The following table rules on every current entity.

| Entity | Ruling | Reason |
| --- | --- | --- |
| `CDPClient` | Change | Adds `signal` to `CDPSendOptions`; an abort rejects the pending request and drops its correlation entry |
| `WebSocketCDPTransport` | Keep | Server transport; no change |
| `BrowserTransition` | Keep | Shared in-flight transition |
| `Browser` | Change | Stderr readiness instead of the readiness poll; the process-drain poll is ruled in `Tensions` T10 |
| `BrowserContext` | Keep | Tab ownership and context managers |
| `BrowserPage` | Change | Gains `elements`, `registry`, input devices, `wait(text)`, and `trusted`; loses `codegen`; takes `BrowserCallOptions` |
| `BrowserFrame` | Change | Gains `read`; loses selectors, input devices, `content`, `article`, `click`, `fill`, `select`, and `wait` |
| `BrowserNavigationManager` | Change | Keeps `wait(pattern)`; gains `idle`; `until` deleted |
| `BrowserHandle` | Keep | Retained remote objects are a consumer mechanism |
| `BrowserWorker` | Keep | Worker evaluation |
| `BrowserDialog` | Keep | Backs `browser_dialog` |
| `BrowserFileChooser` | Change | `cancel` becomes `dismiss` |
| `BrowserDownload` | Change | `cancel` becomes `abort` |
| `BrowserCookieManager`, `BrowserPermissionManager`, `BrowserStorageManager`, `BrowserEmulationManager` | Keep | Context mechanisms a consumer needs; no polling |
| `BrowserLocator`, `BrowserSelectorManager` | Delete | An in-page compiled locator engine with 100 ms polling can't exist under "No polling architecture", and it duplicates the native `Accessibility` and `DOM` query domains |
| `BrowserKeyboard`, `BrowserMouse`, `BrowserTouch` | Change | Move from frame to page |
| `BrowserAccessibility` | Keep | The raw tree is a mechanism; the outline is built on it |
| `BrowserSnapshot` and `page.snapshot()` | Keep | `DOMSnapshot` layout, paint, and computed-style capture is a distinct capability that neither the outline nor the reading provides; invariant 14 stands (`guides/browser.md:2054-2065`) |
| `BrowserScriptManager` | Keep | Backs the mutation binding |
| `BrowserCodegen` | Delete | Its output is replay scripts in the selector vocabulary this design deletes, and its in-page recorder infers CSS selectors, a second locating engine. A reference recorder can't replay across sessions, so that would be a different capability with no consumer (see `Tensions` T8) |
| `BrowserNetworkManager` | Keep | The ollama consumer calls `network.start()` |
| `BrowserRoute` | Keep | Request interception mechanism |
| `BrowserHARManager` | Keep | HAR 1.2 recording and replay compose network events; no polling |
| `BrowserWebSocket` | Keep | Socket observation |
| `BrowserDiagnostics`, `BrowserTracing`, `BrowserCoverage`, `BrowserPerformance`, `BrowserProfiler` | Keep | Each composes enable, read, disable, and decode; each passes the wrapper test |
| `BrowserClock` | Keep | Virtual time; its only timer is a bound on an event wait |
| PDF, screenshot | Keep | Screenshot `mask` takes elements |
| `FileBrowserWriter` | Keep | Server writer |
| `BrowserSelectorError` | Delete | Replaced by `BrowserElementError` with codes `GONE`, `HIDDEN`, `OCCLUDED`, `DISABLED`, and `AMBIGUOUS` |
| `compileFunctionWaitExpression`, the locator, wait, and actionability compilers, `compileClickExpression`, `compileFillExpression`, `compileSelectExpression`, `compileCodegenScript` | Delete | Polling, or their only callers are deleted; the distillate found the last three uncalled |
| `BROWSER_WAIT_POLL_INTERVAL_MS`, `BROWSER_TEST_ID_ATTRIBUTE`, `BROWSER_STABLE_FRAME_COUNT`, `BROWSER_VISIBILITY_SOURCE`, `BROWSER_CODEGEN_BINDING_NAME`, `BROWSER_CODEGEN_SOURCE` | Delete | Their consumers are deleted |
| `waitForCDPReady` | Delete | Replaced by stderr readiness inside launch |

### Tests and proofs

Each proof layer runs in the project listed.

- **`src:core`, against the in-memory CDP transport** (`tests/setup.ts:84-154`):
  - Reference minting and no reuse.
  - Outline filtering and rendering against a scripted `Accessibility.getFullAXTree` reply.
  - `GONE`, `OCCLUDED`, `HIDDEN`, and `DISABLED` from scripted errors and replies.
  - Find through scripted `queryAXTree` and `querySelectorAll`.
  - Wait resolution from scripted `Runtime.bindingCalled` events.
  - Reading slices, offsets, totals, and staleness from scripted `Page.frameNavigated`.
  - The registry: scripted `WebMCP.toolsAdded`, `toolsRemoved`, and `toolResponded`; `cancelInvocation` on abort; `start()` false on a scripted unknown-method error.
  - Toolset adoption, skip, staging, and receipts.
  - `CDPClient` abort.
- **`src:server`, against `CDPTestServer`** (`tests/setupServer.ts:262`): a protocol-faithful fixture that speaks `WebMCP.enable`, `invokeTool`, `cancelInvocation`, and the four events over a real WebSocket, plus stderr readiness against `createFakeBrowserProcess` printing the endpoint line.
- **`service`, against the host Chromium:**
  - Outline, then click by reference, then text wait.
  - `browser_type` with `submit`.
  - Navigation clears references.
  - `idle` resolves.
  - An abort signal ends a wait.
  - A bounded Markdown read of the bloated fixture.
  - `registry.start()` equals `Schema.getDomains` containing `WebMCP`, which asserts the relationship rather than the host fact.
  - The live `WebMCP` proof is recorded as a limit naming a Chrome 150 host with `--enable-features=WebMCP`.
- **`src:browser`:** a served fixture page loads the built `dist/src/browser` entry and is driven by this package's own server face in the `service` project, so no Playwright binary is added. The workspace rule names Playwright Chromium for `src:browser` (see `Tensions` T6).
- **End-to-end MCP:** the proof lives in `@orkestrel/mcp`, the higher package, with `@orkestrel/browser` as a development dependency on the owner's authorization (see `Tensions` T7). This package adds no mcp edge.

### Dependencies and names

Each edge is ruled as follows.

- `@orkestrel/tool`: runtime, needed for `ToolInterface`, `createTool`, and `createToolManager`. The package stays at L3 because tool is L2. The owner's explicit authorization is still required (see `Tensions` T1b).
- `@orkestrel/markdown`: runtime, authorized by the standing proposal. It already pins `@orkestrel/html` `^0.0.11`, as this package does (`../markdown/package.json:75-76`).
- `@orkestrel/mcp`: none at runtime and none for development here.
- `@orkestrel/websocket`: unchanged, server only.
- No other package and no browser binary.

Every added bare name is prefixed `Browser` or qualified by its role, so none collides with a fleet owner:

- `Tool*` is owned by `@orkestrel/tool`. This package declares `BrowserTool`, `BrowserToolAnnotation`, `BrowserToolset*`, and `BrowserToolSource*`, and no bare `Tool*` name.
- `ModelContext*` and `WebMCP*` are owned by `@orkestrel/mcp`. This package declares `BrowserRegistry*` and `BrowserInvocation*`, and no `WebMCP*` or `ModelContext*` name.
- `Markdown*` and `HTML*` are owned by those packages. This package declares `BrowserRead*` and `BrowserReading*`, and uses `HTMLInterface` by import only.
- The browser environment's names are `BrowserDOMView`, `BrowserDOMElement`, `BrowserDOMElementManager`, `createBrowserDOMView`, and `createDocumentToolset`.

### Blast radius and sequencing

`@orkestrel/browser` bumps from `0.0.18` to `0.0.19`, and its `package.json` gains the `./browser` export. `@orkestrel/ollama` re-pins its development dependency to `^0.0.19`. Of the calls Verified 18 lists, one breaks: `page.evaluate(expression, timeout)` becomes `page.evaluate(expression, { timeout })`. `createBrowser`, `connect`, `create`, `network.start`, `navigate(url, { timeout })`, `destroy`, and `findSystemBrowser` with its types are unchanged. The units that follow run in dependency order.

**Exit criterion.** Every unit's acceptance criteria hold, and the browser package's gates are green: `format:check`, `lint:check`, `check`, `build`, `npm test`, `test:distribution -- --mode release`, and `test:service` on the host Chromium. The ollama `test:service` page proof is green against the `0.0.19` build. The real-model probe meets the Small-model criteria. The guide's Contract lists the `WebMCP` live proof as a limit naming its host.

### Small-model fit

The design serves a 2-billion-parameter model in these ways.

- **Advertised set.** 7 tools in the CDP placement and 5 in the DOM placement. Staged additions:
  - Page WebMCP tools appear beside the generic set rather than replacing any of it.
  - `browser_dialog` appears only while a dialog is open.
  - The tabs pair appears only on request.
- **Result shapes.**
  - Receipts are one line, with at most one follow-up sentence that names the next tool.
  - The outline is at most `BROWSER_OUTLINE_LIMIT` (150) elements and 4 000 characters, with names trimmed and whitespace collapsed (P8's `"Email "` becomes `"Email"`).
  - A read is at most 4 000 characters, with an explicit continuation call in its footer.
  - Every failure message names the tool to call next.
- **Reference spelling.** `[ref=e12]` in, `e12` out, and the tolerant parser accepts the common misspellings.
- **What the probe must show.** The Orchestrator's probe drives `qwen3.5:2b-q4_K_M` (`/home/user/orkestrel/ollama/tests/setupService.ts:11-14`) through `@orkestrel/agent` against the CDP toolset on three fixture tasks:
  1. Fill a city field with `kyoto` and press Save, then confirm the text `Saved kyoto` appears.
  2. Read one fact from the bloated fixture.
  3. Follow a link and report the next page's heading.

  The design counts as tuned when:
  - each task completes within 8 tool calls;
  - no call carries a reference the outline didn't list;
  - no result exceeds 4 000 characters;
  - two of the three tasks pass on the first attempt at temperature 0, and all three pass within 3 attempts.

  The probe also runs an A/B comparison of `browser_navigate`'s one-line receipt against a receipt carrying the first 40 outline lines, and records calls per task for both (see `Tensions` T3).

## Alternatives

I name at most two real alternatives per major decision, and say why the design wins.

1. **Tool home.**
   - *(a) Tools in `@orkestrel/toolbox`* (L6): it pulls `agent`, `database`, and `server` into every in-page consumer, and it can't run in the DOM placement.
   - *(b) Tools in `@orkestrel/mcp`:* it would need a `browser` runtime edge and would tie tools to one delivery protocol.
   - *The design wins* because the engine sits beside the mechanisms it drives, at L3, and any registry host consumes it.
2. **Locating.**
   - *(a) Keep `BrowserLocator` with `MutationObserver` waits instead of polling:* two locating vocabularies would remain, and actionability would stay in-page JavaScript.
   - *(b) Use `backendNodeId` directly as the reference:* no table, but numbers are long, collide across out-of-process frames, and are reused after navigation.
   - *The design wins* on short, never-reused references and native queries.
3. **Reading.**
   - *(a) The PROPOSAL's frame methods `tree()` and `markdown()`:* re-parsing per call breaks offset continuation, and `tree()` forwards one-to-one to `createHTML`.
   - *(b) A `page.reading` manager with `capture()` and `clear()`:* it manages a release that holds no remote resource.
   - *The design wins* with a value whose staleness is derived, and a retention the caller owns.
4. **WebMCP outside.**
   - *(a) The domain plus a `Runtime.evaluate` fallback over `document.modelContext`:* two mechanisms, main-world impersonation, and no frame or declarative data.
   - *(b) The DevTools MCP meta-tools* (`list` and `execute` with stringified input): worse for a small model.
   - *The design wins* with one native path and first-class adopted tools.
5. **`src/browser` content.**
   - *(a) Add a host-`WebSocket` CDP transport:* no consumer, and origin gating.
   - *(b) Add a `chrome.debugger` transport:* no consumer, and its host API is unverified.
   - *The design wins* by shipping only what a consumer composes.
6. **Tool names.**
   - *(a) Bare verbs* (`click`, `read`): these collide in mixed registries.
   - *(b) DevTools MCP spellings* (`take_snapshot`, `navigate_page`): longer names with no prefix to reserve.

## Constraints

Each constraint cites its source, and every path resolves from `/home/user/browser`.

- Core imports neither browser nor server (`../scaffold/AGENTS.md:25`); `src/core` compiles with no DOM and no `WebSocket` among its permitted globals (`../scaffold/.claude/rules/workspace.md:219-221`), and policy fences worker-only globals out of core (`../scaffold/.claude/rules/workspace.md:227`).
- Adding an npm package requires the user's explicit request (`../scaffold/AGENTS.md:36`).
- Mocks and fakes are banned for project-owned behavior (`../scaffold/AGENTS.md:40`; `../scaffold/.claude/rules/tests.md:27-28`).
- An installed primitive is reused, never wrapped to rename it (`../scaffold/AGENTS.md:43`; `../scaffold/.claude/rules/patterns.md:20`).
- Entity members are single words (`../scaffold/AGENTS.md:50`; `../scaffold/.claude/rules/names.md:12-32`).
- State is derived, never stored twice (`../scaffold/AGENTS.md:56`).
- Wrappers must add something real (`../scaffold/AGENTS.md:62`; `../scaffold/.claude/rules/architecture.md:157-163`).
- A symbol is removed only when its capability must not exist (`../scaffold/AGENTS.md:63`).
- No compatibility shims (`../scaffold/AGENTS.md:64`).
- No polling architecture (`../scaffold/AGENTS.md:66`).
- Mirrored protocol fields keep external wording (`../scaffold/.claude/rules/names.md:120`, `:122`).
- Fleet name ownership (`../scaffold/.claude/rules/names.md:126-137`).
- Fixed lifecycle vocabulary with no `cancel` (`../scaffold/.claude/rules/names.md:218-232`).
- Manager accessors (`../scaffold/.claude/rules/patterns.md:43-50`).
- Stateful emitters (`../scaffold/.claude/rules/patterns.md:71-79`).
- Foreign contracts (`../scaffold/.claude/rules/patterns.md:135-141`).
- One class per implementation file (`../scaffold/.claude/rules/architecture.md:46`).
- No dependency re-export (`../scaffold/.claude/rules/architecture.md:161`).
- Entity subfolders (`../scaffold/.claude/rules/architecture.md:215-217`).
- Barrel rules (`../scaffold/.claude/rules/architecture.md:256-276`).
- `src:browser` runs on Playwright Chromium (`../scaffold/.claude/rules/workspace.md:121`).
- The `service` project is gated by `prepublishOnly` (`../scaffold/.claude/rules/workspace.md:144`, `:164-169`).
- Probes are promoted or deleted (`../scaffold/.claude/rules/tests.md:139-140`).
- Live-service rules (`../scaffold/.claude/rules/tests.md:148-157`).
- Host facts are probed at run time (`../scaffold/.claude/rules/tests.md:36`).
- Fixture servers bind `127.0.0.1` (`../scaffold/.claude/rules/tests.md:31`).
- Browser tests use the real DOM (`../scaffold/.claude/rules/tests.md:288`).
- Every export is documented (`../scaffold/.claude/rules/documentation.md:32`); classes expose exactly their interface (`:64`); fences use the published specifier (`:74-77`).
- A foreign-client claim needs one real client end to end (`../scaffold/.claude/rules/quality.md:53`).
- Guide invariants 2, 3, 8, and 14 (`guides/browser.md:1859-1886`, `:1932-1950`, `:2054-2065`).
- The current declared dependencies (`package.json:88-93`) and exports (`package.json:31-53`).
- The mcp registry surface lacks `debugging` (`../mcp/src/browser/types.ts:229-233`, `:357-372`); `createModelContext` detects rather than polyfills (`../mcp/src/browser/factories.ts:422-427`).
- Tool annotations and manager (`../tool/src/core/types.ts:13-20`, `:221-313`).
- The html handle (`../html/src/core/types.ts:409-478`).
- The markdown projection and render (`../markdown/src/core/helpers.ts:2756`, `:1748`).
- `queryAXTree` is experimental (`tmp/units/browser_protocol.json:524-526`); `getNodeForLocation` (`tmp/units/browser_protocol.json:8198`); `getOuterHTML` (`tmp/units/browser_protocol.json:8244`).
- The `WebMCP` domain (`tmp/units/webmcp-cdp-domain.md:9-34`).

## Refusals

Each refused option below is foreclosed by the quoted rule.

- **A runtime or development edge from this package to `@orkestrel/mcp`.** "**NEVER** add an npm package unless the user explicitly requests it; prefer native APIs." (`../scaffold/AGENTS.md:36`)
- **Keeping `navigation.until` or the locator waits on a timer.** "**No polling architecture.** Park idle work on events and abort signals." (`../scaffold/AGENTS.md:66`)
- **Keeping `BrowserLocator` or `content()` as aliases beside the element model and `read()`.** "**No compatibility shims.** Update every consumer in the same change." (`../scaffold/AGENTS.md:64`)
- **Re-exporting `createToolManager` or `renderMarkdown` from this package for convenience.** "Do not re-export a dependency's symbol from this package." (`../scaffold/.claude/rules/architecture.md:161`)
- **A `WebSocket`, `document`, or `MutationObserver` use in `src/core`.** "WHATWG web interop: fetch family, streams, URL, Abort, encoders, crypto, timers, console, DOMException, structuredClone; no DOM, no Node" (`../scaffold/.claude/rules/workspace.md:219`).
- **Declaring `WebMCPTool`, `ModelContextTool`, or a bare `Tool*` name here.** "Give every bare exported name one owning package across the `@orkestrel` fleet." (`../scaffold/.claude/rules/names.md:126`)
- **A `cancel` method on the registry or the toolset.** "Never introduce synonyms such as `cancel`, `reset`, or `run` for these meanings." (`../scaffold/.claude/rules/names.md:232`)
- **Proving the `WebMCP` domain with a stubbed client double, or proving `src/browser` in a simulated DOM.** "Never use mocks, behavioral fakes, module replacement, or framework spies for project-owned or integrated behavior." (`../scaffold/.claude/rules/tests.md:27`) and "Do not replace DOM events, storage, observers, viewports, layout methods, pointer, or drag APIs unless the browser genuinely lacks one." (`../scaffold/.claude/rules/tests.md:288`)
- **Storing `truncated` on `BrowserReadResult` or `BrowserOutline`.** "**Derive state.** Compute facts from existing fields; never store a second flag or label that can drift." (`../scaffold/AGENTS.md:56`)

## Measurements

These readings were supplied:

- Probes P1–P8 on Chromium 141.0.7390.37, 8 passed (`tmp/units/probe-cdp-native-3.log:4-14`). The earlier P8 failure recorded the outline-against-HTML ratio on the tiny page (`tmp/units/probe-cdp-native-2.log:11-17`).
- Service baseline: 14 proofs in 39.26 s (Verified 16).
- The consumer's calls (Verified 18) and the known page-proof bound comment (`/home/user/orkestrel/ollama/tests/service/page.test.ts:17-22`).

These readings are substitutions:

- `tmp/cursor/prior-absorb-answer.md` is absent. I read the sibling sources directly: `../mcp/src/browser/types.ts`, `../mcp/src/browser/factories.ts:370-462`, `../tool/src/core/types.ts`, `../html/src/core/types.ts:330-479`, `../markdown/src/core/types.ts:600-665`, `../markdown/src/core/helpers.ts:1730-1769` and `:2700-2770`, and `../markdown/package.json`. `@orkestrel/test`'s surface was read through `../scaffold/.claude/rules/tests.md:201-274` rather than its source.
- The ollama clone is present and was read (`tests/service/page.test.ts`, `tests/setupService.ts:1-40`).
- `@orkestrel/toolbox` has no local checkout, so its catalog row (`../scaffold/.claude/agents/orkestrel.md:93`) is the only reading.

These readings are missing, each with the reading that would settle it:

1. Whether a shipping Chrome names `document.modelContext` or `navigator.modelContext`: the global read on a Chrome 157 stable host.
2. Whether a shipping Chrome exposes registered tools to an extension, and through which API: the extension API reference at M157, plus a probe with an unpacked extension.
3. The type of `WebMCP.toolResponded.output`: one `invokeTool` round trip on Chrome 150 or later with `--enable-features=WebMCP`, against a tool returning a string and one returning a content record.
4. Whether an in-browser placement includes `chrome.debugger`, and whether a structural transport can name it without `@types/chrome`: a type probe (`prove`) over a structural `{ sendCommand, onEvent, attach, detach }` shape.
5. `Accessibility.queryAXTree` behavior on Chromium 141 (exact against partial name, and ignored nodes): a probe over the P4 page with the control `name: "Sav"`.
6. The stderr line `DevTools listening on ws://` with `--remote-debugging-port=0` on this host: a probe spawning the host Chromium, with the control of a launch without the flag printing none.
7. `DOM.getNodeForLocation` hit-testing an occluded button: a probe with an overlay, where the control is the overlay removed.
8. Whether `Page.frameRequestedNavigation` arrives before mouse-up resolves for a link click on Chromium 141, which the click receipt depends on: a probe recording event order.
9. Outline and Markdown character counts on the bloated fixture under the proposed filters: a probe rerunning P8 with `renderBrowserOutline` and `markdown()`.
10. Structural assignability of `ModelContextInterface` to `BrowserToolSourceInterface`: a `prove` claim in `src:browser`.
11. The real-model probe results: pending with the Orchestrator (`tmp/units/ledger.md:39`).

## Units

Every unit follows `$orkestrel-harden` inside this package, and `$orkestrel-align` governs U14. Astra is dark, so the constraint-heavy units name `opus` as the substitute engine. Acceptance criteria are ordered cheap-first.

### U1 `signal`

- **Role and engine:** `builder`, Sonnet.
- **Owns:**
  - `src/core/types.ts` (`CDPSendOptions.signal`; `BrowserCallOptions` replacing `BrowserSendOptions`; `evaluate`, `handle`, `title`, `send`, and `navigate` option shapes);
  - `src/core/CDPClient.ts`, `src/core/BrowserFrame.ts`, `src/core/BrowserPage.ts`, `src/core/BrowserWorker.ts`, `src/core/BrowserHandle.ts`;
  - their mirrored tests; call sites in `tests/service/browser.test.ts`.
- **Depends on:** none.
- **Acceptance:**
  1. `npm run check:src:core` is green.
  2. `CDPClient.test.ts` proves that an abort before the reply rejects with the signal's reason, removes the pending entry, and ignores a later reply with the same id.
  3. `BrowserFrame.test.ts` proves `evaluate(expression, { signal })` rejects on abort, and `{ timeout }` keeps today's timeout behavior.
  4. `npm run test:src` is green.

### U2 `elements`

- **Role and engine:** `opus` (substituting for `astra`).
- **Owns:**
  - `src/core/types.ts` (the element contracts in Design);
  - `src/core/elements/BrowserElement.ts`, `src/core/elements/BrowserElementManager.ts`;
  - `src/core/helpers.ts` (`renderBrowserOutline`);
  - `src/core/parsers.ts` (`parseBrowserReference`);
  - `src/core/compilers.ts` (`compileMutationReporterSource`);
  - `src/core/constants.ts` (`BROWSER_REFERENCE_PREFIX = 'e'`, `BROWSER_OUTLINE_LIMIT = 150`, `BROWSER_OUTLINE_OMITTED_ROLES` frozen as `none`, `generic`, `StaticText`, `InlineTextBox`, `LineBreak`, `BROWSER_MUTATION_BINDING_NAME`);
  - `src/core/errors.ts` (`BrowserElementError`, `isBrowserElementError`);
  - `src/core/BrowserPage.ts` (the `elements`, `wait(text)`, `trusted`, and `keyboard`, `mouse`, `touch` getters);
  - `src/core/index.ts`; `tests/src/core/elements/*.test.ts`; `tests/setup.ts` (scripted AX and DOM replies).
- **Depends on:** U1.
- **Acceptance:**
  1. `check:src:core` is green.
  2. `parseBrowserReference` returns `e12` for `e12`, `E12`, `12`, `ref=e12`, and `[ref=e12]`, and `undefined` for `x12`, `e`, and `e-1`.
  3. The outline renders the Design format from a scripted tree, trims names, and reports `count` and `total` when `limit` cuts.
  4. References are never reused after `clear()`.
  5. Click emits `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `DOM.getNodeForLocation`, and `Input.dispatchMouseEvent` in order, and a scripted `No node` error yields code `GONE`.
  6. `wait` resolves on a scripted `Runtime.bindingCalled` and on abort, with no timer other than `timeout`.
  7. Main-frame `Page.frameNavigated` empties `elements()`.
  8. `test:src:core` is green.

### U3 `removal`

- **Role and engine:** `builder`, Sonnet.
- **Owns:**
  - deletion of `src/core/BrowserLocator.ts`, `src/core/BrowserSelectorManager.ts`, `src/core/BrowserCodegen.ts`, and their tests;
  - `src/core/compilers.ts` and `src/core/constants.ts` deletions per What goes;
  - `src/core/types.ts` (delete the locator, selector, codegen, action, actionability, and `until` types; `mask` becomes elements; `BrowserDownload.abort`; `BrowserFileChooser.dismiss`);
  - `src/core/BrowserFrame.ts`, `src/core/BrowserNavigationManager.ts`, `src/core/BrowserDownload.ts`, `src/core/BrowserFileChooser.ts`, `src/core/errors.ts`, `src/core/index.ts`;
  - `tests/service/browser.test.ts` (rewrite the locator and codegen cases to elements).
- **Depends on:** U2.
- **Acceptance:**
  1. `check:src:core` and `check:src:server` are green.
  2. `Grep` for `setInterval|BROWSER_WAIT_POLL_INTERVAL_MS|compileFunctionWaitExpression|BrowserLocator|BrowserCodegen|BrowserSelector` under `src/` returns no match.
  3. `test:src` is green.

### U4 `navigation`

- **Role and engine:** `builder`, Sonnet.
- **Owns:** `src/core/types.ts` (`BrowserWaitUntil` gains `'idle'`; the `idle` member), `src/core/BrowserNavigationManager.ts`, `src/core/BrowserPage.ts` (the lifecycle subscription and `Page.setLifecycleEventsEnabled` at attach), and their mirrored tests.
- **Depends on:** U3.
- **Acceptance:**
  1. `check:src:core` is green.
  2. A scripted `Page.lifecycleEvent` `networkIdle` for the current loader resolves `idle()` and `navigate(url, { condition: 'idle' })`.
  3. An event for a stale loader doesn't resolve them.
  4. `test:src:core` is green.

### U5 `reading`

- **Role and engine:** `opus`, Opus 5.5.
- **Owns:**
  - `package.json` (add `@orkestrel/markdown`);
  - `src/core/types.ts` (the reading contracts; delete `BrowserContentResult`);
  - `src/core/BrowserReading.ts`;
  - `src/core/BrowserFrame.ts` (`read`, one guarded capture, navigation epoch);
  - `src/core/BrowserPage.ts` (epoch increments);
  - `src/core/factories.ts` (`createBrowserReading`);
  - `tests/src/core/BrowserReading.test.ts`, `tests/src/core/BrowserFrame.test.ts`.
- **Depends on:** U3.
- **Acceptance:**
  1. `check:src:core` is green.
  2. `markdown()` of a fixture with `nav`, `main`, and `footer` keeps the paragraph and drops nav and footer (the P7 relationship), and `distill: false` keeps them.
  3. Slices over `offset` and `limit` concatenate to the whole text, with `total` constant.
  4. A projection is parsed once across repeated slices, asserted through a recorder on a subclass-free counter seam or by identity of the returned handle.
  5. `stale` flips on a scripted `Page.frameNavigated` for the frame and not for a sibling frame.
  6. An oversized capture rejects with `BrowserResultLimitError`.
  7. `test:src:core` is green.

### U6 `registry`

- **Role and engine:** `opus` (substituting for `astra`).
- **Owns:**
  - `src/core/types.ts` (registry contracts);
  - `src/core/BrowserRegistry.ts`;
  - `src/core/parsers.ts` (`parseBrowserTool`, `parseBrowserInvocation`, `parseBrowserInvocationResult`);
  - `src/core/helpers.ts` (`renderBrowserToolOutput`);
  - `src/core/BrowserPage.ts` (`registry` getter);
  - `tests/src/core/BrowserRegistry.test.ts`;
  - `tests/setupServer.ts` (the `WebMCP` scripting on `CDPTestServer`);
  - `tests/src/server/Browser.test.ts` (the fixture-server case).
- **Depends on:** U1.
- **Acceptance:**
  1. `check:src:core` is green.
  2. `start()` resolves `false` on a scripted unknown-method error and `true` otherwise.
  3. `toolsAdded` then `toolsRemoved` emit `change` twice and update `tools()`.
  4. `execute` resolves on the matching `toolResponded` only.
  5. An abort sends `WebMCP.cancelInvocation` with the invocation id.
  6. `adopt()` maps `readOnly` to `pure` and marks every tool `untrusted`.
  7. `renderBrowserToolOutput` renders a string, a content array, and a record.
  8. `test:src` is green.

### U7 `toolset`

- **Role and engine:** `opus`, Opus 5.5.
- **Owns:**
  - `package.json` (add `@orkestrel/tool`, after authorization);
  - `src/core/types.ts` (toolset contracts, `BrowserViewInterface`, `BrowserToolSourceInterface`);
  - `src/core/BrowserToolset.ts`;
  - `src/core/constants.ts` (`BROWSER_TOOL_LIMIT = 4_000`, `BROWSER_TOOL_PREFIX = 'browser_'`, frozen tool descriptions);
  - `src/core/helpers.ts` (`renderBrowserReceipt`);
  - `src/core/factories.ts` (`createBrowserToolset`);
  - `tests/src/core/BrowserToolset.test.ts`.
- **Depends on:** U2, U4, U5, U6.
- **Acceptance:**
  1. `check:src:core` is green.
  2. The CDP toolset lists exactly `browser_navigate`, `browser_outline`, `browser_read`, `browser_click`, `browser_type`, `browser_press`, and `browser_wait`.
  3. A scripted dialog adds `browser_dialog` and handling removes it.
  4. The `context` option adds `browser_tabs` and `browser_switch`.
  5. A page tool named `browser_click` emits `skip` and isn't added, and a `debugging` tool isn't added.
  6. Every text result is at most `limit` characters.
  7. A second `browser_read` with `offset` reuses the retained reading while it isn't stale.
  8. `ToolContext.signal` abort reaches the CDP call.
  9. `destroy` removes exactly the tools the toolset added from a supplied manager.
  10. `test:src:core` is green.

### U8 `server`

- **Role and engine:** `opus` (substituting for `astra`).
- **Owns:** `src/server/helpers.ts` (delete `waitForCDPReady`; add `readBrowserEndpoint` for the stderr line), `src/server/Browser.ts` (launch readiness from stderr, `--remote-debugging-port=0`, the ruling on `#waitForRemainderWithin`), `src/server/types.ts`, `src/server/index.ts`, `tests/src/server/*.test.ts`, and `tests/setupServer.ts` (`createFakeBrowserProcess` prints the endpoint line).
- **Depends on:** U1; the Measurements row 6 probe first.
- **Acceptance:**
  1. `check:src:server` is green.
  2. A fake process printing the line connects without any `/json/version` request, asserted on the fixture's request recorder.
  3. A fake process exiting before the line rejects with `BrowserConnectionError` naming the exit.
  4. `test:src:server` is green.

### U9 `environment`

- **Role and engine:** `builder`, Sonnet.
- **Owns:** `package.json` (the `./browser` export for ES only; `check:src:browser`; `build:src:browser`), `configs/src/tsconfig.browser.json`, `configs/src/vite.browser.config.ts`, `tsconfig.json` (the `@src/browser` alias), `vite.config.ts`, `src/browser/index.ts`, `src/browser/types.ts`, and `tests/config.test.ts` rows.
- **Depends on:** U7.
- **Acceptance:**
  1. `npm run check` is green, with `lib` `["ESNext","DOM","DOM.Iterable"]` for the scope.
  2. `npm run build` emits `dist/src/browser/index.js` and `index.d.ts`.
  3. `test:config` is green.

### U10 `document`

- **Role and engine:** `opus`, Opus 5.5.
- **Owns:**
  - `src/browser/types.ts`, `src/browser/constants.ts` (implicit role table);
  - `src/browser/helpers.ts` (`computeBrowserRole`, `computeBrowserName`);
  - `src/browser/BrowserDOMView.ts`, `src/browser/elements/BrowserDOMElement.ts`, `src/browser/elements/BrowserDOMElementManager.ts`;
  - `src/browser/factories.ts` (`createBrowserDOMView`, `createDocumentToolset`);
  - `tests/src/browser/**`;
  - `tests/service/document.test.ts` with its served fixture in `tests/setupServer.ts`.
- **Depends on:** U9.
- **Acceptance:**
  1. `check:src:browser` is green.
  2. The served-page proof outlines the P4 fixture with `button "Save"` and `textbox "Email"`, clicks by reference, and reads `document.body.dataset.clicked` as `yes`.
  3. `browser_type` with `submit` fires one `submit` event.
  4. The DOM toolset lists exactly `browser_outline`, `browser_read`, `browser_click`, `browser_type`, and `browser_wait`.
  5. A removed element yields `GONE`.
  6. `wait` resolves on a late insertion with no timer.
  7. `test:service` is green.

### U11 `proofs`

- **Role and engine:** `builder`, Sonnet.
- **Owns:** `tests/service/browser.test.ts` (the element, reading, idle, abort, and registry-detection cases per Tests and proofs) and `tests/setupService.ts`.
- **Depends on:** U7, U8.
- **Acceptance:**
  1. `test:service` is green on the host Chromium.
  2. The registry case asserts `start()` equals `domains.includes('WebMCP')` read from `Schema.getDomains`.
  3. The live `WebMCP` limit is recorded in the guide's Contract.

### U12 `guide`

- **Role and engine:** `opus`, Opus 5.5.
- **Owns:** `guides/browser.md` (Surface for three environments, Methods tables for every behavioral interface, Contract rewritten, Patterns for "Drive a page with a small model" and "Host the toolset over MCP") and `README.md`.
- **Depends on:** U10, U11.
- **Acceptance:**
  1. `npm run test:guides` is green.
  2. Every fence imports `@orkestrel/browser`, `@orkestrel/browser/browser`, or `@orkestrel/browser/server`.
  3. Invariants 2 and 8 name `read()` and the single capture.

### U13 `gates`

- **Role and engine:** `verifier`, Sonnet.
- **Owns:** nothing.
- **Depends on:** U12.
- **Acceptance:** `format:check`, `lint:check`, `check`, `build`, `npm test`, `test:distribution -- --mode release`, and `test:service` all green, each read bare, with the discovery script from `orkestrel-harden` run and every marker ruled on.

### U14 `consumer`

- **Role and engine:** `builder`, Sonnet, in `/home/user/orkestrel/ollama` under `$orkestrel-align`.
- **Owns:** `package.json` (`@orkestrel/browser` `^0.0.19`), `tests/setupServer.ts`, and `tests/setupService.ts` call sites.
- **Depends on:** U13 and the published or packed `0.0.19`.
- **Acceptance:**
  1. `npm run check` is green.
  2. Every `evaluate(expression, timeout)` becomes `evaluate(expression, { timeout })`.
  3. The ollama `test:service` page proof is green.

### U15 `model`

- **Role and engine:** Orchestrator, native.
- **Owns:** `tmp/probes/` only.
- **Depends on:** U7, U11.
- **Acceptance:** the Small-model criteria in Design are met and recorded with the run, and the A/B result on the navigate receipt is recorded.

### U16 `review`

- **Role and engine:** `reviewer`, Opus 5.5, one pass over the integrated graph per `$orkestrel-align` step 11.
- **Owns:** nothing.
- **Depends on:** U14, U15.
- **Acceptance:** every required finding resolved and the affected gates rerun green.

## Tensions

These judgment calls are for the other lane or the Orchestrator to rule.

- **T1: tool naming.** Rule: `browser_` plus one verb. The alternative is bare verbs. T1b: the `@orkestrel/tool` runtime edge needs the owner's explicit authorization (`../scaffold/AGENTS.md:36`), and only the markdown edge is authorized in writing.
- **T2: reference tolerance.** `parseBrowserReference` accepts five spellings. A strict parser would teach the model the exact format at the cost of failed calls.
- **T3: `browser_navigate` result.** A one-line receipt, or a receipt with the first 40 outline lines. The real-model A/B settles it.
- **T4: annotations.** `browser_click` and `browser_type` aren't marked `consequential`, which would make every click need confirmation. Page tools carry their own hint.
- **T5: WebMCP path.** The `Runtime.evaluate` path is refused. That leaves Chrome 146–149 registries unreachable from outside.
- **T6: `src/browser` proof host.** Own server face in `service` (the owner's no-binary preference) against Playwright Chromium in `src:browser` (`../scaffold/.claude/rules/workspace.md:121`, which needs a `playwright` development dependency).
- **T7: end-to-end MCP proof home.** `@orkestrel/mcp` with a browser development dependency, which needs authorization, or no MCP end-to-end proof in this campaign.
- **T8: codegen.** Deleted. A role-and-name recorder is the "change" alternative.
- **T9: `BrowserSnapshot`.** Kept as the layout capture.
- **T10: process-group drain poll.** `src/server/Browser.ts:1059-1076` has no event source for group members. Two rulings are open: wait on the direct child's `exit` after the group `SIGKILL` and drop the drain, or keep one bounded check after the kill with no loop.
- **T11: popup following.** The toolset follows a popup opened by the agent's own click automatically.
- **T12: actionability.** The two-frame stable check is dropped, and the hit test replaces it.
- **T13: staged tool list.** The tool list changes while a dialog is open; the alternative is a static `browser_dialog`.
- **T14: vocabulary identity.** The DOM set omits `press` and `navigate`, so "one vocabulary" means the same names and results where present.
- **T15: structural source.** `BrowserToolSourceInterface` relies on structural assignability from `ModelContextInterface` (Measurements row 10).
- **T16: text projection.** `text()` comes from the HTML AST, not `innerText`, so CSS-hidden text is kept unless `hidden` or `aria-hidden` marks it.
- **T17: default bounds.** 4 000 characters and 150 elements. The probe can move them.
- **T18: renames.** `BrowserDownload.cancel` becomes `abort`, and `BrowserFileChooser.cancel` becomes `dismiss`.
- **T19: in-browser CDP transport.** Refused for lack of a consumer. `chrome.debugger` is deferred until Measurements row 4 is read.
- **T20: select values.** Setting a `select` value is programmatic in the CDP placement as well.

## Risks

- `Accessibility.queryAXTree` and the `WebMCP` domain are experimental, and a Chrome release can change either.
- `WebMCP.toolResponded.output` is untyped (`any`), so a page returning an unexpected shape renders as bounded JSON a model might misread.
- DOM-native role and name computation diverges from Chromium's accessibility computation, so one page can outline differently in the two placements.
- A 2-billion-parameter model can still invent a reference. The `GONE` message and the parser bound the damage but don't remove it.
- html's parser isn't an HTML5 DOM constructor, distill heuristics can drop wanted content, and Markdown loses tables and forms.
- Out-of-process frame references need session routing for `DOM.*` calls, while `Input` coordinates stay page-level. A wrong session yields `GONE` for a live element.
- The main-world mutation binding is callable by page scripts, which can trigger extra re-queries. That costs work only, because every report re-runs a native query.
- Click-induced navigation detection depends on event order not yet measured (Measurements row 8).
- Removing the locator stack breaks programmatic consumers outside the known one. Only `@orkestrel/ollama` is re-pinned.
