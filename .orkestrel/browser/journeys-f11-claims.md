# F11 claims

The prescribed refactor is implemented. Core, policy, guides, formatting, lint, and typechecking pass. The server store project has an unresolved host failure: spawning the permission-test child with uid/gid 65534 returns `EINVAL`. No commit or index mutation was made.

## Numbered claims

1. `isBrowserSecretBinding` is the shared total guard for a declared secret on `type.text` (`src/core/validators.ts:59`). It uses the installed `@orkestrel/contract` guards and `attempt`; the browser-specific action/binding/declaration relationship remains local. Replay (`src/core/BrowserReplay.ts:249`), compilation (`src/core/compilers.ts:540`), listing (`src/core/helpers.ts:2617`), journey validation (`src/core/helpers.ts:2942`), run validation (`src/core/helpers.ts:3101`), and recorded journey construction (`src/core/helpers.ts:3130`) use it. Off-shape and hostile property reads are covered at `tests/src/core/validators.test.ts:22`.
2. `buildBrowserJourney` owns the recorded steps, derives secret declarations and the next id, and validates the result (`src/core/helpers.ts:3120`). Both recorders use it (`src/core/recorders/BrowserRecorder.ts:76`, `src/core/recorders/BrowserCodegen.ts:133`). Its direct proof covers ownership, secret declarations, empty recordings, invalid names, and invalid ids (`tests/src/core/helpers.test.ts:1328`). Existing recorder tests remain green.
3. Throwing assertions reside in `helpers.ts`: parameter (`src/core/helpers.ts:2766`), step (`src/core/helpers.ts:2793`), journey (`src/core/helpers.ts:2871`), edit (`src/core/helpers.ts:2958`), and run (`src/core/helpers.ts:3010`). `validators.ts` contains only total guards. Parser, compiler, replay, toolset, recorder, and store imports follow the move. Public assertion names remain exported through the existing helper barrel.
4. Store registration resides beside its callers: shared journey semantics at `tests/src/core/stores/suite.ts:10`, shared run semantics at `tests/src/core/stores/suite.ts:130`, and filesystem semantics at `tests/src/server/stores/suite.ts:19`. Fixture values and builders remain in setup (`tests/setup.ts:2963`, `tests/setup.ts:3227`). The move comparison confirms unchanged suite bodies after whitespace normalization and relocation of relative imports (`tmp/codex/f11-moves.json`). The setup modules have no Vitest imports or direct `describe`, `it`, or `expect` registrations. The unrelated `options.describe` CDP callback remains.
5. `BrowserHold` and `FileBrowserStore` are absent from their environment barrels and Surface tables and appear in the parity `INTERNAL` list (`tests/guides.test.ts:39`). Their direct tests import their implementation modules. Guide parity passes, including the extracted functions' Surface rows and examples (`guides/browser.md:470`, `guides/browser.md:597`).

## Mutation evidence

The runner is `tmp/codex/f11-mutations/f11a.ts`. It invokes `node node_modules/vitest/vitest.mjs run --config vite.config.ts --project src:core tests/src/core/validators.test.ts tests/src/core/BrowserReplay.test.ts -t 'refuses a secret bound to wait.text' --reporter verbose --reporter=json --outputFile=tmp/codex/f11-mutations/<stage>.json`. The JSON artifacts preserve collection, assertions, and failures; the companion logs preserve exit codes.

| Stage | Change | Exit | Measured result |
| --- | --- | ---: | --- |
| Baseline | Original shared guard | 0 | 2 passed, 60 excluded by the name filter |
| `f11a` | Replace `step['action'] !== 'type'` with `!['type', 'wait'].includes(String(step['action']))` | 1 | 2 failed, 60 excluded by the name filter |
| Restored | Restore the guard byte for byte | 0 | 2 passed, 60 excluded by the name filter |

The failures are assertion failures in `journey validators > refuses a secret bound to wait.text` (`tests/src/core/validators.test.ts:77`) and `BrowserReplay > refuses a secret bound to wait.text before taking a hold or writing a run` (`tests/src/core/BrowserReplay.test.ts:31`). The validator accepted the invalid journey; replay resolved a run instead of rejecting. Collection remained valid. See `tmp/codex/f11-mutations/f11a.json`, `tmp/codex/f11-mutations/restored.json`, and the restored digest in `tmp/codex/f11-mutations/results.json`.

## Validation

Commands ran through `env -C /home/user/browser/tmp/worktrees/f11`. The touched-file population is recorded in `tmp/codex/f11-files.json`; formatting covers 29 files and lint covers its TypeScript members. Journals and exit records are under `tmp/codex/f11-*.log` and `tmp/codex/f11-*.err`.

| Command | Exit | Count or outcome |
| --- | ---: | --- |
| `npx oxfmt --check <touched files>` | 0 | 29 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings <touched TypeScript files>` | 0 | No diagnostics |
| `npm run check` | 0 | Root and core/server/browser/bin projects pass |
| Focused core run: validators, helpers, replay, recorders, and stores | 0 | 7 files, 234 tests passed |
| `npm run test:src:core` | 0 | 50 files, 1055 tests passed |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 1 | 3 files; 45 passed, 1 failed; 46 tests collected |
| `npm run test:policy` | 0 | 114 passed, 1 existing conditional skip; 115 collected |
| `npm run test:guides` | 0 | 1 file, 248 tests passed; final journal `f11-guides-final.log` |
| `node tmp/codex/f11-moves.ts` | 0 | Both suite bodies match their originals; no setup registrations or Vitest imports |
| `git diff --check` | 0 | No whitespace errors |

The policy skip is the substitution-table comparison when the scaffold-owned rule file is absent locally (`tests/policy.test.ts:718`). The final guide run follows the missing-export and missing-example failures; no parity assertion was weakened.

## Scope notes and deviations

- Import-only scope additions under the brief's exception: `src/core/BrowserJourneyToolset.ts`, `src/core/stores/MemoryBrowserJourneyStore.ts`, `src/core/stores/MemoryBrowserRunStore.ts`, `src/server/stores/FileBrowserJourneyStore.ts`, and `src/server/stores/FileBrowserRunStore.ts`. The prescribed suite modules and direct class tests were updated with their callers.
- Guide scope extended beyond the class rows to the extracted guard and builder's Surface rows and examples. Without those additions, `npm run test:guides` failed its public-export and function-example assertions. Formatting also normalized padding in the existing `BrowserCodegenScript`, `hold`, and journey-store `set` rows. No guide assertion or public signature was suppressed.
- The guide's test-inventory prose still attributes store registration to setup files (`guides/browser.md:3479`, `guides/browser.md:3483`). Those prose descriptions are outside the brief's row scope and remain for integration to reconcile.
- The server failure is `file store filesystem contracts > reports chmod 000 permission errors from a non-root child with the denied path`, at `tests/src/server/stores/suite.ts:447`. The suite-body comparison proves its logic was preserved. `node tmp/codex/f11-host.ts` reproduced `spawnSync /opt/node22/bin/node EINVAL` using only `node --version` with uid/gid 65534 (`tmp/codex/f11-host.json`). A normal child returned version output and status 0, though this harness also attached an `EPERM` error object. The permission assertion remains intact; the server gate is not claimed green.
- No callable `prove` tool is registered in this session, and the sandbox does not authorize modifying harness configuration outside the worktree. No probe receipt is claimed. The explicit Vitest mutation supplies the requested negative control and named failures.
- Validation is this writing unit's local evidence, not independent acceptance. No subagent, commit, stash, reset, checkout, scaffold-owned edit, or dependency change was made.
