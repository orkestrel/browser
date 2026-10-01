# G1 claims: directory lock

The directory lock and its regression tests are implemented. The required mutations fail their named assertions. Formatting, lint, TypeScript, policy, and guide gates pass. The unfiltered server gate fails on sandbox-dependent tests; this report does not claim full acceptance.

## Changes and claims

1. **Acquisition publishes an empty `PID-TOKEN` entry inside an exclusively created `journey.lock/` directory.** The mutation runs only after a directory read identifies that entry as the sole entry. This also refuses a delayed creator whose empty directory was removed and replaced by another holder before publication. Implementation: `src/server/stores/FileBrowserStore.ts:181` and `src/server/stores/FileBrowserStore.ts:225`. Test: `tests/src/server/stores/FileBrowserStore.test.ts:20`. Mutation `g1c` removes the sole-entry condition and makes that test fail.

2. **Recoverers unlink only the exact dead holder entry they observed.** Only `ESRCH` establishes death. An absent entry makes the recoverer retry; directory removal is nonrecursive and accepts `ENOENT` and `ENOTEMPTY`. Implementation: `src/server/stores/FileBrowserStore.ts:193`, `src/server/stores/FileBrowserStore.ts:208`, and `src/server/stores/FileBrowserStore.ts:376`. The real child-process fixture pauses after each process reads the same dead entry, before either can unlink it (`tests/setupServer.ts:2397`). The parent releases the first recoverer, keeps its critical section held, then releases the second. Exactly the first enters; the second reports `BROWSER_JOURNEY_LOCKED`, and the winner's entry remains (`tests/src/server/stores/suite.ts:167`). Mutation `g1a` fails that exclusion assertion.

3. **A live or indeterminate holder is refused without removal.** An unparseable name, multiple entries, or a liveness failure other than `ESRCH` refuses with `BROWSER_JOURNEY_LOCKED`. Implementation: `src/server/stores/FileBrowserStore.ts:193` and `src/server/stores/FileBrowserStore.ts:335`. Tests plant this process's live PID (`tests/src/server/stores/FileBrowserStore.test.ts:137`), malformed and multiple entries (`tests/src/server/stores/FileBrowserStore.test.ts:62`), and a PID that makes the native liveness check inconclusive (`tests/src/server/stores/FileBrowserStore.test.ts:82`). Each test checks preservation of the planted entries.

4. **An empty crash directory is reclaimable, and retrying acquisition is bounded.** `BROWSER_JOURNEY_LOCK_ATTEMPTS` is 8 (`src/server/constants.ts:220`); exhaustion raises `BROWSER_JOURNEY_LOCKED`. Tests cover a planted empty directory (`tests/src/server/stores/FileBrowserStore.test.ts:125`) and an external actor removing every acquisition directory before its entry can be created, producing exactly 8 attempts (`tests/src/server/stores/FileBrowserStore.test.ts:42`). The former live-child/dead-child recovery test uses the directory layout and still passes (`tests/src/server/stores/suite.ts:89`).

5. **Release preserves a replacement holder.** Release unlinks the releasing holder's exact entry and then removes only an empty directory (`src/server/stores/FileBrowserStore.ts:230`). The test removes the original entry during the critical section, plants another holder's entry, and checks that release preserves it (`tests/src/server/stores/FileBrowserStore.test.ts:153`). Mutation `g1b` fails that assertion.

6. **Lock removal failures are classified, and lock paths receive component checks.** Both lock-removal methods classify `ENOENT` and `ENOTEMPTY` as protocol signals and translate every other native removal failure to `BROWSER_JOURNEY_ACCESS` with the failed path (`src/server/stores/FileBrowserStore.ts:358`, `src/server/stores/FileBrowserStore.ts:376`). A real directory substituted for the releasing entry proves the unlink failure's code, message, and context path (`tests/src/server/stores/FileBrowserStore.test.ts:98`). Acquisition checks the lock directory and entry paths (`src/server/stores/FileBrowserStore.ts:186`, `src/server/stores/FileBrowserStore.ts:215`); the existing component-link test plants a directory link at `journey.lock` (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:62`).

