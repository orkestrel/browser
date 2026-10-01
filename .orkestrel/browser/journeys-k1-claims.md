# K1 claims

The prescribed journey repairs are implemented. Every required validation passes. The additional file-store run has one unresolved host failure when spawning a non-root child; its test remains unchanged.

## Changes and numbered claims

1. **A journey must contain a step, and an empty save keeps recording.** `src/core/helpers.ts:3027` refuses an empty journey with `BROWSER_JOURNEY_INVALID` and identifies the `steps` field. `src/core/BrowserJourneyToolset.ts:215` checks the recorder snapshot before store access and maps that refusal to `BROWSER_JOURNEY_EMPTY` with `Nothing is recorded for NAME; perform an action, then call save.` Checking the snapshot preserves a pending interruption, which the recorder represents as a gap. `tests/src/core/validators.test.ts:98` proves the invalid code; `tests/src/core/BrowserJourneyToolset.test.ts:66` proves the empty refusal, unchanged recording name, absent store entry, and successful save after an action. The existing pending-interruption snapshot proof remains in `tests/src/core/recorders/BrowserRecorder.test.ts:235`.
2. **An empty edit result names the removal that emptied it.** `src/core/helpers.ts:2556` retains the removal index, and `src/core/helpers.ts:2587` refuses a final empty result before checking declarations. `tests/src/core/helpers.test.ts:1230` proves attribution despite a later declaration, unchanged input, and acceptance when a later add supplies a replacement step.
3. **Post-save directives use the ruled sentences.** `src/core/BrowserJourneyToolset.ts:181` gives a saved-name recording refusal the listing, editing, and replay directives. `src/core/BrowserJourneyToolset.ts:210` uses the last successful save name, assigned at `src/core/BrowserJourneyToolset.ts:248`, for an idle save; a toolset without a successful save retains the original idle refusal. `tests/src/core/BrowserJourneyToolset.test.ts:66` proves the post-save pair, and the existing record/save refusal test proves the fresh-toolset response.
4. **Malformed edit refusals identify the operation and field.** `src/core/helpers.ts:3104` checks the operation's allowed fields, JSON contents, anchors, step, id, update arguments/target/tab, and declaration name/parameter. `tests/setup.ts:3319` supplies the grammar cases; the run collected 28 cases through the validator at `tests/src/core/validators.test.ts:92` and 28 through the tool at `tests/src/core/BrowserJourneyToolset.test.ts:41`. Each tool refusal also leaves the stored revision unchanged. The wrappers preserve the grammatical `its "OPERATION"` clause rather than prefixing another `it`.
5. **The edit tool parses a JSON string before validating its array.** `src/core/BrowserJourneyToolset.ts:306` parses strings through the installed contract package's `attempt` boundary, retains the JSON parser's error, and checks the parsed array. The installed `parseJSON` discards parse errors, so it cannot serve this receipt. `src/core/constants.ts:717` advertises array or string and describes the string form in one clause. `tests/src/core/BrowserJourneyToolset.test.ts:158` proves a persisted string edit and the exact malformed-JSON refusal without a further revision.
6. **A timeout contributes no recorded step.** `src/core/recorders/BrowserRecorder.ts:121` ignores timeout outcomes as it ignores refusals. The remaining gap paths cover child frames, held replays, and unanswered interruptions. `tests/src/core/BrowserJourneyToolset.test.ts:113` drives a timed-out wait through the toolset, records an adopted action, saves only that action, and completes replay. `tests/src/core/recorders/BrowserRecorder.test.ts:356` also proves literal adopted arguments survive while a timeout adds nothing.
7. **The guide states the behavior and supplied measurements.** `guides/browser.md:309` documents the empty-save code. `guides/browser.md:2920` through the Receipts rows document the saved-name, idle-save, empty-save, JSON-string, operation/field, and empty-edit messages. `guides/browser.md:2949` states the supplied store-model measurements (784 added tokens per turn, 1 637 for the full list), the 4 096-token truncation and 16 384-token journey window, and the final wait for a delayed confirmation. The paragraph reports J11b's evidence; this unit did not remeasure model tokens. The matching summaries at `guides/browser.md:175`, `guides/browser.md:477`, `guides/browser.md:480`, and `guides/browser.md:492` remain in parity.

## Mutations

Each control ran alone, restored its exact source bytes afterward, exited 1, collected its named test, and failed that assertion. The final core run passed every restored test. Source snapshots, control definitions, and complete assertion output reside under `tmp/codex/k1-mutations/`.

