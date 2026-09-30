# Design brief: browser journeys (recorded flows that replay as they are or with changes)

## Question (the owner's words)

"Explore how we can use this to automate browser work, as in recording repeated steps or flows that can be called and done again as is or with changes, adding, removing, or specific input or step changes. We have codegen which should be improved accordingly but we should also have a way to do it with MCP and environment agnostic ways to do these and make changes as needed. Also it needs to work well with our orkestrel-journey skill which would most likely use this as well. Also, I would want to come up with a browse mcp script like our probe script and have them stored in a `tmp/browsers` much like probe."

## Role and lane

- You hold ONE of two blind design lanes on this brief and read only this brief, the terrain, and the canon; the other lane's output does not exist for you. Read-only: edit nothing, spawn nothing, write no process diary.
- The OBJECTIVE lane (Astra `analyst`) owns: the journey data model and its invariants, the record and replay algorithms over the page and element contracts, target resolution on a changed page, the edit model (add, remove, alter a step, substitute an input) and what a replay does when an edit cannot apply, the settlement of each replayed step, the MCP tool surface and its argument schemas, the browse binary's protocol and the `tmp/browsers` layout, the failure and receipt vocabulary, the load-bearing claims a real-Chromium probe must settle, and the units in dependency order.
- The SUBJECTIVE lane (Opus `planner`) owns: the API shape and names in `src/core`, `src/browser`, and `src/server`, the guide voice and the sections the guide gains, the vocabulary shared with the `orkestrel-journey` skill and with codegen, the developer ergonomics of recording, editing, and running from Node, from a page, and through MCP, the browse binary's operator experience, and the units as a developer would cut them.
- Both lanes write the same output shape so the reconciliation can lay them side by side.

## Terrain (read before you design; paths absolute)

