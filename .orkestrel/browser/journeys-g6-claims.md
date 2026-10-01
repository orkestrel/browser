# G6 claims

G6 implements the prescribed repairs. Every validation command required by the brief passes. Supplemental server and setup project runs fail on host-dependent fixtures in this sandbox; their results remain failures in the table. This report replaces the stopped attempt. Both journey functions remain in `helpers.ts`.

## Changes and numbered claims

The claims identify the implementation and its evidence.

1. **A child frame's same-document navigation preserves the main-frame edit; the main frame's navigation closes it.** `src/core/recorders/BrowserCodegen.ts:184` reads the initial main-frame id through the existing `readBrowserFrames` helper. `src/core/recorders/BrowserCodegen.ts:410` filters the session and `frameId`, retains the full-navigation parent filter, and updates the main-frame id on a main-frame commit. The regression at `tests/src/core/recorders/BrowserCodegen.test.ts:14` requires `second, third`, refusing the old `first, second, third` split. Mutation `g6a` fails that assertion.
2. **The locator requires the caller's step id and invents none.** `src/core/types.ts:2590` declares `BrowserTargetOptions.id` as required. `src/core/helpers.ts:2375` requires those options, and `src/core/helpers.ts:2386` reads their id without a default. The existing `performBrowserStep` call forwards its id at `src/core/helpers.ts:2426`; replay already passes the step identity through that function at `src/core/BrowserReplay.ts:258`. `tests/src/core/helpers.test.ts:219` checks the required options contract. The missing-target refusal names `s3`, direct ambiguity names `s8`, and step execution ambiguity names `s3` in that suite. Mutation `g6b` fails the type assertion when an omitted options argument invents `s1`.
3. **Non-step membership has one home.** `src/core/constants.ts:797` owns `BROWSER_JOURNEY_NON_STEP_TOOLS`; `src/core/helpers.ts:2824` and `src/core/recorders/BrowserRecorder.ts:107` read it. `tests/src/core/recorders/BrowserRecorder.test.ts:24` exercises both consumers with an observation and an acting-step control. Removing `look` from the home fails both consumer assertions in `g6c`.
4. **The run-id pattern has one home.** `src/core/constants.ts:794` owns `BROWSER_RUN_ID_PATTERN`; `src/core/helpers.ts:3033` and `src/server/stores/FileBrowserStore.ts:49` read it. `tests/src/server/stores/FileBrowserStore.test.ts:10` exercises both consumers with a valid run id and a traversal refusal. Changing the home to require a five-digit suffix fails both consumer assertions in `g6d`.
5. **Recorded text parameter collection has one home.** `src/core/helpers.ts:2674` exports `collectBrowserJourneySecrets`, consumed at `src/core/recorders/BrowserRecorder.ts:134` and `src/core/recorders/BrowserCodegen.ts:380`. Direct coverage at `tests/src/core/helpers.test.ts:87` checks empty input, text bindings, literal text, other arguments, malformed bindings, and order. The consumer proof at `tests/src/core/recorders/BrowserRecorder.test.ts:53` requires the same collision fallback from both recorders. Emptying the collection in `g6e` fails both assertions.

The existing core barrel exports the added constants, helper, and options. Guide rows and the helper example follow them at `guides/browser.md:234`, `guides/browser.md:488`, `guides/browser.md:611`, and `guides/browser.md:1105`. The locator summary remains one sentence.

## Mutation evidence

All commands in this section run through `env -C /home/user/browser/tmp/worktrees/g6`. `tmp/codex/g6-mutations/run.ts` records the exact commands and restores each source in `finally`. Each `<mutation>.log` contains the failing run, and each `<mutation>-restored.log` contains the same command after restoration. `combined-2.err` records exit 0, uncapped, for the completed controller.

| Mutation | Breaking edit | Named assertion | Mutant exit and count | Restored exit and count |
| --- | --- | --- | --- | --- |
| `g6a` | Read `params['frame']` instead of `params['frameId']` | `child navigation preserves the edit; main navigation closes it` | 1; 1 failed, 15 filtered out | 0; 1 passed, 15 filtered out |
| `g6b` | Default locator options to `{ id: 's1' }` | `expectTypeOf<Parameters<typeof locateBrowserTarget>[2]>().toEqualTypeOf<BrowserTargetOptions>()`, in `resolves a unique semantic target and refuses a missing target without sending input` | 2; 1 TS2344 diagnostic at `tests/src/core/helpers.test.ts:219` | 0; 0 diagnostics |
| `g6c` | Remove `look` from the shared non-step constant | `recorder reads the non-step home`; `validator reads the non-step home` | 1; 1 failed test, 2 failed assertions, 22 filtered out | 0; 1 passed, 22 filtered out |
| `g6d` | Change the shared run-id suffix length from 4 to 5 | `run validator reads the id home`; `file store reads the id home` | 1; 1 failed test, 2 failed assertions, 6 filtered out | 0; 1 passed, 6 filtered out |
| `g6e` | Collect text bindings from `steps.slice(0, 0)` | `toolset recorder reads taken names`; `page recorder reads taken names` | 1; 1 failed test, 2 failed assertions, 22 filtered out | 0; 1 passed, 22 filtered out |

