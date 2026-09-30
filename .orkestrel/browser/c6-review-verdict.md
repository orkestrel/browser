# C6 review verdict

## Objective review

Astra `analyst`, read-only, on the C6 tree (`7d8f01b` plus the uncommitted S1–S9): `VERDICT: FAIL 2, D2, D3, D5, D6; outside the claims: O1, O2, O3, O4, O5`. Claims 1, 3–10 confirmed (the command-before-request settlement, the `false` path, the failed-read fallback for an arrived request, the predicate and its replacement, the POST-and-303 receipt, the matcher's negative controls, the context codes, the DOM capture guard measuring what the CDP path measures, navigation completion under a signal); deviations 1 and 4 confirmed. The Orchestrator's gate set on the tree green with the build and the service run (`test:src` 1113, `test:src:browser` 224, `test:setup` 123, `test:service` 49 passed, 1 skipped).

Rulings (the fix brief `tmp/units/c6-fix-brief.md` in the worktree):

- F1 (claim 2): the observer is installed before `fill` or `select` when `submit` is set.
- F2 (O1, D3, blocking): the observer follows the frame that receives the input, and the settle waits for that frame's navigation.
- F3 (O2, blocking): every submit in the observation interval counts; the read reports whether any qualifying submission survived.
- F4 (O3): the failed-read regression holds commit and load until the receipt is proven pending.
- F5 (O4): the submit fixture becomes a class.
- F6 (O5): the navigation matrices release their client in `finally`.

Recorded: D2 (this host delivers the request before the input reply or between the reply and the read; a timestamped trace would settle which; the deterministic core regression is the proof); D5 (the lane's account of a denied read); D6 (the in-place mutation restored, the blob equal to the diff's; Python editing against the contract). The receipt deadline starts where the constant's documentation says (the wait for navigation), not at the action's start: G1 states the contract as implemented. A second objective review, scoped to F1–F6, follows the round.

## Second review (after F1–F6)

Astra `analyst`, read-only, scoped to the fix round: `VERDICT: FAIL 11, 12, 1, D2, D3, D5; outside the claims: O1, O2, O3, O4`. Claims 13–16 confirmed (every submission counted, the failed-read fallback proven, the fixture classes, the client cleanup). Claim 11: an installation failure or a frame attached after the census leaves the input's document unobserved. Claim 12: a destination that acquires another session during settlement is lost. Claim 1: a previous action's late commit and load satisfy the next action's waits after the reset. O2 blocking: `_parent` and `_top` submissions wait on the submitting frame. O1: subscriptions are released from the wrong session after a move. O3: `#submission` and `#deferred` are nouns. O4: an action that skips the read leaves the DOM observer installed. The Orchestrator's gate set on the tree green (`test:src` 1117, `test:service` 49).

Rulings (the fix brief `tmp/units/c6-fix2-brief.md`): B1 observation of the input's document established before dispatch, with a coded refusal when it cannot be; B2 the submission's destination frame (`self`, `parent`, `top`) decides what the settle follows; B3 the follow resolves sessions at each wait and releases subscriptions from the session they were made on; B4 settlement keyed by the action's navigation sequence; B5 observations removed on every terminal path; B6 the verb rule. A third objective review, scoped to B1–B6, follows.

## Third review (after B1–B6)

Astra `analyst`, read-only, scoped to the second fix round: `VERDICT: FAIL 17, 19, 20, 22, 23, 1, 11, 12, D3, D6, D7; outside the claims: O1, O2, O3, O4, O5`. Confirmed: 18 (a frame attached during installation observed), 21 (`unsubscribe` releasing from the sessions the registration was made on), 24 (the names), 25 (the harness repair was test teardown, not a source leak). Broken: an observed frame republished on a new session keeps no observer (17); `_parent` from a nested out-of-process child whose parent metadata was lost maps to the main frame (19); superseded-session commit and stop still settle the action (20); a predecessor's delayed request becomes the selected navigation (22); a partial installation loses cleanup ownership on abort (23); a frame attached after the census, before dispatch, is unobserved (11). Outside: the session tracking and release waits bypass the receipt's deadline and interruption (O1, blocking); duplicate subscription bookkeeping (O2); the two contract additions need their guide rows and the observation refusal its receipt row (O3, for G1); the seven setup exports lack proofs (O4); a same-document navigation never completes the settle (O5). The gate set green on the tree (`test:src` 1128, `test:service` 49).

Ruling: the settle-on-submit design is withdrawn from the toolset's own tracking. Three rounds show the toolset re-implementing what the page already owns (frames, sessions, loaders, navigation completion, the element manager's ownership across moves) and leaking at each seam. The C6 tree is checkpointed on its branch (`c6` commit) with S2–S9 confirmed; the frame-scoped navigation settlement becomes a page contract designed in a blind two-lane round (`tmp/units/c6-design-brief.md`: an Astra `analyst` objective design and an Opus `planner` subjective design), reconciled into one implementation unit on the same worktree, then reviewed. O3 goes to G1; O4 to the implementation unit.
