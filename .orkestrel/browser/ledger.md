# Routing ledger — browser redesign proposal campaign (2026-09-29)

Orchestrator: Claude Code main session (Fable 5.1). Campaign records live under this checkout's
`tmp/units/` because the deliverable is `PROPOSAL.md` in this repository and no scaffold commit was
requested; the ledger's substance is folded into the proposal before acceptance.

## Bench readings

| Bench | Probe | Reading | Consequence |
| --- | --- | --- | --- |
| Cursor Grok | `bench.ts --cursor --cap 180` | `live: true`, model `cursor-grok-4.6-high` (the environment pins `CURSOR_GROK_MODEL`), 19 475 ms | Every lane passes `--model grok-4.7-high` explicitly; `agent models` lists it |
| Cursor Grok 4.7 | `net-probe` lane, session `b114a3d4-4afe-4a2a-a6e4-fad4fc47ab87`, 40 834 ms | `MODEL: grok-4.7-high`; local read works; `NETWORK: none` ("Web fetch rejected: User Rejected" under `--mode=ask`) | Grok holds repository absorption; external research falls back to `researcher` (native, Sonnet) and is recorded as a substitution |
| Codex (Astra, Sol) | `bench.ts --codex --cap 180` | `live: false`, `codex-cli 0.159.0`, "Not logged in" | Astra dark for the design round: Opus held the objective design lane in a clean context (substitution per `.agents/orchestration.md` § Benches) |
| Codex (Astra, Sol), recovered | `login.ts --codex --cap 1500`, the user completed device auth; then `bench.ts --codex --cap 240` | "Logged in using ChatGPT" at the login driver's exit (72 075 ms); `bench.ts --codex` then read `live: true`, model `gpt-6-astra`, sandbox `read-only`, session `01a0eead-1e01-7262-a8f2-ff6cf2463234`, 6 636 ms | The falsify round's objective lane routes to `analyst` on Astra when the probe reads live |
| Claude CLI (Opus) | `bench.ts --claude --cap 180` | `live: true`, 2.1.284, 21 574 ms | Native `planner`/`reviewer` roles (Opus alias) are used instead of the CLI bridge |

## Dispatches

| Unit | Role, engine | Launch | Result |
| --- | --- | --- | --- |
| `net-probe` | `grok`, Cursor Grok 4.7 | `launch.ts --cap 240` | see Bench readings |
| `browser-absorb` | `grok`, Cursor Grok 4.7 | `launch.ts --cap 2400`, journal `tmp/cursor/browser-absorb.jsonl`, session `d1f7077c-e73b-4afc-befb-6456b6f9401c` | 531 263 ms; 269 lines; 740 citations, 0 unresolved (`cite.ts`) |
| `webmcp-research` | `researcher` (substitute for Grok, network dark) | Agent tool, background | 142 839 ms; report at `tmp/units/webmcp-research-report.md`; the Orchestrator verified the `WebMCP` CDP domain itself (`tmp/units/webmcp-cdp-domain.md`) |
| `prior-absorb` | `grok`, Cursor Grok 4.7 | `launch.ts --cap 2100`, journal `tmp/cursor/prior-absorb.jsonl`, session `0fa004f3-076e-42af-ab63-32132d7cb1c8` | 360 lines; 275 citations, 0 unresolved |
| `service-baseline` | Orchestrator, `npm run test:service` | Chromium 141.0.7390.37 at `/opt/pw-browsers/chromium` | 14 passed, 39.26 s |
| `cdp-native` probe | Orchestrator, `tmp/probes/cdp-native.test.ts` through the `probe` project | | 8 passed (`tmp/units/probe-cdp-native-3.log`) |

## Design round (2026-09-29)

| Lane | Role, engine | Context | Brief | Result |
| --- | --- | --- | --- | --- |
| subjective | `planner`, Opus 5.5 | clean, blind | `tmp/units/browser-design-brief.md` | 942 289 ms, 874 lines at `tmp/units/design-subjective.md`; `cite.ts`: 98 citations, 2 range ends one line past the file (`src/core/compilers.ts:301-889`, `../mcp/src/browser/factories.ts:370-462`) |
| objective | `planner`, Opus 5.5 (Astra dark; substitution per `.agents/orchestration.md` § Benches) | clean, blind | same brief | pending |

## Probes

| Probe | Host | Result |
| --- | --- | --- |
| `tmp/probes/cdp-native.test.ts` P1–P8 | Chromium 141 through `createBrowser`, `probe` project | 8 passed (`tmp/units/probe-cdp-native-3.log`), after two repairs recorded in the log series |
| real-model vocabulary probe | `qwen3.5:2b-q4_K_M` on `http://127.0.0.1:11434` (daemon running, model pulled 19:03) | pending |

## Real-model probe readings (2026-09-29)

- Run 1 (`tmp/units/probe-browser-agent.log`): tools `read`/`snapshot` with no parameters, refs as
  `[4]`, soft system prompt. T1 and T2: the model narrated ("I will first read the current page")
  and made no call in 3 of 3 attempts each. T3: the model called `read`, then `click` with the
  invented ref `search-box`, then `snapshot`, then `click` with the role word `searchbox` as the
  ref; 0 of 3 attempts succeeded.
- Direct daemon readings (`tmp/probes/chat-variants.ts`, `stream: false`): the model emits a tool
  call under every prompt shape but two (`think: true`; the user naming the tool without a system
  instruction), including empty-parameter tools.
- Direct daemon readings (`tmp/probes/chat-stream.ts`, `stream: true`, the mode the provider
  uses): a call to an empty-parameter tool makes Ollama 0.34.4 answer one record
  `{"error":"XML syntax error on line 3: element <function> closed by </parameter>"}` and end the
  stream; a call carrying a parameter streams as a `tool_calls` record followed by `done: true`.
  With every tool declaring a required parameter, all four shapes streamed a call.
