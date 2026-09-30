# U11a review verdict and rulings

Objective review by the Astra `analyst` (read-only, 424 540 ms; report `tmp/worktrees/u11/tmp/codex/u11a-review-answer.md`) over `tmp/units/u11a-claims.md` (13 claims and the four pinned defects) and `tmp/units/u11a-diff.patch` (`1d911da..cdb23e3`).

Verdict: FAIL 6, 10, 12, D3; outside the claims: O1, O2, O3 (required), O4 (blocking).

Rulings, each carried by the fix brief `tmp/units/u11a-fix-brief.md` (J1–J8) unless marked C2:

- Claim 6 (BROKEN): the wait proof times from before the click, so the 300 ms bound measures unrelated work and M07 can pass by the initial check. J1: the waiter is established before the insertion, the bound is measured from the page-recorded insertion time under a declared contention envelope, the rejection floor tolerates timer granularity.
- Claim 10 (BROKEN): P25 assumes the host kept the cache entry; eviction under memory pressure fails it without a defect. J2: `Page.backForwardCacheNotUsed` is observed and an eviction throws a precondition error naming the reasons; the restoring run stays required.
- Claim 12 (UNRESOLVED): the live WebMCP case skipped on this host, so mirroring was never exercised. J3: the block launches a flagged browser (the flag U9's global setup passes) and runs the case unskipped; the skip stays only for a Chromium that lacks the domain with the flag.
- D1 (CONFIRMED with an ordering qualification): the loss needs attach, then swap detach, then enable completion; detach-before-attach is safe; the element manager's own invalidation stays. C2's H1 states the ordering and preserves the invalidation.
- D1b (CONFIRMED): the child navigation branch discards the committed URL and the attach continuation keeps its captured empty value. C2's H2.
- D2 (CONFIRMED): the exact phrase `No node found for given backend id` is the smallest classification change; the broader `No node found` is unnecessary. C2's H3.
- D3 (BROKEN: right diagnosis, overbroad patch): the U11a patch resolves every pending condition on a restore, including `idle`. C2's H4 settles `load` and `DOMContentLoaded` explicitly, keeps `idle` independent, adds the forward-restore, idle, and reload controls.
- FLAKE (CONFIRMED consistent with C1): the recorded failures all concern the missing contenteditable fill; C1's repair is verified at the merge by the service run.
- O1 (required): the readiness checker admits `it.skip.each` and `context.skip(!false, …)`. J4 extends it to chained declarations and validates the condition with negative controls.
- O2 (required): the port-release proof races unrelated port reuse. J5 observes an owned connection closing during `destroy()`.
- O3 (required): a partial block setup leaks the fixture server and dereferences an unassigned browser. J6 registers teardown after each acquisition and attempts every cleanup.
- O4 (blocking): the pins and the fixed-copy evidence lack reproducible attribution (the tooling never flips `it.fails`; prerequisites sit inside the expected-failure bodies). J7 records baseline and fixed-base ordinary-test runs per pin and moves the prerequisites out.
- Fixture sites (held, with a caveat): `--site-per-process` is not passed and two frames do not prove two processes. J8 passes the flag and asserts the child frame's own session outside the expected-failure body.
- Confirmed: claims 1–5, 7–9, 11, 13; the names conform; the missing toolset, dialog, popup, and served-document proofs are U11b's.
