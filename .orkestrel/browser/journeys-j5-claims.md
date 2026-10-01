# J5 claims

Implemented the toolset recorder, replay, memory journey and run stores, factories, shared store conformance suites, and host service proofs. The service assertions remain unexecuted under this unit's explicit host-only boundary.

## Changes

The implementation and its proofs occupy the brief's owned paths.

| Location | Change |
| --- | --- |
| `src/core/recorders/BrowserRecorder.ts:27` | Subscribes to action/hold/release; owns lifecycle, snapshot isolation, sequential ids, semantic targets, secret bindings, interruption gaps, child-frame gaps, and held-journey gaps. |
| `src/core/recorders/BrowserRecorder.ts:77` | Builds and validates the journey, deriving its secret declarations and next id. |
| `src/core/BrowserReplay.ts:64` | Prepares, acquires the hold, executes the prefix, finalizes, and persists the run. |
| `src/core/BrowserReplay.ts:166` | Validates before any hold or store call; resolves inputs and refuses gaps and incompatible placement. |
| `src/core/BrowserReplay.ts:209` | Calls `performBrowserStep` with the substituted arguments, actual step id, hold token, signal, and secret flag. Retains the correlated action even when the helper throws, so timeout and navigation-stage evidence survive. |
| `src/core/BrowserReplay.ts:286` | Collects page output without duplicate subscriptions, captures through the page writer into the opened directory, and bounds the final store write with an independent signal. |
| `src/core/stores/MemoryBrowserJourneyStore.ts:17` | Owns clones, compares expected revisions atomically, keeps counters across delete, and pages sorted names. |
| `src/core/stores/MemoryBrowserRunStore.ts:17` | Mints collision-checked ids without directories, owns run clones, and pages runs by id within one journey. |
| `src/core/factories.ts:171` | Adds the recorder, replay, journey-store, and run-store factories. |
| `src/core/index.ts:41` | Exports the implementing classes. |
| `tests/setup.ts:3075` | Adds journey/action fixtures and the synchronous `describeBrowserJourneyStore(name, factory)` and `describeBrowserRunStore(name, factory)` registrations. Factories may return a store or a promise of one, with a fresh store per case. |
| `tests/setup.ts:3287` | Adds the transparent outbound transport recorder and changed-document fixtures for the host proofs. The existing element fixture also accepts an optional writer for real page-capture tests. |
| `tests/src/core/recorders/BrowserRecorder.test.ts:5` | Proves recording rules, lifecycle, ownership, and subscriptions. |
| `tests/src/core/BrowserReplay.test.ts:24` | Proves preparation, execution, interruption, abort, persistence, captures, output, and secret handling. |
| `tests/src/core/stores/MemoryBrowserJourneyStore.test.ts:4` | Runs the shared journey-store suite. |
| `tests/src/core/stores/MemoryBrowserRunStore.test.ts:5` | Runs the shared run-store suite and proves directory absence. |
| `tests/src/core/factories.test.ts:101` | Composes the factories through a recorded replay and persisted run. |
| `tests/service/journey.test.ts:77` | Adds claim 3 over changed ids/classes/order, then duplicate names with zero outbound input frames. |
| `tests/service/journey.test.ts:139` | Adds claim 4 with a uniquely matching CSS selector and an absent semantic target. |

## Numbered claims

1. **Recorder mapping.** Completed actions retain role, exact name, and reference evidence; switches retain semantic tab data; adopted arguments remain literal. Refused calls and every observation/journey tool are absent. An interrupted action becomes its action and the immediately successful dialog, or a gap. Non-main frame actions become the prescribed child-frame gap. Held actions become one `replayed NAME` gap. Lifecycle events and snapshot isolation are tested at `tests/src/core/recorders/BrowserRecorder.test.ts:6`, `tests/src/core/recorders/BrowserRecorder.test.ts:60`, `tests/src/core/recorders/BrowserRecorder.test.ts:103`, and `tests/src/core/recorders/BrowserRecorder.test.ts:185`. Mutation j5a attacks refused-call omission.

2. **Preparation before effects — design claim 8.** Invalid format, missing/unknown inputs, gaps, and unsupported native actions reject with coded errors before a hold or page operation. Every negative case checks the hold/page counters, and preparation leaves no saved run. See `tests/src/core/BrowserReplay.test.ts:25` and `tests/src/core/BrowserReplay.test.ts:46`. Mutation j5c makes the hold counter fail. A switch with context passes preparation and resolves its tab when reached at `tests/src/core/BrowserReplay.test.ts:348`.

