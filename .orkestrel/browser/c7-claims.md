# C7 claims

Worktree `tmp/worktrees/c7`, branch `ccr-d15a48b1-yyyll6-c7` from `6cf6625`. The change is uncommitted and touches 10 files, +642 −66 lines.

## C7-1: an offset beyond the retained reading restarts at 0

Change:

- `src/core/BrowserToolset.ts:399-415`: `#read` recaptures when `offset >= reading.markdown({ offset: 0, limit: 1 }).total`, so `start` is the offset only inside the retained reading and 0 otherwise.
- `src/core/BrowserToolset.ts:439`: the footerless return keys on `start === 0 && !more`, so a restart that fits whole carries no footer, and one that does not fit carries `[characters 0–END of TOTAL; call read with offset END for more]`.
- `tests/src/core/BrowserToolset.test.ts:3683`: `restarts at 0 a read whose offset reaches or passes the end of the retained reading, and continues one inside it`.

Claims:

1. A `read` at offset `TOTAL` or `TOTAL + 1 000` over a retained reading of `TOTAL` characters recaptures the view and returns the same text and footer as the first `read`, `[characters 0–END of TOTAL; call read with offset END for more]`. The test pins the capture count at 3.
2. A `read` at offset `TOTAL − 1` continues the retained reading without a capture and returns `[characters TOTAL−1–TOTAL of TOTAL]`.
3. The existing continuation and stale-reading tests pass unchanged: `catches a continuation read that recaptures a current reading or reuses a stale one` and `catches a continuation offset that counts the move note instead of the reading`.

## C7-2: the receipt states what became of the submission

Read shape: `compileSubmitReadExpression` (`src/core/compilers.ts:139-190`) resolves `{ destinations, prevented, submitted, implicit }`, or `null` when no observer of the token is installed.

- `destinations`: the surviving relationships, unchanged from C6.
- `prevented`: true when a listener prevented any recorded `submit`.
- `submitted`: true when the observer recorded any `submit`.
- `implicit`: true when `document.activeElement` is an `input` a form owns.

Two fields go beyond the prescribed `{ destinations, prevented }`, for these reasons:

- `submitted` separates "no submission" from a recorded submission with no destination, such as a `dialog` or `_blank` form.
- `implicit` decides "`press` of Enter in a form control".

`BrowserDestination` is unchanged.

Consumer changes:

- `src/core/BrowserToolset.ts:1031-1110`: `#readSubmission` validates the record with `isRecord` and `isArray` and returns undefined for a read that failed, timed out, answered `null`, or answered off-shape. `#readSubmissions` aggregates the reads: `submitted` is true when any read recorded one, false only when every owned document answered, and undefined otherwise.
- `src/core/BrowserToolset.ts:876-952`: `#settle` takes `enter?: { explicit, action }`.
  - Statuses: `committed` and `requested` keep the C6 text. When there is no surviving destination and no settled navigation, a recorded prevention renders `the page handled the submission without navigating`. When `submitted === false` and the action asked for a submission (`explicit`, or Enter with `implicit`), it renders `no form received the submission`.
  - Action line: the `enter.action` line replaces the attempt when `submitted === true`, or when `submitted` is undefined and a navigation was followed (the input lost the race, or `settle` returned a stage).
- `src/core/BrowserToolset.ts:572-585`: the page placement's `type` with `submit` attempts `… and pressed Enter` with `{ explicit: true, action: '… and submitted the form' }`. The DOM placement, which calls `requestSubmit()`, keeps `… and submitted the form` without `enter`.
- `src/core/BrowserToolset.ts:616-625`: `press` passes `{ explicit: false, action }` for `Enter` only.
- Class TSDoc: `src/core/BrowserToolset.ts:107-115`.

Claims:

4. `click`, `type` with `submit`, and `press` Enter over a prevented submission return `ACTION; the page handled the submission without navigating.` with the same page, in under 1 000 ms. The `type` line keeps `and submitted the form`.
   - Proofs: `tests/src/core/BrowserToolset.test.ts:2274` (`it.each` over `BROWSER_SUBMIT_ACTIONS`) and `:1850` (click, updated).
5. `type` with `submit` that records no submission returns `Typed "sam" into e2 textbox "Email" and pressed Enter; no form received the submission.`
   - `press` Enter returns `Pressed Enter; no form received the submission.` when the focused element is an `input` a form owns, in the main frame or in the observed child frame.
   - With no status: `press` Tab, `click` with nothing recorded, and Enter in a `textarea` or in an `input` no form owns.
   - Proofs: `tests/src/core/BrowserToolset.test.ts:2306` and `:477` (updated).
6. A surviving destination alongside a prevented submission keeps the destination view and no handled status: `tests/src/core/BrowserToolset.test.ts:2354`. The C6 surviving outcomes pass unchanged for all three actions: `waits for the navigation a %s submission starts…`, `bounds a submission that produces no navigation request…`, `settles a submission whose navigation stays within the document…`.
7. `type` with `submit` keeps `and submitted the form` when a navigation outran the Enter before any read (`:2392`), and when the read failed and a navigation followed (`:2443`). It says `and pressed Enter.` with no status when the read failed and nothing navigated (`:2443`).
8. The read's `prevented` flag:
   - A prevented event reads `prevented: true`, a surviving one `false`, and both orders of both `true`.
   - Every case reads `submitted: true`, and no submission reads `submitted: false`.
   - `implicit` is true only for an `input` a form owns (`textarea`, `button`, a formless `input`, and no focus read false).
   - Proofs: `tests/src/core/compilers.test.ts:221-266`, using `BROWSER_SUBMIT_CASES` with its prevented column (`tests/setup.ts:181-240`).
9. Real Chromium, `tests/service/toolset.test.ts:228`, over `/checkout` (`tests/setupServer.ts:995-1013`).
   - The page's `submit` listener calls `preventDefault()`, posts to `/checkout/order` (`:1364`), and inserts `Order A1042 placed for Ada Lovelace.` `FIXTURE_CHECKOUT_DELAY` (200 ms) after the code arrives.
   - The `type` with `submit` receipt is `Typed "Ada Lovelace" into REF textbox "Name" and submitted the form; the page handled the submission without navigating.`, followed by the checkout page without the line.
   - A following `wait` returns `"Order A1042 placed for Ada Lovelace." is on the page.`
   - Control: the gift form's `type` with `submit` returns `… and submitted the form` and the `/form/placed` destination view.
