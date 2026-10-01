# F7 claims: replay against a direct call for every native action, and the DOM placement's child frame

A one-step `createBrowserReplay` over each of the 7 `BROWSER_JOURNEY_SERVICE_CASES` rows completes `done` with the stage, reason, and receipt wording of a direct `tools.execute` on a second fresh page. In the DOM placement, a one-step `click` journey naming the same-origin child-frame button completes and sets the frame's own marker. Mutation `f7a` reddens the `navigate` row alone, and the existing toolset equality rows stay green under it. Mutation `f7b` reddens the DOM case alone. Every validation command exits 0. No source file changed.

## Changes

The worktree diff touches only the 3 owned files: 146 insertions and 0 deletions. The following table lists each change by `path:line`.

| Location | Change |
| --- | --- |
| `tests/setup.ts:2333`–`2357` | `createBrowserJourneyServiceJourney(scenario, resolve)` builds the one-step journey for a `BROWSER_JOURNEY_SERVICE_CASES` row. It names the journey after the row, copies the row's arguments and target, and resolves `navigate`'s path to the absolute URL the tool requires. |
| `tests/setup.ts:2374`–`2378` | `BROWSER_JOURNEY_FRAME_JOURNEY` holds the one-step `click` journey on `button "Save in frame"`, the button of the existing `BROWSER_JOURNEY_FRAME_HTML` fixture. |
| `tests/service/journey.test.ts:65`, `:72` | Imports of the case table and the factory. |
| `tests/service/journey.test.ts:987`–`1065` | The added `describe` block `claim 5: a one-step replay agrees with a direct call for every native action`. It launches its own browser, and its `it.each` over the case table holds 7 tests. The existing blocks are unchanged. |
| `tests/service/document.test.ts:42` | Import of `BROWSER_JOURNEY_FRAME_HTML` and `BROWSER_JOURNEY_FRAME_JOURNEY`. |
| `tests/service/document.test.ts:189`–`217` | The added case `replays a one-step click journey naming a same-origin child-frame button to complete, setting the frame marker and not the page marker`. |

## Claims

No `prove` tool is registered in this session, so no claim has a `prove` closing line. The live tests and the mutations are the evidence.

1. **Replay equals a direct call for every native row.** For each row, the test replays the one-step journey on a fresh page. On a second fresh page it sends `tools.execute` with the step's arguments and, for a targeted row, the reference `locateBrowserTarget` resolved there. It collects the direct action through the toolset's `action` event. It asserts that the run is `complete` with 1 step and that the step's `{ outcome, stage, reason, result }` strictly equals `{ 'done', direct.stage, direct.reason, direct.receipt }`, with references masked by `maskBrowserReferences`. It also asserts that the direct tool text contains the direct receipt. A probe on 2026-10-01 read the compared values, and the following table lists them. The probe was deleted; the test carries its assertions.

   | Row | Stage | Reason | Receipt (masked) |
   | --- | --- | --- | --- |
   | `click` | absent | absent | `Clicked e# button "Save draft".` |
   | `type` | absent | absent | `Typed "Grace Hopper" into e# textbox "Name".` |
   | `submitted form` | `loaded` | `formSubmissionGet` | `Typed "Grace Hopper" into e# textbox "Name" and submitted the form.` |
   | `delayed child submission` | `loaded` | `formSubmissionGet` | `Typed "SPRING" into e# textbox "Code" and submitted the form.` |
   | `press` | absent | absent | `Pressed Escape.` |
   | `navigate` | `loaded` | absent | `Navigated to http://127.0.0.1:PORT/shop.` |
   | `wait` | absent | absent | `"Delivery form" is on the page.` |

   Counts of `npm run test:service -- tests/service/journey.test.ts`: 27 passed (27), 27 passed (27), 27 passed (27). The 7 tests of this block are among them, and the file's baseline before the change was 20 tests.

2. **A same-origin child-frame element replays in the DOM placement.** On the `/document` page, the case appends an `iframe` whose `srcdoc` is `BROWSER_JOURNEY_FRAME_HTML`. It then runs `createBrowserReplay(documentToolset, { journey: BROWSER_JOURNEY_FRAME_JOURNEY }).execute()` from the built `dist/src/core/index.js` inside the page. It asserts outcome `complete` and the single step `['s1', 'done', /^Clicked e[1-9]\d* button "Save in frame"\. \(untrusted event\)$/u]`. It also asserts that the frame's `body.dataset.clicked` is `yes` and that the main document's is absent. Counts of `npm run test:service -- tests/service/document.test.ts`: 6 passed (6), 6 passed (6), 6 passed (6). The baseline before the change was 5 tests.