- Run 2 (`tmp/units/probe-browser-agent-2.log`): refs spelled `e4`, `read` and `snapshot` take a
  required `what`, must-call system prompt. T1 passed on the first attempt (one `read` call,
  6 267 ms). T2: in all 3 attempts the model called `read`, `snapshot`, then `click e6` (the
  right button; the page's cart read `1`), then called `snapshot` five more times looking for
  "cart items" until the 8-turn limit ended the run partial with no answer, because the snapshot
  lists interactive elements only and carries no page text. T3: in all 3 attempts the model
  called `read` once and answered "3 results" without touching the search box.
- Run 3 (`tmp/units/probe-browser-agent-3.log`): four tools — `read` (Markdown), `look` (headings,
  text lines, and interactive elements with `e4` refs in one view), `click` and `type` (with a
  `submit` flag that presses Enter) whose receipts carry the fresh `look` view — following the
  shipped servers' practice of returning the page state after an action. T1 passed (one call,
  8 263 ms). T2 passed in 4 turns (18 887 ms): a guessed `type e4` refused with "call look",
  then `look`, `click e6`, `look`, answer "The cart shows 1 item." T3 failed 3 of 3, identically
  at temperature 0: a guessed `type e1` refused, then `look`, then the answer "3 results" copied
  from the page text before any search. The flat `nodes` list of `accessibility.snapshot()` is
  not in document order (the footer text preceded the form controls in the view).
- Run 4 (`tmp/units/probe-browser-agent-4.log`): the outline walks the accessibility tree from
  `roots` through `children` (document order), and the first user turn carries the page view
  (`Page:` then `Task:`), as the shipped servers return a snapshot after navigation. All three
  tasks passed on the first attempt: T1 one `read` call (7 558 ms); T2 `click e6` then `look`,
  answer "The cart shows 1 item." (9 156 ms, cart read `1`); T3 one `type e3 "bowl" submit`
  call, answer "there is 1 result shown" (8 426 ms, results read `1 result`). Residual noise:
  the outline repeats a link's or heading's text as a following text line, because the
  `StaticText` child of a named element is emitted beside its parent.
- Tuning rules the four runs established for `qwen3.5:2b-q4_K_M` through `@orkestrel/agent`:
  every tool declares at least one parameter (Ollama 0.34.4's streamed parser rejects an
  empty-parameter call); refs are spelled `e<n>` and a tool's parameter description names one;
  one observation shape carries text and refs together, in document order; an action's receipt
  carries the fresh view; the first turn carries the view; `type` takes `submit`; the system
  prompt says the model can only see the page through tools and must call one before answering.

## Second probe series (`tmp/probes/cdp-native-2.test.ts`, the subjective lane's Measurements rows 5–10)

- P10 stderr readiness: a Chromium launch with `--remote-debugging-port=0` prints
  `DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>` on stderr (read within
  4 s); the same launch without the flag prints no such line in 4 s (control).
- P11 occlusion: `DOM.getNodeForLocation` at the button's quad center returns the overlay's
  backend node, and a trusted click there leaves `dataset.clicked` unset; with the overlay
  removed it returns a `BUTTON` node and the click lands.
- P12 event order for a trusted click on a link: `Page.frameRequestedNavigation` arrives before
  the mouse-up `Input.dispatchMouseEvent` resolves, and `Page.frameNavigated` for `/next`
  arrives after it.
- P13 sizes on the bloated page: HTML 10 025 characters; document-order outline (32 interactive
  elements plus headings and deduplicated text lines) 1 440 characters (7×); distilled Markdown
  386 characters (26×), keeping "Paragraph 11 the reader wants." and dropping "Section 3".
- Type probe (`tmp/probes/source-shape.ts`, `tsc --ignoreConfig --strict`, exit 0): mcp's
  `ModelContextInterface` is assignable to `{ emitter: EmitterInterface<{ change: readonly [] }>; adopt(): Promise<readonly ToolInterface[]> }`;
  the control (a shape without `adopt`) is refused under `@ts-expect-error`.
- P9 `Accessibility.queryAXTree` (rooted at the document's backend node, which the method
  requires): `{ accessibleName: 'Save', role: 'button' }` returns one node named `Save` with
  `ignored: false`; `{ accessibleName: 'Sav', role: 'button' }` returns none (exact-name
  matching, no substring); `{ role: 'button' }` returns the visible `Save` alone and not the
  `hidden` button. Series 2 final: 5 of 5 passed (`tmp/units/probe-cdp-native-series2b.log`).

## Third probe series (`tmp/probes/cdp-native-3.test.ts`, the reconciliation's open readings)

- Runs: `tmp/units/probe-cdp-native-series3.log` (P17 fixture lookup matched the label's
  `StaticText`, 3 of 4), `series3b.log` (lookup trimmed, `DOM.focus` on the text node: `Node is
  not an Element`, 3 of 4), `series3c.log` (lookup by role and trimmed name, 4 of 4, exit 0).
- P14 dialog during a trusted click: `Page.javascriptDialogOpening` (`Delete the draft?`) arrives
  while the `mouseReleased` send stays pending for 1 500 ms; `Page.handleJavaScriptDialog`
  `{ accept: true }` settles the pending send and `document.body.dataset.answer` reads `true`.
  Control: a click on a plain button settles `mouseReleased` within 1 500 ms with no dialog
  event. So a click receipt can return while a dialog is open by racing the mouse-up settlement
  against the page's `dialog` event, and the pending command settles after the dialog is handled.
- P15 registry detection on Chromium 141: `WebMCP.enable` rejects with a `CDPError` whose
  `context.code` is `-32601` and whose message names `WebMCP.enable`; `Schema.getDomains` lists
  more than 10 domains and no `WebMCP`. Control: `Page.enable` resolves.
- P16 same-document navigation: `history.pushState` fires `Page.navigatedWithinDocument` with the
  route URL and no `Page.frameNavigated`; a DOM mutation fires neither within 300 ms.
- P17 trusted type: `DOM.focus({ backendNodeId })`, `this.select()` through
  `Runtime.callFunctionOn` on the node resolved into an isolated world, then
  `Input.insertText('new')` replaces the prefilled `old` and the page's `input` listener records
  `isTrusted` `true`. Control: a second `Input.insertText('x')` with no selection appends
  (`newx`).