10. Real Chromium, `tests/service/toolset.test.ts:191`: the C6 `/shop` click on the prevented `Save for later` submit button returns `Clicked REF button "Save for later"; the page handled the submission without navigating.` and the same page. The expectation and the title were updated.

## C7-3: the guide

Change:

- `guides/browser.md:2399`: the `### Receipts` paragraph now states the handled status and the no-form status and the `and submitted the form` and `and pressed Enter` rule for both placements. It also states the C7-1 `read` rule: continuation only inside the retained reading; restart at 0 for an offset at or past its end, for no retained reading of the view, or for a changed document; the footer shows the range or is absent when the whole reading fits.
- `guides/browser.md:2425-2427`: 3 rows cover the handled status, `type` with `submit` that no form received, and `press` Enter that no form received.
- `guides/browser.md:1669-1670`: steps 4 and 5 under `BrowserToolsetInterface`.
- `guides/browser.md:527`: the `compileSubmitReadExpression` fence comment names the object shape.

Claims:

11. `npm run test:guides` exits 0 with 207 tests. No Summary cell moved, because the first sentence of the `compileSubmitReadExpression` TSDoc is unchanged. `tests/guides.test.ts` needs no change: no transcribed fence, prompt, or receipt constant moved. No shared-file patch is needed.

## Mutations

Each mutant was installed in place, the touched files ran (`npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/compilers.test.ts`), and the source was restored by copy and verified with `cmp`. Each directory under `tmp/codex/c7-mutations/` holds `NAME.diff` and `NAME.log`. No log carries an unhandled error.

| Name  | Mutation                                                               | Result                                                                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c7a` | offset used as is: the `offset >= … .total` recapture clause removed   | 1 failed, 144 passed: `restarts at 0 a read whose offset reaches or passes…`, `expected '\n\n[characters 729–729 of 729]' to be '# Guide\n\nParagraph 0 …'` (the v6 defect)                                                                                |
| `c7b` | handled status dropped                                                 | 4 failed, 141 passed: `returns the same-page receipt without a navigation wait when every listener prevented the submission`, and `names the page handling of a click / type / press submission…`                                                            |
| `c7c` | `prevented: false` in the read                                         | 7 failed, 138 passed: the 3 compiler cases with a prevented event (`a prevented submission`, and the 2 mixed orders), plus the 4 `c7b` toolset tests                                                                                                       |
| `c7d` | no-form status dropped                                                 | 2 failed, 143 passed: `catches a type that skips the selection, the insert, or the Enter…`, and `names no form for a type with submit or an Enter in a form input…`                                                                                         |
| `c7e` | page `type` attempt fixed to `and submitted the form`                  | 3 failed, 142 passed: the 2 `c7d` tests, and `names the Enter of a type whose observer read failed and no navigation followed`                                                                                                                             |
| `c7f` | clause upgraded only on a recorded submission (navigation ignored)     | 2 failed, 143 passed: `keeps the submitted clause of a type whose Enter a navigation outran before any read`, and `names the Enter of a type whose observer read failed and a navigation followed`                                                          |

Failing-first: each test was written with its fix in place. The fail count before the fix is therefore the mutant run that restores the old behaviour: `c7a` for C7-1, and `c7b`, `c7c`, `c7d`, and `c7e` for C7-2. With the new code and the C6 expectations, the touched-file run was 2 failed, 134 passed, and those 2 were the expectations updated for the new receipt.

## Validation

All commands ran from the worktree root and were read bare.

| Command                                                                                                          | Exit | Counts                            |
| ---------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 10 touched files                                             | 0    | 10 files formatted                |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 9 touched `.ts` files                              | 0    | no diagnostics                    |
| `npm run check`                                                                                                  | 0    | root, core, server, browser       |
| `npm run test:src`                                                                                               | 0    | 58 files, 1205 passed, 1 skipped  |
| `npm run test:setup`                                                                                             | 0    | 5 files, 142 passed               |
| `npm run test:policy`                                                                                            | 0    | 114 passed, 1 skipped             |
| `npm run test:guides`                                                                                            | 0    | 207 passed                        |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, run 1                     | 0    | 3 files, 53 passed, 1 skipped     |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, run 2                     | 0    | 3 files, 53 passed, 1 skipped     |
| `npm run build`                                                                                                  | none | not run; see deviation 1          |

The `tests/setupServer.ts` doc comment was rewrapped after the gates; its `oxfmt` and `oxlint` checks exit 0.

## Deviations

1. `npm run build` was not run, because the executor's operating instructions refuse `build`.
   - The service runs used the `dist` the worktree was dispatched with, from `6cf6625`, which only the `/document` cases import. The C7 cases drive `src` through Vitest.
   - Expected: the build runs. Found: the instruction conflict. Done: every other gate. Not done: the build and a service run over a rebuilt `dist`.
2. The v6 transcripts under `/home/user/ollama/tmp/probes/logs/v6/` and `/home/user/ollama/tests/setupStore.ts` were not read, because the permission classifier refused the read.
   - The fixture follows the brief's description and the ledger entry `.orkestrel/browser/ledger.md:348`.
3. The read shape adds `submitted` and `implicit` beyond `{ destinations, prevented }`, for the reasons stated under C7-2.
4. The clause rule is an ancillary choice: `and submitted the form` also holds when no read answered and a navigation followed.
   - Reason: in Chromium the navigation request arrives before the input reply (ledger `:323`, and the ordering pinned at `tests/service/toolset.test.ts:627`). Otherwise a navigating form's receipt would change clause across that race.
   - Consequence: a dialog that interrupts a `type` with `submit` during its Enter names the attempt, `… and pressed Enter`, because no read ran.
5. The unit `click` outcome uses the element fixture's `e1` link, with the observer read scripted, because the fixture's only button is disabled. A real submit button is covered in Chromium by the `/shop` case (claim 10).
6. No `prove` tool is registered in this session, so each claim reads `no receipt`. The claims are runtime behaviour, proven by the tests and mutations listed earlier.
7. No file outside ownership needed a change. No shared-file patch is needed.

## Public surface for the guide

- `compileSubmitReadExpression`: the `@returns` value and the `@remarks` changed. It resolves `{ destinations, prevented, submitted, implicit }` or `null`, where it previously resolved an array or `null`. The summary sentence is unchanged.
- The `BrowserToolset` class TSDoc gains 3 sentences on the statuses, the `type` clause, and the `read` restart.
- Receipt strings:
  - The status `the page handled the submission without navigating`.
  - The status `no form received the submission`.
  - The page placement's `type` with `submit` action `Typed "TEXT" into REF ROLE "NAME" and pressed Enter`, when no submission was recorded and no unread navigation followed.
- `read`: an offset at or past the retained reading's total recaptures and returns `[characters 0–END of TOTAL; call read with offset END for more]`, or no footer when the reading fits.
- Unchanged: the types in `src/core/types.ts`, including `BrowserDestination` and `BrowserReceipt`; `src/core/constants.ts`; `src/core/helpers.ts`; the tool descriptions in `BROWSER_TOOL_COPY`.
- Test infrastructure:
  - `tests/setup.ts`: the `BrowserSubmitFocus` type, `BrowserSubmitWindow.activeElement`, and `BrowserSubmitWindow.focus(element?)`. `BROWSER_SUBMIT_CASES` gains the `prevented` column.
  - `tests/setupServer.ts`: `FIXTURE_CHECKOUT_CODE` (`A1042`), `FIXTURE_CHECKOUT_DELAY` (200), the `/checkout` page, and `POST /checkout/order` answering `200` with the code.

# Fix round (F1 to F5)

The rulings are in `.orkestrel/browser/c7-review-verdict.md` and were executed per `tmp/units/c7-fix-brief.md`. The C7 change and this fix round remain uncommitted: 10 files, +997 −114 lines against `6cf6625`.

## F1: a beyond-the-end offset reuses the retained reading

Change:

- `src/core/BrowserToolset.ts:399-417`: `#read` recaptures only for offset 0, no retained reading of the view, a moved view, or a stale reading. `start` is the offset only when the retained reading is reused and the offset lies inside it (`:415`), and 0 otherwise.
- `guides/browser.md:2399` states that a navigation makes a reading stale and that an edit which is not a navigation leaves it current.

