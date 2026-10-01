# J11 claims: the service proofs on Chromium

Claims 6, 7, 8, 9, and 13 have service blocks in `tests/service/journey.test.ts`, and each passes in 3 of 3 runs of `npm run test:service`. Claims 3, 4, 5, 12, and 14 pass in the same runs. Each run reports 85 passed and 1 skipped across 5 files. The new blocks found no source defect, so no source patch is proposed. No source file, route, or shared file changed.

## Changes

The diffstat is `2 files changed, 811 insertions(+), 2 deletions(-)`: `tests/service/journey.test.ts` +626/−2 and `tests/setup.ts` +185. The following table lists each change.

| Location | Change |
| --- | --- |
| `tests/service/journey.test.ts:1` | Widens the imports: the store, action, source-event, and result types; `Emitter`; `createRecorder` and `waitForCondition`; `createTool` and `createToolManager`; `renderBrowserRun`; the two file-store factories; `requireDocumentBundle`, `requireDocumentToolset`, `requireOutlineReference`, and `requireToolText`; and the setup fixtures that follow. The two existing blocks are unchanged. |
| `tests/service/journey.test.ts:388` | Adds `describe('journey replay coordination, preparation, tools, and secrecy')`. It launches its own Chromium and drives a `BrowserContext` over a `BrowserJourneyTransportRecorder`, as J5's block does. |
| `tests/service/journey.test.ts:430` | Claim 6: the hold-admission case at `:431` and the abort case at `:528`. |
| `tests/service/journey.test.ts:568` | Claim 7: the timeout case, with its control. |
| `tests/service/journey.test.ts:612` | Claim 8: four page-placement refusals over a file run store (`:613`), the control (`:649`), and the DOM-placement case (`:670`). |
| `tests/service/journey.test.ts:724` | Claim 9: the tools over the file journey and run stores. |
| `tests/service/journey.test.ts:855` | Claim 13: the secret, end to end. |
| `tests/setup.ts:3943` | Adds `BROWSER_JOURNEY_SLOW_HTML`, a `Slow` button whose click handler occupies the page for 1 500 ms. |
| `tests/setup.ts:3951`, `:3964` | Adds `BROWSER_JOURNEY_HOLD_JOURNEY` (`click` Delete, `dialog` accept, `wait` "Draft deleted") and `BROWSER_JOURNEY_ABORT_JOURNEY` (`click` Slow, `click` Keep). |
| `tests/setup.ts:3976`, `:3989` | Adds `BROWSER_JOURNEY_TIMEOUT_JOURNEY` (`click` Save draft, `wait` "Order shipped", `click` Review) and its control `BROWSER_JOURNEY_TIMEOUT_CONTROL`, which waits for "Delivery form". |
| `tests/setup.ts:4002` | Adds `BROWSER_JOURNEY_EVENT_COUNTER`. It counts pointer, mouse, key, `beforeinput`, `input`, and `change` events in the capture phase on `document.body.dataset.events`. |
| `tests/setup.ts:4012`–`:4039` | Adds `BrowserJourneyPreparationCase`, `BROWSER_JOURNEY_PREPARED_JOURNEY` (`click` Save draft, then a `type` into Name bound to `name`, which has no default), and `BROWSER_JOURNEY_PREPARATION_CASES`: a missing input, an unknown input, a gap, and a `switch` without a context. |
| `tests/setup.ts:4087`, `:4100` | Adds `BROWSER_JOURNEY_PRESS_JOURNEY` (`click` Gift wrap, `press` Enter) and `BROWSER_JOURNEY_PREFIX_JOURNEY` (`click` Gift wrap, `type` "Ribbon" into Message, `click` Wrap all). |
| `tests/setup.ts:4117`, `:4121` | Adds `BROWSER_JOURNEY_PASSWORD_HTML`, a password form whose button records only the value's length, and `BROWSER_JOURNEY_SECRET` (`Zq7#Marlin-Velvet`). |

Every fixture page is a route that already existed: `/confirm`, `/form`, and `/document`. Markup is injected into `main` where a case needs it, so `tests/setupServer.ts` gained no route. `tests/service/toolset.test.ts` is unchanged, because claim 6 needs the transport recorder that only the journey file's context carries.

## Claims

The counts below are per run. Each block's name is its `describe` path.

