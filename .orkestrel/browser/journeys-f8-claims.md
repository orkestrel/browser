# F8 claims

Implemented the prescribed replay, preparation-error, store, and concurrent-action repairs. The file-store implementations are unchanged. No commits, index mutations, branch changes, or subagents.

## Numbered claims

1. Replay refuses a dialog opened between completed steps, without sending `Page.handleJavaScriptDialog`. The protocol fixture opens the dialog from the first step's event, so the dialog tool is available when replay reaches the following step. The test checks the refusal sentence, outcomes, and absence of the protocol command: `tests/src/core/BrowserReplay.test.ts:464`. Mutation f8a removes replay's admission check and makes that test fail because the run completes.
2. An interrupted step emits its result without attempting a screenshot or store capture, and replay reaches the following dialog and suffix. Implementation: `src/core/BrowserReplay.ts:109`. The file-like recording store refuses captures while the fixture dialog is open; the test requires screenshots only after closure and captures only for s2 and s3: `tests/src/core/BrowserReplay.test.ts:325`. Mutation f8b restores the interrupted capture and stops the run.
3. Preparation refusals carry machine-readable context. Input refusals carry `{ parameter }`; gaps carry `{ step }`; placement refusals carry `{ step, action, placement }`. Format and invalid-journey refusals preserve validator context or receive `{ action: 'replay', placement }`: `src/core/BrowserReplay.ts:167`. The journey tool reads context to identify the parameter, gap, and placement instead of parsing error messages or reconstructing which input failed: `src/core/BrowserJourneyToolset.ts:361`. Validator prose remains the human-readable reason for format/invalid sentences. Every preparation error code has a direct context assertion and a tool-sentence assertion: `tests/setup.ts:3195`, `tests/src/core/BrowserJourneyToolset.test.ts:641`. Mutation f8c drops gap context and breaks the journey tool's sentence.
4. Memory run writes require an allocation belonging to that store and journey: `src/core/stores/MemoryBrowserRunStore.ts:44`. The shared suite refuses both an unopened run and a run allocated by another store: `tests/setup.ts:3368`. Deletion also removes the memory allocation, matching the file store's removal of its owned directory.
5. Both memory stores refuse negative paging with `BROWSER_JOURNEY_PATH` and the file store's sentence, `Paging requires nonnegative integers`: `src/core/stores/MemoryBrowserJourneyStore.ts:60`, `src/core/stores/MemoryBrowserRunStore.ts:80`. The shared journey/run cases exercise offset and limit separately: `tests/setup.ts:3305`, `tests/setup.ts:3382`. Guards also match the file store's safe-integer requirement.
6. The memory journey store uses the file twin's stale sentence, `Journey check-ready changed; read it before writing again.`, with the actual journey name substituted: `src/core/stores/MemoryBrowserJourneyStore.ts:39`. The shared stale-write assertion pins that sentence in both environments: `tests/setup.ts:3291`.
7. The concurrent identical-call test requires `second.action` to be defined as well as distinct from `first.action`: `tests/src/core/BrowserToolset.test.ts:130`.

## Mutations

Each command uses the prefix `env -C /home/user/browser/tmp/worktrees/f8 npx vitest run --config vite.config.ts --project src:core`, followed by the file and filter listed here, then `--reporter=default --reporter=json --outputFile=tmp/codex/f8-mutations/<id>.json`.

| Mutation | Edit | File and test filter | Exit | Collected result |
| --- | --- | --- | --- | --- |
| f8a | Delete dialog admission check | `tests/src/core/BrowserReplay.test.ts -t 'refuses a dialog opened between steps without answering it'` | 1 | 1 failed; 26 filtered out |
| f8b | Keep capture after interrupted outcome | `tests/src/core/BrowserReplay.test.ts -t 'skips capture after an interrupted step and reaches its dialog'` | 1 | 1 failed; 26 filtered out |
| f8c | Drop gap error context | `tests/src/core/BrowserJourneyToolset.test.ts -t 'maps every preparation refusal and a missing journey to its sentence'` | 1 | 1 failed; 27 filtered out |

The mutation sources and JSON reports are under `tmp/codex/f8-mutations/`. The original source was restored before the final core suite, which passed every targeted case. These are Vitest mutation results, not probe MCP receipts: `no receipt`.

## Validation

All commands ran from `/home/user/browser/tmp/worktrees/f8` with `env -C /home/user/browser/tmp/worktrees/f8`.

Touched-file set: `src/core/BrowserReplay.ts`, `src/core/BrowserJourneyToolset.ts`, `src/core/stores/MemoryBrowserJourneyStore.ts`, `src/core/stores/MemoryBrowserRunStore.ts`, `tests/src/core/BrowserReplay.test.ts`, `tests/src/core/BrowserJourneyToolset.test.ts`, `tests/src/core/BrowserToolset.test.ts`, `tests/setup.ts`.

| Command | Exit | Result |
| --- | --- | --- |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserReplay.test.ts tests/src/core/stores` before repair | 1 | 10 failed, 37 passed; 3 files; 9.15 s |
| Same command after repair | 0 | 47 passed; 3 files; 8.80 s |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserReplay.test.ts tests/src/core/BrowserJourneyToolset.test.ts tests/src/core/stores` | 0 | 75 passed; 4 files; 10.20 s |
| `npx oxfmt --check` over the touched-file set | 0 | 8 files; correct formatting |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched-file set | 0 | 8 files; no diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin TypeScript checks completed |
| `npm run test:src:core` after restoring mutations | 0 | 1,047 passed; 50 files; 39.20 s |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 0 | 40 passed, 1 skipped; 3 files; 7.36 s |
| `npm run test:policy` | 0 | 114 passed, 1 skipped; 1 file; 11.43 s |
| `git diff --check` | 0 | No whitespace errors |

The server skip is the existing chmod-000 permission test: root bypasses mode bits (`tests/setupServer.ts:1625`). Policy conditionally skips its shared-term-file assertion when that file is absent (`tests/policy.test.ts:718`). Mutation filters exclude unrelated tests deliberately.

## Scope notes and deviations

- All source and test edits stay within the brief's owned files. No additional fixture or test file was needed. The stale message was aligned to the existing file-store sentence without adding a constant or editing the file twin.
- Ancillary choices: placement context distinguishes `page` from `dom` using the native navigation capability already used by preparation. Validator failures receive replay/placement context without changing the shared validators. Both memory paging guards use the file twin's safe-integer bounds; run deletion revokes its allocation.
- No probe MCP server is registered in this session. Registering one outside the worktree is outside the writable sandbox. The brief's explicit mutations supply the negative controls; no probe receipt is claimed.
- An initial launcher-based mutation attempt returned failure exit codes without diagnostic output. It was excluded from evidence and replaced by the direct, named Vitest runs with JSON artifacts listed in the mutation table.
- The initial bootstrap read ran in the correct worktree before the brief's `env -C` requirement was known; subsequent shell commands used that prefix.
- No independent acceptance or tree-wide build was attempted. This writing unit returns the requested scoped gates and prescribed mutation evidence for campaign acceptance.
