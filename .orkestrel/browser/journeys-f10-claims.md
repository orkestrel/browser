# F10 claims

The prescribed repairs are implemented. The required validation commands pass. Each prescribed mutation fails its named regression test, and the mutations are restored. No commit or index mutation was made.

## Changes and claims

1. **Create-only writes preserve an existing journey.** `src/core/types.ts:2068` documents `expected: 0` as requiring absence, including after deletion. `src/core/stores/MemoryBrowserJourneyStore.ts:37` and `src/server/stores/FileBrowserJourneyStore.ts:78` compare an absent stored revision as zero. The file comparison remains inside the exclusive lock. Revision counters survive deletion. `tests/setup.ts:3222` proves initial creation, rejection without replacement, recreation at the next revision, and rejection of an older positive revision over both twins.

2. **Save refuses an intervening writer.** `src/core/BrowserJourneyToolset.ts:207` passes zero; `src/core/BrowserJourneyToolset.ts:210` maps `BROWSER_JOURNEY_STALE` to `A journey named "NAME" is saved; call journeys, or record another name.` `tests/setupServer.ts:1432` records through one file store, saves the name through a second store, then proves the tool's save refuses and preserves the second store's revision and journey. `tests/src/core/BrowserJourneyToolset.test.ts:125` proves the same refusal over the memory store. Mutation f10a proves the file-store regression detects the missing expected revision.

3. **A dead holder's lock is reclaimed with one acquisition retry.** `src/server/stores/FileBrowserStore.ts:175` bounds acquisition to the initial attempt and one retry. It reads a positive safe-integer PID, checks that process with signal zero, and removes the lock only when the check reports `ESRCH`. It writes its own PID before executing the mutation and releases the lock in `finally`. A live or unknown holder refuses without waiting. `tests/setupServer.ts:1493` starts a real child using the real lock implementation, observes its held-lock notification, verifies live refusal and the PID bytes, kills and reaps the child, and proves the parent's next `set` succeeds and removes its lock. Mutation f10b proves the dead-holder removal is necessary.

4. **Non-journey names consume neither faults nor journey pages.** `src/server/stores/FileBrowserJourneyStore.ts:134` skips names outside `BROWSER_JOURNEY_NAME_PATTERN` before reading them. `tests/setupServer.ts:1468` places `.profiles` and `Not-a-journey` beside journeys, uses a cap of one, and proves both pages have no faults, contain every journey, and report correct truncation. Existing malformed-journey tests still report faults. Mutation f10c proves the skip is necessary.

5. **Store errors supply clauses and codes; the tool supplies directives.** Both stale errors say `Journey NAME changed since you read it`, at `src/core/stores/MemoryBrowserJourneyStore.ts:39` and `src/server/stores/FileBrowserJourneyStore.ts:80`. The shared case at `tests/setup.ts:3222` pins their equality. The locked error at `src/server/stores/FileBrowserStore.ts:205` says `Journey is locked: PATH`, pinned by the live-child case. Existing save and edit refusal tests at `tests/src/core/BrowserJourneyToolset.test.ts:232` and `tests/src/core/BrowserJourneyToolset.test.ts:539` pass with their tool sentences unchanged.

6. **Shared filesystem methods use verbs with updated consumers.** `src/server/stores/FileBrowserStore.ts:39` uses `validateName`; line 45 uses `validateId`; line 51 uses `resolvePath`; line 92 uses `createDirectory`; line 308 uses `translateError`. These names distinguish validation, path resolution, directory creation, and error translation. Call sites change in the journey store, run store, and `tests/src/server/stores/FileBrowserStore.test.ts:14`. Type checking passes without compatibility aliases.

## Mutation evidence

Each command starts with `env -C /home/user/browser/tmp/worktrees/f10`. The shared mutation command is `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserJourneyStore.test.ts -t PATTERN`.

| Mutation | Breaking edit                           | PATTERN                                  | Exit | Observed result                                                              | Artifact                                  |
| -------- | --------------------------------------- | ---------------------------------------- | ---- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| f10a     | Save passes `undefined` instead of zero | `saved the name between record and save` | 1    | 1 failed, 21 filtered; save succeeds instead of refusing                     | `tmp/codex/f10-mutations/f10a-direct.log` |
| f10b     | Drop dead-holder lock removal           | `dead holder lock`                       | 1    | 1 failed, 21 filtered; parent's post-exit set throws LOCKED                  | `tmp/codex/f10-mutations/f10b-direct.log` |
| f10c     | Drop the non-journey-name skip          | `skips non-journey`                      | 1    | 1 failed, 21 filtered; listing reports faults for both unrelated directories | `tmp/codex/f10-mutations/f10c-direct.log` |

