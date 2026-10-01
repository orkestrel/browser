# F2 claims

The listing advances by readable entries and reports each faulty path once. The regression lives in the file-store suite, the stray test file is removed, and the addendum's policy, scoped server, and core gates pass. The `.profiles` failure remains assigned to F10.

## Changes

The unit contains these changes over its starting revision.

- `src/core/BrowserJourneyToolset.ts:236`: preserve the repair that deduplicates faults by path, renders their diagnostics, and advances the store offset by `page.entries.length` at line 248. Character slicing remains at line 253.
- `tests/src/core/BrowserJourneyToolset.test.ts:416`: preserve the replacement of the paging fake with the real memory store seeded out of order. The character-cut and offset cases remain at line 355; the surrogate-boundary case remains at line 386.
- `tests/src/server/stores/FileBrowserJourneyStore.test.ts:24`: move the integration case into its own `describe` block, with imports adjusted for this location. The block drives the journeys tool over `createFileBrowserJourneyStore` with limit 1, using `alpine`, malformed `broken`, `harbor`, and `zebra`. It reuses the journey fixture and scratch primitive used by the filesystem scenario at `tests/setupServer.ts:1735`. Cleanup remains at line 53. The pre-existing store cases are unchanged.
- Remove `tests/src/server/BrowserJourneyToolset.test.ts`, resolving its mirror violation. Update `tmp/codex/f2-mutations/f2a.ts` to target the moved test.

## Numbered claims

The following claims describe the repair and its evidence.

1. Every readable journey appears exactly once across store pages. The literal membership assertion at `tests/src/server/stores/FileBrowserJourneyStore.test.ts:42` requires `alpine`, `harbor`, and `zebra` in order. Mutation `f2a` fails only this regression; restoring the repair passes it.
2. Faults neither advance the readable-entry offset nor repeat in the assembled listing. The implementation at `src/core/BrowserJourneyToolset.ts:243` deduplicates by path, and line 248 advances by readable entries alone. The complete listing assertion at `tests/src/server/stores/FileBrowserJourneyStore.test.ts:47` requires the readable entries and exactly one malformed-file diagnostic.
3. The character limit and public `offset` semantics remain intact. The tests at `tests/src/core/BrowserJourneyToolset.test.ts:355` and line 386 cover continuation, an offset at the end, a negative offset, and a surrogate boundary using the real memory store. No listing test replaces `store.list`.
4. The regression is collected by the server project at a mirrored path. The scoped store run passes, and `npm run test:policy` passes the previously failing workspace-policy assertion at `tests/policy.test.ts:760`.

## Mutation

Run `env -C /home/user/browser/tmp/worktrees/f2 node tmp/codex/f2-mutations/f2a.ts`. The runner exits 0, applies the breaking increment, runs both touched test files, restores the source in `finally`, and runs the same files again. Each Vitest invocation has a 60 s cap and selects the `src:core` and `src:server` projects. The test paths are `tests/src/core/BrowserJourneyToolset.test.ts` and `tests/src/server/stores/FileBrowserJourneyStore.test.ts`.

The rerun at the moved path records these results.

| Control | Increment | Exit | Measured result | Evidence under `tmp/codex/f2-mutations/` |
| --- | --- | --- | --- | --- |
| `f2a` | `page.entries.length + page.faults.length` | 1 | 39 passed, 1 failed, 1 skipped; only the listing regression fails at line 42 | `f2a.diff`, `f2a.json`, `f2a-results.json` |
| Restored | `page.entries.length` | 0 | 40 passed, 1 skipped across 2 files | `restored.json`, `restored-results.json` |

The JSON reports carry the collected assertions and failure. The rerun's text logs are empty, so the JSON reports are the mutation evidence. `tmp/codex/f2-mutations/results.ts` prints the counts and failed assertion. The source is restored to the repaired increment.

## Validation

Commands run through `env -C /home/user/browser/tmp/worktrees/f2`. In this table, `<files>` means `src/core/BrowserJourneyToolset.ts tests/src/core/BrowserJourneyToolset.test.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts`. The addendum gates use the scaffold dispatch launcher with a 180 s cap; none reaches it. Their complete logs and exit records were read without filtering.

| Command | Exit | Counts and result | Evidence |
| --- | --- | --- | --- |
| `npx oxfmt --check <files>` | 0 | 3 files formatted correctly | Terminal output |
| `npx oxlint --config .oxlintrc.json --deny-warnings <files>` | 0 | No diagnostics | Terminal output |
| `npm run test:policy` | 0 | 1 file passed; 114 tests passed, 1 skipped | `tmp/codex/f2-addendum-policy.log`, `.err` |
| `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:server tests/src/server/stores` | 0 | 3 files passed; 38 tests passed, 1 skipped | `tmp/codex/f2-addendum-stores.log`, `.err` |
| `npm run test:src:core` | 0 | 50 files passed; 1,037 tests passed | `tmp/codex/f2-addendum-core.log`, `.err` |
| `git diff --check -- <files>` | 0 | No whitespace diagnostics | Terminal output |

The store and mutation skip is the existing chmod test at `tests/setupServer.ts:1625`: root bypasses mode bits. The policy skip is conditional on the term file at `tests/policy.test.ts:718`. The moved regression is collected and passes.

The whole unit also retains these pre-addendum results. These commands were not rerun for the test relocation.

| Command | Exit | Counts and result | Retained evidence |
| --- | --- | --- | --- |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript checks passed | `tmp/codex/f2-check.log`, `.err` |
| `npm run test:src:server` | 1 | 5 files failed, 7 passed; 64 tests failed, 151 passed, 1 skipped | `tmp/codex/f2-server.log`, `.err` |
| `npm run test:policy` before relocation | 1 | 1 file failed; 1 test failed, 113 passed, 1 skipped; mirror violation | `tmp/codex/f2-policy.log`, `.err` |

## Deviations and remaining findings

The addendum resolves the placement conflict and assigns the unrelated store finding as follows.

- **Scope adjustment, completed:** the addendum authorizes the listing block in `tests/src/server/stores/FileBrowserJourneyStore.test.ts` and removal of the stray file. No fixture change or additional source ownership was needed. The existing repair remains intact.
- **F10 owns `.profiles`:** the retained server failure is `BrowserMCPServer > forwards each call and its signal to the toolset's manager and returns its result`, at `tests/src/server/BrowserMCPServer.test.ts:277`. The assertion expects `BROWSER_JOURNEY_EMPTY_LISTING` from `pair.call(4, 'journeys', { what: 'every journey' })`; it receives a fault ending in `Refused journey name: .profiles`. Exact evidence is `tmp/codex/f2-server.err:87`. Per the addendum, F10 makes listing skip names outside `BROWSER_JOURNEY_NAME_PATTERN`; F2 changes no store or MCP behavior for this finding.
- **Prior full-server host failures remain recorded:** the retained server stderr groups 62 failures under `listen EPERM: operation not permitted 127.0.0.1`, reports a browser readiness failure with process exit 12, and reports the `.profiles` assertion separately. The addendum requests the scoped store run, which passes; no full-server pass is claimed.
- **No `prove` receipt:** no probe MCP tool is registered in this session, and registering it outside the writable roots is unavailable under the permission profile. The regression and mutation results are recorded without claiming a receipt.
- **Command-prefix deviation:** the initial brief and contract read used the correct working directory without the prescribed `env -C` prefix. Subsequent shell commands use the prefix.

The sole writer made no commit, stash, reset, checkout, index-wide git command, scaffold-owned edit, or change for another unit. The addendum's requested work is complete; campaign acceptance remains with the orchestrator.
