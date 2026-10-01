# H4 claims

The prescribed implementation and mutation proofs are complete. Format, lint, type checking, policy, and guide parity pass. The required server and setup runs fail in this sandbox; their results and host follow-ups follow. No commit or index mutation was made, and no other writer was dispatched.

## Changes and numbered claims

1. `BrowserLockObserver` lives in `tests/setupServer.ts:2465` and imports the store implementation directly at `tests/setupServer.ts:61`. The filesystem suite imports it at `tests/src/server/stores/suite.ts:11`; the store test imports it at `tests/src/server/stores/FileBrowserStore.test.ts:18`. The setup proof at `tests/setupServer.test.ts:94` checks that observation follows a real check, preserves its presence result, and does not run after confinement or cancellation refuses the check.
2. Global setup obtains `reservePort` from its dynamically loaded service module. The interface declares it at `tests/setupGlobal.ts:51`, the guard requires a function at `tests/setupGlobal.ts:88`, and launch calls it at `tests/setupGlobal.ts:181`. `tests/setupService.ts:20` exports the existing server helper. Global setup has no static import from `setupServer`. The guard regression at `tests/setupGlobal.test.ts:208` failed before the implementation and passes after it.
3. `formatBrowserLockEntry` and `parseBrowserLockEntry` own the persisted entry format at `src/server/helpers.ts:47` and `src/server/helpers.ts:59`. The parser returns the positive safe holder pid or `undefined`, validating the lowercase UUID token without returning unused fields. The store uses them at `src/server/stores/FileBrowserStore.ts:180` and `src/server/stores/FileBrowserStore.ts:195`. Filesystem fixtures use the formatter; child-holder assertions use the parser. Independent expected strings and malformed inputs are covered at `tests/src/server/helpers.test.ts:44`. The installed contract's general integer parser does not enforce this filename grammar or safe positive pid bound.
4. Journey-name admission relies on the existing name pattern at `src/server/stores/FileBrowserStore.ts:42`. The redundant reserved array and check are removed. The existing reserved-name proof at `tests/src/server/stores/suite.ts:622` passes in the full server run. `BROWSER_JOURNEY_LOCK_DIRECTORY` names the directory at `src/server/constants.ts:218`; its consumers changed only at `src/server/stores/FileBrowserJourneyStore.ts:14`, `src/server/stores/FileBrowserJourneyStore.ts:73`, and `src/server/stores/FileBrowserJourneyStore.ts:108`. Guide parity covers the renamed constant at `guides/browser.md:1230` and the helpers at `guides/browser.md:1269` and `guides/browser.md:1270`; the removed constant's row is gone.
5. An unexpected directory-removal failure produces `BROWSER_JOURNEY_ACCESS` with the lock directory in both message and context. The proof at `tests/src/server/stores/FileBrowserStore.test.ts:21` lets release unlink its own entry, verifies the directory is empty, then replaces that directory with a nonempty regular file after the real check. The ensuing `rmdir` fails with `ENOTDIR`, reaching `src/server/stores/FileBrowserStore.ts:385`. The replacement's bytes survive. Mutation `h4a` fails this proof.
6. Acquisition retries when the directory disappears after `mkdir` reports `EEXIST` and before `readdir`. The observer removes the directory after the check immediately preceding that read at `tests/src/server/stores/suite.ts:30`; acquisition returns `entered` and releases its directory. Mutation `h4b` replaces the retry at `src/server/stores/FileBrowserStore.ts:191` with `break` and fails this proof.

## Mutation table

The runner is `tmp/codex/h4-mutations/run.ts`. It restores the source in `finally`. Each mutation has a source snapshot, full test log, and JSON command/exit record. The runner invokes Node's installed Vitest entry directly, equivalent to `npx vitest`.

| Mutation | Breaking edit | Named assertion | Exit and collected result | Artifacts under `tmp/codex/h4-mutations/` |
| --- | --- | --- | --- | --- |
| `h4a` | Replace the unexpected `rmdir` throw with `return` | `names the directory with ACCESS when release cannot rmdir it`: `rmdir failure names the denied directory` | 1; 1 failed, 16 filtered out; promise resolved instead of rejecting | `h4a.log`, `h4a.json`, `h4a.ts` |
| `h4b` | Replace `if (entries === undefined) continue` with `break` | `retries a lock directory that vanishes after EEXIST and before readdir`: `vanished directory retries acquisition` | 1; 1 failed, 27 filtered out; rejected with `BROWSER_JOURNEY_LOCKED` | `h4b.log`, `h4b.json`, `h4b.ts` |
| Restored source | Restore both original branches | Both named tests | 0; 2 passed, 43 filtered out | `tmp/codex/h4-restored.log` and `tmp/codex/h4-restored.err` |

