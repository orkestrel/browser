# Campaign plan: implement the `@orkestrel/browser` redesign

Opened 2026-09-29 after the owner ratified `PROPOSAL.md` and ruled: address mcp first, prepare every dependency that needs a change, install the fixed dependency into browser as a packed tarball in the meantime, implement, then publish in dependency-layer order.

## Registry

| Row | Value |
| --- | --- |
| Goal | `@orkestrel/browser` 0.0.19 per `PROPOSAL.md` (units U1–U17) and `@orkestrel/mcp` 0.0.34 with its WebMCP bridge on the 2026-09-29 draft |
| Authoritative session | this Claude Code session; the Orchestrator owns every decision and acceptance |
| Repositories and branches | `/home/user/browser` (`ccr-d15a48b1-yyyll6`, tip `0150fda`), `/home/user/mcp` (`ccr-d15a48b1-yyyll6`, tip `12630fd`), `/home/user/tool`, `/home/user/html`, `/home/user/markdown`, `/home/user/scaffold` (same branch, read-only for this campaign), `/home/user/orkestrel/ollama` (read-only clone; push access to be added for U14 and U15) |
| Dirty state | every checkout clean at open |
| Declared versions | browser 0.0.18; mcp 0.0.33; tool 0.0.17; markdown 0.0.16; html 0.0.11; scaffold 0.0.81 |
| Dependency edges added | browser → tool (runtime, D1), browser → markdown (runtime), browser → mcp (development, D3), browser → playwright and @vitest/browser-playwright (development, D2) |
| Write scope | browser `src/**`, `tests/**`, `guides/**`, `configs/**`, manifests; mcp `src/browser/**`, `tests/**`, `guides/mcp.md`, `README.md`, `ROADMAP.md`, manifest; ollama manifest, tests, guide mirror |
| Exclusions | vendored scaffold files in every target; scaffold's own catalog row (a scaffold commit at publish); `@orkestrel/tool`, `html`, `markdown` (no change surfaced) |
| Engines | `astra` (GPT-6 Astra through `codex exec`) for constraint-heavy units; `opus` (Opus 5.5) for subjective units; `builder`, `verifier`, `checker` on Sonnet; never the session model |

## Units and order

The mcp units run first and in series in their checkout; browser units that need no mcp change run beside them in the browser checkout, one writer per checkout.

| Unit | Checkout | Engine | Depends on |
| --- | --- | --- | --- |
| M1 `bridge-refresh` | mcp | astra, then reviewer (Opus) and verifier | nothing |
| M2 `drift` | mcp | builder | M1 (shared `guides/mcp.md`) |
| M3 `pack` | mcp → browser | verifier, then the Orchestrator's install script | M2 |
| U1 `signal` | browser | builder | nothing |
| U8 `launch` | browser | builder | nothing (after U1, same checkout) |
| U2 `events` | browser | builder | U1 |
| U3 `reading` | browser | opus | U2 |
| U6 `registry` | browser | astra | U2 |
| U4 `elements` | browser | astra + reviewer | U2, U3 |
| U5 `removal` | browser | builder | U4 |
| U7 `toolset` | browser | opus + reviewer | U4, U5, U6 |
| U9 `environment` | browser | builder | U7, M3 |
| U10 `document` | browser | opus | U9 |
| U17 `conformance` | browser | astra + reviewer | U6, U10 |
| U11 `proofs` | browser | opus + reviewer | U7, U8, U10 |
| U12 `guide` | browser | opus | U11, U17 |
| U13 `gates` | browser | verifier | U12 |
| U14 `consumer` | ollama | builder | U13, a packed 0.0.19 |
| U15 `model` | ollama | Orchestrator | U14 |
| U16 `review` | browser | one falsify round on the integrated result | U14, U15 |
| Publish wave | all | `orkestrel-publish` | U16 |

## Exit criterion

The proposal's exit criterion, plus: mcp 0.0.34 green on its gates with the refreshed bridge; browser's registry copy of mcp restored before any publish gate; the wave published in layer order with consumers re-pinned.
