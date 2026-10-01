# Scaffold plan: propagate the browse server and the journeys references

The scaffold repository's `ROADMAP.md` carries the forward work as items 37, 38, and 39 on branch `ccr-d15a48b1-yyyll6` (`437a74b`, on main `7bc3142`, scaffold 0.0.82). This plan holds the detail a session needs to run them; the roadmap holds the record. The checkout at `/home/user/scaffold` is on that branch and clean.

## Registry

| Row | Value |
| --- | --- |
| Goal | the `browse` MCP server reaches a generated workspace the way `probe` does; the journey skill routes a browser recording's run as evidence; the layout names `tmp/browsers/`; the catalog row follows the wave |
| Exit criterion | items 38 and 39 struck from the roadmap; `npm run build` then `npm run test:policy` green (one skill-fence case needs `dist/`); `npm run test:guides` green; the host inventory proof green when a vendored byte moved; `scaffold repair` delivers the changed canon to a target |
| Prerequisite | item 38 and the catalog row need `@orkestrel/browser` 0.0.19 on the registry; item 39 needs nothing |
| Open decision, item 38 | whether `@orkestrel/browser` joins `BASE_DEV_DEPENDENCIES` (every generated workspace installs it and its nine runtime dependencies) or `browse` registers on demand; the owner rules in the unit that lands it |
| Engines | item 39 `opus` (guide voice); item 38 `astra` after the owner's ruling; the catalog verb a `builder` |

## Unit S39: the journey skill's browser-recording reference (no prerequisite)

Files: `.agents/skills/orkestrel-journey/SKILL.md` (the read list), `.agents/skills/orkestrel-journey/references/recorded.md` (new), `.agents/skills/orkestrel-journey/references/decide.md` (one table row), `.agents/orchestration.md` (one layout row). Writing rules: `.claude/rules/writing.md`; the skill's vocabulary says `screen`.

- `recorded.md`, read "before judging a browser recording's run as evidence": what a recorded `@orkestrel/browser` journey is (a name, a description, declared parameters, steps naming elements by role and exact accessible name with a record-time reference, kept under `tmp/browsers/<name>/journey.json` with its runs under `runs/<id>/run.json`); the verb map onto the journey layer (`click` to `clickAccessible(role, name)`, `type` to `fillAccessible` with a `combobox` or `listbox` `type` refused, `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and a page tool refused); the rule that a run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists; and the review path (`journeys` to read, `edit` with `remove` to trim, `forget` to discard), because a model's recording keeps every completed action.
- `decide.md`'s routing table gains the row: "A flow a model drove through the browser toolset" routes to "A recorded journey replayed through `@orkestrel/browser`, judged by the run's steps ([recorded.md](recorded.md)), never by the transcript".
- `.agents/orchestration.md` § tmp layout gains `tmp/browsers/` beside `tmp/captures/`: the journeys a browse server saves, their runs and captures, and its profiles under `.profiles/`.
- Gates: `npm run build`, `npm run test:policy`, `npm run test:guides`; the host inventory proof if it reads the skill tree.

## Unit S38: the browse server reaches a generated workspace (after the wave)

Read how `probe` reaches a target today: `BASE_DEV_DEPENDENCIES` in `src/core/constants.ts`, the `.mcp.json` canon path (`CANON_PATHS`) that no target receives, and the Claude bridge's MCP registrations. Register `browse` through the same path with the binary `node node_modules/@orkestrel/browser/dist/bin/main.js` and the environment `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY`, or, under the owner's ruling, document on-demand registration through the browser guide's "Register the browse binary" pattern. A vendored byte moved obliges a bump, a publish, and a `repair` visit to every target.

## The catalog verb (after the wave)

Run it so the browser row reads 0.0.19 at layer 5 with the manifest's dependencies; never hand-edit the table.
