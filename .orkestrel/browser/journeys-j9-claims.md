# J9 file stores: claims and evidence

The file journey and run stores retain the implemented persistence, confinement, locking, captures, and whole-directory deletion. The second addendum moves the filesystem suite and its child-process script into `tests/setupServer.ts`. `tests/setup.ts` exactly matches `ccr-d15a48b1-yyyll6`, so J9 adds no Node or server import to the browser-shared setup. The scoped proofs, TypeScript check, format, lint, core project, and policy project pass. The full server project retains the sandbox failures named in the brief. Browser and setup host validation remains with the Orchestrator.

## Changes

The unit's implementation and proofs occupy these files. The second addendum changes only the setup modules and the filesystem suite's importing test; production source remains as supplied.

| Path:line | Change |
| --- | --- |
| `src/server/stores/FileBrowserJourneyStore.ts:26` | Persists journey snapshots, locks before comparing expected revisions, retains counters across deletion, and rolls back a replacement when its counter write fails. |
| `src/server/stores/FileBrowserRunStore.ts:25` | Allocates exclusive run directories, authenticates capture slots by identity, and reads/pages durable runs. Deletion at `src/server/stores/FileBrowserRunStore.ts:107` removes the checked run directory and captures, accepts absence, translates errors, and checks cancellation. |
| `src/server/stores/FileBrowserStore.ts:19` | Shares canonical-root confinement, component checks, error translation, atomic replacement, locking, paging, and exclusive directory allocation. |
| `src/server/constants.ts:214` | Declares filenames, the runs directory, the listing cap of 100, and reserved device names. |
| `src/server/factories.ts:69` | Creates the journey store; the run factory is at `src/server/factories.ts:82`. |
| `src/server/index.ts:9` | Exports the file stores and shared filesystem class. |
| `tests/setup.ts:3124` | Retains J5's host-independent journey suite; its run suite remains at `tests/setup.ts:3215`. Removes J9's filesystem descriptor, embedded child script, and child-process type import. The entire file equals the named branch baseline. |
| `tests/setupServer.ts:1` | Owns the moved child-process type import. Imports the existing fixture data from the host-independent setup and reuses its existing `createScratch` and `join` imports. |
| `tests/setupServer.ts:1405` | Owns `describeFileBrowserStores`, including the child script, server-only dynamic imports, and unchanged persistence, corruption, permission, process-race, revision, lock, failure, paging, and invalid-name assertions. |
| `tests/src/server/stores/FileBrowserJourneyStore.test.ts:10` | Imports the filesystem descriptor from `setupServer.js`; continues to import the unchanged shared journey suite from `setup.js`. Component-link and rollback proofs remain. |
| `tests/src/server/stores/FileBrowserRunStore.test.ts:13` | Runs J5's shared run suite with a fresh scratch directory per case. Tests capture confinement, paging/faults, and whole-run deletion. |
| `tests/src/server/stores/FileBrowserStore.test.ts:8` | Tests allocation collision, failed rename cleanup, temporary-component checks, canonical root, and cancellation under a held lock. |
| `tests/src/server/factories.test.ts:95` | Tests factory persistence. |

## Numbered claims

1. **Durability and error distinctions.** Reopening a path recovers journeys with their revisions and runs with their producer ids. Missing files return `undefined`; empty, truncated, malformed, and structurally invalid files reject with `BROWSER_JOURNEY_FILE`; unknown formats reject with `BROWSER_JOURNEY_FORMAT`. Errors name the file path. Evidence: `tests/setupServer.ts:1530` and `tests/setupServer.ts:1550`. The permission proof at `tests/setupServer.ts:1602` skips because this process runs as root and bypasses mode bits. Mutation j9a retains its preceding corrupt-file failure evidence.