3. **Execution and stopping — design claims 5 and 8.** Inputs override defaults without changing the journey. Replay records triggers, literal adopted arguments, correlated action receipts, and step events. Manager refusals without an action stop the run. A later missing target preserves the successful prefix. An interrupted action admits its immediate dialog continuation; interruption without that continuation stops. An unprompted dialog refuses when reached. A timeout and a requested navigation both prevent the suffix. See `tests/src/core/BrowserReplay.test.ts:119`, `tests/src/core/BrowserReplay.test.ts:163`, `tests/src/core/BrowserReplay.test.ts:182`, `tests/src/core/BrowserReplay.test.ts:214`, `tests/src/core/BrowserReplay.test.ts:268`, and `tests/src/core/BrowserReplay.test.ts:631`. Mutation j5b attacks the timeout stop. Native receipt equality remains J4's proof; this unit does not claim a host receipt-equality run.

4. **Finalization and persistence.** Abort releases the hold, saves an aborted run under a fresh signal, and sends no suffix input. Failed writes return their fault after release; a store that ignores its signal still cannot hold execute beyond the 1,000 ms write bound. Captures use the page writer and only the directory returned by open; capture failure retains the executed step and stops the suffix. Console/error listeners are removed. See `tests/src/core/BrowserReplay.test.ts:400`, `tests/src/core/BrowserReplay.test.ts:438`, `tests/src/core/BrowserReplay.test.ts:472`, `tests/src/core/BrowserReplay.test.ts:512`, `tests/src/core/BrowserReplay.test.ts:544`, and `tests/src/core/BrowserReplay.test.ts:582`.

5. **Secret recording and replay — design claim 13's J5 portion.** Secret recording replaces the text with a lower camel case binding, using the helper's collision/invalid-name fallback. Replay supplies the actual text and `secret: true` to the real input path, but omits secret input/text from the run, persists no output, and requests no capture even when a run directory exists. The stored run and rendered run contain no secret value. See `tests/src/core/recorders/BrowserRecorder.test.ts:127` and `tests/src/core/BrowserReplay.test.ts:686`. Generated-module and listing proofs remain with their owners.

6. **Memory-store conformance.** The shared suites prove missing get/delete, ownership, set/get, expected-revision refusal, revision continuity across delete/recreate, sorting, paging/truncation, empty faults, unknown-format refusal, and signal handling. The run suite proves unique producer ids and journey/id isolation. See `tests/setup.ts:3112` and `tests/setup.ts:3203`. Mutation j5d attacks the expected-revision comparison.

7. **Host semantic resolution — design claims 3 and 4, written but unverified.** The service cases record an actual toolset click, replace ids/classes/order, and replay against the unique exact name. Duplicate names refuse with no input frames. A CSS selector matching Cancel cannot resolve Submit order; the locator returns `BROWSER_JOURNEY_TARGET`, and replay stops without input or a CSS query. Both negative cases carry a positive control that must produce trusted input and an outbound mouse frame. See `tests/service/journey.test.ts:77` and `tests/service/journey.test.ts:139`. These claims need the host run.

## Mutation evidence

Each control ran alone, collected its named assertion, failed that assertion, and was restored. The controls, restoration snapshots, complete logs, and launcher exit records are under `tmp/codex/j5-mutations/`. `run.ts refresh` saves the source, `run.ts ID` applies a control, and `run.ts restore` restores it. The final core run includes all restored assertions.

| Control | Breaking edit | Named assertion and failure | Exit and measured count |
| --- | --- | --- | --- |
| j5a | Removes the recorder's refused-action filter | `never records refused actions`: expected no steps, received an unresolved refused-click step | 1; 1 failed, 19 filtered |
| j5b | Continues after assigning stopped instead of breaking | `stops after timeout without executing a suffix step`: expected 1 run step, received 2 | 1; 1 failed, 23 filtered |
| j5c | Takes and destroys a hold before validation | `validates before taking a hold or writing a run`: expected 0 holds, received 1 | 1; 1 failed, 23 filtered |
| j5d | Disables the expected-revision comparison | `refuses stale expected revisions and retains the accepted value`: the stale write resolves at revision 3 instead of rejecting | 1; 1 failed, 6 filtered |

## Deviations and integration notes

