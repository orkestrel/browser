# H1 claims

The toolset routes managed execution through `perform`, queues a second hold until release, and exposes its output limit. The prescribed mutations each fail their named assertion. This report supplies writer evidence for campaign acceptance.

## Changes and numbered claims

1. **Managed execution shares the redaction boundary.** `src/core/BrowserToolset.ts:250` constructs the manager adapter; `src/core/BrowserToolset.ts:311` preserves registry operations and redirects single and batch execution through `perform`. `tests/src/core/BrowserToolset.test.ts:190` pins `Rejected [redacted]`, the Error-valued abort's `Error: Rejected [redacted]`, direct execution, and unchanged ordinary refusal text. `tests/src/core/BrowserToolset.test.ts:101` proves registry emitter, count, definitions, tool identity, addition, removal, successful and missing calls, empty batches, and pre-aborted batches. Mutation h1a fails the managed pre-abort assertion.
2. **Redaction assertions detect a retained suffix.** `tests/src/core/BrowserToolset.test.ts:237` compares the exact sanitized result, action receipt, direct error, and emitted receipts for raw and JSON-quoted input at limits 48 and 4096. `tests/src/core/BrowserToolset.test.ts:290` checks disjoint secret fragments and their escaped forms in successful selection receipts. `tests/src/core/BrowserToolset.test.ts:514` and `tests/src/core/BrowserToolset.test.ts:533` check disjoint fragments of the ordinary secret fixture. Mutation h1b retains the suffix and fails the exact receipt assertion before clipping can hide it.
3. **A second hold waits for release and honours cancellation.** `src/core/BrowserToolset.ts:416` reserves admission while waiting on earlier hold releases, and `src/core/BrowserToolset.ts:514` releases the matching reservation. `tests/src/core/BrowserToolset.test.ts:138` asserts that the first hold remains acquired and that the release event precedes the second grant. `tests/src/core/BrowserToolset.test.ts:158` asserts the exact abort reason while the first remains held, then grants a later hold. Mutation h1c removes the wait and fails the held-name assertion.
4. **The public limit and coded refusal agree.** `src/core/types.ts:2821` declares `readonly limit: number`; `src/core/BrowserToolset.ts:306` returns the configured value. `src/core/BrowserToolset.ts:237` codes an invalid constructor limit as `BROWSER_TOOLSET_ARGUMENT`. `tests/src/core/BrowserToolset.test.ts:181` pins limit 10, and `tests/src/core/BrowserToolset.test.ts:894` pins the refusal code. Guide property rows are at `guides/browser.md:1921`; the error row is at `guides/browser.md:290`.
5. **Pending-input copy has one source and an exact proof.** `src/core/constants.ts:416` owns `BROWSER_TOOL_PENDING_NOTE`; `src/core/BrowserToolset.ts:508` reads it. `tests/src/core/BrowserToolset.test.ts:399` pins `An earlier input is still pending; call look.` with `BROWSER_TOOLSET_DIALOG`. The Receipts row cites the constant and sentence at `guides/browser.md:2881`.
6. **Admission and observation vocabulary follow the ruling.** `src/core/BrowserToolset.ts:494` admits only `observation` or `action`; `src/core/BrowserToolset.ts:1367` parks pending input under `#parkInput`. `src/core/constants.ts:419` owns `BROWSER_OBSERVATION_TOOL_NAMES`; the action-recording site at `src/core/BrowserToolset.ts:367` and admission site at `src/core/BrowserToolset.ts:589` read it, with `wait` explicit at admission. `src/core/types.ts:2808` lists `action`, `hold`, and `release`; the constant guide row is at `guides/browser.md:223`.
7. **Reserved-name and property documentation match the contract.** The class remarks at `src/core/BrowserToolset.ts:155` and invariant 21 at `guides/browser.md:3072` name `unresolved` as reserved. The existing exact skip proof is at `tests/src/core/BrowserToolset.test.ts:84`. `guides/browser.md:1921` documents `held`; `guides/browser.md:1905` documents hold handoff. Guide parity passes.

## Mutation evidence

Each command used `env -C /home/user/browser/tmp/worktrees/h1 npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts -t '<test name>'`. Each mutation collected its named test, failed that test alone, and filtered the other 152 tests. The restored focused run passes all 159 tests across the toolset and factory files.