Claims:

12. A `read` at the retained reading's total, and at total + 1 000, after the page's HTML changed without a navigation, returns the first slice of the retained reading, text and total, with its footer.
    - That `read`, and the interior-offset `read` at total − 1, send no capture: exactly 1 `outerHTML` evaluation.
    - A following `read` at offset 0 returns the edited text, which proves the edit was visible to a capture.
    - Proof: `tests/src/core/BrowserToolset.test.ts:3687`.

## F2: the Enter's recipient recorded at dispatch

Change:

- `src/core/compilers.ts:126-146`: the observer registers a capture-phase `keydown` listener beside the `submit` listener. For an Enter it sets `state.implicit` when `event.target` is an `input` whose `form` is not null.
- `src/core/compilers.ts:176-199`: the read returns `implicit: state.implicit`, reads no focus, and removes both listeners. Each observer's replacement removes both listeners too.
- `tests/setup.ts:455-520`: the fake window registers `submit` and `keydown` listeners.
  - `press(key)` sends a `keydown` to the focused element: the capture listeners run first, then the element's own handler moves the focus when `BrowserSubmitFocus.moves` names an element.
  - A window whose focus sits on an `iframe` sends nothing.
  - `BrowserSubmitWindows.press` presses in every window.
  - The element fixture presses the key of every `Input.dispatchKeyEvent` key-down in its windows before replying (`tests/setup.ts:1321`).
- The read's `document.activeElement` path is deleted. The fake keeps an `activeElement` getter, which the setup proof reads to show where a handler moved the focus; see deviation 9.

Claims:

13. An Enter received by a form-owned `input` whose handler then focuses a textarea reads `implicit: true`. An Enter received by a textarea whose handler then focuses a form input reads `false`. A formless input, a textarea, a button, a Tab, and no focus read `false`. An Enter sent before the installation is not recorded.
    - Proofs: `tests/src/core/compilers.test.ts:245` (the `BROWSER_SUBMIT_FOCUS_CASES` rows) and `:263`.
14. Through the toolset:
    - `press` Enter in a form input whose handler moves the focus to a textarea returns `Pressed Enter; no form received the submission.`
    - `press` Enter in a textarea whose handler moves the focus into a form input returns `Pressed Enter.`
    - The rows with unchanged focus return what they did in C7.
    - Proof: `tests/src/core/BrowserToolset.test.ts:2309` (the 9 `BROWSER_SUBMIT_FOCUS_STEPS` rows).

## F3: an unread navigation leaves the submission unknown

Change:

- `src/core/BrowserToolset.ts:942`: the `type` line becomes `and submitted the form` only when a read recorded a submission, and stays `and pressed Enter` otherwise, whether or not a navigation followed. The settlement, the destination view, and the C6 statuses are unchanged.
- `guides/browser.md:2399` and the row at `:2412` follow.

Claims:

15. A `type` with `submit` whose Enter a navigation outran before any read returns `… and pressed Enter.` and the destination view (`tests/src/core/BrowserToolset.test.ts:2368`).
16. When the read failed, a `type` with `submit` returns `… and pressed Enter.`: with the destination view when a navigation followed, and with the same page otherwise (`:2415`, over the `BROWSER_SUBMIT_UNREAD_CASES` rows).
17. On Chromium, a navigating `type` with `submit` ends with either clause, depending on the race between the navigation and the observer read. Run 1 of this round returned `and pressed Enter` in all 6 navigating cases; run 2 returned `and submitted the form` in the nested `_parent` case.
    - The six navigating service assertions accept both clauses through `BROWSER_SUBMIT_CLAUSES` (`tests/setup.ts:271`), and each still requires the destination view.
    - The handled-checkout case keeps its exact `and submitted the form; the page handled the submission without navigating.` line.
    - See deviation 8.

## F4: the read record validated

Change:

