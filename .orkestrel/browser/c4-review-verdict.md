# C4 review verdict

## Objective review

Astra `analyst`, read-only, 358 281 ms, on the C4 tree (`5b52bbb` plus the uncommitted W1–W5 and the Orchestrator's one-line patch to `tests/setupService.test.ts`): `VERDICT: FAIL 7, 9, D5, D6; outside the claims: O1, O2`. Claims 1–6 and 8 confirmed (the advertised parameters, the argument check on every toolset-owned tool, the footers outside the payload bound per the proposal, the role refusal before dispatch, the selection-error conversion, the DOM refusals, the 25-word bound); deviations 1–4, 7, and 8 confirmed (the five exports and the required footer belong on the surface and are U12's to document).

Rulings (the fix brief `tmp/units/c4-fix-brief.md` in the worktree):

- Z1 (claim 7; D6): a capture rejection that coincides with a navigation generation change routes through the one bounded retry; an unrelated failure stays a failure; cancellation is preserved.
- Z2 (D5; O1): `BrowserElementError` appends `; call look for fresh refs.` for `GONE` alone; the shared element failure boundary reduces every known compiled refusal to a one-line coded error, so no stack reaches a receipt.
- Z3 (claim 9): the deleted probe becomes a retained service case in both placements over the four contenteditable and role cases.
- Z4 (O2): the service receipt matcher validates the suffix after the still-loading line, with negative controls.
- Z5: the service log is supplied as evidence.

Carried to U12b: the exports `BROWSER_TOOL_CHANGED_NOTE`, `BROWSER_TOOL_CUT_FOOTER`, `BROWSER_TOOL_VIEW_FOOTER`, `BROWSER_TYPED_ROLES`, `validateBrowserToolArguments`, the error codes `BROWSER_TOOLSET_ARGUMENT` and `BROWSER_TOOLSET_ROLE`, `boundBrowserText`'s required footer, the element error's directive rule. Recorded as a limit: a click whose navigation commits after the capture returned carries the old page's view (the P20 contention finding stands; U16 rules on it).

## Second review (after Z1–Z5)

Astra `analyst`, read-only, 358 281 ms → 2nd pass on the fix round's tree: `VERDICT: FAIL 9, D2; outside the claims: none`. Claims 7, 10–18 confirmed (the navigation-caused rejection retried within the recorded-generation scope; one-line refusals with the directive on `GONE` alone; the retained role evidence in both placements; the matcher's negative controls); deviations 1, 3–6 confirmed. Claim 9's universal inference (a referenced element that takes text always carries a typed role) refuted by the fixture's own `role="button"` text input, which the element contract fills; D2's statement that an unlisted error keeps its raw first line refuted (it is rethrown unchanged).

Rulings, applied by the Orchestrator as record-level corrections: the `BROWSER_TYPED_ROLES` remark narrowed to the roles the tool admits (`src/core/constants.ts`), the claims file's deviation 2 corrected. C4 accepted and committed on its branch (`b5d87d9`), merged into `ccr-d15a48b1-yyyll6` (`412a0ca`). Carried to U12b: `BrowserElementRefusal`, `BROWSER_ELEMENT_REFUSALS`, and the earlier hand-off; the false-retry cost of a child-frame navigation (one extra outline within the deadline) recorded as a limit.
