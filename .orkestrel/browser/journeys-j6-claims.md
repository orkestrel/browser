# J6 claims: page recorder

The page recorder emits semantic journey steps and composes `compileBrowserJourney`. The local validation passes. The Chromium claims are written but unverified here; the brief assigns their execution to the host. Guide parity remains with J12. No commit or index mutation was made.

## Changes

The implementation retains the conforming parts of the interrupted attempt and completes its fixture, service proofs, validation, and mutation evidence.

| Location | Change |
| --- | --- |
| `src/core/recorders/BrowserCodegen.ts:39` | Moves the recorder from `src/core/BrowserCodegen.ts`; implements the recorder lifecycle, ordered semantic projection, owned snapshots, journey construction, and compilation. |
| `src/core/recorders/BrowserCodegen.ts:84` | Installs the page session and reads the page's live frame-session set at each start, including a restart after stop. |
| `src/core/recorders/BrowserCodegen.ts:194` | Enables the page domain before installing the document listener; removes installed scripts and bindings during teardown. |
| `src/core/recorders/BrowserCodegen.ts:248` | Keys target resolution by session, execution context, and document-local node index; starts accessibility lookup immediately and serializes projection in binding order. |
| `src/core/recorders/BrowserCodegen.ts:305` | Folds text-control clicks and open edits; closes edits at submission, focus departure, navigation, and stop; drops Enter's implicit click; records prescribed gaps. |
| `src/core/constants.ts:253` | Replaces the CSS listener with a readable, self-contained listener that sends password markers and only Enter key payloads. |
| `src/core/parsers.ts:561` | Validates the gesture payload, refuses malformed and secret-bearing shapes, and retires the navigation-action parser. |
| `src/core/types.ts:2132` | Makes `BrowserCodegenInterface` extend `BrowserRecorderInterface` with `script`; retires the CSS action/options/event types and retains the language/script types. |
| `src/core/types.ts:2142` | Declares the sanitized binding payload consumed by the parser and recorder. |
| `src/core/types.ts:3147` | Updates the page entry to accept `BrowserRecorderOptions`. |
| `src/core/BrowserPage.ts:688` | Shares the pending codegen startup before returning its singleton. |
| `src/core/BrowserPage.ts:904` | Supplies the live frame-session reader, publishes the recorder before installation so concurrent frame setup can join it, and destroys a failed startup. |
| `src/core/BrowserPage.ts:1264` | Awaits recorder installation on an attached frame before that frame resumes. |
| `src/core/index.ts:35` | Exports the moved class. |
| `src/core/helpers.ts:1815` | Removes `normalizeCodegenActions`; the following declaration is the retained frame decoder. |
| `src/core/compilers.ts:425` | Removes `compileCodegenScript`; retains J7a's journey compiler. |
| `tests/src/core/recorders/BrowserCodegen.test.ts:13` | Replaces the retired CSS recorder tests with semantic, lifecycle, session, password, and compilation assertions. |
| `tests/src/core/parsers.test.ts:288` | Replaces the retired action-parser cases with valid gesture and malformed-payload cases. |
| `tests/src/core/helpers.test.ts:1044` | Removes the retired normalization and CSS pipeline cases. |
| `tests/src/core/compilers.test.ts:182` | Removes the retired CSS compiler cases and retains journey compilation proofs. |
| `tests/src/core/BrowserPage.test.ts:1616` | Updates codegen startup protocol replies for `Page.enable`. |
| `tests/setup.ts:2568` | Updates the scripted CDP boundary for semantic target lookup. |
| `tests/setup.ts:3497` | Executes the shipped listener against inert DOM boundary data to inspect actual binding strings. |
| `tests/setup.ts:3531` | Supplies the fixture's independent event logger, complete fixture document, and event-log projection. |
| `tests/service/codegen.test.ts:74` | Adds the claim 12 Chromium gestures, independent oracle comparison, and inbound password-frame assertion. |
| `tests/service/codegen.test.ts:154` | Adds live edit boundaries, contenteditable input, navigation exclusion, and stop behavior. |
| `tests/service/browser.test.ts:580` | Removes the obsolete contenteditable CSS compilation/replay proof; the other obsolete `#save` replay proof is removed from the same file. |

## Numbered claims

1. **Semantic recording.** A trusted click records its role and exact accessible name. Clicking a text control and editing it produces one committed `type` step. Input updates collapse only while that edit remains open. See `tests/src/core/recorders/BrowserCodegen.test.ts:14`, `tests/src/core/recorders/BrowserCodegen.test.ts:47`, and `tests/src/core/recorders/BrowserCodegen.test.ts:183`.

