# J14c objective verdict

REFUTED: claims 13 and 18. UNPROVEN: claim 16, as the brief already rules. The managed pre-abort path leaks the secret; independent probes also reproduce concurrent recording replacement and incomplete preparation of defaulted inputs in generated JavaScript (`tmp/codex/j14c-probe.log:20`, `tmp/codex/j14c-probe.log:38`, `tmp/codex/j14c-probe.log:43`).

Chromium, service, distribution, and integrated-suite results below are the supplied host records, not reruns in this audit. The inspected host records include core 1088 passed, server 239 passed, browser 235 passed with 1 skipped, journey service 31 passed, and distribution 19 passed with 4 skipped (`tmp/codex/gwave-test:src:core.log:10`, `tmp/codex/gwave-fix-server.log:10`, `tmp/codex/gwave-fix-browser.log:10`, `tmp/codex/gwave-service-journey.log:10`, `tmp/codex/gwave-test:distribution.log:10`). The independent probes execute the built package and retain their controls under the authorized prefix (`tmp/codex/j14c-probe.ts:14`, `tmp/codex/j14c-declarations.ts:25`).

## CONFIRMED — Claim 1

Invocation-local action state, dispatch through `perform`, and pre-input target capture meet the handler-reaching contract (`src/core/BrowserToolset.ts:311`, `src/core/BrowserToolset.ts:445`, `src/core/BrowserToolset.ts:1125`). Tests require distinct defined actions for identical concurrent calls, event identity, and a target surviving document replacement (`tests/src/core/BrowserToolset.test.ts:301`, `tests/src/core/BrowserToolset.test.ts:333`). Sharing one action slot or capturing after input would fail those assertions. Dialog and switch results are compared with direct calls in the sequence matrix (`tests/service/journey.test.ts:1144`). The pre-admission failure in N1 does not reach a handler.

## CONFIRMED — Claim 2

The exact branch compares normalized names with case-sensitive equality; the default retains lowercase substring matching (`src/core/helpers.ts:143`). Both managers have the shared name-case assertions (`tests/src/core/elements/BrowserElementManager.test.ts:603`, `tests/src/browser/elements/BrowserDOMElementManager.test.ts:381`). Substituting substring or lowercase equality changes expected membership; the assertions distinguish both mutations.

## CONFIRMED — Claim 3

Resolution admits exactly one semantic match and never consults saved reference evidence (`src/core/helpers.ts:2386`, `src/core/helpers.ts:2433`). Chromium assertions check the changed-page recipient, duplicate refusal, zero protocol input, and zero page clicks, followed by a positive input control (`tests/service/journey.test.ts:130`, `tests/service/journey.test.ts:174`). Trusting the stale reference or choosing the first duplicate fails the recipient/zero-input assertions.

## CONFIRMED — Claim 4

The locator queries only role, name, and exactness, then emits the missing-target code (`src/core/helpers.ts:2386`, `src/core/helpers.ts:2393`). The fixture establishes one CSS match but requires semantic refusal and no selector fallback/input (`tests/service/journey.test.ts:196`, `tests/service/journey.test.ts:213`). A CSS fallback fails this test.

## CONFIRMED — Claim 5

Argument construction, action propagation, interruption continuation, and stop conditions use the shared step path (`src/core/helpers.ts:2431`, `src/core/helpers.ts:2456`, `src/core/BrowserReplay.ts:103`, `src/core/BrowserReplay.ts:282`). The direct/replay tables include dialog and context-backed switch comparisons; the DOM service proof checks the child-frame marker and untouched main-page marker (`tests/service/journey.test.ts:1100`, `tests/service/journey.test.ts:1144`, `tests/service/document.test.ts:189`). Corrupting replay-only dialog/switch receipts fails the tuple equality; adding a reference to non-element arguments is caught by helper argument assertions (`tests/src/core/helpers.test.ts:320`, `tests/src/core/helpers.test.ts:360`).

## CONFIRMED — Claim 6

