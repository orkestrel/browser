# Proposal: `@orkestrel/browser` as the agent's browser

Proposed 2026-09-29. It replaces the reading-arm proposal that stood in this file, and it is deleted after the work lands or the proposal is refused, with the ruling in the commit that removes it. Every claim cites a rule, a source line, or a reading taken on this host on 2026-09-29; the readings are tabled under "Evidence" and recorded in `.orkestrel/browser/ledger.md`.

## Summary

`@orkestrel/browser` 0.0.19 keeps the DevTools Protocol client, the `Browser` lifecycle, and the context, page, and frame entities, and it replaces the locator stack with an accessibility-first agent surface that one engine, `BrowserToolset`, publishes as `@orkestrel/tool` tools. The same vocabulary runs in three placements: a Node process driving Chromium over CDP, a page driving a document with native DOM APIs, and a worker or extension page driving a browser over a WebSocket. Page-registered WebMCP tools join that vocabulary as first-class tools, mirrored from outside the browser through the experimental `WebMCP` protocol domain and from inside through `@orkestrel/mcp`'s bridge. Every wait parks on a protocol event, a DOM observer, or an abort signal, and the package's pollers go, with one bounded process-group drain named as the exception.

The design is proven at four depths: 20 runtime probes on the host Chromium 141 (P1 through P20), 1 type probe, 4 runs of a real model (`qwen3.5:2b-q4_K_M` through `@orkestrel/agent`, whose fourth run passed 3 of 3 tasks on the first attempt at temperature 0), and one falsify round in which two blind audit lanes (Opus 5.5 and GPT-6 Astra) attacked 20 numbered claims; every finding they substantiated is ruled in this text.

## Goals

The owner's goals map to the design as follows.

- **Drive through CDP, with no pulled-in binaries.** The server face launches or attaches to the host's browser; no dependency downloads a browser. The one development-only exception is ruled under "Decisions", D2.
- **Environment agnosticism.** `src/core` compiles against `ESNext` and `WebWorker` with no DOM and no Node; `src/browser` adds the DOM face; `src/server` adds Node. Every entity that can live in core does.
- **Native browser control from inside the browser.** `src/browser` drives a document with `HTMLElement.click()`, native value setters, `form.requestSubmit()`, and `MutationObserver`, and reports what an untrusted event cannot do rather than faking it.
- **Replace WebMCP, stay aligned with it, and adapt to it.** The fleet's own surfaces are primary: an agent drives any page through this package's vocabulary with no cooperation from the page, and a page that offers tools does so through `@orkestrel/tool` values published over `@orkestrel/mcp`'s page and scope servers. WebMCP is one more door onto the same idea, and it is expected to ship in browsers, so the package adapts to it in both directions and proves its alignment with a dated conformance suite (see "Relation to WebMCP"). The agent calls native browser tools, page tools, and outside tools through one registry.
- **Tuned for a small model.** The vocabulary is the one that passed with a 2-billion-parameter model, and the run-derived rules are contract.
- **Clean breaks.** No alias, wrapper, or deprecation shim survives; every consumer is updated in the same change.

## Decisions the owner ratified

Three rows needed the owner's word because a rule forbids the executor from deciding them (`../scaffold/AGENTS.md:36`). The owner authorized all three on 2026-09-29 ("let's go with your recommendations for the decisions that were left"), so each is settled and the units depend on it.

- **D1. `@orkestrel/tool` at runtime.** The vocabulary ships as `ToolInterface` values and the toolset fills a `ToolManagerInterface`; without the edge the package would declare a second tool shape, which the reuse rule forbids (`../scaffold/AGENTS.md:43`). `tool` is L2 and `browser` stays L3. Authorized.
- **D2. `playwright` and `@vitest/browser-playwright` as development dependencies.** Creating `src/browser` forces the `src:browser` project with `tests/setupBrowser.ts` (`tests/config.test.ts:153-158`), whose provider is Playwright's Chromium. `@orkestrel/mcp` already carries both (`../mcp/package.json:117,120`), the provider resolves the host's `/opt/pw-browsers` store, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` keeps the postinstall from fetching. Nothing ships in `dependencies`. Authorized.
- **D3. `@orkestrel/mcp` as a development dependency, for one type test.** The claim that mcp's `ModelContextInterface` satisfies `BrowserToolSourceInterface` structurally is proven by a type probe that cannot be promoted without importing mcp's types (`../scaffold/.claude/rules/tests.md:138-140`). The edge is development-only, creates no runtime cycle, and pins the guide's claim. Authorized; it also carries the conformance cases that compose mcp's bridge with this package's DOM toolset.

`@orkestrel/markdown` at runtime is authorized by the standing proposal and stays. No runtime edge to `@orkestrel/mcp` is added in either direction.

## Design

### Environment map

The following table gives each face's ownership and import edges after the redesign.

| Face                                                | Owns                                                                                                                                                                                                                                                                                                                                                                                | Imports                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/core` (`ESNext`, `WebWorker`; no DOM, no Node) | `CDPClient`, `CDPTransportInterface`; `Browser*` context, page, frame, and manager entities; `src/core/elements/` (`BrowserElement`, `BrowserElementManager`); `BrowserReading`; `BrowserRegistry`; `BrowserToolset`; `BrowserCodegen` retargeted; every host-independent error, `BrowserConnectionError` included; compiled in-page expressions; tool copy and bounds as constants | `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/markdown`, `@orkestrel/tool` |
| `src/browser` (`ESNext`, `DOM`, `DOM.Iterable`)     | `BrowserDOMView`, `src/browser/elements/` (`BrowserDOMElement`, `BrowserDOMElementManager`), role and accessible-name helpers, `src/browser/transports/SocketCDPTransport`, `createDocumentToolset`, `createSocketCDPTransport`                                                                                                                                                     | `@src/core`, `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/tool`                              |
| `src/server` (`ESNext`, Node)                       | `Browser`; `WebSocketCDPTransport`; `FileBrowserWriter`; system-browser discovery; the stderr endpoint read; the process-group drain                                                                                                                                                                                                                                                | `@src/core`, `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/websocket`, `node:*`               |

`src/browser` and `src/server` never import each other (`../scaffold/AGENTS.md:25`). `BrowserConnectionError` moves from `src/server/errors.ts:10` to `src/core/errors.ts`, because the browser-face transport throws it; nothing re-exports it from the server barrel. Guide invariant 2 (`guides/browser.md:1859`) gains `markdown` and `tool` in its import list.

### Placements and reach

The following list names each placement, the view it drives, and how it reaches tools outside itself.

