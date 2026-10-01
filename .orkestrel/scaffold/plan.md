# Scaffold plan: propagate the browse server

The scaffold repository's `ROADMAP.md` carries the forward work as items 37 and 38 on branch `ccr-d15a48b1-yyyll6` (`dc1c96e`, on main `7bc3142`, scaffold 0.0.82); item 39 closed at `dc1c96e`, and item 38 took over its catalog duty. This plan holds the detail a session needs to run item 38; the roadmap holds the record. The checkout at `/home/user/scaffold` is on that branch and clean.

## Registry

| Row | Value |
| --- | --- |
| Goal | the `browse` MCP server reaches a generated workspace the way `probe` does; the catalog row follows the wave |
| Exit criterion | item 38 struck from the roadmap; `npm run build` then `npm run test:policy` green (one skill-fence case needs `dist/`); `npm run test:guides` green; the host inventory proof green when a vendored byte moved; `scaffold repair` delivers the changed canon to a target |
| Prerequisite | item 38 and the catalog row need `@orkestrel/browser` 0.0.19 on the registry |
| Open decision, item 38 | whether `@orkestrel/browser` joins `BASE_DEV_DEPENDENCIES` (every generated workspace installs it and its nine runtime dependencies) or `browse` registers on demand; the owner rules in the unit that lands it |
| Engines | item 38 `astra` after the owner's ruling; the catalog verb a `builder` |

## Unit S38: the browse server reaches a generated workspace (after the wave)

Read how `probe` reaches a target today: `BASE_DEV_DEPENDENCIES` in `src/core/constants.ts`, the `.mcp.json` canon path (`CANON_PATHS`) that no target receives, and the Claude bridge's MCP registrations. Register `browse` through the same path with the binary `node node_modules/@orkestrel/browser/dist/bin/main.js` and the environment `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY`, or, under the owner's ruling, document on-demand registration through the browser guide's "Register the browse binary" pattern. A vendored byte moved obliges a bump, a publish, and a `repair` visit to every target.

## The catalog verb (after the wave)

Run it so the browser row reads 0.0.19 at layer 5 with the manifest's dependencies; never hand-edit the table.