Admission checks both acquired and waiting holds, recognizes the token, and treats observations separately; replay releases in `finally` (`src/core/BrowserToolset.ts:387`, `src/core/BrowserToolset.ts:462`, `src/core/BrowserReplay.ts:151`). The host tests cover foreign click/dialog/page-tool refusal, pre-admitted work, observations, and abort without a suffix; queued hold cancellation has a separate assertion (`tests/service/journey.test.ts:500`, `tests/service/journey.test.ts:601`, `tests/src/core/BrowserToolset.test.ts:549`). Removing the waiting reservation or final release violates these ordering/cleanup assertions.

## CONFIRMED — Claim 7

The wait timeout assigns a structured timeout while retaining receipt wording, and replay stops on that outcome (`src/core/BrowserToolset.ts:970`, `src/core/BrowserReplay.ts:131`). The Chromium test compares the direct receipt and forbids the suffix input (`tests/service/journey.test.ts:646`). Changing timeout to done fails both the outcome and suffix assertions.

## CONFIRMED — Claim 8

Preparation runs before hold/run allocation; runtime dialog admission requires an interrupted predecessor (`src/core/BrowserReplay.ts:73`, `src/core/BrowserReplay.ts:174`, `src/core/BrowserReplay.ts:259`). Tests assert codes, an unchanged page counter, no input traffic or run files, a positive control, retained prefixes, and no answer to a between-step dialog (`tests/service/journey.test.ts:690`, `tests/service/journey.test.ts:726`, `tests/service/journey.test.ts:747`, `tests/src/core/BrowserReplay.test.ts:536`). Moving preparation after input or deleting the dialog guard fails these assertions.

## CONFIRMED — Claim 9

The editor builds and validates a candidate, and file comparison occurs inside the directory lock (`src/core/helpers.ts:2504`, `src/server/stores/FileBrowserJourneyStore.ts:72`). Atomicity, origin attribution, id allocation, unbound declarations, and merged arguments have direct tests; current-view conversion has a tool test (`tests/src/core/helpers.test.ts:1203`, `tests/src/core/helpers.test.ts:1238`, `tests/src/core/helpers.test.ts:1262`, `tests/src/core/BrowserJourneyToolset.test.ts:591`). The process race and held-lock precedence remain distinct proofs (`tests/src/server/stores/suite.ts:229`, `tests/src/server/stores/suite.ts:532`). Moving comparison outside the lock fails the latter; dead-lock recovery is additionally pinned by claim 17.

## CONFIRMED — Claim 10

