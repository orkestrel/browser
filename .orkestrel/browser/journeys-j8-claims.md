# J8 claims

The journey toolset is implemented. `BrowserToolset` and `createDocumentToolset` construct it when `journeys` is given. The core project passes 1,056 tests, the browser project passes 233 tests on Chromium, and the policy project passes 114 tests. Each of the mutations `j8a` through `j8d` fails a named assertion.

## Changes

The following table lists each change by location.

| Location | Change |
| --- | --- |
| `src/core/BrowserJourneyToolset.ts:73` | Adds the class. It refuses a manager that already holds a journey name with `BROWSER_TOOLSET_RESERVED`, registers the five tools with `BROWSER_TOOL_COPY`'s rows, and subscribes to `hold` and `release`. |
| `src/core/BrowserJourneyToolset.ts:150` | Runs every tool through one boundary: the lifecycle check, `validateBrowserToolArguments`, and a signal that combines the context's signal with the destroy signal. |
| `src/core/BrowserJourneyToolset.ts:163` | Implements `record`: `readonly`, then the recording in progress, then `BROWSER_JOURNEY_NAME_PATTERN`, then the saved name. It starts `createBrowserRecorder(toolset)` and returns the receipt with the view. |
| `src/core/BrowserJourneyToolset.ts:194` | Implements `save`: `readonly`, then the idle refusal. It stops the recorder at line 204, builds the journey, and writes through `store.set`. The recording ends only after the write succeeds, and a failed or locked write returns its refusal. |
| `src/core/BrowserJourneyToolset.ts:227` | Implements `journeys`. It pages `store.list` and counts an unreadable entry toward the next offset (line 237). It joins the renders with one blank line and cuts them at the limit over UTF-16 code units, never splitting a surrogate pair. A limit that cannot hold the next code point refuses with `BROWSER_TOOLSET_LIMIT`. |
| `src/core/BrowserJourneyToolset.ts:265` | Implements `edit`: `readonly`, then the store read. It converts each `ref` through the current view (line 423) and refuses a stale ref with the `look` sentence (line 445). It applies `editBrowserJourney` and writes with the read revision as `expected`. It maps `BROWSER_JOURNEY_STALE`, `BROWSER_JOURNEY_LOCKED`, and `BROWSER_JOURNEY_EDIT` to their sentences. |
| `src/core/BrowserJourneyToolset.ts:307` | Implements `replay`. It refuses while recording or while any hold is active, claims the toolset before its first await, and runs `createBrowserReplay(toolset, revision, { inputs, runs })` under the signal. It returns `renderBrowserRun(run, view)` with the view read after the run. |
| `src/core/BrowserJourneyToolset.ts:361` | Maps `BROWSER_JOURNEY_INPUT`, `_GAP`, `_PLACEMENT`, `_FORMAT`, and `_INVALID` to § 7's sentences. |
| `src/core/BrowserJourneyToolset.ts:505` | Implements `destroy()`: aborts the active replay, removes the five tools the manager still holds, stops a recording without saving it, and waits for the replay to finish. |
| `src/core/constants.ts:874` | Adds `BROWSER_JOURNEY_TOOL_NAMES`, `BROWSER_JOURNEY_READONLY_REFUSAL` (883), `BROWSER_JOURNEY_RECORDING_REFUSAL` (886), and `BROWSER_JOURNEY_IDLE_REFUSAL` (889). |
| `src/core/BrowserToolset.ts:268` | Constructs the journey toolset after the manager and the native tools when `options.journeys` is given. The TSDoc at line 95 states this. |
| `src/core/BrowserToolset.ts:1640` | Reserves the five names for page tools only when the toolset holds journeys; a page tool under a reserved name is skipped with `reserved`. |
| `src/core/BrowserToolset.ts:1688` | Destroys the journey toolset before the toolset's own teardown. |
| `src/browser/factories.ts:76` | Passes `journeys` through `createDocumentToolset`; the TSDoc at line 45 states it. |
| `src/core/index.ts:43` | Exports the class. |
| `tests/src/core/BrowserJourneyToolset.test.ts:34` | Adds 22 tests over the memory stores, a real `BrowserToolset` over the view double, and the element fixture. |
| `tests/src/core/BrowserToolset.test.ts:5257` | Adds the three construction cases under `journeys`. |
| `tests/src/browser/factories.test.ts:253` | Adds the document-placement construction case on Chromium. |

The worktree held a partial attempt at this unit. This unit keeps that attempt's structure and makes these corrections:

- `record` and `replay` construct through `createBrowserRecorder` and `createBrowserReplay`, as the brief names, rather than through `new`.
- `save` stops the recorder before it builds the journey.
- `journeys` pages past unreadable entries.
- A limit that cannot hold a surrogate pair is refused rather than cut through the pair.
- The `no-new` lint warning and the formatting are fixed.
- The construction tests in `BrowserToolset.test.ts` and `factories.test.ts` are added.

## Claims

