# F5 claims: the packed binary under concurrent first calls, two servers, and EOF or SIGTERM with a live browser

Finding: the packed `browse` binary launches one Chromium for two first calls sent at once, gives each server in one consumer directory its own Chromium and profile, and ends its Chromium and removes its profile within `BROWSER_TOOL_TIMEOUT_MS` (5000 ms) on EOF and on `SIGTERM`. Each case reads the host's `/proc` table and the profiles directory. Mutation `f5a` reddens the one-launch case, and mutation `f5b` reddens the EOF case and no other new case. No source defect was found, and no source file changed.

Scope: worktree `/home/user/browser/tmp/worktrees/f5`, branch `ccr-d15a48b1-yyyll6-f5` at `ef2a318`, Linux host, 2026-10-01.

## Changes

Diffstat (`git diff --stat`):

```text
 tests/distribution.test.ts | 187 +++++++++++++++++++++++++++++++++++++++++----
 tests/setupServer.ts       | 164 ++++++++++++++++++++++++++++++++++++++-
 2 files changed, 333 insertions(+), 18 deletions(-)
```

The following changes are in `tests/distribution.test.ts`:

- `tests/distribution.test.ts:19`, `:36`, and `:38`: imports for `realpathSync`, `BROWSER_TOOL_TIMEOUT_MS`, and the setup helpers.
- `tests/distribution.test.ts:1138`: `readBrowseEntry` returns the installed `bin.browse` entry relative to the consumer. It is extracted from `connectBrowse` (`:1179`), which calls it.
- `tests/distribution.test.ts:1147`: `requireBrowseExecutable` resolves the Chromium executable or skips, and fails under `--mode release`. It is extracted from the existing journey case, which calls it at `:1237`.
- `tests/distribution.test.ts:1161`: `requireProcessTable` skips a host without `/proc`, and fails under `--mode release`.
- `tests/distribution.test.ts:1170`: `resolveProfiles` returns `<realpath consumer>/tmp/browsers/.profiles`.
- `tests/distribution.test.ts:1293`: the one-launch case.
- `tests/distribution.test.ts:1329`: the two-server case.
- `tests/distribution.test.ts:1371`: the ending case, registered once per row of `BROWSE_ENDINGS` (`EOF` and `SIGTERM`).

The following changes are in `tests/setupServer.ts`:

- `tests/setupServer.ts:25`, `:26`, and `:47`: imports for `readdirSync`, `dirname`, `resolve as resolvePath`, and `readErrorCode`.
- `tests/setupServer.ts:2247` and `:2250`: the `BrowseEnding` type and the `BROWSE_ENDINGS` table.
- `tests/setupServer.ts:2258`: `endBrowseChild` closes the child's stdin or signals it.
- `tests/setupServer.ts:2271`: `startBrowseChild` sends `initialize` and a first `look`, then returns the answer's text. It throws when that answer is an error.
- `tests/setupServer.ts:2315`: `PROCESS_TABLE` is the capability probe `existsSync('/proc/self/cmdline')`.
- `tests/setupServer.ts:2326`: `ChromiumProcess` holds `pid`, `profile`, and `browser`.
- `tests/setupServer.ts:2344`: `readChromiumProcesses` lists the processes whose `--user-data-dir` sits directly in a given directory. A process with no `--type=` switch is the browser process.
- `tests/setupServer.ts:2376`: `destroyChromiumProcesses` is teardown. It sends `SIGKILL` to every listed process and waits up to 5 seconds until the listing is empty.
- `tests/setupServer.ts:2397`: `readProfiles` lists profile paths in name order and returns an empty list when the directory is absent.

## Claims

