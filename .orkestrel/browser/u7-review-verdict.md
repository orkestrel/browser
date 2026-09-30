# Review verdict: unit U7 `toolset`

Seam: the U7 diff in `/home/user/browser` (`tmp/units/u7-diff.patch`; 13 files modified plus `src/core/BrowserToolset.ts` and its test file; +3 128/−145) over the checkpoint `5315802`, written by the `opus` lane on `tmp/units/u7-brief.md` (rulings R1–R8; R3 amended mid-run so `tools()` is optional on the source contract). One objective review pass by the `analyst` on GPT-6 Astra (`codex exec`, read-only sandbox rooted at `/home/user`, 473 576 ms; brief `tmp/codex/u7-review-brief.md` by the `analyst` driver, `brief.ts --check` 27 checked, 0 missing). Claims: `tmp/units/u7-claims.md` (16). Report: `tmp/codex/u7-review-answer.md`. The lane edited nothing (the porcelain diff across its run is empty).

## Terminal line

`VERDICT: FAIL 5, 9, 11, 12, 15, 16; outside the claims: O1, O2, O3, O4, O5, O6`

## Rulings

The following table rules on each claim and outside finding; every BROKEN was reproduced by following the review's interleaving in the cited lines before ruling, and the fix round runs on the same Opus lane (prescriptions F1–F12 in `tmp/units/u7-fix-brief.md`, each behavioural change closed by a whole-file mutation probe with its log kept).