1. **Registration.** The five tools carry `BROWSER_TOOL_COPY`'s descriptions and parameters. `record` requires `journey`, `save` requires `description`, `journeys` requires `what`, `edit` requires `journey` and `edits`, and `replay` requires `journey`. Only `journeys` carries annotations, `{ pure: true, untrusted: true }`. An unadvertised argument is refused. Proof: `registers the five tools with their copy, a required parameter each, and journeys pure and untrusted`.
2. **Results and refusals verbatim.** Each table row and each § 7 refusal is asserted as a whole string. The record and save receipts are in `records the actions, saves before it publishes, and returns the receipts verbatim`. The four record refusals and the idle save are in `refuses an invalid name, a saved name, a recording in progress, and a save with nothing recording`. The failed and locked save are in `stops the recorder, keeps the recording open…`. The six edit refusals are in `refuses a missing journey, a stale ref, an invalid edit, a stale revision, and a held lock verbatim` and the `readonly` case. The ten replay refusals are in `maps every preparation refusal and a missing journey to its sentence` and `refuses while recording, while another replay holds, and when the journey cannot be read`. The two resolution sentences appear in the run render without their directive in `stops at a resolution refusal…` and `stops at a target no element carries…`. Every REASON is a clause with no directive and no final period (mutation `j8b`).
3. **Persist before publish.** `save` stops the recorder, which turns an unanswered interrupted action into its gap step. It builds the journey and writes it. A failed or locked write leaves `recording` set and the listing empty. The next `save` persists the same steps (`s2 unresolved: interrupted click`), and only then is `recording` cleared. Proof: `stops the recorder, keeps the recording open when the write fails or is locked, and saves its steps after` (mutation `j8a`).
4. **Listing.** The listing equals § 7's fence for `add-kettle`. Journeys are joined by one blank line, and an empty store returns `BROWSER_JOURNEY_EMPTY_LISTING`. The cut counts characters (`thé` is 82 characters and 83 bytes), and its footer reads `[characters START–END of TOTAL; call journeys with offset END for more]`. The last slice reads `[characters 80–82 of 82]`. An offset past the end restarts at 0, as `read` does, and a negative offset is refused. A surrogate pair is never split. Paging continues past an unreadable entry. Proofs: the four `journeys` tests (mutation `j8d`).
5. **Edit and the `ref` conversion — claim 9's tool half.** `ref` on an `add` step and on an `update` becomes `{ role, name, reference }` from `toolset.view.elements`. A ref outside the view refuses with `Element e9 is not in the current view; call look for fresh refs.`. The write passes the read revision as `expected`, and a concurrent write in between maps `BROWSER_JOURNEY_STALE` to its sentence. A refused batch leaves revision 1 and the stored arguments unchanged. Proofs: `converts each ref through the current view, writes with the read revision, and lists the result` and the edit refusal test.
6. **`readonly`.** `record`, `save`, and `edit` refuse before any store call; the store recorder holds no call. `replay` reads the journey and writes its run. Proof: `refuses record, save, and edit before any store access, and lets replay write its run` (mutation `j8c`).
7. **The signal.** Aborting the call's signal rejects the pending store call of `record` (`get`), `journeys` (`list`), `edit` (`get`), `replay` (`get`), and `save` (`set`). The tool returns the abort reason, and a save abort keeps the recording open. An abort during a replayed step yields `Replay of check-ready aborted at s1 of 2.` with the aborted run stored and no following key input. Proofs: `reaches the store calls of every tool` and `reaches a save write and a replayed step`.
8. **Destroy.** `destroy()` during a replay aborts it. The replay releases its hold, stores an `aborted` run, and returns its render before `destroy()` resolves. The five tools are removed, and `look` stays. A recording in progress is dropped unsaved, and a retained tool handle then refuses with `the browser session ended`. Proofs: `aborts the active replay, waits for it, and removes the five tools` and `stops a recording without saving it and refuses a retained tool afterwards`.
9. **Construction by the toolset.** With `journeys`, the five tools are in the manager before `start()`. A page tool named `record` is skipped as `reserved`; without `journeys`, the same tool is adopted. `destroy()` removes the five journey tools before `look`, `read`, `click`, `type`, `wait`, and the adopted `extra`, and the control mutation that moves the destroy last fails this assertion. A manager that holds `replay` refuses construction and keeps only its own tool. A replay in flight at `toolset.destroy()` ends `aborted` with its run stored. Proofs: the three `BrowserToolset > journeys` tests.
10. **Document placement.** `createDocumentToolset({ document, journeys })` registers the five tools at construction. It records a click and saves `s1 click button "Save"`. Its replay renders `s1 Clicked eN button "Save". (untrusted event)`, and the page's listener sees two untrusted clicks. A manager holding `journeys` refuses construction and aborts the view's `pagehide` subscription. Proof: `constructs the journey tools with journeys, replays a recorded click untrusted, and destroys the view when they cannot be added` on Chromium.
11. **Secrets — claim 13's listing and render half.** A secret `type` saves as `s1 type (secret) as email into textbox "Email"` under `(parameters: email (secret))`. The recorded value and the replay input appear in none of the save result, the listing, the replay render, and the stored journey. Proof: `keeps a secret out of the listing and the run render`.

