# J9 claims: stopped at the capture boundary

J9 is not implemented. The capture confinement obligation requires a change outside the assigned store path. The existing replay passes a filename directly to the page's writer; that writer follows a pre-existing symbolic link and creates missing parent directories. A real filesystem probe reproduced both behaviors.

## Changes

The unit wrote only the following evidence artifacts. No production source or test was edited.

| Path | Content |
| --- | --- |
| `tmp/units/journeys/j9-claims.md:1` | This deviation report, claims, and validation status |
| `tmp/codex/j9-capture-boundary.ts:1` | Node TypeScript probe using the real file writer, an ordinary-file positive control, a pre-existing capture symlink, and a missing run directory |
| `tmp/codex/j9-capture-boundary.log:1` | Complete probe output and failing confinement assertion |

## Numbered claims

1. **The design includes capture-time confinement.** The file-store obligations in `/home/user/browser/.orkestrel/browser/journeys-design.md:366` require an `lstat` check for each component, explicitly including captures, and say the writer creates no directory. The excluded threat is a replacement raced between a check and its use. The probe creates the symlink before calling the writer, so it does not exercise that exclusion.

2. **The store contract has no capture-time operation.** `src/core/types.ts:2060` supplies a slot with an id and an optional directory string. The run-store operations at `src/core/types.ts:2066` contain no capture writer or path-validation callback. Replay calls `open` before executing steps at `src/core/BrowserReplay.ts:87`, then calls its capture path at `src/core/BrowserReplay.ts:108`. The capture method at `src/core/BrowserReplay.ts:311` passes a constructed path directly to `view.screenshot`. A store's earlier path check or later run write cannot check the capture destination immediately before these bytes are written.

3. **The existing file writer violates the required capture behavior.** `src/server/writers/FileBrowserWriter.ts:30` calls recursive `mkdir` and then `writeFile`, with no link check. The probe's ordinary-file control passes. Its linked destination overwrites the external fixture with bytes `[4,5,6]`, and its missing run directory is created. See `tmp/codex/j9-capture-boundary.log:1`. The assertion “a capture symlink present before write must be refused” fails at `tmp/codex/j9-capture-boundary.ts:29`. This is a writer-boundary reproduction, not a browser/replay integration run.

4. **The repair crosses another unit's ownership.** J1 owns the core contracts and J5 owns replay, as recorded at `/home/user/browser/.orkestrel/browser/journeys-design.md:489` and `/home/user/browser/.orkestrel/browser/journeys-design.md:493`. The general writer contract at `src/core/types.ts:197` explicitly requires creating parent directories; existing factory tests at `tests/src/server/factories.test.ts:34` exercise that behavior. Changing that contract globally is not an incidental class, test, or export addition for the named file stores. A confined writer also needs wiring into the capture path before it can enforce J9's obligation.

## Deviation and patch disposition

**Expected:** Complete the file twins and prove capture confinement, including refusal of a symbolic link at the capture component and use of only directories created by `open`.

**Found:** The real capture sink follows a link present before its write and creates an unopened run directory. Replay reaches that sink without returning to the store.

**Required stop:** The brief at `tmp/units/journeys/j9-brief.md:5` says, “Stop and report under the deviation contract only for a file that serves another unit.” The capture wiring and its governing core contract meet that condition. No permission is requested by this report; the campaign orchestrator must reconcile the boundary and re-dispatch the unit.

**Done:** Read the brief, applicable contracts, design, memory-store semantics, shared suites, and capture path; reproduce the conflict; write this report.

**Not done:** File-store implementation, conformance/filesystem suites, factories, exports, prescribed mutations, or acceptance gates. No patch is supplied or applied: choosing and wiring a capture boundary is an unowned contract decision.

**Repair hypothesis:** Give journey captures a root-confined writer that checks every component immediately before writing and requires the directory opened by the run store; wire it through the replay/page boundary while preserving ordinary writer behavior. The orchestrator must assign that contract and wiring before J9 can claim the whole obligation.

**Command deviations:** The initial read omitted the required `env -C` prefix, although its printed directory was the assigned worktree. All subsequent shell commands used the prefix. An initial probe-file emission had a quoting error; the file was completely replaced before execution. No resulting partial file survives.

No subagent, dependency change, scaffold-owned edit, commit, stash, reset, checkout, or index-wide git command was used. Formal `prove` was unavailable in the callable tool catalog; no formal receipt is claimed.

## Mutation table

The prescribed controls require an implementation. None ran, and no mutation evidence is claimed.

| Control | Required breaking edit | Named assertion | Exit / count |
| --- | --- | --- | --- |
| j9a | Return undefined for corruption | Not implemented | Not run |
| j9b | Compare expected outside the lock | Not implemented | Not run |
| j9c | Reset revision on delete | Not implemented | Not run |
| j9d | Drop one component's link check | Not implemented | Not run |

## Validation table

Commands ran from the assigned worktree through `env -C /home/user/browser/tmp/worktrees/j9`. The probe writes only its owned scratch fixture and removes it in `finally`, including on assertion failure.

| Command | Exit | Measured result |
| --- | --- | --- |
| `node tmp/codex/j9-capture-boundary.ts` | 1 | Ordinary-file control passed; confinement assertion failed; external fixture overwritten; unopened directory created |
| `git diff --name-only -- src/server tests/setup.ts tests/src/server` | 0 | No changed source/test paths |
| `npx oxfmt --check` over touched source/tests | Not run | No source/test edits |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched source/tests | Not run | No source/test edits |
| `npm run check` | Not run | Stopped before implementation |
| `npm run test:src:server` | Not run | Stopped before implementation |
| `npm run test:src:core` | Not run | Stopped before implementation |
| `npm run test:policy` | Not run | Stopped before implementation |

The permission case and two-process case did not run. No passing or skipped test count is claimed. Independent review and campaign acceptance remain with the orchestrator.