- `src/core/BrowserToolset.ts:1064-1110`: `#readSubmission` accepts a record only when `destinations` is an array of strings and `prevented`, `submitted`, and `implicit` are booleans. Any other value is undefined, an unknown outcome.

Claims:

18. A record without `implicit`, a record whose `submitted` is `'false'`, a record whose `destinations` hold a number, `null`, and a bare array each give a `type` with `submit` the line `Typed "sam" into e2 textbox "Email" and pressed Enter.` with no status.
    - Proof: `tests/src/core/BrowserToolset.test.ts:2454` (the `BROWSER_SUBMIT_MALFORMED_READS` rows).

## F5: the matrices in the setup

Change: `tests/setup.ts` exports these constants, each with TSDoc:

- `BROWSER_SUBMIT_CLAUSES` (`:271`)
- `BROWSER_SUBMIT_FOCUS_STEPS` (`:280`, 9 rows)
- `BROWSER_SUBMIT_FOCUS_CASES` (`:369`, 8 rows)
- `BROWSER_SUBMIT_UNREAD_CASES` (`:396`, 2 rows)
- `BROWSER_SUBMIT_MALFORMED_READS` (`:408`, 5 rows)

The test files keep the registrations and the assertions.

Claims:

19. `tests/setup.test.ts:1061` proves each constant's shape and row count. `:1016` proves the fake's key dispatch: capture listeners before the handler's focus move, and nothing sent from an iframe or without a focus. `:1049` proves that a key is pressed in every window.

## Mutations

Each mutant was installed in place, ran over `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/compilers.test.ts`, then restored and verified with `cmp`. Each directory under `tmp/codex/c7-mutations/` holds the `.diff` and `.log`, and the logs carry no unhandled error. `c7a` to `c7e` were rerun on the fixed tree and their logs replaced; `c7f` is retired and its directory deleted.

| Name  | Mutation                                                     | Result                                                                                                                                                                              |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c7a` | offset used as is on the retained reading                    | 1 failed, 165 passed: `restarts the retained reading at 0…`; `expected '\n\n[characters 729–729 of 729]' to be '# Guide…'`                                                          |
| `c7b` | handled status dropped                                       | 4 failed, 162 passed: the 3 prevented-outcome cases and the click test at `:1850`                                                                                                   |
| `c7c` | `prevented: false` in the read                               | 7 failed, 159 passed: the 3 compiler prevented cases and the 4 `c7b` tests                                                                                                          |
| `c7d` | no-form status dropped                                       | 5 failed, 161 passed: `catches a type that skips…`, and the focus steps for `type` with `submit`, form input, framed form input, and form input that moves the focus to a textarea |
| `c7e` | page `type` attempt fixed to `and submitted the form`        | 10 failed, 156 passed: the `c7d` `type` rows, the early-navigation case, both unread cases, and the 5 malformed-read cases                                                          |
| `c7g` | recapture restored on a beyond-the-end offset                | 1 failed, 165 passed: `restarts the retained reading at 0…`; `expected '# Edited…' to be '# Guide…'`                                                                                |
| `c7h` | `implicit` read from `document.activeElement` at read time   | 6 failed, 160 passed: both moved-focus rows in the compiler and in the toolset matrix, the Tab row, and the replacing-installation case                                             |
| `c7i` | validation dropped: `destinations` array only, booleans `=== true` | 3 failed, 163 passed: the missing-boolean, wrong-typed boolean, and non-string-destination rows (`null` and the bare array stay unknown under the mutant too)                 |

## Validation

All commands ran from the worktree root and were read bare.

| Command                                                                                          | Exit | Counts                           |
| ------------------------------------------------------------------------------------------------ | ---- | -------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 8 files touched this round                   | 0    | all formatted                    |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 7 touched `.ts` files               | 0    | no diagnostics                   |
| `npm run check`                                                                                  | 0    | root, core, server, browser      |
| `npm run test:src`                                                                               | 0    | 58 files, 1226 passed, 1 skipped |
| `npm run test:setup`                                                                             | 0    | 5 files, 144 passed              |
| `npm run test:policy`                                                                            | 0    | 114 passed, 1 skipped            |
| `npm run test:guides`                                                                            | 0    | 207 passed                       |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, final run | 0    | 3 files, 53 passed, 1 skipped    |

The service run over the `dist` from the Orchestrator's build failed once before the clause tolerance: 1 failed, the `_parent` case returned `and submitted the form`. See claim 17. The compilers file was rerun after a title rename: 43 passed.

## Deviations

8. F3 makes the navigating `type` clause depend on a race that the model does not see.
   - Expected: the Chromium receipts are stable under F3.
   - Found: after F3 the six navigating service cases first failed with `and pressed Enter`. After those expectations changed, a later run returned `and submitted the form` in the `_parent` case.
   - Done: the service assertions accept either clause, and each still requires the destination view.
   - Not done: a deterministic clause for this case, which F3 rules out.
   - Hypothesis: a deterministic clause for a navigating form needs the submission read before the navigation commits, or a request reason that `BrowserPage` records (the review cites `BrowserPage.ts:1607`), which is outside ownership.
9. The fake window keeps an `activeElement` getter in the shape `document.activeElement` has, although F2 asks to delete dead `activeElement` paths.
   - The read no longer uses it.
   - The setup proof reads it to show that a handler moved the focus.
   - It makes `c7h`, the read-time focus mutant, expressible against the fake.
10. The guide row for a navigating `type` with `submit` (`guides/browser.md:2412`) names both clauses, per claim 17.
11. No file outside ownership changed. No shared-file patch is needed.

## Public surface for the guide (updated)

- `compileSubmitObserverExpression`: `@remarks` gains the capture-phase `keydown` listener. The summary sentence is unchanged.
- `compileSubmitReadExpression`: `implicit` means an Enter that an `input` a form owns received, recorded at dispatch. The shape `{ destinations, prevented, submitted, implicit }` is unchanged.
- The `BrowserToolset` class TSDoc now states:
  - the no-form status for an Enter that a form-owned input received;
  - `and submitted the form` only after a recorded submission, and `and pressed Enter` otherwise, a navigation included;
  - the restart at 0 for an offset at or past the retained reading's end.
- Receipt strings: a navigating `type` with `submit` in the page placement ends `and pressed Enter.` unless the read recorded the submission first. The statuses are unchanged from C7.
- `read`: an offset at or past the retained reading's total returns that reading's first slice with `[characters 0–END of TOTAL; call read with offset END for more]`, with no capture. Only a navigation or a moved view recaptures.
- Test infrastructure in `tests/setup.ts`:
  - `BrowserSubmitFocus.moves`, `BrowserSubmitWindow.press`, `BrowserSubmitWindows.press`, and the fixture's key-down dispatch;
  - `BrowserSubmitWindow.activeElement`, which now reports the moved focus;
  - `BROWSER_SUBMIT_CLAUSES`, `BROWSER_SUBMIT_FOCUS_STEPS`, `BROWSER_SUBMIT_FOCUS_CASES`, `BROWSER_SUBMIT_UNREAD_CASES`, and `BROWSER_SUBMIT_MALFORMED_READS`.

# Second fix round (F6)

The ruling is F6 in `tmp/units/c7-fix2-brief.md`. With it, `BROWSER_SUBMIT_CLAUSES` and the either-clause tolerance are deleted. Deviation 9 is accepted. The worktree remains uncommitted: 17 files, +1411 −163 lines against `6cf6625`.

## Change

- `src/core/types.ts`:
  - `:359`: `BrowserNavigationReason` holds the 10 CDP `Page.ClientNavigationReason` values of Chromium 141, per `node_modules/playwright-core/types/protocol.d.ts:14765`: `anchorClick`, `formSubmissionGet`, `formSubmissionPost`, `httpHeaderRefresh`, `initialFrameNavigation`, `metaTagRefresh`, `other`, `pageBlockInterstitial`, `reload`, `scriptInitiated`.
  - `:384`: `BrowserSettlementResult` gains `reason`.
  - `BrowserNavigationEventMap.request` gains `reason: BrowserNavigationReason | undefined`.
  - The `wait` and `settle` TSDoc of `BrowserNavigationRecordInterface` state the reason.
- `src/core/constants.ts:190`: `BROWSER_NAVIGATION_REASONS`, a frozen list of the same values.
- `src/core/BrowserPage.ts`:
  - `:1611-1624`: `#handleRequested` reads the reason as the matching `BROWSER_NAVIGATION_REASONS` value, or undefined for any other value, and emits it on the `request` step.
  - `:1634-1642`: `#handleStarted` gives a start the reason of the latest current-tab request for the same frame and URL. `#reasons` (`:188`) records that request from the page session or any frame session the page knows, and a start consumes the entry.
  - The request step itself stays under the ownership rule; see deviation 12.