No `prove` tool is registered in this session, so no claim carries a `prove` closing line. The tests and mutations are the evidence.

## Mutations

Each mutation is a patch under `tmp/codex/j8-mutations/`. It was applied with `patch -p1` and run with `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts`, then reverted. `cmp` against `original.snapshot` confirmed each restore. The `.log` and `.exit` files hold each run's output and exit code.

| Mutation | Breaking edit | Named assertion and failure | Exit and counts |
| --- | --- | --- | --- |
| `j8a` | Clears `recording` before `store.set` | `stops the recorder, keeps the recording open…`: `expected undefined to be 'check-form'` at line 238. `reaches a save write and a replayed step` also fails. | 1; 2 failed, 20 passed |
| `j8b` | Drops the final-period strip from the reason clause | `stops the recorder, keeps the recording open…`: `Saving check-form failed: the disk is full.; call save again.` at line 235. `refuses while recording, … cannot be read` also fails. | 1; 2 failed, 20 passed |
| `j8c` | Checks `readonly` in `edit` after the store read | `refuses record, save, and edit before any store access…`: `expected [ [ 'get' ] ] to deeply equal []` at line 310 | 1; 1 failed, 21 passed |
| `j8d` | Cuts the listing over UTF-8 bytes | `cuts the listing over characters at the limit…`: the footer totals differ (83 bytes against 82 characters) at line 371. `never cuts a surrogate pair in half…` also fails. | 1; 2 failed, 20 passed |
| `order` (control) | Moves `await this.#journeys?.destroy()` to the end of `BrowserToolset.#teardown` | `constructs the journey tools with journeys, … destroys them first`: the removal order starts with `look` instead of `record` | 1; 1 failed, 2 passed, 138 skipped by `-t journeys` |

## Validation

Every command ran from the worktree root through `env -C /home/user/browser/tmp/worktrees/j8`. Each output was read in full, with nothing filtering it.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the eight touched files | 0 | All 8 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the eight touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, and browser projects pass |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts` | 0 | 22 passed |
| `npx vitest run --config vite.config.ts --project src:browser tests/src/browser/factories.test.ts` | 0 | 13 passed, 1 skipped (the skip is the existing `native document registry composition` case) |
| `npm run test:src:core` | 0 | 1,056 passed across 50 files |
| `npm run test:src:browser` | 0 | 233 passed, 1 skipped across 9 files on Chromium |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (the skip already existed) |

## Deviations and notes

- **D1, `save` and an action after a refused write.** The brief orders `save` as stop, build, then write. `BrowserRecorder.start()` clears its steps, so a stopped recorder cannot resume. After a refused write, the recording stays open under its name and keeps its steps, and the next `save` persists them. An action taken between the refusal and that `save` is not a step. Stopping first is what turns an unanswered interrupted action into its gap rather than dropping it. A recorder that resumes without clearing would need a change to J5's `BrowserRecorder`; this unit issues no patch for it.
- **D2, error codes for J12.** The tools throw these codes, which § 11's table does not list: `BROWSER_JOURNEY_READONLY`, `BROWSER_JOURNEY_RECORDING` (recording in progress, idle `save`, and `replay` while recording), `BROWSER_JOURNEY_SAVED`, and `BROWSER_JOURNEY_MISSING`. The tools also reuse `BROWSER_TOOLSET_ARGUMENT`, `BROWSER_TOOLSET_LIMIT`, `BROWSER_TOOLSET_RESERVED`, `BROWSER_TOOLSET_BUSY`, and `BROWSER_TOOLSET_ENDED`. A mapped preparation refusal keeps its replay code. A store failure keeps the store's code, or `BROWSER_JOURNEY_FILE` when the failure has none.
- **D3, the placement step.** J5's `BROWSER_JOURNEY_PLACEMENT` error carries no context. The toolset reads the step id from J5's message, `Step sN cannot execute …`, and the press and switch cases pin that format. When the id cannot be read, the refusal keeps J5's message.
- **D4, constructor signature.** The constructor is `new BrowserJourneyToolset(toolset, options, limit = BROWSER_TOOL_LIMIT)`. `BrowserToolset` passes its own limit, and the interface declares no constructor.
- **D5, listing faults.** Paging adds `entries.length + faults.length` to the offset, which assumes a page's window spans its unreadable entries, as § 7 describes the file store's paging. J9's file store has to page that way. The listing renders no fault.
- **D6, instrument.** No `prove` MCP tool is registered, and registering one is outside the unit's scope.
- **Scope.** Every edit is inside the brief's owned files. The browser factory and `BrowserToolset` test additions are the construction cases only. No shared-file patch is returned. The mutation patches, `.mutant` copies, snapshots, and logs remain under the ignored `tmp/codex/j8-mutations/`. No commit, stash, reset, checkout, or index-wide git command was issued.
