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

## Second review (Astra `analyst`, read-only, 465 570 ms; report `tmp/worktrees/u9/tmp/codex/u10a-review2-answer.md`)

Verdict: FAIL 1, 2, 5, 6, 9, 10, 12, 13; outside the claims: O1 (required). Every first-round failing input is confirmed closed at the cited lines; the public surface (every export of `src/browser/index.ts`) is ruled correctly named and kept on the barrel; the core fit holds (the engine calls the element's `submit()` and reads the marker from `view.trusted`).

Rulings, each carried by the fix brief `tmp/units/u10a-fix2-brief.md` (K1–K9):

- Claim 1: ancestry for omission bypasses `assignedSlot`, so a slotted node under a hidden shadow ancestor survives a scoped outline. K1 follows the assigned slot first.
- Claim 2: the label rule refuses a click on an interactive descendant (a link inside a label for a file input). K2 applies the control checks only where the click can activate the label.
- Claim 5: `aria-labelledby` to a textbox ignores its value, a `visibility: hidden` reference loses the hidden-reference exception, an `img` without `alt` ignores `title`, and slot fallback or `display: contents` text is dropped as boxless. K3 carries the traversal context per the accessible-name computation.
- Claim 6: an expired initial check can be overtaken by a synchronous second check, a mutation queued in the task of `destroy()` repopulates the cleared manager, departed roots stay observed, and a shadow root attached after the wait began is never discovered. K4 settles once, prunes departed roots, and declares late shadow attachment a documented limit because the platform offers no observation event and polling is forbidden.
- Claim 9: a registration abort during the pending interval unregisters but still fulfils `registerTool()`; the draft rejects with the signal reason. K5 shares settlement with the abort steps.
- Claim 10: `launchBrowserEndpoint` creates the profile before its rollback boundary and drops it when a later acquisition or the destroy rejects. K6 registers the profile first and preserves both errors.
- Claim 12 and the 20 s budgets: no measured need was supplied. K7 measures under the default and keeps the budget only with a recorded failure.
- Claim 13: `role` and `name` return `'generic'` and `''` after collection while the claim said `GONE`. K8 rules them the captured outline values (data, as in core), never recomputed and never a fallback; the actions keep rejecting `GONE`.
- O1: no assertion observes the Vite runner's release. K9 exposes its lifecycle through the acquisition seam and records the mutation.
- Confirmed: claims 3, 4, 7, 8, 11, 14, 15; the design choices except the budgets and the unasserted runner; the weak discriminations the review's table names are added to the mutation record.
