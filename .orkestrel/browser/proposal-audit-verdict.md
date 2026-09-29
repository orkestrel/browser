# Audit verdict: the `@orkestrel/browser` redesign proposal

Seam: `PROPOSAL.md` (the reconciled redesign). Round 1 of 1, run 2026-09-29 over the 20 claims in `proposal-claims.md`. The seam closes when the proposal is ruled on by the owner; delete this file and its package directory in the acceptance commit.

## Lanes

The following table lists the lanes that ran.

| Lane | Role, engine | Context | Report | Terminal line |
| --- | --- | --- | --- | --- |
| Subjective | `reviewer`, Opus 5.5 | clean, blind, read-only | `proposal-audit-subjective.md` (36 citations, 0 unresolved) | `VERDICT: FAIL 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 20; outside the claims: S1–S8` |
| Objective | `analyst`, GPT-6 Astra through `codex exec` (read-only sandbox, `-C /home/user`, 454 566 ms) | clean, blind, read-only | `proposal-audit-objective.md` (45 citations, 0 unresolved) | `VERDICT: FAIL 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20; outside the claims: O1–O3` |

No lane was skipped. Neither lane edited a file. The Orchestrator reproduced every finding it acted on before ruling; the reproductions are recorded in `ledger.md` under "Falsify round".

## Rulings per claim

The following table gives each claim's lane verdicts, the Orchestrator's ruling, and where the proposal carries it.

| Claim | Subjective | Objective | Ruling | Carried in |
| --- | --- | --- | --- | --- |
| 1 Reference identity | UNRESOLVED | UNRESOLVED | Settled by probes P18 (backend ids stay monotonic after collection) and P19 (out-of-process quads are frame-local; `page.frames()` is blind to an out-of-process frame today); the in-process child-frame text corrected to invalidation by frame id | "References and locating"; U2, U4, U11 |
| 2 Held input under abort | CONFIRMED | UNRESOLVED | Queue ownership specified: an action holds the queue until its receipt; a pending release is awaited by the next action; `dialog` bypasses the queue | "Actions"; U4 check 5, U7 checks 3 and 7 |
| 3 Dialog within one result | BROKEN | BROKEN | Every pending step of every tool is raced against the `dialog` event; reserved names refused at `start()` | "Dialogs", "Naming rule"; U7 checks 2 and 3 |
| 4 Every tool streams | BROKEN | BROKEN | A page tool whose schema requires nothing gains a required `what`, stripped before invocation; an optional `what` is skipped | "Tool vocabulary", "Adoption"; U6 check 7 |
| 5 Every result bounded | BROKEN | BROKEN | Every string the toolset returns or throws is cut at the toolset's execution boundary, page-authored strings included | "Tool vocabulary"; U7 check 10 |
| 6 No spliced capture | CONFIRMED | CONFIRMED | Held; adjacent defects S2 and S3 carried | "Reading"; U3 check 4, U7 check 10 |
| 7 No page tool replaces or survives | BROKEN | UNRESOLVED | Re-adoption serialized with a generation check; a stale result is dropped; `destroy` removes by instance | "Adoption policy"; U7 checks 5 and 6 |
| 8 Registry detection and burst | BROKEN | BROKEN | Unknown responses are held only while an `invokeTool` reply is pending; an unread code on a flagged Chrome is a named limit | "WebMCP outside the browser"; U6 check 5 |
| 9 DOM placement fakes nothing | BROKEN | UNRESOLVED | `requestSubmit()` observed through a `submit` listener with a validation report; links opening another browsing context refused; disabled and contenteditable refusals asserted | "Trusted against DOM-native input"; U10 check 3 |
| 10 Faces respect environments | CONFIRMED | CONFIRMED | Held | "Environment map" |
| 11 Names and shapes | BROKEN (`ref`) | CONFIRMED | Member renamed `reference`; the tool parameter `ref` stays as data; the protocol-transliteration exception stated for `readOnly` and `untrustedContent` | "Page surface", "References and locating" |
| 12 Poll ban with one exception | BROKEN | BROKEN | Event table gains the element-query observer, `Emulation.virtualTimeBudgetExpired`, `Tracing.tracingComplete`, `Page.frameRequestedNavigation`, and the pipe `close` | "Event and invalidation model" |
| 13 Clean-break rule | BROKEN | BROKEN | Six consumer `evaluate` sites, the stub, the TSDoc, and the guide mirror named | "Blast radius"; U14 |
| 14 Removal gate | BROKEN | BROKEN | Codegen kept and retargeted to `elements.find({ css })` plus element actions | "What goes"; U5, U11, U12 |
| 15 Guide contract | BROKEN | BROKEN | Invariants 5, 6, 9, and 13 and the scope header named for rewrite; the launcher hand-off reads the inherited pipe | "Lifecycle and ownership"; U8 check 3, U12 |
| 16 Criteria discriminate | BROKEN | BROKEN | Timing bounds with `performance.now()`, the replace-after-adoption case, the abort-after-press case, the buffer bound, `handle` forwarding, disabled and contenteditable refusals, the receiving node in the frame, invariant 6 | U1, U4, U6, U7, U10, U11, U12 |
| 17 Model criteria not vacuous | BROKEN | BROKEN | Oracles read identities from the page; the read task's fact sits outside the seeded view and must appear in a tool result | U15 |
| 18 Receipt race | BROKEN | BROKEN | The load wait is bounded and its outcomes named; P20 settles the `beforeunload` ordering | "Receipts after an action"; U7 check 9, U11 |
| 19 Environment map edges | CONFIRMED | BROKEN | `BrowserConnectionError` moves to `src/core/errors.ts` | "Environment map"; U1 check 5 |
| 20 Would you ship it | BROKEN (own document) | BROKEN (reserved names) | The DOM toolset requires `options.document` and refuses the caller's own document unless opted in; reserved names refused at `start()` | "Placements and reach", "Naming rule"; U10 check 1 |