No `prove` MCP tool is registered in this session. No receipt is claimed; the evidence is the requested collected Vitest mutations. Initial synchronous child-launch attempts returned `EPERM` before collecting tests and are not mutation evidence. The completed runner uses asynchronous child launch and records actual assertion failures.

## Validation table

Every edit and validation command ran through `env -C /home/user/browser/tmp/worktrees/h4`. The table omits that shared prefix. Longer gates used the installed scaffold dispatch launcher with bounded caps; none reached its cap. Full logs are under `tmp/codex/` with the `h4-check`, `h4-server`, `h4-setup`, `h4-policy`, `h4-guides`, and `h4-restored` stems and `.log`/`.err` extensions.

The format and lint file arguments were:

```text
src/server/helpers.ts src/server/constants.ts
src/server/stores/FileBrowserStore.ts src/server/stores/FileBrowserJourneyStore.ts
tests/setupServer.ts tests/setupGlobal.ts tests/setupService.ts
tests/setupGlobal.test.ts tests/setupServer.test.ts
tests/src/server/stores/suite.ts tests/src/server/stores/FileBrowserStore.test.ts
tests/src/server/helpers.test.ts guides/browser.md
```

The measured results are:

| Command | Exit | Counts or result |
| --- | --- | --- |
| `npx oxfmt --check` with the listed files | 0 | 13 files; all matched files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` with the listed files | 0 | No diagnostics |
| `npm run check` | 0 | Root and core/server/browser/bin TypeScript projects passed |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server` | 1 | 243 tests: 179 passed, 64 failed; 6 files passed, 5 failed |
| `npx vitest run --config vite.config.ts --project setup tests/setupGlobal.test.ts tests/setupServer.test.ts` | 1 | 55 tests: 32 passed, 23 failed; 1 unhandled error |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run test:guides` | 0 | 248 passed |
| `npx vitest run --config vite.config.ts --project setup tests/setupGlobal.test.ts -t 'requires a callable reservePort export'` before repair | 1 | 1 failed, 8 filtered out; `missing reservePort is refused` received `true` |
| The identical guard command after repair | 0 | 1 passed, 8 filtered out |
| `npx vitest run --config vite.config.ts --project setup tests/setupGlobal.test.ts tests/setupServer.test.ts -t 'isBrowserServiceModule\|BrowserLockObserver'` | 0 | 3 passed, 52 filtered out |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserStore.test.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts tests/src/server/helpers.test.ts -t 'FileBrowserStore\|file store filesystem contracts\|BrowserLockEntry'` | 1 | 32 passed, 1 failed, 56 filtered out; existing uid/gid child-launch failure |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserStore.test.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts -t 'names the directory with ACCESS when release cannot rmdir it\|retries a lock directory that vanishes after EEXIST and before readdir'` | 0 | 2 passed, 43 filtered out after restoration |
| `git diff --check` | 0 | No whitespace diagnostics |

## Deviations and host follow-up

- The removal proof uses deterministic directory-to-file replacement to produce `ENOTDIR`, rather than permission bits. It exercises the prescribed unexpected-`rmdir` branch after successful entry unlink and requires no permission skip.
- The full server run reports 62 direct `listen EPERM` failures. Another browser launch test exits before readiness with child code 12. The existing permission proof cannot spawn its uid/gid child (`spawnSync /opt/node22/bin/node EINVAL`, assertion at `tests/src/server/stores/suite.ts:501`). These failures remain visible; no skip or weakening was added.
- The full setup run reports loopback refusals, downstream assertions that cannot reach their intended launch state, a loopback wait timeout, and one unhandled loopback error. The built-binary `startBrowseChild` proof also times out at `tests/setupServer.test.ts:179`; its cause is not proven. Rerun these full commands on the host. Browser-project boundary/runtime acceptance remains the host run named by the brief.
- No ownership expansion was needed. `src/server/index.ts` already exports the helpers and constants through star exports. `FileBrowserRunStore.ts` has no reference to the renamed constant. Neither file needs a textual change. No constants-only test was added.
- The initial read of the brief and contracts used the tool's worktree cwd before adopting explicit `env -C`. All subsequent shell commands used that prefix. The work remained in the assigned checkout.
