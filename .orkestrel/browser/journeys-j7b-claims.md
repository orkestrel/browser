# J7b claims

The compiled module and its replay agree on the page outcome and the masked step receipts for four of the five journeys: the delayed in-frame submission, the editable combobox, the form whose submit navigates, and the click that opens a dialog. The fifth journey, the click that opens a popup followed by a step in it, fails in both the module and the replay. Each one runs `s2` before the toolset's view moves to the popup, and that defect sits in unowned source (D1). The gap case and the type-check case pass. Mutation `j7b1` fails the outcome assertion in each of the four agreeing cases. The three service runs each report 1 failed and 8 passed, and the failing case is the popup case each time. `npm run check`, `npm run test:setup`, `npm run test:policy`, format, and lint all exit 0.

## Changes

The following table lists each change with its location.

| Location | Change |
| --- | --- |
| `tests/service/journey.test.ts:1` | Imports `compileBrowserJourney`, `requireValue`, `maskBrowserReferences`, the stage, and the cases. |
| `tests/service/journey.test.ts:187` | Adds `describe('compiled module equality')` beside J5's block. One Chromium serves two protocol connections: the built package's context, opened through the stage, and the workspace source's `BrowserContext`. |
| `tests/service/journey.test.ts:235` | Adds `runs the generated module of a $name to the page outcome and the receipts of its replay` over the five journeys. |
| `tests/service/journey.test.ts:289` | Adds `throws at the gap of a generated module with the page untouched, as the replay refuses the journey at preparation`, with a control that must move the counter. |
| `tests/service/journey.test.ts:334` | Adds `type-checks the TypeScript module of every journey against the built declarations and refuses a misspelled input`. |
| `tests/setup.ts:3481` | Adds `BrowserJourneyModuleCase` (route, markup, journey, inputs, state expression, and expected outcome). |
| `tests/setup.ts:3492` | Adds `BROWSER_JOURNEY_MODULE_CASES` with the five journeys over the existing `/checkout`, `/form` with `BROWSER_JOURNEY_COMBOBOX_HTML`, `/form`, `/confirm`, and `/popup` routes. |
| `tests/setup.ts:3607` | Adds `BROWSER_JOURNEY_GAP_CASE` (`wait`, then a child-frame gap, then `click` "Save draft" on `/form`). |
| `tests/setup.ts:3633` | Adds `instrumentBrowserJourneyModule`, which declares `export const actions = []` and hooks `on.action` into the module's own `createBrowserToolset(page)` line. Every step call stays as generated. |
| `tests/setup.ts:3655` | Adds `openBrowserJourneyPage` (a fresh page on a route, with optional `main` markup). |
| `tests/setup.ts:3677` | Adds `readBrowserJourneyOutcome`, which reads the state expression on the page and on each page whose `opener` is that page. |
| `tests/setupServer.ts:1399` | Adds `BROWSER_JOURNEY_HARNESS`, a module that opens a `BrowserContext` through the linked package. |
| `tests/setupServer.ts:1417` | Adds `BrowserJourneyModuleInterface`, `BrowserJourneyConnectionInterface`, and `BrowserJourneyStageInterface`. |
| `tests/setupServer.ts:1459` | Adds `createBrowserJourneyStage` and the `BrowserJourneyStage` class. The class links `node_modules/@orkestrel/browser` to the workspace, whose `dist/` is built. `load` imports a module through Node's own loader (`createRequire`, outside Vitest's transform), `check` runs the workspace `tsc` under `nodenext` with strict options, and `connect` opens the built package's context. |
| `tests/setup.test.ts:1441` | Proves `instrumentBrowserJourneyModule` against hand-written lines and refuses a module that constructs no toolset over its page. |
| `tests/setupServer.test.ts:990` | Proves the stage's link by `realpathSync`, `load` and `receipts` over an attached page, both refusals, and `destroy` leaving the workspace in place. |

The diffstat is `5 files changed, 668 insertions(+), 11 deletions(-)`: `tests/service/journey.test.ts` +196/−4, `tests/setup.ts` +216, `tests/setupServer.ts` +178, `tests/setup.test.ts` +35/−2, and `tests/setupServer.test.ts` +43/−5.

## Claims

1. **Module and replay agree (design claim 14, four journeys).** Each journey is compiled to JavaScript and written into a stage whose `node_modules/@orkestrel/browser` links the built package. Node's loader then imports it twice: as generated (`plain`) and through `instrumentBrowserJourneyModule` (`recorded`). Each copy runs `execute(page, inputs)` on a fresh page from the built package's context. The same journey is then replayed through `createBrowserReplay` on a fresh page from the source context. The test asserts, in order:
   - The run is `complete`, and its masked step receipts equal the receipts the module's own toolset emitted as `action` events.
   - The replay's page state, read through `page.evaluate`, equals the case's declared state.
   - The page state of both module runs equals the replay's.
   - Neither module run threw.
   - The journey has no gaps.

   The page outcome comes from both module runs. The receipts come from the second recording, where the instrumented construction line makes the module's toolset reachable. The test passes for `delayed in-frame submission`, `editable combobox`, `form whose submit navigates`, and `click that opens a dialog`. "In-frame" is read as a submission that stays in the document, after the `/checkout` order form whose `submit` listener prevents navigation and inserts its line after `FIXTURE_CHECKOUT_DELAY` (D3).
