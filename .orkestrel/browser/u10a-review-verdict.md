# U10a review verdict and rulings

Objective review by the Astra `analyst` (read-only, 438 537 ms; report `tmp/worktrees/u9/tmp/codex/u10a-review-answer.md`) over `tmp/units/u10a-claims.md` (12 claims) and `tmp/units/u10a-diff.patch` (`7e83c3b..09580e9`). The post-U7 contract comparison found no missing member or signature drift.

Verdict: FAIL 1, 2, 5, 6, 7, 8, 9, 10; outside the claims: O1, O2 (both required).

Rulings, each carried by the fix brief `tmp/units/u10a-fix-brief.md` (H1–H11):

- Claim 1 (BROKEN): the omission rules skip the scope root of `outline({ within })`. H1 applies them to the root and its ancestors.
- Claim 2 (BROKEN): a `label` wrapping a file input activates the chooser through the label. H2 judges a label by its control.
- Claim 5 (BROKEN): open shadow roots contribute no row, contrary to the proposal; `aria-labelledby` to an `img` ignores its `alt`, and hidden referenced descendants lose their text. H3 enters open shadow roots and computes referenced text per the accessible-name computation.
- Claim 6 (BROKEN): waits ignore the view's lifetime and a frame inserted after the wait began; the timer is armed after the initial check. H4 combines the signals, reconciles observed documents, and measures the deadline from entry.
- Claim 7 (BROKEN): child-frame readings use the parent view's epoch. H5 gives child-frame references their own document's epoch.
- Claim 8 (BROKEN): a native `WebSocket` constructor failure escapes the coded boundary. H6 translates it.
- Claim 9 (BROKEN): the registry double dispatches `toolchange` synchronously and lets a serialization failure escape as a raw `TypeError`. H7 follows the pinned draft's ordering and failure translation.
- Claim 10 (BROKEN): `setup()` leaks acquired resources when a later step throws, and one rejected cleanup skips the rest. H8 puts acquisition inside a rollback boundary.
- O1 (required): records retain removed nodes strongly, against the proposal's `WeakRef<Element>` binding. H9 binds weakly with a weak identity index.
- O2 (required): four claimed behaviours lack discriminating assertions. H10 adds them with the mutation record.
- Claim 12's note (bare `checkVisibility()` admits `visibility: hidden`): H11 passes `visibilityProperty: true`; zero-size and off-screen elements stay because the DOM face has no geometry rule.
- Confirmed: claims 3, 4, 11, 12; the `own` refusal stays in the view constructor.
