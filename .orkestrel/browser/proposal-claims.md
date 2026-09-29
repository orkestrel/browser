# Claims: the reconciled `@orkestrel/browser` redesign proposal

## Subject

The proposal draft at `tmp/units/design-reconciled.md` in `/home/user/browser` (branch `ccr-d15a48b1-yyyll6`, tip `7a3e7fb`, working tree clean; the draft is untracked under `tmp/`). It is the reconciliation of two blind design lanes: `tmp/units/design-subjective.md` (Opus 5.5, subjective) and `tmp/units/design-objective.md` (Opus 5.5 holding the objective lane). It will replace `PROPOSAL.md` and authorize the implementation campaign. No prior falsify round has run on it.

## What the round decides

This round decides whether the proposal is committed as `PROPOSAL.md` and the implementation units are dispatched against it.

## Already established

The Orchestrator verified each of the following itself; do not re-derive or re-report it.

- 17 runtime probes passed on the host Chromium 141.0.7390.37 with controls: `tmp/units/probe-cdp-native-3.log` (P1–P8, 8 of 8), `tmp/units/probe-cdp-native-series2b.log` (P9–P13, 5 of 5), `tmp/units/probe-cdp-native-series3c.log` (P14–P17, 4 of 4). The probe sources are `tmp/probes/cdp-native.test.ts`, `cdp-native-2.test.ts`, and `cdp-native-3.test.ts`.
- The type probe `tmp/probes/source-shape.ts` compiled under `tsc --ignoreConfig --strict` with its `@ts-expect-error` control.
- Four real-model runs (`tmp/units/probe-browser-agent.log` through `-4.log`; final probe source `tmp/units/browser-agent-probe-final.test.ts.txt`) with the readings in the proposal's "The real-model runs" table; run 4 passed 3 of 3 on the first attempt.
- The direct daemon readings on Ollama 0.34.4 streamed tool calls (`tmp/units/ledger.md`, "Real-model" section).
- `@orkestrel/agent` reads `tools.definitions()` each turn (`/home/user/orkestrel/agent/src/core/Agent.ts:436`); `ToolManagerInterface.add` overwrites a same-named tool (`../tool/src/core/types.ts:208-219`); `@orkestrel/mcp` carries `playwright` and `@vitest/browser-playwright` as development dependencies (`../mcp/package.json:117,120`); `tests/config.test.ts:153-158` forces the `src:browser` project when `src/browser` exists.

## Review evidence

