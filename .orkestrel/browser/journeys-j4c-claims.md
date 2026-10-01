# J4c claims

A click that opens a popup now settles on the popup. On Chromium 141, `Page.windowOpen` reaches the opener's session before the reply to the `mouseReleased` input in all 12 probe rounds across 2 runs. The popup's `Target.attachedToTarget` comes after that reply in 1 round of the first run and 2 rounds of the final run. The record therefore keeps `Page.windowOpen` as its evidence.

`page.popups.record()` counts those reports. `#click`, `#type` with `submit`, and `#press` of Enter await the popups those reports name. They move the view to the popup before the receipt is composed. The result then carries the note `The view moved to a new tab: URL.` and the popup's view, and the action's `tab` holds the popup's `{ url, title }`.

J7b's `compiled module equality` popup case passes, and the 3 journey service runs each report 9 passed. Mutations `j4c1` and `j4c2` each fail named assertions in the core and the service project.

One regression needs an unowned change, recorded as D1 with its patch. `BrowserRecorder` copies the click's `tab` into the recorded step, and the journey validator refuses that step.

## Probe: wire order on Chromium 141.0.7390.37

The probe `tmp/probes/j4c/popup.test.ts` taped every frame through a recording transport. Each round ran on a fresh isolated `BrowserContext` page on `/popup`. The probe clicked through `BrowserPageElement.click`, then waited for the page's `popup` event.

Two openers were tested:

- `window.open`: the fixture's `Open details` button.
- anchor: an inserted `<a href="/popup/child" target="_blank">`.

The tapes are under `tmp/probes/j4c/logs/` (`open-1..3.txt`, `anchor-1..3.txt`, `reuse.txt`, `control.txt`). The following table is the final run (`npm run test:probe -- tmp/probes/j4c/popup.test.ts`, 8 passed). Numbers are tape positions.

| Round | Release sent | Input reply | `Page.windowOpen` | `Target.targetCreated` | `Target.attachedToTarget` (`openerId` = `openerFrameId` = opener) | `popup` event | Popup URL at the event |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `window.open` 1 | #89 | #97 | #90 before | #91 before | #94 before | #125 after | `/popup/child` |
| `window.open` 2 | #226 | #234 | #227 before | #228 before | #231 before | #263 after | `/popup/child` |
| `window.open` 3 | #364 | #372 | #365 before | #366 before | #369 before | #400 after | `/popup/child` |
| anchor 1 | #500 | #504 | #501 before | #502 before | **#507 after** | #538 after | `/popup/child` |
| anchor 2 | #639 | #643 | #640 before | #641 before | **#646 after** | #672 after | `/popup/child` |
| anchor 3 | #776 | #783 | #777 before | #778 before | #781 before | #810 after | `/popup/child` |
| reuse: second `window.open` naming the open window | #969 | #970 | absent | absent | absent | absent | — |
| control: `Stay`, which opens nothing | #1092 | #1093 | absent | absent | absent | absent | — |

The first run's tapes were overwritten by the final run. That run's printed readings agree, except that only anchor round 2 had `Target.attachedToTarget` after the reply.

`Page.windowOpen` precedes the reply in every round of both runs. `Target.attachedToTarget` is the event for the page's own `Target.attachToTarget` on the browser session, which follows `Target.targetCreated`, and it does not precede the reply in every round. The record keeps `Page.windowOpen`.

`Page.windowOpen` names a URL and no target, so the record counts reports. A `window.open` that reuses an open named window reports nothing, so no reuse waits.

## Changes

The following table lists each change with its location in the worktree.