1. When two `tools/call` requests go through one stdio client at the same time, the packed binary launches one Chromium. The run creates exactly one profile (`tests/distribution.test.ts:1317`). Exactly one browser process is running, and its `--user-data-dir` is that profile (`:1318`, `:1319`). After the client closes, no process has a profile in the directory, and the directory listing matches its state before the case (`:1321`, `:1322`).
2. Two servers in one consumer directory own two profiles: the run creates two profiles and two browser processes, one per profile (`:1350` to `:1352`). Ending the first server leaves one browser process, which is one of the two observed. Its profile is the only created profile still present (`:1355` to `:1359`). Ending the second server leaves no process and no created profile (`:1361`, `:1362`).
3. A server with a live browser handles EOF as follows: it exits with `{ code: 0, signal: null }` (`:1395`) in less than `BROWSER_TOOL_TIMEOUT_MS` (`:1396`). No Chromium process with a profile in the directory remains (`:1397`). The profile is removed (`:1398`), and stderr is empty (`:1399`).
4. `SIGTERM` sent to the server process alone gives the same results as claim 3. These are the same assertions, from the `SIGTERM` row of `BROWSE_ENDINGS`.
5. Each instrument can tell its cases apart. `readChromiumProcesses` marks the browser process and a `--type=renderer` process in a directory, and leaves out a process whose profile is outside it. `destroyChromiumProcesses` ends only the listed processes. A probe ran these checks: 3 passed. With the directory filter removed, the `readChromiumProcesses` case failed: 1 failed and 2 passed. The probe is promoted as the shared-file patch later in this report. During every run, another unit's Chromium was running under `/tmp/orkestrel-browser-lytCho`. The directory filter kept it out of every listing and every teardown.

