# G5b claims

The prescribed repairs are implemented. The final core suite passes 1,073 tests. The server store suite passes 51 tests and fails its different-UID permission proof because the sandbox rejects the child process. Formatting, lint, typechecks, policy, and guides pass. No commit, stash, reset, checkout, or index mutation was performed.

## Numbered claims

1. The native step grammar derives admitted fields, required fields, and scalar types from `BROWSER_TOOL_COPY`. Journey targets replace `ref` and `tab`; secret status remains derived from parameter declarations. A recorded `wait` with integer `timeout` can be saved. Source: `src/core/helpers.ts:2897`. Assertions: `tests/src/core/helpers.test.ts:88`, `tests/src/core/BrowserJourneyToolset.test.ts:239`, and `tests/src/core/BrowserJourneyToolset.test.ts:257`. The listing fence remains pinned by `tests/src/core/helpers.test.ts:1300`.
2. Final binding validation attributes a refusal to the field edit or secret declaration that introduced the incompatible binding, retaining that origin across unrelated updates and repeated identical bindings. Structural counter exhaustion refuses at its introducing add. The batch remains atomic and permits forward declarations and repaired intermediate bindings. Source: `src/core/helpers.ts:2508`, `src/core/helpers.ts:2525`, and `src/core/helpers.ts:2576`. Assertions: `tests/src/core/helpers.test.ts:1164`, `tests/src/core/helpers.test.ts:1180`, `tests/src/core/helpers.test.ts:1188`, and `tests/src/core/helpers.test.ts:1197`; cases: `tests/setup.ts:3255`. Binding validation exposes the parameter in error context at `src/core/helpers.ts:2999` and `src/core/helpers.ts:3017`; the replay preparation assertion follows that context in `tests/src/core/BrowserReplay.test.ts:47`.
3. Journey and run stores refuse an explicit zero limit or negative offset with `BROWSER_JOURNEY_ARGUMENT`; omitted paging still returns an empty page on an empty memory store. The file store also refuses a zero construction cap. Source: `src/core/stores/MemoryBrowserJourneyStore.ts:67`, `src/core/stores/MemoryBrowserRunStore.ts:90`, `src/server/stores/FileBrowserStore.ts:25`, and `src/server/stores/FileBrowserStore.ts:236`. Shared assertions run over both memory and file twins: `tests/src/core/stores/suite.ts:25`, `tests/src/core/stores/suite.ts:93`, `tests/src/core/stores/suite.ts:155`, and `tests/src/core/stores/suite.ts:188`. Construction assertion: `tests/src/server/stores/FileBrowserStore.test.ts:9`.
4. Memory stores refuse invalid journey names with the same `BROWSER_JOURNEY_PATH` code as the file twins. The journey store checks get/delete; the run store checks open/get/delete/list. Their existing set validation remains in place. Source: `src/core/stores/MemoryBrowserJourneyStore.ts:26` and `src/core/stores/MemoryBrowserRunStore.ts:24`. Shared assertions: `tests/src/core/stores/suite.ts:35` and `tests/src/core/stores/suite.ts:161`; invalid-name cases: `tests/setup.ts:4183`.
5. `BrowserJourneyOptions.limit` supplies the listing cap. `BrowserJourneyToolset` accepts no positional cap; the owning toolset supplies its general limit when the journey option is omitted and honors an explicit override. A zero journey cap and negative listing offset carry `BROWSER_JOURNEY_ARGUMENT`. Source: `src/core/types.ts:2155`, `src/core/BrowserJourneyToolset.ts:90`, `src/core/BrowserJourneyToolset.ts:239`, and `src/core/BrowserToolset.ts:285`. Assertions: `tests/src/core/BrowserJourneyToolset.test.ts:37` and `tests/src/core/BrowserJourneyToolset.test.ts:79`.
6. `performBrowserStep` throws `BrowserError` with the performed action in `context.action` when its outcome or navigation stage prevents completion. Replay reads that action locally from the return value or error context; its mutable `#action` field and forwarding `#performCall` method are removed. Receipt, arguments, outcome, elapsed time, navigation stage, and reason remain available to the run. Source: `src/core/helpers.ts:2461`, `src/core/BrowserReplay.ts:256`, and `src/core/BrowserReplay.ts:284`. Direct assertion: `tests/src/core/helpers.test.ts:102`; replay behavior is covered by `tests/src/core/BrowserReplay.test.ts`, included in the passing core project.
7. A listing fault renders `NAME cannot be read: REASON`, extracting the entry name and removing absolute paths from the reason while retaining deduplication across store pages. Source: `src/core/BrowserJourneyToolset.ts:250`. The real file-store listing asserts `broken cannot be read: Malformed journey revision` exactly, beside the readable entries: `tests/src/server/stores/FileBrowserJourneyStore.test.ts:25` and `tests/src/server/stores/FileBrowserJourneyStore.test.ts:49`.

## Mutation proof

Each control ran through the worktree's Vitest project, failed its named collected assertion, and was restored before final validation. The skipped tests in this table were excluded by the explicit `-t` selection.

