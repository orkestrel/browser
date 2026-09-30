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