| Finding | Verdict | Ruling | Carried in |
| --- | --- | --- | --- |
| 1 Vocabulary | CONFIRMED | Held | — |
| 2 Reserved names | CONFIRMED | Held | — |
| 3 Dialogs | CONFIRMED | Held for the specified scenarios; `tabs` is O1 | F8 |
| 4 Tabs | CONFIRMED | Held; the read-after-move pagination is O2 | F9 |
| 5 Adoption | BROKEN | Accepted: a synchronous manager `add` listener installing the consumer's same-named tool between the reason pass and the wrapper's `add` is overwritten (the manager's `add` overwrites and emits synchronously) | F2 |
| 6 Generations | CONFIRMED | Held | — |
| 7 Queue | CONFIRMED | Held; the manager runs a batch concurrently and the toolset's tail orders it | — |
| 8 Navigate | CONFIRMED | Held; cancellation during the load is claim 11 | F4 |
| 9 Receipts | BROKEN | Accepted: a commit with neither `DOMContentLoaded` nor `load` spends the 5 s navigation bound and then a fresh 5 s capture bound, so the receipt takes about 10 s against the stated 6 | F3 |
| 10 Bounds | CONFIRMED | Held; the surrogate split at the minimum limit is O3 | F10 |
| 11 Signal | BROKEN | Accepted: `dialog` with an already-aborted signal is still handled (no pre-handler check; accept/dismiss take no signal); an abort after `Page.navigate` replied ends in a navigation timeout because the page's load wait has no signal listener; the transport-level rejection was not observed by the test | F4, F7 |
| 12 Destroy | BROKEN | Accepted: `destroy()` during a held `WebMCP.enable` lets `start()` resume and register after destruction; two concurrent `start()` calls settle differently; a synchronous `destroy()` from an `add` listener leaves later additions registered | F5 |
| 13 R1 input members | CONFIRMED | Held | — |
| 14 R8 fixtures | CONFIRMED | Held | — |
| 15 Names and shapes | BROKEN | Accepted: `readBrowserReference` parses and canonicalizes against the fixed `read*` meaning (`names.md:97`); renamed `requireBrowserReference`; the factory TSDoc's "nothing is added until startup resolves" corrected; the other 22 added names ruled conforming by the lane's census | F6 |
| 16 Tests discriminate | BROKEN | Accepted: the selection call, returning before load, another loader's load, an overtaking press against a withheld release, the replaced error's code and context, popup-and-back, and the startup overlap were undiscriminated; the five design choices untested; the M1–M23 record unresolved (summary only, no per-mutant assertion or log) | F7 |
| O1 (required) `tabs` does not race the dialog | Accepted | F8 |
| O2 (required) a cursor note displaces reading characters the offset then skips | Accepted; this would defeat U15's complete read | F9 |
| O3 (required) the minimum limit splits a surrogate pair and the test pins it | Accepted | F10 |
| O4 (required) a census-free source advertises a parameterless tool | Accepted: the schema derivation applies to every adopted tool | F11 |
| O5 (required) a shadowed frame registration vetoes the selected tool | Accepted: policy against the registry's selected registration | F12 |
| O6 (blocking) the engine requires a page, so U10's DOM view cannot drive it | Accepted (the U10 scout surfaced the same): the toolset takes a `BrowserViewInterface`; `press`, `navigate`, `dialog`, `tabs`/`switch`, the page and CDP subscriptions, and the default registry source exist behind `options.page`; `native` is per instance (seven page-backed, five view-backed); `createBrowserToolset(page)` passes the page as both | F1 |

## Held

The lane attacked and held: `native` uncontaminated by staged, context, and adopted tools; all ten reserved names checked before registration; dialog handling bypassing held input; queued interruption sending nothing; late adoption dropped after a newer change, a popup-and-back move, or destruction; the view and reference keys resetting continuation; a child-frame navigation request not starting the main-frame wait; completed-start destruction removing owned tools and rejecting retained ones; exact-limit text intact; no toolset-level boundary timeout (the registry owns its deadline) and a late rejection observed by the race; the page-owned input and the removed selector fixtures.

## Second review (Astra `analyst`, read-only, 532 103 ms; report `tmp/codex/u7-review2-answer.md`)

Verdict: FAIL 9, 10, 12, 16, 21; outside the claims: O1 (required). Every first-round failing input is closed at the cited lines (claims 5, 9, 11, 12, 15; O1–O6 of the first round).

Rulings, each carried by the fix brief `tmp/units/u7-fix2-brief.md`:

- Claim 9 (BROKEN): a `#within` timer survives the enclosing race (a dialog or an abort) and the outline started inside the capture reserve keeps a fresh readiness timer past the receipt. Ruled G1: deadline timers die with their race, receipt-owned capture work is cancelled when the receipt settles, and the "under 6 s" claim is measured from the receipt deadline's own start.
- Claim 10 (BROKEN): `extractBrowserSlice` disables pair protection at limit 1 and returns a lone high surrogate with a non-advancing continuation. Ruled G2: code-point-safe slices at every limit; a limit that cannot fit the next code point refuses with `BROWSER_TOOLSET_LIMIT`.
- Claim 12 (BROKEN): a synchronous re-entrant `start()` from an `add` listener on a view-backed toolset gets a second promise and doubles the native tools. Ruled G3: the shared promise is assigned before initialization runs; the re-entry test asserts promise identity and removal on destroy.
- Claim 16 (BROKEN): F13a/F13b do not discriminate the registry twin (the invariants live in the registry), F14b does not attack the restore branch, the signal test does not assert the inner rejection reason, the generation test does not hold one adoption across A → popup → A, F6 has no mutant. Ruled G4: mutate at the owners on scratch copies, add the two assertions, classify F6 as static evidence.
- Claim 21 (BROKEN): a same-document navigation during the initial readiness seed discards the seed by the staleness epoch and caches a resolved promise with `#dom` unset, so every later `page.read()` times out. Ruled G5: seeds validate against document identity; the held-seed ordering becomes a regression test.
- O1 (required): the engine never reads `view.trusted`, so U10b's factory-over-engine composition could not meet the proposal's `(untrusted event)` receipt. Ruled G6 in U7 (moved out of U10b's draft): the action line of a successful `click` or `type` receipt ends with ` (untrusted event)` when the view is untrusted; the view capture follows unchanged. PROPOSAL.md's "Receipts of `click` and `type` end" sentence is read as the action line at the merge.
- Claim 22's note (a stale-session key-up after an Enter that navigated an out-of-process frame propagates from `element.submit()`): recorded as a gap for U11b's service proofs, not a fix in this round.
