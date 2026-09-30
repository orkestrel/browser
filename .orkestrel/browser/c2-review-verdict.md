# C2 review verdict and rulings

Objective review by the Astra `analyst` (read-only, 334 686 ms; report `tmp/worktrees/c2/tmp/codex/c2-review-answer.md`) over `tmp/units/c2-claims.md` (10 claims) and `tmp/units/c2-diff.patch` (`0ee6980..14d9cef`).

Verdict: FAIL 5; outside the claims: O1, O2, O3, O4 (all required). Claims 1–4 and 6–10 confirmed (the attach orderings, the remove path, reference invalidation on a swap, the exact backend-id phrase with its controls, the history conditions and their controls, the history-scoped restore subscription, the pending-record cleanup under Chromium's fresh session tokens, the frame tree enrichment and refused reads).

Rulings, each carried by the fix brief `tmp/units/c2-fix-brief.md` (L1–L5):

- Claim 5 (BROKEN): a `Page.frameNavigated` delivered in the same socket read as the frame tree reply is overwritten by the reply's continuation, because the installed WebSocket drains buffered frames synchronously. L1 captures the pending record's identity before the read and applies the snapshot only if no navigation replaced it; the pending-navigation fixture's root is fixed so enrichment runs in that test.
- O1 (required): `back()` and `forward()` pass their signal to neither the history commands nor the load wait, unlike `navigate()` and `reload()`. L2 honours the call-options cancellation contract.
- O2 (required): a superseded session's `Target.detachedFromTarget` deletes the frame mapping its replacement owns, and its late `frameNavigated` can overwrite the replacement's URL. L3 keeps explicit current-session ownership per frame and retires superseded subscriptions.
- O3 (required): a child session's `Page.navigatedWithinDocument` advances the epoch but leaves the listed URL stale. L4 updates the owning record.
- O4 (required): a collected iframe owner's `DOM.getBoxModel` failure escapes the element classifier from the manager's point resolution. L5 routes it through the classifier.
- The review's general note that no assertion fails under exactly one implementation is accepted as the nature of behavioural discrimination; the weaker implementations it names are checked in the fix round's mutation record where a test can distinguish them.
