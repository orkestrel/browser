# J13: the scaffold proposal for journeys (awaiting the owner's consent)

The design's § 9 names four scaffold edits and the catalog row. None is applied: the scaffold checkout at `/home/user/scaffold` is the owner's, and this unit lands only with the owner's word. Each item names the file, the change, and the gate.

## 1. `.agents/skills/orkestrel-journey/references/recorded.md`

A reference the skill's read list names (`SKILL.md` item 6, "before replaying a browser recording as a journey"), carrying: what a recorded browser journey is (the JSON of `@orkestrel/browser` § Journeys: a name, a description, declared parameters, and steps naming elements by role and exact accessible name); the verb map from the design's § 9 (`click` to `clickAccessible(role, name)`, `type` to `fillAccessible` with a `combobox` or `listbox` `type` refused, `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and a page tool refused); the rule that a run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists; and the review path (`journeys`, then `edit` with `remove`) because a model's recording keeps every completed action. Gate: `SKILL.md`'s read list names the file; the scaffold policy project is green.

## 2. `.agents/skills/orkestrel-journey/references/decide.md`

One bullet: when the question is "does the flow a model drove replay as a person would drive it", route it to a recorded journey replayed through `@orkestrel/browser` and judge the run's steps, never the model's transcript. Gate: the scaffold policy project is green.

## 3. `.agents/orchestration.md`, the layout table

One row beside `tmp/captures/`: `tmp/browsers/` for the journeys a browse server saves, their runs and captures, and the server's profiles under `.profiles/`. Gate: the scaffold policy project is green.

## 4. `.mcp.json` wiring, gated on the `BASE_DEV_DEPENDENCIES` ruling

The browser guide's "Register the browse binary" pattern is the validated hookup: `claude mcp add --scope project browse -- node node_modules/@orkestrel/browser/dist/bin/main.js`, with `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY` as the environment. The scaffold wires it only if `@orkestrel/browser` joins `BASE_DEV_DEPENDENCIES`, which adds `@orkestrel/mcp`, `@orkestrel/router`, and `@orkestrel/server` to every scaffolded repository's development install. The owner rules on that cost; without the ruling the reference states the hookup and the wiring stays out.

## 5. The catalog row in `.claude/agents/orkestrel.md`

`@orkestrel/browser` moves from layer 3 to layer 5 with `@orkestrel/mcp ^0.0.34`, `@orkestrel/router ^0.0.16`, and `@orkestrel/server ^0.0.21` beside its existing dependencies, at the version the publish wave gives it. Gate: the scaffold policy project is green; the row equals the manifest after the wave.

## The order

Items 1, 2, 3, and 5 are one `builder` unit in the scaffold checkout after the owner's consent; item 4 waits on the owner's dependency ruling.
