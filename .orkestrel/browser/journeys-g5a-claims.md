# G5a claims

The prescribed hold, recording, save, and reserved-name repairs are implemented. The final core run passed 1,060 tests in 50 files. Each required mutation failed its named assertion, and the repaired source was restored before the final validation.

## Numbered claims

1. **A refused hold leaves the dialog answer admissible.** `src/core/BrowserToolset.ts:369` checks for an open dialog or an input left pending by an earlier receipt before reserving admission. `src/core/BrowserToolset.ts:453` returns `BROWSER_TOOLSET_DIALOG` with the rendered dialog receipt. With the dialog already answered but its input still pending, it returns `An earlier input is still pending; call look.` Queue acquisition also checks the boundary (`src/core/BrowserToolset.ts:1124`). Pending input clears when its command settles (`src/core/BrowserToolset.ts:1301`). The interrupted-click test rejects the hold, answers the dialog, rejects another hold while the input remains pending, and acquires a hold after settlement (`tests/src/core/BrowserToolset.test.ts:134`). The pending-dialog-answer test follows the amended refusal contract (`tests/src/core/BrowserToolset.test.ts:98`). Existing pre-admitted action ordering remains covered at `tests/src/core/BrowserToolset.test.ts:398`.

2. **The toolset owns the acquired hold state.** `src/core/BrowserToolset.ts:304` derives `held` from its reservation. The public contract is at `src/core/types.ts:2813`. The recorder reads this value when it starts and receives an action (`src/core/recorders/BrowserRecorder.ts:51`, `src/core/recorders/BrowserRecorder.ts:103`); it retains the hold event only to append the boundary gap (`src/core/recorders/BrowserRecorder.ts:186`). The journey toolset reads the same value (`src/core/BrowserJourneyToolset.ts:509`). Both consumers' cached hold fields and release listeners are removed. A recorder constructed after acquisition begins with the gap, excludes held actions, and resumes after release (`tests/src/core/recorders/BrowserRecorder.test.ts:20`). The existing boundary test uses an actual hold and release (`tests/src/core/recorders/BrowserRecorder.test.ts:299`).

3. **`record` refuses while a replay holds.** `src/core/BrowserJourneyToolset.ts:158` checks replay activity before store access and again after the store read. The shared check includes both the local replay's preparation and the toolset's acquired hold (`src/core/BrowserJourneyToolset.ts:509`). A replay blocked in its adopted action refuses `record` with `The toolset is replaying check-ready until it finishes; call look.` and leaves `recording` unset (`tests/src/core/BrowserJourneyToolset.test.ts:39`).

4. **`unresolved` cannot be adopted as a page tool.** The adoption boundary returns the `reserved` reason at `src/core/BrowserToolset.ts:1749`, including without the journeys option. The proof asserts both the skip event and absence from the tool manager (`tests/src/core/BrowserToolset.test.ts:81`).

5. **A refused save keeps recording and retains the earlier steps.** `src/core/BrowserJourneyToolset.ts:191` writes a journey snapshot before destroying the recorder on success. Failure leaves the same recorder active. `src/core/recorders/BrowserRecorder.ts:73` includes an unanswered interrupted action as a gap in that snapshot without consuming its continuation. The contract describes the snapshot at `src/core/types.ts:1821`. The retry test saves an action performed after the store's refused write together with the earlier action (`tests/src/core/BrowserJourneyToolset.test.ts:72`). Disk and lock failures retain the interrupted gap (`tests/src/core/BrowserJourneyToolset.test.ts:300`). Snapshotting preserves the pending click/dialog pair and the recorder's started state (`tests/src/core/recorders/BrowserRecorder.test.ts:151`). The shared scripted write boundary delegates successful operations to the real memory store (`tests/setup.ts:55`).

6. **Admission uses an explicit category.** `src/core/BrowserToolset.ts:444` accepts `observation`, `action`, or `hold`. `hold()` supplies its category directly, and tool execution classifies its call at `src/core/BrowserToolset.ts:533`. No empty tool name selects hold admission. Existing tests for observations, foreign actions, owner dialog continuation, queue ordering, and cancellation passed in the final core run.

## Mutation evidence

The mutation preparation/restoration script is `tmp/codex/g5a-mutations/run.ts`. Each mutation has a JSON description, an original-source snapshot, and a `*-result.log` in that directory. Each selected test was collected and failed on its assertion, with no collection failure. The filtered-out tests are reported as skipped by Vitest's `-t` selection.

