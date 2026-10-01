# F9 claims: one BrowserError in the packed server bundle

The three file stores import core through `@src/core`, so the built server bundle imports `BrowserError` from `../core/index.js` and declares no copy of it. Through the packed binary, a stale `edit` reports `Journey stale-edit changed since you read it; call journeys, then edit again.`, and before the fix it reported `Editing stale-edit failed: …; call edit again.`.

## Changes

The following lines carry the change; each path is relative to the worktree root.

| Path:line                                           | Change                                                                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/stores/FileBrowserStore.ts:1`, `:8`     | Type and value imports of core go through `@src/core`; two relative value imports merge into one.                                                                                      |
| `src/server/stores/FileBrowserJourneyStore.ts:7`, `:10` | Type and value imports of core go through `@src/core`; three relative value imports merge into one.                                                                                |
| `src/server/stores/FileBrowserRunStore.ts:7`, `:11-16`  | Type and value imports of core go through `@src/core`; four relative value imports merge into one.                                                                                 |
| `tests/setupServer.ts:1437`                         | `SOURCE_HOOK` holds the one module hook the store child scripts register; it resolves `@src/core` to `src/core/index.ts`. The three identical inline hooks at `:1527`, `:1609`, and `:1826` interpolate it. |
| `tests/setupServer.ts:2617-2713`                    | `FIFO_PATHS`, `createFifo`, `openFifoWriter`, `readExitedProcessId`, `BundleImports`, and `readBundleImports`.                                                                          |
| `tests/distribution.test.ts:37`, `:41-56`           | Imports of `BROWSER_JOURNEY_LOCK_FILE`, `createFileBrowserJourneyStore`, and the setup helpers.                                                                                         |
| `tests/distribution.test.ts:1177`                   | `requireFifo` gates the stale case the way `requireProcessTable` gates the process-table cases: it fails under `--mode release` and skips elsewhere.                                    |
| `tests/distribution.test.ts:1428`                   | Case: the packed binary refuses a stale `edit` with the stale sentence.                                                                                                                 |
| `tests/distribution.test.ts:1487`                   | Case: the packed server bundle imports `BrowserError` from core and redeclares no core binding.                                                                                         |
| `tests/setupServer.test.ts:178`, `:202`, `:211`     | Proofs for `createFifo` with `openFifoWriter`, `readExitedProcessId`, and `readBundleImports`.                                                                                          |

`git diff --stat` reports the following on 2026-10-01:

```text
 src/server/stores/FileBrowserJourneyStore.ts |   6 +-
 src/server/stores/FileBrowserRunStore.ts     |  12 +-
 src/server/stores/FileBrowserStore.ts        |   5 +-
 tests/distribution.test.ts                   |  90 +++++++++++++++
 tests/setupServer.test.ts                    |  75 ++++++++++++-
 tests/setupServer.ts                         | 158 +++++++++++++++++++++------
 6 files changed, 299 insertions(+), 47 deletions(-)
```

No other `src/server` file carries a relative import of core: `grep -rn "from '\.\./\.\./core\|from '\.\./core" src/server` returns no line after the change. `src/server/BrowserMCPServer.ts` is unchanged.

## Claims

1. The built server bundle imports every core binding it uses from `../core/index.js` and declares none of them. After `npm run build`, line 1 of `dist/src/server/index.js` imports `BrowserError` with 16 other core names from `"../core/index.js"`, and `grep -c 'BrowserError$1\|class BrowserError'` returns 0 for `dist/src/server/index.js` and `dist/src/server/index.cjs`. Before the fix the same bundle declared `var BrowserError$1 = class extends Error` at `dist/src/server/index.js:1125`.
2. Through the packed binary and the mcp stdio client, an `edit` whose journey moved after the tool read it fails with exactly `Journey stale-edit changed since you read it; call journeys, then edit again.`, and the journey keeps the moved revision 2. The case `packed browse binary > refuses an edit whose journey moved after the tool read it with the stale sentence` proves it.
3. The packed server bundle imports `BrowserError` from core and redeclares no core binding under its own name or a bundler's `NAME$N` rename. The case `packed server bundle > imports BrowserError from the core bundle and declares no core binding of its own` proves it.
4. The store child scripts in `describeFileBrowserStores` load store source under Node only while `SOURCE_HOOK` resolves `@src/core`. Mutation `f9b` proves it.
5. `createFifo`, `openFifoWriter`, `readExitedProcessId`, and `readBundleImports` behave as their TSDoc states: `lstatSync` reports the created path as a FIFO, a second `createFifo` on the path throws, `openFifoWriter` exhausts a 50 ms budget with no reader and returns a writer whose bytes a reader receives, `process.kill(pid, 0)` throws `ESRCH` for the returned identifier, and `readBundleImports` returns the literal expected names for a fixture bundle, an alias, a second specifier, and an absent specifier.

No `prove` closing line exists for any claim. Each claim concerns a built bundle or a spawned binary, which `.claude/rules/tests.md` § Probes routes to a test rather than to `prove`, and the `probe` server's `prove` tool is not in this lane's tool set.

## Failing first

The following command and counts record the defect before the fix, with the tests written and `dist/` built from the unfixed source.

| Command                      | Before the fix (log)                                                  | After the fix (log)                                       |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run test:distribution`  | exit 1; 2 failed, 17 passed, 4 skipped of 23 (`tmp/codex/f9-mutations/before-fix.log`) | exit 0; 19 passed, 4 skipped of 23 (`tmp/codex/f9-mutations/after-fix.log`) |

