# Review verdict: unit U4 `elements`

Seam: the U4 diff in `/home/user/browser` (`tmp/units/u4-diff.patch`; 17 files modified, `src/core/elements/` and `tests/src/core/elements/` created) over the checkpoint `984e6f6`, written by GPT-6 Astra in one lane resumed once after a host restart. One objective review pass by the `reviewer` on Opus 5.5 (read-only, 821 692 ms on the relaunch after the container restart of 2026-09-30; the first run died at the restart with no report). Claims: `tmp/units/u4-claims.md` (16). Report: `tmp/units/u4-review-answer.md`. The lane relied on the Orchestrator's gate results and ran nothing.

## Terminal line

`VERDICT: FAIL 2, 3, 5, 15; outside the claims: O1, O2, O3, O4, O5`

## Chromium readings taken before ruling

The fifth probe series (`tmp/probes/cdp-native-5.test.ts`, logs `tmp/units/probe-cdp-native-series5.log` and `series5b.log`, real Chromium through this package's `createBrowser`, 2026-09-30) settled every protocol claim the review rested on:

| Probe | Reading |
| --- | --- |
| P21 | On the page session, `DOM.getNodeForLocation` at a point inside an out-of-process iframe returns the `<iframe>` owner (backend 8, the main frame); on the child session at the frame-local point it returns the button (backend 6) |
| P22 | `includeUserAgentShadowDOM: true` returns the inner user-agent shadow node for an input, a textarea, and a select (23, 25, 27 against elements 3, 4, 5); omitted or `false`, the element itself |
| P23 | `Input.insertText` with `''` after a select-all clears the value; a Delete key press clears it too; `'z'` replaces the selection |
| P24 | Content quads are viewport-relative (the button's centre moved from y 3020 to y 120 after a 2 900 px scroll); the click at the viewport point lands; `DOM.getNodeForLocation` takes document coordinates and answers `No node found at given location` for a point scrolled out of view; `Page.getLayoutMetrics` reports `cssVisualViewport.pageY: 2900` |
| P25 | A cross-site `history.back()` served from the back-forward cache emits `Page.frameNavigated` alone: no lifecycle event, no `Page.backForwardCacheNotUsed` (the first run, with a `no-store` header, was not served from the cache and emitted the full lifecycle) |
| P26 | An iframe's content quads are its border box; with a 10 px border the click at the border-box offset lands in the parent and the click at `DOM.getBoxModel.content` lands on the button |

## Rulings

The following table rules on each claim and outside finding; the fix round runs on the same Astra thread (prescriptions H1–H17 in `tmp/codex/u4-fix-brief.md`, each behavioural change closed by a mutation probe).

| Finding | Verdict | Ruling | Carried in |
| --- | --- | --- | --- |
| 1 Reference parsing | CONFIRMED | Held | — |
| 2 Outline | BROKEN | Accepted: every non-omitted role received a reference, against the proposal's "interactive elements with references, headings as `# NAME`, and text lines"; the role set ruled as `BROWSER_INTERACTIVE_ROLES` plus `Iframe` | H1 |
| 3 Keys and frames | BROKEN | Accepted and confirmed by P21: the out-of-process click hit-tested on the page session, which reports the frame owner; the fixture answered a reply Chromium cannot produce | H2, H6, `PROPOSAL.md` step 4 amended |
| 4 Reference lifetime | CONFIRMED | Held | — |
| 5 Click | BROKEN | Accepted and confirmed by P22: `includeUserAgentShadowDOM: true` plus `this.contains(target)` refuses every input, textarea, and select as `OCCLUDED` | H3, `PROPOSAL.md` step 4 amended |
| 6 Fill and keys | CONFIRMED | Held | — |
| 7 Find | CONFIRMED on the code | Held; the "arms before" half is O13 | H17 |
| 8 Waits | CONFIRMED | Held; the retry breadth is O5 | H10 |
| 9 World cache | CONFIRMED | Held | — |
| 10 Readiness | CONFIRMED | Held; the restore case is O14b | H7 |
| 11 Identity across captures | CONFIRMED | Held; the breadth of the check is O2 | H8 |
| 12 Cleanup | CONFIRMED on the code | Held; the proof gap is O13 | H17 |
| 13 Removals and moves | CONFIRMED | Held | — |
| 14 Names and shapes | CONFIRMED | Held with the correction that the four `compile*` functions follow the compiler family, not the `Browser` prefix | — |
| 15 Tests discriminate | BROKEN | Accepted: the fixture test did not pin the overlapping backend id the sessionless-key test depends on; the five red-then-green records rested on the writer's report alone | H4 (the fixture assertion; every probe re-run whole-file with its red assertion line quoted) |
| 16 Boundaries | CONFIRMED | Held | — |
| O1 (blocking) a failed readiness seed poisons the page | Accepted | Seed under its own bound, cleared on rejection; each caller races its own signal | H5 |
| O2 (required) a child navigation aborts every capture | Accepted | A generation per frame | H8 |
| O3 (required) three commands bypass the element codes | Accepted | One mapping for every element command | H9 |
| O4 (required) `fill('')` leaves the text | Refuted by P23 | No change; the review reasoned from Playwright's rationale, and this Chromium clears the selection on an empty insert | — |
| O5 (required) the wait retries on one context message | Accepted | The context-id message added | H10 |
| O6 (optional) the wait edits the world cache | Accepted | Removed; the handlers invalidate | H11 |
| O7 (optional) a stale element reports another node's role and name | Accepted | The reference checked in the getters | H12 |
| O8 (optional) CSS find gaps | Accepted in part: the concurrent `DOM.getDocument` race and the `within` key namespace are fixed; in-process child documents are a documented limit of a `css` query (the outline reaches them) | H13 |
| O9 (optional) element screenshot clip after a scroll | Accepted on P24's coordinate reading | H14 |
| O10 (optional) the frame offset uses the border box | Accepted and confirmed by P26 | H15, `PROPOSAL.md` step 3 amended |
| O11 (optional) error subjects and messages | Accepted | H16 |
| O12 (optional) the guide's selector wait | Recorded for U12 | — |
| O13 (optional) two proof gaps | Accepted | H17 |
| O14a (unresolved) the hit test's coordinate space | Settled by P24: document coordinates, nothing for a point out of view | H6 |
| O14b (unresolved) a back-forward cache restore | Settled by P25: `Page.frameNavigated` of type `BackForwardCacheRestore` with no lifecycle event; readiness accepts the restore at once | H7, `PROPOSAL.md` acceptance 10 amended |

## Held

The lane attacked and held: the six reference spellings and the four rejections; the same instance across outlines, references kept across a same-document navigation, a child navigation dropping only its frame, a main-frame navigation emptying `element()` and refusing `GONE` naming `look`, numbering past the previous maximum and across pages of one context; the click order and its three refusals; the abort after `mousePressed` still releasing; fill, press, the key aliases, and the unknown-key listing; the case-insensitive name match and the CSS pair; the wait's resolve, re-arm after `DOMContentLoaded` alone, timeout on `false`, and disconnect on abort with the compiled deadline verified by evaluation; one world per document and every evaluation carrying it; the stale-loader `DOMContentLoaded` ignored; the capture-generation check publishing nothing across a navigation; the release in `finally`; the five rewritten selector-wait callers with their assertions; the names, the error code and guard, no nested function, every `setTimeout` a deadline; no import cycle and nothing from the locator stack.
