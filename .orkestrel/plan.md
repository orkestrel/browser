# Fleet campaign plan: the contract wave, the journeys release, and the browse server

Opened 2026-10-01 after the journeys campaign in `@orkestrel/browser` closed (`d221d4b`) and the units that needed no publish landed (browser `ROADMAP.md` items 5, 4, 1, and 2 at `5363263`; scaffold item 39 at `dc1c96e`). Read the registry, then the wave, then the unit you run; `.agents/orchestration.md` gives the dispatch form and the `orkestrel-publish` skill the release procedure.

## Registry

| Row | Value |
| --- | --- |
| Goal | `@orkestrel/contract` 0.0.19 reads a JSON Schema `type` array, and the session's packages that depend on it re-pin and republish; `@orkestrel/browser` 0.0.19 ships the journeys with its `ROADMAP.md` empty; scaffold 0.0.83 gives every workspace with a browser, Vue, or styles surface the `browse` server; the ollama store proof runs against the published browser |
| Exit criterion | the registry serves contract 0.0.19, html 0.0.12, tool 0.0.18, markdown 0.0.17, mcp 0.0.34, browser 0.0.19, ollama 0.0.20, and scaffold 0.0.83; each session repository's branch `ccr-d15a48b1-yyyll6` carries its release commit; the out-of-session obligations are recorded where the next visit reads them; `.orkestrel/` in every repository is empty |
| Owner rulings, 2026-10-01 | the contract fix publishes now and cascades only to the session's packages; `browse` reaches every workspace with a browser, Vue, or styles surface (veneer first); browser item 3 rides `BrowserToolsetResult`, so `@orkestrel/tool` moves only for the contract re-pin; the ollama turn lever lands after the wave |
| Session repositories | contract, html, tool, markdown, mcp, browser, ollama, scaffold, and veneer (the propagation proof), all on `ccr-d15a48b1-yyyll6`; the owner merges to `main` |
| Authority | the owner publishes: every window needs the owner's npm approval at the keyboard; lanes are `astra` (Codex) or `opus`, never the session model; one writer per checkout |

## The wave

Each window publishes one layer after every package in it visited green, bumped from the registry, re-pinned to the previous window, passed its `prepublishOnly`, and pushed its release commit. A caret on a 0.0.x range pins one release, so a package re-pins only after its dependency is on the registry.

| Window | Packages | Waits on |
| --- | --- | --- |
| W1 | contract 0.0.19 | unit C1 landed |
| W2 | html 0.0.12, tool 0.0.18 | W1 |
| W3 | markdown 0.0.17, mcp 0.0.34 | W2 |
| W4 | browser 0.0.19 | W3, unit B3 landed |
| W5 | ollama 0.0.20 | W4, unit O1 landed |
| W6 | scaffold 0.0.83 | W5, unit S38 landed, the catalog verb run |

## Status, 2026-10-01

W1 to W4 are on the registry, each confirmed by `npm view`: contract 0.0.19, html 0.0.12, tool 0.0.18, markdown 0.0.17, mcp 0.0.34, browser 0.0.19. W5 (ollama) and W6 (scaffold) remain; their visits run first.

## Units

| Unit | Repository | Engine | Status |
| --- | --- | --- | --- |
| C1: `schemaToShape` converts a `type` array to the union of its members | contract | astra | landed `704e5d4`, published 0.0.19 |
| B3: the coded fault of a `perform` rides `BrowserToolsetResult`; browser `ROADMAP.md` item 3 | browser | opus | landed `188a2d7`, published in 0.0.19 |
| S38: `@orkestrel/browser` joins the development dependencies of a browser, Vue, or styles blueprint; the `browse` registration has one home | scaffold | opus | landed `438e808`; scaffold item 40 (lockfile install and catalog) rides W6 |
| M0: markdown proves `tests/setupGuides.ts` in its sibling test, as the scaffold 0.0.82 policy requires | markdown | opus | landed `f106c4f`, published in 0.0.17 |
| O1: retire `normalizeSchemaTypes`, the turn lever in the store proof's turn handling, three live runs (`ollama/plan.md`) | ollama | opus | the journeys history is rebased onto `f97df76` at `df7ecd6`; the visit re-pins it; the lane follows |
| V1: veneer's visit proves scaffold 0.0.83 delivers `@orkestrel/browser` and the `browse` rule; register `browse` and record a journey against veneer's app | veneer | host and opus | after W6 |
| Close: re-pin `@orkestrel/scaffold` `^0.0.83` and `repair` in each session repository; empty `.orkestrel/` | all | host | after W6 |

## Out-of-session obligations

The owner limited the cascade to the session's packages. These consumers re-pin at their next visit: `@orkestrel/probe` (mcp `^0.0.34`, tool `^0.0.18`), `@orkestrel/agent` and `@orkestrel/toolbox` (tool `^0.0.18`), `@orkestrel/guide` (markdown `^0.0.17`), and the 41 other catalog packages that pin contract `^0.0.18`. Until they do, an install that combines them with a session package carries two copies of the moved dependency.