The two failing tests before the fix are the cases claims 2 and 3 name. The stale case received `Editing stale-edit failed: Journey stale-edit changed since you read it; call edit again.`, and the bundle case received `redeclared` equal to `["BrowserError"]`.

## Mutations

Each mutation sits as a patch under `tmp/codex/f9-mutations/`. The worktree was restored and rebuilt after each one; `git diff --stat` after restoration matches the preceding diffstat.

| Mutation | Patch       | Change                                                                                     | Command                                                                                                       | Result                                                                                                                                       |
| -------- | ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `f9a`    | `f9a.patch` | `FileBrowserJourneyStore.ts` imports `BrowserError` from `../../core/errors.js` again; `npm run build` | `npm run test:distribution` (`f9a.log`)                                                                        | exit 1; 2 failed, 17 passed, 4 skipped of 23. The failures are exactly the stale case and the bundle case; the bundle declared `var BrowserError$1` at `:1125` again. |
| `f9b`    | `f9b.patch` | `SOURCE_HOOK` loses its `@src/core` line                                                   | `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserJourneyStore.test.ts` (`f9b.log`) | exit 1; 3 failed, 20 passed of 23. The failures are the dead holder lock, the competing process, and the chmod 000 cases, each with `ERR_MODULE_NOT_FOUND` for `@src/core`. |

After `f9a`, `npm run build` ran again from the restored source and `dist/src/server/index.js` declared no `BrowserError` copy.

## Validation

The following commands ran from the worktree root, in order, on the final source; the combined output is `tmp/codex/f9-mutations/validation.log`.

| Command                                                                                     | Exit | Counts                                   |
| ------------------------------------------------------------------------------------------- | ---- | ---------------------------------------- |
| `npx oxfmt --check` over the 6 touched files                                                | 0    | 6 files formatted                        |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 6 touched files               | 0    | no diagnostic                            |
| `npm run check`                                                                             | 0    | no diagnostic                            |
| `npm run build`                                                                             | 0    | `dist/` rebuilt from the final source    |
| `npm run test:src:server`                                                                   | 0    | 11 files; 223 passed of 223              |
| `npm run test:distribution`                                                                 | 0    | 19 passed, 4 skipped of 23               |
| `npm run test:policy`                                                                       | 0    | 114 passed, 1 skipped of 115             |
| `npx vitest run --config vite.config.ts --project setup tests/setupServer.test.ts`          | 0    | 45 passed of 45                          |

The 4 distribution skips are inapplicable entry cases: `installed entry . > publishes what it declares to a real browser`, `installed entry ./server > publishes what it declares to a real browser`, `installed entry ./browser > publishes what it declares to a Node import`, and `installed entry ./browser > publishes what it declares to a Node require` (`tmp/codex/f9-mutations/distribution-verbose.log`). The same 4 skipped before the fix. The policy skip is `denylist currency > registers every substitution-table term as either matched or judged`. `git diff --check` exits 0.

## Deviations

1. The literal prescription cannot produce a stale `edit`. The `edit` tool reads the journey and writes it in one call (`src/core/BrowserJourneyToolset.ts:281` reads, `:292` writes), so a direct `set` before `edit` leaves the tool reading the moved revision, and the edit succeeds. The case keeps every prescribed step (`record`, `save`, a direct store's `set` over the same root, and an `edit` carrying the revision the tool read) and makes the order deterministic: a FIFO stands at the journey's `journey.lock`, so the server's write parks while it reads the lock holder; the test removes the FIFO path, moves the revision with the direct store, then writes an exited process's identifier, which the server reclaims before its stale check. A host that creates no FIFO at a path skips the case, and fails it under `--mode release`, the way `requireProcessTable` treats a host without `/proc`.
2. The bundle assertion reads more than the text `class BrowserError`. The duplicate the build emits is `var BrowserError$1 = class extends Error`, which a search for `class BrowserError` misses. `readBundleImports` reads the names the bundle imports from `../core/index.js` and refuses a declaration of any of them under the same name or a `NAME$N` rename; the case asserts the import list contains `BrowserError` and the redeclared list is empty.
3. Scope note: `tests/setupServer.test.ts` is outside the owned list. It holds the proofs for the setup exports this unit adds, which the brief's scope rule assigns to this unit.
4. Scope note: the import correction broke the 3 store child scripts in `describeFileBrowserStores`, which load store source under Node and resolved core only through relative `.js` specifiers. `SOURCE_HOOK` in `tests/setupServer.ts`, an owned file, resolves `@src/core` and replaces the 3 identical inline hooks.

No shared-file patch is pending, and no file serving another unit was touched. No probe remains in the source tree.
