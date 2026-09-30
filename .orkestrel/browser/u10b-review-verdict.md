# U10b review verdict and rulings

Objective review by the Astra `analyst` (read-only, 458 960 ms; report `tmp/codex/u10b-review-answer.md`) over `tmp/units/u10b-claims.md` (23 claims) and `tmp/units/u10b-diff.patch` (the uncommitted unit over `533d19f`).

Verdict: FAIL 6, 9, 14, 23; outside the claims: O1, O2 (required). The three pending rulings confirmed (the injectable clock, the measured 15 000 ms budgets as a bounded allowance, the guide fence). Confirmed: the four acceptance criteria, R1, R3, R4, R6 with its stated limitation, R7, R8, R9, R11, R12, R13, R14 (each closing its third-review item), and the design choices 19–22.

Rulings, each carried by the fix brief `tmp/units/u10b-fix-brief.md` (N1–N11):

- Claim 6 (BROKEN in its inventory, the implementation holds): `select` and `submit` reach `GONE`, `HIDDEN`, and `DISABLED` through `#actionable`. N1 corrects the inventory and pins the missing cases.
- Claim 9 (UNRESOLVED): the `tsc` control was reported without a log. N2 records it.
- Claim 14 (BROKEN in its proof): the third wait trace spins on a deadline against `tests.md`. N3 injects `now` into `BrowserMutationWait` and drives it from the test.
- Claim 23 (BROKEN): a factory-owned view outlives its toolset, and a constructor throw leaks the view with no handle. N4 gives `BrowserToolsetOptions` a `release` callback that `destroy()` calls once, passed by the factory, which also destroys the view when construction throws.
- O1 (required): the public trust documentation claims every event is untrusted while `requestSubmit()` fires a trusted `submit`. N6 corrects both statements.
- O2 (required): two setup assertions sit before the cleanup block. N7 moves them inside.
- The mutant table's weak spots: N8 (a CSS-selected element never captured by an outline), N9 (the later-path returned-value abort case), N10 (an invisible image's `alt`).