| Control | Breaking edit | Named test/assertion | Observed result | Evidence |
| --- | --- | --- | --- | --- |
| k1a | Disable the empty-steps bound, allowing the save snapshot and store write | `k1a refuses an empty save, keeps recording, and directs calls after saving`; `empty recordings are refused before a store write` | 1 failed, 69 filtered; save resolved with 0 steps | `tmp/codex/k1-mutations/k1a-assertion.log` |
| k1b | Record timeout as an unresolved gap | `k1b omits a timed-out wait so the saved journey replays`; `a timeout contributes no step` | 1 failed, 69 filtered; unresolved step precedes checkout | `tmp/codex/k1-mutations/k1b-assertion.log` |
| k1c | Remove edits-string parsing | `k1c parses a JSON edits string and names a JSON parse error`; `edits accepts a JSON string of the array` | 1 failed, 69 filtered; edit returns failure | `tmp/codex/k1-mutations/k1c-assertion.log` |
| k1d | Restore the original idle-save directive after a successful save | `k1a refuses an empty save, keeps recording, and directs calls after saving`; post-save receipt equality | 1 failed, 69 filtered; receipt directs record again | `tmp/codex/k1-mutations/k1d-assertion.log` |
| k1e | Restore the generic malformed-edit clause for a non-object edit | `names the operation and field for null` | 1 failed, 64 filtered; operation-field message differs | `tmp/codex/k1-mutations/k1e-assertion.log` |
| k1f | Disable the editor's explicit empty-result check | `attributes an empty result to the removal even before a later declaration` | 1 failed, 133 filtered; refusal attributes index 2 instead of 1 | `tmp/codex/k1-mutations/k1f-assertion.log` |

The mutation command is `env -C /home/user/browser/tmp/worktrees/k1 npx vitest run --config vite.config.ts --project src:core FILE -t PATTERN`; `tmp/codex/k1-mutations/controls.json` records each exact file and pattern. MCP `prove` receipt: unavailable; no receipt is claimed.

## Validation

Every command ran through `env -C /home/user/browser/tmp/worktrees/k1`. In the following commands, `TOUCHED` denotes exactly:

```text
src/core/BrowserJourneyToolset.ts
src/core/constants.ts
src/core/helpers.ts
src/core/recorders/BrowserRecorder.ts
tests/setup.ts
tests/setup.test.ts
tests/src/core/BrowserJourneyToolset.test.ts
tests/src/core/helpers.test.ts
tests/src/core/validators.test.ts
tests/src/core/recorders/BrowserRecorder.test.ts
tests/src/core/stores/suite.ts
tests/src/server/stores/suite.ts
tests/src/server/stores/FileBrowserJourneyStore.test.ts
guides/browser.md
```

The final gates and supplementary checks returned these results on 2026-10-01:

| Command | Exit | Counts/result |
| --- | --- | --- |
| `npx oxfmt --check TOUCHED` | 0 | 14 files correctly formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings TOUCHED` | 0 | No diagnostics |
| `npm run check` | 0 | Root TypeScript project and core, server, browser, and bin projects; no diagnostics |
| `npm run test:src:core` | 0 | 1 170 passed in 50 files; 39.00 s |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip |
| `npm run test:guides` | 0 | 248 passed |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts -t 'k1[abc]'` before the repairs | 1 | 3 failed, 39 filtered; empty save, timeout gap, and string edit reproduced |
| The same `k1[abc]` command after restoration | 0 | 3 passed, 67 filtered; grammar cases account for the larger collected file |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts tests/src/core/recorders/BrowserRecorder.test.ts tests/src/core/helpers.test.ts tests/src/core/validators.test.ts tests/src/core/stores/MemoryBrowserJourneyStore.test.ts` | 0 | 304 passed in 5 files |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts` | 0 | 70 passed |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserJourneyStore.test.ts tests/src/server/stores/FileBrowserRunStore.test.ts` | 1 | 46 passed, 1 failed: non-root child spawn returns EINVAL |
| `git diff --check -- TOUCHED` | 0 | No whitespace diagnostics |

## Scope notes and deviations

- **Test scope extension under the brief's allowance.** `tests/src/core/validators.test.ts` proves the helpers' validators. `tests/src/core/stores/suite.ts:111`, `tests/src/server/stores/suite.ts:74`, `tests/src/server/stores/suite.ts:102`, `tests/src/server/stores/suite.ts:606`, and `tests/src/server/stores/FileBrowserJourneyStore.test.ts:32` replace empty journey fixtures or perform an action before a save, preserving their listing and competing-write claims. `tests/setup.test.ts:102` uses a nonempty journey and an aborted run with no executed steps to preserve its run-store fixture claim. These are tests and fixtures of the changed invariant, not another unit's implementation.
- **Guide parity scope.** In addition to the prescribed Errors, Receipts, and Journeys text, the changed public summaries and the edit parameter row were updated under the brief's guide-row allowance. No public TypeScript shape or export required a change.
- **Supplementary file-store proof is incomplete on this host.** Expected: the non-root child executes the permission checks. Found: `tests/src/server/stores/suite.ts:502` receives `spawnSync /opt/node22/bin/node EINVAL`, before those assertions run. The final supplementary run has only this failure. No permissions test was skipped or weakened. Hypothesis: this execution host does not support the child uid/gid transition used by that proof.
- **Mutation runner host limit.** A Node launcher calling `spawnSync env` returned `EPERM` before collecting tests. That attempt provides no mutation evidence. The controls were subsequently applied, tested through the normal command tool, and restored serially; the assertion logs in the mutation table are the resulting evidence. `tmp/codex/k1-mutations/run.ts` prepares snapshots and `controls.json` only.
- **Proof transport limit.** No callable `prove` tool is registered, and the filesystem permission profile does not authorize registering one outside the worktree. The report supplies explicit failing mutations and restored passing tests instead of an MCP receipt.
- **Acceptance remains with the orchestrator.** This report is the sole writer's implementation evidence. No independent acceptance review, commit, stash, reset, checkout, or index-wide git action was performed.