- Reconciliation facts read from source: `@orkestrel/agent` reads `tools.definitions()` every
  turn (`/home/user/orkestrel/agent/src/core/Agent.ts:436`), so staged tools reach the model;
  `ToolManagerInterface.add` overwrites a same-named tool and publishes `remove` then `add`
  (`../tool/src/core/types.ts:208-219`); toolbox names its tools with one word (`workflow`,
  `release`, `publish`, `infer`, `compile`, `notes`, `describe`); `@orkestrel/mcp` already
  carries `playwright` `^1.63.0` and `@vitest/browser-playwright` `^4.1.11` as development
  dependencies (`../mcp/package.json:117,120`); `tests/config.test.ts:153-158` forces the
  `src:browser` project with `tests/setupBrowser.ts` when `src/browser` exists; the daemon reports
  `qwen35.context_length` 262 144 for `qwen3.5:2b-q4_K_M` and the consumer's option sets pin
  `num_predict` (8, 16, 32, 64) with temperature 0 and no `num_ctx`.

## Falsify round on the reconciled proposal (`tmp/units/proposal-claims.md`, 20 claims)

| Lane | Role, engine | Context | Answer | Verdict |
| --- | --- | --- | --- | --- |
| subjective | `reviewer`, Opus 5.5 | clean, blind | `tmp/units/falsify-subjective-answer.md` (transcribed verbatim from the hand-back; 36 citations, 0 unresolved) | FAIL 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 20; outside: S1–S8 |
| objective | `analyst`, GPT-6 Astra (`codex exec`, read-only, `-C /home/user`) | clean, blind | `tmp/codex/falsify-objective-answer.md` (454 566 ms; 45 citations, 0 unresolved) | FAIL 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20; outside: O1–O3 |

Reproduced before acting: the sixth consumer `evaluate` site (`/home/user/orkestrel/ollama/tests/setupServer.ts:1441`) and the stub at `tests/setupServer.test.ts:678`; `BrowserConnectionError` declared in `src/server/errors.ts:10`; `BrowserClock` awaiting `Emulation.virtualTimeBudgetExpired`; codegen recording CSS selectors (`src/core/compilers.ts:276-280`); invariants 5, 6, and 13 naming `waitForCDPReady`, the codegen emitter, and the launcher hand-off wait; the probe's read oracle `content.includes('12')` against a seeded view carrying `Price: $12`. Design-level findings (dialog coverage, unbounded page strings, adoption races, the registry buffer, the `_blank` link, the own-document navigation) are confirmed by construction against the draft's own text.

## Fourth probe series (`tmp/probes/cdp-native-4.test.ts`, the claims both lanes left unresolved)

- Runs: `series4.log` (P18 passed; P19 waited on `page.frames()`), `series4b.log` and `series4c.log` (diagnostics: `Target.getTargets` lists the `http://localhost` iframe target attached, while `Page.getFrameTree` on the page session has no `childFrames`, so `page.frames()` is blind to an out-of-process frame), `series4d.log` (P19 over a second client: `browser.endpoint` is `undefined` for an owned launch), `series4e.log` (the control click at y=52 missed a zero-height body), `series4f.log` (3 of 3, exit 0).
- P18 backend id reuse: 50 buttons described (ids A), removed, 10 000 create-and-remove cycles, `HeapProfiler.collectGarbage`, 50 more described (ids B): every id in B exceeds the maximum of A, and A ∩ B is empty; control: `DOM.resolveNode` on a removed id rejects.
- P19 out-of-process frame: the iframe on `http://localhost` inside a `http://127.0.0.1` page is its own `iframe` target, absent from the page's frame tree (`page.frames()` returns 1 frame); over a flattened session on that target, `DOM.getContentQuads` is frame-local (center inside the 300×200 box); `Input.dispatchMouseEvent` on the page session at the frame-local center plus the iframe's bounding rect (220, 160) increments the frame's click count; the control click at the raw frame-local point lands in the outer document.
- P20 beforeunload: on a page whose `beforeunload` handler cancels, a trusted click on a link reports `Page.frameRequestedNavigation`, then `Page.javascriptDialogOpening` of type `beforeunload` while the `mouseReleased` send is pending (still pending after 1 000 ms); `Page.handleJavaScriptDialog` accept lets `Page.frameNavigated` to the link's URL arrive and the send settle.

## Landing (2026-09-29)

- `PROPOSAL.md` rewritten from `tmp/units/design-reconciled.md` with every accepted falsify finding ruled in (812 lines after `oxfmt`; `cite.ts`: 42 citations, 0 unresolved; `test:policy`, `format:check`, and `test:guides` exit 0).
- Records promoted into `.orkestrel/browser/`: this ledger, the design brief, both design-lane proposals, the claims file, both audit answers, and the audit verdict. Probe sources and logs stay under `tmp/` (ignored) until `sweep.ts --tmp` after the campaign's last live unit.

## Owner rulings (2026-09-29, after the first landing)

- D1, D2, and D3 authorized in the owner's words: "let's go with your recommendations for the decisions that were left".
- Stance on WebMCP, in the owner's words: "we are not wrapping webmcp, our packages are meant to replace it, although we want to make sure we are keeping up with it and trying not to stray too far from it since it most likely will be adopted into browsers soon enough, so we can work in some conformance tests to make sure we are aligned with it and even work in adapters for it, similar to how we have for MCP and other orkestrel packages." Carried into the proposal as a "Relation to WebMCP" section, an adapter map, and a conformance unit.

## WebMCP alignment read and reframe (2026-09-29, after the owner's ruling)

