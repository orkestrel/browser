# Fleet campaign plan: publish the journeys surface and propagate the browse server

Opened 2026-10-01 when the journeys campaign in `@orkestrel/browser` closed on branch `ccr-d15a48b1-yyyll6` (`d221d4b` retired its campaign folder). This plan carries the work that remains across packages; each package's units sit under its own directory, and the release wave sits in `release.md`. Read the registry, then the package plan the unit belongs to, then `.agents/orchestration.md` for the dispatch form.

## Registry

| Row | Value |
| --- | --- |
| Goal | `@orkestrel/mcp` 0.0.34 and `@orkestrel/browser` 0.0.19 on the registry; the `browse` MCP server propagated by scaffold; the ollama store proof re-pinned and pushed with its journey task; the contract reader ruled |
| Exit criterion | the registry serves both versions; scaffold's roadmap items 37, 38, and 39 are closed and its catalog row reads browser 0.0.19 at layer 5; `orkestrel/ollama` main carries the store proof against the published browser; the browser `ROADMAP.md` items that need no publish are closed; `.orkestrel/` in every repository is empty |
| Packages | `@orkestrel/mcp` (layer 4), `@orkestrel/browser` (layer 5), `@orkestrel/ollama` (consumer), `@orkestrel/scaffold` (host), `@orkestrel/contract` (layer 0), `@orkestrel/tool` (layer 2, one item) |
| Layer order | mcp, then browser, then ollama and the scaffold catalog; contract and tool on their own |
| Authority | the owner publishes and merges; a session runs each package's units from its plan; every lane is `astra` (Codex) or `opus`, never the session model |
| Branches | browser `ccr-d15a48b1-yyyll6` (`5363263`, `ROADMAP.md` items 1, 2, 4, and 5 landed); mcp `ccr-d15a48b1-yyyll6` (`619699b`, 0.0.34); scaffold `ccr-d15a48b1-yyyll6` (`dc1c96e`, main `7bc3142` merged, item 39 closed); ollama `ccr-d15a48b1-yyyll6` (`f97df76`) and the local `ccr-d15a48b1-yyyll6-journeys` (`6d61a5a`) |

## The order, easiest first

The units that needed no publish are landed: browser `ROADMAP.md` items 5 and 4 (`3ac285e`), 1 (`ae81af5`), and 2 (`5363263`), and scaffold item 39 (`dc1c96e`). What remains, in order:

1. **The publish wave** (`release.md`): the owner's credential; mcp first, then browser.
2. **After the wave**: ollama (`ollama/plan.md`), scaffold item 38 and the catalog verb (`scaffold/plan.md`), browser item 3 with `@orkestrel/tool`.
3. **Separate sessions**: contract (`contract/plan.md`, the repository is not attached here) and scaffold item 38 (a design decision over the generator).

## Landing a browser unit

A worktree per lane under `tmp/worktrees/<unit>` from the branch head, `npm ci` with `tmp/tarballs/orkestrel-mcp-0.0.34.tgz` copied in; the lane commits nothing. To land: host gates in the worktree (the projects the unit touches, the service suites when the toolset or the replay changed), `git add` and commit in the worktree with the unit's message, `git merge --no-ff` into the branch, `npm run check`, the full gate set (`oxfmt --check`, `oxlint --deny-warnings`, `npm run check`, `npm run build`, `npm test`, `npm run test:distribution`, `npm run test:service`), then push. A merge conflict where two lanes appended at one seam is resolved by keeping both sides.