2. **Submission boundaries.** Enter on an edited form field commits `type` with `submit: true`, and its detail-zero click contributes no extra step. An unedited field records `press`; an edited field outside a form records its edit followed by `press`. A later edit cannot overwrite the submitted value. See `tests/src/core/recorders/BrowserCodegen.test.ts:81`, `tests/src/core/recorders/BrowserCodegen.test.ts:143`, and `tests/src/core/recorders/BrowserCodegen.test.ts:222`. Controls j6b and j6c fail the corresponding assertions.

3. **Explicit gaps.** Single selects record their round-tripping value. A non-round-tripping option, multiple selection, child-frame element, native dialog answer, or reported unsupported gesture produces an unresolved gap. Navigation closes the edit without producing a navigation step. Dialog answer content is absent from the recorded steps. See `tests/src/core/recorders/BrowserCodegen.test.ts:259` and `tests/src/core/recorders/BrowserCodegen.test.ts:335`.

4. **Password boundary.** The executed listener sends a marker for password input and no non-Enter key payload. The parser rejects a password payload containing a value. The recorder derives a secret parameter from the accessible name, and script compilation uses that binding. The listener assertion includes an ordinary-text positive control. See `tests/src/core/recorders/BrowserCodegen.test.ts:375`, `tests/src/core/recorders/BrowserCodegen.test.ts:412`, and `tests/src/core/parsers.test.ts:288`. Control j6a exposes the fixture password and fails the raw-payload assertion.

5. **Session installation and identity.** Existing frame sessions install during start; a restart reads the live set rather than retaining detached session ids. Frames attached during recording install after `Page.enable` and before `Runtime.runIfWaitingForDebugger`. Target resolution carries the execution context and preserves event order. See `tests/src/core/recorders/BrowserCodegen.test.ts:431`, `tests/src/core/recorders/BrowserCodegen.test.ts:464`, and `tests/src/core/recorders/BrowserCodegen.test.ts:520`. Controls j6d and j6e fail installation assertions.

6. **Lifecycle and artifacts.** Stop drains received work and commits the pending edit. Clear invalidates queued pre-clear work. Returned collections are owned snapshots. Restart starts fresh; teardown releases subscriptions; concurrent startup joins; failed startup can retry. `journey()` derives secret parameters and `next`, and `script()` equals `compileBrowserJourney` over that journey. See `tests/src/core/recorders/BrowserCodegen.test.ts:375`, `tests/src/core/recorders/BrowserCodegen.test.ts:566`, and `tests/src/core/recorders/BrowserCodegen.test.ts:598`.

7. **Malformed input containment and retirement.** The binding parser returns undefined for malformed JSON, retired action shapes, invalid node indices, unknown members, missing required gesture fields, password values, and non-Enter keys. The CSS action engine and its consumers are removed. TypeScript and the complete core project pass against the replacement contract. See `src/core/parsers.ts:561` and `tests/src/core/parsers.test.ts:288`.

8. **Chromium claim 12: written, not verified.** The service test drives trusted clicks and keystrokes through the real page API. Its oracle uses fixture-declared names and the fixture's own event log, independent of the recorder's AX lookup and binding. It covers main-page edits, Enter and its click, unedited Enter, single and multiple selects, same-origin and out-of-process frame clicks, a native confirmation answered through CDP, password input, and a duplicate-valued select. It compares all projected steps, requires both frame gaps, and asserts that no inbound transport frame contains the fixture password or its prefix while ordinary text does appear. A separate case covers edit boundaries and contenteditable. See `tests/service/codegen.test.ts:74` and `tests/service/codegen.test.ts:154`. This report makes no live-browser success claim.

## Mutation evidence

Each control was applied alone, collected its named assertion, failed that assertion, and restored its source in `finally`. The final core run follows restoration. `tmp/codex/j6-mutations/run.ts` accepts an optional control id. Each control has `.original`, `.mutant`, `.log`, and `.err` artifacts in that directory.

| Control | Breaking edit | Named assertion and observed failure | Exit and measured count |
| --- | --- | --- | --- |
| j6a | Sends `element.value` with the password marker | `the shipped listener never sends password text or non-Enter keys`: raw payload contains the fixture password | 1; 1 failed, 14 filtered |
| j6b | Disables the detail-zero implicit-click fold | `drops the implicit click between Enter and submit`: an extra click step appears | 1; 1 failed, 14 filtered |
| j6c | Removes edit flushing at Enter and submit | `never collapses edits across a submission`: the submitted first edit disappears | 1; 1 failed, 14 filtered |
| j6d | Removes the page's awaited child-session installation | `installs on every attached frame before resume`: no document script installation appears before resume | 1; 1 failed, 14 filtered |
| j6e | Removes installation of the live frame-session set at start | `installs existing frame sessions on start and reinstalls the live set after stop`: expected an installed child script, received none | 1; 1 failed, 14 filtered |