The subject is a proposal, so the evidence is: the proposal (`tmp/units/design-reconciled.md`); the canon it must satisfy (`../scaffold/AGENTS.md`, `../scaffold/.claude/rules/*.md`, `../scaffold/.agents/orchestration.md`, `guides/browser.md` § Contract at lines 1850–2065, `tests/config.test.ts`, `tests/setupPolicy.ts`); its motivation (the owner's words, recorded in `tmp/units/browser-design-brief.md` § Motivation); the sibling contracts (`../tool/src/core/types.ts`, `../mcp/src/browser/types.ts`, `../mcp/src/browser/factories.ts`, `../html/src/core/types.ts`, `../markdown/src/core/types.ts`); the current source under `src/`; the known consumer under `/home/user/orkestrel/ollama` (`package.json:84`, `tests/setupServer.ts:1094-1150`, `tests/service/page.test.ts`); the protocol schema `tmp/units/browser_protocol.json` (the `WebMCP` domain at lines 30839–31094); and the research report `tmp/units/webmcp-research-report.md`. `git status --porcelain` is empty; `tmp/` is ignored.

## Numbered falsifiable claims

Each claim names a property a concrete input, state, or interleaving could show false. The primary lane is named where the lanes differ in strength; no lane skips a claim.

1. **Reference identity holds under every ordering.** Under the proposal's rules (one counter per browser context; a table dropped on cross-document navigation of the main frame; child-frame keys unresolvable after that frame navigates or detaches; references kept across same-document navigation; the cursor following a popup and returning), no sequence of `look`, `navigate`, same-document route, popup open and close, frame navigation, and DOM mutation lets a reference resolve to an element other than the one it named. Primary: objective. Name the interleaving that breaks it, or the attack that failed.
2. **No action leaves the page in a held-input state.** Under abort at any point of `click`, `type`, `press`, or a queued action, the `Input` domain never has a pressed button or key without its release, and the queue never runs two actions concurrently. Primary: objective.
3. **A dialog is always reported within one tool result.** Whatever the timing of `Page.javascriptDialogOpening` relative to an action (during the pending mouse-up per P14, after the receipt returned, or with no action in flight), the model's next tool result names the dialog and the `dialog` tool is advertised by then, and every other tool refuses while it is open. Primary: subjective.
4. **Every advertised tool streams.** Every tool in the vocabulary table, including staged and opt-in tools, declares at least one required parameter, so a call in which the model omits every optional parameter still carries a parameter (the Ollama 0.34.4 streamed-parser reading). Primary: objective.
5. **Every tool result is bounded.** For every tool, the result text is at most `limit` characters plus a stated footer, including a `click` receipt whose fresh view exceeds `limit`, a `read` whose distilled Markdown exceeds `limit`, and a page tool whose output is a 1 MB string. Primary: objective.
6. **A continuation read never splices two captures.** For every sequence of `read` calls with offsets, navigations (both kinds), and DOM mutations, a `read` at a positive offset returns text from the same capture the previous slice came from, or resets to offset 0 and says so. Primary: objective.
7. **No page tool can replace, shadow, or survive the toolset.** Under every registration order (a page tool registered before `start()`, a consumer tool added after adoption under a page tool's name, two frames registering one name in either order, a name with a period, a `debugging` tool), a generic tool and a consumer's tool are never overwritten, and `destroy()` never removes a consumer's tool. Primary: objective.
8. **Registry detection cannot misclassify.** Only a `CDPError` with `context.code` `-32601` maps `start()` to `false`; a timeout, a disconnect, or any other code rethrows; a `toolsAdded` fired synchronously by `enable` is mirrored; a `toolResponded` parsed in the same synchronous burst as the `invokeTool` reply settles the invocation; a foreign `toolResponded` never settles it and never grows an unbounded buffer; an abort before the invocation id arrives still cancels. Primary: objective.
9. **The DOM placement fakes nothing.** No advertised DOM tool returns a success receipt for an input the page did not receive: enumerate the DOM tool set from the table and, for each, name an input for which a native call reports success while nothing happened, or the attack that failed. Attack `HTMLElement.click()` on a `target="_blank"` link, a `<select>`, a disabled control, a contenteditable region, and a cross-origin frame. Primary: subjective.
10. **The three faces respect their environments.** No type or member the proposal places in `src/core` names a DOM or Node type (`Element`, `Document`, `WeakRef<Element>`, `WebSocket`, `ChildProcess`, `Buffer`), and no member placed in `src/browser` needs Node. Enumerate the proposed exports from the proposal text, not from a table the writer produced. Primary: objective.
11. **No rule is violated by a name or a shape.** No proposed export or member is named `cancel`, `run`, `reset`, `kind`, or `type`; no bare export begins `Tool`, `WebMCP`, `ModelContext`, `Markdown`, or `HTML`; nothing re-exports a dependency symbol; every added member is one word; no stored flag duplicates derivable state; no compatibility shim, alias, or deprecation survives. The `type` tool name is data, not a member. Primary: subjective.
12. **The poll ban holds with one named exception.** After the proposal, the only condition-testing timer loop under `src` is the process-group drain in `src/server/Browser.ts`, and every other wait names its event source in the event table. Name a wait the proposal keeps or adds whose source is missing from that table. Primary: objective.
13. **The clean-break rule holds.** For every deleted or renamed member, the proposal names its replacement or rules the capability out of existence, and no consumer call in `/home/user/orkestrel/ollama` other than the five `evaluate` sites breaks. Grep that checkout yourself. Primary: subjective.
14. **The removal gate holds.** Every deletion in "What goes" is a capability that must not exist under `../scaffold/AGENTS.md:63`, not a symbol removed on the owner's general permission; and every retained mechanism the owner's words would license deleting is kept with a stated reason. Name a row where the ruling and the rule disagree. Primary: subjective.
15. **The guide's contract can be made true.** No invariant in `guides/browser.md:1850-2065` survives the proposal in a form the design contradicts without U12 naming its rewrite; name any invariant the units leave contradicted. Primary: subjective.
16. **The acceptance criteria discriminate.** For each unit, name the mutation of the implementation that the criteria would not catch and that would break a claim in the proposal (a `wait` that polls at 1 s but passes the Grep; a `destroy` that removes by name; a reference counter per page). The claim is broken if a mutation contradicting a proposal invariant passes every listed criterion. Primary: objective.
17. **The real-model criteria are not vacuous.** U15's criteria cannot be met by a model that never touches the page: name how each task's ground truth is read from the page, and whether a model that answers from the seeded first-turn view alone could pass the click and search tasks. Primary: subjective.
18. **The receipt race is sound.** With P12 (the navigation request arrives before the mouse-up settles) and P14 (the dialog opening arrives while the mouse-up is pending), the rule "race the mouse-up settlement against the page's navigation-request and dialog events" produces the right receipt for: a click that navigates, a click that opens a dialog, a click that does both (a `beforeunload` prompt), a click that starts a navigation the server never answers, and a plain click. Primary: objective.
19. **The environment map has no missing edge.** Every import the proposed units need is in the map's `Imports` column, and every edge is one the rules permit; in particular `src/browser` never needs `@orkestrel/websocket` or `node:*`, and `src/core` never needs `@orkestrel/mcp`. Primary: objective.
20. **The package is coherent as a whole; would you ship it?** Name the one design decision you would reverse, with the concrete consumer or model interaction that shows it wrong, or state that none reaches the `BROKEN` standard. Primary: subjective.

## Unknowns

- Whether an out-of-process frame's `DOM.getContentQuads` is frame-local and whether page-session `Input` coordinates reach its node. The proposal lists it as a limit for U11 to read; a lane that can rule from the protocol schema reports it under claim 1.
- Whether Chromium reuses a `backendDOMNodeId` within a renderer after collection. Listed as a limit; report under claim 1 if a source settles it.

## Where a lane may run a probe

Neither lane has a shell. The Orchestrator ran every probe and hands over the logs named under "Already established". A lane that needs a reading it cannot take reports the claim `UNRESOLVED` and names the probe that would settle it.

## The threshold

A finding is worth more than a clean pass: the alternative is a consumer or a model finding it after the campaign has built on this proposal. `CONFIRMED` requires naming the attack you tried that failed. A claim you cannot decide is `UNRESOLVED`, not `CONFIRMED`; say what would settle it. Do not hedge toward an imagined consensus. Assume this proposal has one more defect of the class the two lanes each missed: the subjective lane refused an in-browser CDP transport and folded page tools into the vocabulary; the objective lane put page tools behind a `call` meta-tool and read the process group once; the reconciliation ruled between them.
