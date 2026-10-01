# Release wave: mcp 0.0.34, browser 0.0.19

Standing readings, taken 2026-10-01: the registry's `latest` is `@orkestrel/mcp` 0.0.33 and `@orkestrel/browser` 0.0.18; scaffold's catalog carries those rows; `@orkestrel/router` 0.0.16 and `@orkestrel/server` 0.0.21 are published. Run the wave with the `orkestrel-publish` skill: the per-repository visit, the bump ruling, the layer preparation, the login approval, and the five-minute upload window.

## Layer 4: `@orkestrel/mcp` 0.0.34

- Repository `orkestrel/mcp`, branch `ccr-d15a48b1-yyyll6` at `619699b` ("Bump @orkestrel/mcp to 0.0.34"); the manifest reads 0.0.34; the checkout at `/home/user/mcp` is clean.
- Bump ruling: 0.0.34 for the WebMCP bridge on the 2026-09-29 draft (`debugging` annotations, `toolactivated` and `toolcancel` listeners republished as `activate` and `abort`), the conformance count, and the guide drift; the M3 verifier run is recorded in that repository's history.
- Peers `@orkestrel/router ^0.0.16` and `@orkestrel/server ^0.0.21` are already published, so nothing precedes it.

## Layer 5: `@orkestrel/browser` 0.0.19

- Repository `orkestrel/browser`, branch `ccr-d15a48b1-yyyll6`; the manifest reads 0.0.19 and the bump ruling keeps it: nothing between 0.0.18 and this tree is published, so the toolset, the journeys (`record`, `save`, `journeys`, `edit`, `replay`, `forget`), the `browse` binary, `BrowserToolsetInterface.follow`, the renamed `BROWSER_JOURNEY_LOCK_DIRECTORY`, and the removed `BrowserTargetOptions` ride one version. Evidence: `compare.js` against the published 0.0.18 exits 3 (3 files added, 8 changed); the J15 and J15b bare runs green; the last integrated gate set on `baf2898` green.
- Before publishing, in this order: (1) mcp 0.0.34 is on the registry; (2) replace the dependency `"@orkestrel/mcp": "file:tmp/tarballs/orkestrel-mcp-0.0.34.tgz"` with `"^0.0.34"` (the replaced range is recorded in `tmp/tarballs/mcp-replaced-range.txt`: it was absent before the campaign); (3) `npm install` so the lockfile follows, and delete `node_modules/.vite`; (4) `npm test`, `npm run test:service`, `npm run test:distribution`; (5) the browser units in `ROADMAP.md` that are landed by then are in; (6) publish.
- After publishing: run scaffold's `catalog` verb so the browser row reads 0.0.19 at layer 5 with `html`, `tool`, `emitter`, `contract`, `markdown`, `websocket`, `mcp`, `router`, and `server`.

## After the wave

- `orkestrel/ollama`: re-pin `@orkestrel/browser` to `^0.0.19`, drop the mcp override, and land the journey history (`ollama/plan.md`).
- `orkestrel/scaffold`: item 38, then the catalog verb (`scaffold/plan.md`).