Read/validation errors remain errors, writes and revision comparison stay locked, and paging counts readable entries (`src/server/stores/FileBrowserJourneyStore.ts:49`, `src/server/stores/FileBrowserJourneyStore.ts:72`, `src/server/stores/FileBrowserStore.ts:274`). The filesystem suite pins reopening, corruption, permissions, competing writers, recreation, failed writes, paging, and reserved paths; component links have a dedicated test (`tests/src/server/stores/suite.ts:343`, `tests/src/server/stores/suite.ts:362`, `tests/src/server/stores/suite.ts:412`, `tests/src/server/stores/suite.ts:508`, `tests/src/server/stores/suite.ts:558`, `tests/src/server/stores/suite.ts:583`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts:62`). Returning undefined on corruption or converting ACCESS to FILE breaks explicit rejection assertions. The supplied host server run passes (`tmp/codex/gwave-fix-server.log:10`).

## CONFIRMED — Claim 11

Run allocation retries exclusive directory creation, and capture requires an owned slot and existing directory (`src/server/stores/FileBrowserStore.ts:300`, `src/server/stores/FileBrowserRunStore.ts:36`, `src/server/stores/FileBrowserRunStore.ts:90`). The forced first-candidate collision and forged/missing-slot tests distinguish reuse or unintended directory recreation (`tests/src/server/stores/FileBrowserStore.test.ts:212`, `tests/src/server/stores/FileBrowserRunStore.test.ts:21`, `tests/src/server/stores/FileBrowserRunStore.test.ts:43`).

## CONFIRMED — Claim 12

The recorder separates gesture projection from navigation boundaries and flushes the open edit without adding navigation (`src/core/recorders/BrowserCodegen.ts:287`, `src/core/recorders/BrowserCodegen.ts:410`). Chromium tests compare recorded gestures with the fixture event log and inspect password binding payloads; the boundary case covers submission, focus, navigation, stop, and contenteditable (`tests/service/codegen.test.ts:74`, `tests/service/codegen.test.ts:123`, `tests/service/codegen.test.ts:145`, `tests/service/codegen.test.ts:154`). Merging across a boundary or transmitting password text changes these assertions.

## REFUTED — Claim 13

An already-aborted secret `type` through `toolset.tools.execute` returns the literal secret when it occurs in the abort reason. `tools` exposes the raw manager, whose pre-abort branch returns before the browser dispatch/redaction boundary (`src/core/BrowserToolset.ts:295`, `node_modules/@orkestrel/tool/dist/src/core/index.js:269`). The same call through `perform` is redacted (`src/core/BrowserToolset.ts:316`). The built-package probe demonstrates both outcomes (`tmp/codex/j14c-probe.ts:37`, `tmp/codex/j14c-probe.log:43`). Persistence suppression and the successful-password artifact test remain intact (`src/core/BrowserReplay.ts:79`, `tests/service/journey.test.ts:933`); see N1.

## CONFIRMED — Claim 14

Generated steps call the shared execution helper, and the gap throw precedes toolset construction (`src/core/compilers.ts:571`, `src/core/compilers.ts:578`). The named fixture matrix compares independently reset page outcomes and receipts; the gap fixture has a mutating prefix and a no-throw control; generated TypeScript is compiled against the package declarations (`tests/service/journey.test.ts:314`, `tests/service/journey.test.ts:328`, `tests/service/journey.test.ts:426`). Removing a generated step changes the declared outcome or receipts. N3 concerns malformed optional inputs outside this valid-input matrix.

## CONFIRMED — Claim 15

Shared launch state and exclusive profiles support the amended single-client/two-first-calls wording (`src/server/BrowserMCPServer.ts:203`, `src/server/BrowserMCPServer.ts:211`, `tests/distribution.test.ts:1307`). Packed tests pin absent-Chromium vocabulary, persisted journeys/runs, concurrent first calls, independent profiles, EOF, and SIGTERM cleanup (`tests/distribution.test.ts:1236`, `tests/distribution.test.ts:1309`, `tests/distribution.test.ts:1344`, `tests/distribution.test.ts:1386`). Removing launch sharing or cleanup fails the process/profile assertions. The supplied host distribution record passes with its declared skips (`tmp/codex/gwave-test:distribution.log:10`).

## UNPROVEN — Claim 16

The required completed model transcript, attempt/malformed-call/cost measurements, one replay order, and persisted journey/run evidence remain outstanding under the brief's explicit ruling (`tmp/units/journeys/j14c-brief.md:5`, `.orkestrel/browser/journeys-design.md:551`). A passing browser-package suite cannot supply that consumer-model evidence (`.orkestrel/browser/ledger.md:443`).

## CONFIRMED — Claim 17

Reclaim unlinks the observed PID-token entry; release unlinks its own entry; both use nonrecursive directory removal. Publication requires sole ownership and retries are bounded (`src/server/stores/FileBrowserStore.ts:181`, `src/server/stores/FileBrowserStore.ts:208`, `src/server/stores/FileBrowserStore.ts:225`, `src/server/stores/FileBrowserStore.ts:361`). The two-process barrier holds the winner while the other recoverer resumes, asserting refusal and preservation of the winner (`tests/src/server/stores/suite.ts:186`). Empty, live, malformed, multiple, inconclusive, replacement-release, bounded-retry, and removal-error tests pin the remaining branches (`tests/src/server/stores/FileBrowserStore.test.ts:21`, `tests/src/server/stores/FileBrowserStore.test.ts:43`, `tests/src/server/stores/FileBrowserStore.test.ts:63`, `tests/src/server/stores/FileBrowserStore.test.ts:99`, `tests/src/server/stores/FileBrowserStore.test.ts:126`, `tests/src/server/stores/FileBrowserStore.test.ts:154`). Recursive reclaim/release fails the winner-preservation assertions.

## REFUTED — Claim 18

The managed pre-abort path leaks its reason before the handler, independently of placement; N1 reproduces it with no input dispatched (`node_modules/@orkestrel/tool/dist/src/core/index.js:269`, `tmp/codex/j14c-probe.log:52`). The repaired DOM missing-option wording and admitted-call redaction are pinned (`src/browser/elements/BrowserDOMElement.ts:126`, `src/core/BrowserToolset.ts:594`, `tests/src/browser/elements/BrowserDOMElement.test.ts:335`, `tests/src/core/BrowserToolset.test.ts:134`). The abort test omits managed execution, and prefix-only secrecy assertions also leave a mutation gap (`tests/src/core/BrowserToolset.test.ts:101`, `tests/src/core/BrowserReplay.test.ts:67`).

## CONFIRMED — Claim 19

Holdability is checked before reservation, `held` derives from the acquired reservation, and consumers read that state; save snapshots before ending the recorder (`src/core/BrowserToolset.ts:307`, `src/core/BrowserToolset.ts:394`, `src/core/BrowserToolset.ts:471`, `src/core/BrowserJourneyToolset.ts:202`, `src/core/BrowserJourneyToolset.ts:518`). Tests pin immediate dialog/pending-input refusal, later acquisition, a recorder created during a hold, busy recording refusal, reserved `unresolved`, and recording after failed save (`tests/src/core/BrowserToolset.test.ts:241`, `tests/src/core/recorders/BrowserRecorder.test.ts:24`, `tests/src/core/BrowserJourneyToolset.test.ts:95`, `tests/src/core/BrowserToolset.test.ts:84`, `tests/src/core/BrowserJourneyToolset.test.ts:128`). Removing those guards or stopping before save fails the named assertions. N2 is the separately untested concurrent-record interleaving.

## CONFIRMED — Claim 20

Native grammar reads the tool copy; failed-step action travels through error context; listing faults receive the prescribed template (`src/core/helpers.ts:2913`, `src/core/helpers.ts:2464`, `src/core/BrowserReplay.ts:284`, `src/core/BrowserJourneyToolset.ts:244`). Tests discriminate integer/string/binding timeout, causing-edit attribution, cap inheritance/override, zero limits, invalid names, action context, and actual file fault rendering (`tests/src/core/helpers.test.ts:89`, `tests/src/core/helpers.test.ts:103`, `tests/src/core/helpers.test.ts:1203`, `tests/src/core/BrowserJourneyToolset.test.ts:39`, `tests/src/core/stores/suite.ts:25`, `tests/src/core/stores/suite.ts:35`, `tests/src/server/stores/FileBrowserStore.test.ts:173`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts:25`). Restoring the handwritten grammar or assigning the last edit's index fails those assertions.

