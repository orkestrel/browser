# Fleet campaign plan: publish the journeys surface and propagate the browse server

Opened 2026-10-01 when the journeys campaign in `@orkestrel/browser` closed on branch `ccr-d15a48b1-yyyll6`. This plan carries the work that remains across packages; each package's units sit under its own directory, and the release wave sits in `release.md`.

## Registry

| Row | Value |
| --- | --- |
| Goal | `@orkestrel/mcp` 0.0.34 and `@orkestrel/browser` 0.0.19 on the registry; the `browse` MCP server propagated by scaffold; the ollama store proof re-pinned and pushed with its journey task; the contract reader ruled |
| Exit criterion | the registry serves both versions; scaffold's roadmap items 37, 38, and 39 are closed and its catalog row reads browser 0.0.19 at layer 5; `orkestrel/ollama` main carries the store proof against the published browser; `.orkestrel/` in every repository is empty |
| Packages | `@orkestrel/mcp` (layer 4), `@orkestrel/browser` (layer 5), `@orkestrel/ollama` (consumer), `@orkestrel/scaffold` (host), `@orkestrel/contract` (layer 0, an independent repair) |
| Layer order | mcp, then browser, then ollama and the scaffold catalog; contract on its own |
| Authority | the owner publishes and merges; a session runs each package's units from its plan |

## The units each package owes

- `@orkestrel/mcp`: publish 0.0.34 from its `ccr-d15a48b1-yyyll6` branch (`release.md`).
- `@orkestrel/browser`: restore the mcp dependency range, publish 0.0.19 (`release.md`); the forward work is in the repository's `ROADMAP.md`.
- `@orkestrel/scaffold`: `scaffold/plan.md` (roadmap items 38 and 39, the catalog verb).
- `@orkestrel/contract`: `contract/plan.md` (roadmap item 37 in the scaffold repository).
- `@orkestrel/ollama`: `ollama/plan.md` (the re-pin, the journey history, the turn lever).
