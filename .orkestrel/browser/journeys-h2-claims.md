# H2 claims

The H2 repairs are implemented. Each prescribed mutation fails its named assertion, and the restored implementation passes core, type, formatting, lint, policy, and guide gates. The server-store gate is not green: 61 tests pass and the permission test fails before its child can start with a different UID (`spawnSync /opt/node22/bin/node EINVAL`). This report replaces the stopped attempt's report.

## Changes and numbered claims

The implementation and its proofs establish these claims.

1. **Recording reserves its name before the first await.** `src/core/BrowserJourneyToolset.ts:173` reserves before the store read; its catch releases the reservation and destroys any constructed recorder. `tests/src/core/BrowserJourneyToolset.test.ts:117` requires one concurrent success and one `BROWSER_JOURNEY_RECORDING` refusal, the first recorder's saved steps, and no leaked action subscription. Refused-name and aborted-start cleanup are covered at `tests/src/core/BrowserJourneyToolset.test.ts:72` and `tests/src/core/BrowserJourneyToolset.test.ts:92`. The direct foreign-hold case at `tests/src/core/BrowserJourneyToolset.test.ts:154` checks `BROWSER_TOOLSET_BUSY` and the exact busy sentence.
2. **Direct construction inherits the owner's cap.** `src/core/BrowserJourneyToolset.ts:88` reads `toolset.limit` when the journey option is omitted. Constructor and overflow refusals name the journeys limit. `src/core/types.ts:2159` documents the default. `tests/src/core/BrowserJourneyToolset.test.ts:178` requires a directly constructed journey toolset over a `limit: 10` owner to return the 10-character listing and continuation footer. Existing override and surrogate-pair cases pass.
3. **Fault rendering consumes structured names and reasons.** `src/core/types.ts:2042` defines readonly `name` and `reason`. `src/server/stores/FileBrowserJourneyStore.ts:61` preserves a normalized validation reason separately from the path-bearing point-read error; `src/server/stores/FileBrowserStore.ts:280` uses that reason or a code-based path-free clause. `src/core/helpers.ts:2650` renders `NAME cannot be read: REASON`; `src/core/BrowserJourneyToolset.ts:250` deduplicates by name and calls it. The leaf test at `tests/src/core/helpers.test.ts:1193` and tool test at `tests/src/core/BrowserJourneyToolset.test.ts:40` retain a meaningful slash in the reason. Existing file-listing tests prove deduplication across pages. `tests/src/server/stores/FileBrowserRunStore.test.ts:187` checks the run store's shared fault shape.
4. **Stores consume shared checks, and invalid journey names precede shape validation.** `validateBrowserJourneyName` at `src/core/helpers.ts:2609` throws `BROWSER_JOURNEY_PATH`; the memory journey store calls it before its validator at `src/core/stores/MemoryBrowserJourneyStore.ts:40`. Memory get/delete and run open/get/delete/list use it too. `validateBrowserStorePage` at `src/core/helpers.ts:2622` checks safe integer bounds with `BROWSER_JOURNEY_ARGUMENT`; both memory stores and `src/server/stores/FileBrowserStore.ts:256` consume it. The shared suite at `tests/src/core/stores/suite.ts:35` checks invalid-name `set`, including an invalid format, against both journey twins. Direct helper cases at `tests/src/core/helpers.test.ts:1209` and `tests/src/core/helpers.test.ts:1217` cover length, reserved names, NaN, infinity, fractional/unsafe bounds, and signed zero.
5. **Membership and native step keys have shared homes.** `src/core/constants.ts:842` derives non-step tools from the observation and journey-name constants. `BROWSER_JOURNEY_STEP_KEYS` at `src/core/constants.ts:848` owns `ref`, `tab`, and `secret`; the grammar reads it at `src/core/helpers.ts:2948`, and the recorder reads it at `src/core/recorders/BrowserRecorder.ts:142`. Grammar and recorder tests pass in the full core run.
6. **Validation supplies binding coordinates rather than requiring edit attribution to rediscover them.** `src/core/types.ts:2048` declares `BrowserJourneyValidationContext`; `src/core/validators.ts:17` guards it with the installed contract primitives. `src/core/helpers.ts:3045` supplies parameter, step, and field. The editor at `src/core/helpers.ts:2586` looks up the field and secret-declaration origins without rechecking invariants 4 and 5. `normalizeBrowserJourneyReason` at `src/core/helpers.ts:2637` replaces the editor's and journey toolset's duplicated normalization. Coordinate, hostile-context, and normalization cases accompany the existing edit-origin and atomicity cases.
7. **Replay wording and the requested guide rows are aligned.** `src/core/BrowserReplay.ts:194` and `src/core/BrowserJourneyToolset.ts:378` use `has no parameter named "X"`; direct replay and tool tests assert it. `guides/browser.md:295`, `guides/browser.md:301`, `guides/browser.md:314`, and `guides/browser.md:315` repair the requested Errors rows. The Receipts table separates the journeys offset code and names the journeys overflow limit. Surface rows document every added symbol; the journey prose explains the fault shape and direct cap default. `guides/browser.md:3153` says a retried save includes actions recorded after the refusal. Guide parity passes.