The navigation test also failed before the repair with the same focused command: `npx vitest run --config vite.config.ts --project src:core tests/src/core/recorders/BrowserCodegen.test.ts -t 'keeps an edit open across child'` (exit 1; 1 failed, 15 filtered out). Before the locator change, `npx tsc --noEmit --project tsconfig.json` failed the required-options assertion with exit 2 and 1 diagnostic. The restored mutation runs establish the corresponding green results.

## Validation

The final commands, full argument arrays, exits, and durations are recorded in `tmp/codex/g6-validation/results.json`; full output is in the corresponding files under `tmp/codex/g6-validation/`. Each command uses the worktree's `env -C` prefix. The controller exits 1 because the supplemental runs fail; it is not reported as an all-green gate.

| Command | Exit | Measured result |
| --- | --- | --- |
| `npx oxfmt --check <touched files>` | 0 | 15 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings <touched TypeScript files>` | 0 | 14 files; no diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript projects; no diagnostics |
| `npm run test:src:core` | 0 | 50 files; 1059 passed |
| `npm run test:policy` | 0 | 1 file; 114 passed, 1 pre-existing conditional skip |
| `npm run test:guides` | 0 | 1 file; 248 passed |
| `npx vitest run --config vite.config.ts --project src:core --project src:server tests/src/core/helpers.test.ts tests/src/core/recorders/BrowserCodegen.test.ts tests/src/core/recorders/BrowserRecorder.test.ts tests/src/server/stores/FileBrowserStore.test.ts` | 0 | 4 files; 162 passed |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserPage.test.ts` | 0 | 1 file; 165 passed |
| `npm run test:src:server` (supplemental) | 1 | 6 files passed, 5 failed; 161 tests passed, 64 failed |
| `npm run test:setup` (supplemental) | 1 | 3 files passed, 2 failed; 136 tests passed, 23 failed; 1 unhandled error |
| `git diff --check` | 0 | No whitespace errors |

The policy skip is the existing conditional terminology-file check at `tests/policy.test.ts:718`. No skip was added. Service callers were typechecked; live-service tests were not run.

## Scope notes and deviations

The following notes bound the result.

- **Permitted test scope expansion:** `tests/service/journey.test.ts`, `tests/service/toolset.test.ts`, and `tests/src/core/BrowserPage.test.ts` are tests or fixtures of the changed APIs. The service callers pass explicit ids; the page recorder fixtures answer `Page.getFrameTree`. The initial full core run had 3 fixture timeouts and 1056 passes before these replies were added. Its final run is green. No file serving another writing unit was changed.
- **Guide parity:** The extracted public helper needs a guide example as well as a row. An initial guide run reported 1 missing-example failure and 247 passes; the added invocation closes it. Both functions remain in `helpers.ts`, as the amended ruling requires; no function-domain registration or scaffold-owned file was changed.
- **Supplemental host limits:** The server log reports `listen EPERM` on `127.0.0.1`, a browser child exiting with code 12 before readiness, and `spawnSync ... EINVAL` for the uid/gid permission fixture. The setup log reports loopback `EPERM`, consequent cleanup assertion failures, and timeouts, including the built CLI child fixture. Those suites remain unverified in this environment. Their implementation and fixtures were not weakened to make them pass.
- **Instrument availability:** No callable `probe.prove` tool is registered in this session. No receipt was produced. The brief's explicit source mutations and compiler assertion provide the reported controls; no harness registration outside the writable workspace was attempted.
- **Mutation runner:** Synchronous child capture returned `spawnSync env EPERM` with empty output. That attempt supplies no mutation evidence. The file-backed asynchronous runner completed the controls and restoration checks; its logs are the evidence table's sources.
- **Initial command prefix:** The bootstrap commands that first read the brief ran from the correct worktree without `env -C`. Subsequent shell commands used the required prefix.

No subagent was spawned. No commit, stash, reset, checkout, or index-wide mutation was issued. The writing unit returns the implementation and evidence for the campaign's acceptance decision.
