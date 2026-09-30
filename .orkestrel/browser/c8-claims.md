# C8 claims

The worktree is `tmp/worktrees/c7` on branch `ccr-d15a48b1-yyyll6-c7` at `95ed9c8`. The change is uncommitted: 5 files changed, 61 insertions(+), 44 deletions(-).

## Change

- `src/core/constants.ts:460-466`: `BROWSER_TOOL_HANDLED_STATUS` holds `the page handled the submission without navigating; call wait for the text you expect`. Its TSDoc explains why `wait` is the next call: the page's outcome can arrive after the receipt.
- `src/core/BrowserToolset.ts:941`: `#settle` emits the constant where it emitted the literal. That covers every submit-capable action: `click`, `type` with `submit`, and `press`.
- `src/core/BrowserToolset.ts:110`: the class TSDoc names the constant and the next call.
- The no-form status is unchanged.
- `tests/src/core/BrowserToolset.test.ts:2279`: `names wait as the next call in the status of a submission the page handled` pins the constant's exact text and its `; call wait for the text you expect` ending.
- These expectations carry the directive:
  - the click test at `:1874`;
  - the handled-outcome matrix at `:2310`, over `click`, `type` with `submit`, and `press` Enter;
  - the service cases: the `/shop` click at `tests/service/toolset.test.ts:208`, and the checkout `type` with `submit` at `:250`.
- `guides/browser.md`:
  - `:199` is the constant's row;
  - `:1674` is step 5, which names `wait` as the next call;
  - `:2403` is the Receipts paragraph, which quotes the status and names the constant;
  - the receipts table is re-padded, because the handled-submission row is wider than its column.
- `tests/guides.test.ts` is unchanged, because it transcribes no copy of the string.

## Claims

1. After a submission a page listener prevented, with no surviving destination and no navigation, `click`, `type` with `submit`, and `press` Enter each end their receipt line with `; the page handled the submission without navigating; call wait for the text you expect.` The same page follows. Proof: `tests/src/core/BrowserToolset.test.ts:2310`, the 3 rows of `BROWSER_SUBMIT_ACTIONS`, and `:1874`.
2. The `type` with `submit` receipt reads `Typed "TEXT" into REF ROLE "NAME" and submitted the form; the page handled the submission without navigating; call wait for the text you expect.` Proofs:
   - in Chromium, `tests/service/toolset.test.ts:250` on the checkout fixture, where a following `wait` finds the confirmation;
   - `:208` covers the real prevented submit button on `/shop`.
3. The directive's text is pinned through `BROWSER_TOOL_HANDLED_STATUS` (`tests/src/core/BrowserToolset.test.ts:2279`).
4. The no-form status and every other status are unchanged; their tests pass unchanged.

## Mutation

| Name  | Mutation                                               | Result                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c8a` | the directive dropped from `BROWSER_TOOL_HANDLED_STATUS` | 5 failed, 125 passed over `src:core` `BrowserToolset.test.ts`: `names wait as the next call…`, the 3 handled-outcome rows (`click`, `type`, `press`), and `returns the same-page receipt without a navigation wait when every listener prevented the submission`. Files: `tmp/codex/c7-mutations/c8a/c8a.diff` and `c8a.log`; no unhandled error. |

## Validation

All commands ran from the worktree root.

| Command                                                                                          | Exit | Counts                           | Log                                    |
| ------------------------------------------------------------------------------------------------ | ---- | -------------------------------- | -------------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 5 touched files                              | 0    | all formatted                    |                                        |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 4 touched `.ts` files               | 0    | no diagnostics                   |                                        |
| `npm run check`                                                                                  | 0    | root, core, server, browser      |                                        |
| `npm run test:src`                                                                               | 0    | 1249 passed, 1 skipped           | `tmp/codex/c8-gates/test-src.log`      |
| `npm run test:setup`                                                                             | 0    | 145 passed                       | `tmp/codex/c8-gates/test-setup.log`    |
| `npm run test:policy`                                                                            | 0    | 114 passed, 1 skipped            | `tmp/codex/c8-gates/test-policy.log`   |
| `npm run test:guides`                                                                            | 0    | 207 passed                       | `tmp/codex/c8-gates/test-guides.log`   |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, current `dist` | 0 | 53 passed, 1 skipped            | `tmp/codex/c7-service-runs/10.log`     |

The service's toolset cases drive `src` through Vitest, so they ran the changed status. The current `dist` affects only the `/document` cases.

## Deviations

1. `tests/setup.ts` and `tests/setup.test.ts` needed no change, because no setup matrix carries the status string. The brief lists them as owned, not as required edits.
2. The v7 transcript under `/home/user/ollama` was not read, because the permission classifier refused reads there in C7. The evidence is the v7 entry of `.orkestrel/browser/ledger.md` (`:362`): the model pressed Enter again after the handled-submission receipt, and the store recorded two orders.
3. No file outside ownership changed. No shared-file patch is needed.

## Changed strings for the guide

- Status: `the page handled the submission without navigating` becomes `the page handled the submission without navigating; call wait for the text you expect`.
- Added constant: `BROWSER_TOOL_HANDLED_STATUS`, with the summary `Holds the status an action receipt carries after a submission a page listener prevented, with no navigation after it, naming \`wait\` as the next call because the page's outcome can arrive later.`
- Receipts row: `Typed "Ada Lovelace" into e3 textbox "Name" and submitted the form; the page handled the submission without navigating; call wait for the text you expect.`
- Step 5 under `BrowserToolsetInterface`: `the receipt line reports that the page handled a prevented submission and names \`wait\` as the next call`.