## CONFIRMED — Claim 21

The frame filter reads `frameId`, locator options require the supplied id, and the shared homes have both-consumer proofs (`src/core/recorders/BrowserCodegen.ts:410`, `src/core/helpers.ts:2384`, `src/core/helpers.ts:2433`, `src/core/constants.ts:794`). Tests pin child/main navigation separation, caller-specific refusal ids, non-step membership, run-id validation, and secret-name collection (`tests/src/core/recorders/BrowserCodegen.test.ts:14`, `tests/src/core/helpers.test.ts:258`, `tests/src/core/helpers.test.ts:284`, `tests/src/core/recorders/BrowserRecorder.test.ts:50`, `tests/src/server/stores/FileBrowserStore.test.ts:183`, `tests/src/core/recorders/BrowserRecorder.test.ts:79`). Reading the wrong frame field or changing a shared home changes the relevant assertions. Helper placement follows the explicit deferral (`.orkestrel/browser/journeys-design.md:542`).

## CONFIRMED — Claim 22

The specified unknown-name and required-input checks precede gaps and toolset construction, including absent input objects; parameterless modules omit them (`src/core/compilers.ts:537`, `src/core/compilers.ts:578`). Compiler tests pin order, messages, undefined inputs, and no-parameter output; the service test compares missing/unknown input refusals against an untouched mutating prefix (`tests/src/core/compilers.test.ts:225`, `tests/src/core/compilers.test.ts:268`, `tests/src/core/compilers.test.ts:340`, `tests/service/journey.test.ts:377`). Deleting or moving those checks fails the assertions. The dialog/switch equality addition is pinned at `tests/service/journey.test.ts:1144`. N3 identifies a different input population omitted by this claim.