- The package as it stands (branch `ccr-d15a48b1-yyyll6`, 0.0.19): `/home/user/browser/guides/browser.md` (the whole guide; in particular the toolset and its receipts, `BrowserNavigationRecordInterface` and the settlement contract, `BrowserCodegenInterface` and "Record and replay interactions with codegen", "Host the toolset over MCP", "Publish native tools to a page", the invariants list), `/home/user/browser/src/core/BrowserCodegen.ts`, `/home/user/browser/src/core/BrowserToolset.ts`, `/home/user/browser/src/core/BrowserNavigationRecord.ts`, `/home/user/browser/src/core/BrowserElementManager.ts`, `/home/user/browser/src/core/compilers.ts` (`compileCodegenScript`, the submit observer), `/home/user/browser/src/core/types.ts`, `/home/user/browser/src/browser/factories.ts` (`createDocumentToolset`), `/home/user/browser/src/server/Browser.ts`, `/home/user/browser/package.json` (exports `.`, `./browser`, `./server`; no bin).
- The scout's map of the terrain: `/home/user/browser/tmp/units/journey-scout.md` (read whole) and `/home/user/browser/tmp/units/journey-map.txt` (by section).
- The campaign's records: `/home/user/browser/.orkestrel/browser/ledger.md` (the settlement unit, C7, C8, and the store proof's runs v5–v10 with what a 2-billion-parameter model did over the toolset), `/home/user/browser/.orkestrel/browser/c6-probe-report.md` and `c7-probe-report.md` (the protocol readings and the probe instruments' shape), `/home/user/browser/tmp/probes/c6/` and `c7/` (the instruments: a recording transport, module-level helpers, tapes under `logs/`).
- The closest recorded run today: `/home/user/ollama/tests/setupStore.ts` (`StoreTranscript`: calls in order with results, the state judged, the oracles; written under `tmp/probes/logs/<task>-<attempt>.json`) and one transcript, `/home/user/ollama/tmp/probes/logs/v10/click-1.json`.
- The `orkestrel-journey` skill: `/home/user/scaffold/.agents/skills/orkestrel-journey/SKILL.md`, `references/layer.md` (the `@orkestrel/test/browser` verbs: role and accessible name, trusted input, `createJournal`), `references/decide.md` (the per-variant artefact under `tmp/`), `references/captures.md`. The skill never names `@orkestrel/browser`.
- The probe package (read-only clone): `/home/user/orkestrel/probe/README.md`, `src/bin/main.ts`, `src/server/ProbeServer.ts` (a `ToolManager` with one tool behind `createMCPServer` and `createStdioServer`), `src/core/types.ts` (`Claim`, `Verdict`, the receipt), `package.json` (`bin`).
- The mcp package: `/home/user/mcp/guides/mcp.md` § "Expose a tool registry over MCP" and the stdio and WebSocket transports; `/home/user/mcp/src/core/factories.ts`, `/home/user/mcp/src/server/factories.ts`.
- Canon: `/home/user/scaffold/AGENTS.md`; `/home/user/scaffold/.claude/rules/{architecture,patterns,names,typescript,tests,writing}.md`; `/home/user/scaffold/.agents/orchestration.md` § Routing for how a unit is sized.

## Constraints

- Core stays environment agnostic: a journey, its recorder, its editor, and its runner live in `src/core` over the page and element contracts (`BrowserPageInterface`, `BrowserElementInterface`, the navigation record); the in-page face replays over the DOM view; the server face adds only launching, files, and the binary.
- A step names its target the way the toolset does (role, accessible name, and the reference at record time), with the CSS selector kept as a fallback, so a replay resolves the target on a changed page and reports what it resolved; a step that acts settles through `navigation.record(frame)` the way the toolset's actions do, and its receipt uses the toolset's receipt vocabulary.
- A journey is data (JSON) before it is code: recorded once (from the toolset's calls, from the page's own events as codegen records them, or written by hand), edited by adding, removing, or altering steps and by substituting inputs, then run; codegen compiles the same data to a script, replacing the four-action CSS recorder or subsuming it.
- MCP exposes the operations as tools (at least record, list, run, and edit; rule on each) over the same tool manager the toolset publishes, so a model host, the browse binary, and a Node program see one surface; the package does not wrap WebMCP and does not depend on it.
- The browse binary is one stdio MCP server like probe's `probe` bin, registered the same way, with runs under `tmp/browsers/<journey>/<run>/` (the journey file, the substituted inputs, the receipts, the captures) and nothing persisted elsewhere; rule on what the operator types to record, list, run, and edit from the command line versus from the model host.
- The `orkestrel-journey` skill's verbs and journal shape are the vocabulary to align with: a skill journey can call a recorded journey as a step, and a recorded journey's run produces the journal the skill reads; state exactly which names are shared and which stay distinct, and what the skill needs to change (a proposal, since the skill is scaffold's).
- Breaking changes to `@orkestrel/browser` are allowed; every existing invariant the guide lists must be kept or explicitly retired with the reason.

## Output shape

Write one Markdown file (the objective lane `/home/user/browser/tmp/units/journeys/design-objective.md`, the subjective lane `/home/user/browser/tmp/units/journeys/design-subjective.md`; the Orchestrator supplies the writable path when the lane cannot write: then the file's content is your final message), with these sections in this order:

1. **The design in one paragraph.**
2. **The journey data model** (types with TSDoc-level descriptions; the invariants; the file layout under `tmp/browsers`).
3. **Recording** (what is recorded from which source, the resolution data kept per step, what is never recorded).
4. **Replay** (the algorithm per step kind; target resolution on a changed page with its fallbacks and its refusals; settlement; the run record and receipts; what stops a run).
5. **Editing** (the operations, their invariants, and the replay's behaviour when an edit cannot apply).
6. **Codegen** (what the compiler emits from a journey; what happens to the four-action recorder).
7. **The MCP surface** (each tool: name, arguments, result, refusals) and **the browse binary** (registration, the operator's commands, the run directory).
8. **The `orkestrel-journey` alignment** (the shared vocabulary and journal shape; the proposal to the skill).
9. **Alternatives ruled out** (each with the reason).
10. **Load-bearing claims** (numbered; each with the probe or test that settles it).
11. **Units** (bounded, in dependency order, each with its owner files, its acceptance criteria, and the lane that implements it under `.agents/orchestration.md` § Routing).
12. **Unresolved** (what you could not decide and what would settle it).
