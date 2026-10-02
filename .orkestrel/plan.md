# Fleet campaign plan: close the 2026-10-01 wave

The wave is on the registry: contract 0.0.19, html 0.0.12, tool 0.0.18, markdown 0.0.17, server 0.0.22, mcp 0.0.35, browser 0.0.20, ollama 0.0.20, and scaffold 0.0.84, each confirmed by `npm view`. Scaffold 0.0.84 is overwritten into contract, html, tool, markdown, server, mcp, browser, and ollama on `ccr-d15a48b1-yyyll6`. The out-of-session obligations are scaffold `ROADMAP.md` items 43 and 44. Delete this file in the commit that closes the last unit.

## Registry

| Row | Value |
| --- | --- |
| Exit criterion | the open units below are landed and pushed; veneer's visit is green on the scaffold release that carries scaffold's `main`; `.orkestrel/` holds no file of this campaign |
| Session repositories | contract, html, tool, markdown, server, mcp, browser, ollama, scaffold, and veneer, all on `ccr-d15a48b1-yyyll6`; the owner merges to `main` |
| Authority | the owner publishes with an authenticator code per window; lanes are `opus`, `reviewer`, `verifier`, `checker`, `builder`, or `astra`; one writer per checkout |

## Open units

| Unit | Repository | Status |
| --- | --- | --- |
| T1b: the `TIMER_LEAD` control in ollama and mcp, mirroring browser `64accbd`; the ollama `SCHEDULE_SLACK` TSDoc speaks only of late firing | ollama, mcp | running |
| S44: merge scaffold's `main` (the veneer campaign's rules and `.prettierignore`) into the branch, promote the wave's registry readings into `orkestrel-publish` `references/wave.md`, and release scaffold 0.0.85 | scaffold | merge gates running; needs one code |
| V1: veneer's visit on scaffold 0.0.85 declares `@orkestrel/browser` `^0.0.20` and keeps `main`'s `.prettierignore`; gates; serve the showcase with `vite preview`; record, list, and replay a journey through the `browse` binary; register `browse` in local scope | veneer | after S44 |
| Close: overwrite scaffold 0.0.85 into the session repositories, delete mcp's `.orkestrel/mcp/`, and delete this file | all | after V1 |
