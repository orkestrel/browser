# Scaffold plan: propagate the browse server and the journeys references

The scaffold repository's `ROADMAP.md` carries the forward work as items 37, 38, and 39 on branch `ccr-d15a48b1-yyyll6` (commits `eb3c009` and `437a74b`, on main `7bc3142`, scaffold 0.0.82). This plan holds the detail a session needs to run them; the roadmap holds the record.

## Registry

| Row | Value |
| --- | --- |
| Goal | the `browse` MCP server reaches a generated workspace the way `probe` does; the journey skill routes a browser recording's run as evidence; the layout names `tmp/browsers/`; the catalog row follows the wave |
| Exit criterion | items 38 and 39 struck from the roadmap; the scaffold policy project green after `npm run build`; the guides project green; `scaffold repair` delivers the changed canon to a target |
| Prerequisite | `@orkestrel/browser` 0.0.19 on the registry, for item 38's dependency and the catalog row |
| Open decision | whether `@orkestrel/browser` joins `BASE_DEV_DEPENDENCIES` (every generated workspace installs it and its nine runtime dependencies) or `browse` registers on demand; the owner rules in the unit that lands item 38 |

## Units

1. **Item 38, the browse server.** Read how `probe` reaches a target today (`BASE_DEV_DEPENDENCIES` in `src/core/constants.ts`, the `.mcp.json` canon path that no target receives, and the Claude bridge's MCP registrations), then register `browse` through the same path: the binary `node node_modules/@orkestrel/browser/dist/bin/main.js` with `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY`. The browser guide's "Register the browse binary" section is the per-repository hookup until then.
2. **Item 39, the journey skill.** `.agents/skills/orkestrel-journey/references/recorded.md`, named in the skill's read list before judging a browser recording's run as evidence: what a recorded `@orkestrel/browser` journey is (a name, a description, declared parameters, steps naming elements by role and exact accessible name with a record-time reference), the verb map onto the journey layer (`click` to `clickAccessible(role, name)`, `type` to `fillAccessible` with a `combobox` or `listbox` `type` refused, `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and a page tool refused), the rule that a run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists, and the review path (`journeys`, then `edit` with `remove`, then `forget`). A row in `references/decide.md`'s routing table: a flow a model drove through the browser toolset routes to a recorded journey replayed through `@orkestrel/browser`, judged by the run's steps, never by the transcript. A `tmp/browsers/` row in `.agents/orchestration.md` § tmp layout beside `tmp/captures/`: the journeys a browse server saves, their runs and captures, and its profiles under `.profiles/`. The skill's vocabulary says `screen`.
3. **The catalog verb**, after the wave: run it so the browser row reads 0.0.19 at layer 5 with `html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, `router`, and `server`; never hand-edit the table.

## Gates

`npm run build`, then `npm run test:policy` (one skill-fence case needs `dist/`), `npm run test:guides`, and the vendored-file proof the repository runs for `configs/policy.ts` when item 38 touches it.
