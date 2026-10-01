# L2 claims

Implemented `forget`, run removal on both store twins, the prescribed refusals, and reuse of a forgotten name. The required server-store command reports 69 passing tests and one host-dependent failure. The remaining prescribed gates pass. No commit, stash, reset, checkout, or index mutation was performed.

The numbered claims identify the changes and their evidence.

1. **The manager advertises and reserves `forget` with required `journey`.** Registration is at `src/core/BrowserJourneyToolset.ts:120`; copy and schema are at `src/core/constants.ts:792`; the journey-name set is at `src/core/constants.ts:876`, and the non-step set derives from it at `src/core/constants.ts:888`. The public tool union includes it at `src/core/types.ts:2720`. The registration, copy, parameter, and teardown assertions run in `tests/src/core/BrowserJourneyToolset.test.ts:713`.
2. **Forgetting removes the saved journey and its runs, reports singular/plural counts, and frees the name.** The handler is at `src/core/BrowserJourneyToolset.ts:360`. It clears runs before calling the journey store's existing `delete`, leaving its revision counter intact. The memory tool proofs are at `tests/src/core/BrowserJourneyToolset.test.ts:73` and `tests/src/core/BrowserJourneyToolset.test.ts:106`. The file proof at `tests/src/server/stores/FileBrowserJourneyStore.test.ts:36` verifies the singular receipt, capture deletion, recording again, and a subsequent save at revision 2. The zero-run receipt is covered by the memory proof without a run store.
3. **The prescribed refusals retain their codes and exact sentences.** Read-only, missing, recording, and replay-busy cases are at `tests/src/core/BrowserJourneyToolset.test.ts:43`, `tests/src/core/BrowserJourneyToolset.test.ts:144`, and `tests/src/core/BrowserJourneyToolset.test.ts:188`. The held-lock case at `tests/src/server/stores/FileBrowserJourneyStore.test.ts:83` drives the real filesystem lock, checks the code and rendered sentence, verifies retained data, and retries successfully after release.
4. **Run removal includes opened slots that listings omit.** `BrowserRunStoreInterface.clear` is declared at `src/core/types.ts:2143`, implemented at `src/core/stores/MemoryBrowserRunStore.ts:81` and `src/server/stores/FileBrowserRunStore.ts:136`, and documented at `guides/browser.md:2154`. The shared conformance case at `tests/src/core/stores/suite.ts:165` runs on both twins and proves saved-run removal, unsaved-slot invalidation, sibling isolation, empty removal, and reopening. The file cases at `tests/src/server/stores/FileBrowserRunStore.test.ts:82` cover reopened stores, malformed run files, captures, and unsaved slots. The tests at lines 104 and 121 cover lock exclusion and linked path refusal. File `open` at `src/server/stores/FileBrowserRunStore.ts:40` shares the journey lock with `clear`, so allocation cannot enter during the locked removal.
5. **The guide and expected vocabulary include the tool.** `guides/browser.md:2875` adds the tool row; `guides/browser.md:2924` adds receipts; the Errors rows at `guides/browser.md:317` include the applicable `forget` paths; `guides/browser.md:3001` describes removal; and `guides/browser.md:3482` lists the registration vocabulary. Journey tool counts and summaries agree with source, including `README.md:8`. The distribution expectation comes from `BROWSE_VOCABULARY` at `tests/setupServer.ts:1809`, consumed by `tests/distribution.test.ts:1248`.

The store-method decision follows the unit's conditional prescription: `list` exposes saved runs, not every opened slot, and separate listing/deletion cannot exclude an allocation during removal. `clear(name)` therefore counts and removes opened slots as well as saved runs. The file twin uses the existing filesystem engine and lock, with no dependency or filesystem-engine change. Memory capture validation also rejects slots invalidated by deletion. The run clear and journey delete remain separate store operations; a later I/O failure can leave runs removed and the saved journey available for retry.

The mutation evidence is retained under `tmp/codex/l2-mutations/`. Each command was `env -C /home/user/browser/tmp/worktrees/l2 npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts -t ID`, with `ID` replaced by the table's mutation name. The test filter accounts for the skipped tests.

| Mutation | Breaking edit inside `#forget` | Named assertion that failed | Exit | Result | Artifact |
| --- | --- | --- | --- | --- | --- |
| `l2a` | Remove the read-only guard | `l2a: read-only forget is refused` | 1 | 1 failed, 75 filtered | `tmp/codex/l2-mutations/l2a.log` |
| `l2b` | Replace run clearing with `count = 0` | `l2b: forget leaves no runs` | 1 | 1 failed, 75 filtered | `tmp/codex/l2-mutations/l2b.log` |
| `l2c` | Omit journey-store deletion | `l2c: record after forget starts a recording` | 1 | 1 failed, 75 filtered | `tmp/codex/l2-mutations/l2c.log` |