## Failing-first evidence

The added tests close a coverage gap, not a defect, so the mutations serve as their failing-first evidence. Each mutation was applied, run, and restored. The restore was confirmed with `sha256sum -c` against the digest taken before the mutation. `npm run build` ran after applying `f7a` and again after restoring it, so `dist/` holds the restored source. The patches and logs are in `tmp/codex/f7-mutations/`.

The following table lists each mutation, the command it ran, and the result.

| Mutation | Patch | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| `f7a`: `performBrowserStep` in `src/core/helpers.ts:2420` adds `ref: 'e1'` to a `navigate` step's arguments | `f7a.patch` | `npm run test:service -- tests/service/journey.test.ts` (`f7a-journey.log`) | 1 | 1 failed, 26 passed (27). The failure is `claim 5 … replays 'navigate' …`, `expected 'stopped' to be 'complete'`, because `validateBrowserToolArguments` refuses the unadvertised `ref`. |
| `f7a`, contrast | `f7a.patch` | `npx vitest run … --project service tests/service/toolset.test.ts -t "matches the direct receipt, stage, and reason for"` (`f7a-toolset.log`) | 0 | 7 passed, 23 skipped (30). The existing equality rows never replay, so they pass under the mutation, which confirms the J14 finding. |
| `f7b`: `BROWSER_JOURNEY_FRAME_JOURNEY`'s target name becomes `Apply`, the `/document` main-frame button | `f7b.patch` | `npm run test:service -- tests/service/document.test.ts` (`f7b-document.log`) | 1 | 1 failed, 5 passed (6). The failure is the added DOM case: the replay still completes, and its receipt reads `Clicked e4 button "Apply". (untrusted event)`. |

## Validation

Every command ran from the worktree root through `env -C`, and each output was read bare. The following table lists each command with its exit code and count.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --config .oxfmtrc.json --check tests/setup.ts tests/service/journey.test.ts tests/service/document.test.ts` | 0 | 3 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the same 3 files | 0 | no diagnostic |
| `npm run check` | 0 | root, `check:src:core`, `check:src:server`, `check:src:browser`, and `check:src:bin` pass |
| `npm run test:setup` | 0 | 5 files, 153 passed (153) |
| `npm run test:service -- tests/service/journey.test.ts`, run 1 | 0 | 27 passed (27) |
| the same, run 2 | 0 | 27 passed (27) |
| the same, run 3 | 0 | 27 passed (27) |
| `npm run test:service -- tests/service/document.test.ts`, run 1 | 0 | 6 passed (6) |
| the same, run 2 | 0 | 6 passed (6) |
| the same, run 3 | 0 | 6 passed (6) |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (115) |
| Baseline before any edit: `npm run test:service -- tests/service/journey.test.ts tests/service/document.test.ts` | 0 | 25 passed (25) |

## Deviations and findings

- **The changed note is not observable through a run.** Design claim 5 names the changed note among the equal fields. A run step's `result` is `BrowserAction.receipt`, which is the first paragraph of the handler body. It does not include the notes `#drain()` prepends to the tool text (`src/core/BrowserToolset.ts:535`–`536`), and `BrowserReplay.#performCall` discards that tool text. The test therefore compares stage, reason, and receipt as the brief prescribes. It also asserts that the direct tool text contains the receipt. It does not compare the replay's note, because no public surface carries it. Closing that gap would change the source or the `BrowserRunStep` contract, so this unit reports it and makes no change.
- **Browser flags.** The added block launches with `SERVICE_BROWSER_ARGS` alone, like the other blocks in `journey.test.ts`. It omits the `--site-per-process` flag that `toolset.test.ts` adds. All 7 rows, `delayed child submission` on `/frame/local` included, pass under the shared flags in each of the 3 runs.
- **Build.** `npm run build` ran twice, after applying `f7a` and after restoring it, as the dispatch instructed. Both runs exited 0; the logs are `f7a-build.log` and `f7a-restore-build.log`.
- **Probe.** The runtime probe `tmp/probes/f7/values.test.ts` read the values in the claim 1 table and was deleted. The added test carries its assertions.
- Blocking deviations: none. No source file differs from c671397, and no commit, stash, reset, or checkout ran.
