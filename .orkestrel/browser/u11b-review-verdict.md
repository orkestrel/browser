# U11b review verdict and rulings

Objective review by the Astra `analyst` (read-only, 415 786 ms; report `tmp/worktrees/u11b/tmp/codex/u11b-review-answer.md`) over `tmp/units/u11b-claims.md` (10 claims) and `tmp/units/u11b-diff.patch` (`eca71a6..cf21a3c`).

Verdict: FAIL 4, 5, 6; outside the claims: O1, O2, O3 (required), O4 (optional). Confirmed: claims 1, 2, 3, 7, 8, 9, 10; the skip discipline; the added export names; the frame view race as a permitted capture outcome; the `Gift wrapMessage` mechanism (whitespace-only nodes discarded before concatenation).

Rulings, each carried by the fix brief `tmp/units/u11b-fix-brief.md` (T1–T7):

- Claim 4 (BROKEN): the popup `it.fails` body holds its preconditions, so an unrelated reader failure (M12) satisfies it. T1 moves them into a suite-level `beforeAll` with independent evidence the child target exists, inverts only the missing-popup assertion, adds the return-to-opener proof, and records the raw protocol trace the review asked for.
- Claim 5 (BROKEN): the frame submit's view matcher admits any capture error and an empty outline, and nothing proves the key-down reached the frame. T2 compares complete outcomes and records the Enter `keydown` before the navigation.
- Claim 6 (BROKEN): the select `it.fails` body holds readiness and capture, so a module-load failure (M14) satisfies it. T3 moves them into a `beforeAll` and inverts only the missing-options comparison.
- O1 (required): P20's second idle wait can reject unhandled when an earlier step fails. T4 attaches handling at once and drains in `finally`.
- O2 (required): exact successful-capture assertions reject the documented loading or deadline receipts under contention, and the U11a wait case's checkpoint can be overtaken by its deadline. T5 accepts the documented alternatives with an eventual-state check, keeps one performance case per claim under a stated envelope, and repairs the checkpoint.
- O3 (required): P5 leaves its server open after a failed assertion. T6 registers the close.
- O4 (optional): `writes` records CDP application messages only. T7 says so.
- D-popup: the discovery gap is real in the source; the exact Chromium 141 emission stays UNRESOLVED until T1's trace; the review's smallest correct direction (browser-connection `Target.setDiscoverTargets`, routing by context and `openerId`, attachment through the context's ownership, deduplication, one published popup) is C3's S1.
- The select divergence: C3 restores the `option` rows (`option` is an interactive role and the proposal requires outline parity), preserving textarea handling and option naming and state; C3's S3 preserves inter-node whitespace instead of inserting separators.