The command inside each control is `npx vitest run --config vite.config.ts --project src:core tests/src/core/recorders/BrowserCodegen.test.ts -t NAME`, wrapped by the canonical launcher with a 90-second cap. Restored validation collects every assertion without filtering.

## Validation

Commands ran from this worktree through `env -C /home/user/browser/tmp/worktrees/j6`, except the first status and diff commands used the exact `git -C` form requested by the user. Formatting and lint cover the 16 surviving touched source/test files, including the untracked moved files and service proof. Complete launcher stdout and stderr were read without filtering.

| Command | Exit | Measured result | Evidence |
| --- | --- | --- | --- |
| Scoped recorder/parser tests after completing the fixture | 0 | 31 passed across 2 files | Bare Vitest output |
| Scoped recorder tests including the frame-start repair | 0 | 15 passed across 1 file | Bare Vitest output |
| `npx oxfmt --check` over touched files | 0 | 16 files formatted | Bare command output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched files | 0 | No diagnostics | Bare command output |
| `npm run check` after mutation restoration | 0 | Root and core/server/browser TypeScript checks pass | `tmp/codex/j6-check-restored.log`, `.err`; 23,640 ms |
| `npm run test:src:core` after mutation restoration | 0 | 996 passed across 49 files, no skipped tests | `tmp/codex/j6-core-restored.log`, `.err`; 40,331 ms |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip, 115 collected | `tmp/codex/j6-policy.log`, `.err`; 6,432 ms |
| `npm run test:guides` | 1 | 12 failed, 195 passed, 207 collected | `tmp/codex/j6-guides.log`, `.err`; 3,543 ms |
| `npx vitest list --config vite.config.ts --project src:core --filesOnly` | 0 | 49 core files, including the moved recorder proof | Bare command output |
| `git diff --check` | 0 | No whitespace errors | Bare command output |
| Browser, setup, and service projects | Not run | Assigned to the host by the brief | Host command follows |

## Deviations, corrections, and integration notes

- **Recovery correction:** The partial attempt ended inside the fixture's confirmation-button string. Its initial scoped run failed to collect both requested test files with an unterminated-string diagnostic. Completing the fixture produced the passing recorder/parser run. Initial service-test type errors used frame-local `elements`, which the frame interface does not expose; the proof uses `page.elements`, the existing cross-frame element manager. These corrections are applied in the worktree.
- **Frame restart correction:** Startup formerly installed existing children only through the page's first codegen creation. The class now reads the page-owned live session set at each start. Control j6e removes that line and fails the regression assertion; the restored full core run passes it.
- **Scope notes:** `tests/setup.ts` owns the existing recorder boundary fixture and the added recorder-service fixture/oracle. `tests/src/core/BrowserPage.test.ts` and `tests/service/browser.test.ts` are tests of the named page entry and retired compiler. They fall under the brief's test-of-a-named-symbol extension. The payload type and page-interface signature in `src/core/types.ts` support the named parser and entry. The frame-install line in `BrowserPage` is required by J0's prescribed pre-resume ordering. No file serving another unit was edited.
- **Concrete integration members:** The concrete recorder exposes `attach(session)` for the page's awaited pre-resume hook, and accepts an optional live-frame reader in its constructor. `page.codegen()` still returns the prescribed interface, whose only member beyond `BrowserRecorderInterface` is `script`. J12 must account for the concrete `attach` hook in class documentation/parity; the guide run explicitly reports it alongside the inherited-method and retired-API drift.
- **CSS retirement:** `parseCodegenNavigateAction` also retires because navigations no longer produce CSS actions. The old service compiler/replay assertions are removed; semantic generated-module execution remains J7's proof, while this unit's service file covers recording and contenteditable input.
- **Guide ownership:** No guide or guide test was edited. The observed failures include missing journey exports and toolset members from earlier units, retired CSS symbols, recorder members and summaries, and links to the moved test. The measured count is reported for J12 rather than suppressed.
- **Formal instrument:** No callable prove MCP tool was registered. Registering one in user-level harness configuration lies outside this unit's writable scope. No formal probe receipt is claimed; the mutation artifacts are the requested negative controls.
- **Validation boundaries:** The source-listener test uses inert DOM boundary data and proves emitted payload strings, not Chromium behavior. The service assertions are typechecked but require the host run. No browser, setup, or service project was executed. No dependency or scaffold-owned file was changed; no subagent, commit, stash, reset, checkout, or index-wide mutation was used.
- **Patches:** All owned changes are applied directly. No report-only source patch is pending. Independent review and campaign acceptance remain with the Orchestrator.

Run the live proof on the host that permits loopback listeners and supplies Chromium:

```text
env -C /home/user/browser/tmp/worktrees/j6 npx vitest run --config vite.config.ts --project service tests/service/codegen.test.ts
```
