# Unit browser-design — Redesign `@orkestrel/browser` as the agent's browser

Fill nothing; this brief is complete. Read every section before proposing.

## Role and engine

`planner` on Opus 5.5, reached as the Agent tool. Executor: NATIVE_SUBAGENT. Two lanes read this
brief in clean contexts and never see each other's answer: the subjective lane (shape, naming,
ergonomics, design fit) and the objective lane (correctness, constraints, what the contracts and
the protocol permit). The Codex Astra bench is dark this session (`codex login status`: "Not logged
in", recorded in `tmp/units/ledger.md`), so Opus holds the objective lane too. The dispatch
message names the lane you hold.

## Objective

Propose one coherent design that turns `@orkestrel/browser` into the browser an agent drives from
outside (a Node process over the Chrome DevTools Protocol) and from inside (a page, a worker, or an
extension over the platform's own APIs), with one tool vocabulary in both placements, the page's
own WebMCP tools reachable in both placements, event-driven waiting, bounded reading, and clean
breaks. Cut it into bounded units with acceptance criteria and an exit criterion.

## The owner's words

From the instruction of 2026-09-29, verbatim:

> For browser, my idea is to still be able to access and drive through cdp, i want to stay away
> from pulling in binaries like playwright does, I want us to push environment agnosticism, but for
> the stuff in the browser i want to also push native browser stuff as much as possible so that the
> agent has full clean control of the browser and can go through it like it knows it like the back
> of its hand. This really came up because of webmcp and I want our browser to be a better version
> of that whether the agent is within or outside the browser, making calls with native browser
> tools and tools outside the browser.

> For the most part, nothing is sacred, breaking changes are allowed but no deprecation/aliases/
> wrappers should ever be used, we refactor consumers and make clean breaks without remorse, we
> need to make the changes we need to but they strictly need to follow our rules and conventions.

The standing `PROPOSAL.md` at the checkout root ("the reading arm": hold the page's HTML as a
parsed tree, bound what it hands back, offer a Markdown projection) is the reading half of this
goal and is superseded by this round; read its owner quote and its eight questions as input.

## Context

- **Evidence.** Read these first; each is cited to `file:line` where it reports source.
  - `tmp/units/browser-map.txt` — tree with line counts and the guide's headings.
  - `tmp/units/browser-exports.txt` — every export line of `src/core` and `src/server`.
  - `tmp/cursor/browser-absorb-answer.md` — Grok 4.7 distillate of the current package: entity
    map, polling census, worlds and bindings, content path, navigation and invalidation, server
    lifecycle, test infrastructure, surface counts, the guide's fourteen Contract invariants.
  - `tmp/cursor/prior-absorb-answer.md` — Grok 4.7 distillate of the installed primitives in
    `@orkestrel/tool`, `@orkestrel/mcp` (browser and server faces), `@orkestrel/html`,
    `@orkestrel/markdown`, and `@orkestrel/test`, with layers and blast radius. When this file is
    absent, read the sibling sources named under Law directly and say so in `Measurements`.
  - `tmp/units/webmcp-research-report.md` — primary-source research: the WebMCP explainers, Chrome
    status and gating, and the tool vocabularies of Chrome DevTools MCP and Playwright MCP.
  - `tmp/units/webmcp-cdp-domain.md` — the experimental `WebMCP` DevTools Protocol domain,
    verbatim from tip-of-tree `browser_protocol.json`, and how Puppeteer and Chrome DevTools MCP
    drive it.
  - `tmp/units/probe-cdp-native-2.log` with `tmp/probes/cdp-native.test.ts` — the probes P1–P8
    the Orchestrator ran against the real Chromium 141 on this host; § Verified restates them.
  - `PROPOSAL.md`, `guides/browser.md` (§ Contract at lines 1850–2066), `src/core/types.ts`,
    `src/server/types.ts`, `src/core/index.ts`, `src/server/index.ts`.
  - `../mcp/src/browser/types.ts` (the WebMCP bridge, the page server, the port transport),
    `../mcp/src/browser/factories.ts`, `../tool/src/core/types.ts`, `../html/src/core/types.ts`,
    `../markdown/src/core/types.ts` (§ `MarkdownInterface`), `../markdown/src/core/helpers.ts`
    lines 2713–2770 (`htmlToMarkdown`) and 1748 (`renderMarkdown`).
  - `/home/user/orkestrel/ollama/tests/service/page.test.ts` — the known consumer's use of this
    package (a read-only clone; when the path is absent, say so).
- **Law.** `../scaffold/AGENTS.md` (§ Non-negotiable rules, § Design laws, § Work loop);
  `../scaffold/.claude/rules/names.md` (§ Entity-scoped names, § Fleet name ownership, § Fixed
  lifecycle vocabulary); `architecture.md` (§ Centralized-file pattern, § Wrapper test, § Barrel
  exports, § Entity subfolders, § Extension categories); `patterns.md` (§ Managers, § Stateful
  emitters, § Foreign contracts); `workspace.md` (§ Environments, § Typechecking and environment
  isolation: `src/core` compiles against `ESNext` and `WebWorker` with no DOM, `src/browser`
  against `DOM`, `src/server` against Node); `tests.md` (§ Test contract, § Probes, § Live-service
  tests); `documentation.md`; `quality.md`; `portability.md`. The skills `orkestrel-harden` and
  `orkestrel-align` (`../scaffold/.agents/skills/`) shape the implementation campaign the units
  feed.
- **Installed primitives.** Declared today: `@orkestrel/contract` (guards, `attempt`, `Result`),
  `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/websocket` (server transport only).
  Candidate runtime edges: `@orkestrel/tool` (L2) and `@orkestrel/markdown` (L2), both of which
  keep this package at L3. `@orkestrel/mcp` (L4, closure: `sse`, `tool`, `codec`, `emitter`,
  `process`, `contract`, `websocket`; peers `router`, `server`) is the delivery consumer that hosts
  a `ToolManagerInterface` over MCP in a page (`createPageServer`), a worker (`createScopeServer`),
  and Node (its server face); a runtime edge from this package to `mcp` would move this package to
  L5 and pull that closure into every consumer. A local helper whose job an installed export does
  is a defect.
- **Host.** The lane is read-only: `Read`, `Grep`, `Glob`, no shell. Working directory
  `/home/user/browser`; siblings at `../scaffold`, `../tool`, `../mcp`, `../html`, `../markdown`.
- **Standing conditions.** Astra dark; Grok journals under `tmp/cursor/` are not evidence, the
  answer files are. Chromium 141 on this host predates WebMCP.

## Verified

The Orchestrator verified each item itself; do not re-derive or re-report it.

1. Chromium 141.0.7390.37 exposes neither `document.modelContext` nor `navigator.modelContext`
   (probe P1, control `'body' in document` true).
2. After `DOM.enable` and `DOM.getDocument`, `DOM.childNodeInserted` arrives for an element
   appended 50 ms later; no event arrives without a mutation (P2).
3. A `MutationObserver` installed through `page.scripts.add` reports through a host binding made by
   `page.scripts.expose` (`Runtime.addBinding` plus a new-document script), so a push-style wait
   needs no poll; a revoked binding reports nothing (P3).
4. A trusted click is driven from an accessibility node's `backendDOMNodeId` alone:
   `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, the quad's center to
   `Input.dispatchMouseEvent`; `document.body.dataset.clicked` reads `'yes'`; `DOM.resolveNode` on
   a bogus id rejects with a `CDPError` (P4).
5. `Page.lifecycleEvent` reports `load` and `networkIdle` after `Page.setLifecycleEventsEnabled`
   and nothing when disabled (P6).
6. `renderText(createHTML(html).distill().document)` keeps the paragraph and drops the `nav` links
   and the `footer`; the raw text keeps them (P7).
7. The accessibility tree flattened to `role "name" [ref=n]` lines, without `StaticText` and
   `InlineTextBox` rows, is smaller than the page's HTML on a 397-character page and more than
   three times smaller on a bloated page (styles, scripts, class-heavy markup, twenty nav links,
   twelve cards); the full outline with text rows is larger than the tiny page; the textbox's
   accessible name carries the label's trailing space (`"Email "`) (P8, `tmp/units/probe-cdp-native-3.log`).
8. A main-world `document.modelContext` double installed by an init script is listed, executed,
   and aborted from the host through `Runtime.evaluate` (the call rejects with `AbortError` after
   the in-page controller aborts), and an isolated world sees `typeof document.modelContext` as
   `'undefined'` while the main world sees `'object'` (P5).
9. The tip-of-tree DevTools Protocol carries an experimental `WebMCP` domain: `enable`, `disable`,
   `invokeTool(frameId, toolName, input) → invocationId`, `cancelInvocation(invocationId)`, and
   the events `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded(status, output?,
   errorText?, exception?)`; a `Tool` carries `frameId`, an optional `backendNodeId` (a declarative
   form tool), and `annotations` with `readOnly`, `untrustedContent`, `consequential`, `debugging`,
   `autosubmit`. Puppeteer and Chrome DevTools MCP drive it; the latter requires Chrome 150 or later
   with `--enable-features=WebMCP` (`tmp/units/webmcp-cdp-domain.md`).
10. The WebMCP draft of 2026-09-29 names `document.modelContext`, the events `toolchange`,
    `toolactivated`, `toolcancel`, and a `debugging` hint; Chrome's intent names
    `Navigator.modelContext` (dev trial M146, origin trial M149–M156, ship M157); the explainer
    exposes tools "to itself, same-origin documents in the same tree, and built-in browser agents";
    the declarative form section is a TODO in the spec while the explainer names `toolname`,
    `tooldescription`, `toolautosubmit`, `toolparamdescription`
    (`tmp/units/webmcp-research-report.md`).
11. `@orkestrel/mcp`'s browser face declares the 2026-09-15 registry surface (`WebMCPRegistryInterface`
    with `registerTool`, `getTools`, `executeTool`, `toolchange` only; `WebMCPAnnotations` without
    `debugging`), `createModelContext` (publish, adopt, destroy), `createPageServer`,
    `createScopeServer`, `MessagePortTransport` (`../mcp/src/browser/types.ts`).
12. The current package polls in five places: the compiled locator wait expressions
    (`src/core/compilers.ts:467,501,540,579`, `setInterval` at 100 ms), the function wait
    (`compilers.ts:40`), `BrowserNavigationManager.until` (`src/core/BrowserNavigationManager.ts:63`),
    `waitForCDPReady` (`src/server/helpers.ts:388`), and `src/server/Browser.ts:1075`.
13. `content()` evaluates `outerHTML` and `innerText` under `BROWSER_RESULT_LIMIT` (2 500 000
    characters); `article()` is `renderText(createHTML(html).distill().document)`
    (`src/core/BrowserFrame.ts:112–140`); `snapshot()` decodes `DOMSnapshot.captureSnapshot`
    (`src/core/BrowserPage.ts:330–341`); `accessibility.snapshot()` decodes
    `Accessibility.getFullAXTree` with `backend` ids (`src/core/BrowserAccessibility.ts`).
14. Frames: `Target.setAutoAttach` with `flatten`, one session per out-of-process frame, an
    isolated world per child frame for evaluation (`BROWSER_FRAME_WORLD_NAME`), the page's main
    frame in the main world (`src/core/BrowserFrame.ts:266–279`, `src/core/BrowserPage.ts:114–160`).
15. Fleet layers: this package L3 with `contract`, `emitter`, `html`, `websocket`; `tool` L2;
    `markdown` L2; `mcp` L4 (`../scaffold/.claude/agents/orkestrel.md` § Package catalog).
16. The service baseline passed: 14 proofs in 39.26 s against the host Chromium through
    `createBrowser` with `--no-sandbox --disable-dev-shm-usage --disable-gpu`.
17. The owner's second instruction of 2026-09-29, verbatim: "I know we'll eventually need to try
    this out with an actual model so let's do that already with probe so whatever you come up with
    already has real world proven. You have to use the model from the ollama tests so we don't
    have multiple and also because I like using small models, if a small model can use it well
    and our tools are tuned for them then larger models shouldn't have any issue." The model the
    ollama tests use is `qwen3.5:2b-q4_K_M` on `http://localhost:11434`
    (`/home/user/orkestrel/ollama/tests/setupService.ts:11-14`); the Orchestrator runs the
    real-model probe through `@orkestrel/ollama` and `@orkestrel/agent` against the vocabulary
    the design proposes, so the vocabulary is tuned for a 2B-parameter model: few tools, short
    descriptions, bounded text results, references a small model can copy back.
18. The known consumer `@orkestrel/ollama` (development dependency `^0.0.18`) uses
    `createBrowser({ executable, headless, args, cdp: { port, discover: false }, timeout,
    signal })`, `browser.connect()`, `browser.create({ on: { request, error, console } })`,
    `page.network.start()`, `page.navigate(url, { timeout })`, `page.evaluate(expression, timeout)`,
    `browser.destroy()`, and `findSystemBrowser` with the `SystemBrowser` and
    `SystemBrowserOptions` types (`/home/user/orkestrel/ollama/tests/setupServer.ts:1094-1150`,
    `tests/setupService.ts:230-239`).

## Unknowns

Report each under `Measurements` as a reading missing, with the reading that would settle it.

- Whether `document.modelContext` or `navigator.modelContext` is the name a shipping Chrome
  exposes.
- Whether a shipping Chrome exposes registered tools to an extension, and through which API.
- The type of `WebMCP.toolResponded.output` (`any` in the protocol; `DOMString` in the spec's
  `executeTool`; a content array in the explainer's sample).
- Whether an in-browser placement includes an extension driving CDP through `chrome.debugger`, and
  whether a structural transport interface can name that host object without `@types/chrome`.

## Scope

- **Owned.** none; this is a design.
- **Shared (report-only).** none.
- **Off-limits.** Every file; write nothing.
- **Made false by this change.** none.
- **Tools and limits.** `Read`, `Grep`, `Glob`.

## Execution

Perform the assignment yourself and spawn nothing. Hold the lane the dispatch names and say which.
Answer every question in § Questions; rule on every entity in § What goes. Name at most two real
alternatives per major decision and why the design wins. Cite a constraint to `file:line`. Where a
rule forecloses an option, quote the rule under `Refusals`.

## Questions

1. **Environments.** What `src/core`, `src/browser`, and `src/server` each own after the redesign,
   and the dependency edges of each. `src/core` compiles with no DOM library, so every use of
   `document`, `Element`, `MutationObserver`, or `MessageChannel` lives in `src/browser`. Decide
   whether `src/browser` exists, and what runs there natively: a DOM-native implementation of the
   agent vocabulary, a native-`WebSocket` CDP transport so a page or extension can drive CDP, both,
   or neither; and how the in-browser placement reaches "tools outside the browser" (the mcp
   package's browser-face clients exist; does this package add anything?).
2. **The agent surface.** One tool vocabulary the agent calls, the same in both placements: name
   each tool, its parameters, its annotations (`pure`, `untrusted`, `consequential` from
   `@orkestrel/tool`), its result shape (text a model reads, bounded), and its implementation in
   each placement. Tool names are data advertised to a model, so the entity-member one-word law
   does not bind them; state the naming rule you apply and apply it. Decide where the registry
   lives (`page.tools`? a factory over a page, a context, a browser?), how tools are scoped (per
   page, per context, across tabs), how a consumer hosts the registry over MCP with no
   `browser → mcp` edge, and how the vocabulary compares with Chrome DevTools MCP's and Playwright
   MCP's (`tmp/units/webmcp-research-report.md` § 5) — what to match, what to refuse, and why.
3. **Locating and acting natively.** The agent-facing snapshot (an accessibility outline with
   stable references, per P4, P8, and the two shipped servers' `uid`/`ref` mechanisms) and
   reference-based actions over the `DOM` and `Input` domains, against the current in-page
   compiled locator expressions with 100 ms polling. What remains of `BrowserLocator`,
   `BrowserSelectorManager`, `compilers.ts`, and the `css/role/text/label/placeholder/testId`
   axes; how references stay valid across mutations and invalidate across navigations; and how
   every wait becomes event-driven under `AGENTS.md` "No polling architecture" (P2, P3, P5, P6
   name the events). Rule on `BrowserNavigationManager.until`.
4. **Reading.** The retained document: an `@orkestrel/html` handle over the frame's HTML, the
   projections (Markdown through `htmlToMarkdown` and `renderMarkdown`, text through `renderText`,
   distilled or whole), the bound (characters; is truncation reported on the result?), the
   invalidation (the `navigate` event and frame events, never a poll), the release, frame
   ownership, and the fate of `content()`, `article()`, and `snapshot()`. The wrapper test binds: a
   member that forwards one-to-one to html or markdown fails it, so say what the reading entity
   adds (a boundary, an invariant, a composition, a lifecycle, or a narrower contract).
5. **WebMCP, outside the browser.** Over CDP: the `WebMCP` domain (Verified 9) as the native path
   — enable, events, invoke with an invocation id, cancel from `ToolContext.signal` — and whether a
   Runtime-evaluation path over `document.modelContext` (P5) exists beside it for browsers that
   ship the registry without the domain, or is refused. How the page's tools are adopted into the
   agent registry beside the generic tools (name collisions, the `untrusted` annotation, the frame
   a tool belongs to, declarative form tools with a `backendNodeId`), how `toolsAdded`/`toolsRemoved`
   become the registry's `add`/`remove`, and how absence is reported (no polyfill: the mcp bridge's
   rule is "feature detection is the return value").
6. **WebMCP, inside the browser.** What this package adds beyond `@orkestrel/mcp`'s
   `createModelContext` (which already publishes a `ToolManagerInterface` to
   `document.modelContext` and adopts the registry's tools). If the answer is "a DOM-native tool
   set the mcp bridge publishes", say so and stop; if the answer is a registry client of its own,
   pass the wrapper test.
7. **Trusted against DOM-native input.** A CDP click is trusted input through the `Input` domain; a
   DOM-native click is `dispatchEvent` and untrusted. State the contract difference, how the
   vocabulary declares it, and what an in-browser tool refuses rather than fakes.
8. **Lifecycle and ownership.** The browser, context, page, and frame lifecycle under the fixed
   vocabulary (`start`, `stop`, `pause`, `resume`, `skip`, `abort`, `clear`, `destroy`, `execute`);
   tabs as a manager (`browser.tabs`? the context's `pages()`); what `Browser` in `src/server`
   keeps (discover, connect, launch, adopt, disconnect, destroy, close, ownership, process groups)
   and what changes.
9. **What goes.** Rule on every current entity — codegen, HAR, routes, coverage, profiler,
   tracing, performance, clock, emulation, cookies, permissions, storage, downloads, dialogs, file
   chooser, workers, WebSocket observation, network observation, PDF, screenshot, the
   `BrowserSnapshot` entity — as keep (a mechanism the agent or a consumer needs), change (name the
   change), or delete (name the reason). `AGENTS.md` "Remove a symbol only when the capability
   itself must not exist" binds; "nothing is sacred" is the owner's permission, not a reason.
10. **Tests and proofs.** Which proofs run against real Chromium in the `service` project, which
    against the in-memory CDP transport in `src:core`, how the `WebMCP` domain is proven where no
    host has it (a protocol-faithful fixture server that speaks the four events, and a live proof
    recorded as a limit until a Chrome 150 host exists), how the in-browser face is proven (the
    `src:browser` project on the Playwright provider the fleet's test workspace already uses for
    tests, or a served page driven by this package's own server face), and where the end-to-end
    MCP proof lives (this package with `@orkestrel/mcp` as a development dependency, which needs
    the owner's authorization, or the mcp package, or the ollama consumer).
11. **Dependencies.** Rule on each edge: `@orkestrel/tool` (runtime), `@orkestrel/markdown`
    (runtime, authorized by the standing proposal), `@orkestrel/mcp` (none at runtime; development
    for a proof?), and no other package and no browser binary. Name every fleet-owned bare name the
    design would collide with (`Tool*`, `ModelContext*`, `WebMCP*`, `Markdown*`, `HTML*`) and how
    the design avoids each under `names.md` § Fleet name ownership.
12. **Blast radius and sequencing.** The version bump this package takes, the consumers that re-pin
    (`@orkestrel/ollama` holds it as a development dependency for its page proof; Verified 18 lists
    the calls it makes), the units in dependency order with owned files, the acceptance criteria
    per unit (cheap-first), and the exit criterion for the implementation campaign.
13. **Small-model fit.** The vocabulary is proven by `qwen3.5:2b-q4_K_M` driving a real page
    (Verified 17). State how the design serves a small model: how many tools it advertises at
    once and whether the set is staged (a page's WebMCP tools appear beside the generic set, or
    replace part of it); the length and shape of each result (an outline with references, a
    bounded Markdown reading, one-line action receipts); how a reference is spelled so a small
    model copies it back without error; and what the real-model probe must show for the design to
    count as tuned (the task it completes, the tool calls it makes, the bound on attempts).

## Output

Your final message is the proposal, in Markdown, with exactly these sections in this order:
`Lane`, `Design`, `Alternatives`, `Constraints`, `Refusals`, `Measurements`, `Units`, `Tensions`,
`Risks`. Inside `Design`, carry: the environment map (a table: environment, owns, imports); the tool
vocabulary (a table: tool, parameters, annotations, result, CDP implementation, DOM-native
implementation); the reading entity's contract; the WebMCP entity's contract; the event and
invalidation model; and a `What goes` table over every current entity with keep, change, or
delete and the reason. Inside `Units`, give each unit a name, role and engine, owned files,
dependencies, and acceptance criteria. Target 500 to 1200 lines; no process diary, no
restatement of the brief.

## Deviation contract

Stop and report (expected, found, evidence) when `tmp/cursor/browser-absorb-answer.md` or
`tmp/units/webmcp-cdp-domain.md` is missing. Proceed without `tmp/cursor/prior-absorb-answer.md`
or the ollama clone by reading the sources directly and recording the substitution under
`Measurements`. Settle every other ancillary choice yourself and record it under `Tensions`.

## Acceptance criteria

1. Every section of § Output is present, in order, and every question in § Questions is answered.
2. Every constraint carries a `file:line` citation that resolves from `/home/user/browser`.
3. Every unit is implementable by a cheap executor from its brief alone.

**Observations, not criteria.** none.

## Review evidence

The proposal itself, the canon it must satisfy (§ Law), and its motivation (§ The owner's words).