| Mutation | Breaking edit | Test name | Named assertion | Exit / counts | Evidence |
| --- | --- | --- | --- | --- | --- |
| h1a | Return the raw manager from `tools` | redacts a secret abort reason before admission and keeps ordinary refusal text | `h1a: managed pre-abort redacts the complete secret` | 1 / 1 failed, 152 filtered | `tmp/codex/h1-mutations/h1a.json`, `tmp/codex/h1-mutations/h1a-direct.log` |
| h1b | Replace each secret with `secret.slice(4)` | redacts raw and JSON-quoted secret refusals before clipping results, actions, and direct errors | `h1b: redaction removes the suffix before clipping` | 1 / 1 failed, 152 filtered | `tmp/codex/h1-mutations/h1b.json`, `tmp/codex/h1-mutations/h1b-direct.log` |
| h1c | Disable the wait on earlier holds | waits for the first hold to release before granting the second hold | `h1c: the second hold waits for release` | 1 / 1 failed, 152 filtered | `tmp/codex/h1-mutations/h1c.json`, `tmp/codex/h1-mutations/h1c-direct.log` |

`tmp/codex/h1-mutations/apply.ts` applies or restores each recorded edit. `tmp/codex/h1-mutations/direct-results.json` records the direct runs. The h1a and h1b logs are selected-output records; h1c carries the full direct output. No mutation remains in the source.

## Validation

Every command uses the prefix `env -C /home/user/browser/tmp/worktrees/h1`. The touched paths for formatting and lint are `src/core/BrowserToolset.ts`, `src/core/types.ts`, `src/core/constants.ts`, `tests/src/core/BrowserToolset.test.ts`, `tests/src/core/factories.test.ts`, and `guides/browser.md`.

| Command | Exit | Counts / result |
| --- | --- | --- |
| `npx oxfmt --check <touched paths>` | 0 | 6 files; all formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings <touched paths>` | 0 | 6 submitted paths; no diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin checks; no diagnostics |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/factories.test.ts` | 0 | 159 passed across 2 files; 37.16 s |
| `npm run test:src:core` | 0 | 1092 passed across 50 files; 38.86 s |
| `npm run test:policy` | 0 | 114 passed, 1 skipped across 1 file; 9.20 s |
| `npm run test:guides` | 0 | 248 passed across 1 file; 3.62 s |
| `npx vitest list --config vite.config.ts --project src:core --json tmp/codex/h1-discovery.json` | 0 | Core discovery written to the named artifact |
| `git diff --check` | 0 | No whitespace errors |

The policy skip is the existing `skipIf(!isPolicyFile(process.cwd(), POLICY_TERM_FILE))` at `tests/policy.test.ts:718`; the optional term file is absent. The touched toolset suite has no skipped or todo test. Its existing extended timeouts cover navigation settlement fixtures.

The regression evidence includes these unsuccessful checks, followed by the passing checks in the table.

| Check | Exit | Counts / finding |
| --- | --- | --- |
| Types-first `npm run check:src:core` before implementation | 2 | 3 diagnostics requiring the class's missing `limit` member |
| Filtered regression command: `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts -t 'secret abort\|first hold\|second hold\|configured limit\|positive integer'` before implementation | 1 | 5 failed, 147 filtered; the abort vector was refined to a string reason for the exact `Rejected [redacted]` expectation, with Error-valued coverage retained separately |
| Core project before assertion corrections | 1 | 1090 passed, 2 failed: raw manager identity and a selection assertion expanded beyond receipts into the page's target name |
| Guide parity with a property table preceding the method table | 1 | 244 passed, 4 failed; moving the property rows after the methods restored parity |

## Scope notes and deviations

- **Authorized test extension:** `tests/src/core/factories.test.ts:89` checks shared emitter identity instead of raw manager identity. Its existing population and teardown assertions still prove that the supplied manager is filled and emptied. The brief explicitly permits a test file outside the initial list.
- **Instrument limitation:** no callable `probe.prove` tool is registered in this session. Harness-level registration outside the repository is outside the writable roots. No probe receipt is claimed; the required direct mutation controls supply the behavioral evidence.
- **Subprocess limitation:** `tmp/codex/h1-mutations/run.ts` returned `spawnSync env EPERM`. Its `results.json` records the failed launcher, not a mutation verdict. The direct tool commands ran the same controls successfully and are recorded in `direct-results.json`. The optional scaffold discovery script also exited 2 because its internal `vitest list` failed; the bare discovery command succeeded.
- **Unit boundary:** no source outside the owned paths changed. `BROWSER_JOURNEY_NON_STEP_TOOLS` and the journey toolset's use of the owner's limit remain with their owning units. H1 supplies the observation constant and public limit they consume. No dependencies, scaffold-owned files, commits, or index changes were made; no subagents were spawned.