| Lane | Role, engine | Report | Reading |
| --- | --- | --- | --- |
| mcp bridge | native reader (workflow `webmcp-alignment-read`) | `tmp/units/webmcp-read-bridge.md` (78 facts, 8 gaps) | mcp 0.0.33 ships `createModelContext` (publish, adopt, destroy), a three-hint mapping each way, an IDL-faithful double at `tests/fixtures/modelContext.ts`, a `runIf(isWebMCPDocument(document))` native block, and a "WebMCP parity" guide section with 18 rows; it names none of `toolactivated`, `toolcancel`, or `debugging`; "conformance" in mcp is the MCP-wire runner only |
| WebMCP surface | `researcher` | `tmp/units/webmcp-read-surface.md` (25 facts, 9 gaps) | the domain's types, commands, and events read from the vendored JSON; the draft IDL (summarised fetch, 2026-09-29) with `executeTool` returning `Promise<DOMString>`, the name rule 1–128 of `[A-Za-z0-9_.-]`, the `tools` Permissions-Policy feature; the specification repository carries no test directory; Puppeteer and DevTools MCP versions that introduced WebMCP support unfound |
| fleet rules | native reader | `tmp/units/webmcp-read-rules.md` (71 facts, 8 gaps) | `tests/conformance.test.ts` is the fixed drift-proof home, its own project in `npm test`; a foreign-surface double is the one permitted substitution; a vendored mirror is fetched bytes, refreshed never rewritten; mcp pins mirrors by dated filename and SHA-256 digest; no rule names `adapter` as an identifier; no fleet conformance project runs in the browser environment |

- Reframe written into `PROPOSAL.md`: Goals bullet, "Relation to WebMCP" (replace, adapt, stay aligned; the adapter table), rulings 26 and 27, U17 `conformance`, U12 and U13 amendments, evidence and limits rows. One reader citation corrected (`../mcp/src/browser/constants.ts:22`). Verify pass: workflow `webmcp-alignment-verify`, three blind refuters (spec accuracy, fleet rules, coherence).

## Routing rule (owner, 2026-09-29)

- No subagent or workflow agent runs on the session model (Fable). Every dispatch names its engine: Opus 5.5 for a subjective or judgment-bearing lane, Sonnet for a mechanical unit or verifier, GPT-6 Astra or Cursor Grok through their drivers. The `webmcp-alignment-read` and `webmcp-alignment-verify` workflows launched before this rule inherited the session model; the owner let the verify pass finish.

## Verify pass on the WebMCP reframe (workflow `webmcp-alignment-verify`, 2026-09-29)

| Lens | Verdict | Findings | Record |
| --- | --- | --- | --- |
| spec accuracy | FAIL | 1 blocking, 7 required, 6 optional | `.orkestrel/browser/webmcp-alignment-findings.md` |
| fleet rules | FAIL | 2 blocking, 6 required, 4 optional | same file |
| coherence | FAIL | 2 blocking, 8 required, 4 optional | same file |

- Reproduced the blocking accuracy finding by fetch (curl, 2026-09-29): `wpt/webmcp/META.yml`, `wpt/webmcp/idlharness.https.window.js`, `wpt/interfaces/webmcp.idl` (2 136 bytes; `ontoolchange` alone, three hints), and `webmcp/index.bs` (86 547 bytes; line 20 `Test Suite: https://wpt.fyi/results/webmcp`; lines 622–623 `ontoolactivated`, `ontoolcancel`; line 1118 `debugging`; line 158 the 1-to-128 name rule). Digests: `index.bs` `e6c9b979…`, `webmcp.idl` `eddabc79…` (full values in `tmp/webmcp/`).
- Every blocking and required finding accepted and written into `PROPOSAL.md`; the optional ones accepted as wording. Rulings in `.orkestrel/browser/webmcp-alignment-verdict.md`. After the patch: `cite.ts` 54 citations, 0 unresolved; `test:policy`, `format:check` exit 0; structure and term sweeps clean.

## Implementation campaign (opened 2026-09-29, after the owner's "get to work")