2. **Stale writes and exclusive locking — design claim 9's revision portion.** Journey mutations acquire `journey.lock` with `wx` before reading and comparing the saved revision. A held lock refuses without waiting or polling, including when the supplied revision is stale. Concurrent instances and child processes admit one writer. Deletion preserves the revision counter; recreation advances it and refuses an earlier writer. Evidence: `tests/setupServer.ts:1407`, `tests/setupServer.ts:1639`, `tests/setupServer.ts:1663`, and `tests/setup.ts:3124`. The children load real source, communicate through IPC, and open no listening socket. Mutations j9b and j9c retain their preceding assertion failures.

3. **Failed writes preserve the saved revision.** A sibling temporary file is created exclusively, closed, and renamed. Failure removes an owned temporary file. If cancellation prevents the counter write after replacement, rollback restores the previous snapshot while holding the lock. Cleanup uses no aborted caller signal. Evidence: `tests/src/server/stores/FileBrowserStore.test.ts:39`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts:52`, and `tests/setupServer.ts:1686`.

4. **Path confinement — design claim 10.** Construction resolves the existing root through `realpath`. Derived targets stay inside it. Component checks include the root, journey directory, runs directory, run directory, data files, revision, lock, capture, and temporary target. Present links refuse with `BROWSER_JOURNEY_PATH`. Reserved and escaping names refuse before filesystem access. Evidence: `tests/src/server/stores/FileBrowserJourneyStore.test.ts:24`, `tests/src/server/stores/FileBrowserRunStore.test.ts:54`, `tests/src/server/stores/FileBrowserRunStore.test.ts:148`, `tests/src/server/stores/FileBrowserStore.test.ts:55`, `tests/src/server/stores/FileBrowserStore.test.ts:77`, and `tests/setupServer.ts:1735`. Mutation j9d retains its failure when the runs-component check is disabled. The design excludes hostile replacement raced between a check and its use.

5. **Run allocation and captures — design claim 11.** `open` uses J2's `generateBrowserRunId` and the exclusive allocator. The collision proof supplies the same first candidate to separate allocators and observes distinct directories without replacing the id helper or clock. `set` refuses directories this instance did not allocate. `capture` accepts only the original slot and an `sN.png` name, writes inside that allocation, refuses missing or linked directories, and creates no directory. Evidence: `tests/src/server/stores/FileBrowserStore.test.ts:9`, `tests/src/server/stores/FileBrowserRunStore.test.ts:20`, `tests/src/server/stores/FileBrowserRunStore.test.ts:42`, and `tests/setup.ts:3215`. Mutation j9e retains its failure when capture recreates a missing directory.

6. **Paging and cancellation.** Journey names and run ids sort lexically. Offset counts readable entries; the requested limit can lower but cannot exceed the configured cap. An extra readable entry determines truncation. Faults name unreadable entries encountered while filling the page, and listing continues. Invalid pagination refuses. Calls check cancellation between filesystem operations; lock and temporary-file cleanup completes independently. Evidence: `tests/setupServer.ts:1711`, `tests/src/server/stores/FileBrowserRunStore.test.ts:148`, `tests/src/server/stores/FileBrowserStore.test.ts:93`, and the unchanged shared suites.

7. **Whole-run deletion — first addendum.** Deletion removes the entire run directory after checking the path through `run.json`, including a capture-only allocation without a run file. Reopened stores can delete saved runs; sibling captures survive; repeated deletion and deletion beneath a missing journey are no-ops. Capture into a deleted directory refuses. Evidence: `src/server/stores/FileBrowserRunStore.ts:107` and `tests/src/server/stores/FileBrowserRunStore.test.ts:80`, `tests/src/server/stores/FileBrowserRunStore.test.ts:109`, and `tests/src/server/stores/FileBrowserRunStore.test.ts:123`. The preceding addendum's focused deletion command failed with 2 failed, 2 passed, and 11 filtered before the repair, then passed with 4 passed and 11 filtered. Mutation j9f retains its directory-absence failure. These assertions also pass in the second addendum's scoped run.

8. **Setup placement — second addendum.** All J9 filesystem-suite Node/server imports and the child-process script reside in `tests/setupServer.ts:1405`, with the child-process type import at `tests/setupServer.ts:1`. J5's shared suite bodies remain unchanged. `git diff --exit-code ccr-d15a48b1-yyyll6 -- tests/setup.ts` exits 0 with empty output. The original worktree HEAD differs from that baseline and makes the comparison control exit 1. This proves the requested source placement; it does not claim a Chromium build or browser execution. The moved suite runs successfully through its server test consumer.

## Mutation and placement controls

Mutations j9a–j9f are retained evidence from the preceding unit and first addendum, not rerun measurements. Their result artifacts remain under `tmp/codex/j9-mutations/`: `results.json`, `run-2.ts`, `delete-result.json`, and `delete.ts`, with original/mutated source snapshots. The preceding report supplies the assertion counts. The second addendum reruns the real filesystem assertions after relocation.

| Control | Breaking edit | Named assertion and recorded failure | Exit and measured count |
| --- | --- | --- | --- |
| j9a | Returns absence from the corrupt journey-file catch | `refuses corrupt files rather than returning absence`: resolved undefined instead of rejecting | 1; 1 failed, 17 filtered |
| j9b | Moves expected-revision comparison outside the lock | `refuses a held lock before reading the expected revision`: STALE instead of LOCKED | 1; 1 failed, 17 filtered |
| j9c | Writes zero to the counter during deletion | `counts revisions across delete and recreate and refuses a stale writer`: revision 1 instead of 2 | 1; 1 failed, 17 filtered |
| j9d | Omits link/non-directory refusal at the runs component | `refuses links at every capture component`: capture resolved s1.png | 1; 1 failed, 11 filtered |
| j9e | Creates a missing capture directory | `refuses a missing capture directory without recreating it`: capture resolved s1.png | 1; 1 failed, 11 filtered |
| j9f | Removes run.json instead of the containing directory | `deletes the whole run directory and its captures while preserving sibling runs`: lstat resolved instead of ENOENT | 1; 1 failed, 14 filtered |

The placement comparison has an immutable negative control: `git diff --quiet ccr-d15a48b1-yyyll6 HEAD -- tests/setup.ts` exits 1 on the supplied HEAD `33fb6a2b7a7d076449222be8fb59f7c70b68b519`. The same file compared from the repaired working tree to baseline `ee4c500ad62c8602e3029a7f88a29cec93b9cb74` exits 0. This is a text comparison, not a runtime mutation receipt. No `prove` tool is registered; no formal receipt is claimed. The host's browser build rejection in the second addendum is supplied evidence; the Orchestrator owns its host rerun.

## Validation

The second addendum ran these commands through `env -C /home/user/browser/tmp/worktrees/j9`. Logs and launcher exit records are under `tmp/codex/`. Test filters appear as skips in Vitest totals.

| Command | Exit | Measured result | Evidence |
| --- | --- | --- | --- |
| `npx oxfmt --check tests/setup.ts tests/setupServer.ts tests/src/server/stores` | 0 | 5 files formatted | Bare output |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/setup.ts tests/setupServer.ts tests/src/server/stores` | 0 | No diagnostics | Bare output |
| `npm run check` | 0 | Root, core, server, and browser TypeScript projects pass | `j9-second-check-final.log`, `.err`; 25,169 ms launcher duration |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores tests/src/server/factories.test.ts -t 'FileBrowser\|file store'` | 0 | 39 passed; 1 root permission skip; 5 unrelated factory cases filtered; 45 collected across 4 files | `j9-second-scoped-final.log`, `.err`; 6.63 s Vitest duration |
| `npm run test:src:server` | 1 | 138 passed, 63 failed, 1 skipped; 202 collected across 10 files | `j9-second-server.log`, `.err`; 8.44 s |
| `npm run test:src:core` | 0 | 1,027 passed across 50 files; no skips | `j9-second-core.log`, `.err`; 39.09 s |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip; 115 collected | `j9-second-policy.log`, `.err`; 7.52 s |
| `git diff --exit-code ccr-d15a48b1-yyyll6 -- tests/setup.ts` | 0 | Empty diff; no J9 Node/server import remains | Bare output |
| `git diff --quiet ccr-d15a48b1-yyyll6 HEAD -- tests/setup.ts` | 1, expected | Original-placement comparison control detects the difference | Bare exit |
| `git diff --check -- tests/setup.ts tests/setupServer.ts tests/src/server/stores` | 0 | No whitespace errors | Bare output |

The full server run groups 62 failures under `listen EPERM: operation not permitted 127.0.0.1`. The remaining failure is `Browser launch readiness from standard error > passes port 0 when no port is given and connects to the port the line names`, whose browser process exits with code 12. These failures match the sandbox conditions in the brief; no store assertion fails. The full server project needs a host that permits its listeners and browser launch. The permission case needs a non-root process on a host enforcing mode bits. The process race passes in this sandbox.

## Scope notes, deviations, and patches

- **Second-addendum scope:** The only tracked edits are `tests/setup.ts`, `tests/setupServer.ts`, and `tests/src/server/stores/FileBrowserJourneyStore.test.ts`. The report is rewritten here. The filesystem descriptor and child script move together. Existing server-setup imports supply `createScratch` and `join`; removing the moved duplicates resolves the initial lint run's 15 shadow warnings. The final lint run exits 0.
- **Consumer finding:** The brief refers to pointing the three store tests at the moved function. Inspection finds only `FileBrowserJourneyStore.test.ts` imports or calls `describeFileBrowserStores`. That import changes. `FileBrowserRunStore.test.ts` and `FileBrowserStore.test.ts` import host-independent fixtures/shared suites from `setup.ts` and keep those correct imports. No compatibility re-export or duplicate registration is added. All store tests run in the scoped validation.
- **Shared setup ruling:** The second addendum supersedes the original placement instruction. The filesystem descriptor remains the expressly assigned shared test registration; J5's suites and other server helpers are unchanged. The setup module may import host-independent fixtures, while the browser-shared module imports no server setup.
- **Original scope extension:** `FileBrowserStore.ts`, its mirrored test, and its barrel export are the shared class/test/export needed by the named twins and permitted by the original brief.
- **On-disk choices:** The journey file contains the journey/revision envelope, giving readers one matching snapshot from one renamed file. The separate revision file retains the counter across deletion. Constructors require an existing root. Run deletion removes the checked directory and captures under the first addendum.
- **Collision seam:** Forced candidates enter the shared allocator; production open still uses the real id helper. The proof observes exclusive directory creation across separate allocator instances.
- **Retained corrections:** The original unit repaired missing journey, run, and nested format fields incorrectly reported as FORMAT instead of FILE. Its targeted corruption case failed before the guards and passed afterward. Optional-revision narrowing was repaired during that unit. The second addendum makes no production change.
- **Retained instrumentation deviations:** The original synchronous mutation launcher reported spawnSync EPERM without test output. The first addendum's initial piped child also supplied no test output. Neither is evidence. The replacement asynchronous launchers using file descriptors produced the retained controls and restored their source.
- **Command and ownership discipline:** Status was checked first and was clean. This pass is the sole writer and starts no subagent. No commit, stash, reset, checkout, index-wide git mutation, dependency change, scaffold-owned edit, public type edit, or guide edit is made. The original report recorded an opening read without its required env prefix; that historical deviation does not affect the placement repair.
- **Host follow-up and acceptance:** Browser and setup projects are left to the Orchestrator's host rerun as the second addendum directs. Guide parity and full host acceptance remain with the Orchestrator. No unowned integration patch is required, and this writer does not accept its own work.