- **Node process over CDP.** `createBrowserToolset(page, options?)` fills a `ToolManagerInterface` (the consumer's own through `options.tools`, or one the toolset creates). The consumer hands the manager to `@orkestrel/agent` or hosts it with `@orkestrel/mcp/server`. Trusted input, popups, dialogs, tabs, and the `WebMCP` domain are all available.
- **Page driving a document.** `createDocumentToolset(options)` from `@orkestrel/browser/browser` drives `options.document`, which is required. The supported topology is a realm that survives the driven document's navigation: a page driving a same-origin child document (an `iframe` it owns, or a window it opened), or an extension page driving a document through a content script it can re-create. A toolset that drives its own realm's document cannot return from an action that navigates it (`HTMLElement.click()` on an ordinary link, `form.requestSubmit()` on an ordinary form); the guide states that limit, and the factory refuses `globalThis.document` unless `options.own` is `true`. Page tools arrive through `options.source`, a `BrowserToolSourceInterface` that `@orkestrel/mcp`'s `ModelContextInterface` satisfies structurally (type probe, exit 0). Outside tools arrive through the consumer's MCP client from `@orkestrel/mcp/browser`. Built-in browser agents receive the toolset's `native` tools through the same bridge's `publish`; publishing the whole manager would re-register the page's own adopted tools as proxies of themselves (`../mcp/src/browser/ModelContext.ts:206-209`, `../mcp/src/browser/types.ts:466-470`), so the guide names `native` as what a consumer publishes.
- **Dedicated or service worker, and extension pages.** A worker has no `document`, so it drives a browser over CDP: `createCDPClient({ transport: createSocketCDPTransport({ url }) })` with the native `WebSocket`, then `createBrowserToolset(page)`. The driven Chromium must be started with `--remote-allow-origins` naming the caller's origin. `chrome.debugger` as a transport is deferred until its `sessionId` routing is read (see "Limits").
- **Content script.** It runs in an isolated world, and P5 shows an isolated world cannot see `document.modelContext`, so it cannot adopt the page's WebMCP tools. That is a recorded limit.

### Relation to WebMCP

The owner's stance on 2026-09-29: the fleet's packages replace WebMCP rather than wrap it, keep up with it because browsers are expected to adopt it, and carry conformance tests and adapters for it, as `@orkestrel/mcp` does for the Model Context Protocol. The design applies that stance in three parts.

- **Replace.** The primary surfaces are the fleet's own: `@orkestrel/tool` is the tool model, `@orkestrel/mcp`'s `createPageServer` and `createScopeServer` are how a page publishes tools to an agent over a message port, and this package's toolset is how an agent drives any page, whether or not the page registers anything. No exported entity in this package is named after WebMCP, and no member of the agent vocabulary depends on a WebMCP registry being present: `look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, and `dialog` run against Chromium 141, which ships no registry (P1, P15).
- **Adapt.** Two adapters carry WebMCP tools into that model, one per side of the browser boundary, and a third reads the declarative form. As in mcp, an adapter is named in prose and carries no `Adapter` or `Bridge` suffix in an identifier.
- **Stay aligned.** `tests/conformance.test.ts`, the fixed home for where a package drifts from the official tooling it tracks (`../scaffold/.claude/rules/tests.md:56`), becomes this package's `conformance` project in `npm test`, following the mcp precedent of a digest-pinned, revision-named mirror compared coordinate by coordinate (`../mcp/tests/setupConformance.ts:165-174`, `../mcp/tests/mirrors/ext-tasks-2026-07-28-schema.json:1-4`). Three mirrors are vendored as fetched bytes under `tests/mirrors/`, exempt from the prose rules (`../scaffold/.claude/rules/writing.md:30`) and outside the formatter: the specification source `index.bs` whole, webref's extracted `interfaces/webmcp.idl` whole (the IDL that web-platform-tests' `idlharness` reads), and the `WebMCP` domain of `browser_protocol.json` cut by raw byte range from the fetched file with the offsets recorded beside its digest, because the whole file is 1.4 MB and a re-serialized slice would be a translation (`../scaffold/.claude/rules/documentation.md:41`). Each mirror's name carries the upstream commit, and each is pinned by its raw-byte SHA-256 in a constant that the setup module's top-level reader checks, so a changed byte throws before a row runs. The rows are listed under U17. The refresh ritual is fixed: on each version bump of this package, and whenever mcp's bridge advances its reading date, fetch the three raw files at their `main` and `master` heads (`raw.githubusercontent.com/webmachinelearning/webmcp`, `raw.githubusercontent.com/web-platform-tests/wpt`, `raw.githubusercontent.com/ChromeDevTools/devtools-protocol`), record each commit, re-cut the domain by byte range, re-pin the digests, and re-rule every row that reddens as implement, retain, or exclude. A drift is ruled, never patched around. The guide's "Declared conformance gaps" section records the three revisions and digests and names each exclusion with its closer, in the shape of mcp's gaps entries (`../mcp/guides/mcp.md:4932`), while its rulings follow mcp's "WebMCP parity" table, whose rows end implement, retain, or exclude with a source (`../mcp/guides/mcp.md:4901`).

The following table names each adapter, its owner, and its proof.

| Adapter                                           | Owner and entity                                                                                               | What it translates                                                                                                                                                                                                                                                                                | Proof                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outside the browser: the `WebMCP` protocol domain | This package, `BrowserRegistry` at `page.registry`                                                             | The domain's `Tool`, `Annotation`, `RemovedTool`, `InvocationStatus`, the four commands, and the four events into `BrowserTool`, `BrowserInvocation`, `BrowserInvocationResult`, and adopted `ToolInterface` values; `readOnly` to `pure`, `consequential` to `consequential`, `untrusted` always | U6 against the in-memory transport and `CDPTestServer`; U17 rows against the vendored domain; the live case a limit until a host ships the domain    |
| Inside the browser: `document.modelContext`       | `@orkestrel/mcp`, `createModelContext` (publish and adopt), consumed here through `BrowserToolSourceInterface` | `ToolInterface` values into `registerTool` descriptors and `RegisteredTool` records back into `ToolInterface` values; `readOnlyHint`, `untrustedContentHint`, and `consequentialHint` each way                                                                                                    | mcp's own suite against its IDL-faithful double; U17 composes the real bridge with this package's DOM toolset against this package's double under D3 |
| The declarative form                              | This package, the element managers                                                                             | A registered tool's `backendNodeId` (CDP) or a form's `toolname` attribute (DOM) into the outline mark `[tool=NAME]`, so the model sees which form a page tool submits                                                                                                                            | U17 rows 4 and 6                                                                                                                                     |

Three readings bound the alignment on 2026-09-29. The specification names its test suite, `https://wpt.fyi/results/webmcp` (line 20 of the fetched `index.bs` source), and web-platform-tests carries `webmcp/` with an `idlharness.https.window.js` that tests `['webmcp']` against webref's `interfaces/webmcp.idl` beside `imperative/` and `declarative/` cases; those cases drive a browser's `document.modelContext`, and running them against this package's IDL-faithful double is a declared gap whose closer is a testharness runner under the Playwright provider. Second, webref's IDL lags the source: it declares `ontoolchange` alone and three hints, while `index.bs` of the same date declares `ontoolactivated`, `ontoolcancel`, `ToolActivatedEvent`, `ToolCancelEvent`, and a `debugging` annotation (lines 622, 623, and 1118 of the fetched `index.bs` source); `index.bs` is the pinned authority for members and webref's file is the mirror the idlharness reads. Third, mcp 0.0.33's bridge, which transliterates the draft as read on 2026-09-15, matches webref's member list and names none of the later members (`../mcp/src/browser/types.ts:218-233`, `../mcp/src/browser/constants.ts:22`); refreshing the bridge is mcp's unit, and the rows here that need those members are declared gaps until it lands.

### Page surface after the redesign

The frame and page contracts change as follows; everything not named keeps its shape.

- `BrowserFrameInterface` keeps `id`, `parent`, `name`, `url`, `title`, `evaluate`, `handle`, `send`, `subscribe`, `unsubscribe`, `save`, `assert`, and `update`, and gains `read`. It loses `selectors`, `keyboard`, `mouse`, `touch`, `content`, `article`, `click`, `fill`, `select`, and `wait` (`src/core/types.ts:1776-1807`).
- `BrowserPageInterface` gains `elements`, `registry`, `keyboard`, `mouse`, `touch` (one tab has one input stream, and Chromium routes page coordinates into out-of-process frames), `trusted` (the constant `true`), and `wait(text, options)`. `frames()` returns the union of the frame tree and the attached out-of-process frame targets, because `Page.getFrameTree` on the page session lists no child frame for an out-of-process iframe (P19: the iframe is its own `iframe` target and `frames()` returns 1 frame today). `codegen` stays, retargeted (see "What goes").
- Every asynchronous page, frame, element, and registry member takes a trailing `BrowserCallOptions` carrying `timeout` and `signal`. That replaces the positional `timeout` on `evaluate` (`src/core/types.ts:1801`) and the timeout-only `BrowserSendOptions`, and it gives a tool handler's `ToolContext.signal` (`../tool/src/core/types.ts:5-10`) a path to the CDP command it issued. `CDPSendOptions` gains `signal`.
- `BrowserPageEventMap.navigate` becomes `readonly [url: string, same: boolean]`, emitted for `Page.frameNavigated` (`same` false) and `Page.navigatedWithinDocument` (`same` true; P16). The page gains a `session` event carrying the frame whose out-of-process session attached.

The added core contracts are shown in the following fence. Members are one word except where a name transliterates a protocol type (`../scaffold/.claude/rules/names.md:120`); collections are readonly; absence is `undefined`.

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
	readonly reference: string
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
	wait(
		query: BrowserElementQuery,
		options?: BrowserElementWaitOptions,
	): Promise<readonly TElement[]>
	element(reference: string): TElement | undefined
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

`BrowserPageInterface` extends `BrowserFrameInterface` and `BrowserViewInterface` and narrows `elements` to `BrowserElementManagerInterface<BrowserPageElementInterface>`. `BrowserDOMView` in `src/browser` implements `BrowserViewInterface` with `trusted` set to `false`. `wait` resolves when the text is on the page and rejects at the deadline with a `BrowserError` coded `BROWSER_WAIT_TIMEOUT`, the shape `navigation.wait` already uses (`src/core/BrowserNavigationManager.ts:44`).

### Tool vocabulary

**Naming rule.** A tool name is one lowercase English word. That is the fleet's own convention for tool names (toolbox registers `workflow`, `release`, `publish`, `infer`, `compile`, `notes`, and `describe`), it is the shortest string a small model copies, and it is the shape the real-model runs passed with. No prefix is added. The generic and staged names are reserved: `start()` refuses with a coded `BrowserError` when the supplied manager already holds any of `look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, or `switch` under an instance the toolset did not add, because a receipt that says "call `dialog`" must reach the toolset's own tool. A consumer that replaces a reserved name after `start()` breaks that path; the guide states it.

**Registry.** The registry is `@orkestrel/tool`'s `ToolManagerInterface` (`../tool/src/core/types.ts:221-313`), which `@orkestrel/agent` reads through `tools.definitions()` on every turn (`/home/user/orkestrel/agent/src/core/Agent.ts:436`), so a tool that appears mid-run reaches the model on the next turn. `BrowserToolset` fills and follows it: `emitter`, `tools` (the manager), `native` (the generic tools alone, for `publish`), `view` (the current view), `start(options?)`, and `destroy()`, with the events `adopt`, `skip`, and `select` in `BrowserToolsetEventMap`. Two factories create the one engine: `createBrowserToolset(page, options?)` in `src/core` and `createDocumentToolset(options)` in `src/browser`.

**Scope.** A toolset drives one current view: one tab on CDP, one document in the DOM placement. On CDP the toolset follows a popup that the current page's own action opens (the page's `popup` event) and returns to the opener when the popup closes; each receipt that crossed a focus change names it. With `options.context`, the `tabs` and `switch` tools are advertised and page tools move with the cursor.

The advertised set follows: 7 tools on CDP, 5 in the DOM placement, plus staged tools. "Not advertised" means the placement lists nothing rather than listing a tool and failing every call.

| Tool                                                          | Parameters                                                                                                                   | Annotations                                                                      | Result                                                            | CDP implementation                                                                                                                                                                                                                                              | DOM-native implementation                                                                                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `look`                                                        | `what` (string, required: what the model wants to find or act on), `ref` (string, optional: scope to that element's subtree) | `pure`, `untrusted`                                                              | The page view (see "Result formats")                              | `page.elements.outline({ within })`: `Accessibility.getFullAXTree` on the page session and on each out-of-process frame session, walked from the roots in document order                                                                                        | `BrowserDOMElementManager.outline()`: a depth-first walk of the document entering open shadow roots and same-origin frames                                                                           |
| `read`                                                        | `what` (string, required), `offset` (integer, optional, default 0), `ref` (string, optional)                                 | `pure`, `untrusted`                                                              | A Markdown slice of the distilled page with a continuation footer | `frame.read()` then `reading.markdown({ offset, limit })`; with `ref`, `element.read()`                                                                                                                                                                         | `view.read()` from `outerHTML`; with `ref`, the element's `outerHTML`                                                                                                                                |
| `click`                                                       | `ref` (string, required)                                                                                                     | none                                                                             | Receipt line, then the fresh view                                 | Actionability, hit test, then `Input.dispatchMouseEvent` (P4, P11)                                                                                                                                                                                              | `scrollIntoView`, then `HTMLElement.click()`; refuses a disabled element and a link whose `target` opens another browsing context                                                                    |
| `type`                                                        | `ref` (string, required), `text` (string, required), `submit` (boolean, optional)                                            | none                                                                             | Receipt line, then the fresh view                                 | Text control: `DOM.focus`, `select()` in the isolated world, `Input.insertText`, then a trusted `Enter` when `submit` (P17). `select` element: the option matching value, then label, set through `Runtime.callFunctionOn` with `input` and `change` dispatched | Native value setter plus `input` and `change`; `select` by option; `submit` through `form.requestSubmit()` with a `submit` listener, and `did not submit: FIELD — MESSAGE` when validation blocks it |
| `press`                                                       | `key` (string, required; `Enter`, `Escape`, `Tab`, arrows, `Control+a`)                                                      | none                                                                             | Receipt line, then the fresh view                                 | `normalizeBrowserKey` (case-insensitive aliases), then `page.keyboard.press`                                                                                                                                                                                    | Not advertised: a dispatched `KeyboardEvent` performs no default action                                                                                                                              |
| `navigate`                                                    | `url` (string, required)                                                                                                     | none                                                                             | Receipt line, then the fresh view                                 | Scheme check against `options.schemes` (default `http`, `https`), `page.navigate(url, { condition: 'load', signal })`, `beforeunload` accepted                                                                                                                  | Not advertised: the driven document's realm is the consumer's to navigate                                                                                                                            |
| `wait`                                                        | `text` (string, required), `timeout` (integer seconds, optional, default 5, most 30)                                         | `pure`                                                                           | `"TEXT" is on the page.` or `"TEXT" did not appear within S s.`   | `page.wait(text)`: an isolated-world `MutationObserver` expression awaited by `Runtime.evaluate`                                                                                                                                                                | A `MutationObserver` on the document                                                                                                                                                                 |
| `dialog` (staged: advertised while a dialog is open)          | `accept` (boolean, required), `text` (string, optional)                                                                      | none                                                                             | `Accepted the confirm dialog "MESSAGE".`, then the fresh view     | `BrowserDialogInterface.accept` or `dismiss` (P14, P20); never queued behind an action                                                                                                                                                                          | Not advertised: the page's own dialog blocks the page's thread                                                                                                                                       |
| `tabs` (opt-in through `context`)                             | `what` (string, required)                                                                                                    | `pure`                                                                           | One line per tab: `t1 "TITLE" URL (current)`                      | `context.pages()`                                                                                                                                                                                                                                               | Not advertised                                                                                                                                                                                       |
| `switch` (opt-in through `context`)                           | `tab` (string, required)                                                                                                     | none                                                                             | Receipt line, then the fresh view                                 | Moves the cursor, then `Page.bringToFront`                                                                                                                                                                                                                      | Not advertised                                                                                                                                                                                       |
| Page tools (staged: advertised while the page registers them) | The page's `inputSchema`, plus a required `what` when that schema requires nothing                                           | `untrusted` always; `pure` from `readOnly`; `consequential` from `consequential` | The rendered output, bounded by `limit`                           | `page.registry.adopt()`; `execute` runs `WebMCP.invokeTool`; an abort sends `WebMCP.cancelInvocation`                                                                                                                                                           | `options.source.adopt()`                                                                                                                                                                             |

**Every advertised tool declares one required parameter.** The direct daemon reading behind this rule: with `stream: true`, the mode `@orkestrel/ollama` uses, a call to a tool declaring no parameter made Ollama 0.34.4 answer `{"error":"XML syntax error on line 3: element <function> closed by </parameter>"}` and end the stream, while a call carrying a parameter streamed. `look`, `read`, and `tabs` carry `what` for that reason, and it doubles as the model's stated intent in the transcript. A page tool whose `inputSchema` is absent (`tmp/units/browser_protocol.json:30910-30913`) or requires no property is adopted with a required `what` string added to its advertised schema and stripped from the input before `invokeTool` or the source's handler runs; a page schema that already declares `what` as optional is skipped with `skip`.

**Every string a tool returns or throws is bounded.** The toolset's execution boundary cuts each result and each error message at `limit` characters plus a footer, after the receipt and view are composed. That covers a receipt whose fresh view exceeds the limit, a Markdown slice, a page tool's output, a page tool's `errorText`, a dialog's `MESSAGE`, and a tab's `TITLE` and `URL`, because every one of those is page-authored.

**Result formats.** The formats are shown in the following fence. Placeholders are upper snake case: `TITLE` is the document title, `URL` the address, `ROLE` and `NAME` the accessible role and name, `REF` an element reference, `TEXT` a text line, `FIELD` a form control's name, `MESSAGE` a page-authored message, and `START`, `END`, and `TOTAL` character positions.

```text
page "TITLE" URL
# Your cart
e1 link "Home"
e2 textbox "Email" value="sam@example.test"
e3 checkbox "Gift wrap" [checked]
e4 button "Place order" [disabled]
Two items, 48.00 total.
e5 form "Search cars" [tool=search-cars]
(5 of 5 elements)

Clicked e4 button "Place order".

page "Order placed" URL
...

Clicked e7 button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.

Clicked e3 link "Next"; the page is still loading URL.

[characters START–END of TOTAL; call read with offset END for more]
```

The view is the reading that made the fourth real-model run pass: interactive elements with references, headings as `# NAME`, and text lines, all in document order, with a `StaticText` row whose text equals its parent's name not repeated. A run whose view listed elements only (run 2) failed the task that needed a page fact; a run whose receipts carried no view (run 2) looped on `snapshot`; a run whose view was out of document order (run 3) answered from footer text. The reference sits first on its line so the model copies the leading token.

**Comparison with the shipped servers.** The design matches and refuses the shipped features as follows (matrix in `.orkestrel/browser/ledger.md`, "WebMCP research" rows).

- Match: accessibility-first references (DevTools MCP `uid`, Playwright MCP `ref`), reference-based click and type, a text wait, a snapshot after every action, dialog handling, and page-registered WebMCP tools.
- Refuse coordinate and vision tools: the probe model reads text, and coordinates bypass the reference contract.
- Refuse `evaluate_script`, `browser_evaluate`, and `browser_run_code_unsafe`: arbitrary code authored by a 2-billion-parameter model is a consequence no annotation bounds. A consumer composes it from `page.evaluate`.
- Refuse network, console, emulation, storage, tracing, performance, and heap tools: they serve a debugging human; the mechanisms stay on the programmatic surface.
- Refuse the `list_webmcp_tools` and `execute_webmcp_tool` pair: page tools become first-class tools with their own schemas, because a small model fills a flat schema more reliably than it nests JSON into a meta-tool, and because `@orkestrel/mcp`'s bridge already adopts them that way.
- Refuse `fill_form`, `upload_file`, `hover`, and `drag` from the vocabulary: nested arrays cost a small model more than repeated `type` calls, the agent holds no files, and hover and drag have no DOM-native counterpart. The programmatic `BrowserPageElementInterface` keeps `hover`, `upload`, and `drag`.
- Merge select into `type`: choosing an option by its label is setting a field's value.
- Refuse the `browser_` prefix: the fleet names tools with one word.

**System prompt.** The guide ships the prompt the fourth run passed with: the model can only see the page through tools and must call one before answering; `look` shows the page text and its elements with references such as `e4`; `click` and `type` act on a reference from `look`; `type` with `submit` presses Enter; `read` returns the page as Markdown; the model answers in one short sentence when done.

### References and locating

**References.** A reference is `e` followed by a positive integer. On CDP every page's element manager mints from one monotonic counter its browser context owns, so a reference from another tab of the same context can never alias; in the DOM placement the document's view owns the counter.

- Stability: a reference stays bound to one element while that element exists. P18 reads `backendDOMNodeId` values that stay monotonic across 10 000 create-and-remove cycles and a forced garbage collection, with a removed id refusing to resolve.
- No reuse: a number is never reused within the context, so a stale reference can never alias a later element, in the same tab or in a popup the cursor moved to.
- CDP binding: the table maps a reference to `{ frame, session, backend }`; the key is `SESSION:BACKEND`, because backend ids are per renderer and an out-of-process frame shares numbers with the main frame.
- DOM binding: the table maps a reference to a `WeakRef<Element>`.
- Spelling in: `parseBrowserReference` accepts `e12`, `E12`, `12`, `[e12]`, `ref=e12`, and `[ref=e12]` and returns `e12`, or `undefined` for anything else. The tool parameter is named `ref`, which is data; the member is `reference`, because an abbreviation is not a member name (`../scaffold/.claude/rules/names.md:238`).
- Invalidation: a cross-document navigation of the main frame drops the table. A child frame's `Page.frameNavigated` or `Page.frameDetached` drops that frame's entries by frame id, whether the frame is in-process (same session) or out-of-process (its own session).
- Errors: `BrowserElementError` (code `BROWSER_ELEMENT_ERROR`, `context.reason` one of `GONE`, `HIDDEN`, `OCCLUDED`, `DISABLED`, `UNKNOWN`) replaces `BrowserSelectorError`. A refusal names the next call: `Element e12 is gone because the page changed; call look for fresh refs.`

**Queries.** `elements.find(query)` resolves natively with no in-page locator engine.

- `role` and `name` filter the same accessibility capture the outline uses; `name` matches the trimmed accessible name case-insensitively as a substring. `Accessibility.queryAXTree` is not used: P9 shows it matches the name exactly and only, and it is marked experimental.
- `css` runs `DOM.querySelectorAll` on the document node, then `DOM.describeNode` for backend ids; in the DOM placement it is `querySelectorAll`.
- `within` scopes either query to a referenced element.
- The six locator axes fold into those paths: `role` and `label` are role and name, `text` and `placeholder` are the accessible name, `testId` and `css` are CSS.

**Waits.** `page.wait(text)` evaluates one compiled expression in the frame's isolated world with `awaitPromise`: it checks `document.body.innerText` immediately, re-checks on `MutationObserver` batches coalesced to one animation frame, and resolves at an in-page deadline. On `Execution context was destroyed` the host re-arms after the next `DOMContentLoaded`; on abort the host evaluates the disconnect. `elements.wait(query)` installs the same kind of observer over `childList`, `attributes`, `characterData`, and the subtree, re-runs `find` after each coalesced batch, and resolves on the first match, or on the first empty result with `absent`; a change that touches computed style alone produces no record, which the guide states. No binding, init script, or poll is installed. `BrowserNavigationManager.until` is deleted: an arbitrary predicate carries no event. `navigation.wait(pattern)` stays and gains `signal`; `navigation.idle()` is added and resolves on the next `Page.lifecycleEvent` named `networkIdle` for the current loader (P6), and `BrowserWaitUntil` gains `'idle'`.

### Actions

A trusted CDP click takes five steps, each with a named refusal.

1. `DOM.scrollIntoViewIfNeeded`.
2. `compileActionabilityFunction` in the isolated world: visible, enabled, and stable across two animation frames. `HIDDEN` or `DISABLED` refuses.
3. `DOM.getContentQuads` on the element's own session; no quad refuses `HIDDEN`. For an out-of-process frame the quad is frame-local (P19), so the page coordinates are the quad center plus the origin of the frame element's content box in its parent (`DOM.getBoxModel`; P26 reads the content quads as the border box, and a click at the border-box offset lands in the parent), composed up the frame chain.
4. `DOM.getNodeForLocation` on the element's own session at the frame-local point in that document's coordinates (the command takes document coordinates and reports nothing for a point scrolled out of view, P24; on the page session a point inside an out-of-process frame reports the frame's owner element, P21), without `includeUserAgentShadowDOM` (the flag reports the inner user-agent shadow node of an input, a textarea, or a select, P22); a hit outside the element and its composed descendants refuses `OCCLUDED` naming the covering element (P11).
5. `Input.dispatchMouseEvent` pressed and released on the page session.

**Serialization.** The toolset runs one action at a time in first-in, first-out order; an action holds the queue until its receipt is produced, and an action whose signal aborts while queued leaves the queue without sending anything. The signal is checked before a pointer or key pair starts; after `mousePressed` or `keyDown` is sent, the matching release is always sent without the signal, so an abort never leaves a button or key held down. A release still pending when the receipt is produced (P14) is awaited by the next action before that action sends anything. `dialog` never waits on the queue, because the pending release settles only after the dialog is handled.

**Dialogs.** Every pending step of every tool is raced against the page's `dialog` event: a pointer or key command, `Runtime.callFunctionOn` (a `<select>` whose `change` handler calls `alert()` blocks the call), the receipt's view capture (a handler that calls `confirm()` from a later task blocks the capture), the `wait` expression (a blocked thread fires no deadline), and `navigate`'s load. When a dialog opens at any point, the tool returns immediately with a receipt naming the dialog, the `dialog` tool is staged, and the blocked command settles after the dialog is handled. A dialog that opens while no tool runs is reported by the next tool result: every tool but `dialog` refuses with `A dialog is open; call dialog.` The `dialog` tool's receipt carries the fresh view.

**Receipts after an action.** The mouse-up settlement is raced against the page's `dialog` event and against `Page.frameRequestedNavigation` for the main frame (P12). Then:

- a dialog at any point wins, as ruled under "Dialogs"; P20 reads a `beforeunload` dialog arriving while the mouse-up is pending, after the navigation request, and the navigation committing after the dialog is accepted;
- a requested navigation that commits (`Page.frameNavigated` with a loader) waits for that loader's `load`, bounded by the `wait` default of 5 s; at the bound the receipt says `the page is still loading URL` and carries the current view, and a request that never commits within the bound says the click requested `URL` and the page did not change;
- a plain click returns the receipt and the fresh view;
- an abort rejects with the reason, after any pending release is sent.

**Trusted against DOM-native input.** The placements differ as follows, and the receipts say so.

- CDP: `trusted` is `true`. Clicks, keys, and hovers are `Input` events with `isTrusted` true, so they grant user activation and run every default action. P17 shows `Input.insertText` after an isolated-world `select()` replaces the value with a trusted `input` event.
- DOM: `trusted` is `false`. `click` is `HTMLElement.click()`, which runs activation behavior with `isTrusted` false and grants no user activation; `fill` is the native value setter plus `input` and `change`; `submit` is `requestSubmit()` with a `submit` listener across the call, so a form that fails validation reports `did not submit: FIELD — MESSAGE` from `validationMessage` instead of a submission. Receipts end `(untrusted event)`.
- Programmatic in both: setting a `select` element's option, which the receipt names `(programmatic)`.
- Refused in the DOM placement rather than faked: key presses, navigation, file choosers, hover, drag, typing into contenteditable, a link whose `target` opens another browsing context (the popup blocker drops an untrusted activation), a disabled control, and cross-origin frames (`iframe "TITLE" (cross-origin, not readable)`). The DOM placement never patches `window.alert`, `confirm`, or `prompt`; a click that opens one blocks the driven document's thread, and the guide records that limit.

### Reading

Reading is a value entity, `BrowserReading`, whose contract is shown in the following fence.

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

The reading holds the following contract.

- **Capture.** `frame.read()` issues one guarded `Runtime.evaluate` in the isolated world returning `{ url, title, html }` under `BROWSER_RESULT_LIMIT`, with the `BrowserResultLimitError` guard kept (`guides/browser.md:1932-1950`). The DOM view reads the same three facts from its document and refuses a string over the limit before parsing.
- **Retention.** The value holds html's own handle (`createHTML`), exposed as `html` rather than re-wrapped. The toolset retains the last reading keyed by view and reference, so `read` with an `offset` continues the same capture only when the key matches and recaptures from offset 0 otherwise.
- **Projections.** `markdown` is `renderMarkdown(htmlToMarkdown(document))` (`../markdown/src/core/helpers.ts:2756`, `:1748`); `text` is html's `renderText`. Both run over `html.distill({ base: url })` by default and over the whole document with `distill: false`. Each mode is projected one time per reading and every slice reuses it; that is an implementation property with no observable seam, so no acceptance criterion claims it.
- **Bound.** `limit` and `offset` count characters. A slice ends at the last line break at or before `offset + limit` when one exists past `offset`, and hard-cuts otherwise. Truncation is derived as `offset + text.length < total`, never stored. The tool default is `BROWSER_TOOL_LIMIT` (4 000 characters); the programmatic default is unbounded.
- **Invalidation.** `stale` is derived: the reading records the frame's navigation epoch at capture and compares it with the frame's current epoch, which `Page.frameNavigated`, `Page.navigatedWithinDocument` (P16), and detachment increment. The DOM view increments its epoch on the Navigation API's `navigatesuccess` where the browser ships it, and on `popstate`, `hashchange`, and `pagehide` otherwise; a `pushState` on a browser without the Navigation API is a stated limit. A `read` at offset 0 always recaptures; a `read` at a positive offset over a stale reading recaptures and answers from offset 0, and the result's `offset` shows the reset.
- **Fate of the old members.** `content()` and `article()` are deleted; `read()` replaces both. `snapshot()` stays (see "What goes").

P13 sizes on a bloated 10 025-character page: the document-order outline is 1 440 characters (7 times smaller), the distilled Markdown 386 characters (26 times smaller), and the distillate keeps the paragraph the reader wants and drops the section navigation.

### WebMCP outside the browser

`page.registry` is `BrowserRegistry`, the adapter over the experimental `WebMCP` protocol domain and only that domain. Its contract is shown in the following fence.

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

`BrowserToolAnnotation` transliterates the protocol's `Annotation` type (`tmp/units/browser_protocol.json:30853-30859`), which its TSDoc names, so `readOnly` and `untrustedContent` keep the protocol's spelling. The registry holds the following invariants; each names the reading or protocol line it rests on.

- **Detection.** `start()` subscribes `toolsAdded`, `toolsRemoved`, `toolInvoked`, and `toolResponded` on the page session, then sends `WebMCP.enable`. A `CDPError` whose `context.code` is `-32601` unsubscribes and resolves `false`; any other error rethrows; success resolves `true`. P15 reads `-32601` on Chromium 141. Subscription precedes `enable` because enabling fires `toolsAdded` for every registered tool (`tmp/units/browser_protocol.json:30961`) and `CDPClient` dispatches events synchronously while a response settles a promise whose continuation runs later (`src/core/CDPClient.ts:296-333`). There is no polyfill and no `supported` flag. What a Chrome that ships the domain behind `--enable-features=WebMCP` answers without the flag is unread; a code other than `-32601` rethrows, and the guide names that reading as owed.
- **Frames.** The registry enables the domain on each out-of-process frame session the page's `session` event reports, and subscribes `Page.frameNavigated` and `Page.frameDetached` on each session. A cross-document navigation or a detachment removes that frame's entries.
- **Mirror.** Entries are keyed by `(frame, name)`. `toolsAdded` for an existing key replaces it; `toolsRemoved` removes it; both emit `change`. `toolInvoked` emits `invoke` and `toolResponded` emits `respond`.
- **Execution.** `execute` refuses an already-aborted signal, sends `WebMCP.invokeTool({ frameId, toolName, input })` without passing the signal to `send` so the invocation id always arrives, and resolves on the `toolResponded` whose `invocationId` matches. The protocol sends the command response before tool events (`tmp/units/browser_protocol.json:30990`), but a transport can deliver both frames in one synchronous burst, so a `toolResponded` whose id is unknown is held only while an `invokeTool` command on that session awaits its reply, and it is dropped when no reply is pending; a foreign client's responses can never accumulate past that window. An abort before the id arrives records a pending cancel and sends `WebMCP.cancelInvocation` when the id arrives; an abort after sends it immediately; either rejects with `signal.reason` without waiting for the `Canceled` response. A navigation or detachment of the tool's frame, `destroy`, or the timeout rejects the invocation. Every status the page reports resolves a `BrowserInvocationResult`: `Completed` carries `output` unchanged as `unknown` (the protocol types it `any`), `Error` carries `errorText` or the exception description in `error`, and `Canceled` carries its status; only an invocation that cannot complete rejects. A deadline cancels the invocation the way an abort does: `WebMCP.cancelInvocation` goes out with the id when it is known, or after the `invokeTool` reply arrives, and the call rejects with the timeout error without waiting for the `Canceled` response.
- **Adoption.** `adopt()` projects each `BrowserTool` to a `ToolInterface` through `createTool`: `parameters` from `schema`, with the required `what` added when the schema requires nothing; `untrusted` always `true`, because the protocol marks the output "untrusted and poses a prompt injection risk" (`tmp/units/browser_protocol.json:31078`) and a page's own hint cannot lower that; `pure` from `readOnly`; `consequential` from `consequential`. The handler calls `execute` with `ToolContext.signal`; a status other than `Completed` throws a message naming `error`, bounded; `renderBrowserToolOutput` passes a string through, joins an MCP content array's text blocks, and renders anything else as bounded JSON.
- **Destroy.** `destroy()` sends `WebMCP.disable` on every enabled session, unsubscribes, and rejects every in-flight invocation.

**Adoption policy in the toolset.** Re-adoption is serialized: on `change`, the toolset records a generation, awaits `adopt()`, and applies the result only when no newer `change` and no `destroy` or cursor move happened in between; a stale result is dropped. It diffs by name into `tools` through `add` and `remove`, tracks the instances it added, forgets one when the manager publishes `remove` for that instance (a consumer's later `add` under the same name replaces it), and removes on `destroy` only a name whose registered instance is still one it added, so a consumer's tool is never removed. A tool is skipped, with `skip` emitted, in five cases: its name is reserved; its name is held by a tool the toolset did not add (`ToolManagerInterface.add` overwrites a same-named tool, `../tool/src/core/types.ts:208-219`, so a page could otherwise replace the consumer's `read`); its name falls outside `BROWSER_TOOL_NAME_PATTERN`, the narrowest tool-name rule among the providers the fleet targets (`[A-Za-z0-9_-]`, at most 64 code points), whose TSDoc cites the provider documents U7 reads, while WebMCP allows a period and 128 code points; its schema declares `what` as optional; or it is marked `debugging`. On a name collision between frames the main frame wins, then the earlier registration; `tool(name, frame)` reaches a shadowed one. A declarative form tool (`node` defined) receives a reference and the outline marks its form `[tool=NAME]`. A tool adopted from a `BrowserToolSourceInterface` in the DOM placement is projected through `createTool` with `untrusted` set before it is added, because mcp's bridge maps the page's hint faithfully and forces nothing (`../mcp/src/browser/helpers.ts:50-59`). Page-authored descriptions are advertised as authored, under the `untrusted` annotation.

**The `Runtime.evaluate` path over `document.modelContext` (P5) is refused.** It depends on page-visible `getTools` and `executeTool` members that the 2026-09-29 draft does not name and that Chrome's intent locates on `Navigator`; it must run in the main world, where the page controls every getter; and it lacks `frameId`, declarative `backendNodeId`, and cancellation. Puppeteer and Chrome DevTools MCP both use the domain. A browser that ships the registry without the domain reports `start()` as `false`, and that is the documented limit.

### WebMCP inside the browser

This package adds the DOM-native tool set and no registry client of its own. `createDocumentToolset({ document, source })` accepts any `BrowserToolSourceInterface`; `@orkestrel/mcp`'s `createModelContext()` returns a `ModelContextInterface` whose `emitter` and `adopt()` satisfy that shape structurally (type probe, `tsc --strict`, exit 0, with a refused control; promoted under D3). A consumer publishes `toolset.native` with the same bridge's `publish` for built-in agents, or hosts the manager with `createPageServer` or `createScopeServer`. The bridge's annotations carry no `debugging` flag (`../mcp/src/browser/types.ts:229-233`, the 2026-09-15 surface), so a `debugging` page tool reaches the DOM placement until the bridge reports the flag; that is a recorded limit and a declared conformance gap whose closer is mcp's refresh. The DOM outline marks a form carrying a `toolname` attribute as `[tool=NAME]`, which is the declarative form's adapter and needs no registry. The in-browser composition against a real `document.modelContext` is a recorded limit until a host registry exists (see "Limits").

### Event and invalidation model

Every wait parks on one of the sources in the following table. No site uses `setInterval` or a re-arming `setTimeout` to test a condition; a `setTimeout` survives only as a deadline, and the process-group drain is the one named exception.

| Event source                                                                                | Consumer                                                          | Effect                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Page.frameNavigated`, main frame                                                           | `BrowserPage` emits `navigate` `[url, false]`                     | References cleared; readings stale; main-frame page tools removed; the frame's isolated world dropped                                                                                  |
| `Page.navigatedWithinDocument`, main frame (P16)                                            | `BrowserPage` updates `url`, emits `navigate` `[url, true]`       | Readings stale; references kept; `navigation.wait` resolves on routes                                                                                                                  |
| `Page.frameNavigated` or `Page.frameDetached`, child frame                                  | Registry; the element manager; the frame's world cache            | That frame's tools and references dropped by frame id                                                                                                                                  |
| `Page.frameRequestedNavigation`, main frame (P12, P20)                                      | The action receipt                                                | The receipt waits, bounded, for the committed loader's `load`                                                                                                                          |
| `Page.lifecycleEvent` after `Page.setLifecycleEventsEnabled` (P6)                           | Readiness and `idle`                                              | `look`, `read`, and `navigate` wait for `DOMContentLoaded` of the current loader, seeded one time from `document.readyState` when enabled mid-load; `idle()` resolves on `networkIdle` |
| `Runtime.executionContextDestroyed`, `Runtime.executionContextsCleared`                     | The frame's world cache                                           | The cached isolated world id is dropped; the next evaluation creates one with `Page.createIsolatedWorld`                                                                               |
| `Page.javascriptDialogOpening` (P14, P20)                                                   | Page `dialog` event; the toolset                                  | Every pending tool step returns; the `dialog` tool is staged; the blocked command settles after handling                                                                               |
| `Target.attachedToTarget`, `type: 'page'`                                                   | Page `popup` event; the toolset                                   | The cursor moves to the popup; the receipt names it                                                                                                                                    |
| `Target.attachedToTarget`, `type: 'iframe'` (P19)                                           | Page `session` event; `frames()`                                  | The registry enables `WebMCP`; the outline reads that frame's tree on its session; `frames()` lists it                                                                                 |
| `Target.targetDestroyed`                                                                    | Page `close` event; the toolset                                   | The cursor returns to the opener; that view's references are dropped                                                                                                                   |
| `WebMCP.toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`                         | Registry                                                          | Mirror and invocation settlement                                                                                                                                                       |
| In-page `MutationObserver` coalesced to `requestAnimationFrame`                             | `page.wait` through `Runtime.evaluate` `awaitPromise`, or in-page | Resolves on a match; an in-page deadline resolves `false`                                                                                                                              |
| In-page `MutationObserver` over `childList`, `attributes`, `characterData`, and the subtree | `elements.wait`                                                   | Each coalesced batch re-runs `find`; a style-only change produces no record                                                                                                            |
| `Emulation.virtualTimeBudgetExpired`                                                        | `BrowserClock` (retained)                                         | `advance()` resolves                                                                                                                                                                   |
| `Tracing.tracingComplete`                                                                   | `BrowserTracing` (retained)                                       | `stop()` resolves                                                                                                                                                                      |
| DOM `navigatesuccess`, `popstate`, `hashchange`, `pagehide`                                 | `BrowserDOMView`                                                  | Readings stale                                                                                                                                                                         |
| Child stderr `DevTools listening on ws://…` (P10)                                           | `Browser` launch                                                  | Readiness without HTTP polling                                                                                                                                                         |
| Child stderr pipe `close`                                                                   | `Browser` launch after a launcher hand-off                        | Readiness failure when the line never arrived                                                                                                                                          |
| `AbortSignal` from `ToolContext.signal`                                                     | Toolset queue, `CDPClient.send`, registry cancel                  | A queued action never starts; a pending command rejects with the reason; an invocation is cancelled                                                                                    |

### Lifecycle and ownership

Each entity's lifecycle after the redesign follows.

- **`Browser`.** It keeps `discover`, `connect`, `adopt`, `disconnect`, `destroy`, `close`, `context`, `contexts`, `isolate`, `create`, ownership, `endpoint`, `pid`, and process-group termination. One change: an owned launch reads its endpoint from the child's stderr line, spawning with `--remote-debugging-port=0` when no port is given and with `stdio: ['ignore', 'ignore', 'pipe']`, and draining stderr for the process life. A launcher that exits 0 before the line (guide invariant 13, `guides/browser.md:2038-2052`) hands the pipe to the process it re-executed, so `connect()` keeps reading that pipe on the same `timeout` budget and rejects with the readiness failure when the pipe closes without the line; whether Microsoft Edge's Windows launcher passes the pipe on is a limit to read on a Windows host. Termination keeps its bounded drain of the process group (`src/server/Browser.ts:1059-1078`): Node raises `exit` for the direct child alone, a member killed a moment earlier is a zombie until its parent reaps it, so `kill(-pgid, 0)` read one time after the child's `exit` can report a group alive that is gone a millisecond later. That drain is the one liveness probe with no event source; it lives in `src/server` only, its interval is `BROWSER_DRAIN_INTERVAL_MS` in `src/server/constants.ts`, and its `@remarks` names the reason.
- **`BrowserContext`.** `page(index?)` and `pages()` stay the tab manager; no `tabs` accessor is added. The context owns the reference counter.
- **`BrowserPage` and `BrowserFrame`.** They keep `destroy` (local release) and `close` (the protocol's `Target.closeTarget`). The page keeps one cached isolated world per document for the element manager and the reader, dropped on the `Runtime` context events; `page.evaluate` stays in the main world, because the known consumer reads `globalThis.ready` there (`/home/user/orkestrel/ollama/tests/setupServer.ts:1128`).
- **`BrowserToolset`.** `destroy()` stops following the view, removes the tools it added and still owns, destroys a registry or reading it created, rejects queued actions, and destroys its emitter last (`../scaffold/.claude/rules/patterns.md:79`). A tool called after `destroy` fails with `the browser session ended`. The toolset never closes a page it did not open.
- **`BrowserRegistry`.** `destroy()` as specified earlier.
- **`BrowserDownload`.** `cancel` becomes `abort`, the status `'cancelled'` becomes `'aborted'`, and the `cancel` event becomes `abort`, because the fixed vocabulary bans `cancel` (`../scaffold/.claude/rules/names.md:232`). `BrowserFileChooser.cancel` becomes `dismiss`, the dialog verb (`src/core/types.ts:975`).

### What goes

`AGENTS.md` binds every row: a symbol is removed only when the capability itself must not exist (`../scaffold/AGENTS.md:63`). The following table rules on every current entity.

| Entity                                                                                                             | Ruling                                                                                                                                                              | Reason                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPClient`, `CDPTransportInterface`, `createCDPClient`                                                            | Keep; `CDPSendOptions` gains `signal`                                                                                                                               | Tool calls carry `ToolContext.signal`                                                                                                                                                                                                                                                                                                                                                    |
| `WebSocketCDPTransport`, `createCDPTransport` (server)                                                             | Keep                                                                                                                                                                | Owned launch and attach transport                                                                                                                                                                                                                                                                                                                                                        |
| `BrowserTransition`                                                                                                | Keep                                                                                                                                                                | Shared in-flight transitions                                                                                                                                                                                                                                                                                                                                                             |
| `Browser`                                                                                                          | Keep; launch readiness changes                                                                                                                                      | See "Lifecycle and ownership"                                                                                                                                                                                                                                                                                                                                                            |
| `BrowserContext` and its managers                                                                                  | Keep; owns the reference counter                                                                                                                                    | Tab manager and isolation                                                                                                                                                                                                                                                                                                                                                                |
| `BrowserPage`                                                                                                      | Keep; `navigate` payload, `session` event, `elements`, `registry`, `wait`, `trusted`, input managers, out-of-process `frames()` added; `content`, `article` removed | Invalidation needs both navigation kinds; the registry and the outline need frame sessions                                                                                                                                                                                                                                                                                               |
| `BrowserFrame`                                                                                                     | Keep; `read` added; `selectors`, `click`, `fill`, `select`, `wait`, `content`, `article`, `keyboard`, `mouse`, `touch` removed                                      | Actions go through references; input is per page                                                                                                                                                                                                                                                                                                                                         |
| `BrowserHandle`, `BrowserWorker`, `BrowserDialog`, `BrowserFileChooser`                                            | Keep; chooser `cancel` becomes `dismiss`                                                                                                                            | Consumers use them; the toolset uses the dialog                                                                                                                                                                                                                                                                                                                                          |
| `BrowserDownload`                                                                                                  | Keep; `cancel` becomes `abort`                                                                                                                                      | Fixed lifecycle vocabulary                                                                                                                                                                                                                                                                                                                                                               |
| `BrowserCookieManager`, `BrowserPermissionManager`, `BrowserStorageManager`, `BrowserEmulationManager`             | Keep                                                                                                                                                                | Context mechanisms; no polling                                                                                                                                                                                                                                                                                                                                                           |
| `BrowserLocator`, `BrowserSelectorManager`, the six axes                                                           | Delete                                                                                                                                                              | Built on in-page 100 ms polling (`src/core/compilers.ts:467`, `501`, `540`, `579`); the capability survives as `elements.find` and `elements.wait`                                                                                                                                                                                                                                       |
| `compilers.ts`                                                                                                     | Change                                                                                                                                                              | Delete the locator list, locator, CSS, and function waits, click, fill, and select compilers; keep guarded evaluate, binding source, result and cleanup, screenshot preparation, storage, actionability, and the codegen recorder source; add `compileTextWaitExpression`, `compileQueryWaitExpression`, `compileReadFunction`, `compileSelectFunction`; retarget `compileCodegenScript` |
| `BrowserNavigationManager`                                                                                         | Keep `wait` (gains `signal`); add `idle`; delete `until`                                                                                                            | `until` polls (`src/core/BrowserNavigationManager.ts:59-70`) with no possible event source                                                                                                                                                                                                                                                                                               |
| `BrowserScriptManager`                                                                                             | Keep                                                                                                                                                                | Bindings and init scripts for consumers (P3)                                                                                                                                                                                                                                                                                                                                             |
| `BrowserAccessibility`                                                                                             | Keep                                                                                                                                                                | The raw decode the element manager composes                                                                                                                                                                                                                                                                                                                                              |
| `BrowserKeyboard`, `BrowserMouse`, `BrowserTouch`                                                                  | Keep; move to the page                                                                                                                                              | Trusted input primitives                                                                                                                                                                                                                                                                                                                                                                 |
| `BrowserCodegen` with its types, constants, parsers, and helpers                                                   | Keep; change the compiled output                                                                                                                                    | The recorder is event-driven (`Runtime.addBinding`) and records CSS selectors (`src/core/compilers.ts:276-280`), which `elements.find({ css })` resolves, so the capability can exist; `compileCodegenScript` emits `(await page.elements.find({ css: SELECTOR }))[0]` followed by the element action                                                                                    |
| `BrowserSnapshot`, `page.snapshot()`                                                                               | Keep                                                                                                                                                                | Correct, bounded, event-free, guide invariant 14; the owner's general permission is not a reason to delete                                                                                                                                                                                                                                                                               |
| `BrowserNetworkManager`, `BrowserRoute`, `BrowserHARManager`, `BrowserWebSocket`                                   | Keep                                                                                                                                                                | Network mechanisms the consumer uses (`network.start()`)                                                                                                                                                                                                                                                                                                                                 |
| `BrowserDiagnostics`, `BrowserTracing`, `BrowserCoverage`, `BrowserPerformance`, `BrowserProfiler`, `BrowserClock` | Keep                                                                                                                                                                | Event-completed mechanisms                                                                                                                                                                                                                                                                                                                                                               |
| `page.pdf`, `page.screenshot`                                                                                      | Keep; `mask` takes elements                                                                                                                                         | Consumer mechanisms; not in the vocabulary                                                                                                                                                                                                                                                                                                                                               |
| `BrowserWriterInterface`, `FileBrowserWriter`                                                                      | Keep                                                                                                                                                                | Guide invariant 4                                                                                                                                                                                                                                                                                                                                                                        |
| `BrowserSelectorError`, `isBrowserSelectorError`                                                                   | Delete; add `BrowserElementError`, `isBrowserElementError`                                                                                                          | The selector engine is gone                                                                                                                                                                                                                                                                                                                                                              |
| `BrowserConnectionError`                                                                                           | Keep; move to `src/core/errors.ts`                                                                                                                                  | The browser-face transport throws it                                                                                                                                                                                                                                                                                                                                                     |
| `waitForCDPReady`                                                                                                  | Delete; add `readBrowserEndpoint(stream, signal)`                                                                                                                   | A poll (`src/server/helpers.ts:358-396`) with an event source available (P10)                                                                                                                                                                                                                                                                                                            |
| `BROWSER_WAIT_POLL_INTERVAL_MS`, `BROWSER_TEST_ID_ATTRIBUTE`, `BROWSER_VISIBILITY_SOURCE`                          | Delete                                                                                                                                                              | Their users are deleted                                                                                                                                                                                                                                                                                                                                                                  |

### Dependencies and names

Each edge is ruled as follows.

- `@orkestrel/tool` `^0.0.17`, runtime (D1): `ToolInterface`, `ToolContext`, `ToolAnnotations`, `createTool`, `createToolManager`. Never re-exported (`../scaffold/.claude/rules/architecture.md:161`).
- `@orkestrel/markdown` `^0.0.16`, runtime: `htmlToMarkdown`, `renderMarkdown`. It pins `@orkestrel/html` `^0.0.11`, as this package does.
- `@orkestrel/mcp` `^0.0.33`, development only (D3), for the type test and the conformance composition in U17.
- `playwright` and `@vitest/browser-playwright`, development (D2).
- No other package and no browser binary.

Every added bare name is prefixed `Browser` or qualified by its face, so none collides with a fleet owner (`../scaffold/.claude/rules/names.md:124-137`): `BrowserTool`, `BrowserToolAnnotation`, `BrowserToolset*`, `BrowserToolSource*`, `BrowserRegistry*`, `BrowserInvocation*`, `BrowserRead*`, `BrowserReading*`, `BrowserElement*`, `BrowserDOMView`, `BrowserDOMElement`, `BrowserDOMElementManager`, `SocketCDPTransport`, `createBrowserDOMView`, `createDocumentToolset`, `createSocketCDPTransport`. No export is named `Tool*`, `WebMCP*`, `ModelContext*`, `Markdown*`, or `HTML*`; `HTMLInterface` is used by import.

### Blast radius

`@orkestrel/browser` goes from `0.0.18` to `0.0.19` and gains the `./browser` export. `@orkestrel/ollama` pins `^0.0.18` (`/home/user/orkestrel/ollama/package.json:84`), and a caret on `0.0.x` admits that version alone, so it re-pins to `^0.0.19`. Of its calls, one shape breaks: `page.evaluate(expression, timeout)` becomes `page.evaluate(expression, { timeout })` at six sites, `/home/user/orkestrel/ollama/tests/setupServer.ts:1128` and `:1441`, and four in `/home/user/orkestrel/ollama/tests/service/page.test.ts`; the stub at `/home/user/orkestrel/ollama/tests/setupServer.test.ts:678` and its assertion change with them, and the TSDoc at `/home/user/orkestrel/ollama/tests/setupServer.ts:1088-1089`, `:1167-1174`, and `:1208-1213`, which records that page commands take no signal, is rewritten. The consumer's guide mirror `/home/user/orkestrel/ollama/guides/browser.md` is refreshed from the 0.0.19 guide. `createBrowser`, `connect`, `create`, `network.start`, `navigate(url, { timeout })`, `destroy`, and `findSystemBrowser` are unchanged, and the consumer subscribes no `navigate` listener. The scaffold catalog row for `browser` gains `tool` and `markdown` edges in a scaffold commit. No other fleet package declares this one. One fleet finding is handed to mcp's own campaign rather than fixed here: its bridge lags the 2026-09-29 draft on `toolactivated`, `toolcancel`, and `debugging`.

## Rulings

Both design lanes raised judgment calls, and the falsify round added findings. Each is ruled here with its reason; the reading it rests on is named where one exists.

1. **Engine shape: page entities plus one toolset.** The programmatic surface is `page.elements`, `page.registry`, `frame.read()`, and `page.wait(text)`, shared with the DOM view through `BrowserViewInterface`; `BrowserToolset` is one thin engine over any view. This keeps the manager-on-entity pattern the package already uses (`page.network`, `page.navigation`, `page.scripts`, `page.accessibility`) and gives programmatic consumers a typed surface. The alternative, a driver over a key-based surface contract, exposes keys no consumer wants. The alternative's implementation invariants are kept in full: session-qualified keys, one cached isolated world per document, first-in first-out actions, lifecycle-event readiness, and the registry's ordering rules.
2. **Tool names: one word, no prefix, reserved at `start()`.** Fleet convention, shortest copy, and the proven run. A reserved name held by a foreign tool is refused before the model sees a receipt that names it.
3. **Page tools are first-class and staged.** `@orkestrel/agent` reads definitions each turn; mcp's bridge adopts first-class; a flat schema beats a nested `input` for a small model. Page descriptions carry `untrusted`. A schema that requires nothing gains a required `what`.
4. **A staged `dialog` tool, not an auto-accept option.** P14 and P20 prove the receipt can return while the dialog is open. The agent keeps control and the receipt names the next call, which the runs show a small model follows. Every pending step of every tool is raced against the dialog event, and `dialog` bypasses the action queue.
5. **Receipts carry the fresh view.** Run 2, without views in receipts, looped; run 3, with them, passed the same task. The `navigate` receipt carries the view for the same reason the first turn does.
6. **The view carries text and elements in document order.** Runs 2, 3, and 4 as recorded under "Result formats".
7. **`select` merges into `type`.** One fewer tool; a label is a value.
8. **`find` filters the accessibility capture; `queryAXTree` is not used.** P9: exact match only, experimental.
9. **Waits are isolated-world expressions, not bindings.** No init script, no page-callable binding, one message per resolution, tamper-resistant. P3's binding path stays available to consumers through `page.scripts`.
10. **The two-frame stability check stays.** It is event-driven (two animation frames), already compiled, and guards a moving target that the hit test alone does not.
11. **`src/browser` is proved on the Playwright provider and cross-checked in `service`.** The scaffold forces the project; mcp sets the precedent; a served `dist/src/browser` page driven by this package's own server face compares the DOM outline's interactive `(role, name)` set with the CDP outline's, which catches divergence between two mechanisms.
12. **`SocketCDPTransport` ships in `src/browser`.** The owner asked for environment agnosticism and workers have no `document`; a `WebSocket` transport is the only way a worker or extension page drives a browser. It is 1 class with a proof against a browser launched with `--remote-allow-origins=*`, and its control is a launch without the flag.
13. **No end-to-end MCP proof in this package.** Hosting a manager over MCP is mcp's proven contract; the model-driven proof lives in ollama's service axis, which already holds this package and the model; the in-browser registry composition is a limit until a host registry exists; the structural fit is pinned by one type test under D3.
14. **Codegen stays and is retargeted; the snapshot stays.** Both lanes of the falsify round showed the recorder records selectors that `find({ css })` resolves, so the removal gate does not admit deleting it.
15. **The process-group drain stays, bounded and alone.** A killed member is a zombie until reaped, so one reading after the child's `exit` can be wrong; no event exists for a non-child process. The drain is confined to `src/server/Browser.ts`, and the exit criterion's Grep names it as the one exception. Routing termination through `@orkestrel/process` would need a package the owner has not requested.
16. **`consequential` is not set on generic tools.** Marking every click would make every click need confirmation; page tools carry their own hint.
17. **Bounds default to 4 000 characters per result and 150 outline elements.** P13 sizes fit with room; the daemon reports a 262 144-token context length for the probe model, and the consumer's option sets pin `num_predict` at 8 to 64 with no `num_ctx`, so the default window governs. The bounds are options, and every string the toolset returns or throws is cut at them.
18. **Lenient reference parsing.** A failed call costs a turn a small model may not recover; the parser accepts the six spellings and refuses the rest with the next call named.
19. **`wait` covers the main frame.** Same-origin child frames are reachable through `elements.wait` with `within`.
20. **Scheme allowlist defaults to `http` and `https`.** `file:`, `data:`, and `chrome:` are refused before any command is sent.
21. **`debugging` page tools are not adopted where the flag is visible.** The specification marks them for developers; the bridge does not carry the flag, and that is a limit.
22. **Contenteditable typing and links that open another browsing context are refused in the DOM placement.** `InputEvent` insertion has no default action, and an untrusted activation cannot open a browsing context; a fake success is worse than a refusal.
23. **`BrowserFileChooser.cancel` becomes `dismiss`.** The dialog verb, not a synonym of `abort`.
24. **The DOM toolset drives a document the caller names, never `globalThis.document` by default.** A toolset whose own realm navigates cannot return from the action that navigated it; the safe topology is a realm that survives the driven document.
25. **`native` is what a consumer publishes.** Publishing the manager would re-register the page's own tools as proxies.
26. **The fleet replaces WebMCP; this package adapts to it in both directions.** The owner's stance of 2026-09-29. No export is named after WebMCP, the vocabulary needs no registry, and the two adapters plus the declarative mark are the whole WebMCP surface.
27. **Alignment is a digest-pinned conformance project, not a claim.** `tests/conformance.test.ts` compares the registry's contracts against vendored, revision-named mirrors of the specification source, webref's IDL, and the protocol domain, the mcp precedent; a drift reddens a named row and is ruled, never patched around, and the refresh ritual under "Relation to WebMCP" is how the package keeps up.

## Evidence

Every reading was taken on 2026-09-29 on this host (Linux container, Chromium 141.0.7390.37 at `/opt/pw-browsers/chromium`, Node 22.22.2, Ollama 0.34.4) unless a row names another source. The probe sources and logs live under `tmp/`, which is not committed; `.orkestrel/browser/ledger.md` records each reading with its log name.

### Runtime probes on the host Chromium

The following table lists each probe, its reading, and its control (P1 through P8: 8 passed; P9 through P13: 5 passed; P14 through P17: 4 passed; P18 through P20: 3 passed).

| Probe | Reading                                                                                                                                                                                                                                                                                                                | Control                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P1    | Chromium 141 exposes neither `document.modelContext` nor `navigator.modelContext`                                                                                                                                                                                                                                      | `'body' in document` is true                                          |
| P2    | After `DOM.enable` and `DOM.getDocument`, `DOM.childNodeInserted` arrives for an element appended 50 ms later                                                                                                                                                                                                          | No event within 300 ms when nothing mutates                           |
| P3    | A `MutationObserver` installed by an init script reports through a host binding                                                                                                                                                                                                                                        | A revoked binding reports nothing                                     |
| P4    | A trusted click is driven from an accessibility node's `backendDOMNodeId` alone; the page's `dataset.clicked` reads `yes`                                                                                                                                                                                              | `DOM.resolveNode` on a bogus id rejects with a `CDPError`             |
| P5    | A main-world `document.modelContext` double is listed, executed, and aborted from the host through `Runtime.evaluate`                                                                                                                                                                                                  | An isolated world reads `typeof document.modelContext` as `undefined` |
| P6    | `Page.lifecycleEvent` reports `load` and `networkIdle` after `Page.setLifecycleEventsEnabled`                                                                                                                                                                                                                          | Nothing arrives when disabled                                         |
| P7    | `renderText(createHTML(html).distill().document)` keeps the paragraph and drops `nav` and `footer`                                                                                                                                                                                                                     | The raw text keeps them                                               |
| P8    | The accessibility tree flattened to `role "name"` lines is more than 3 times smaller than a bloated page's HTML                                                                                                                                                                                                        | The full outline with text rows is larger than a 397-character page   |
| P9    | `Accessibility.queryAXTree` rooted at the document matches `Save` exactly and returns the visible button only                                                                                                                                                                                                          | `Sav` matches none                                                    |
| P10   | A launch with `--remote-debugging-port=0` prints `DevTools listening on ws://127.0.0.1:PORT/devtools/browser/ID` on stderr within 4 s                                                                                                                                                                                  | No line without the flag                                              |
| P11   | `DOM.getNodeForLocation` at a covered button's center returns the overlay and a trusted click there does nothing                                                                                                                                                                                                       | With the overlay removed it returns the `BUTTON` and the click lands  |
| P12   | On a trusted link click, `Page.frameRequestedNavigation` arrives before the mouse-up send resolves and `Page.frameNavigated` after                                                                                                                                                                                     | The navigated URL is the link's                                       |
| P13   | Bloated page: HTML 10 025 characters, document-order outline 1 440, distilled Markdown 386                                                                                                                                                                                                                             | The distillate keeps the wanted paragraph and drops `Section 3`       |
| P14   | `Page.javascriptDialogOpening` arrives while `mouseReleased` stays pending for 1 500 ms; handling the dialog settles it and the page reads the answer                                                                                                                                                                  | A plain button settles within 1 500 ms with no dialog event           |
| P15   | `WebMCP.enable` rejects with `CDPError` code `-32601` naming the method; `Schema.getDomains` lists no `WebMCP`                                                                                                                                                                                                         | `Page.enable` resolves                                                |
| P16   | `history.pushState` fires `Page.navigatedWithinDocument` and no `Page.frameNavigated`                                                                                                                                                                                                                                  | A DOM mutation fires neither                                          |
| P17   | `DOM.focus`, isolated-world `select()`, then `Input.insertText` replaces the value and the page sees `isTrusted` `true`                                                                                                                                                                                                | Without the selection the text appends                                |
| P18   | After 50 elements are described, removed, 10 000 create-and-remove cycles run, and `HeapProfiler.collectGarbage` completes, 50 later elements carry `backendDOMNodeId` values greater than every earlier one                                                                                                           | A removed id no longer resolves                                       |
| P19   | An out-of-process iframe (`localhost` inside `127.0.0.1`) is its own `iframe` target absent from the page's frame tree, so `page.frames()` returns 1 frame; over a flattened session, `DOM.getContentQuads` is frame-local, and a page-session click at the quad center plus the iframe's rectangle lands in the frame | The raw frame-local point lands in the outer document                 |
| P20   | A trusted link click on a page with a `beforeunload` handler reports `Page.frameRequestedNavigation`, then the `beforeunload` dialog while the mouse-up is pending; accepting it lets `Page.frameNavigated` arrive and the send settle                                                                                 | The send stays pending 1 000 ms before the dialog is handled          |

The type probe (`tsc --ignoreConfig --strict`, exit 0): mcp's `ModelContextInterface` is assignable to `BrowserToolSourceInterface`; a shape without `adopt` is refused under `@ts-expect-error`.

### The real-model runs

Four runs of one probe (`qwen3.5:2b-q4_K_M` through `@orkestrel/agent` and `@orkestrel/ollama`, temperature 0, at most 8 turns, 3 attempts per task) drove a served store page (a search form, three items with add buttons, a cart count) through prototype tools over the published 0.0.18. Ground truth was read from the page after each attempt for the click and search tasks. The following table records the runs.

| Run | Vocabulary                                                                                                    | Read task                 | Click task                                                                                  | Search task                                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `read`, `snapshot`, `click`, `type`, `press`; no parameters on `read` and `snapshot`; refs `[4]`; soft prompt | 0 of 3: narrated, no call | 0 of 3: narrated, no call                                                                   | 0 of 3: guessed refs                                           |
| 2   | Every tool takes a parameter; refs `e4`; must-call prompt                                                     | 1 of 1                    | 0 of 3: clicked the right button, then called `snapshot` 5 times looking for the cart count | 0 of 3: answered from `read` without searching                 |
| 3   | `look` carries text and refs; receipts carry the fresh view; `type` takes `submit`                            | 1 of 1                    | 1 of 1 in 4 turns                                                                           | 0 of 3: guessed `e1`, then copied "3 results" from footer text |
| 4   | Outline in document order; the first turn carries the view                                                    | 1 of 1, 1 call            | 1 of 1, 2 calls                                                                             | 1 of 1, 1 call                                                 |

The falsify round found the read task's oracle weak: its fact sat inside the seeded first-turn view and the check was a substring of the answer. The click and search tasks read page state. U15 corrects the oracles as ruled there. The rules the runs established are contract: every tool declares one required parameter; references are spelled `e<n>` and the parameter description names one; one observation shape carries text and references in document order; an action's receipt carries the fresh view; the first turn carries the view; `type` takes `submit`; the system prompt says the model sees the page only through tools and must call one before answering.

### WebMCP status

The status readings follow, taken from the specification, the Chrome intent, and the protocol schema.

- Specification draft of 2026-09-29: registry `document.modelContext`; `registerTool`, `getTools`, `executeTool`; events `toolchange`, `toolactivated`, `toolcancel`; annotations `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`; names of 1 to 128 code points from ASCII alphanumerics, underscore, hyphen, and period; the `tools` Permissions-Policy feature.
- Chrome intent to experiment (blink-dev, 2026-05-15): dev trial M146, origin trial M149 to M156, ship target M157; the intent names `Navigator.modelContext` while the specification names `document.modelContext`. Flag `chrome://flags/#enable-webmcp-testing`.
- The `WebMCP` protocol domain (tip of tree, experimental): `enable`, `disable`, `invokeTool`, `cancelInvocation`; `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`; a `Tool` carries `frameId`, `backendNodeId?`, and the five annotations. Puppeteer's `page.webmcp` and Chrome DevTools MCP 1.10.1 drive it; the latter needs Chrome 150 with `--enable-features=WebMCP`. Chromium 141 predates the domain (P15).
- `@orkestrel/mcp` 0.0.33 declares the 2026-09-15 surface: `toolchange` only, no `debugging`, `executeTool` typed `Promise<unknown>`; its bridge is proven against an IDL-faithful double (`../mcp/tests/fixtures/modelContext.ts`) and a `describe.runIf(isWebMCPDocument(document))` block that no shipping browser collects.
- The specification source names its test suite at `https://wpt.fyi/results/webmcp` (line 20 of `index.bs`, fetched 2026-09-29, 86 547 bytes), and web-platform-tests carries `webmcp/META.yml`, `webmcp/idlharness.https.window.js`, and webref's `interfaces/webmcp.idl` (2 136 bytes, `ontoolchange` alone, three hints, `executeTool` taking `any`), each fetched 2026-09-29; the WebIDL and the README disagree on `executeTool`'s result (`Promise<DOMString>` against a `{ content: [...] }` sample), which `renderBrowserToolOutput` accepts either way.

### The falsify round

Two audit lanes read the reconciled draft blind against 20 numbered claims: the `reviewer` role on Opus 5.5 (subjective lane) and the `analyst` role on GPT-6 Astra (objective lane, `codex exec`, read-only sandbox, 454 566 ms). Both returned `FAIL`. The findings both lanes substantiated, each reproduced before it was ruled: dialog coverage beyond the mouse-up; page tools without a required parameter; unbounded page-authored strings; an adoption result settling after `destroy`; a registry buffer that grows under overlapping invocations; the DOM placement's silent `requestSubmit()` failure and blocked `_blank` link; the event table's missing rows; a sixth consumer `evaluate` site; codegen's removal failing the removal gate; guide invariants 5, 6, and 13; acceptance criteria that a polling `wait` and a by-name `destroy` would pass; the read task's oracle; an unbounded post-navigation load wait. One lane each added: `BrowserConnectionError` declared in the server face; the `ref` member name; the reserved-name collision on `dialog`; the DOM placement driving its own realm; the bridge publish loop; staleness on same-document routes; the retained reading's key; the `wait` return contract; the U5 Grep; the `debugging` flag in the bridge; the unpromotable type probe; the consumer's guide mirror. The two claims both lanes left unresolved, backend id reuse and out-of-process frame coordinates, were settled by P18 and P19. Every item is ruled in this text and carried into a unit.

## Units

Engines: `builder` is Sonnet for a mechanical unit; `opus` is Opus 5.5 for a unit whose judgment is subjective; `astra` is GPT-6 Astra for a constraint-heavy unit. Every unit ends with its touched files and projects green and reports the commands it ran. Units run in the order given; a unit starts when its dependencies are accepted, so U1 and U8 run in parallel, U3 and U6 run in parallel after U2, U9 through U10 run beside U11's first cases, and U17 runs after U10 and before U12.

### U1 `signal`

This unit threads an abort signal from a tool call to the CDP command it issued.

- **Engine:** `builder`.
- **Owns:** `src/core/types.ts` (`CDPSendOptions.signal`; `BrowserCallOptions` replacing `BrowserSendOptions`; option shapes of `evaluate`, `handle`, `title`, `send`, `navigate`), `src/core/CDPClient.ts`, `src/core/BrowserFrame.ts`, `src/core/BrowserPage.ts`, `src/core/BrowserWorker.ts`, `src/core/BrowserHandle.ts`, `src/core/errors.ts` and `src/server/errors.ts` (`BrowserConnectionError` moves to core), their mirrored tests, `tests/setup.ts` (`fail` gains a numeric `code` written into `context.code`), call sites in `tests/service/browser.test.ts`.
- **Depends on:** nothing.
- **Acceptance:**
  1. `npm run check:src:core` and `npm run check:src:server` exit 0.
  2. A pre-aborted signal rejects with `signal.reason` and `transport.sent` stays empty; an abort after send rejects with the reason, deletes the pending entry, clears its timer, and a later reply for that id changes nothing.
  3. `frame.send(method, params, { signal })`, `frame.evaluate(expression, { signal })`, and `frame.handle(expression, { signal })` each forward the signal (assert the rejection reason on the transport); `evaluate(expression, { timeout })` keeps the timeout behavior.
  4. `fail(id, message, -32601)` produces a `CDPError` whose `context.code` is `-32601`.
  5. `isBrowserConnectionError` is exported from `@src/core` and not from `@src/server`; `npm run test:src` exits 0.

### U2 `events`

This unit makes both navigation kinds and frame sessions observable and deletes the predicate poll.

- **Engine:** `builder`.
- **Owns:** `src/core/BrowserPage.ts`, `src/core/BrowserNavigationManager.ts`, `src/core/types.ts` (the `navigate` payload, `session` event, `BrowserWaitUntil` `'idle'`, `idle` member; `until` deleted), `src/core/compilers.ts` (the function-wait compiler deleted), `src/core/helpers.ts` (`readBrowserFrames` unioned with attached iframe targets), their mirrored tests.
- **Depends on:** U1.
- **Acceptance:**
  1. `Page.frameNavigated` for the page frame emits `navigate` `[url, false]`; `Page.navigatedWithinDocument` updates `page.url` and emits `[url, true]`, outside a navigation wait too; a child frame's event emits nothing.
  2. `Target.attachedToTarget` with `type: 'iframe'` emits `session` after `Page.enable` and `Runtime.enable` succeed; that frame's `send` carries the attached `sessionId`; `frames()` lists it beside the frame tree's frames, and lists it no longer after `Target.detachedFromTarget`.
  3. `Page.setLifecycleEventsEnabled` is sent at attach; a scripted `networkIdle` for the current loader resolves `idle()` and `navigate(url, { condition: 'idle' })`, and one for a stale loader does not.
  4. `navigation.wait(pattern, { signal })` resolves on a same-document navigation and rejects with the reason on abort.
  5. A Grep of `src` for `\.until\(|compileFunctionWaitExpression` matches nothing.

### U3 `reading`

This unit adds the reading value and the markdown edge.

- **Engine:** `opus`.
- **Owns:** `package.json` (`@orkestrel/markdown`), `package-lock.json`, `src/core/types.ts` (reading contracts; `BrowserContentResult` deleted), `src/core/BrowserReading.ts`, `src/core/BrowserFrame.ts` (`read`, the epoch; `content` and `article` deleted), `src/core/BrowserPage.ts` (epoch increments on both navigation kinds), `src/core/compilers.ts` (`compileReadFunction`), `src/core/helpers.ts` (`extractBrowserSlice`), `src/core/factories.ts` (`createBrowserReading`), `src/core/index.ts`, `tests/src/core/BrowserReading.test.ts`, `tests/src/core/BrowserFrame.test.ts`, `tests/src/core/helpers.test.ts`.
- **Depends on:** U2.
- **Acceptance:**
  1. `markdown()` of a fixture with `nav`, `main`, and `footer` keeps the paragraph and drops nav and footer (P7), and `distill: false` keeps them.
  2. For a 10 000-character document and `limit` 4 000, successive slices following `offset + text.length` concatenate to the whole Markdown, each `text.length` is at most 4 000, each cut lands on a line break when one exists, and `total` is constant.
  3. Two slices of one reading issue no second `Runtime.evaluate` (assert on the transport), and `reading.html` is one handle across them.
  4. `stale` flips on a scripted `Page.frameNavigated` and on a scripted `Page.navigatedWithinDocument` for the frame, and not for a sibling frame.
  5. An oversized capture rejects with `BrowserResultLimitError` before parsing.
  6. `read({ signal })` with an aborted signal rejects with its reason.
  7. `npm ci` reproduces the lockfile; `npm run test:src:core` exits 0.

### U4 `elements`

This unit builds the element manager over the accessibility tree and trusted input.

- **Engine:** `astra`, with an objective `reviewer`.
- **Owns:** `src/core/types.ts` (the element and view contracts), `src/core/elements/BrowserElement.ts`, `src/core/elements/BrowserElementManager.ts`, `src/core/BrowserContext.ts` (the reference counter), `src/core/helpers.ts` (`renderBrowserOutline`, `filterBrowserOutline`, `normalizeBrowserName`, `normalizeBrowserKey`, `composeBrowserPoint`), `src/core/parsers.ts` (`parseBrowserReference`), `src/core/compilers.ts` (`compileTextWaitExpression`, `compileQueryWaitExpression`, `compileSelectFunction`, `compileHitFunction`; `compileActionabilityFunction` kept), `src/core/constants.ts` (`BROWSER_REFERENCE_PREFIX`, `BROWSER_OUTLINE_LIMIT`, `BROWSER_OUTLINE_OMITTED_ROLES`, `BROWSER_TEXT_ROLES`), `src/core/errors.ts` (`BrowserElementError`, `isBrowserElementError`), `src/core/BrowserPage.ts` (`elements`, `wait`, `trusted`, `keyboard`, `mouse`, `touch`, the world cache), `src/core/BrowserFrame.ts` (the world cache), `src/core/index.ts`, `tests/src/core/elements/*.test.ts`, `tests/setup.ts` (scripted accessibility replies for the P8 page with one `Iframe` node).
- **Depends on:** U2, U3.
- **Acceptance:**
  1. `parseBrowserReference` returns `e12` for the six spellings and `undefined` for `x12`, `e0`, `e-1`, and `''`.
  2. The outline renders the format under "Result formats" from a scripted tree in document order, omits ignored, `none`, `generic`, and `InlineTextBox` rows, does not repeat a `StaticText` equal to its parent's name, trims names, and reports `count` and `total` when `limit` cuts.
  3. Keys read `SESSION:BACKEND`; an `Iframe` row triggers `Accessibility.getFullAXTree` with that `frameId` on the session a preceding `session` event bound; a click on that frame's node sends `DOM.getContentQuads` on the frame session and `Input.dispatchMouseEvent` on the page session at the quad center plus the iframe's rectangle (P19).
  4. Two `outline` calls give one node the same reference; after a main-frame `navigate` `[false]`, `element('e1')` is `undefined`, `click` through a stale element rejects `GONE` naming `look`, and the next outline numbers from the previous maximum plus 1; a second page of the same context numbers past the first page's maximum; a child frame's `Page.frameNavigated` on the page session drops that frame's references and no other.
  5. `click` sends, in order, `DOM.scrollIntoViewIfNeeded`, the actionability evaluation, `DOM.getContentQuads`, `DOM.getNodeForLocation`, then `mousePressed` and `mouseReleased`; an empty quad list rejects `HIDDEN`; a hit on another node rejects `OCCLUDED`; a `DOM.resolveNode` failure rejects `GONE`; a signal aborted after `mousePressed` was sent still sends `mouseReleased` and then rejects with the reason.
  6. `fill` sends `DOM.focus`, the selection function, and `Input.insertText`; `press('Enter')` sends a `keyDown` and `keyUp` pair; `normalizeBrowserKey` maps `enter`, `Return`, and `ENTER` to `Enter`, `esc` to `Escape`, and `ctrl+a` to `Control+a`, and an unknown key throws a message listing the accepted names.
  7. `find({ role: 'button', name: 'sav' })` matches `Save`; `find({ css })` sends `DOM.querySelectorAll` then `DOM.describeNode`.
  8. `page.wait(text)` resolves when the evaluation resolves `true`, re-sends after a scripted `Execution context was destroyed` followed by `DOMContentLoaded`, rejects `BROWSER_WAIT_TIMEOUT` when the evaluation resolves `false`, and sends the disconnect evaluation on abort; `compileTextWaitExpression` and `compileQueryWaitExpression` contain no `setInterval` and one `setTimeout` each, whose delay is the deadline argument (Grep and a parse of the compiled string in the test).
  9. Exactly one `Page.createIsolatedWorld` per document; another after `Runtime.executionContextsCleared`; every element evaluation carries that `contextId`.
  10. `outline` waits for a `DOMContentLoaded` lifecycle event for the current loader; the test emits it 20 ms after the call and asserts no evaluation was sent before it. A `Page.frameNavigated` of type `BackForwardCacheRestore` marks the document ready at once, because a restore emits no lifecycle event (P25).
  11. `npm run test:src:core` exits 0.

### U5 `removal`

This unit deletes the locator stack, retargets codegen, and applies the lifecycle renames.

- **Engine:** `builder`.
- **Owns:** deletion of `src/core/BrowserLocator.ts`, `src/core/BrowserSelectorManager.ts`, and their tests; `src/core/compilers.ts` (locator, CSS, click, fill, and select compilers deleted; `compileCodegenScript` emits `elements.find({ css })` plus the element action), `src/core/constants.ts`, `src/core/helpers.ts`, `src/core/parsers.ts` deletions per "What goes"; `src/core/types.ts` (locator, selector, and action types deleted; `mask` takes elements; `BrowserDownload.abort` and its status and event; `BrowserFileChooser.dismiss`); `src/core/BrowserFrame.ts`, `src/core/BrowserDownload.ts`, `src/core/BrowserFileChooser.ts`, `src/core/errors.ts`, `src/core/index.ts`; the affected `tests/src/core/*.test.ts`; `tests/service/browser.test.ts` (locator cases rewritten to elements; the codegen replay case asserts the retargeted script runs).
- **Depends on:** U4.
- **Acceptance:**
  1. A Grep of `src` for `BrowserLocator|BrowserSelector|compileLocator|compileClick|compileFill|compileSelectWait|\.article\(|\.content\(|\.cancel\(|'cancelled'|BROWSER_WAIT_POLL_INTERVAL_MS|BROWSER_TEST_ID_ATTRIBUTE|BROWSER_VISIBILITY_SOURCE` matches nothing; a Grep for `setInterval` matches nothing.
  2. `compileCodegenScript` output for a recorded `click` on `#save` contains `elements.find({ css: "#save" })` and `.click()`, and the `tests/service/browser.test.ts` replay case runs it against the fixture.
  3. `BrowserDownload.abort` sends `Browser.cancelDownload`; `BrowserFileChooser.dismiss` sends `DOM.setFileInputFiles` with an empty list as the current `cancel` does (`src/core/BrowserFileChooser.ts:41-52`).
  4. `npm run check`, `npm run test:src`, and `npm run test:guides` exit 0 with the guide's deleted rows removed.

### U6 `registry`

This unit mirrors the `WebMCP` domain.

- **Engine:** `astra`.
- **Owns:** `src/core/types.ts` (registry contracts), `src/core/BrowserRegistry.ts`, `src/core/parsers.ts` (`parseBrowserTool`, `parseBrowserRemoval`, `parseBrowserInvocation`, `parseBrowserInvocationResult`), `src/core/helpers.ts` (`renderBrowserToolOutput`, `deriveBrowserToolSchema`), `src/core/constants.ts` (`BROWSER_REGISTRY_ABSENT_CODE`), `src/core/BrowserPage.ts` (`registry`), `src/core/index.ts`, `tests/src/core/BrowserRegistry.test.ts`, `tests/setupServer.ts` (a `WebMCP` script on `CDPTestServer` that writes the `invokeTool` response and `toolResponded` in one socket write), `tests/src/server/integration.test.ts`.
- **Depends on:** U2.
- **Acceptance:**
  1. A `-32601` failure on `WebMCP.enable` resolves `start()` `false` and leaves no `WebMCP.*` subscription (a later `toolsAdded` changes nothing); any other failure rethrows.
  2. `toolsAdded` emitted in the same `onSend` handler as the enable reply is mirrored.
  3. `toolsAdded` then `toolsRemoved` emit `change` twice and update `tools()`; a child `Page.frameNavigated` removes that frame's entries; `tool(name, frame)` returns a shadowed child-frame tool.
  4. `execute` resolves on the matching `toolResponded` only, including one delivered before the `invokeTool` continuation; `Completed`, `Error`, and `Canceled` each resolve a `BrowserInvocationResult` carrying that status; a frame detachment, `destroy`, and the timeout reject.
  5. A `toolResponded` with an unknown id arriving while no `invokeTool` reply is pending is dropped: after 1 000 such events during one long-running invocation, the registry's held responses count 0 (assert through a `respond` listener and the settlement of the long invocation).
  6. An abort before the reply sends `WebMCP.cancelInvocation` with the id after the reply and rejects with the reason; an abort after the reply sends it immediately; `invokeTool` is never sent with the signal.
  7. `adopt()` maps `readOnly` to `pure`, `consequential` to `consequential`, and marks every tool `untrusted` even when the wire hint is `false`; a tool with no `inputSchema` and one whose schema requires nothing each advertise a required `what`, and their invocation input carries no `what`; a schema with an optional `what` is not adopted; `renderBrowserToolOutput` renders a string, a content array, and a record; a 1 MB `errorText` throws a message of at most the bound.
  8. `destroy()` sends `WebMCP.disable` on every enabled session and rejects in-flight invocations.
  9. Over the `CDPTestServer` WebSocket, the one-write burst settles `execute`.

### U7 `toolset`

This unit publishes the vocabulary and adds the tool edge.

- **Engine:** `opus`, with an objective `reviewer`.
- **Owns:** `package.json` (`@orkestrel/tool`), `package-lock.json`, `src/core/types.ts` (toolset contracts, `BrowserToolSourceInterface`), `src/core/BrowserToolset.ts`, `src/core/constants.ts` (`BROWSER_TOOL_LIMIT`, `BROWSER_TOOL_COPY`, `BROWSER_TOOL_NAMES`, `BROWSER_TOOL_NAME_PATTERN`, `BROWSER_SCHEMES`), `src/core/helpers.ts` (`renderBrowserReceipt`, `boundBrowserText`), `src/core/factories.ts` (`createBrowserToolset`), `src/core/index.ts`, `tests/src/core/BrowserToolset.test.ts`.
- **Depends on:** U4, U5, U6.
- **Acceptance:**
  1. The CDP toolset lists exactly `look`, `read`, `click`, `type`, `press`, `navigate`, and `wait`; `native` holds those seven; every tool declares at least one required parameter; `look` and `read` annotate `pure` and `untrusted`, `wait` annotates `pure`, and the rest carry none; every description is at most 100 characters.
  2. `start()` against a manager already holding a foreign `dialog` or `read` rejects with a coded `BrowserError` and adds nothing.
  3. A scripted `Page.javascriptDialogOpening` during a click, during a `type` on a `<select>` (the `Runtime.callFunctionOn` reply withheld), during a `wait`, and during a `navigate` load each return the receipt naming the dialog within 100 ms of the event, add `dialog`, and refuse every other tool while it is open; `dialog` runs while the click's `mouseReleased` reply is still withheld; handling removes `dialog`; the withheld reply then settles the original command without a second receipt.
  4. The `context` option adds `tabs` and `switch`; a `popup` moves the cursor and the receipt names its URL; the popup's `close` returns the cursor; a `read` at a positive offset after a cursor move recaptures from 0.
  5. A page tool named `click`, one named like a tool the consumer added, one named `a.b`, one whose schema declares `what` optional, and one marked `debugging` each emit `skip` and are not added; the rest are added; the consumer then adds `search` under an adopted name, and after `destroy` the consumer's `search` instance is still registered while every other adopted name is gone.
  6. A `change` whose `adopt()` settles after `destroy`, and a `change` whose `adopt()` settles after a newer `change`, add nothing.
  7. Two `execute` calls issued together through `createToolManager().execute([a, b])` produce `mousePressed`-A, `mouseReleased`-A, `mousePressed`-B, `mouseReleased`-B; a queued call whose signal aborts sends nothing; a call whose signal aborts after its `mousePressed` still sends `mouseReleased`, and the next queued action's `mousePressed` follows that release.
  8. `navigate('file:///etc/hosts')` rejects without sending `Page.navigate`; `navigate` waits for `load` and returns the view.
  9. A click followed by a scripted `Page.frameRequestedNavigation` and no commit within the bound returns `the page did not change`; one followed by a commit and no `load` within the bound returns `still loading`; the bound is asserted with `performance.now()` at under 6 s.
  10. Every text result and every error message is at most `limit` characters plus its footer, for a view over the limit, a Markdown slice, a page tool output of 1 MB, a page tool `errorText` of 1 MB, a dialog message of 1 MB, and a tab title of 1 MB; a second `read` with `offset` reuses the retained reading while its key matches and is not stale, and resets to 0 when it is stale or the `ref` differs.
  11. `ToolContext.signal` abort reaches the CDP command (assert the rejection reason on the transport).
  12. A tool called after `destroy` fails with `the browser session ended`.

### U8 `launch`

This unit replaces the HTTP readiness poll with the stderr line.

- **Engine:** `builder`.
- **Owns:** `src/server/helpers.ts` (`readBrowserEndpoint`; `waitForCDPReady` deleted), `src/server/Browser.ts` (launch readiness from stderr; `--remote-debugging-port=0` when no port is given; the hand-off read of the inherited pipe; the drain's `@remarks`), `src/server/constants.ts` (`BROWSER_DEVTOOLS_PATTERN`, `BROWSER_DRAIN_INTERVAL_MS`), `src/server/types.ts`, `src/server/index.ts`, `tests/src/server/helpers.test.ts`, `tests/src/server/Browser.test.ts`, `tests/setupServer.ts` (`createFakeBrowserProcess` prints the endpoint line; the launcher fixture re-executes with the inherited stderr).
- **Depends on:** nothing.
- **Acceptance:**
  1. A launch against the fake process resolves with no `GET /json/version` recorded during launch; a line split across two chunks and one ending `\r\n` both resolve; an explicit `port` is passed through and the line still carries it.
  2. A nonzero exit before the line rejects with the coded launch-exit error; an abort rejects with the reason.
  3. The launcher fixture (exit 0 before readiness, the re-executed process printing the line on the inherited pipe) connects and owns the serving process; a launcher fixture whose re-executed process closes the pipe without the line rejects with the readiness failure before `timeout`.
  4. A fixture writing 1 MB to stderr after readiness still answers `Browser.getVersion`.
  5. A Grep of `src` for `BROWSER_WAIT_POLL_INTERVAL_MS` matches nothing, and the only `setTimeout` loop under `src` is the drain in `src/server/Browser.ts`.

### U9 `environment`

This unit scaffolds the browser face.

- **Engine:** `builder`.
- **Owns:** `package.json` (`exports['./browser']`, scripts `check:src:browser`, `build:src:browser`, `test:src:browser`, `test:src`, `devDependencies` per D2 and D3), `package-lock.json`, `configs/src/tsconfig.browser.json`, `configs/src/vite.browser.config.ts`, `tsconfig.json` (the `@src/browser` alias), `vite.config.ts`, `tests/setupBrowser.ts`, `tests/setupGlobal.ts`, `src/browser/index.ts`, `src/browser/types.ts`, `src/browser/constants.ts`, `src/browser/helpers.ts`, `src/browser/factories.ts`, `tests/src/browser/types.test.ts` (the promoted type probe under D3, mirroring `src/browser/types.ts`).
- **Depends on:** U7.
- **Acceptance:**
  1. `npm run test:config` exits 0 with `lib` `["ESNext","DOM","DOM.Iterable"]` for the face.
  2. `npm run check:src:browser` exits 0; `npm run test:src:browser` collects `tests/src/browser/helpers.test.ts` and `tests/src/browser/types.test.ts` and passes, the latter with its `@ts-expect-error` control.
  3. `npm run build` emits `dist/src/browser/index.js` and `index.d.ts`.

### U10 `document`

This unit implements the DOM-native view and the browser-face transport.

- **Engine:** `opus`.
- **Owns:** `src/browser/types.ts`, `src/browser/constants.ts` (`BROWSER_IMPLICIT_ROLES`, `BROWSER_CONTENT_NAMED_ROLES`), `src/browser/helpers.ts` (`computeBrowserRole`, `computeBrowserName`), `src/browser/BrowserDOMView.ts`, `src/browser/elements/BrowserDOMElement.ts`, `src/browser/elements/BrowserDOMElementManager.ts`, `src/browser/transports/SocketCDPTransport.ts`, `src/browser/factories.ts` (`createBrowserDOMView`, `createDocumentToolset`, `createSocketCDPTransport`), `src/browser/index.ts`, `tests/src/browser/**`, `tests/setupBrowser.ts` (`createProbeElements` builds the P7 and P8 page inside a same-origin `iframe` the test owns), `tests/fixtures/modelContext.ts` (this package's IDL-faithful double of `document.modelContext`, member for member from the vendored `index.bs`, with the header exemption mcp's carries; placed as mcp places its own, and copied because mcp ships no test surface, `../mcp/package.json:22-25`, so consolidation into `@orkestrel/test` is a fleet unit), `tests/setupGlobal.ts` (a Chromium launched through this package's `createBrowser` with `--remote-allow-origins=*`, its endpoint passed through `provide`).
- **Depends on:** U9.
- **Acceptance:**
  1. `createDocumentToolset({ document: globalThis.document })` rejects unless `own` is `true`; the tests drive the iframe's document.
  2. The outline contains `button "Save"`, `textbox "Email"`, and `link "One"`, and omits elements with `hidden`, `aria-hidden="true"`, or `display: none`; a `srcdoc` iframe's button appears; a cross-origin iframe row reads `(cross-origin, not readable)`.
  3. `click` toggles a checkbox and a listener records `isTrusted === false`; the receipt ends `(untrusted event)`; a disabled button, a `target="_blank"` link, and a contenteditable `type` are refused with the reason named; `fill` fires an `input` event a prototype-setter listener observes; `submit` on a valid form fires one `submit` event, and on a form with an empty `required` field fires none and reports `did not submit` with the field's `validationMessage`.
  4. The DOM toolset lists exactly `look`, `read`, `click`, `type`, and `wait`; a removed element yields `GONE`; `wait` resolves within 100 ms of an element appended 30 ms later (`performance.now()`), with no timer beyond the deadline (Grep).
  5. `createDocumentToolset({ source })` adds the source's tools and re-adopts on its `change`; `native` excludes them; publishing `native` through an IDL-faithful registry double leaves the double's own registrations untouched.
  6. A `pushState` in the driven document marks its reading stale on a browser with the Navigation API (the provider's Chromium).
  7. A `CDPClient` over `SocketCDPTransport` receives `Browser.getVersion` `product`; a remote close emits `close` and the client reports `drop`; `send` before `start` throws a coded `BrowserConnectionError` carrying `url`; the control, a second browser launched without the flag, makes `start` reject.

### U11 `proofs`

This unit promotes the probes into service proofs.

- **Engine:** `opus`, with an objective `reviewer`.
- **Owns:** `tests/service/toolset.test.ts`, `tests/service/browser.test.ts`, `tests/service/document.test.ts`, `tests/setupService.ts`, `tests/setupServer.ts` (fixture pages: form, out-of-process pair on `127.0.0.1` and `localhost` with a decoy under the frame-local point, overlay, confirm, `beforeunload`, popup, late text, long article, the served `dist/src/browser` page).
- **Depends on:** U7, U8; U10 for the document case.
- **Acceptance:**
  1. `npm run test:service` exits 0 on the host Chromium and collects: one toolset task end to end through `createToolManager().execute`; an out-of-process frame click whose receiving node is asserted in the frame's document while the decoy under the raw point stays unclicked (P19); an overlay-covered click refused `OCCLUDED` (P11); `confirm()` during a click staging `dialog` (P14); a `beforeunload` link click whose receipt names the dialog and whose accepted dialog commits the navigation (P20); a popup cursor move and return; `read` distilled against whole, and paging; `wait` for text inserted 200 ms later resolving within 300 ms of the insertion; `navigate` clearing references; a same-document route marking a reading stale (P16); `registry.start()` equal to `Schema.getDomains` containing `WebMCP` (P15); the served DOM page's interactive `(role, name)` set equal to the CDP outline's; a codegen recording replayed through its retargeted script.
  2. The live `WebMCP` case is a conditional skip whose reason cites the `-32601` reading (`../scaffold/.claude/rules/tests.md:39`).
  3. Each promoted P-case keeps its control.

### U12 `guide`

This unit rewrites the guide for the three faces.

- **Engine:** `opus`.
- **Owns:** `guides/browser.md` (the scope header at `guides/browser.md:1852`; Surface for three faces; Methods tables for every behavioral interface; Contract rewritten: invariants 2, 5, 6, 7, 8, 9, 10, and 13 for the changes, plus the reference, reading, registry, serialization, dialog, trusted-input, reserved-name, own-document, `alert()`, `debugging`, and `WebMCP` host invariants and limits; a "Relation to WebMCP" section with the adapter table; a "Declared conformance gaps" section recording the three mirror revisions and digests and naming each excluded row and its closer, in the shape of mcp's gaps entries (`../mcp/guides/mcp.md:4932`); Patterns "Drive a page with a small model" with the system prompt, "Host the toolset over MCP", and "Publish native tools to a page"), `README.md`, `tests/guides.test.ts`, `PROPOSAL.md` (deleted, with this ruling in the commit).
- **Depends on:** U11, U17.
- **Acceptance:**
  1. `npm run test:guides` exits 0; every fence imports `@orkestrel/browser`, `@orkestrel/browser/browser`, or `@orkestrel/browser/server`.
  2. Invariant 2 names `markdown` and `tool`; invariant 5 names `readBrowserEndpoint` and not `waitForCDPReady`; invariant 6 names the retained codegen emitter and the added page events; invariant 9 describes the retargeted script; invariant 13 describes the inherited-pipe hand-off; a Grep of the guide for `waitForCDPReady|BrowserLocator|BrowserSelector|\.until\(|\.cancel\(` matches nothing.
  3. The flagship fence driving `createBrowserToolset` is transcribed and asserted.
  4. A Grep of the guide for each of the three mirror revision tokens matches.

### U13 `gates`

This unit reads the gates bare.

- **Engine:** `verifier`.
- **Owns:** nothing.
- **Depends on:** U12.
- **Acceptance:** `npm run format:check`, `npm run lint:check`, `npm run check`, `npm run build`, `npm test` (which runs `test:conformance`), `npm run test:distribution -- --mode release`, and `npm run test:service` exit 0, each run bare; a Grep of `src` for `setInterval` matches nothing, and the only condition-testing `setTimeout` loop is the process-group drain.

### U14 `consumer`

This unit re-pins the consumer.

- **Engine:** `builder`, in `/home/user/orkestrel/ollama`.
- **Owns:** `package.json` (`@orkestrel/browser` `^0.0.19`), `package-lock.json`, `tests/setupServer.ts` (both `evaluate` sites and the TSDoc at `:1088-1089`, `:1167-1174`, `:1208-1213`), `tests/setupServer.test.ts` (the stub and its assertion), `tests/service/page.test.ts` (four `evaluate` sites), `guides/browser.md` (refreshed from the 0.0.19 guide).
- **Depends on:** U13 and the published or packed 0.0.19.
- **Acceptance:** `npm run check` exits 0; a Grep of the checkout for `evaluate\([^)]*, [A-Z_.]+\)` matches nothing; `npm test` and `npm run test:service -- tests/service/page.test.ts` pass; the guide mirror is byte-identical to this package's guide.

### U15 `model`

This unit proves the vocabulary with the real model.

- **Engine:** the Orchestrator, in `/home/user/orkestrel/ollama`.
- **Owns:** `tests/service/browser.test.ts` there (a conditional skip when the daemon or the model is absent, citing the mechanism), and `tmp/probes/` for the runs.
- **Depends on:** U14.
- **Acceptance:** with `qwen3.5:2b-q4_K_M` at temperature 0 against the store fixture through `createBrowserToolset` and `@orkestrel/agent`, every task reads its ground truth from the page and never from the model's words: the read task's fact sits outside the seeded first-turn view and a `read` or `look` result in the transcript contains it; the click task asserts the cart holds the named product and no other; the search task asserts the submitted query and the matching product identities; each passes on the first attempt within 8 tool calls, at least 1 of which is a tool call; no call carries a reference the view did not list; no result exceeds 4 000 characters plus its footer. A form task with a confirmation code shown 200 ms after submit and a paging task whose token sits past the first 4 000 characters pass within 3 attempts with the same oracles. The WebMCP task is recorded as a limit.

### U16 `review`

This unit is the campaign's one review pass.

- **Engine:** `reviewer`, one pass over the integrated graph.
- **Owns:** nothing.
- **Depends on:** U14, U15.
- **Acceptance:** every required finding resolved and the affected gates rerun green.

### U17 `conformance`

This unit pins the package's alignment with WebMCP against vendored, revision-named mirrors.

- **Engine:** `astra`, with an objective `reviewer`.
- **Owns:** `tests/conformance.test.ts`, `tests/setupConformance.ts` and `tests/setupConformance.test.ts` (the mirror readers, their digest constants and byte offsets, and the ruled row tables), `tests/mirrors/webmcp-index-REVISION.bs` (`index.bs` whole), `tests/mirrors/webmcp-webref-REVISION.idl` (`interfaces/webmcp.idl` whole), `tests/mirrors/webmcp-domain-REVISION.json` (the `WebMCP` domain cut by raw byte range from `browser_protocol.json`), where each `REVISION` is the upstream commit; `tests/src/browser/factories.test.ts` (the composition cases, the mirror of `src/browser/factories.ts`); `vite.config.ts` and `package.json` (the `conformance` project and `test:conformance`, chained into `npm test`); `src/browser/elements/BrowserDOMElementManager.ts` and `src/core/elements/BrowserElementManager.ts` (the `[tool=NAME]` marks, edited after U4 and U10 are accepted).
- **Depends on:** U6, U10; it runs after U10 and before U12.
- **Acceptance:**
  1. `npm run test:conformance` exits 0 in Node with the browser disabled, and `npm test` runs it; `tests/setupConformance.test.ts` proves the exported mirror reader throws on a digest mismatch against a scratch copy with one changed byte and returns the pinned bytes on a match, and the setup module pins each mirror through that reader at its top level.
  2. Domain rows, each ruled implement, retain, or exclude in a table the test reads: every property of the mirror's `Tool`, `Annotation`, and `RemovedTool` types and every value of `InvocationStatus` is one name `parseBrowserTool`, `parseBrowserRemoval`, or `parseBrowserInvocationResult` reads or one excluded row, with `stackTrace` excluded as a developer datum and its closer named; the parsers name nothing the mirror lacks; the four command names the registry sends and the four event names it subscribes exist in the mirror; the `invokeTool` return `invocationId`'s description still states the response precedes tool events; the `toolResponded.output` description still names it untrusted.
  3. Source rows over `index.bs`: the `ModelContext` block declares `registerTool`, `getTools`, `executeTool`, `ontoolchange`, `ontoolactivated`, and `ontoolcancel`; `ToolAnnotations` declares `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging`; `executeTool` returns `Promise<DOMString>`; the name-validation paragraph reads 1 to 128 code points, inclusive, of ASCII alphanumerics, `_`, `-`, and `.`; the metadata block names the test suite. Webref rows over `interfaces/webmcp.idl`: its `ModelContext` block declares `ontoolchange` alone and its `ToolAnnotations` three hints, recorded as the lag row; and this package's double declares every member webref's `ModelContext` block names. Each row is ruled implement, retain, or exclude, and every exclusion names its closer.
  4. Mapping rows: `readOnly` to `pure`, `consequential` to `consequential`, and `untrusted` always `true` are asserted from `registry.adopt()` on a mirror-shaped tool; the `debugging` skip and the name skip are asserted from `BrowserToolset`'s `skip` (U7 acceptance 5), where a name with a period or longer than 64 code points is skipped and the declared gap names the charset and the 64 bound against the specification's 128; `autosubmit` is retained on `BrowserToolAnnotation` and marked nowhere; `backendNodeId` is proven by row 6.
  5. Composition rows in `tests/src/browser/factories.test.ts` under the Playwright provider: `createModelContext` from the installed `@orkestrel/mcp` over this package's double, publishing `toolset.native` from `createDocumentToolset`, registers exactly the five generic descriptors the DOM placement advertises (`look`, `read`, `click`, `type`, `wait`) with the projected hints and touches no registration the double already held; a page tool the double registers with `readOnlyHint` true and no `untrustedContentHint` is adopted with `untrusted` true and `pure` true; a `toolchange` from the double re-adopts; a `describe.runIf(isWebMCPDocument(document))` block holds the same cases against a real registry, and the absence path asserts `bridge !== undefined` equals `'modelContext' in document` and that `'modelContext' in navigator` is `false`, so a registry at either location reddens rather than skipping.
  6. The DOM outline marks a form carrying `toolname="search-cars"` as `e5 form "Search cars" [tool=search-cars]`, and the CDP outline marks a form whose registered tool carries its `backendNodeId` the same way.
  7. A Grep of `src` for `WebMCP|ModelContext` in an exported name matches nothing.
  8. A declared-gap row records that web-platform-tests' `webmcp/imperative/` and `webmcp/declarative/` cases do not run against the double, with the testharness runner named as the closer.

### Exit criterion

The campaign closes when every unit's acceptance holds, the gates in U13 are green on this host, the ollama page proof is green on `^0.0.19`, the real-model criteria in U15 are met and recorded with their logs, the conformance rows in U17 are green against mirrors whose revisions the guide names, and the guide's Contract lists the `WebMCP` live proof as a limit naming its host.

## Limits and risks

The following readings are missing, each with what settles it.

- `document.modelContext` against `navigator.modelContext` in a shipping Chrome: `'modelContext' in document` and `in navigator` on Chrome 149 with the origin-trial token.
- The runtime type of `WebMCP.toolResponded.output`, and the code `WebMCP.enable` returns on a Chrome that ships the domain behind `--enable-features=WebMCP` without the flag: one `invokeTool` on Chrome 150 against a tool returning a string and one returning `{ content: [...] }`, and one `enable` without the flag.
- `chrome.debugger` as a transport: whether it carries flattened `sessionId` routing without `@types/chrome`.
- The stderr pipe through Microsoft Edge's Windows launcher re-exec: a launch on a Windows host with Edge.
- The DOM role and name computation against Chromium's: U11's comparison asserts the interactive set, not exact text.
- A `pushState` in the DOM placement on a browser without the Navigation API: no event marks the reading stale.
- The `debugging` flag, `toolactivated`, and `toolcancel` in the DOM placement: mcp 0.0.33's bridge does not carry them; declared conformance gaps until mcp refreshes its bridge.
- The specification's registry location (`Document` in the draft, `Navigator` in the Chrome intent) and `executeTool`'s result shape: settled by a shipping Chrome, and pinned by the mirror revision until then.
- A page tool whose name carries a period or exceeds 64 code points is skipped; the declared gap names the charset and the bound against the specification's 128. The provider documents behind `BROWSER_TOOL_NAME_PATTERN` were not read in this campaign; U7 reads them, cites them in the constant's TSDoc, and may widen the bound.
- Web-platform-tests' `webmcp/` cases against this package's double: a testharness runner under the Playwright provider.

The following risks are carried with their outcomes.

- A page registers a tool named like a generic tool or a consumer's tool: skipped, `skip` emitted.
- A page-authored description in the tool list is prompt injection: advertised under `untrusted`; outputs are `untrusted` regardless of the page's hint; every page-authored string is bounded.
- A model invents a reference: refused with the next call named; costs one turn.
- A page overrides `Element.prototype.outerHTML` or `innerText`: the element manager and reader evaluate in an isolated world; `page.evaluate` stays in the main world, a limit the guide states.
- A DOM-placement click opens `alert()`: the driven document's thread blocks; recorded.
- A DOM toolset drives its own realm and an action navigates it: the call never returns; the factory refuses that topology unless the consumer opts in.
- The context window at an unknown `num_ctx`: bounds are options and the run records prompt tokens per turn.
- html's parser is not an HTML5 tree builder, distill heuristics can drop wanted content, and Markdown loses tables and forms.
- Removing the locator stack breaks programmatic consumers outside the fleet; the one known consumer is re-pinned.

## Routing ledger

The following list records which bench produced what; `.orkestrel/browser/ledger.md` holds every dispatch with its timing and journal.

- Cursor Grok 4.7: absorbed this package (269 lines, 740 citations resolved) and the prior proposal and sibling contracts (360 lines, 275 citations); dark for network under `--mode=ask`.
- Native `researcher`: the WebMCP specification, Chrome intents, the protocol domain, and the shipped servers' vocabularies.
- Two blind design lanes on Opus 5.5 (subjective and objective, Astra dark at dispatch): reconciled here; every tension ruled under "Rulings".
- Probes: 20 runtime cases and 1 type case by the Orchestrator; 4 real-model runs through `@orkestrel/agent` and `@orkestrel/ollama`.
- Falsify round: the Opus `reviewer` (subjective lane) and the GPT-6 Astra `analyst` (objective lane) over 20 numbered claims; both lanes' findings are reproduced, ruled, and carried into the units; the two unresolved claims are settled by P18 and P19.
- WebMCP alignment read (after the owner's ruling of 2026-09-29): three blind readers over mcp's bridge and tests, the WebMCP surface, and the fleet's fixture and conformance rules, followed by one adversarial verify pass (three blind refuters: spec accuracy, fleet rules, coherence) over the "Relation to WebMCP" section and U17; every blocking and required finding was reproduced and ruled into this text, and the record is `.orkestrel/browser/webmcp-alignment-verdict.md`.