## Mutation table

Each control changes only `src/core/BrowserJourneyToolset.ts`, preserves its import graph, and runs this command with its id substituted for `ID`:

```text
env -C /home/user/browser/tmp/worktrees/h2 npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts -t ID
```

The measured failures distinguish the repaired behaviors.

| Mutation | Breaking edit | Named assertion | Exit and result |
| --- | --- | --- | --- |
| `h2a` | Move the reservation after `await recorder.start()` | `h2a: one recording wins and the second is refused` | 1; 1 failed, 38 filtered/skipped; both calls fulfilled |
| `h2b` | Restore the `BROWSER_TOOL_LIMIT` default | `h2b: direct construction lists at the owner cap of 10` | 1; 1 failed, 38 filtered/skipped; the complete listing replaced the capped listing |
| `h2c` | Scrape the reason with the former path-removal expression | `h2c: the store reason is rendered verbatim once` | 1; 1 failed, 38 filtered/skipped; `read/write` became `read` |

Artifacts are under `tmp/codex/h2-mutations/`: each `h2*.source.txt`, corresponding `*-verified.log`, `verified.json`, `original.source.txt`, and `apply.ts`. Run `apply.ts ID` to apply a recorded control and `apply.ts restore` to restore, through the worktree's `env -C` wrapper. Final core and focused runs used the restored source.

## Validation table

Final commands use `env -C /home/user/browser/tmp/worktrees/h2`. `tmp/codex/h2-files.json` records the touched-file population; `tmp/codex/h2-*-verified.log` retains complete final outputs.

| Command | Exit | Counts or result |
| --- | --- | --- |
| Baseline: `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserJourneyToolset.test.ts tests/src/core/stores/MemoryBrowserJourneyStore.test.ts` | 1 | 3 failed, 44 passed, 47 collected: concurrent records, direct cap, invalid-name `set` |
| Same focused command after repair and restoration | 0 | 50 passed across 2 files; added cases cover faults and reservation cleanup |
| `npm run check:src:core` after the type edit | 2 | Expected migration errors: removed fault `path` and `message` consumers |
| `npm run check:src:core` after implementation | 0 | No diagnostics |
| `npx oxfmt --check` over touched files | 0 | 20 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched TypeScript files | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, browser, and bin pass |
| `npm run test:src:core` | 0 | 1,104 passed across 50 files |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 1 | 61 passed, 1 failed, 62 collected across 3 files; UID-changing child spawn fails with `EINVAL` |
| `npm run test:policy` | 0 | 114 passed, 1 skipped; existing absence-of-local-substitution-table skip at `tests/policy.test.ts:718` |
| `npm run test:guides` | 0 | 248 passed |
| `git diff --check --` with the explicit touched-file list | 0 | No whitespace errors |

## Scope notes and deviations

These limits remain explicit.

- **Server permission proof:** Expected: a non-root child proves `BROWSER_JOURNEY_ACCESS` against chmod-000 files. Found: the UID/GID spawn at `tests/src/server/stores/suite.ts:484` fails with `EINVAL` before the child executes, in both server-store runs. No test was weakened or skipped. The gate needs a host permitting that subprocess operation; this unit does not claim it passed.
- **Permitted scope extensions:** `tests/src/server/stores/suite.ts` and `tests/src/server/stores/FileBrowserRunStore.test.ts` consumed the replaced fault shape and were updated under the brief's test allowance. No implementation outside the owned list changed. The supplied `BrowserToolset.limit`, interface member, and observation constant were consumed without editing `BrowserToolset.ts`.
- **File-store name method:** The file engine consumes the shared paging helper. Its existing `validateName` and reserved-name cleanup remain with the other lane because H2 owns only paging and fault shape in that file. Both journey-store twins reject invalid `set` names with `BROWSER_JOURNEY_PATH`, as the shared suite proves.
- **Hold integration:** The Errors row includes `hold()` as prescribed. This worktree's `BrowserToolset.hold` still queues earlier holds at `src/core/BrowserToolset.ts:428`; H2 does not change or claim a second-hold refusal. That admission behavior belongs to the other lane. H2 independently proves recording refusal under a foreign hold.
- **Instrument availability:** No `prove` MCP tool is registered. No probe receipt is claimed; evidence comes from the mandated direct mutation controls and restored-source tests. Registering a harness service outside the worktree is outside the unit's writable scope.
- **Subprocess capture:** An initial Node `spawnSync` runner produced unusable captures; its diagnostic probe reported `spawnSync env EPERM`. Those results were discarded. Verified controls and gates ran through the harness execution tool with output read directly. The discarded runner and empty mutation logs were removed by exact owned paths.
- **Command wrapper:** The initial read of the brief and contracts used the correct worktree but omitted `env -C`. It changed no files. Subsequent shell commands used the wrapper.
- **Acceptance boundary:** This is a sole-writer unit report, not campaign acceptance. No sub-agent, commit, stash, reset, checkout, index mutation, or scaffold-owned edit was used. Integrated acceptance and the host permission proof remain with the orchestrator.