- `src/core/BrowserNavigationRecord.ts`: each log request and the selected start keep their reason. `#stage` and the same-document result report it.
- `src/core/BrowserToolset.ts:944-951`: the `type` line is `and submitted the form` when a read recorded a submission, or when no read answered and the settled navigation's reason is `formSubmissionGet` or `formSubmissionPost`. Otherwise it is `and pressed Enter`. The C6 and C7 statuses are unchanged.
- `tests/setup.ts`:
  - `emitBrowserNavigation` takes a `reason` (default `formSubmissionPost`).
  - `BROWSER_SUBMIT_EARLY_CASES` (`:390`, 3 rows) and `BROWSER_SUBMIT_UNREAD_CASES` (`:413`, 4 rows) carry the stages, the reason, and the clause.
  - `BROWSER_SUBMIT_CLAUSES` is deleted.
- `tests/service/toolset.test.ts`: the 6 navigating cases assert the exact `and submitted the form`.
- `guides/browser.md`:
  - rows for `BROWSER_NAVIGATION_REASONS` (`:178`) and `BrowserNavigationReason` (`:749`);
  - the record section (`:1913-1920`), with the `wait` and `settle` rows equal to their TSDoc and the fence comment carrying `reason`;
  - the clause rule (`:2401`) and the navigating row (`:2414`), which names the one clause.

## Claims

20. The page emits `request` with the reason of a current-tab `Page.frameRequestedNavigation`. It reads an unknown reason (`prerenderActivation`) as undefined. A start with no preceding request carries none.
    - Proof: `tests/src/core/BrowserPage.test.ts:3612`, which asserts with `toStrictEqual`.
21. A start carries the reason of the current-tab request for its frame and URL that another known session reported. Here `session-nested` reports the request for `child`, which `session-child` owns. A start for another URL carries none.
    - Proof: `tests/src/core/BrowserPage.test.ts:3672`.
22. The record reports the selected start's reason through `requested`, `committed`, and `loaded` after `wait` resolves. A superseding start's own reason replaces the request's, and a same-document commit keeps the request's reason.
    - Proof: `tests/src/core/BrowserNavigationRecord.test.ts:16-71`.
23. A `type` with `submit` whose Enter a navigation outran before any read:
    - under `formSubmissionPost`, ends `and submitted the form`;
    - under `anchorClick`, ends `and pressed Enter`;
    - after a start with no request (reason undefined), ends `and pressed Enter`;
    - in every case, carries the destination view.
    - Proof: `tests/src/core/BrowserToolset.test.ts:2370`.
24. When the read failed, a `type` with `submit` ends `and submitted the form` after a `formSubmissionGet` navigation, and `and pressed Enter` after an `anchorClick` navigation, a request-less navigation, or no navigation. The view is each case's own.
    - Proof: `tests/src/core/BrowserToolset.test.ts:2421`.
25. On Chromium, the 6 navigating `type` with `submit` cases end with the exact clause `and submitted the form`:
    - in 3 of 3 full service runs;
    - in 5 more runs of the 3 framed cases (`_parent`, out-of-process, in-process), 3 of 3 passed each time.
26. The existing page, manager, and record expectations for navigations whose request carries a reason now include it: 18 lines in `BrowserPage.test.ts` and 1 in `BrowserNavigationManager.test.ts`. The record tests' `request` emits pass `undefined`.

## Mutations

