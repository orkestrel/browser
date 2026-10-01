# J5b claims: capture through the run store

The capture seam conforms to the unit brief. Replay requests screenshot bytes without a path and passes them to the store that opened the run slot. The inherited implementation is retained without source corrections. The required mutations fail their named assertions, and the restored implementation passes every prescribed validation command.

## Changes

The final diff is confined to the brief's owned files.

| Location | Change |
| --- | --- |
| `src/core/types.ts:2053` | Documents that the caller writes captures through the store, never through the slot's directory. |
| `src/core/types.ts:2073` | Defines and documents `BrowserRunStoreInterface.capture(slot, name, bytes, options)`, its returned name or `undefined`, and refusal with `BROWSER_JOURNEY_PATH`. |
| `src/core/BrowserReplay.ts:108` | Passes the opened slot into capture and records only the name returned by the store. |
| `src/core/BrowserReplay.ts:312` | Requests screenshot bytes with signal and timeout, without a path, then calls the configured store's capture method with the slot, step filename, bytes, and signal. |
| `src/core/stores/MemoryBrowserRunStore.ts:21` | Tracks opened slot identities in a weak set without retaining otherwise unreachable slots. |
| `src/core/stores/MemoryBrowserRunStore.ts:52` | Checks cancellation and slot ownership, then resolves `undefined` without persisting bytes. |
| `tests/setup.ts:1733` | Removes the unused element fixture writer option; the page construction at `tests/setup.ts:2141` receives no writer. |
| `tests/setup.ts:3207` | Adds shared capture cases for unopened slots, slots from another store, and an aborted signal. |
| `tests/src/core/BrowserReplay.test.ts:552` | Pins byte delivery, exact slot identity, signal forwarding, the returned capture name, and absence of a path requiring a page writer. |
| `tests/src/core/BrowserReplay.test.ts:598` | Proves memory captures omit the name and replay without a run store requests no screenshot. |
| `tests/src/core/BrowserReplay.test.ts:625` | Proves an untrusted view produces no capture even when the store supplies a directory. |
| `tests/src/core/BrowserReplay.test.ts:659` | Proves capture refusal retains and emits the executed step, stops the suffix, preserves the fault in the stored run, and releases the hold. |
| `tests/src/core/stores/MemoryBrowserRunStore.test.ts:11` | Proves capture of an opened memory slot resolves `undefined`. |

## Numbered claims

1. **The store owns capture persistence.** `src/core/BrowserReplay.ts:326` passes no path to the real page. The recording store boundary receives the screenshot bytes, the identical slot returned by open, the step filename, and the call's signal. Replay records the boundary's returned name, including when it differs from the requested filename. `tests/src/core/BrowserReplay.test.ts:552` proves these properties; mutation `j5b1` falsifies the no-path assertion.

2. **Memory capture refuses an unopened slot.** `src/core/stores/MemoryBrowserRunStore.ts:59` checks the issuing store's slot identity set and throws `BROWSER_JOURNEY_PATH` for an unopened or foreign slot. `tests/setup.ts:3207` and `tests/setup.ts:3213` prove both cases. An opened slot resolves `undefined` at `tests/src/core/stores/MemoryBrowserRunStore.test.ts:11`. An aborted call rejects at `tests/setup.ts:3221`. Mutation `j5b2` falsifies the unopened-slot assertion.

3. **Capture failure preserves execution evidence.** A store capture failure stops the run, retains the completed step without a capture name, emits that step, persists the fault, prevents the suffix, and releases the hold. `tests/src/core/BrowserReplay.test.ts:659` drives the real page and toolset with a throwing store boundary.

4. **Capture omission remains explicit.** A replay with no run store requests no screenshot. A memory store produces no recorded capture name. An untrusted view makes no capture call. A secret journey requests no screenshot and records neither captures nor output. These cases pass at `tests/src/core/BrowserReplay.test.ts:598`, `tests/src/core/BrowserReplay.test.ts:625`, and `tests/src/core/BrowserReplay.test.ts:760`.

## Mutation evidence

The controls run from `tmp/codex/j5b-mutations/run.ts`. Each selected test was collected, failed its behavioral assertion, and passed after restoration. The filtered counts come from the test-name selection, not added skip directives. Mutation source changes were restored before the final core and policy runs.