Every assertion reads a real process (`/proc/PID/cmdline`, or the child's own exit status) or a real file (the profiles directory). No double is involved.

## Mutations

Each mutation edited `src/server/BrowserMCPServer.ts`, rebuilt with `npm run build`, and ran `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project distribution`. The diffs, the build logs, and the run logs are in `tmp/codex/f5-mutations/`.

| ID         | Diff             | Edit                                                                                                                                               | Build exit | Run exit | Count                               | Reddened                                                                                                                                                                                                                                     |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f5a`      | `f5a.diff`       | `#open` drops `if (current !== undefined) return current`, so every call launches                                                                  | 0          | 1        | 2 failed, 15 passed, 4 skipped (21) | The one-launch case (`expected [ …(2) ] to have a length of 1 but got 2` at `:1317`) and the existing journey case (`no Reveal in page "" about:blank`, because each call opens a fresh browser). The two-server case and both ending rows pass. |
| `f5a-race` | `f5a-race.diff`  | `#open` stores the session only after its launch fulfills, so concurrent first calls launch apart and sequential calls share                       | 0          | 1        | 1 failed, 16 passed, 4 skipped (21) | Only the one-launch case, at `:1317`                                                                                                                                                                                                         |
| `f5b`      | `f5b.diff`       | The stdin `end` listener clears `#profile` before `#end()`, so destroy skips the profile removal on EOF alone                                      | 0          | 1        | 1 failed, 16 passed, 4 skipped (21) | Only the EOF row, at `:1398`. The profile `…/.profiles/574ffeeb-…` was left in place, and the `SIGTERM` row passed                                                                                                                         |

The following restoration checks were run:

- After each mutation, `src/server/BrowserMCPServer.ts` was restored from a copy, and `sha256sum -c tmp/codex/f5-mutations/source.before.sha256` reported `OK` (`e6f31b9b…131e`).
- `dist/` was rebuilt from the restored source. All 17 files hash the same as before the mutations (`diff dist.before.sha256 dist.after.sha256`, exit 0). The validation build matched again (exit 0).
- `git status --short` lists only the two owned test files.
- After the runs, no Chromium with a profile under a `distribution-` scratch directory was running, per `pgrep` and `/proc`.

## Validation

Every command ran from the worktree root through `env -C`.

| Command                                                                                     | Exit | Count                                                       |
| ------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `npx oxfmt --check tests/distribution.test.ts tests/setupServer.ts`                         | 0    | 2 files formatted                                           |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/distribution.test.ts tests/setupServer.ts` | 0    | no diagnostics                                              |
| `npm run check`                                                                             | 0    | root project plus `check:src:{core,server,browser,bin}`     |
| `npm run build`                                                                             | 0    | `dist/` hashes equal to the pre-unit hashes                 |
| `npm run test:distribution` (baseline, before the change)                                   | 0    | 13 passed, 4 skipped (17)                                   |
| `npm run test:distribution` (run 1)                                                         | 0    | 17 passed, 4 skipped (21), 88.48 s                          |
| `npm run test:distribution` (run 2)                                                         | 0    | 17 passed, 4 skipped (21), 62.98 s                          |
| `npm run test:setup`                                                                        | 0    | 153 passed (5 files)                                        |
| `npm run test:policy`                                                                       | 0    | 114 passed, 1 skipped (115)                                 |
| `npm run test:src:bin` (not in the brief, because `BrowseChild` callers share the module)   | 0    | 5 passed                                                    |

The 4 distribution skips are the `installed entry` drives whose `runIf` condition does not apply. The baseline run has the same 4 skips. The verbose mutation logs show that all four new tests ran and passed outside the mutated case.

## Prove

The `prove` tool did not apply. Every claim concerns a process tree and a built entry driven as a child, which `prove` stages do not model (`.claude/rules/tests.md` § Probes). This harness also registers no `probe` server. Closing line: none. The instruments are the mutation runs and the promoted probe in claim 5.

## Failing-first tests

No source defect was repaired, so the red-first evidence comes from the mutations:

- `packed browse binary > launches one Chromium in one profile for two first calls sent at once, and ends both when the client closes [...]` fails under `f5a` and `f5a-race`.
- `packed browse binary > ends its Chromium and removes its profile within the tool deadline on EOF [...]` fails under `f5b`.

## Shared-file patch

`tests/setupServer.test.ts` is not owned, so its proof of the new setup exports is returned as a patch in `tmp/codex/f5-mutations/setupServer.test.patch`. `git apply --check` exits 0 for it. On a scratch copy, `oxfmt --check` and `oxlint --deny-warnings` both exit 0. Its test bodies ran as a probe under the `probe` project with 3 passed, and type-checked under the root compiler options with exit 0. The probe was then deleted. The patch adds the following three proofs:

- `startBrowseChild` rejects a first `look` that answers `ENOENT`, and `endBrowseChild(child, 'EOF')` ends the child with exit 0. This uses `dist/bin/main.js`, as `tests/src/bin/main.test.ts` does.
- `readProfiles` returns an empty list for an absent directory and paths in name order otherwise.
- `readChromiumProcesses` and `destroyChromiumProcesses` run against Node children that carry Chromium's switches, with an out-of-directory control. This proof is gated on `PROCESS_TABLE`.

## Deviations

- The brief asks for two mcp stdio clients on one server. A stdio server reads one stdin, so one server carries exactly one stdio client. In the one-launch case, one client sends both first calls before either answers. The two-client form is the two-server case.
- `SIGTERM` runs as the second row of the ending case (`it.for(BROWSE_ENDINGS)`), so the brief's three cases register four tests. The one-launch and two-server cases also end through the stdio client's close. That close sends `SIGTERM` to the server's process group. Chromium runs detached in its own group (`src/server/helpers.ts:342`), so in those cases the server's own teardown ends Chromium.
- `f5a`, as specified, also reddens the existing journey case, because every call launches a separate browser. `f5a-race` was added to show that the one-launch case alone detects the loss of the shared launch while it is in flight.
- The cases read `/proc`. On a host without it (Windows or macOS), they skip outside release and fail under `--mode release`, as the existing browser gate does. That release rule is the caller's to confirm. The cases ran on this Linux host only, on 2026-10-01.
- One import edit to `tests/distribution.test.ts` used an inline `python3` heredoc rather than the Edit tool or a Node script, which breaks the TypeScript-only script rule. The resulting text equals what an Edit would write, and the format and lint gates pass.
- No source file changed. The mutations were restored byte-equal, as the Mutations section records.
