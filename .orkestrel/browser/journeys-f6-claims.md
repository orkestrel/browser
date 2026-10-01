# F6: pending holds reserve admission

`hold()` reserves admission before awaiting its queue turn. The required validation gates pass, and mutation `f6a` makes the regression fail by allowing the foreign click to execute.

## Changes and claims

The implementation and its proofs support these numbered claims.

1. A foreign action arriving after `hold()` is called is refused while that hold waits. `src/core/BrowserToolset.ts:203` stores the pending hold, `src/core/BrowserToolset.ts:373` sets it before acquiring the turn, and `src/core/BrowserToolset.ts:439` checks pending and held reservations through the same admission boundary. `tests/src/core/BrowserToolset.test.ts:327` calls a foreign `click` while an adopted `checkout` is pending and asserts `BROWSER_TOOLSET_BUSY`, the exact busy sentence, and no click input.
2. Actions admitted before the hold finish first. `src/core/BrowserToolset.ts:375` retains the existing queue acquisition. The regression at `tests/src/core/BrowserToolset.test.ts:327` asserts the successful checkout action precedes the hold event. The existing cancellation case at `tests/src/core/BrowserToolset.test.ts:371` also proves that a click admitted before a subsequent hold completes before that hold.
3. A pending hold that aborts or fails clears its own reservation. `src/core/BrowserToolset.ts:386` clears it in `finally`, including acquisition failures. At `tests/src/core/BrowserToolset.test.ts:371`, aborting the pending hold returns the abort reason; a subsequent foreign click succeeds, and another hold acquires after the admitted actions. Acquisition failures other than cancellation are covered by the same cleanup path, with no separate failure injection in this unit.
4. A successful acquisition transfers ownership to the held reservation before emitting `hold`. `src/core/BrowserToolset.ts:378` transfers the reservation, and `src/core/BrowserToolset.ts:379` clears the pending slot. Existing owner, observation, dialog, and destruction cases remain green in the touched-file run: 144 passed.
5. The public contract describes immediate admission reservation and cleanup at `src/core/types.ts:2803`. The shared fixture at `tests/setup.ts:2504` composes the real toolset, tool manager, and adopted tool with an explicitly controlled completion and the existing view boundary fixture. It reuses `@orkestrel/test` recorders.

## Mutation evidence

The regression command is `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts -t 'reserves admission while a hold waits for an earlier adopted action'`. Each run used the prefix `env -C /home/user/browser/tmp/worktrees/f6`.

| State | Control or change | Exit | Result |
| --- | --- | --- | --- |
| Before repair | Original reservation timing | 1 | 1 failed; 143 excluded by the name filter; foreign click returned its successful receipt |
| Repaired | Pending reservation set before queue acquisition | 0 | 1 passed; 143 excluded by the name filter |
| `f6a` | Remove `this.#waiting = hold`, leaving reservation creation until the queue turn | 1 | 1 failed; 143 excluded by the name filter; the same foreign click succeeded instead of returning the busy error |
| Restored | Restore the pending assignment | 0 | Full core suite: 1,038 passed, including the regression |

The mutation result is recorded in `tmp/codex/f6-mutations/f6a.log` and `tmp/codex/f6-mutations/f6a.json`; the removed line is in `tmp/codex/f6-mutations/f6a.diff`. `tmp/codex/f6-mutations/f6a.ts` accepts `apply` or `restore` for direct reproduction around the regression command. The production file is restored.

## Validation

The following commands ran from this worktree with `env -C /home/user/browser/tmp/worktrees/f6`. `TOUCHED` denotes the explicit arguments `src/core/BrowserToolset.ts src/core/types.ts tests/src/core/BrowserToolset.test.ts tests/setup.ts`; it was not a shell variable.

| Command | Exit | Counts or result |
| --- | --- | --- |
| `npm run check:src:core` after the TSDoc edit | 0 | No diagnostics |
| Regression command before repair | 1 | 1 failed, 143 filtered out |
| Regression command after repair | 0 | 1 passed, 143 filtered out |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts` | 0 | 1 file; 144 passed |
| `npx oxfmt --check TOUCHED` | 0 | 4 files; formatting passes |
| `npx oxlint --config .oxlintrc.json --deny-warnings TOUCHED` | 0 | No diagnostics |
| Initial `npm run check` | 2 | 1 diagnostic: the extracted fixture emitter lacked its event-map type argument; corrected |
| Final `npm run check` | 0 | Root and core, server, browser, and bin checks pass; no diagnostics |
| `npm run test:src:core` after mutation restoration | 0 | 50 files; 1,038 passed; 44.42 s |
| `npm run test:policy` | 0 | 1 file; 114 passed, 1 skipped; 14.57 s |
| `node node_modules/@orkestrel/scaffold/dist/agents/skills/orkestrel-harden/scripts/discovery.js --projects src:core` | 2 | Wrapper reported that `vitest list` failed; no usable census |
| `npx vitest list --config vite.config.ts --project src:core --json tmp/codex/f6-mutations/discovery.json` | 0 | 1,038 collected; 144 belong to `BrowserToolset.test.ts` |

The policy skip is `tests/policy.test.ts:718`: substitution-table parity runs only where `.claude/rules/writing.md` is authored locally. This target reads that file from scaffold. The touched test contains no skip, todo, or retry marker; existing timeout overrides are unchanged. The complete diff contains changes only to the owned source, TSDoc, test, and fixture files.

## Deviations and scope notes

- No source scope expansion was needed. The work remains within the brief's owned files, with evidence under `tmp/`. No commit, stash, reset, checkout, or index-wide operation was performed.
- The first read, which loaded the brief, used the correct working directory but omitted the required `env -C` prefix. All subsequent shell commands used it.
- No `probe` MCP tool is registered in this session, and user-level harness configuration is outside the writable roots. No `prove` receipt is claimed. The prescribed red/green regression and mutation provide the runtime evidence.
- The discovery wrapper returned exit 2. Direct scoped Vitest discovery succeeded and its JSON records the collected tests; the wrapper's broader census is not claimed.
- The initial mutation subprocess runners exited 1 without collecting visible test evidence. Those attempts are inconclusive. The direct Vitest mutation run collected the named case and produced the failure recorded in the mutation table.
- This unit follows the supplied repair prescription. The orchestration contract closes a verbatim repair with its mutation probe; this sole-writer unit spawned no review or verification agents and leaves campaign acceptance to its orchestrator.
