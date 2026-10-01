# F1 claims

Popup settlement preserves the opener's recorded click. The toolset omits a main-frame marker at dispatch, and the recorder treats every present marker as a child-frame gap. The prescribed gates pass; acceptance remains with the campaign orchestrator.

## Changes and claims

1. `src/core/BrowserToolset.ts:1077` includes `target.frame` only when the resolved element frame differs from the dispatching page's main frame. `src/core/types.ts:1845` documents that meaning. `tests/src/core/BrowserToolset.test.ts:153` checks the exact target after input replaces the document, including the absence of `frame`.
2. `src/core/recorders/BrowserRecorder.ts:146` checks `action.target?.frame !== undefined` without consulting the view. `tests/src/core/recorders/BrowserRecorder.test.ts:89` proves a present marker remains a gap even when its value equals the later popup view's id.
3. `tests/src/core/recorders/BrowserRecorder.test.ts:51` drives a real toolset and recorder over the CDP fixture. It observes the popup view during the `action` event, checks the completed action's popup tab, and asserts the exact recorded `click` without a tab or gap. The resulting journey validates through `recorder.journey()`.
4. `tests/src/core/recorders/BrowserRecorder.test.ts:168` dispatches a click to a same-origin, in-process child frame, checks `target.frame === 'child'`, and checks the exact unresolved step.
5. `tests/setup.ts:2221` centralizes the popup fixture formerly embedded in `tests/src/core/BrowserToolset.test.ts:3787`. The opener reports `Page.windowOpen` and popup attachment before replying to mouse release. The popup has its own frame-tree root. Both toolset execution paths continue to pass with the shared fixture.

The final source and test patch is `tmp/codex/f1-mutations/f1-final.patch`. No source outside the owned list changed. No scope extension was needed. No commit, stash, reset, checkout, or index-wide Git command ran.

## Mutation evidence

Each mutation changes only its named production rule, runs the named test, and restores the fixed source. Filtered-out tests are reported as skipped by Vitest; neither test declares a skip.

| Mutation | Patch | Named assertion | Exit and observed counts |
| --- | --- | --- | --- |
| `f1a` | `tmp/codex/f1-mutations/f1a.patch`: restores the original recorder comparison against the current view | `records the opener click after settlement moves the view to the popup`, assertion `a present frame remains a gap after the popup move` | 1; 1 failed, 20 filtered out; the marker became `click` instead of `unresolved` |
| `f1b` | `tmp/codex/f1-mutations/f1b.patch`: restores frame capture for main-frame elements | `captures the main-frame target without a frame before input replaces the document`, exact target assertion | 1; 1 failed, 142 filtered out; the target gained `frame: 'main'` |

The mutation logs and exit records are `tmp/codex/f1-mutations/f1a.verified.log`, `f1a.verified.json`, `f1b.verified.log`, and `f1b.verified.json` in the same directory. Both named tests pass in the restored touched-file and core-project runs.

The `f1a` equality boundary uses an inert action after the real popup click because omitting the opener's main-frame marker alone also makes that click pass under the old recorder. This additional assertion isolates the recorder's presence-only contract from the toolset repair. It does not claim that the inert action was dispatched through CDP.

## Validation

Commands ran from `/home/user/browser/tmp/worktrees/f1`, prefixed with `env -C /home/user/browser/tmp/worktrees/f1`. The format and lint file list is `src/core/BrowserToolset.ts src/core/recorders/BrowserRecorder.ts src/core/types.ts tests/src/core/BrowserToolset.test.ts tests/src/core/recorders/BrowserRecorder.test.ts tests/setup.ts`.

| Command | Exit | Counts and result |
| --- | --- | --- |
| `npm run check:src:core` after the contract remark | 0 | No diagnostics |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/recorders/BrowserRecorder.test.ts -t 'captures the main-frame target\|records the opener click\|records a same-origin child-frame'` before the production fix | 1 | 2 failed, 1 passed, 161 filtered out; popup became a gap and main-frame target carried `frame` |
| Same focused command after the production fix | 0 | 3 passed, 161 filtered out |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/recorders/BrowserRecorder.test.ts -t 'records the opener click after settlement moves the view to the popup'` with `f1a` | 1 | 1 failed, 20 filtered out |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts -t 'captures the main-frame target without a frame before input replaces the document'` with `f1b` | 1 | 1 failed, 142 filtered out |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/recorders/BrowserRecorder.test.ts` with restored source | 0 | 164 passed across 2 files; 37.97 seconds |
| `npx oxfmt --check` with the touched file list | 0 | 6 files correctly formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` with the touched file list | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin typechecks passed; no diagnostics |
| `npm run test:src:core` | 0 | 1037 passed across 50 files; 39.38 seconds |
| `npm run test:policy` | 0 | 114 passed, 1 skipped across 1 file; 8.88 seconds |

The core run used the installed dispatch launcher with a 180-second cap. `tmp/codex/f1-core.log` contains its full output; `tmp/codex/f1-core.err` records `exit=0 signal=none capped=false duration_ms=41327`. The policy skip is the existing substitution-table comparison at `tests/policy.test.ts:718`, conditional on the repository-local `.claude/rules/writing.md` existing; this repository reads that rule from scaffold.

## Deviations and resolved findings

- The initial read command ran at the correct working directory but omitted the mandated `env -C` prefix. Subsequent command invocations use the prefix. It changed no files.
- The first fixture test run used the `BrowserToolset` constructor without its page option and reported 3 failures. Both protocol tests were corrected to use `createBrowserToolset(page)` before establishing the defect baseline reported in the table. This was a test setup error, not mutation evidence.
- The initial mutation runner, `tmp/codex/f1-mutations/run.ts`, received exit 1 with empty output from its child and rejected the result because no failed assertion was reported. Its `f1a.json` and empty `f1a.log` are rejected evidence. Direct harness commands produced the `.verified` evidence in the mutation table. The runner restored the source in `finally` before the direct runs.
- The first scoped lint run exited 1 for the unused `emitBrowserWindowOpen` import after fixture extraction. The import was removed; the final lint run exits 0.
- No `probe` MCP tool is registered in this session, and adding harness configuration outside the worktree is outside this unit's write scope. No `prove` receipt is claimed. The prescribed direct tests and mutation controls supply the reported runtime evidence.
- This unit performs the prescribed fix verbatim and closes it with the required mutations. It spawns no agents and makes no independent campaign-acceptance claim.

## Design amendment

In `/home/user/browser/.orkestrel/browser/journeys-design.md` section 3, replace the clause “an action whose `target.frame` is present and is not the main frame becomes the child-frame gap” with the following sentence, which also defines section 4's `BrowserAction.target.frame` contract:

> The toolset includes `target.frame` only when the element's frame differs from the dispatching page's main frame at input dispatch, and the recorder emits the child-frame gap whenever `target.frame` is present without consulting the current view.

The external design document is report-only for this unit and was not edited.