Each mutant was installed in place, ran over `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/BrowserPage.test.ts tests/src/core/BrowserNavigationRecord.test.ts tests/src/core/BrowserNavigationManager.test.ts`, then restored and verified with `cmp`. Each directory under `tmp/codex/c7-mutations/` holds the `.diff` and `.log`, and no log carries an unhandled error.

| Name  | Mutation                                                    | Result                                                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c7j` | the reason ignored in the clause                            | 2 failed, 313 passed: the early-navigation form row and the unread form row                                                                                                                                              |
| `c7k` | the page drops the reason of every request                  | 12 failed, 303 passed: the 2 new page cases, the 7 page expectations that name a reason, the manager case, and the 2 `c7j` toolset rows. The record cases drive steps directly and stay green.                          |
| `c7l` | a start ignores the correlated request reason               | 8 failed, 307 passed: the cross-session page case, 4 page expectations whose reason reaches the record only through a start, the manager case, and the 2 `c7j` toolset rows                                            |

## Validation

All commands ran from the worktree root.

| Command                                                                                          | Exit | Counts                           |
| ------------------------------------------------------------------------------------------------ | ---- | -------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 13 files touched this round                  | 0    | all formatted                    |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 12 touched `.ts` files              | 0    | no diagnostics                   |
| `npm run check`                                                                                  | 0    | root, core, server, browser      |
| `npm run test:src`                                                                               | 0    | 58 files, 1234 passed, 1 skipped |
| `npm run test:setup`                                                                             | 0    | 5 files, 144 passed              |
| `npm run test:policy`                                                                            | 0    | 114 passed, 1 skipped            |
| `npm run test:guides`                                                                            | 0    | 207 passed                       |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, run 1     | 0    | 3 files, 53 passed, 1 skipped    |
| the same, run 2                                                                                  | 0    | 3 files, 53 passed, 1 skipped    |
| the same, run 3                                                                                  | 0    | 3 files, 53 passed, 1 skipped    |
| the same, `-t` for the 3 framed submission cases, 5 runs                                         | 0    | 3 passed each                    |

After the gates, `src/core/BrowserPage.ts` took a formatting-only change: 2 statements wrapped. `oxfmt`, `oxlint`, and `check:src:core` then exited 0, and `BrowserPage.test.ts` passed 147.

The prescribed record-only design did not hold on Chromium: of 3 service runs, 1 failed, with the `_parent` case ending `and pressed Enter`. That led to deviation 12.

## Deviations

12. The reason reaches the settlement through the start as well as through the request step.
    - Expected: `#handleRequested` passing the reason is enough.
    - Found: in the `_parent` case, the nested document initiates a navigation of its parent. The request probably arrives on the nested frame's session, and the page's ownership rule then drops it as a step. The start comes from the parent's own session with no reason. When the observer read fails because the parent committed first, the settled reason was undefined, and 1 of 3 runs ended `and pressed Enter`. This is inferred from the fixture topology and the ownership rule; it was not probed.
    - Done: the page correlates the latest current-tab request's reason per frame and URL from any known session into the owning session's start. The record's own carry rule from the first attempt is removed, so one mechanism remains. After that, 3 of 3 full runs and 5 of 5 framed-case runs ended `and submitted the form`.
13. `BrowserNavigationManager.ts` needed no change; it passes the steps through. Only its test changed, for the reason in a settlement.
14. No file outside this round's ownership changed. No shared-file patch is needed.

## Public surface for the guide (updated)

- Added: the type `BrowserNavigationReason` and the constant `BROWSER_NAVIGATION_REASONS`.
- `BrowserSettlementResult.reason`.
- `BrowserNavigationEventMap.request` gains `reason`.
- `BrowserNavigationRecordInterface.wait` and `.settle` TSDoc, with the matching guide rows.
- The record section's start and reason sentences.
- The `type` with `submit` clause rule: `and submitted the form` after a recorded submission, or after an unread navigation whose reason is `formSubmissionGet` or `formSubmissionPost`; `and pressed Enter` otherwise. The navigating row reads `Typed "Grace Hopper" into e3 textbox "Name" and submitted the form.`
- Test infrastructure in `tests/setup.ts`: `emitBrowserNavigation`'s `reason` parameter, `BROWSER_SUBMIT_EARLY_CASES`, and `BROWSER_SUBMIT_UNREAD_CASES` (reshaped). `BROWSER_SUBMIT_CLAUSES` is removed.

# Third fix round (F7 to F10)

The rulings are F7 to F10 in `tmp/units/c7-fix3-brief.md`. The worktree remains uncommitted: 17 tracked files, +1945 −162 lines against `6cf6625`, plus the new file `tests/src/browser/integration.test.ts`.

## P9 reading

The reading is recorded in full in `tmp/units/c7-probe-report.md` § P9. The probe is `tmp/probes/c7-parent.test.ts`, and its tapes are `tmp/probes/logs/c7-parent.txt`, `tmp/probes/logs/c7-parent-control.txt`, and `tmp/probes/logs/c7-parent-run.txt`. The run used Chrome/141.0.7390.37.

When the inner document on site A submits its `_parent` form:

- the inner document's session reports `Page.frameRequestedNavigation` twice for the middle frame (`formSubmissionGet`, current tab);
- the middle frame's own session reports `Page.frameStartedNavigating` (`differentDocument`);
- the request's and the start's URLs are equal.

In the `_self` control, all three events arrive on the inner session. The reading supports the handoff's premise, so F7 changes the handoff's lifetime and keeps its route.

## F7: the pending request's lifetime

Change:

- `src/core/BrowserPage.ts:192`: `#pending` holds one `{ url, reason }` per frame, and its `reason` may be `undefined`.
- `:1624-1630`: every current-tab request for the frame, from the page session or a known frame session, replaces the entry, an unknown reason as `undefined`. The step follows the ownership rule as before.
- `:1636-1653`: a start whose `navigationType` is in `BROWSER_RELOAD_NAVIGATION_TYPES` deletes the entry and takes no reason. Any other start whose frame and URL match the entry takes its reason and deletes it.
- The entry is deleted by a same-document commit (`:1603`), a non-swap `frameDetached` (`:1714`), a target detach (`:1965`), and teardown (`:990`).
- `src/core/constants.ts:207`: `BROWSER_RELOAD_NAVIGATION_TYPES` lists the 6 values `reload`, `reloadBypassingCache`, `restore`, `restoreWithPost`, `historySameDocument`, and `historyDifferentDocument`, per `node_modules/playwright-core/types/protocol.d.ts:15099`. Its guide row is at `guides/browser.md:179`.
- The `request` doc in `src/core/types.ts` and the record section of the guide (`guides/browser.md:1914`) state the lifetime.
- `tests/setup.ts:392`: `BROWSER_PENDING_REQUEST_CASES`, 9 rows.