| Location | Change |
| --- | --- |
| `src/core/types.ts:330` | Adds `BrowserPopupManagerInterface` with `record()`. |
| `src/core/types.ts:352` | Adds `BrowserPopupRecordInterface` with `settle(options?)` and `destroy()`. Its remarks state the evidence, the count rule, arrival-window selection, and that a page without a `reference` function counts no report. |
| `src/core/types.ts:1847` | `BrowserAction.tab` also names the popup a `click`, a `type` with `submit`, or a `press` of Enter moved the view to. |
| `src/core/types.ts:3161` | Adds `readonly popups: BrowserPopupManagerInterface` to `BrowserPageInterface`, plus its remarks row. |
| `src/core/BrowserPage.ts:207` | Adds `#records`: per record, the reports counted, the popup targets adopted since the record opened, and each target's outcome. Entries are replaced, never mutated. Also adds `#wakes`, `#popupManager`, and `#openHandler`. |
| `src/core/BrowserPage.ts:364`, `:1015` | Subscribes to `Page.windowOpen` on the page's own session. Release unsubscribes it, clears the records, and wakes pending settles. |
| `src/core/BrowserPage.ts:496` | Adds the `popups` getter. |
| `src/core/BrowserPage.ts:1380`–`:1494` | The discovery path concludes a target as skipped in 6 cases: attach refused, no frame, page closed, held page not ready, setup failure, and popup closed before emission. `#emitPopup` concludes a target as announced after `popup` is emitted. |
| `src/core/BrowserPage.ts:1497`–`:1590` | Adds `#recordPopups`, `#settlePopups`, `#parkPopups`, `#abandonPopups`, `#endPopups`, `#wakePopups`, `#handleOpen`, `#expectPopup`, and `#concludePopup`. `#handleOpen` counts only when the page holds its target, that is, when it takes part in discovery. `#settlePopups` deadlines with `AbortSignal.timeout(Math.ceil(timeout))`. |
| `src/core/BrowserPage.ts:1988`, `:2020` | `#discover` and the page-session attach mark a claimed popup target as expected. |
| `src/core/BrowserToolset.ts:116`–`:125` | Class remarks state the popup settlement and when a popup that no action moved to moves the view. |
| `src/core/BrowserToolset.ts:220` | Adds `#arrivals`, the popups announced while an action holds a popup record. |
| `src/core/BrowserToolset.ts:645`, `:722`, `:808` | `#click`, `#type` with `submit`, and `#press` of Enter open the popup record beside the navigation record. Each destroys the record and flushes the arrivals in `finally`. |
| `src/core/BrowserToolset.ts:1124`–`:1182` | `#settle` takes `popups` after `record`. After the navigation settles, it awaits `popups.settle({ timeout: bound − now, signal })` and moves to the first open popup before composing the receipt. |
| `src/core/BrowserToolset.ts:1223`–`:1262` | Adds `#recordPopups`, `#flushArrivals`, and `#followPopup`. `#followPopup` reads the title within `bound`, records `tab`, and awaits `#select(popup, 'The view moved to a new tab: URL.')`. |
| `src/core/BrowserToolset.ts:1824` | `#handlePopup` defers a popup announced during such an action. After the action, a popup the view already moved to has an opener that is no longer the view, so `#handlePopup` does nothing. |
| `tests/setup.ts:1395`, `:1423` | Adds `createDiscoveringPage(withheld?)` and `emitBrowserWindowOpen(transport, session, url?)`. |
| `tests/setup.ts:1784` | Adds `held` to `BrowserElementFixtureOptions`. The fixture page then takes a reference provider and holds its target. |
| `tests/setup.ts:2297` | Adds `BROWSER_JOURNEY_POPUP_LINK_HTML`. |
| `tests/setup.test.ts:110`, `:475`, `:532` | Adds proofs of `held`, `createDiscoveringPage` (with the withheld predicate), and `emitBrowserWindowOpen`. |
| `tests/src/core/BrowserPage.test.ts:2482` | Adds the `BrowserPage popup records` block (7 tests). |
| `tests/src/core/BrowserToolset.test.ts:3786` | Adds the click popup-settlement case through `tools.execute` and through `perform`. |
| `tests/service/toolset.test.ts:276` | Adds the link-popup equality case in J4's `journey perform equality` block. |
| `tests/service/toolset.test.ts:1`, `:663`–`:760` | Corrects the header and the `window.open` block: the click receipt names the move, and the block has no inverted assertion. |