| Mutation | Breaking edit | Named assertion | Exit | Result | Artifact |
| --- | --- | --- | --- | --- | --- |
| g5b1 | Replace the derived wait properties with handwritten `text` alone | `admits the advertised wait timeout in a journey step` | 1 | 1 failed, 126 filtered out | `tmp/codex/g5b-mutations/g5b1-assertion.log` |
| g5b2 | Replace the attributed index with `edits.length` at refusal | `names the edit that introduced an undeclared binding despite later edits` | 1 | 1 failed, 126 filtered out | `tmp/codex/g5b-mutations/g5b2-assertion.log` |
| g5b3 | Change the file construction cap refusal from `< 1` to `< 0` | `refuses a zero listing cap with the argument code` | 1 | 1 failed, 6 filtered out | `tmp/codex/g5b-mutations/g5b3-assertion.log` |

The exact replacement records and restored-source snapshots accompany the logs under `tmp/codex/g5b-mutations/`. `mutate.ts` applies or restores one named control.

## Validation

Every command was invoked through `env -C /home/user/browser/tmp/worktrees/g5b`. The format and lint commands covered these touched files:

```text
src/core/types.ts
src/core/helpers.ts
src/core/BrowserReplay.ts
src/core/BrowserJourneyToolset.ts
src/core/BrowserToolset.ts
src/core/stores/MemoryBrowserJourneyStore.ts
src/core/stores/MemoryBrowserRunStore.ts
src/server/stores/FileBrowserStore.ts
tests/setup.ts
tests/src/core/helpers.test.ts
tests/src/core/BrowserJourneyToolset.test.ts
tests/src/core/BrowserReplay.test.ts
tests/src/core/stores/suite.ts
tests/src/server/stores/FileBrowserJourneyStore.test.ts
tests/src/server/stores/FileBrowserStore.test.ts
```

The final gate results are measured on the restored implementation.

| Command | Exit | Count and result |
| --- | --- | --- |
| `npx oxfmt --check` followed by the touched-file list | 0 | 15 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` followed by the touched-file list | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript projects pass |
| `npm run test:src:core` | 0 | 50 files; 1,073 tests pass |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 1 | 3 files; 51 pass, 1 fails at the different-UID child spawn |
| `npm run test:policy` | 0 | 114 pass, 1 existing conditional skip |
| `npm run test:guides` | 0 | 248 pass |
| `git diff --check --` followed by the touched-file list | 0 | No whitespace errors |

The policy skip is `registers every substitution-table term as either matched or judged`: `tests/policy.test.ts:718` conditions it on the presence of the locally authored policy term file.

The defect baseline used `npx vitest run --config vite.config.ts --project src:core tests/src/core/helpers.test.ts tests/src/core/BrowserJourneyToolset.test.ts tests/src/core/stores --reporter=dot`: exit 1, 12 failed and 161 passed. The same command after the initial repair returned exit 0 with 173 passing tests. Additional attribution and construction coverage is included in the final core result. The server-store baseline with `--reporter=dot` returned exit 1 with 7 failures and 45 passes; the final prescribed command leaves only the unrelated host failure.

## Deviations and scope notes

- **Server permission proof remains unverified on this host.** Expected: the server suite passes the chmod proof through a non-root child. Found: `spawnSync /opt/node22/bin/node EINVAL`, at `tests/src/server/stores/suite.ts:421`, before the child can execute its assertions. The same failure occurs in the baseline and final run. The source and proof were retained; no skip or altered assertion hides it. Hypothesis: the sandbox refuses the requested UID/GID transition. A host that permits that transition must run the prescribed server command for a green permission proof.
- **Supplementary discovery is blocked by browser collection.** The scaffold discovery command `node node_modules/@orkestrel/scaffold/dist/agents/skills/orkestrel-harden/scripts/discovery.js --projects src:core,src:server --json` returns exit 2. Its bare collection command, `node node_modules/vitest/vitest.mjs list --config vite.config.ts --json`, returns exit 1 with `listen EPERM: operation not permitted 127.0.0.1`. The implementation's selected projects were collected and exercised by their actual test runs; no full-workspace census is claimed.
- **Mutation harness substitution.** The initial `run.ts` child-process harness failed with `spawnSync env EPERM` before collecting a test. That run is not mutation evidence. The successful controls use `mutate.ts` for source changes and direct harness commands for Vitest, each through the required worktree prefix. Their assertion logs are the evidence table's artifacts.
- **Instrument scope.** No callable `probe.prove` tool was available; no probe receipt is claimed. The brief's named Vitest mutations provide the negative controls. This writing unit reports its commands and does not claim independent campaign acceptance.
- **Owned test extension.** `tests/src/server/stores/FileBrowserJourneyStore.test.ts` pins the fault render through the real file store and shared paging/name suite; it is a test of the owned listing and store-argument behavior. The brief's test exception covers it. No file serving another unit was edited.
- **Unneeded edits.** `src/browser/factories.ts` already forwards the entire journey options object to `BrowserToolset`, so it carries `limit` without a change. `src/core/constants.ts` has no error-code registry to update; the argument code follows the package's existing literal-code convention. The guide gate passes without a guide edit.

The mutations, report, and unit-local scripts remain under `tmp/`. Production edits are confined to the brief's owned files.
