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