The diffstat is `8 files changed, 749 insertions(+), 23 deletions(-)`, as follows:

- `src/core/BrowserPage.ts`: +136
- `src/core/BrowserToolset.ts`: +94/−5
- `src/core/types.ts`: +41
- `tests/service/toolset.test.ts`: +63
- `tests/setup.test.ts`: +123
- `tests/setup.ts`: +66
- `tests/src/core/BrowserPage.test.ts`: +159
- `tests/src/core/BrowserToolset.test.ts`: +85

The untracked instruments are `tmp/probes/j4c/popup.test.ts` with its tapes, `tmp/probes/j4c/recorder.test.ts`, and `tmp/codex/j4c-mutations/run.ts` with its `j4c1`/`j4c2` `.diff` and `.log` files.

## Claims

1. **Evidence.** `Page.windowOpen` on the opener's session precedes the input's reply in every round for both openers (probe table). The control and the reuse case carry no evidence.
2. **No evidence settles at once.** `settle` resolves `[]` within 1 s against a 5 s timeout when no report arrived after the record opened, and a report before the record does not count (`BrowserPage.test.ts:2483`). A page without discovery counts no report (`:2592`). Its control, the discovering page with the same report, waits until its timeout (`:2575`).
3. **Announcement.** After a report, `settle` waits for the discovered popup's announcement and resolves with that page, whose `opener` is the page. Its order recorder shows `['popup', 'settle']` (`:2498`).
4. **Skip.** A popup whose attach is refused, or whose target is destroyed during setup, concludes as skipped. `settle` resolves `[]` within 1 s against a 5 s timeout, and no `popup` event fires (`:2533`, 2 cases).
5. **Deadline.** With a report and no popup, `settle({ timeout: 50 })` resolves `[]` after at least 45 ms and under 1 s (`:2575`). The toolset passes `bound − now`, the receipt deadline less the capture reserve. Every click test in the core project exercised a fractional timeout after the `Math.ceil` repair (1036 passed).
6. **Lifecycle.** A pending `settle` rejects with the caller's reason on abort, with `Browser popup record ended` on `destroy`, and with `…because the page closed` on target destruction. `record()` on a closed page throws `Browser page is closed` (`:2607`).
7. **Toolset settlement.** In the protocol fixture, `Page.windowOpen` and the popup's attach are scripted before the release reply. Both `tools.execute` and `perform` then return a result that starts with the move note, the receipt line, and `page "Details" https://example.test/popup`. The action carries `receipt: 'Clicked e4 button "Place order".'` and `tab: { url, title: 'Details' }`. The view is the popup, `select` fires exactly once, and the next `look` carries no note (`BrowserToolset.test.ts:3786`).
8. **Live equality.** On Chromium, a direct `click` and `perform` on a `target="_blank"` link return results equal after reference masking. Each starts `The view moved to a new tab: …/popup/child.\n\nClicked e# link "Open details".\n\npage "Details" …/popup/child\n# Details`, and each action's `tab` is `{ url: …/popup/child, title: 'Details' }` (`tests/service/toolset.test.ts:276`).
9. **J7b's case.** `runs the generated module of a click that opens a popup …` passes. The module and the replay reach the opener and popup states and the same receipts, in 3 of 3 runs.
10. **Outside an action.** A popup announced outside an action still moves the view through `#handlePopup`. The existing cases `catches a popup that leaves the view behind…` (core) and `moves the cursor to the popup the click opened` (service) pass. A click that opens nothing keeps the view, with one current tab (`keeps the view on the page when a click opens no popup`).

No claim carries a `prove` closing line (D3).

### Failing-first

The J7b case is the failing-first test. J7b's report records `npm run test:service -- tests/service/journey.test.ts` at 1 failed and 8 passed in 3 of 3 runs on 3df7038, whose source this tree carried before the change. After the change, the same command reports 9 passed in each of 3 runs.

