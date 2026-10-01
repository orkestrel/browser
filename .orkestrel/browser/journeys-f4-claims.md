# F4 claims

**Blocked on execution: the permission test is implemented, but the sandbox cannot spawn the required non-root child.** The host has `nobody` with uid/gid 65534; the process namespace maps only uid/gid 0. Spawning Node with uid/gid 65534 returns `EINVAL` before the child executes. Claim 10 and mutation `f4b` remain unproved.

The addendum supersedes the original stale-read prescription. No stale-read interleaving change is delivered, and the existing held-lock precedence test remains unchanged. The first attempt's withdrawn findings remain in `tmp/units/journeys/f4-claims-attempt1.md`; they are not acceptance evidence for this narrowed unit.

## Changes and numbered claims

The implementation and measured limits are:

1. **The blanket root skip is removed.** `tests/setupServer.ts:1625` registers the permission case. When the parent is root, it reads the nobody account and supplies its uid/gid to `spawnSync`; when the parent is non-root, the child inherits its identity. The only conditional skip is an absent nobody account, with an explicit reason at `tests/setupServer.ts:1636`. Account detection finds 65534/65534 on this host; see `tmp/codex/f4-mutations/identity.json:1`. The absent-account branch has not been executed.
2. **The fixture targets unreadable files, with traversable directories.** The test creates real journey and run records, makes their directories traversable at `tests/setupServer.ts:1658`, verifies parent readability before applying mode 000 at `tests/setupServer.ts:1702`, and restores modes and destroys the owned scratch directory at `tests/setupServer.ts:1723`. Existing run-file coverage is retained.
3. **The child and parent contain the required assertions, but the child assertions are unreached.** The child asserts non-root identity, checks mode 000, requires native `EACCES`, and calls the real journey/run stores at `tests/setupServer.ts:1682`. The parent requires a successful child exit, matching uid/gid, and rejected outcomes containing `BROWSER_JOURNEY_ACCESS` and each denied path at `tests/setupServer.ts:1712`. The resolver maps local JavaScript import suffixes to TypeScript source and replaces no implementation.
4. **The launch failure is independently reproduced.** `tmp/codex/f4-mutations/identity.ts:4` spawns Node with 65534/65534 without loading project code. It records `EINVAL` and namespace maps containing only `0 0 1`; see `tmp/codex/f4-mutations/identity.json:1`. Account existence does not establish that this namespace can assume that identity.
5. **Production files and the mirrored test file are unchanged.** The implementation change is confined to `describeFileBrowserStores` and its embedded child script in `tests/setupServer.ts`. The existing registration at `tests/src/server/stores/FileBrowserJourneyStore.test.ts:20` reaches it. A scoped source/test diff and byte comparison passed. No production defect or production patch is claimed.

## Mutation results

Mutation artifacts are under `tmp/codex/f4-mutations/`. The mutation runner refuses to apply a source mutation when its baseline is not green.

| Case | Intended result | Measured result | Exit |
| --- | --- | --- | --- |
| Direct permission test, original source | Non-root child returns ACCESS errors naming both files | Test fails at child launch with EINVAL; 1 failed, 17 excluded by the name filter | 1 |
| `f4b`: replace permission translation ACCESS with FILE | Only the permission assertion fails on the changed error code | Candidate saved as `f4b.ts`; not applied because the baseline cannot execute | Not run |
| Mutation runner baseline | Green before applying `f4b` | Nested Vitest returned 1 with empty output; no test count inferred from that invocation | 1 |
| Production source preservation | Byte-identical source after runner | `applied: false`, `restored: true`; independent `cmp` passed | 0 |
| `f4a` stale-read interleaving | Withdrawn by addendum | Not repeated or delivered | Not run |

The runner and results are `tmp/codex/f4-mutations/permission.ts:1` and `tmp/codex/f4-mutations/permission-result.json:1`. The mutation changes the translation branch in `src/server/stores/FileBrowserStore.ts:282`. A failure to launch a child does not kill this mutation. There is no mutation receipt or red-to-green permission proof.

## Validation

The following commands ran from this worktree with `env -C /home/user/browser/tmp/worktrees/f4`. Gate outputs are preserved in `tmp/codex/f4-mutations/addendum-*.log`.

| Command after the environment prefix | Exit | Count or result |
| --- | --- | --- |
| `npx oxfmt --check tests/setupServer.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts` | 0 | 2 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/setupServer.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts` | 0 | No diagnostics |
| `npm run check` | 0 | Root and core/server/browser/bin TypeScript checks pass |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores` | 1 | 38 collected: 37 passed, 1 failed; 3 files, 2 passed and 1 failed |
| `npm run test:policy` | 0 | 115 collected: 114 passed, 1 skipped; 1 file passed |
| `node node_modules/vitest/vitest.mjs run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserJourneyStore.test.ts -t 'reports chmod 000'` | 1 | 18 collected: 1 failed, 17 excluded by name filter; EINVAL at child launch |
| `node tmp/codex/f4-mutations/identity.ts` | 0 | Recorder succeeds; child launch returns EINVAL and no exit status |
| `node tmp/codex/f4-mutations/permission.ts` | 1 | Baseline fails; mutation not applied |
| `git diff --exit-code -- src/server/stores/FileBrowserStore.ts src/server/stores/FileBrowserJourneyStore.ts tests/src/server/stores/FileBrowserJourneyStore.test.ts` | 0 | No changes |
| `cmp tmp/codex/f4-mutations/permission-original.ts src/server/stores/FileBrowserStore.ts` | 0 | Byte-identical source |

The store-suite failure is exclusively the permission child launch; see `tmp/codex/f4-mutations/addendum-stores.log:1`. The policy skip is the substitution-table parity case at `tests/policy.test.ts:718`: this target does not author the local `.claude/rules/writing.md` table. It is unrelated to filesystem permission testing.

## Deviations and remaining work

**Expected:** execute the permission case as nobody, assert ACCESS with the path, and kill `f4b`. **Found:** the namespace maps only identity 0, and the independent child spawn returns EINVAL. **Done:** the permission test implementation, the launch probe, all prescribed validation commands, and this replacement report. **Not done:** a successful non-root child run and a valid mutation kill. The unit remains blocked and is not accepted.

The sandbox also denies a fresh mode-000 read by the root parent. Parent readability is therefore established before chmod, not by a successful root read after chmod. The test does not claim root bypasses mode bits on this host.

The implementation uses bounded synchronous Node spawning with uid/gid options rather than the asynchronous spawn API. Its timeout is 10000 ms. Permission translation and path assertions retain the existing run case as well as the addendum's journey case. No production source mutation was applied.

The initial command that opened the brief used the correct working directory but omitted its not-yet-read `env -C` prefix. Subsequent commands use that prefix. Validation ran directly in this sole-writer unit as the brief requests; no independent verifier or review result is claimed. The commands stayed within this turn and were tracked by execution sessions. No subagents, dependency installs, commits, stash/reset/checkout operations, or index-wide Git commands were used.

Completion requires a test environment whose uid/gid maps admit 65534 and whose process permissions permit the child identity change. Rerun the permission baseline there, apply and restore `f4b`, then rerun the prescribed validation set. No sandbox workaround was attempted.