## CONFIRMED — Claim 23

The design's module includes preflight and matches the fixture byte-for-byte; renderer/compiler tests compare those fixtures to output, while guide parity checks summaries and displayed fences (`.orkestrel/browser/journeys-design.md:290`, `tmp/codex/j14c-declarations.log:4`, `tests/src/core/compilers.test.ts:183`, `tests/src/core/helpers.test.ts:1323`, `tests/src/core/helpers.test.ts:1390`, `tests/guides.test.ts:270`, `tests/guides.test.ts:299`, `tests/guides.test.ts:423`). The guide carries `BROWSER_JOURNEY_ARGUMENT` (`guides/browser.md:312`). The host counts match the ledger, including the repaired server/browser/setup runs and declared skips (`.orkestrel/browser/ledger.md:443`, `tmp/codex/gwave-fix-server.log:10`, `tmp/codex/gwave-fix-browser.log:10`, `tmp/codex/gwave-fix-setup.log:10`). Removing a generated call fails the compiler equality and guide shortened-module control (`tests/guides.test.ts:318`).

## CONFIRMED — Claim 24

The observer and filesystem suite occupy the designated test suite module (`tests/src/server/stores/suite.ts:26`, `tests/src/server/stores/suite.ts:45`). A compiler-AST comparison against the second-round commit finds no added unexported module declarations or nested function declarations, with rejecting controls; the built browser sourcemap contains no server source (`tmp/codex/j14c-declarations.ts:7`, `tmp/codex/j14c-declarations.ts:25`, `tmp/codex/j14c-declarations.log:2`). Added public homes have guide rows and consumer tests (`guides/browser.md:234`, `guides/browser.md:489`, `guides/browser.md:1106`, `guides/browser.md:1229`, `tests/src/core/recorders/BrowserRecorder.test.ts:50`, `tests/src/server/stores/FileBrowserStore.test.ts:43`). The explicit helper-placement ruling remains the exception, not an additional finding (`.orkestrel/browser/journeys-design.md:542`).

## Second-round findings

The objective report defines N1–N3, not N4/N5; no absent finding is invented (`.orkestrel/browser/journeys-j14b-objective.md:127`, `.orkestrel/browser/journeys-j14b-objective.md:153`). A and S below identify the filenames `journeys-j14b-objective.md` and `journeys-j14b-subjective.md`, respectively (`.orkestrel/browser/ledger.md:440`, `.orkestrel/browser/ledger.md:441`).

