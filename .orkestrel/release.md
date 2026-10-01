# Release wave: mcp 0.0.34, browser 0.0.19

Standing readings, taken 2026-10-01: the registry's `latest` is `@orkestrel/mcp` 0.0.33 and `@orkestrel/browser` 0.0.18; scaffold's catalog carries those rows.

## Layer 4: `@orkestrel/mcp` 0.0.34

- Repository `orkestrel/mcp`, branch `ccr-d15a48b1-yyyll6`; the manifest reads 0.0.34.
- Bump ruling: 0.0.34 (the WebMCP bridge on the 2026-09-29 draft, the conformance count, the guide drift); the evidence is the M3 verifier run recorded in the mcp repository's history.
- Peers `@orkestrel/router ^0.0.16` and `@orkestrel/server ^0.0.21` are published.

## Layer 5: `@orkestrel/browser` 0.0.19

- Repository `orkestrel/browser`, branch `ccr-d15a48b1-yyyll6`; the manifest reads 0.0.19 and the bump ruling keeps it: nothing between 0.0.18 and this tree is published, so the toolset, the journeys, the `browse` binary, the renamed `BROWSER_JOURNEY_LOCK_DIRECTORY`, the removed `BrowserTargetOptions`, and the step functions' move onto `BrowserToolsetInterface.follow` ride one version. Evidence: `compare.js` against the published 0.0.18 exits 3 (3 files added, 8 changed), the J15 and J15b bare runs green.
- Before publishing: replace the dependency `"@orkestrel/mcp": "file:tmp/tarballs/orkestrel-mcp-0.0.34.tgz"` with `^0.0.34` after mcp publishes, run `npm install` so the lockfile follows, run `npm test` whole, `npm run test:service`, and `npm run test:distribution`, then publish.
- After publishing: run scaffold's `catalog` verb so the browser row reads 0.0.19 at layer 5 with the dependencies the manifest declares.

## After the wave

- `orkestrel/ollama`: re-pin `@orkestrel/browser` to `^0.0.19`, drop the mcp override, and land the journey history (`ollama/plan.md`).