A rerun on the unfixed source was not done (D2). Mutant `j4c1` disables the record in `#click`. It reproduces the defect against the new tests: the core project reports 2 failed and the service project 1 failed.

## Mutations

`node tmp/codex/j4c-mutations/run.ts ID` edits `src/core/BrowserToolset.ts`. It then runs 2 commands and restores the file in `finally`:

- `vitest --project src:core tests/src/core/BrowserToolset.test.ts -t 'opens a popup on the popup'`
- `vitest --project service tests/service/toolset.test.ts -t 'link that opens a popup'`

The following table records the final runs, on the final source.

| Mutation | Breaking edit | Named assertion and failure | Exit and counts |
| --- | --- | --- | --- |
| `j4c1` | `#click` passes `undefined` in place of its popup record to `#settle` | Core: `expect(text.startsWith('The view moved to a new tab: …\n\nClicked e4 … page "Details" …')).toBe(true)` at `BrowserToolset.test.ts:3840`, both paths (`expected false to be true`). Service: `expect(toolset.view).not.toBe(page)` at `tests/service/toolset.test.ts:300`. | 0 (caught); core 2 failed, service 1 failed; restored `true` |
| `j4c2` | `#settle` composes the receipt with the capture first, then awaits `#followPopup` | Core: the same assertion at `BrowserToolset.test.ts:3840`, both paths. Service: `expect(first?.startsWith(…)).toBe(true)` at `tests/service/toolset.test.ts:310`. | 0 (caught); core 2 failed, service 1 failed; restored `true` |

After both runs, `git diff --stat -- src/core/BrowserToolset.ts` showed the unmutated +94/−5.

## Validation

Every command ran through `env -C /home/user/browser/tmp/worktrees/j4c`. The final runs are on the final source and the rebuilt `dist/`. Format and lint covered the 8 tracked files plus the 3 instruments.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the touched files | 0 | All matched files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, and browser projects pass |
| `npm run test:src:core` | 0 | 1036 passed, 50 files |
| `npm run test:src:browser` | 0 | 233 passed, 1 skipped |
| `npm run test:setup` | 0 | 153 passed, 5 files |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | Core, server, and browser bundles built |
| `npm run test:service -- tests/service/toolset.test.ts` | 0 | 30 passed |
| `npm run test:service -- tests/service/journey.test.ts`, run 1 | 0 | 9 passed |
| `npm run test:service -- tests/service/journey.test.ts`, run 2 | 0 | 9 passed |
| `npm run test:service -- tests/service/journey.test.ts`, run 3 | 0 | 9 passed |
| `npm run test:probe -- tmp/probes/j4c/popup.test.ts` | 0 | 8 passed |

## Deviations and patches

### D1: unowned change required, `BrowserRecorder` (not applied)

- **Expected:** recording a click that opens a popup yields a journey that validates.
- **Found:** `BrowserRecorder` copies `action.tab` into every step (`src/core/recorders/BrowserRecorder.ts:185`). `validateBrowserJourneyStep` refuses `tab` on any action but `switch` (`src/core/validators.ts:136`). The click's `tab`, which the brief prescribes, therefore makes `recorder.journey()` throw `BROWSER_JOURNEY_INVALID` (`Invariant 3 (targets and tabs)`).
- **Evidence:** `tmp/probes/j4c/recorder.test.ts` reports 1 failed and 1 passed:
  - Failing case: the popup click; the recorded step has `tab: {"url":"https://example.test/popup","title":"Cart"}`.
  - Control: the same click without a popup is accepted.
  - The failing case asserts the accepted journey, so it passes once the patch lands.
- **Patch** (exact; not run, because the file is unowned):

  ```diff
  --- a/src/core/recorders/BrowserRecorder.ts
  +++ b/src/core/recorders/BrowserRecorder.ts
  @@ -185 +185 @@
  -			...(action.tab === undefined ? {} : { tab: action.tab }),
  +			...(action.action !== 'switch' || action.tab === undefined ? {} : { tab: action.tab }),
  ```