| Control | Breaking edit | Named assertion and observed failure | Exit and count | Evidence |
| --- | --- | --- | --- | --- |
| `j5b1` | Adds `path: \`${slot.directory}/${id}.png\`` to the screenshot call | `captures bytes through the opened store slot without passing a path to the page`: `the page receives no path requiring a file writer` fails because the real page reports `Browser page has no configured file writer` | 1; 1 failed, 25 filtered | `tmp/codex/j5b-mutations/j5b1-resume.log`, `.err`; 2,551 ms |
| `j5b2` | Disables the unopened-slot rejection with `&& false` | `refuses capture on a slot the store did not open`: the promise resolves `undefined` instead of rejecting with `BROWSER_JOURNEY_PATH` | 1; 1 failed, 9 filtered | `tmp/codex/j5b-mutations/j5b2-resume.log`, `.err`; 2,535 ms |
| Restored | Restores both original expressions | Both complete touched test files pass, including the named mutation assertions | 0; 36 passed across 2 files | `tmp/codex/j5b-mutations/restored-resume.log`, `.err`; 7,389 ms |

The mutation commands use `npx vitest run --config vite.config.ts --project src:core FILE -t NAME`, with the file and exact test name recorded in `j5b1.json` and `j5b2.json` under the mutation directory. The restored command omits `-t` and names both touched test files.

## Validation

The prescribed gates pass. Format and lint cover exactly `src/core/types.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/MemoryBrowserRunStore.ts`, `tests/src/core/BrowserReplay.test.ts`, `tests/src/core/stores/MemoryBrowserRunStore.test.ts`, and `tests/setup.ts`. Validation commands run through `env -C /home/user/browser/tmp/worktrees/j5b`. Launcher records include exit codes and durations; their complete output was read without filtering.

| Command | Exit | Measured result | Evidence |
| --- | --- | --- | --- |
| `npx oxfmt --check` over the touched files | 0 | 6 files formatted | Bare command output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched files | 0 | No diagnostics | Bare command output |
| `npm run check` | 0 | Root, core, server, and browser TypeScript checks pass | `tmp/codex/j5b-resume-check.log`, `.err`; 22,260 ms |
| Scoped Vitest run of replay and memory run store, before mutations | 0 | 36 passed across 2 files | `tmp/codex/j5b-resume-scoped.log`, `.err`; 13,004 ms |
| Scoped Vitest run after mutation restoration | 0 | 36 passed across 2 files | `tmp/codex/j5b-mutations/restored-resume.log`, `.err` |
| `npm run test:src:core` | 0 | 1,037 passed across 49 files; no skips | `tmp/codex/j5b-resume-core.log`, `.err`; 37,977 ms |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip, 115 collected | `tmp/codex/j5b-resume-policy.log`, `.err`; 4,745 ms |
| `npx vitest list --config vite.config.ts --project src:core --filesOnly` | 0 | 49 core test files, including both touched test files | Bare command output |
| `git diff --check --` followed by the touched files | 0 | No whitespace errors | Bare command output |
| Canonical `orkestrel-harden/scripts/discovery.js --projects src:core` | 2 | Census unavailable: its internal unscoped Vitest listing fails | `tmp/codex/j5b-resume-discovery.log`, `.err` |
| `node node_modules/vitest/vitest.mjs list --config vite.config.ts --json` | 1 | Collection fails with `listen EPERM: operation not permitted 127.0.0.1` | Bare diagnostic |

## Deviations, scope, and patches

- **Implementation disposition:** The inherited diff conforms to the brief and remains intact. No corrective source patch or unapplied patch is required. Temporary mutation edits are restored. No file outside the named ownership required a source or test change.
- **Shared registration:** Capture conformance cases stay in `describeBrowserRunStore` in `tests/setup.ts`, as the brief explicitly prescribes. This overrides the generic rule against test registration in setup modules.
- **Slot ownership:** The memory store uses object identity for the slot returned by open. A caller must return that slot to capture. Filename confinement and filesystem component checks belong to the file-store unit; this report claims neither their implementation nor their verification.
- **Capability reuse:** The installed `@orkestrel/test` 0.0.24 supplies the recorder used by the tests. The installed `@orkestrel/contract` 0.0.18 supplies existing guard behavior. Neither replaces the domain-specific slot identity check. No dependency change is needed.
- **Discovery limitation:** The canonical census always lists all projects, even with `--projects src:core`. This sandbox refuses the loopback listener that the broad listing reaches. The core-only listing succeeds and includes the touched proofs. No skip, todo, retry, or timeout declaration was added by this unit. The existing replay navigation timeout remains 15,000 ms; the existing policy skip is guarded by `isPolicyFile` at `tests/policy.test.ts:718`.
- **Formal instrument:** No `prove` tool is registered in the callable tool catalog. Registering one outside this checkout is outside the writable scope. No formal receipt is claimed; the prescribed mutations provide the negative controls.
- **Command prefix:** The user-requested opening status and diff commands, and the initial brief/contract read, used the assigned worktree but omitted `env -C`. All subsequent shell commands use the prescribed prefix.
- **Unit boundary:** No subagent was spawned. No commit, stash, reset, checkout, index-wide git mutation, scaffold-owned edit, or guide edit was made. Independent review, file-store integration, guide parity, and campaign acceptance remain with the orchestrator.