Each mutation was restored. The full toolset file then passed 76 tests. `stage.ts`, the mutation JSON files, the original snapshot, and `results.json` retain the controls and outcomes. No MCP `prove` receipt is claimed: no callable `prove` tool was exposed, and harness-level registration was outside the writable scope. The evidence is the executed Vitest controls.

The validation table reports the final runs. Every command in this table ran with `env -C /home/user/browser/tmp/worktrees/l2`. The format and lint path list was exactly: `src/core/BrowserJourneyToolset.ts`, `src/core/constants.ts`, `src/core/types.ts`, `src/core/stores/MemoryBrowserRunStore.ts`, `src/server/stores/FileBrowserRunStore.ts`, `tests/src/core/BrowserJourneyToolset.test.ts`, `tests/src/core/BrowserReplay.test.ts`, `tests/src/core/stores/suite.ts`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts`, `tests/src/server/stores/FileBrowserRunStore.test.ts`, `tests/setupServer.ts`, `guides/browser.md`, and `README.md`.

| Command after the prefix | Exit | Count / result |
| --- | --- | --- |
| `npx oxfmt --check` with the preceding path list | 0 | 13 files; format accepted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` with the preceding path list | 0 | No diagnostics |
| `npm run check` | 0 | Root and core/server/browser/bin checks pass |
| `npm run test:src:core` | 0 | 50 files, 1,180 passed |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 1 | 3 files, 69 passed, 1 failed; 70 total |
| `npm run test:policy` | 0 | 114 passed, 1 skipped; 115 total |
| `npm run test:guides` | 0 | 248 passed |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts` after mutation restoration | 0 | 76 passed |
| `git diff --check` | 0 | No whitespace errors |
| `node node_modules/@orkestrel/scaffold/dist/agents/skills/orkestrel-harden/scripts/discovery.js --projects src:core,src:server` | 2 | The wrapper reports `vitest list failed`; no census claimed |
| `npx vitest list --config vite.config.ts --project src:core --project src:server --json` | 0 | Direct collection succeeds; this is discovery, not an execution gate |

The deviations and scope notes are bounded as follows.

- **Host validation:** the server failure is the unchanged `reports chmod 000 permission errors from a non-root child with the denied path` case at `tests/src/server/stores/suite.ts:502`. Its `spawnSync` with UID/GID reports `EINVAL` before the child executes. The suite was not weakened or skipped. Rerun the prescribed server-store command on a host supporting that child identity. The distribution case remains for the host after this report, as the brief prescribes.
- **Allowed fixture expansion:** `tests/setupServer.ts:1825` owns the vocabulary that the brief attributes to `tests/distribution.test.ts`; its fixture gains `forget`. `tests/src/core/BrowserReplay.test.ts:506` and its other run-store adapters bind the required `clear` member to the real store. These changes use the brief's test/fixture scope exception. No file serving another unit was changed.
- **Instrumentation:** the initial self-spawning mutation runner received `spawnSync env EPERM` and collected no test. Mutation execution was moved to ordinary harness commands, with the same worktree prefix and no permission escalation. The table records those successful controls, not the refused runner. The supplemental discovery wrapper also failed; direct Vitest listing succeeded. No MCP receipt or complete discovery census is asserted.
- **Procedure:** the initial bootstrap read used the supplied current directory without the required `env -C` prefix; later commands used the prefix. The installed scaffold contract was loaded initially; the brief's explicit `/home/user/scaffold/AGENTS.md` was read later. Its applicable coding laws agree; its additional extension-face rules do not apply to this unit. Types were added before implementation, but their type check ran after the concrete implementations were updated. No baseline absent-tool test was recorded before implementation; the named mutations provide the red controls.
- **Acceptance boundary:** this is the sole writer's unit report. No agent was spawned, and no independent review or campaign acceptance is claimed.

## Host verification (orchestrator, 2026-10-01)

Host gates in the worktree: server 249 (the permission case included), distribution 19 and 4 skipped (the packed vocabulary lists `forget`), service journey 32, service toolset 30. The browser project's `createDocumentToolset` case listed the five journey tools by name; its expectation gains `forget` (`tests/src/browser/factories.test.ts`), and the file passes on the host.