Claims:

27. `tests/src/core/BrowserPage.test.ts:3754` covers the 9 rows, each asserted with `toStrictEqual` on the settlement:
    - A start of the requested URL takes the reason.
    - An unknown-reason request for the same frame and URL replaces a form reason, and the start gets `undefined`.
    - A second start of the same URL gets `undefined`.
    - A `reload` start takes no reason.
    - A `historyDifferentDocument` start drops the entry for the next start.
    - A same-document commit drops the entry.
    - A removed frame (`frameDetached` with `remove`) drops its entry; a swapped one keeps it.
    - A frame whose target detached drops its entry.
28. `tests/src/core/BrowserPage.test.ts:3774`: 10 frames with pending requests are removed, and a later start of each removed frame's id gets `undefined`. This proves the deletion through behaviour, without reading private state.

## F8: the fake window's capture order

Change:

- `tests/setup.ts:825-945`: the fake window keeps each registration's type, listener, capture flag, and `once`. A duplicate of the same type, listener, and flag is ignored.
  - `press` runs the capture listeners in registration order, then the focused element's handler (`moves`), then the bubbling listeners.
  - `dispatch` runs capture, then bubbling.
  - `removeEventListener` matches by capture flag.
- `tests/src/browser/integration.test.ts` runs in the browser project over Chromium. The file name is exempt from the mirror rule, and its scope is the browser environment.

Claims:

29. `tests/setup.test.ts:1018`: the capture listener sees the focus on the `input`; after the target's handler moved it, the bubbling listener sees the `textarea`. An `iframe` focus and no focus send nothing.
30. `tests/setup.test.ts:1066`: registrations are kept per type, listener, and capture flag, and a removal without the flag leaves the capture registration in place.
31. `tests/src/browser/integration.test.ts:20` runs in a real Chromium document.
    - The setup: `compileSubmitObserverExpression` is installed in the window, and the input's handler calls `stopPropagation()` and `preventDefault()` and focuses the textarea.
    - An Enter `KeyboardEvent` dispatched on the input leaves the focus on the textarea.
    - The read returns `{ destinations: [], prevented: false, submitted: false, implicit: true }`.

## F9: a settled form reason establishes the submission

Change:

- `src/core/BrowserToolset.ts:944-952`: the clause is `and submitted the form` when the read recorded a submission, or when the settled navigation's reason is `formSubmissionGet` or `formSubmissionPost`, whatever the read answered. The statuses keep their precedence, because the no-form status requires no settled navigation.
- The class TSDoc and `guides/browser.md:2402` follow.
- `tests/setup.ts:708`: `BROWSER_SUBMIT_NEGATIVE_CASES`, 2 rows.

Claims:

32. `tests/src/core/BrowserToolset.test.ts:2422`: a `type` with `submit` whose read answered `submitted: false` returns `… and submitted the form.` and the destination view under a `formSubmissionPost` navigation. The read also reports `implicit: true`, because the main window's focus sits on a form input when the fixture presses Enter. This holds in both orderings:
    - the navigation loads before the read answers;
    - the read answers, then the navigation starts, then it commits and loads later.

## F10: the runs on disk

33. Each service run of this round is logged under `tmp/codex/c7-service-runs/`:
    - `1.log`, `2.log`, and `3.log` are full `test:service` runs: exit 0, 53 passed, 1 skipped each.
    - `4.log` to `8.log` run the 3 framed submission cases (`_parent`, out-of-process, in-process): exit 0, 3 passed each.
    - The 6 navigating cases assert the exact clause `and submitted the form`.

## Mutations

Each mutant was installed in place, restored, and verified with `cmp`. Each directory under `tmp/codex/c7-mutations/` holds the `.diff` and `.log`, and no log carries an unhandled error. `c7m`, `c7n`, and `c7p` ran over `src:core` (`BrowserToolset`, `BrowserPage`, `compilers`); `c7o` ran over `src:browser` (`integration`).

| Name  | Mutation                                                        | Result                                                                                                                 |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `c7m` | an unknown reason does not replace the entry                    | 1 failed, 328 passed: `holds a pending request for one start: an unknown-reason request for the same URL replaces a form reason` |
| `c7n` | the matching start does not consume the entry                   | 1 failed, 328 passed: `holds a pending request for one start: a second start of the same URL finds the request consumed`         |
| `c7o` | the observer registers its `keydown` listener bubbling          | 1 failed of 1: `records the Enter an input a form owns received, before the input's handler stops the event and moves the focus` |
| `c7p` | the reason ignored when the read answered                       | 2 failed, 327 passed: both `names the submitted form of a type whose read answered no submission…` rows                          |

## Validation

All commands ran from the worktree root.

