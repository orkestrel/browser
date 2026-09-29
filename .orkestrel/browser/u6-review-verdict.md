# Review verdict: unit U6 `registry`

Seam: the U6 diff in the worktree `tmp/worktrees/u6` (branch `ccr-d15a48b1-yyyll6-u6` from `5770c25` plus the `@orkestrel/tool` dependency commit `dae9de4`; `tmp/u6-diff.patch`, 13 files; written by GPT-6 Astra). One review pass holding both lanes by the `reviewer` on Opus 5.5 (read-only, 712 951 ms on the relaunch after the container restart of 2026-09-29; the first run died at the restart with no report). Claims: the worktree's `tmp/u6-claims.md` (11). The lane relied on the Orchestrator's gate results and re-ran nothing.

## Terminal line

`VERDICT: FAIL 7, 8; outside the claims: O1, O2, O3, O4, O5, O6`

## Rulings

The following table rules on each claim and outside finding; the Orchestrator reproduced every accepted defect by inspection of the cited lines before ruling, and the fix round (a `builder` on Sonnet in the worktree, prescriptions G1–G11 verbatim, each behavioral change closed by a mutation probe) carries them.

| Finding | Verdict | Ruling | Carried in |
| --- | --- | --- | --- |
| 1 Detection | CONFIRMED | Held | — |
| 2 Frames | CONFIRMED | Held in code; its proof is O2 | G4 |
| 3 Mirror | CONFIRMED | Held | — |
| 4 Execution | CONFIRMED | Held in code; the window cleanup's proof is O3 | G5 |
| 5 Abort | CONFIRMED | Held; the listener-removal half is visible only as listener growth (optional, not carried) | — |
| 6 Adoption | CONFIRMED | Held | — |
| 7 Destroy and ownership | BROKEN | Accepted: `#enable` never checks destruction and `#start`'s child loop continues after `destroy()`, so a later child is subscribed and enabled on a destroyed registry and `start()` resolves `true` | G1 |
| 8 Names and shapes | BROKEN | Accepted: `#destroyed` always equals `#destroying !== undefined` (a second stored flag) | G2 |
| 9 Foreign data | CONFIRMED | Held | — |
| 10 One-write burst | CONFIRMED | Held; the single-chunk loopback delivery is practical at 200 bytes and recorded as the proof's assumption | — |
| 11 Functions, re-exports, polling, TSDoc | CONFIRMED | Held; the token backticks are O5 | G7 |
| O1 (required) a child failure during `start()` rejects the registry and leaves the main session enabled with the watchers gone | Accepted | Per-child handling as `#attach` does; rethrow only on an aborted signal | G3 |
| O2 (required) no proof of out-of-process invalidation | Accepted | C8 drives `Page.frameNavigated` on the child session | G4 |
| O3 (required) no proof of the held-response window cleanup | Accepted | A foreign id held inside a window, then reused as a later invocation's id | G5 |
| O4 (required) `BrowserRegistry` barrelled although its constructor needs values only the page produces | Accepted per `architecture.md` § Barrel exports | Interned; `INTERNAL` row in `tests/guides.test.ts` | G6 |
| O5 (required) TSDoc code tokens without backticks | Accepted | — | G7 |
| O6 (required) `CDPTestServerInterface.registry` is a noun used as a method | Accepted | Renamed `advertise` | G8 |
| O7 (referred) `requireBrowserToolParameter` returns `undefined` where the `require*` prefix means return-or-throw | Accepted; the prefix precedent (`requireBrowserString`, fleet `requireValue`) wins over the proposal's name | Renamed `deriveBrowserToolSchema`; `PROPOSAL.md` amended on the main checkout | G9 |
| O8 (referred) `test:guides` red for every added export until U12 | Standing ruling since U1: the guide parity case stays red from U3 through U12, which owns the guide | Ledger |
| O9 (referred) a timeout abandons the remote invocation without `WebMCP.cancelInvocation` | Accepted; a consequential page tool must not keep running after the agent was told it failed | A deadline cancels the way an abort does; `PROPOSAL.md` Execution bullet amended | G10 |
| O10 (referred, U7 seam) `adopt()` omits optional-`what` tools silently; the fixed 4 096 cut | Recorded for U7's brief: the toolset derives its `skip` list from `registry.tools()` through the schema helper and cuts at its own boundary | U7 |
| O11 (optional) a `{ content: [...] }` record renders as JSON | Held: the cited proposal line carries no such sample, and a page tool's record is not an MCP content array | — |
| O12 (referred) `BrowserToolSourceEventMap` and `BrowserToolSourceInterface` have no consumer in U6 | Accepted per the creation gate; U7 adds them with their consumer | G11 |
| O13 (referred) the integration test's path | Held: `tests.md` § Cross-cutting proofs runs a nested `tests/src/<environment>/integration.test.ts` in that environment's project for a composition within it; the case composes the server environment's transport with the core registry, the package has no `tests/integration.test.ts` project, and the proposal names the nested path | — |

## Held

The lane attacked and held: a same-tick `toolsAdded`; one `enable` under concurrent `start()`; a clean re-subscribe after `false`; replacement keeping insertion order and main-frame precedence; same-document navigation keeping the tools; the pending-map traces (reply then abort, abort then reply, abort before send, a foreign response inside the window, detachment in flight); the pre-aborted refusal sending nothing; hostile `required` shapes with the caller's schema unmutated; `destroy()` during the main `enable`; server-frame masking and the synchronous drain loop; every in-body function an anonymous callback; `page.registry` as the seam (one adapter per target session, the page's manager-on-entity pattern); `BrowserInvocationResult` consumable by U7 without a wrapper; hint vocabulary matching the mcp bridge apart from the forced `untrusted`.