2. **Popup journey fails in both paths.** For `click that opens a popup` (`click` "Open details", then `click` "Like"), the replay stops at `s2` with `Step s2 names button "Like", which no element carries; call edit to remove or replace s2.`, and the module throws at the same step. The case fails its first assertion (`tests/service/journey.test.ts:278`) in all three service runs. See D1.
3. **Gap case.** Both paths leave the fixture's click counter at zero:
   - The module throws `s2: the element is in a child frame; handle it here` after its side-effect-free `wait`. Its page state, `[{ clicks: 0, saved: 'no' }]`, equals the state the replay leaves.
   - The replay rejects with `BROWSER_JOURNEY_GAP` at preparation.

   The control loads the same module without its `throw` line. It reaches `[{ clicks: 1, saved: 'yes' }]`, so the counter can move (`tests/service/journey.test.ts:289`).
4. **Type check.** The TypeScript emission of all six journeys type-checks with `tsc` against the built declarations, reached through the link under `nodenext`, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`, with no diagnostics. The control `inputs.nmae` is refused with `TS2339` (`tests/service/journey.test.ts:334`).
5. **Setup helpers.** `instrumentBrowserJourneyModule` adds exactly the `actions` export and the hooked construction line to `BROWSER_JOURNEY_MODULE_JAVASCRIPT`. The stage resolves its link to the workspace, imports through Node, reads the recorded receipts, refuses a module with no `execute` and a read of a module with no `actions`, and removes only its own directory (`tests/setup.test.ts:1441`, `tests/setupServer.test.ts:990`).

No claim has a `prove` closing line (D2).

## Mutations

`tmp/codex/j7b-mutations/run.ts ID` replaces one line of `tests/service/journey.test.ts`, runs `npx vitest run --config vite.config.ts --project service --reporter=verbose tests/service/journey.test.ts -t 'runs the generated module'`, writes `ID.log` and `ID.diff`, and restores the file in `finally`. After the run, `git diff --stat -- tests/service/journey.test.ts` showed the unmutated +196/−4.

The following table records the run.

| Mutation | Breaking edit | Named assertion and failure | Exit and counts |
| --- | --- | --- | --- |
| `j7b1` | `stage.load` for the `plain` module writes `script.source.replace(/^\t\tawait performBrowserStep\(toolset, 's1', .*\n/mu, '')`, which removes step `s1`'s call from the written module before Node imports it | `expect(outcomes).toStrictEqual([replayed, replayed])` (`:283`) fails for `delayed in-frame submission` (`{ name: '', lines: [] }`), `editable combobox` (`{ value: '', clicks: '' }`), `form whose submit navigates`, and `click that opens a dialog` (`{ answer: '', kept: '0' }`). The popup case fails at `:278` as it does unmutated, so it is no evidence for the mutation. | 1; 5 failed, 4 skipped (filter) |

## Validation

Every command ran through `env -C /home/user/browser/tmp/worktrees/j7b`. The format and lint population is the five touched files.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the touched files | 0 | 5 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, and browser projects pass |
| `npm run test:setup` | 0 | 149 passed across 5 files |
| `npm run test:service -- tests/service/journey.test.ts`, run 1 | 1 | 1 failed, 8 passed (the popup case) |
| `npm run test:service -- tests/service/journey.test.ts`, run 2 | 1 | 1 failed, 8 passed (the popup case) |
| `npm run test:service -- tests/service/journey.test.ts`, run 3 | 1 | 1 failed, 8 passed (the popup case) |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `git diff --check -- tests` | 0 | No whitespace errors |

## Deviations and scope notes

- **D1, the popup journey cannot complete without a source change (not done).**
  - Expected: the module and the replay complete `click` "Open details" and then `click` "Like" in the popup, with equal outcome and receipts.
  - Found: both paths locate `s2` on the opener. The replay returns `stopped` with the receipt quoted in claim 2, and the module throws at `s2`. Every service run reproduced this.
  - Evidence: a deleted single-connection probe ran three rounds, workspace source only, with no stage. Every round refused `s2`, and the toolset's `select` to the popup followed the click's `action` by 32.7 ms, 5.6 ms, and 16.3 ms, after the run had already stopped. The two-connection harness is therefore not the cause.
  - Hypothesis: the `click` receipt settles before `BrowserPage` publishes the `popup`. Publication follows discovery, attach, and session setup, and `BrowserToolset.#handlePopup` (`src/core/BrowserToolset.ts:1721`) moves the view later, with nothing in `perform`, `performBrowserStep`, or replay waiting for it.
  - The fix belongs to the toolset's or the helper's owner, which this brief does not cover, so no patch is offered. The popup case stays in the table as the failing-first test for that fix.
- **D2, no `prove` instrument.** No `prove` tool is registered in this session. The service cases with their controls, and mutation `j7b1`, are the evidence.
- **D3, choices made within scope.**
  - "Delayed in-frame submission" is read as `/checkout`, where the page handles the submission without navigating and the line appears after a delay. The form whose submit navigates is the contrasting case.
  - The module runs on a page from the built package's own context. A second protocol connection serves the source replay, so the module's toolset and its page come from one module instance.
  - Node's own loader imports the module through `createRequire`, which runs `require` of an ES module under Node 22.22.2, outside Vitest's transform.
  - Neither toolset receives `context`, matching the module's `createBrowserToolset(page)`.
  - The renamed setup types follow `.claude/rules/names.md`: `BrowserJourneyModuleInterface` and `BrowserJourneyConnectionInterface`, whose `close` became `destroy`.
- **Scope notes.** `tests/setup.test.ts` and `tests/setupServer.test.ts` received proofs of symbols that the owned setup files export. The brief's exception assigns those files to this unit. No route was added, because `/checkout`, `/form`, `/confirm`, `/popup`, and `/popup/child` serve every journey. No source file, shared file, or dependency changed. The probe under `tmp/probes/j7b/` was deleted. The formatter ran on scratch copies only, and its two hunks were copied back. No commit, stash, reset, checkout, or index-wide git command was issued.
