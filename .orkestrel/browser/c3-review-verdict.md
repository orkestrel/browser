# C3 review verdict and rulings

Objective review by the Astra `analyst` (read-only, 293 523 ms; report `tmp/worktrees/c3/tmp/codex/c3-review-answer.md`) over `tmp/units/c3-claims.md` (8 claims) and `tmp/units/c3-diff.patch` (`364b94a..cd099f9`).

Verdict: FAIL 1, 6; outside the claims: O1, O2, O4 (required), O3 (optional). Confirmed: claims 2, 3, 4, 5, 7, 8; external destruction closing adopted pages; the worker and iframe detach ownership as an inherited defect requiring repair.

Rulings, each carried by the fix brief `tmp/units/c3-fix-brief.md` (V1–V7):

- Claim 1 (BROKEN): `context.sync()`'s reattachment and popup adoption race, replacing a published popup with a second instance or publishing an instance adoption then invalidates. V1 coordinates ownership before publication.
- Claim 6 (BROKEN): adoption completing after `Target.targetDestroyed` inserts a closed popup. V2 checks `popup.closed` after the emulation await.
- O1 (required): the static `WeakSet` keeps discovery disabled after `client.reconnect()`. V3 keys the record by connection.
- O2 (required): `destroy()` detaches on the browser session regardless of the attachment owner, so a construction failure of an opener-owned popup, and every worker or iframe cleanup, sends a detach Chromium refuses. V4 retains the owner through the page's lifetime.
- O3 (optional): `<br>` still concatenates. V5 treats a visible break as a boundary.
- O4 (required): the fixture invents a frame for an unknown or absent session. V6 refuses those reads.
- The unresolved first-attach ordering: V7 rules that an enumeration report is adopted once like a live one and never lost before its opener is held, with a boundary test.
- The page-owned placement stays (no public page member); the live proof stays in the logs; U11b's pins flip at the merge.

## Second review (after V1–V7)

Astra `analyst`, read-only, 423 056 ms, on the fix round's tree (`cd099f9` plus the uncommitted V1–V7): `VERDICT: FAIL 1,5,6,13; outside the claims: O1,O2,O3`. Claims 2–4 and 7–12 confirmed; deviations 3, 5, and 6 confirmed, 1, 2, and 4 broken.

Rulings (the fix brief `tmp/units/c3-fix2-brief.md` in the worktree):

- X1 (claims 1, 5, 6; O1 blocking): the reservation records each held page's initialization outcome, supplied through the constructor by the constructing path; the held-page branches await it and re-check liveness after every await; `#publish` refuses a closed page; the toolset's popup follow ignores a closed popup.
- X2 (claim 13; deviation 4): an opener publishes its popups and drains parked reports only after its own publication; popup adoption records its target in `#publishing`.
- X3 (O2; deviation 2): a second live owning wrapper for a held target is refused whatever its session; the element-manager counter fixture returns distinct targets and sessions.
- X4 (O3): the fixture's session membership clears at the connection's end and grows only from `Target.attachedToTarget` and correlated `Target.attachToTarget` replies.
- X5 (deviation 3): the `visibility: hidden` break case added.
- X6 (claim 9): the per-client records clear on the client's `close` and `drop` as well as `connect`.

Accepted as limitations: deviation 5 (a failed or re-enabled discovery request is re-sent by the next held page's construction). Carried to the U12 follow-up: a page constructed without a reference allocator is neither held nor discovering; `BROWSER_TARGET_HELD` and its constructor restriction. A third objective review follows the round.

## Third review (after X1–X6)

Astra `analyst`, read-only, 479 478 ms, on the second fix round's tree: `VERDICT: FAIL 13,17,19; outside the claims: O1,O2`. Claims 1–12, 14–16, 18, 20, 21 confirmed (X1, X3, X5, X6 hold); the four second-round deviations confirmed. The Orchestrator's gate set on the tree green (`test:src` 1068, `test:src:browser` 219, `test:setup` 97, `test:setup:browser` 21, `test:policy` 114, `test:config` 172, `test:conformance` 69; build, format, lint, check 0).

Rulings (the fix brief `tmp/units/c3-fix3-brief.md` in the worktree):

- G1 (claims 13, 17): popup adoption captures a competing reservation as its predecessor and installs its own, which no other path replaces, so a descendant's adoption always finds the active boundary.
- G2 (claim 19): fixture replies are admitted only against pending attach requests of the active connection, consumed on success or failure and invalidated on either close.
- G3 (O1 required): a page constructed without the internal readiness argument counts as published on setup completion even with an opener; the remarks state the default.
- G4 (O2 blocking): `create()` and `sync()` share one reservation: synchronization waits for a creation in flight, and a creation that meets an established winner joins it instead of closing the target.

Accepted: deviation 3 (a failed holder's popup relationship is not restored by a later `sync()`; U12b documents the limit). A fourth objective review, scoped to G1–G4, follows the round.

## Fourth review (after G1–G4)

Astra `analyst`, read-only, scoped to the third fix round: `VERDICT: FAIL 13,17; outside the claims: O1,O2`. Claims 22–26 and 19 confirmed (G2, G3, and G4's specified orderings hold); the three third-round deviations confirmed. Claim 13's remaining ordering: reservation acquisition is not atomic (a waiter released by `#awaitReservation` installs over an adoption's entry installed while it waited; reachable through a construction-time `on.popup` listener that starts `sync()`). O1 required: creation joining a winner skips its requested navigation, viewport, and hooks. O2 blocking: a synchronization whose page is destroyed during its viewport command still publishes it, and creation joins the closed page. The gate set on the tree green (`test:src` 1072, `test:setup` 99, `test:service` 30; every other project as before).

Rulings (the fix brief `tmp/units/c3-fix4-brief.md` in the worktree):

- H1 (claims 13, 17): check-and-install is one synchronous acquisition step, retried after every wait; the initial-listener ordering is the regression case.
- H2 (O1): both join paths apply creation's `url` (with its timeout), `viewport`, and `on` hooks to the joined page before resolving.
- H3 (O2): the context never publishes a closed page; a failed synchronization settles its reservation as failure without inserting; creation validates a joined page's liveness and rejects when it closed.

A fifth objective review, scoped to H1–H3, follows the round.