Original and mutated source snapshots and the apply/restore instrument remain under `tmp/codex/f10-mutations/`. The final store-suite run after restoration passes all mutation targets.

The initial focused regression command was `env -C /home/user/browser/tmp/worktrees/f10 npx vitest run --config vite.config.ts --project src:server --project src:core tests/src/server/stores/FileBrowserJourneyStore.test.ts tests/src/core/stores/MemoryBrowserJourneyStore.test.ts tests/src/core/BrowserJourneyToolset.test.ts -t 'expected zero|saved the name between record and save|recorded name was saved|skips non-journey|dead holder lock'`. It exited 1 with 6 failed and 47 filtered. Five failures reproduced product defects; the child case first failed an IPC tuple assertion, which was corrected to inspect the message argument. The same command then exited 0 with 6 passed and 47 filtered. The f10b run supplies the independent red evidence for dead-holder recovery.

## Validation

All commands ran from the worktree through `env -C /home/user/browser/tmp/worktrees/f10`. Formatting and lint targeted exactly these files:

```text
src/server/stores/FileBrowserStore.ts
src/server/stores/FileBrowserJourneyStore.ts
src/server/stores/FileBrowserRunStore.ts
src/core/stores/MemoryBrowserJourneyStore.ts
src/core/BrowserJourneyToolset.ts
src/core/types.ts
tests/src/server/stores/FileBrowserStore.test.ts
tests/setupServer.ts
tests/src/core/BrowserJourneyToolset.test.ts
tests/setup.ts
```

The final readings are:

| Command                                                                               | Exit | Counts or result                                            |
| ------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `npx oxfmt --check` followed by the listed paths                                      | 0    | 10 files formatted correctly                                |
| `npx oxlint --config .oxlintrc.json --deny-warnings` followed by the listed paths     | 0    | No diagnostics                                              |
| `npm run check`                                                                       | 0    | Root, core, server, browser, and bin TypeScript checks pass |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 0    | 3 files; 41 passed, 1 skipped; 7.95 s                       |
| `npm run test:src:core`                                                               | 0    | 50 files; 1,039 passed; 44.44 s                             |
| `npm run test:policy`                                                                 | 0    | 1 file; 114 passed, 1 skipped; 9.77 s                       |
| `git diff --check`                                                                    | 0    | No whitespace errors                                        |

The store skip is the existing chmod permission case: root bypasses mode bits (`tests/setupServer.ts:1774`). The policy skip compares a locally authored writing-rule substitution table; this scaffold target does not author that file (`tests/policy.test.ts:718`). No added case is skipped.

## Scope notes, deviations, and limits

- **Call-site scope:** `src/server/stores/FileBrowserRunStore.ts` was not in the enumerated ownership list. Its edits are exclusively the call-site renames required by the prescription; leaving those calls unchanged would break the shared-method rename. No run-store behavior changes.
- **Memory-store scope:** The stale clause changes alongside its expected-zero comparison, as explicitly required by the prescription that the twins' stale sentences match. No other memory-store behavior changes.
- **Lock decisions:** Empty or invalid PID records, permission-denied PID checks, and other unknown liveness results remain refused. PID reuse is indistinguishable from a live holder under the prescribed PID-only format. The child proof covers a single recovering caller; it does not prove simultaneous dead-lock reclamation by multiple processes or a crash before the PID write completes.
- **Mutation harness:** Nested mutation runners produced no collected Vitest result. A separate spawn diagnostic reported `EPERM`. Their exit codes are not mutation evidence. Direct command-tool invocations produced the recorded failures and restored source afterward.
- **Instrument availability:** No `prove` MCP tool was exposed. The direct Vitest mutations provide the requested controls; no `prove` receipt is claimed. No harness configuration outside the writable roots was changed.
- **Command prefix:** The initial read that opened the brief ran in the correct worktree without the required `env -C` prefix, before that instruction had been read. Subsequent shell commands used the required prefix.
- **Acceptance boundary:** This is the sole writer's report. No subagent, independent acceptance, package release, guide revision, or commit was performed. The prescribed validation scope was run; broader campaign review remains with the Orchestrator. `src/server/constants.ts` needed no change.