- **Error spelling:** The brief explicitly prescribes `BROWSER_JOURNEY_STALE`; the interface documentation at `src/core/types.ts:2029` says `BROWSER_JOURNEY_REVISION`. The implementation and shared conformance suite follow the brief. P1, `tmp/units/journeys/j5-stale-doc.patch`, aligns that documentation and passes `git apply --check`. It is report-only; no type file was edited. J9 must use the brief's spelling to pass the shared suite.
- **Shared test registration:** The brief explicitly places the conformance describe blocks in `tests/setup.ts`, overriding the general rule excluding assertions from setup modules. They register only when called by a store test.
- **Page capability access:** The public toolset exposes a generic view, with no page getter. Replay checks only the live emitter and screenshot members it uses, without requiring a concrete page class or editing another unit's public type. Placement uses native tools plus the manager's context switch registration.
- **Ancillary outcomes:** A timed-out recording becomes an unresolved gap. An orphaned interruption is flushed as a gap at stop. Run listings sort by id. Capture/open failures stop the run and record a fault; a capture failure retains its completed step. Memory runs have no directory and therefore no captures.
- **Host boundary and discovery:** Browser, setup, and service projects were not executed, as the brief requires. The canonical discovery script always lists every project, even with `--projects`; its broad listing was not run. A core-only file listing confirms discovery of the owned core proofs. The only added test timeout is 15,000 ms for the real toolset's 5,000 ms navigation-settlement deadline; the service browser connection uses the existing 20,000 ms launch convention. No added skip, todo, retry, or conditional skip was found in the owned test files.
- **Formal instrument:** No prove MCP tool is registered. Installing one outside this checkout is outside the unit's writable scope. No formal probe receipt is claimed; the mutation table supplies the requested negative controls.
- **Command correction:** The initial read used the correct worktree but omitted the required `env -C` prefix. Every subsequent shell command uses that prefix. An initial file-emission command lost shell quotes; those files were fully replaced before validation. No resulting change survives.
- **Test-fixture correction:** The first scoped command over recorder, replay, and memory tests reported 49 passed and 1 timeout. That abort case withheld a mouse-release acknowledgement used by input cleanup. The corrected case aborts a pending text insertion, as the existing helper proof does; the scoped and core runs pass it.
- **Scope and acceptance:** All source/test edits are inside the named ownership. The optional writer seam stays in the owned setup module. No dependency, scaffold-owned file, public type, or guide was edited; no commit, stash, reset, checkout, or index-wide mutation was issued. No subagent was spawned. Independent review, J12 guide parity, host execution, and campaign acceptance remain with the Orchestrator.

## Host handoff

Run the service claims on the host that supplies Chromium and permits loopback listeners:

```text
npx vitest run --config vite.config.ts --project service tests/service/journey.test.ts
```

J9 can call the shared suite functions with a factory that returns a fresh file store per case. Its own setup/teardown owns the temporary directories. The fixtures write run data only after calling open, so a file run store receives a created slot.

## Validation

Every command after the initial read ran through `env -C /home/user/browser/tmp/worktrees/j5`. Format and lint cover the 13 touched source/test files in the Changes table; repeated rows in that table identify multiple responsibilities in one file. The final core and policy runs follow import consolidation and mutation restoration.

| Command | Exit | Measured result | Evidence |
| --- | --- | --- | --- |
| `npx oxfmt --check` over touched files | 0 | 13 files formatted | Bare command output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched files | 0 | No diagnostics | Bare command output |
| `npm run check` | 0 | Root plus core/server/browser TypeScript checks pass | `tmp/codex/j5-check-final.log`, `.err`; launcher duration 14,680 ms |
| Scoped Vitest run of recorder, replay, both memory stores, and factories | 0 | 63 passed across 5 files | `tmp/codex/j5-scoped.log`, `.err` |
| `npm run test:src:core` | 0 | 1,021 passed across 49 files; no skipped tests | `tmp/codex/j5-core-final.log`, `.err`; launcher duration 37,844 ms |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip, 115 collected | `tmp/codex/j5-policy-final.log`, `.err`; launcher duration 4,257 ms |
| `npx vitest list --config vite.config.ts --project src:core --filesOnly` | 0 | 49 core files, including every owned core test | Bare command output |
| `git diff --check -- src/core tests/setup.ts tests/src/core tests/service/journey.test.ts` | 0 | No whitespace errors | Bare command output |
| `git apply --check tmp/units/journeys/j5-stale-doc.patch` | 0 | P1 applies without changing the worktree | Bare command output |
| Browser, setup, and service projects | Not run | Assigned to the host by the brief | Host handoff |