1. **Claim 3.** Block: `journey semantic replay > claim 3: changed markup and duplicate refusal` (J5). Runs 1, 2, and 3: 1 passed, 0 failed.
2. **Claim 4.** Block: `journey semantic replay > claim 4: CSS evidence never resolves a target` (J5). Runs 1, 2, and 3: 1 passed, 0 failed.
3. **Claim 5.** Block: `tests/service/toolset.test.ts > … > journey perform equality` (J4 and J4c): the native matrix of 7 cases, the combobox, the DOM child frame, the interrupted click, the switch, and the popup link. Runs 1, 2, and 3: 12 passed, 0 failed.
4. **Claim 6.** Block: `journey replay coordination, preparation, tools, and secrecy > claim 6: a replay hold admits only its own actions`. Runs 1, 2, and 3: 2 passed, 0 failed.
   - The hold case (`:431`) runs on `/confirm` with `context` and a `source` that adopts a `checkout` page tool. A foreign `click` on Keep is started before `execute()`, and the replay's `click` Delete is interrupted. A foreign `dialog` sent from that `action` event is refused with `The toolset is replaying delete-draft until it finishes; call look.`. After `s2`, a foreign `click` and `checkout` through `tools.execute` are refused with the same sentence, and `look`, `read`, `tabs`, and `wait` succeed. The first 5 events are `click done`, `hold delete-draft`, `click interrupted`, `dialog refused`, and `dialog done`, and the last is `release delete-draft`. The run is `complete` (`interrupted`, `done`, `done`), `answer` is `true`, `kept` is `1`, and `checkout` ran 0 times.
   - The abort case (`:528`) aborts the replay's signal after the transport sent the `mouseReleased` of the Slow click, while the page's handler holds the reply. The run is `aborted` with `s1` only, and `release` fires once with `keep-draft`. After the handler finishes, `kept` is unset. A foreign `click` on Keep then completes with `kept` at `1`, which is the control showing that the hold was released and that a Keep click is visible in the log.
5. **Claim 7.** Block: `… > claim 7: a wait that times out stops the run`. Runs 1, 2, and 3: 1 passed, 0 failed.
   - A direct `wait` returns `"Order shipped" did not appear within 5 s.`.
   - The replay ends `stopped` with `s1 done` and `s2 timeout`. `s2`'s result equals the direct receipt, and the render's head line is `Replay of review-draft stopped at s2 of 3: "Order shipped" did not appear within 5 s.`.
   - The page's click log stays `save:true` and the path stays `/form`.
   - Control: the same journey waiting for "Delivery form" completes, and its log reads `save:true review:true` at `/form/review`.
6. **Claim 8.** Block: `… > claim 8: preparation refuses before any side effect`. Runs 1, 2, and 3: 6 passed, 0 failed.
   - Each page-placement refusal rejects with its code: `BROWSER_JOURNEY_INPUT` twice, then `BROWSER_JOURNEY_GAP` and `BROWSER_JOURNEY_PLACEMENT`. After each one, the event counter is `0`, no `Input.dispatch*` frame was sent, the file run store's `list` is `{ entries: [], truncated: false, faults: [] }`, and its root is empty.
   - The control replays the same journey with `name` and stores 1 run, and the counter moves above zero.
   - In the DOM placement (`/document`, the built bundle), the `press` journey rejects with `BROWSER_JOURNEY_PLACEMENT` and `Step s2 cannot execute press in this placement.`. The counter stays `0`, and the memory run store holds 0 runs.
   - The prefix journey stops at `s3` with `Step s3 names button "Wrap all", which no element carries; call edit to remove or replace s3.`. Gift wrap stays checked, Message holds `Ribbon`, the click log reads `false` (one untrusted click), and 1 run is stored.
7. **Claim 9.** Block: `… > claim 9: the journey tools over the file stores`. Runs 1, 2, and 3: 1 passed, 0 failed.
   - Every call goes through `tools.execute` over `createFileBrowserJourneyStore` and `createFileBrowserRunStore`, rooted at a temporary directory.
   - `record` equals `Recording save-delivery; each action you take is a step; call save when it is done.` followed by a blank line and the `look` view.
   - `save` equals `Saved save-delivery with 2 steps.` followed by a blank line and the listing.
   - `journeys` equals the listing.
   - `edit`, with `ref` taken from the current view, equals `Edited save-delivery.` followed by a blank line and the listing plus `s3 click button "Review"`. `journey.json` then holds revision 2 and `s3`'s target `{ role: 'button', name: 'Review', reference }`.
   - A second file store over the same root writes between the tool's read and its write. The stale `edit` is then refused with `Journey save-delivery changed since you read it; call journeys, then edit again.`, and the stored journey stays at revision 3 with `s2`'s text `Grace`.
