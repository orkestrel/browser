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

## Second review (Astra `analyst`, read-only, 285 664 ms; report `tmp/worktrees/c2/tmp/codex/c2-review2-answer.md`)

Verdict: FAIL 11; outside the claims: O1, O2, O3, O4 (required). First-round claim 5, O3, and O4 closed; O1 and O2 closed for their original orderings with the remainders below. Claims 5, 12, 13, 14 confirmed.

Rulings, each carried by the fix brief `tmp/units/c2-fix2-brief.md` (M1–M6):

- Claim 11 (BROKEN): a restore delivered before an abort in the same tick resolves the load wait, and history's completion evaluation takes no options, so the call resolves instead of rejecting. M1 checks the signal after the load wait, passes the call options through the completion evaluation, and checks before returning.
- O1 (required): an empty history returns success after a reply-then-abort ordering because the request's abort listener is already gone. M2 checks the signal right after the history reply.
- O2 (required): the element manager keeps a retired session's handlers and its invalidation handler checks no ownership, so a superseded session's late navigation deletes the replacement's references. M3 keys the manager's handlers by session, drops the retired session's on replacement, and ignores events from a non-owner, with no new public event.
- O3 (required): the `back`/`forward` case matrices sit inline in the test file against the setup-file rule. M4 exports them from `tests/setup.ts`.
- O4 (required): `#sessionHandlersFor` is a noun phrase. M5 renames it `#resolveSessionHandlers`.
- The fixture note (a wrong-session enrichment read can pass, and the pending-navigation test uses one URL for the tree and the navigation): M6 asserts the read's session and separates the URLs.
