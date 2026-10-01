# K3 claims: journey refusals and the edits schema

The prescribed refusal copy and `anyOf` schema are implemented. The required gates pass. Each mutation fails only its named test. No live-model outcome is claimed by this unit.

## Changes

The changes are confined to the following owned files.

- `src/core/constants.ts:886`: `BROWSER_JOURNEY_IDLE_REFUSAL` carries the exact no-save-in-session sentence from the design's second consumer run.
- `src/core/BrowserJourneyToolset.ts:181`: recording a saved name returns the exact sentence that says not to call `record` for it again.
- `src/core/BrowserJourneyToolset.ts:223`: saving an empty recording returns the exact sentence explaining that actions before `record` are not steps.
- `src/core/constants.ts:716`: `edits` advertises `anyOf` with an array member carrying the existing item schema and a string member. The description and item fields are preserved.
- `tests/src/core/BrowserJourneyToolset.test.ts:42`: the `k3b` case reads the registered tool's parameters, asserts the union, item schema, description, and absence of `type`, then compiles the advertised schema through installed `@orkestrel/contract` 0.0.18.
- `tests/src/core/BrowserJourneyToolset.test.ts:118`: the empty-save assertion runs through `tools.execute`; the recording remains open, a later action saves, and the saved-name and post-save idle sentences are asserted exactly.
- `tests/src/core/BrowserJourneyToolset.test.ts:702`: the `k3a` case asserts the exact idle and saved-name refusals through `tools.execute`, alongside the existing invalid-name and active-recording checks.
- `guides/browser.md:2869`: the edit parameter row names `anyOf`. The Receipts rows at `guides/browser.md:2920`, `guides/browser.md:2923`, and `guides/browser.md:2925` carry the prescribed copy.

## Numbered claims

1. An idle `save` before any save in the session returns exactly `No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.` The assertion at `tests/src/core/BrowserJourneyToolset.test.ts:714` fails under `k3a`.
2. An empty-recording `save` returns exactly `Nothing is recorded for check-ready: the actions before record are not steps. Perform the flow's actions and call save, or answer the user when the task is done.` It keeps recording and writes no journey. The case at `tests/src/core/BrowserJourneyToolset.test.ts:118` then records an action and saves successfully.
3. Recording a saved name returns exactly `Journey "check-ready" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.` An idle save after that save still returns `Nothing is recording; "check-ready" was saved. Call journeys, edit, or replay.` The assertions at `tests/src/core/BrowserJourneyToolset.test.ts:158` cover both results; the retained implementation is at `src/core/BrowserJourneyToolset.ts:212`.
4. The advertised `edits` parameter is an `anyOf` array/string union, with the item properties and required `operation` retained on the array member, and no `type` array. The installed contract accepts a valid array and a JSON string and rejects `edits: 3` and an array item missing `operation`. The case at `tests/src/core/BrowserJourneyToolset.test.ts:42` proves these boundaries and fails under `k3b`.
5. The edit handler is unchanged. The existing JSON-string and parse-error case at `tests/src/core/BrowserJourneyToolset.test.ts:212`, the array-edit cases, and the full core project pass.

## Mutations

Each mutation ran the entire touched test file with `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core tests/src/core/BrowserJourneyToolset.test.ts`. Each was restored before the final core run.

| Mutation | Breaking edit | Named failing assertion | Exit | Counts | Evidence |
| --- | --- | --- | --- | --- | --- |
| `k3a` | Restore `No journey is recording; call record first.` | `k3a directs an idle save to answer the user and refuses invalid, saved, and recording names`: the exact error-array assertion | 1 | 1 failed, 70 passed | `tmp/codex/k3-mutations/k3a-2.log`, `tmp/codex/k3-mutations/k3a-2.err` |
| `k3b` | Restore `type: ['array', 'string']` with `items` beside it | `k3b: edits advertises anyOf and preserves its array item schema` | 1 | 1 failed, 70 passed | `tmp/codex/k3-mutations/k3b-2.log`, `tmp/codex/k3-mutations/k3b-2.err` |

## Validation

Commands ran from `/home/user/browser/tmp/worktrees/k3` with the `env -C /home/user/browser/tmp/worktrees/k3` prefix. The formatting and lint commands name `src/core/BrowserJourneyToolset.ts src/core/constants.ts tests/src/core/BrowserJourneyToolset.test.ts guides/browser.md`. Journaled commands ran through the installed dispatch launcher with a 180-second cap and without `--status`.

| Command | Exit | Counts or result | Evidence |
| --- | --- | --- | --- |
| `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project src:core tests/src/core/BrowserJourneyToolset.test.ts`, tests before the repair | 1 | 3 failed, 68 passed: `k3a`, `k3b`, and `k1a` | `tmp/codex/k3-mutations/before.log`, `before.err` |
| Same command after the repair | 0 | 71 passed, 1 file | `tmp/codex/k3-mutations/after.log`, `after.err` |
| `npx oxfmt --check` over the touched files | 0 | 4 files formatted | Direct command output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched files | 0 | No diagnostics | Direct command output |
| `npm run check` | 0 | Root TypeScript project and core, server, browser, and bin projects pass | Direct command output |
| `npm run test:src:core`, after restoring both mutations | 0 | 1,171 passed, 50 files; 38.13 s | `tmp/codex/k3-core.log`, `tmp/codex/k3-core.err` |
| `npm run test:policy` | 0 | 114 passed, 1 skipped, 1 file | `tmp/codex/k3-policy.log`, `tmp/codex/k3-policy.err` |
| `npm run test:guides` | 0 | 248 passed, 1 file | `tmp/codex/k3-guides.log`, `tmp/codex/k3-guides.err` |
| `git diff --check --` over the touched files | 0 | No whitespace errors | Direct command output |

The policy skip is the existing substitution-table comparison at `tests/policy.test.ts:718`, conditional on the workspace carrying the authored term file.

## Scope notes and deviations

- The schema proof lives in the existing `BrowserJourneyToolset.test.ts` and reads the registered tool. `tests/src/core/constants.test.ts` does not exist; no constants-only test file was created. No change was needed in `helpers.test.ts` or `tests/setup.ts`. No file outside the owned list was needed except the authorized working artifacts and this report under `tmp/`.
- No `prove` tool is exposed in this session, and the sandbox does not permit writing a harness configuration outside the workspace. No receipt was produced. Evidence consists of the failing-first test run and the requested mutation runs.
- The initial combined mutation runner at `tmp/codex/k3-mutations/run.ts` exited 1 because its nested child returned exit 1 with empty captured output. Its `finally` restored the source. That run is not mutation evidence; the separately launched runs in the mutation table collected the named failures. The rejected run's artifacts remain in `tmp/codex/k3-mutations/run.log` and `run.err`.
- The initial read of the brief and contracts used the already-correct working directory without the required `env -C` prefix. Subsequent shell commands used that prefix.
- The unit performed its prescribed repair and validation directly as the sole writer. It spawned no agents and performed no commit, stash, reset, checkout, or index-wide git command. Campaign review and acceptance remain with the orchestrator.
