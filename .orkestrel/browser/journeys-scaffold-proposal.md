# J13: the scaffold proposal for journeys, reconciled with scaffold 0.0.82

The design's § 9 named four scaffold edits and the catalog row; the second falsify round added a function-domain registration. None is applied: the scaffold checkout is the owner's, and each item lands only with the owner's word. This revision reconciles every item with scaffold `main` at `7bc3142` (0.0.82), read on 2026-10-01, and rules on the one that cut against convention.

## What moved on main

- The journey skill's read list still names five references (`layer`, `captures`, `styles`, `statechart`, `decide`); its vocabulary says `screen` where it said `surface`, and `app/vue` journeys run through `npm run test:journey:vue`.
- `FUNCTION_DOMAIN_FOLDERS` still registers `app/browser/composables` and `src/server/execution` alone; the nested-function rule widened to callbacks inside object and array literals.
- `.claude/rules/tests.md` mirrors root setup modules both ways: a `tests/setup<Name>.ts` that exports needs `tests/setup<Name>.test.ts` or an import from `tests/setup.test.ts`.
- The catalog table in `.claude/agents/orkestrel.md` is the `catalog` verb's: it rewrites the marker-bounded table (`CATALOG_AGENT_PATH`, `CATALOG_OPENING_MARKER`, `CATALOG_CLOSING_MARKER`) from the registry. On main the browser row reads 0.0.18 at layer 3 and the mcp row 0.0.33.
- `.mcp.json` registers `probe` alone, and `BASE_DEV_DEPENDENCIES` lists `@orkestrel/guide`, `@orkestrel/probe`, `@orkestrel/scaffold`, `@orkestrel/test`, `@types/node`, `oxfmt`, `oxlint`, `typescript`, `vite`, and `vitest`.
- `ROADMAP.md` keeps the fleet's open items under life-long numbers, through 36.

## 1. `.agents/skills/orkestrel-journey/references/recorded.md`

Stands, with the skill's vocabulary. A sixth reference the read list names ("before judging a browser recording's run as evidence"), carrying: what a recorded browser journey is (the JSON of `@orkestrel/browser` § Journeys: a name, a description, declared parameters, and steps naming elements by role and exact accessible name); the verb map from the design's § 9 (`click` to `clickAccessible(role, name)`, `type` to `fillAccessible` with a `combobox` or `listbox` `type` refused, `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and a page tool refused); the rule that a run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists; and the review path (`journeys`, then `edit` with `remove`), because a model's recording keeps every completed action. Gate: the read list names the file; the scaffold policy project is green.

## 2. `.agents/skills/orkestrel-journey/references/decide.md`

Stands, as a row rather than a bullet. The routing table gains: "A flow a model drove through the browser toolset" routes to "A recorded journey replayed through `@orkestrel/browser`, judged by the run's steps ([recorded.md](recorded.md)), never by the model's transcript". Gate: the scaffold policy project is green.

## 3. `.agents/orchestration.md`, the tmp layout table

Stands. One row beside `tmp/captures/`: `tmp/browsers/` for the journeys a browse server saves, their runs and captures, and the server's profiles under `.profiles/`. Gate: the scaffold policy project is green.

## 4. `.mcp.json` and `BASE_DEV_DEPENDENCIES`, two effects ruled apart

Reconciled. `.mcp.json` is a canon path (`CANON_PATHS`) that no target receives, and `.claude/rules/quality.md` says a scaffold target holds no `.mcp.json`, so a `browse` entry there (`node node_modules/@orkestrel/browser/dist/bin/main.js` with `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY`) wires the scaffold checkout alone and needs only a scaffold devDependency on `@orkestrel/browser`; the precedent is `probe`, whose binary the file registers. Adding `@orkestrel/browser` to `BASE_DEV_DEPENDENCIES` is the other effect: it puts the package and its runtime dependencies (`html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, `router`, and `server`) into every generated workspace's development install and wires no MCP server there, so every target registers `browse` per repository through the browser guide's "Register the browse binary" pattern either way. The owner rules on the dependency entry; the scaffold's own `.mcp.json` entry is the owner's convenience.

## 5. The catalog row in `.claude/agents/orkestrel.md`

Reconciled: not a hand edit. The `catalog` verb rewrites the table from the registry, so the browser row moves to 0.0.19 at layer 5 with the dependencies the manifest declares (`html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, `router`, and `server`; the manifest declares router and server as dependencies, not as peers) after mcp 0.0.34 publishes (the browser's mcp edge is the tarball until then), browser 0.0.19 publishes, and the verb runs. The hand-edited rows on the scaffold session branch were returned to main's at the merge (`eb3c009`). Action after the wave: run the `catalog` verb; gate: the scaffold policy project is green.

## 6. `configs/policy.ts`, `FUNCTION_DOMAIN_FOLDERS` — withdrawn, and the convention answered

The second falsify round's subjective lane read `performBrowserStep` and `locateBrowserTarget` as I/O orchestration inside the pure leaf, and the ruling that answered it proposed registering `src/core/journeys` so each could become a function module. Reconsidered against the rule:

- The registration is withdrawn. `.claude/rules/architecture.md` § Kind or folder says registration judges nothing about what a module does, so a function module would change the two functions' declaration shape and leave the I/O composition where it was; and registering a folder reserves its stem fleet-wide through `FUNCTION_DOMAIN_NAMES`, so no package could carry a `journeys.ts` module afterwards.
- The objection holds. § Kind purity defines a centralized helper as a pure, referentially transparent leaf, and the leaf test sends a composition that reaches sibling members to a method; `performBrowserStep` calls `toolset.perform` twice against a live page and composes the target resolution, so `helpers.ts` is the wrong home even though the file imports no implementation class.
- The placement that answers it is the entity the function already drives. `BrowserToolsetInterface` gains `follow(id, step, options?)`, the public method that performs one recorded step on the live page: it resolves the target by role and exact name, builds the arguments by action, performs the call, judges the `BrowserAction`, and throws `BrowserStepError`. The generated module reads `await toolset.follow('s1', …)` and imports only `createBrowserToolset`; `BrowserReplay` calls the same method. The target resolution becomes the toolset's private method, and the tab-line match becomes `parseBrowserTabLine` in `parsers.ts`, a pure exported leaf. Unit L1 lands this before the publish wave, so the unpublished 0.0.19 ships the convention-true surface and no consumer pays for the rename.

No scaffold change.

## 7. The `@orkestrel/contract` reader, recorded for another session

Not a journeys edit, recorded here because this campaign found it: the installed `@orkestrel/contract` 0.0.18 reads a JSON Schema `type` array as a shape that accepts any value. It is item 37 on the scaffold `ROADMAP.md`, on the session branch, for another session to rule on; the browser's `anyOf` schema and the ollama store proof's `normalizeSchemaTypes` are the two shims it retires.

## The order

The `recorded.md` reference, the `decide.md` row, and the `tmp/browsers/` layout row are one `builder` unit in the scaffold checkout after the owner's consent. The `BASE_DEV_DEPENDENCIES` entry waits on the owner's dependency ruling, and the scaffold's own `.mcp.json` entry is the owner's convenience. The catalog row is the `catalog` verb after the publish wave. The function-domain registration is withdrawn, and the toolset's `follow` method lands in the browser package as unit L1. The contract reader is roadmap item 37.