- Plan: `.orkestrel/browser/plan.md`. Order: mcp M1–M3 first (bridge refresh, drift, pack), browser U1 and U8 beside them, then the proposal's order, ollama U14–U15, one falsify round, the publish wave.
- mcp baseline on this host: `npm run check` exit 0; `npm run test:conformance` before a build: 45 passed, 2 failed (every client scenario 0 passed, because the client under test imports the built `dist/`, absent in a fresh checkout); rerun after `npm run build` recorded in the next row.
- M1 `bridge-refresh`: brief `tmp/codex/m1-bridge-refresh-brief.md` (in the mcp checkout; `brief.ts --check` 40 checked, 0 missing), launched detached through `launch.ts` (pid file beside the journal), sandbox `workspace-write` rooted at `/home/user/mcp` with the installed scaffold copy as the canon.
- U1 `signal`: `builder` (Sonnet) in the browser checkout, brief inline in the dispatch.
- mcp baseline after `npm run build` (exit 0): `npm run test:conformance` 47 passed, 0 failed, exit 0, on this host on 2026-09-29 at runner `@modelcontextprotocol/conformance` 0.2.0-alpha.11 against revision 2026-07-28; the test's recorded tally is 147 passed / 0 failed (`tests/conformance.test.ts:318`), so the README's 23 (alpha.10) and the guide's 110 are the stale copies M2 corrects.
- U1 `signal` accepted at `91ec857`: the builder met criteria 1–5 (616 tests) and reported one limitation, an abort listener left on the signal after a normal settle; the Orchestrator centralized settlement in one `#settle` method that removes the entry, clears the timer, and releases the listener, and added the listener-count test with its control (`node:events` `getEventListeners`); gates rerun by the Orchestrator: `check:src:core` 0, `check:src:server` 0, core and server projects 617 passed, scoped `oxfmt` and `oxlint` clean. The guide's three `test:guides` failures (`BrowserSendOptions` rows and summaries) are U12's.
- M1 relaunched twice: the first lane stopped correctly because `tests/src/browser/factories.test.ts` holds exact type assertions on the shapes the unit changes and was not owned; the second launch went out with a stale brief after two parallel shell calls raced on the working directory (lesson recorded: absolute paths only, never two shell calls with different `cd` in one turn); the third launch carries the corrected brief (the file owned, a "Second launch" note).
- U2 `events` and U8 `launch` dispatched in parallel to two `builder` lanes (Sonnet) with disjoint owned files and project-scoped validation (core project alone for U2, server project alone for U8).
- U2 `events` accepted at `5770c25` after the Orchestrator applied the unit's reported patch to `src/core/BrowserContext.ts` (lifecycle events enabled on every configured page) and taught `CDPTestServer` and one scripted context test the `Page.setLifecycleEventsEnabled` reply; U8 `launch` accepted at `3670ffb` (its red-then-green record is missing by the builder's own report; the "no `/json/version` during launch" assertion is red on the old path by construction and the audit round attacks it); gates rerun by the Orchestrator over both: `check:src:core` 0, `check:src:server` 0, core and server projects 638 passed.
- M1 third launch returned (669 786 ms, exit 0): 8 files, +367/−61; the lane's own gates: `npm run check` 0, scoped `oxfmt` and `oxlint` 0; the Codex sandbox refused the loopback bind, so the Orchestrator ran `test:src:browser` (173 passed, 2 skipped: the `runIf` native block) and `test:guides` (202 passed) outside it; criterion 6's grep narrowed to `src/browser` (0 hits). Review dispatched: `reviewer` (Opus) over `tmp/units/m1-claims.md` (10 claims) and `tmp/units/m1-diff.patch` in the mcp checkout.
- U3 `reading` dispatched to `opus` in the main browser checkout; U6 `registry` prepared for `astra` in the worktree `tmp/worktrees/u6` (branch `ccr-d15a48b1-yyyll6-u6` from `5770c25`, `npm ci` exit 0) because both units touch `src/core/types.ts`, `BrowserPage.ts`, `helpers.ts`, and the barrel.
- M1 review (Opus `reviewer`, 476 740 ms): FAIL 5, 7; outside R1–R3; rulings in `/home/user/mcp/.orkestrel/mcp/m1-review-verdict.md`. Fix round dispatched to a `builder` (Sonnet) with the prescriptions verbatim; closes with a mutation probe on the new guard.
- M1 accepted at mcp `a5c9670` after the fix round (builder on Sonnet, the reviewer's prescriptions verbatim; mutation probes on the fixture guard and the bridge guard reddened four tests and one test respectively, then restored) and the Orchestrator's gates: `format:check` 0, `lint:check` 0, `check` 0, `test:src` 1 509 passed and 3 skipped, `test:guides` 202 passed. M2 `drift` dispatched to a `builder` (Sonnet) in the mcp checkout.
- M2 `drift` accepted at mcp `cdbde21` (builder on Sonnet; the Orchestrator reran `test:guides` 0, `test:policy` 0, scoped `oxfmt` 0): README, the guide's gaps entry, and its integration paragraph agree on 147 passed / 0 failed at runner 0.2.0-alpha.11 against revision 2026-07-28 citing the run of 2026-09-29; six browser-suite rows added to the guide's Tests list; the first-person sentence rewritten and ROADMAP item 13 deleted.
- mcp bumped to 0.0.34 at `619699b` (the bridge's published surface moved with M1); `npm run build` 0; `npm pack` produced `tmp/tarballs/orkestrel-mcp-0.0.34.tgz` (836 391 bytes) in the mcp checkout, never committed. Its install into browser as the D3 development dependency waits for U3 to release the browser manifest.
- Container restart (2026-09-29, 22:35 UTC) killed both review lanes mid-run: the U3 objective lane (Astra, journal kept as `tmp/codex/u3-review.1.jsonl`, no answer written; its errors file ends in websocket `Connection refused`) and the U6 `reviewer` (Opus, native agent, no report). Both relaunched on the same inputs (`tmp/units/u3-claims.md` and `u3-diff.patch`; the worktree's `tmp/u6-claims.md` and `u6-diff.patch`); the working trees were unchanged across the restart (`git status` matched the pre-restart file lists).
- U3 accepted at `db245b0` and pushed.
- M3: `tmp/scripts/install-mcp-tarball.sh` (never committed) copied the mcp tarball to `tmp/tarballs/orkestrel-mcp-0.0.34.tgz` (SHA-256 `ce063eec…`, 836 391 bytes), recorded the replaced range (`absent`: D3 adds the edge; restore to `^0.0.34` after mcp 0.0.34 publishes and before any publish gate), installed it as `devDependencies["@orkestrel/mcp"] = "file:tmp/tarballs/orkestrel-mcp-0.0.34.tgz"` (`npm install` 0, installed version 0.0.34, `debugging` present in the installed browser declarations), and deleted `node_modules/.vite`. The `file:` spec rides the campaign branch until the publish wave restores the registry copy; a fresh clone must run the script before `npm ci`.
- U6 review (Opus `reviewer`, relaunched, 712 951 ms, both lanes): FAIL 7, 8; outside O1–O6 required, O7–O10 and O12–O13 referred, O11 optional. Every accepted defect reproduced by inspection; rulings in `.orkestrel/browser/u6-review-verdict.md` (O11 and O13 held; O8 the standing U12 ruling; O10 recorded for U7). Fix round: `builder` (Sonnet) in the worktree, prescriptions G1–G11 verbatim with mutation probes. `PROPOSAL.md` amended on the main checkout: `requireBrowserToolParameter` renamed `deriveBrowserToolSchema` in U6's Owns line, and the Execution bullet gains the deadline-cancels sentence.
- U6 fix round returned (builder on Sonnet, 204 398 ms): G1–G11 applied; seven mutation probes red then green (the builder's excerpts: the second child's `WebMCP.enable` sent, `start()` rejecting, the child's tools surviving a navigation, the held response reused, no cancel on timeout, no cancel after a late reply); the lane's gates in the worktree: scoped `oxfmt` and `oxlint` 0, `check:src:core` 0, `check:src:server` 0, `test:src` 666 passed (47 files), `test:policy` 112 passed. `test:guides` 8 failed there against 14 on the main checkout at `9d01928` (`tmp/units/main-guides-baseline.log`): every failure is guide parity drift (barrel rows, the frame, page, and navigation-manager interface rows, compared fences) that U12 owns. The builder's G10 note accepted: a reply for an invocation the registry no longer tracks is cancelled remotely, which covers a deadline, an abort, an invalidation, and destruction alike without a stored flag.
- U6 committed at `68bc215` on `ccr-d15a48b1-yyyll6-u6` and merged into the campaign branch: three additive conflicts (the `@orkestrel/tool` and `@orkestrel/markdown` dependency lines, the `ToolInterface` and `HTMLInterface` imports in `src/core/types.ts`, the helper import list in `tests/src/core/helpers.test.ts`) resolved by keeping both sides; `package-lock.json` regenerated by `npm install` (0) over the main checkout's copy with the mcp tarball spec intact; `node_modules/.vite` deleted. Gates on the merged tree: `oxfmt --check src tests` 0, `oxlint src tests` 0, `check:src:core` 0, `check:src:server` 0, `test:src` 712 passed (48 files), `test:policy` 112 passed, 1 skipped. Worktree removed after the merge.
- U4 `elements` dispatched to an `astra` lane on the merged tree at `0ddb97e`: terrain scouted first (`scout` on Sonnet, `tmp/units/u4-scout.md`: no element manager, reference counter, outline helpers, or accessibility fixture exists; the world cache is the page's; the frame's `wait(selector)` rides the locator stack); brief written by the `astra` driver (Sonnet) at `tmp/codex/u4-elements-brief.md` (`brief.ts --check` 40 checked, 2 missing: the two files the unit creates). Two rulings patched into the brief before launch: the input classes are not the locator stack, so the page's `keyboard`, `mouse`, and `touch` are the inherited instances declared explicitly on the page contract with nothing moved; the frame's `wait(selector)` is removed by U4 in favour of `page.wait(text)` with the selector wait reachable through `selectors.css(selector).wait` until U5. The lane owns the mirrored tests of its modules (edits only to follow a shape change, never a weakened assertion). Launched detached through `launch.ts` (journal `tmp/codex/u4-elements.jsonl`, cap 5 400 s, sandbox `workspace-write` rooted at the checkout).
- Container restart (2026-09-29, 23:12 UTC) killed the U4 lane six minutes in (journal kept as `tmp/codex/u4-elements.1.jsonl`, 45 items: seven files edited, `tests/src/core/parsers.test.ts` 26 passed in the lane; no report). The working tree kept its edits (`git diff`: 7 files, 325 insertions, copied to `tmp/units/u4-partial.patch`). The Codex rollout for thread `01a0ef6b-43dc-7a03-a612-b81d1196f890` survived under `~/.codex/sessions/`, so the lane was resumed rather than restarted: `codex exec resume --json --model gpt-6-astra -c model_reasoning_effort="high" -c sandbox_mode="workspace-write" --skip-git-repo-check --output-last-message … <thread> "<what happened, where the edits stand, continue the brief exactly>"` through `launch.ts` on a fresh journal (cap 5 400 s). Lesson: a bench lane's thread id (the journal's first line) is the resume handle after a host restart; record it in the dispatch row.
- U4 lane returned on the resumed thread (exit 0, 1 982 743 ms after the resume; report `tmp/codex/u4-elements-answer.md`): 17 files modified, `src/core/elements/` and `tests/src/core/elements/` created (+1 205/−17); 18 claims (11 acceptance, 7 design choices); five red-then-green records; the lane's gates: scoped `oxfmt` and `oxlint` 0, `check:src:core` 0, `check:src:server` 0, `test:src:core` 580 passed (43 files), `test:policy` 112 passed, `test:guides` 14 failed (unchanged). Containment: the porcelain diff across the run names owned files only. Orchestrator gates outside the sandbox: `oxfmt --check src tests` 0, `oxlint src tests` 0, `test:src` 742 passed (50 files), `test:policy` 112 passed, `test:setup` 53 passed, `test:service` 14 passed in real Chromium, `test:guides` 14 failed; `npm run check` (the root tsconfig over `tests/**`) 2 on one pre-existing line in the U6 registry test (`transport.sent.length = 0` on a readonly log, `tests/src/core/BrowserRegistry.test.ts:626`), fixed by the Orchestrator as a recorded offset and `slice(offset)` (`check` 0, the file's 19 tests pass). Lesson: the merge gates ran the source-only typechecks; the full `check` covers the tests and belongs in every acceptance.
- U4 review dispatched: `reviewer` (Opus, objective lane) over `tmp/units/u4-claims.md` (16 claims) and `tmp/units/u4-diff.patch`, with eight load-bearing traces named (abort between press and release, navigation between capture and publication, the out-of-process click, the wait re-send against an older loader, concurrent outlines, a context clear mid-evaluation, a reference after destruction, a reallocated backend id) and the consumer-fit questions for U7 and U10.
- Container restart (2026-09-30, after the U5 scout returned) killed the U4 `reviewer` (Opus, native agent, no report). The tree and the inputs survived (`git status` 21 paths, all U4's; `tmp/units/u4-claims.md`, `u4-diff.patch`, `u5-scout.md` intact); the review relaunched on the same inputs. U5 terrain scouted meanwhile (`scout` on Sonnet, `tmp/units/u5-scout.md`: 2 source and 2 test files to delete, 13 compilers and 11 types in the deletion set, codegen emitting `page.click`/`fill`/`select` with no `press` action, two `cancel` members to rename, `mask` typed over locators, 32 guide table rows plus two interface sections to drop).
- U4 review (Opus `reviewer`, objective lane, relaunched, 821 692 ms): FAIL 2, 3, 5, 15; outside O1 blocking, O2–O5 required, O6–O13 optional, O14 unresolved. Before ruling, a fifth probe series ran against real Chromium (`tmp/probes/cdp-native-5.test.ts`; P21–P26, logs `tmp/units/probe-cdp-native-series5.log` and `series5b.log`): P21 the page session hit-tests a point inside an out-of-process frame to the iframe owner and the child session to the button; P22 `includeUserAgentShadowDOM` returns the inner shadow node of an input, a textarea, and a select; P23 `Input.insertText('')` after select-all clears the value (O4 refuted); P24 content quads are viewport-relative, the click lands at the viewport point, and `DOM.getNodeForLocation` takes document coordinates and reports nothing for a point scrolled out of view; P25 a back-forward cache restore emits `Page.frameNavigated` alone (the first run's own `no-store` header had defeated the cache); P26 an iframe's content quads are its border box and only the content-box offset lands the click. Rulings in `.orkestrel/browser/u4-review-verdict.md`. `PROPOSAL.md` amended: click steps 3 and 4 (content-box offset; the hit test on the element's own session at the frame-local point in document coordinates without the shadow flag) and U4 acceptance 10 (a `BackForwardCacheRestore` navigation is ready at once). Fix round dispatched to the same Astra thread (resumed) on `tmp/codex/u4-fix-brief.md` (H1–H17, each with a mutation probe; the five original probes re-run whole-file), journal `tmp/codex/u4-fix.jsonl`, cap 5 400 s.
- U4 fix round returned on the resumed thread (exit 0, 1 372 339 ms; report `tmp/codex/u4-fix-answer.md`): H1–H17 applied; 17 mutation probes red then green, run whole-file with the failing assertion line quoted and the logs kept under `tmp/codex/u4-mutations/` (the five original records re-run the same way); the lane's gates: scoped `oxfmt` and `oxlint` 0, `check` 0, `check:src:server` 0, `test:src:core` 593 passed, `test:policy` 112 passed, setup 29 passed, `test:guides` 14 failed (U12). Containment: the porcelain diff across the run shows only the Orchestrator's own `PROPOSAL.md` commit. One deviation: the sandbox refused a nested Node spawn for the lane's mutation runner (`EPERM`), so the lane ran each probe by direct command.
- U4 accepted after the Orchestrator's gates outside the sandbox: `npm run check` 0, `oxfmt --check src tests` 0, `oxlint src tests` 0, `test:src` 755 passed (50 files), `test:policy` 112 passed, 1 skipped, `test:setup` 53 passed, `test:service` 14 passed in real Chromium, `test:guides` 14 failed (unchanged). Committed as one checkpoint (21 files, +3 152/−17).
- U4 accepted at `f6750f8` and pushed. U5 `removal` dispatched to a `builder` (Sonnet) in the main checkout on the brief `tmp/units/u5-brief.md` (drafted from `tmp/units/u5-scout.md`; rulings inside it: the exported `BROWSER_VISIBILITY_SOURCE` becomes a module-private constant of the actionability compiler; the screenshot mask resolves element geometry before compiling; the frame keeps `keyboard`, `mouse`, and `touch` until U7 decides; `test:guides` cannot exit 0 before U12, so U5 removes the deleted symbols' rows and reports the remaining count; the network failure's `cancelled` field is a transliteration and stays). U7 terrain scouted in parallel (`scout` on Sonnet, read-only, told to avoid the files U5 edits).
- U5 builder stopped once before editing anything: it issued a stray index-wide `git rm --cached -r .` that the permission layer denied (correctly), after which a read-only `sed` batch was denied as collateral; it asked whether to continue. Resumed with the constraints restated (read through the Read and Grep tools, edit through Edit and Write, delete the four files with plain `rm`, never an index or working-tree git command); nothing in the session's permissions changed. The first U7 scout refused for lack of a `map.ts` output path (the scout skill's rule); `map.ts` run over the checkout (`tmp/units/u7-map.md`, 698 lines) and the scout re-dispatched with it; its report is `tmp/units/u7-scout.md`. Lesson: name the mechanical map's path in every scout dispatch. U7 brief drafted in the scratchpad against the map, with rulings R1–R7 (the frame's input members move to the page; one execution boundary bounding every string and forwarding the signal; the tool source contract `{ emitter, tools(), adopt() }` the registry already satisfies; the name pattern `^[A-Za-z0-9_-]{1,64}$` from the two provider rules; the navigation-request subscription through the page; the retained reading's key; `native` as the seven CDP tools).
- U5 `removal` returned (builder on Sonnet, 614 878 ms after the resume): R1–R6 applied; four files deleted with `rm`; 14 compilers, 3 constants, the selector error, and 13 types gone (`BrowserActionOptions` and `BrowserPointerOptions` deleted with their last consumers; `BrowserOperationOptions` narrowed; the input option types kept); the visibility source became a local constant of the actionability compiler (a module-level one failed `policy/no-hidden-declaration`); codegen emits `await (await page.elements.find({ css: S }))[0].click()` and its siblings; `abort` and `dismiss` renamed with the `aborted` status; `mask` takes elements and the page resolves their quads before compiling the overlay; the guide lost every row, section, import, and fence naming a deleted symbol. One blocker reported: the service replay case failed because `BrowserElement.fill` on a contenteditable threw `Element is not a text control` (a U4 gap the review had noted as optional). Ruling: the CDP placement fills a contenteditable (the proposal refuses it only in the DOM placement); the Orchestrator patched `compileSelectFunction`'s no-argument branch to select the editable's children through `getSelection().selectAllChildren` so the trusted `Input.insertText` replaces them, proven by the service project (14 passed in real Chromium, the replay case included) and the compiler and element unit files (33 passed).
- U5 accepted after the Orchestrator's gates: `npm run check` 0, `oxfmt --check src tests guides` 0, `oxlint src tests` 0, `test:src` 719 passed (48 files), `test:policy` 112 passed, 1 skipped, `test:setup` 53 passed, `test:service` 14 passed, `test:guides` 11 failed (147 passed; every failure U1–U4 drift for U12, none naming a removed symbol); the acceptance Grep over `src` and the `setInterval` Grep both empty. The two selector-scripting helpers in `tests/setup.ts` are unused by any test but their own; U7 removes them.
- U5 accepted at `5315802` and pushed. U7 `toolset` dispatched to the `opus` lane on `tmp/units/u7-brief.md` (rulings R1–R7, plus R8: the two unused selector-scripting helpers and their setup tests deleted). R3 amended mid-run by message: `tools()` is optional on `BrowserToolSourceInterface`, because the in-browser bridge (`ModelContextInterface`) exposes `adopt()` and a `change` emitter but no tool census, and U9 promotes the type test that proves it satisfies the contract structurally; without a census the toolset decides the name cases alone and applies the source's adoption as is.
- U9 terrain scouted with a map (`tmp/units/u9-map.md`, `tmp/units/u9-scout.md`): no browser entry, project, alias, scripts, or setup files exist; `tests/config.test.ts:153-158` already expects the `src:browser` project shape when `src/browser` exists; mcp carries the fleet precedent (browser tsconfig with DOM libs, the Playwright provider on one headless Chromium instance, a global setup that provides a fixture server); the registry's `@vitest/browser-playwright` 5.0.2 belongs to the vitest 5 line, so U9 pins `^4.1.11` against the installed vitest 4.1.11 as mcp does, with `playwright ^1.63.0`; the D3 type probe to promote is `tmp/probes/source-shape.ts`. U9 brief drafted in the scratchpad (E1–E5).
- U7 `toolset` returned (Opus lane, 2 597 407 ms; the R3 amendment applied mid-run): `src/core/BrowserToolset.ts` (998 lines) and its 28-test file added; contracts, constants (`BROWSER_TOOL_LIMIT`, `BROWSER_TOOL_TIMEOUT_MS`, `BROWSER_TOOL_TIMEOUT_LIMIT_MS`, `BROWSER_TOOL_NAMES`, `BROWSER_TOOL_NAME_PATTERN`, `BROWSER_SCHEMES`, `BROWSER_TOOL_COPY`), helpers (`boundBrowserText`, `renderBrowserElement`, `readBrowserReference`, `readBrowserToolString`, `renderBrowserReceipt`), and `createBrowserToolset`; R1 moved the input members to the page; R8 deleted the two selector helpers; 22 discriminating mutants and one equivalent (M6, both ownership guards enforce one criterion; M23 removes both and reds); the lane's gates green (`test:src` 755, `test:service` 14, `test:guides` 11 failed, none naming a moved or deleted symbol). Deviations accepted: the registry cut only error text and JSON, so the boundary's bound is load-bearing and the TSDoc states it; two proof cases added to `tests/setup.test.ts` for the fixture options; `BrowserDialogInterface.accept`/`dismiss` and `keyboard.press` take no signal (checked before sending; a later unit widens them); the fixture's `WebMCP.enable` now fails with `-32601` by default. Orchestrator gates outside the lane: `npm run check` 0, `oxfmt --check src tests` 0, `oxlint src tests` 0, `test:src` 755 passed (49 files), `test:policy` 112 passed, `test:setup` 53 passed, `test:service` 14 passed, `test:guides` 11 failed. Review dispatched: `analyst` driver (Sonnet) writes the objective brief for an Astra read-only lane over `tmp/units/u7-claims.md` (16 claims) and `tmp/units/u7-diff.patch`, with ten load-bearing traces named.
- U7 objective review launched: the `analyst` driver's brief `tmp/codex/u7-review-brief.md` (`brief.ts --check` 27 checked, 0 missing); Astra read-only lane through `launch.ts` (journal `tmp/codex/u7-review.jsonl`, thread `01a0f004-6939-76f2-aba6-88b17d5fc1f4`, cap 3 600 s, `-C /home/user` for the sibling checkouts). U10 terrain mapped with `map.ts` in both checkouts (`tmp/units/u10-map.md`, `tmp/units/u10-map-mcp.md`) and a scout dispatched over them (read-only, beside the read-only review lane).
- U7 objective review returned (Astra `analyst`, 473 576 ms, read-only, no tree change): FAIL 5, 9, 11, 12, 15, 16; outside O1–O5 required, O6 blocking. Every BROKEN followed in the cited lines before ruling; rulings in `.orkestrel/browser/u7-review-verdict.md`. O6 (the engine takes a page, so U10's DOM view cannot drive it) matched the U10 scout's headline and is ruled as the view-generic constructor with the page-only capabilities behind `options.page` and a per-instance `native`. Fix round dispatched to the same Opus lane (resumed) on `tmp/units/u7-fix-brief.md` (F1–F12; every red run logged under `tmp/codex/u7-mutations/` with its assertion line quoted; the earlier M1–M23 record counts only when re-run that way). U10 terrain scouted (`tmp/units/u10-scout.md`, with the Orchestrator's correction that `BrowserConnectionError` already lives in core at `src/core/errors.ts:162`).
- U17 mirrors prepared (2026-09-30T02:04:45Z, `tmp/webmcp/revisions.txt`): the GitHub commits API is gated by the session's repository scope, so the revisions are the upstream branch tips read through the git proxy with `git ls-remote` (`webmachinelearning/webmcp@main` `19fc56516057`, `web-platform-tests/wpt@master` `e6ba3d7abea7`, `ChromeDevTools/devtools-protocol@master` `dc2ddf369035`) and each source refetched at that commit from the raw host: `index.bs` 86 547 bytes (`e6c9b979…`, unchanged since 2026-09-29), `interfaces/webmcp.idl` 2 136 bytes (`eddabc79…`, unchanged), `browser_protocol.json` 1 415 827 bytes (`672d8481…`); the `WebMCP` domain cut by raw byte range 1 404 474–1 415 819 (11 345 bytes, `13fb5654…`, parses standalone). The mirror files land under `tests/mirrors/` with U17.
- Parallel tracks opened (2026-09-30, the owner's "see what you can do in parallel"; ultracode on, every workflow agent pinned to Sonnet or Opus): U9 `environment` dispatched to a `builder` in the worktree `tmp/worktrees/u9` (branch `ccr-d15a48b1-yyyll6-u9` from `1d911da`; files disjoint from U7's) with two amendments (its `types.ts` declares `BrowserDocumentOptions` and its `constants.ts` `BROWSER_DOCUMENT_TIMEOUT_MS`, so nothing depends on U7's contracts; E4, the promoted type test, deferred to the merge that carries U7); an acceptance-regression sweep (workflow `acceptance-regression-sweep`, run `wf_27654cd9-d8d`: seven Sonnet readers over U1–U6 and U8's acceptance lists against the clean worktree, three Opus refuters per drift finding, one Opus completeness critic; read-only, no commands); a second worktree `tmp/worktrees/u11` (branch `ccr-d15a48b1-yyyll6-u11` from `1d911da`, `npm ci` 0) for the service proofs of the landed surface (U11's half that needs neither U7 nor U10).
- U11a (the service proofs of the landed surface: P11, P15, P16, P18, P19, P21–P26 promoted through the public surface with their controls; the toolset and DOM halves deferred to U11b) dispatched to an `opus` lane in the worktree `tmp/worktrees/u11`. Mechanical maps generated for U17 (`tmp/units/u17-map.md`, `u17-map-mcp.md`: mcp's conformance precedent, the pinned mirrors) and for ollama's U14 (`tmp/units/u14-map.md`); their scouts follow.
