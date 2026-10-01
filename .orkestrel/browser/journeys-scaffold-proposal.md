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

## 4. `.mcp.json` wiring, gated on the `BASE_DEV_DEPENDENCIES` ruling

Stands as a gated item. The precedent is `probe`: it sits in `BASE_DEV_DEPENDENCIES` and `.mcp.json` registers its binary. Wiring `browse` the same way (`node node_modules/@orkestrel/browser/dist/bin/main.js` with `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY`) puts `@orkestrel/browser` and its runtime dependencies (`html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, and mcp's peers `router` and `server`) into every generated workspace's development install. The owner rules on that cost. Without the ruling, the browser guide's "Register the browse binary" pattern is the per-repository hookup and the scaffold wires nothing.

## 5. The catalog row in `.claude/agents/orkestrel.md`

Reconciled: not a hand edit. The `catalog` verb rewrites the table from the registry, so the browser row moves to 0.0.19 at layer 5 with the dependencies the manifest declares (`html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, with `router` and `server` as peers) when the wave publishes it and the verb runs. The hand-edited row on the scaffold session branch is dropped at its merge with main. Action after the wave: run the `catalog` verb; gate: the scaffold policy project is green.

## 6. `configs/policy.ts`, `FUNCTION_DOMAIN_FOLDERS` — withdrawn

The second falsify round's subjective lane read `performBrowserStep` and `locateBrowserTarget` as I/O orchestration inside the pure leaf, and the ruling that answered it proposed registering `src/core/journeys` so each could become a function module. Reconsidered against the rule, the registration cuts against convention and the objection does not hold:

- `.claude/rules/architecture.md` § Kind purity defines `helpers.ts` as exported reusable infrastructure whose one constraint is importing no implementation class. Both functions take their toolset and view as interfaces (`BrowserToolsetInterface`, a view with `elements`) and import none, so they sit where the rule places a function over a contract. The stateful orchestration, the replay loop, is `BrowserReplay`'s, a class, as "functional core, imperative shell" requires.
- A function domain is a folder of uniform single-function modules (`app/browser/composables`, `src/server/execution`), and registering one reserves its stem fleet-wide through `FUNCTION_DOMAIN_NAMES`, so no package could carry a `journeys.ts` module afterwards. Two functions do not justify a domain or that reservation.
- The alternative placement, a class that runs a step, was rejected when the design chose the generated module's shape: one readable `performBrowserStep` call per step that a developer edits as a flat list.

The design's § 14 records the placement as final. No scaffold change.

## 7. The `@orkestrel/contract` reader, recorded for another session

Not a journeys edit, recorded here because this campaign found it: the installed `@orkestrel/contract` 0.0.18 reads a JSON Schema `type` array as a shape that accepts any value. It is item 37 on the scaffold `ROADMAP.md`, on the session branch, for another session to rule on; the browser's `anyOf` schema and the ollama store proof's `normalizeSchemaTypes` are the two shims it retires.

## The order

Items 1, 2, and 3 are one `builder` unit in the scaffold checkout after the owner's consent; item 4 waits on the owner's dependency ruling; item 5 is the `catalog` verb after the publish wave; item 6 is withdrawn; item 7 is on the roadmap.