- **Hypothesis:** the step model gives a popup to `switch` only, so the recorder must not carry a popup tab into a click step. A mirrored test belongs in `tests/src/core/recorders/BrowserRecorder.test.ts`; the probe's 2 cases are its content.

### D2: no rerun on the unfixed source

Restoring the HEAD text of the 3 owned source files into the worktree, to rerun the J7b case before the fix, was refused by the session's permission classifier. The failing count therefore comes from J7b's report on the same source, together with mutant `j4c1`.

### D3: no `prove` instrument

No `prove` tool is registered in this session. The tests, their controls, the probe, and the 2 mutations are the evidence.

### D4: choices made within scope

- **Placement.** The record and its manager live in `BrowserPage.ts`, which the brief names for the popup record. They are an object of bound private methods over a symbol-keyed, copy-on-write map. This adds no class file, barrel row, or `INTERNAL` entry.
- **Popup wait timeout.** The popup wait takes `bound − now`, the receipt deadline less `BROWSER_TOOL_CAPTURE_MS`, as the navigation wait does. This keeps the class's stated capture reserve. The brief's "remaining to the tool deadline" read literally would leave no time for the capture.
- **Discovery-only counting.** Only a page that holds its target counts reports. Chromium 141 announces a `window.open` popup only through discovery, so a directly constructed page would otherwise wait the full bound and gain nothing.
- **Deadline primitive.** The settle deadline is `AbortSignal.timeout`, which `src/server/Browser.ts` already uses, in place of a fresh `setTimeout`. `test:policy` flagged an earlier `setTimeout` in `#parkPopups`. `AbortSignal.timeout` needs an integer, hence `Math.ceil`.
- **Popups announced during an action.** A popup announced while an action holds a record, which the record did not return, moves the view when the action ends. Its note can then lead that action's result while the result's view is the opener's. No test covers this ordering.

### D5: shared-file patch for J12, `guides/browser.md` (not applied)

`npm run test:guides`, which is not in the brief's gate list, reports 12 failures on this tree. Most of them are journey-campaign exports that J12 owns, and `BrowserPopupManagerInterface` and `BrowserPopupRecordInterface` join its undocumented-export list. These rows close those 2 entries; they have not been run.

- **Summary table, after the `BrowserNavigationRecordInterface` row (`guides/browser.md:746`):**
  - `` | `BrowserPopupManagerInterface` | interface | Opens the records that settle the popups an input into a page opens. | ``
  - `` | `BrowserPopupRecordInterface` | interface | Settles the popups an input opened, from the `Page.windowOpen` reports the page's own session sends after the record opened. | ``
- **Method tables, after the `BrowserNavigationRecordInterface` section (`:1913`–`:1937`):**
  - `` #### `BrowserPopupManagerInterface` ``, with the row `record` | `BrowserPopupRecordInterface` | the `record` TSDoc sentence from `src/core/types.ts:331`.
  - `` #### `BrowserPopupRecordInterface` ``, with the rows `settle` | `Promise<readonly BrowserPageInterface[]>` | the `settle` TSDoc from `:353`, and `destroy` | `void` | `Ends the record and rejects a pending \`settle\`.`

### Scope notes

- `tests/setup.test.ts` received the proofs of the setup exports this unit added. The brief's test-and-fixture rule assigns it here.
- The existing `window.open` block in `tests/service/toolset.test.ts` asserted the click's old receipt as a precondition and called its case an expected failure. Both were corrected, because the change made them false.
- The `held` fixture option is unset by default, so every pre-existing fixture case keeps an unheld page and counts no reports.
- The probes and their tapes stay under `tmp/probes/j4c/`, as the brief's validation runs them. `recorder.test.ts` is D1's failing-first case.
- Formatting was applied through `oxfmt --stdin-filepath` output copied back into owned files. No tree-wide format, lint fix, commit, stash, reset, checkout, or index-wide git command was issued.