| Mutation | Breaking edit | Named assertion | Exit and counts | Log |
| --- | --- | --- | --- | --- |
| `g5a1` | Remove the holdability checks and make hold queue/pending-input waits uninterruptible | `g5a1: hold refuses before waiting on the dialog input` at `tests/src/core/BrowserToolset.test.ts:158` | Exit 1; 1 failed, 145 filtered | `tmp/codex/g5a-mutations/g5a1-result.log` |
| `g5a2` | Remove both replay checks from `record` | `g5a2: recording cannot begin during replay` at `tests/src/core/BrowserJourneyToolset.test.ts:59` | Exit 1; 1 failed, 30 filtered | `tmp/codex/g5a-mutations/g5a2-result.log` |
| `g5a3` | Stop the recorder before attempting the store write | `g5a3: retry retains actions recorded after the refusal` at `tests/src/core/BrowserJourneyToolset.test.ts:95` | Exit 1; 1 failed, 30 filtered | `tmp/codex/g5a-mutations/g5a3-result.log` |

Each mutation ran through `env -C /home/user/browser/tmp/worktrees/g5a npx vitest run --config vite.config.ts --project src:core FILE -t TEST`, with these exact file/test pairs:

```text
tests/src/core/BrowserToolset.test.ts
refuses a hold after an interrupted click and leaves the dialog answer admissible

tests/src/core/BrowserJourneyToolset.test.ts
refuses record while a blocked replay holds the toolset

tests/src/core/BrowserJourneyToolset.test.ts
keeps recording actions after a refused save and saves them on retry
```

## Validation

Every command in this table used `env -C /home/user/browser/tmp/worktrees/g5a` as its prefix. `TOUCHED` means the following exact arguments:

```text
src/core/BrowserToolset.ts src/core/BrowserJourneyToolset.ts src/core/recorders/BrowserRecorder.ts src/core/types.ts tests/src/core/BrowserToolset.test.ts tests/src/core/BrowserJourneyToolset.test.ts tests/src/core/recorders/BrowserRecorder.test.ts tests/setup.ts
```

`FILES` means the three mirrored test files in that list. `REGRESSIONS` is this exact `-t` expression:

```text
refuses a hold after an interrupted|refuses record while a blocked|keeps recording actions after|skips a page tool named unresolved|starts with a gap when constructed
```

| Command | Exit | Counts/result |
| --- | --- | --- |
| `npm run check:src:core` after the types-first contract edit, before implementation | 2 | 3 expected diagnostics: `BrowserToolset` did not yet implement `held` |
| `npx vitest run --config vite.config.ts --project src:core FILES -t REGRESSIONS` before repairs | 1 | 5 failed, 194 filtered; all requested defect cases reproduced |
| Same regression command after repairs | 0 | 5 passed, 194 filtered |
| `npx vitest run --config vite.config.ts --project src:core FILES` | 0 | 199 passed in 3 files |
| `npx oxfmt --check TOUCHED` | 0 | 8 files formatted correctly |
| `npx oxlint --config .oxlintrc.json --deny-warnings TOUCHED` | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript projects passed |
| `npm run test:src:core` | 0 | 1,060 passed in 50 files; 39.64 s Vitest duration |
| `npm run test:policy` | 0 | 114 passed, 1 skipped in 1 file |
| `npm run test:guides` before moving the snapshot note into TSDoc remarks | 1 | 247 passed, 1 failed on compared summary drift |
| `npm run test:guides` after the TSDoc correction | 0 | 248 passed in 1 file |

The core command ran through the scaffold dispatch launcher with a 300-second cap. `tmp/codex/g5a-core.log` contains the full output; `tmp/codex/g5a-core.err` records `exit=0 signal=none capped=false duration_ms=41436`. The full output was read without a filtering pipe.

## Scope notes and deviations

- Source and test edits stay within the brief's owned files. No scope extension, commit, stash, reset, checkout, dependency change, or subordinate writer was used.
- `src/core/constants.ts` is unchanged. Its tool-name arrays also drive advertised tool definitions, including the MCP server. The pseudo-action `unresolved` is reserved directly at page-tool adoption, without adding it to an advertised vocabulary or requiring another unit's server edits.
- The fallback receipt for pending input after its dialog has closed names the pending input rather than claiming a dialog remains open. It carries the same `BROWSER_TOOLSET_DIALOG` refusal code and clears no pending input prematurely.
- No `probe` MCP tool was registered in this session. The prescribed Vitest regressions and explicit mutations provide the evidence; no `prove` receipt is claimed. These are writer-run checks, not an independent verifier's acceptance.
- The initial Node-spawned mutation runner returned exit 1 with no test output. Those attempts are rejected as evidence. The retained runner only prepares/restores source; the successful mutation proofs use direct, harness-tracked Vitest commands and the named assertions in the table.
- Initial brief discovery/read commands preceded loading its `env -C` requirement and did not carry that prefix. Subsequent shell commands use it. Those initial commands were read-only and ran in the supplied worktree.
- No unresolved implementation deviation or required unowned edit remains.