## Findings outside the claims

The following list rules on each outside finding.

- S1 (publish loop through one bridge): accepted; `native` is what a consumer publishes. "Placements and reach", ruling 25, U10 check 5.
- S2 (staleness on same-document routes): accepted; `Page.navigatedWithinDocument` increments the epoch; the DOM view uses the Navigation API where present. "Reading", U3 check 4, U10 check 6.
- S3 (retained reading key): accepted; keyed by view and reference. "Reading", U7 check 10.
- S4 and O1 (`wait` return contract): accepted; `Promise<void>` rejecting `BROWSER_WAIT_TIMEOUT` at the deadline. "Page surface", U4 check 8.
- S5 and O2 (the U5 Grep): accepted; the pattern names deleted symbols only. U5 check 1.
- S6 (`debugging` in the DOM placement): accepted as a limit. "WebMCP inside the browser", ruling 21.
- S7 (unpromotable type probe): accepted; D3 asks the owner for a development edge to `@orkestrel/mcp`. "Decisions", U9.
- S8 (consumer guide mirror): accepted. U14.
- O3 (registry result contract): accepted; every page-reported status resolves a `BrowserInvocationResult`. "WebMCP outside the browser", U6 check 4.

## Disagreements resolved

Where the lanes disagreed, the Orchestrator reproduced and ruled as follows.

- Claim 2: Opus confirmed the abort rules; Astra asked when queue ownership ends. Both were right about different halves; the proposal now states both.
- Claim 7: Astra asked about a stale adoption; Opus showed the interleaving. The proposal specifies the generation check.
- Claim 11: Astra held the names; Opus found `ref`. The abbreviation rule (`../scaffold/.claude/rules/names.md:238`) decides for Opus.
- Claim 19: Opus held the edges; Astra found the error's home. `src/server/errors.ts:10` decides for Astra.
- Claim 20: each lane named a different reversal; both are carried.

## What the round did not run

Nothing. Both lanes ran on their intended engines. The bounds on every accepted finding are the adjacent behaviors both lanes reported as held: the same-document reading reset, the popup cursor return, the `cancel` renames, the `until` deletion, the snapshot's retention, the `untrusted` marking of page tools, and the consumer's unchanged calls.