| Command                                                                                          | Exit | Counts                            | Log                                       |
| ------------------------------------------------------------------------------------------------ | ---- | --------------------------------- | ----------------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 14 touched files                             | 0    | all formatted                     |                                           |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 13 touched `.ts` files              | 0    | no diagnostics                    |                                           |
| `npm run check`                                                                                  | 0    | root, core, server, browser       |                                           |
| `npm run test:src`                                                                               | 0    | 1247 passed, 1 skipped            | `tmp/codex/c7-gates3/test-src.log`        |
| `npm run test:src:browser`                                                                       | 0    | 225 passed, 1 skipped             | `tmp/codex/c7-gates3/test-src-browser.log`|
| `npm run test:setup`                                                                             | 0    | 145 passed                        | `tmp/codex/c7-gates3/test-setup.log`      |
| `npm run test:policy`                                                                            | 0    | 114 passed, 1 skipped             | `tmp/codex/c7-gates3/test-policy.log`     |
| `npm run test:guides`                                                                            | 0    | 207 passed                        | `tmp/codex/c7-gates3/test-guides.log`     |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`, run 1     | 0    | 53 passed, 1 skipped              | `tmp/codex/c7-service-runs/1.log`         |
| the same, run 2                                                                                  | 0    | 53 passed, 1 skipped              | `tmp/codex/c7-service-runs/2.log`         |
| the same, run 3                                                                                  | 0    | 53 passed, 1 skipped              | `tmp/codex/c7-service-runs/3.log`         |
| the 3 framed submission cases through `-t`, runs 4 to 8                                          | 0    | 3 passed each                     | `tmp/codex/c7-service-runs/4.log` to `8.log` |
| `npm run test:probe -- tmp/probes/c7-parent.test.ts` (P9)                                        | 0    | 2 passed                          | `tmp/probes/logs/c7-parent-run.txt`       |

## Deviations

15. The teardown deletion (`src/core/BrowserPage.ts:990`) has no behavioural test. After teardown the page destroys its step emitter, so no later start can reach a record. Proving the clearing would need a probe of private state, which the brief excludes.
16. Closed by F11 in the fourth fix round: every accepted start now deletes the entry, so a start that neither repeats a history entry nor matches the entry's URL no longer leaves it in place.
17. The real-DOM control lives in `tests/src/browser/integration.test.ts`, the environment's integration file, because no `src/browser` module owns the observer compiler.
18. The fake window keeps its `activeElement` getter, as accepted under deviation 9. The capture-order proof reads it at each listener's invocation.
19. No file outside this round's ownership changed. No shared-file patch is needed.

## Public surface for the guide (updated)

- Added: the constant `BROWSER_RELOAD_NAVIGATION_TYPES`.
- The record section states the pending request's lifetime.
- The `BrowserNavigationEventMap.request` doc names the reason's source and the history-entry exclusion.
- The `type` with `submit` clause: `and submitted the form` after a recorded submission, or after a settled navigation whose reason is `formSubmissionGet` or `formSubmissionPost`, whatever the read answered; `and pressed Enter` otherwise.
- `compileSubmitObserverExpression`: unchanged; its `keydown` listener stays capture-phase, which the real-DOM control pins.
- Test infrastructure:
  - `tests/setup.ts`: the capture-aware `BrowserSubmitWindow`, `BROWSER_PENDING_REQUEST_CASES`, and `BROWSER_SUBMIT_NEGATIVE_CASES`.
  - `tests/src/browser/integration.test.ts` is the real-DOM control.

# Fourth fix round (F11)

The ruling is F11 in `tmp/units/c7-fix4-brief.md`. The worktree remains uncommitted: 17 tracked files, +1987 −162 lines against `6cf6625`, plus `tests/src/browser/integration.test.ts`.

## Change

- `src/core/BrowserPage.ts:1640-1654`: `#handleStarted` reads the frame's pending entry and deletes it on every accepted start. The start takes the entry's reason only when the start's URL equals the entry's and its `navigationType` is not in `BROWSER_RELOAD_NAVIGATION_TYPES`.
- The comment on `#pending` (`:186-191`), the `request` doc in `src/core/types.ts:393-395`, and the record section of `guides/browser.md:1914` state the rule.
- `tests/setup.ts:564`: a regression row joins `BROWSER_PENDING_REQUEST_CASES`, which now has 10 rows. The row count proof is in `tests/setup.test.ts`.

## Claim

34. The regression row reproduces the review's sequence, and the settlement's reason is `undefined`.
    - Before the record opens, in order:
      - a `formSubmissionPost` request for `main` at `https://example.test/order`;
      - a `differentDocument` start of `main` at `https://example.test/other`, with its commit and load.
    - After the record opens: a request-less `differentDocument` start of `main` at `https://example.test/order`.
    - Proof: `tests/src/core/BrowserPage.test.ts:3754`, row `a start of another URL drops the request for a later request-less start of its URL`.
    - These stay green: the matching handoff row, the unknown-reason replacement row, the cross-session page case (`BrowserPage.test.ts:3672`, the P9 route), and the service cases.

## Mutation

| Name  | Mutation                                            | Result                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c7q` | the entry kept after a non-matching start           | 1 failed, 286 passed, over `src:core` `BrowserPage.test.ts` and `BrowserToolset.test.ts`: the new row, which received `reason: "formSubmissionPost"` where `undefined` was expected. Files: `tmp/codex/c7-mutations/c7q/c7q.diff` and `c7q.log`; no unhandled error. |

## Validation

| Command                                                                                          | Exit | Counts                  | Log                                           |
| ------------------------------------------------------------------------------------------------ | ---- | ----------------------- | --------------------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 5 touched files                              | 0    | all formatted           |                                               |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 4 touched `.ts` files               | 0    | no diagnostics          |                                               |
| `npm run check`                                                                                  | 0    | root, core, server, browser |                                           |
| `npm run test:src`                                                                               | 0    | 1248 passed, 1 skipped  | `tmp/codex/c7-gates5/test-src.log`            |
| `npm run test:setup`, run 1                                                                      | 1    | 1 failed, 144 passed    | `tmp/codex/c7-gates5/test-setup.log`          |
| `npm run test:setup`, runs 2 and 3                                                               | 0    | 145 passed each         | `tmp/codex/c7-gates5/test-setup-2.log`, `-3.log` |
| `npm run test:guides`                                                                            | 0    | 207 passed              | `tmp/codex/c7-gates5/test-guides.log`         |
| `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:service`            | 0    | 53 passed, 1 skipped    | `tmp/codex/c7-service-runs/9.log`             |

## Deviations

20. Deviation 16 is closed by F11, and its entry in the third round's list now says so.
21. The first `test:setup` run failed at `tests/setupServer.test.ts:567`. That line is `createFakeBrowserProcess > spawns a descendant that outlives SIGTERM and hands both to the registry teardown`, which asserts that a spawned descendant is still running after SIGTERM.
    - Neither the test nor the process fixture it drives is touched by any C7 round.
    - The same command passed 145 of 145 in two reruns.
    - Hypothesis: the descendant exits within the test's window on a loaded host, which makes it a timing flake of the process fixture. This is not probed.
