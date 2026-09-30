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
