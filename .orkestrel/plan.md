# Fleet campaign plan: close the 2026-10-01 wave

The wave is on the registry: contract 0.0.19, html 0.0.12, tool 0.0.18, markdown 0.0.17, server 0.0.22, mcp 0.0.35, browser 0.0.20, ollama 0.0.20, and scaffold 0.0.84, 0.0.85, and 0.0.86, each confirmed by `npm view`. Scaffold 0.0.86 is overwritten into contract, html, tool, markdown, server, mcp, browser, and ollama on `ccr-d15a48b1-yyyll6`. The out-of-session obligations are scaffold `ROADMAP.md` items 43, 44, and 45. Delete this file in the commit that closes the last unit.

## Registry

| Row | Value |
| --- | --- |
| Exit criterion | the open units below are landed and pushed; veneer's showcase is accepted on veneer main; `.orkestrel/` holds no file of this campaign |
| Session repositories | contract, html, tool, markdown, server, mcp, browser, ollama, scaffold, and veneer, all on `ccr-d15a48b1-yyyll6`. At the owner's ruling of 2026-10-02 the session fast-forwards each package's `main` onto its verified branch, so every published release sits on `main` (audited by each release's `gitHead`); veneer follows scaffold main `.orkestrel/veneer/lanes.md` |
| Authority | the owner publishes with an authenticator code per window; lanes are `opus`, `reviewer`, `verifier`, `checker`, `builder`, `astra`, or `grok`; one writer per checkout |
| Handoff record | scaffold main `.orkestrel/veneer/showcase/status.md`; the handoff happened on 2026-10-03, and the engine session owns every unit below |

## Open units

| Unit | Repository | Status |
| --- | --- | --- |
| VS: the veneer showcase, every Bootstrap class alone and beside Tailwind, with journeys, statecharts, and browse checks; its units in order live in the handoff record | veneer | landed on veneer `main` (`43ca8a0`); the falsify round ruled `FAIL`, its page unit landed at `7593cfe`, and the carousel fix at `8f6c998`; open: `showcase-proofs`, then `showcase-guide` |
| Browse lane: browser 0.0.21 released (`6f5544e`, the outline parent index), ollama re-pinned (`f9cb40a`), veneer re-pinned in `43ca8a0`, scaffold's range in 0.0.88; items 9 and 10 landed on this branch (`655906b`, `0a80b99`, `73c608f`); open: their review fixes, item 11's redesign and the reading-method design, item 12, then release 0.0.22 | browser | scaffold main `.orkestrel/veneer/showcase/browse.md` holds the units in order |
| Close: delete this file and report | browser | last |