8. **Claim 12.** Block: `tests/service/codegen.test.ts > claim 12: page recorder against the fixture event log` (J6). Runs 1, 2, and 3: 2 passed, 0 failed.
9. **Claim 13.** Block: `… > claim 13: a secret stays out of every artifact`. Runs 1, 2, and 3: 1 passed, 0 failed.
   - A `type` with `secret: true` into the password field is recorded, saved, listed, and replayed through the `replay` tool with `inputs: { password: SECRET }`.
   - The listing is `sign-in "Sign in with the password" (parameters: password (secret))`, then `s1 type (secret) as password into textbox "Password"` and `s2 click button "Sign in"`. The render's step line is `s1 Typed a secret into e# textbox "Password".`.
   - The page receives the value: the length the page records is the secret's length, both when recording and when replaying.
   - None of these contains the value or `Zq7#`: `journey.json`, `run.json`, the save result, the listing, the run render, every tool receipt, every `BrowserAction` the toolset emitted, and the JavaScript and TypeScript modules `compileBrowserJourney` generates. Two of those actions carry `secret: true`.
   - `run.json` has `inputs: {}`, no `output` key, and no `capture`, and the run directory holds only `run.json`.
10. **Claim 14.** Block: `compiled module equality` (J7b, with the popup case after J4c). Runs 1, 2, and 3: 7 passed, 0 failed.

No claim carries a `prove` closing line, because no `prove` tool is registered in this session. The negative evidence is the control inside each case: claim 6's later Keep click and the `kept` count, claim 7's control journey, and claim 8's stored-run control. No source mutation was run, because this unit changes no source file.

## Source defects

None found. No source patch is proposed, and no failing-first test exists.

## Validation

Every command ran from the worktree root through `env -C /home/user/browser/tmp/worktrees/j11`, on the final text of both touched files. The following table records each command.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check tests/service/journey.test.ts tests/setup.ts` | 0 | All matched files use the correct format (2 files) |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/service/journey.test.ts tests/setup.ts` | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, and browser projects pass |
| `npm run test:setup` | 0 | 153 passed, 5 files |
| `npm run test:policy` | 0 | 114 passed, 1 skipped, 115 collected |
| `npm run test:service -- --reporter=verbose`, run 1 | 0 | 85 passed, 1 skipped (86): browser 28 passed and 1 skipped, codegen 2, document 5, journey 20, toolset 30; 91.59 s |
| `npm run test:service -- --reporter=verbose`, run 2 | 0 | 85 passed, 1 skipped (86): browser 28 passed and 1 skipped, codegen 2, document 5, journey 20, toolset 30; 92.12 s |
| `npm run test:service -- --reporter=verbose`, run 3 | 0 | 85 passed, 1 skipped (86): browser 28 passed and 1 skipped, codegen 2, document 5, journey 20, toolset 30; 96.29 s |
| `git diff --check -- tests` | 0 | No whitespace errors |

The one skip in each run is the existing WebMCP mirror case in `tests/service/browser.test.ts`, which cites `REGISTRY_ABSENT_REASON`. Before the change, the same project reported 74 passed and 1 skipped (75). The 11 added cases account for the difference.

## Deviations and notes

- **D1, the adopted page tool's source.** Chromium on this host has no WebMCP registry (the cited skip reason). Claim 6 therefore passes the toolset a `source` that adopts a real `createTool` from a `createToolManager()`. J4's core proof of the same refusal uses the same seam. The adopted tool's refusal comes from the toolset's own admission, and its handler ran 0 times.
- **D2, a non-TypeScript edit command.** One mechanical text replacement in `tests/service/journey.test.ts` ran through a `python3` heredoc instead of the edit tool or a Node script. The workspace law for scripts names TypeScript only. That command left no file behind, and every gate ran after it.
- **D3, three launches.** The Chromium launch and debugger-URL read in a `beforeAll` appear in J5's block, J7b's block, and this one. A helper in `tests/setupServer.ts` would remove the copies, but it would need a Chromium proof in the `setup` project, which launches no browser, and the two earlier blocks are not this unit's. The launch is left as the earlier blocks have it, for the Orchestrator to rule.
- **D4, carried naming.** § 5 and § 11 of the design name the stale-revision code `BROWSER_JOURNEY_REVISION`, and the source throws `BROWSER_JOURNEY_STALE`. That is J5's recorded deviation (`tmp/units/journeys/j5-stale-doc.patch`). Claim 9 asserts the sentence the `edit` tool maps it to.
- **Scope.** No source file, route, `tests/setupServer.ts`, or `tests/service/toolset.test.ts` changed. No probe was written, and no commit, stash, reset, checkout, or index-wide git command was issued. Each temporary directory is registered for teardown. The run logs are outside the worktree.