7. **The earlier store semantics remain covered.** The passing focused filesystem run includes ordinary competing-process revision selection (`tests/src/server/stores/suite.ts:210`), held-lock precedence over expected-revision comparison (`tests/src/server/stores/suite.ts:513`), deletion/recreation (`tests/src/server/stores/suite.ts:489`), failed-write cleanup (`tests/src/server/stores/suite.ts:539`), rollback on cancellation (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:92`), and lock release on cancellation (`tests/src/server/stores/FileBrowserStore.test.ts:267`). The permission-spawn test remains unproved in this sandbox.

The guide documents the exported attempt limit at `guides/browser.md:1221`, the acquisition/reclaim/release behavior at `guides/browser.md:2092`, and the directory layout at `guides/browser.md:2973`. `FileBrowserJourneyStore` retains its lock calls and updates their description (`src/server/stores/FileBrowserJourneyStore.ts:20`). `FileBrowserRunStore` has no journey lock call to change; no options or public type changes were needed.

## Mutation evidence

The mutations and command record live under `tmp/codex/g1-mutations/`: `run.ts` applies/restores a named mutation, and `results.md` records the commands and observations. All mutations were restored before final validation. These are process/filesystem runtime proofs; no `prove` receipt is claimed.

| Mutation | Breaking edit | Named failing assertion | Exit and count |
| --- | --- | --- | --- |
| `g1a` | Replace exact dead-entry unlink with recursive removal of the lock directory | `the second recoverer cannot enter while the first holds` at `tests/src/server/stores/suite.ts:196`: expected `BROWSER_JOURNEY_LOCKED`, received `entered` | 1; 1 failed, 24 filtered |
| `g1b` | Replace release's exact-entry unlink and empty-directory removal with recursive directory removal | `release preserves the replacement holder` at `tests/src/server/stores/FileBrowserStore.test.ts:165`: expected a directory listing, received `ENOENT` | 1; 1 failed, 13 filtered |
| `g1c` | Remove the sole-entry ownership condition after publication | Expected `BROWSER_JOURNEY_LOCKED` at `tests/src/server/stores/FileBrowserStore.test.ts:33`; the action returned `entered` | 1; 1 failed, 13 filtered |

The restored filesystem run passes all these tests. The initial defect run of `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserStore.test.ts` against the file-lock implementation exited 1 with 3 failed and 6 passed: empty-directory recovery, live-PID directory refusal, and replacement release. The same command after implementation and expanded coverage exits 0 with 14 passed.

## Validation

Every command ran through `env -C /home/user/browser/tmp/worktrees/g1` on 2026-10-01. `TOUCHED` in the table denotes this exact population:

```text
src/server/stores/FileBrowserStore.ts
src/server/stores/FileBrowserJourneyStore.ts
src/server/constants.ts
tests/src/server/stores/FileBrowserStore.test.ts
tests/src/server/stores/FileBrowserJourneyStore.test.ts
tests/src/server/stores/suite.ts
tests/setupServer.ts
tests/distribution.test.ts
guides/browser.md
```

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check TOUCHED` | 0 | 9 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings TOUCHED` | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript checks pass |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserStore.test.ts` | 0 | 14 passed |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server` | 1 | 169 passed, 64 failed; 6 files passed, 5 failed; 233 tests collected |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores -t '^(?!.*reports chmod 000)'` | 0 | 55 passed, 1 filtered; 3 files passed |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip |
| `npm run test:guides` | 0 | 248 passed |
| `git diff --check` | 0 | No whitespace errors |

The full server command ran through the scaffold dispatch launcher with a 180-second cap; it completed uncapped in 15084 ms. Its bare outputs are `tmp/codex/g1-mutations/server.log` and `tmp/codex/g1-mutations/server.err`. The failure groups are 62 loopback tests reporting `listen EPERM: operation not permitted 127.0.0.1`, one browser fixture exiting with code 12 (its listen-error exit at `tests/setupServer.ts:845`), and the existing non-root permission child reporting `spawnSync /opt/node22/bin/node EINVAL` at `tests/src/server/stores/suite.ts:470`. No test was changed to skip these failures. The focused filter is supplementary evidence, not a replacement for the failed full gate.

## Scope notes and deviations

- The acquisition implementation adds a sole-entry check after publication. Exclusive creation of a uniquely named entry alone cannot exclude a creator delayed across removal and replacement of its empty directory. This check stays within the directory protocol, is documented, and has the `g1c` breaking control. No alternate lock mechanism or option was introduced.
- `tests/distribution.test.ts:1424` is an additional owned test under the brief's test/fixture exception. Its stale-edit barrier used the retired lock file as a FIFO. The barrier now parks the initial journey snapshot read, advances the restored snapshot through the real store, then supplies the earlier snapshot to the parked read. This retains the stale-revision assertion without relying on a file lock. TypeScript and lint pass; the packed registry/browser test was not executed in this sandbox.
- `guides/browser.md` is a documentation scope extension for the prescribed constant's export and lock layout. The guide gate reported the missing `BROWSER_JOURNEY_LOCK_ATTEMPTS` export before this update; its final run passes. No other unit's behavior or files were changed.
- `tests/src/server/constants.test.ts` does not exist. The retry constant is tested through real acquisition exhaustion in the existing `FileBrowserStore.test.ts`, rather than creating a constants-only test.
- The sandbox prevents the full server gate from passing as detailed in the validation table. Permission behavior and the packed stale-edit test require an unrestricted verification host. No permission bypass or test weakening was attempted.
- A nested `spawnSync` mutation runner could not launch Vitest (`EPERM`). That run is excluded from mutation evidence. The direct harness mutation commands produced the named assertion failures in the table.
- The authorized stopped-attempt probe `tmp/codex/g1-mutations/rename.test.ts` was removed. This report replaces the stopped attempt's report. No commit, stash, reset, checkout, index mutation, or sub-agent dispatch was performed.