- CLOSED — A-N1, dead-holder recovery: the two-process observed-dead-entry barrier and replacement-release assertion pin ownership (`tests/src/server/stores/suite.ts:186`, `tests/src/server/stores/FileBrowserStore.test.ts:154`).
- CLOSED — A-N2, DOM missing-option interpolation: exact value-free element wording and persisted/rendered refusal tests pin the repair; the different abort leak is J14c N1 (`tests/src/browser/elements/BrowserDOMElement.test.ts:335`, `tests/src/core/BrowserReplay.test.ts:34`).
- CLOSED — A-N3, missing required input after a prefix: generated and replay preparation leave the mutating fixture unchanged (`tests/service/journey.test.ts:377`).
- CLOSED — A claim 5 UNPROVEN: direct/replay dialog and switch tuple equality exists (`tests/service/journey.test.ts:1144`).
- CLOSED — A claim 9 REFUTED: recovery exclusion and in-lock stale precedence both have assertions (`tests/src/server/stores/suite.ts:186`, `tests/src/server/stores/suite.ts:532`).
- CLOSED — A claim 10 REFUTED: the recovery regression and filesystem suite pass in the supplied host server record (`tests/src/server/stores/suite.ts:186`, `tmp/codex/gwave-fix-server.log:10`).
- OPEN — A/S claim 13 REFUTED: its original select vector is repaired, but the universal secrecy claim still fails through managed pre-abort (`tests/src/browser/elements/BrowserDOMElement.test.ts:335`, `tmp/codex/j14c-probe.log:52`).
- CLOSED — A claim 15 UNPROVEN: the brief rules the wording, and the packed proof explicitly uses concurrent first requests on one client (`tmp/units/journeys/j14c-brief.md:5`, `tests/distribution.test.ts:1307`).
- OPEN — A/S claim 16 UNPROVEN: the brief still requires the outstanding consumer-model proof (`tmp/units/journeys/j14c-brief.md:5`).
- CLOSED — S claim 6 REFUTED: immediate refusal leaves dialog answering possible and admits a later hold (`tests/src/core/BrowserToolset.test.ts:241`).
- CLOSED — S-N1, recorded wait timeout grammar: integer timeout is admitted; string and binding forms refuse (`tests/src/core/helpers.test.ts:89`).
- CLOSED — S-N2, dialog/hold deadlock: the bounded refusal and successful answer assertions cover the interleaving (`tests/src/core/BrowserToolset.test.ts:264`).
- CLOSED — S-N3, DOM secret selection error: the element and full replay persistence assertions pin the repair (`tests/src/browser/elements/BrowserDOMElement.test.ts:335`).
- CLOSED — S-N4, recording during replay: the blocked-replay test requires the busy sentence and unset recording (`tests/src/core/BrowserJourneyToolset.test.ts:95`).
- CLOSED — S-N5, reclaim race and empty crash lock: both are exercised (`tests/src/server/stores/suite.ts:186`, `tests/src/server/stores/FileBrowserStore.test.ts:126`).
- CLOSED — S-N6, `unresolved` adoption: skip reason and absence from the manager are asserted (`tests/src/core/BrowserToolset.test.ts:84`).
- CLOSED — S-N7, edit index: the origin matrix and later-unrelated-edit case pin attribution (`tests/src/core/helpers.test.ts:1203`, `tests/src/core/helpers.test.ts:1220`).
- CLOSED — S-N8, child same-document navigation: the test requires the main edit to remain open and the main navigation to close it (`tests/src/core/recorders/BrowserCodegen.test.ts:14`).
- CLOSED — S-N9, failed save stops recording: retry must contain the action recorded after refusal (`tests/src/core/BrowserJourneyToolset.test.ts:128`).
- CLOSED — S-N10, zero cap: constructor and shared twin-store tests require ARGUMENT (`tests/src/server/stores/FileBrowserStore.test.ts:173`, `tests/src/core/stores/suite.ts:25`, `tests/src/core/stores/suite.ts:155`).
- DEFERRED — S design-fit 1, compound file-store verbs: explicitly accepted by the design ruling (`.orkestrel/browser/journeys-design.md:545`).
- CLOSED — S design-fit 2, positional cap: options and inheritance/override assertions pin the replacement (`src/core/BrowserJourneyToolset.ts:87`, `tests/src/core/BrowserJourneyToolset.test.ts:39`).
- CLOSED — S design-fit 3, cached hold state: consumers read the toolset getter; the late-constructed recorder test distinguishes a stale cache (`src/core/BrowserToolset.ts:307`, `src/core/BrowserJourneyToolset.ts:518`, `tests/src/core/recorders/BrowserRecorder.test.ts:24`).
- CLOSED — S design-fit 4, action side channel: failed action context and replay timeout assertions pin direct propagation (`src/core/BrowserReplay.ts:284`, `tests/src/core/helpers.test.ts:103`, `tests/src/core/BrowserReplay.test.ts:245`).
- CLOSED — S design-fit 5, empty-name sentinel: admission has an explicit category, exercised by hold/foreign-action tests (`src/core/BrowserToolset.ts:462`, `tests/service/journey.test.ts:500`).
- CLOSED — S design-fit 6, duplicated homes: both-consumer tests cover non-step names, ids, and secret-name collection (`tests/src/core/recorders/BrowserRecorder.test.ts:50`, `tests/src/server/stores/FileBrowserStore.test.ts:183`, `tests/src/core/recorders/BrowserRecorder.test.ts:79`).
- CLOSED — S design-fit 7, PATH for argument errors: shared zero-limit tests and negative tool offset require ARGUMENT (`tests/src/core/stores/suite.ts:25`, `tests/src/core/BrowserJourneyToolset.test.ts:72`).
- CLOSED — S design-fit 8, invented `s1`: required options and caller-specific missing/ambiguous refusals are tested (`tests/src/core/helpers.test.ts:258`, `tests/src/core/helpers.test.ts:284`).
- CLOSED — S design-fit 9, fault listing paths: the real corrupt-file listing is compared exactly with the path-free template (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:47`).
- CLOSED — S design-fit 10, handwritten grammar: validation reads the advertised schema, with timeout type controls (`src/core/helpers.ts:2913`, `tests/src/core/helpers.test.ts:89`).
- CLOSED — First-round S-U5 carried OPEN: dialog/switch replay equality is present (`tests/service/journey.test.ts:1144`).
- OPEN — First-round A/S-U16 carried OPEN: the model-run evidence remains outstanding by instruction (`tmp/units/journeys/j14c-brief.md:5`).
- CLOSED — First-round S-O7 carried OPEN: the empty-directory recovery test covers the unpublished-holder crash window (`tests/src/server/stores/FileBrowserStore.test.ts:126`).
- DEFERRED — First-round A-O3 carried OPEN, launch double: the design explicitly retains the seam and assigns lifecycle evidence to packed tests (`.orkestrel/browser/journeys-design.md:545`, `tests/distribution.test.ts:1386`).
- CLOSED — First-round A-O4 carried OPEN, nested wording helper: comparisons are inline; the declaration comparison finds no added nested declaration (`tests/service/toolset.test.ts:248`, `tmp/codex/j14c-declarations.log:2`).
- CLOSED — First-round S-O6 residual, invalid memory name: the shared point-operation test pins PATH for both twins (`tests/src/core/stores/suite.ts:35`).
- CLOSED — First-round DF1 argument-code residual: cap and offset tests require ARGUMENT; added codes remain accepted by the design (`tests/src/core/stores/suite.ts:25`, `tests/src/core/BrowserJourneyToolset.test.ts:72`, `.orkestrel/browser/journeys-design.md:545`).
- DEFERRED — First-round DF2 compound verbs: the design accepts the named forms (`.orkestrel/browser/journeys-design.md:545`).
- CLOSED — First-round DF6 invented-id residual: the locator requires the caller's id (`src/core/helpers.ts:2384`, `tests/src/core/helpers.test.ts:258`).
- DEFERRED — First-round DF5, DF6 tabs prose, DF9, and DF10 helper placement: the structural view capability, structured tabs, copied-result fault, and function-domain registration are explicitly recorded follow-ups (`.orkestrel/browser/journeys-design.md:542`, `.orkestrel/browser/journeys-design.md:545`).

## New findings

### REFUTED — N1: managed pre-abort bypasses secret redaction

High. Start a toolset and execute `type` with `text: 'secret-audit-42'`, `secret: true`, and `AbortSignal.abort(new Error('Rejected secret-audit-42'))`. Managed execution returns `Error: Rejected secret-audit-42`; `perform` returns `Error: Rejected [redacted]` (`tmp/codex/j14c-probe.ts:37`, `tmp/codex/j14c-probe.log:43`). The raw tool manager is public, and its pre-abort branch returns before invoking the tool (`src/core/BrowserToolset.ts:295`, `node_modules/@orkestrel/tool/dist/src/core/index.js:269`). This needs no browser input or page reflection.

Put managed cancellation results through the same sanitization boundary without admitting aborted input. Add managed execution to the existing pre-abort test and require unchanged ordinary refusal text; the existing test covers only `perform` and direct tool execution (`tests/src/core/BrowserToolset.test.ts:101`). Preserve the successful repairs for errors that reach the handler (`tests/src/core/BrowserToolset.test.ts:134`, `tests/src/browser/elements/BrowserDOMElement.test.ts:335`).

### REFUTED — N2: concurrent record calls replace an acknowledged recording

Medium. Concurrent `record(first-flow)` and `record(second-flow)` against the real memory store both succeed; only `second-flow` remains active. Sequential calls correctly refuse the second call (`tmp/codex/j14c-probe.ts:14`, `tmp/codex/j14c-probe.log:2`, `tmp/codex/j14c-probe.log:20`). Both continuations pass the recording check, then yield at `await recorder.start()` before publishing ownership; the later continuation overwrites the first recorder, whose subscriptions remain installed (`src/core/BrowserJourneyToolset.ts:181`, `src/core/BrowserJourneyToolset.ts:186`, `src/core/recorders/BrowserRecorder.ts:45`).

Reserve recording ownership before that suspension and roll it back if startup fails. Add a concurrent-call assertion requiring one success, one RECORDING refusal, and preservation of the acknowledged recorder. The existing refusal test exercises an already-established recording, not this race (`tests/src/core/BrowserJourneyToolset.test.ts:333`). The probe uses real toolset, recorder, and memory-store implementations; its disconnected page affects only the trailing look text (`tmp/codex/j14c-probe.ts:15`, `tmp/codex/j14c-probe.log:27`).

### REFUTED — N3: defaulted runtime inputs escape generated preparation

Medium. For a parameter `name` defaulted to `Ada`, JavaScript `execute(page, { name: 42 })` passes generated input validation, while replay rejects the same supplied value at preparation. In the probe's gap-bearing journey, the module reaches the gap error while replay raises INPUT; an unknown-name control is rejected by the module (`tmp/codex/j14c-probe.ts:56`, `tmp/codex/j14c-probe.log:38`). The generator checks value types only for required parameters, whereas replay checks every supplied value (`src/core/compilers.ts:537`, `src/core/compilers.ts:549`, `src/core/BrowserReplay.ts:191`).

Validate supplied defaulted values before toolset startup while retaining fallback for omitted defaults. Add malformed-defaulted-input cases to the mutating-prefix matrix; its present missing/unknown cases do not cover this population (`tests/service/journey.test.ts:377`). The observed failure is preparation divergence; with no gap, source ordering permits earlier steps before the malformed value reaches its native action (`src/core/compilers.ts:578`, `src/core/compilers.ts:587`). This extends the design's module/replay equivalence without refuting claim 22's narrower required-input checks (`.orkestrel/browser/journeys-design.md:281`).

## Mutations

- OPEN — Replace `[redacted]` with `secret.slice(4)` in the redaction boundary: prefix-only `not.toContain('Zq7#')` assertions still accept leaked suffixes. Require the expected sanitized receipt or additional disjoint secret fragments, including escaped forms (`src/core/BrowserToolset.ts:594`, `tests/src/core/BrowserToolset.test.ts:155`, `tests/src/core/BrowserReplay.test.ts:67`). This is assertion analysis, not a claimed mutation run.
- OPEN — Leave managed pre-abort outside redaction: the existing abort test never calls `tools.execute`; N1 is the surviving concrete control (`tests/src/core/BrowserToolset.test.ts:101`, `tmp/codex/j14c-probe.log:52`).
- OPEN — Retain the yield between recording admission and ownership publication: established-recording and replay-busy assertions cannot discriminate the concurrent-record overwrite in N2 (`src/core/BrowserJourneyToolset.ts:186`, `tests/src/core/BrowserJourneyToolset.test.ts:95`, `tests/src/core/BrowserJourneyToolset.test.ts:333`).
- OPEN — Omit validation of defaulted supplied values: required-input and unknown-name controls remain green while N3 reaches the gap instead of INPUT (`tests/src/core/compilers.test.ts:225`, `tests/service/journey.test.ts:377`, `tmp/codex/j14c-probe.log:38`).
- CLOSED — Historical dialog/switch replay-only receipt mutation: the sequence table compares every result tuple (`tests/service/journey.test.ts:1144`).
- CLOSED — Historical outside-lock revision comparison mutation: held-lock precedence, rather than the ordinary process race, distinguishes it (`tests/src/server/stores/suite.ts:532`).
- CLOSED — Historical recursive reclaim/release mutations: explicit winner/replacement preservation assertions distinguish both (`tests/src/server/stores/suite.ts:215`, `tests/src/server/stores/FileBrowserStore.test.ts:166`).

VERDICT: FAIL — claims 13 and 18 REFUTED; claim 16 UNPROVEN by the brief's ruling; new findings N1–N3.
