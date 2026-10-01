The sandbox rejected writing `tmp/units/journeys/j14b-objective.md`. The full verdict follows.

# J14b objective verdict

Scope: the source and tests at `897a99e`, unchanged at checkout HEAD `e70c147`; the later commit adds the gate record at `.orkestrel/browser/ledger.md:439`. This is a read-only source-and-assertion audit. CONFIRMED means the inspected implementation and named assertions distinguish the stated attack; it does not mean this auditor freshly ran Chromium, filesystem tests, or mutations. New failing scenarios below are established from the cited code paths, not reported as executed reproductions.

## CONFIRMED — Claim 1

Invocation-local signals own the action state; manager dispatch calls `perform`, and the returned action is the emitted object (`src/core/BrowserToolset.ts:304`, `src/core/BrowserToolset.ts:346`, `src/core/BrowserToolset.ts:432`). Target capture precedes dispatch and marks only child frames (`src/core/BrowserToolset.ts:1067`). The distinct-action assertion now requires the second action to exist, so keying state by the identical call id is detectable (`tests/src/core/BrowserToolset.test.ts:116`). Target replacement, secret metadata, and interruption have separate assertions (`tests/src/core/BrowserToolset.test.ts:155`, `tests/src/core/BrowserToolset.test.ts:194`, `tests/src/core/BrowserToolset.test.ts:409`); switch metadata is pinned at `tests/service/toolset.test.ts:271`.

## CONFIRMED — Claim 2

The exact branch compares normalized names without case folding, and both placements consume that filter (`src/core/helpers.ts:125`, `src/core/elements/BrowserElementManager.ts:117`, `src/browser/elements/BrowserDOMElementManager.ts:168`). The shared expected-name cases run in both managers (`tests/src/core/elements/BrowserElementManager.test.ts:19`, `tests/src/browser/elements/BrowserDOMElementManager.test.ts:381`). Substring matching or case folding changes the expected result membership.

## CONFIRMED — Claim 3

Replay constructs a semantic target and resolves exactly one match before obtaining the input reference (`src/core/BrowserReplay.ts:267`, `src/core/helpers.ts:2377`, `src/core/helpers.ts:2422`). The Chromium test changes ids, classes, and order, then checks duplicate refusal, the page log, and zero mouse input (`tests/service/journey.test.ts:127`). Trusting a stored reference or accepting the first duplicate breaks those assertions.

## CONFIRMED — Claim 4

The resolver sends only role, name, and exactness; zero matches raises the target code (`src/core/helpers.ts:2377`). The unique-but-wrong CSS control is the explicit negative case, with no input or CSS query permitted (`tests/service/journey.test.ts:189`). Adding CSS fallback changes the asserted refusal and transport trace.

## UNPROVEN — Claim 5

The new equality test really executes replay on a fresh page and compares its receipt, stage, and reason with a direct call (`tests/service/journey.test.ts:1018`). Its table contains click, type variants, press, navigate, and wait, but no dialog or switch (`tests/setup.ts:2296`, `tests/setup.ts:2325`). Those separate service cases still compare direct execution with `perform` or `performBrowserStep`, not `createBrowserReplay` (`tests/service/toolset.test.ts:219`, `tests/service/toolset.test.ts:251`).

Missing: a replay/direct comparison of the interrupted click plus dialog sequence, and a successful semantic switch replay/direct comparison. Mutating only replay’s dialog/switch receipt or reason would evade the new equality matrix. Literal adopted arguments, argument construction, interruption continuation, suffix stopping, and DOM child-frame replay do have pins (`tests/src/core/BrowserReplay.test.ts:271`, `tests/src/core/helpers.test.ts:257`, `tests/src/core/BrowserReplay.test.ts:303`, `tests/service/journey.test.ts:572`, `tests/service/document.test.ts:189`).

## CONFIRMED — Claim 6

The pending reservation is installed before queue acquisition and participates in admission; failure clears it, and replay releases the acquired hold in `finally` (`src/core/BrowserToolset.ts:365`, `src/core/BrowserToolset.ts:438`, `src/core/BrowserReplay.ts:144`). Removing the pending assignment permits the regression’s foreign click while the earlier adopted action is still pending (`tests/src/core/BrowserToolset.test.ts:327`). Queued cancellation, pre-admitted work, dialog ownership, observations, and abort-without-suffix are pinned separately (`tests/src/core/BrowserToolset.test.ts:371`, `tests/src/core/BrowserToolset.test.ts:409`, `tests/service/journey.test.ts:434`, `tests/service/journey.test.ts:531`).

## CONFIRMED — Claim 7

The timeout branch retains the receipt and sets the structured outcome; replay stops on it (`src/core/BrowserToolset.ts:917`, `src/core/BrowserReplay.ts:125`). The Chromium test asserts the timeout, direct wording, absent suffix input, and positive control (`tests/service/journey.test.ts:572`). Changing timeout to done permits the forbidden suffix and changes its page-state assertions.

## CONFIRMED — Claim 8

Preparation validates before hold acquisition or run allocation, and dialog admission examines the preceding outcome (`src/core/BrowserReplay.ts:66`, `src/core/BrowserReplay.ts:168`, `src/core/BrowserReplay.ts:253`). Host tests assert coded rejection and zero events, with a valid control and a later live refusal retaining its prefix (`tests/service/journey.test.ts:616`, `tests/service/journey.test.ts:652`, `tests/service/journey.test.ts:673`). The new between-step dialog test opens an actual protocol dialog and requires zero answer commands; deleting the replay admission check now fails that test (`tests/src/core/BrowserReplay.test.ts:489`).

## REFUTED — Claim 9

The editor, in-lock comparison, held-lock precedence test, and ordinary two-process race meet the amended proof requirements (`src/core/helpers.ts:2492`, `src/server/stores/FileBrowserJourneyStore.ts:72`, `tests/src/core/helpers.test.ts:1124`, `tests/src/core/helpers.test.ts:1192`, `tests/src/server/stores/suite.ts:161`, `tests/src/server/stores/suite.ts:464`). Ref conversion is exercised at `tests/service/journey.test.ts:728`.

However, simultaneous recovery of a dead lock allows both writers to enter the supposedly exclusive region, read the same revision, and accept the same expected revision. N1 gives the interleaving; the defect is unconditional path removal after reading a dead PID (`src/server/stores/FileBrowserStore.ts:192`, `src/server/stores/FileBrowserStore.ts:204`). The new recovery test has only one recovering caller (`tests/src/server/stores/suite.ts:140`).

## REFUTED — Claim 10

The new dead-lock recovery can lose an update across legitimate store instances/processes; see N1 (`src/server/stores/FileBrowserStore.ts:192`, `src/server/stores/FileBrowserStore.ts:204`, `src/server/stores/FileBrowserJourneyStore.ts:75`).

The original coverage gaps otherwise have concrete assertions: reopening and corrupt files (`tests/src/server/stores/suite.ts:275`, `tests/src/server/stores/suite.ts:294`), native permission denial and ACCESS translation (`tests/src/server/stores/suite.ts:344`), deletion/recreation, held-lock precedence, failed writes, paging, and reserved names (`tests/src/server/stores/suite.ts:440`, `tests/src/server/stores/suite.ts:464`, `tests/src/server/stores/suite.ts:487`, `tests/src/server/stores/suite.ts:512`, `tests/src/server/stores/suite.ts:536`), component links and rollback (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:62`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts:90`). Returning absence for corrupt input fails the rejection assertions; translating EACCES to FILE fails the non-root child’s expected ACCESS result (`tests/src/server/stores/suite.ts:315`, `tests/src/server/stores/suite.ts:423`).

## CONFIRMED — Claim 11

Allocation uses exclusive mkdir with collision retry; capture accepts only its own opened slot and a constrained filename, checks the directory, and creates none (`src/server/stores/FileBrowserStore.ts:285`, `src/server/stores/FileBrowserRunStore.ts:36`, `src/server/stores/FileBrowserRunStore.ts:90`). The forced shared first candidate requires distinct directories (`tests/src/server/stores/FileBrowserStore.test.ts:20`). Forged/unopened slots, missing directories, and component links are rejected by the capture tests (`tests/src/server/stores/FileBrowserRunStore.test.ts:21`, `tests/src/server/stores/FileBrowserRunStore.test.ts:43`, `tests/src/server/stores/FileBrowserRunStore.test.ts:55`). Reusing a colliding directory or recreating a missing capture directory breaks these assertions.

## CONFIRMED — Claim 12

Gesture projection handles open edits, Enter, select gaps, and child-document gaps; navigation flushes the edit without adding a navigate step (`src/core/recorders/BrowserCodegen.ts:287`, `src/core/recorders/BrowserCodegen.ts:401`). The independent fixture-log projection and inbound password check pin the gesture sequence and absent password value (`tests/service/codegen.test.ts:74`, `tests/service/codegen.test.ts:123`, `tests/service/codegen.test.ts:145`). Boundary-separated edits are pinned at `tests/service/codegen.test.ts:154`. Dropping a frame gesture, transmitting the password, or merging across navigation changes these assertions. This uses the amended navigation contract, not the retired requirement to retain its destination (`.orkestrel/browser/journeys-design.md:164`).

## REFUTED — Claim 13

A secret bound to `type.text` targeting a DOM select leaks on a missing option. For a select named “Access level” with only option “public”, supply secret input “audit-secret-42”. The DOM element embeds that input in `has no option "audit-secret-42"` (`src/browser/elements/BrowserDOMElement.ts:124`). The toolset propagates the error unchanged into the failed result and action receipt (`src/core/BrowserToolset.ts:1055`, `src/core/BrowserToolset.ts:338`, `src/core/BrowserToolset.ts:356`); replay stores that receipt as the step result (`src/core/BrowserReplay.ts:293`). N2 traces the persistence/rendering consequence.

This requires no page handler to republish the secret. The existing successful password-field test does not cover a refused DOM selection (`tests/service/journey.test.ts:859`, `tests/service/journey.test.ts:977`). Suppression of input fields, captures, and output remains implemented (`src/core/BrowserReplay.ts:73`, `src/core/BrowserReplay.ts:110`, `src/core/BrowserReplay.ts:284`).

## CONFIRMED — Claim 14

For the named fixture matrix, generated calls use the shared step engine, and the tests compare independent page outcomes and receipts (`src/core/compilers.ts:540`, `tests/service/journey.test.ts:265`, `tests/service/journey.test.ts:305`). A gap now throws before toolset construction (`src/core/compilers.ts:557`); the fixture has a mutating click before it, and removing the throw runs both surrounding clicks (`tests/setup.ts:3845`, `tests/service/journey.test.ts:319`). Removing a generated call changes the receipt count or independently declared outcome; moving the gap throw after the click changes the empty log assertion (`tests/service/journey.test.ts:312`, `tests/service/journey.test.ts:352`). Module typechecking has a misspelled-input control (`tests/service/journey.test.ts:365`). N3 concerns runtime input preparation beyond this named matrix.

## UNPROVEN — Claim 15

The packed tests now cover actual concurrent first requests, independent servers/profiles, live EOF/SIGTERM cleanup, vocabulary, and journey persistence (`tests/distribution.test.ts:1240`, `tests/distribution.test.ts:1310`, `tests/distribution.test.ts:1345`, `tests/distribution.test.ts:1387`). The implementation shares its startup promise and exclusively creates each profile (`src/server/BrowserMCPServer.ts:199`, `src/server/BrowserMCPServer.ts:211`). Removing startup sharing changes the profile/process assertions; skipping browser destruction changes the ending assertions (`tests/distribution.test.ts:1332`, `tests/distribution.test.ts:1405`).

The literal “two clients … launches once” clause remains unsupported: the one-launch test deliberately uses one client, while two clients create two servers and expect two browsers (`tests/distribution.test.ts:1308`, `tests/distribution.test.ts:1322`, `tests/distribution.test.ts:1357`). Either amend this clause to “two first requests on one stdio server” or supply the claimed shared-server two-client test. This is a claim/test mismatch, not evidence that the implemented single-stdio-client launch coordination fails.

## UNPROVEN — Claim 16

The consumer now wires file journey/run stores and implements the model-driven edit/replay oracle (`../ollama/tests/setupStore.ts:898`, `../ollama/tests/service/browser.test.ts:278`). It also implements token-cost measurement and malformed-call accounting (`../ollama/tests/setupStore.ts:1501`, `../ollama/tests/setupStore.ts:1525`). The available current transcript instead has no orders and no saved files (`../ollama/tmp/probes/logs/journey-1.json:1687`, `../ollama/tmp/probes/logs/journey-1.json:1698`).

Missing: a completed run of the five existing tasks with this advertised vocabulary and a successful journey task within its budgets, accompanied by attempts, malformed-call measurements, cost, one replay order, and persisted journey/run evidence. The campaign itself still labels J11b in flight (`.orkestrel/browser/ledger.md:439`).

## First-round findings

The S labels refer to `journeys-j14-subjective.md`; A labels preserve additional findings in `journeys-j14-objective.md`.

- CLOSED — S-refuted 6: pending-hold admission has the missing interleaving test; removing the pending reservation permits its forbidden foreign click (`src/core/BrowserToolset.ts:373`; `tests/src/core/BrowserToolset.test.ts:327`).
- CLOSED — S/A-refuted 14: a mutating prefix now remains unexecuted, and the no-throw control must execute both clicks (`src/core/compilers.ts:557`; `tests/service/journey.test.ts:319`).
- CLOSED — A-refuted 12: the contract was amended to edit closure with no navigate step, which the boundary test pins (`.orkestrel/browser/journeys-design.md:164`; `tests/service/codegen.test.ts:154`).
- OPEN — S-unproven 5: the actual replay equality table still lacks dialog and switch (`tests/setup.ts:2296`; `tests/service/journey.test.ts:1018`; `tests/service/toolset.test.ts:219`).
- CLOSED — S-unproven 8: a between-step dialog is present, but replay must refuse without sending an answer (`tests/src/core/BrowserReplay.test.ts:489`).
- CLOSED — S/A-unproven 9: the amended claim correctly assigns comparison placement to held-lock precedence and ordinary winner selection to the process race; N1 is a different, newly introduced recovery defect (`tests/src/server/stores/suite.ts:464`; `tests/src/server/stores/suite.ts:161`; `.orkestrel/browser/ledger.md:424`).
- CLOSED — S/A-unproven 10: the child verifies native EACCES and the parent requires ACCESS for both stores, rather than skipping root (`tests/src/server/stores/suite.ts:344`, `tests/src/server/stores/suite.ts:399`, `tests/src/server/stores/suite.ts:423`).
- OPEN — S/A-unproven 16: the test exists, but the inspected transcript carries no order or persisted files (`../ollama/tests/service/browser.test.ts:278`; `../ollama/tmp/probes/logs/journey-1.json:1687`).
- CLOSED — A-unproven 15’s live-host evidence gap: the new packed cases observe actual profiles/processes and live endings; claim 15 retains the narrower client-count wording issue above (`tests/distribution.test.ts:1310`, `tests/distribution.test.ts:1345`, `tests/distribution.test.ts:1387`).

- CLOSED — S-O1, duplicated packed BrowserError: imports use the core alias; stale-edit wording and no redeclared core binding have packed tests (`src/server/stores/FileBrowserJourneyStore.ts:10`; `tests/distribution.test.ts:1428`; `tests/distribution.test.ts:1487`).
- CLOSED — S-O2 / A-O2, popup misrecorded as child-frame gap: dispatch omits the main-frame marker and the recorder checks only presence; the test observes the moved view, preserved click, and real child-frame control (`src/core/BrowserToolset.ts:1084`; `src/core/recorders/BrowserRecorder.ts:124`; `tests/src/core/recorders/BrowserRecorder.test.ts:51`, `tests/src/core/recorders/BrowserRecorder.test.ts:168`).
- CLOSED — S-O3 / A-O1, skipped journeys after faults and .profiles faults: offset advances by readable entries and invalid directory names are skipped; real-store tests assert complete membership and no unrelated faults (`src/core/BrowserJourneyToolset.ts:254`; `src/server/stores/FileBrowserJourneyStore.ts:135`; `tests/src/server/stores/FileBrowserJourneyStore.test.ts:25`; `tests/src/server/stores/suite.ts:58`).
- CLOSED — S-O4, save overwrites an intervening writer: save passes expected zero and the real-store test retains the other writer’s revision and content (`src/core/BrowserJourneyToolset.ts:207`; `tests/src/server/stores/suite.ts:22`). Concurrent dead-lock recovery remains N1.
- CLOSED — S-O5, capture during interrupted input: replay skips that capture; the test requires the following dialog and suffix and only post-dialog screenshots (`src/core/BrowserReplay.ts:110`; `tests/src/core/BrowserReplay.test.ts:350`).
- CLOSED — S-O6, twin-store divergence: shared suites pin unopened runs, negative paging, and the common stale clause (`tests/src/core/stores/suite.ts:34`, `tests/src/core/stores/suite.ts:72`, `tests/src/core/stores/suite.ts:135`, `tests/src/core/stores/suite.ts:149`).
- OPEN — S-O7, permanent crash lock: recovery is tested after the PID has been written, but a crash between exclusive creation and PID write leaves an empty file; Number('') is zero and every future acquisition refuses. No recovery test covers that window (`src/server/stores/FileBrowserStore.ts:186`, `src/server/stores/FileBrowserStore.ts:195`, `src/server/stores/FileBrowserStore.ts:211`; `tests/src/server/stores/suite.ts:83`).
- CLOSED — S-O8, setup modules registering suites: registration now lives in test-side suite modules, imported by the concrete store tests (`tests/src/core/stores/suite.ts:10`; `tests/src/server/stores/suite.ts:20`; `tests/src/server/stores/FileBrowserJourneyStore.test.ts:10`).
- OPEN — A-O3, behavioral fakes: the faulty listing fake is replaced by the real-store regression, but BrowserLaunchDouble and its launcher substitution remain. The packed host tests close the evidence gap, not that separate rule violation (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:25`; `tests/setupServer.ts:1474`; `tests/setupServer.ts:1643`; `/home/user/scaffold/.claude/rules/tests.md:27`).
- OPEN — A-O4, nested helper: the locally assigned wording function remains unchanged (`tests/service/toolset.test.ts:242`; `/home/user/scaffold/.claude/rules/architecture.md:167`).

- CLOSED — S-M1, deletion of dialog admission: the new between-step test asserts the precise refusal and absence of answer traffic (`tests/src/core/BrowserReplay.test.ts:519`).
- CLOSED — S-M2 / A-M1, comparison moved outside the lock: held-lock precedence now owns that mutation; the race alone still does not (`tests/src/server/stores/suite.ts:464`; `.orkestrel/browser/ledger.md:424`).
- CLOSED — S-M3, EACCES/EPERM collapsed to FILE: the non-root child establishes native denial and its store results must carry ACCESS (`tests/src/server/stores/suite.ts:399`, `tests/src/server/stores/suite.ts:423`).
- CLOSED — S-M4 / A-M2, gap-order/removed-prefix blind spot: the mutating prefix and explicit no-throw control distinguish both errors (`tests/setup.ts:3850`; `tests/service/journey.test.ts:352`).
- CLOSED — S-M5, undefined second concurrent action: the missing definedness assertion is present (`tests/src/core/BrowserToolset.test.ts:131`).
- CLOSED — S-M6, popup step removal: removing the opening click loses the required popup, and removing Like leaves liked=no; the declared two-page outcome and module/replay comparison distinguish both (`tests/setup.ts:3822`; `tests/service/journey.test.ts:312`). This is an assertion analysis, not a claim to have rerun historical j7b1.
- CLOSED — A-M3, frame-less popup regression: the real toolset now generates the popup action and the companion actual child-frame action must retain its marker (`tests/src/core/recorders/BrowserRecorder.test.ts:51`, `tests/src/core/recorders/BrowserRecorder.test.ts:168`).

- DEFERRED — S-design 1, additional error codes: explicitly recorded in section 14 and documented in the guide’s error contract (`.orkestrel/browser/journeys-design.md:541`; `guides/browser.md:3037`).
- CLOSED — S-design 2, noun-named file helpers: methods now use validateName, validateId, resolvePath, createDirectory, and translateError; filesystem assertions exercise their behavior (`src/server/stores/FileBrowserStore.ts:42`, `src/server/stores/FileBrowserStore.ts:95`, `src/server/stores/FileBrowserStore.ts:311`; `tests/src/server/stores/suite.ts:536`).
- CLOSED — S-design 3, unusable barrel exports: BrowserHold and FileBrowserStore are in the guide parity INTERNAL list (`tests/guides.test.ts:39`).
- CLOSED — S-design 4, duplicated secret/recording construction: the shared guard and journey builder have direct proofs and both recorders call the builder (`src/core/validators.ts:59`; `src/core/helpers.ts:3120`; `src/core/recorders/BrowserRecorder.ts:76`; `src/core/recorders/BrowserCodegen.ts:133`; `tests/src/core/validators.test.ts:22`; `tests/src/core/helpers.test.ts:1329`).
- DEFERRED — S-design 5, structural view capabilities: explicitly deferred in section 14 (`.orkestrel/browser/journeys-design.md:541`; `src/core/BrowserReplay.ts:304`, `src/core/BrowserReplay.ts:329`).
- DEFERRED — S-design 6, tabs prose resolution: explicitly deferred in section 14; the locator’s default s1 also remains, with the full design item deferred by the reconciliation (`.orkestrel/browser/journeys-design.md:541`; `.orkestrel/browser/ledger.md:423`; `src/core/helpers.ts:2383`, `src/core/helpers.ts:2433`).
- CLOSED — S-design 7, preparation message parsing: errors carry context and the tool reads it; the preparation-sentence matrix pins the mapping (`src/core/BrowserReplay.ts:185`; `src/core/BrowserJourneyToolset.ts:373`; `tests/src/core/BrowserJourneyToolset.test.ts:652`).
- CLOSED — S-design 8, store errors containing tool directives: stale and lock errors now contain clauses; shared and filesystem tests pin those clauses (`src/core/stores/MemoryBrowserJourneyStore.ts:39`; `src/server/stores/FileBrowserStore.ts:208`; `tests/src/core/stores/suite.ts:34`; `tests/src/server/stores/suite.ts:123`).
- DEFERRED — S-design 9, result-keyed WeakMap fault: explicitly deferred as a cross-package result-shape change (`.orkestrel/browser/journeys-design.md:541`; `src/core/BrowserToolset.ts:360`, `src/core/BrowserToolset.ts:434`).
- OPEN — S-design 10, kind placement: validators.ts now contains total guards, but performBrowserStep still orchestrates live lookup and tool calls inside helpers.ts; the cited pure-leaf rule and the design’s explicit helper placement remain unreconciled (`src/core/validators.ts:59`; `src/core/helpers.ts:2404`; `/home/user/scaffold/.claude/rules/architecture.md:176`; `.orkestrel/browser/journeys-design.md:281`).

## New findings

### N1 — REFUTED: dead-lock reclamation breaks mutual exclusion

Start with revision 1 and a lock containing an exited PID. Writers A and B both fail exclusive creation and read that PID. A removes the dead lock, creates its own lock, and enters set. Before A writes the revision, B resumes its already-authorized removal: it unlinks A’s live lock, creates B’s lock, and enters set too. Both can read revision 1 and accept expected=1, then both write revision 2. One update is lost while both calls succeed (`src/server/stores/FileBrowserStore.ts:186`, `src/server/stores/FileBrowserStore.ts:192`, `src/server/stores/FileBrowserStore.ts:204`; `src/server/stores/FileBrowserJourneyStore.ts:75`, `src/server/stores/FileBrowserJourneyStore.ts:85`).

Removal checks the pathname for links, not ownership or the identity read earlier; final cleanup can likewise unlink another holder’s replacement lock (`src/server/stores/FileBrowserStore.ts:158`, `src/server/stores/FileBrowserStore.ts:219`). These are cooperating writers, not the excluded hostile symlink-replacement scenario. The current recovery test exercises one recovering parent, while the process race begins without a dead lock (`tests/src/server/stores/suite.ts:140`, `tests/src/server/stores/suite.ts:169`).

Required repair: make stale-lock reclamation and release ownership-safe under concurrent recoverers, then pin this ordering with real processes. Preserve immediate refusal of a live or indeterminate holder. Also settle the empty-lock crash window identified under S-O7 (`src/server/stores/FileBrowserStore.ts:195`).

### N2 — REFUTED: secret selection errors leak through receipts

Use a real DOM select named “Access level” with option “public”; execute a valid type.text secret binding with value “audit-secret-42”. Select lookup fails before any input event and places the value in its BrowserElementError. The choose path rethrows it, perform copies its message into both the result and BrowserAction receipt, and replay copies the receipt into BrowserRunStep.result (`src/browser/elements/BrowserDOMElement.ts:118`, `src/browser/elements/BrowserDOMElement.ts:129`; `src/core/BrowserToolset.ts:1055`, `src/core/BrowserToolset.ts:343`, `src/core/BrowserToolset.ts:356`; `src/core/BrowserReplay.ts:293`).

Run validation checks secret arguments/output/captures but does not remove that result string; file persistence serializes it and run rendering preserves the quoted value (`src/core/helpers.ts:3075`, `src/core/helpers.ts:3098`; `src/server/stores/FileBrowserRunStore.ts:79`; `src/core/helpers.ts:2708`). The page need not display or republish anything. The CDP select path’s generic missing-option message does not share this specific leak (`src/core/compilers.ts:94`).

Required repair: prevent secret-bearing lower-level errors from entering tool/action/run receipts. Add a real DOM missing-option test through perform and replay, including rendered and stored run values; preserve informative non-secret errors and the successful secret receipt. Existing secrecy assertions cover successful password input (`tests/service/journey.test.ts:965`, `tests/service/journey.test.ts:977`).

### N3 — REFUTED: generated JavaScript can execute a prefix before rejecting a missing input

Compile a gap-free journey with s1 clicking “Save draft” and s2 typing a required name parameter. Call the generated JavaScript execute(page, {}). The module starts the toolset, executes s1, then passes undefined from inputs.name into s2, which fails. Replay rejects the same missing input before s1 (`src/core/compilers.ts:513`, `src/core/compilers.ts:550`, `src/core/compilers.ts:562`; `src/core/BrowserToolset.ts:682`; `src/core/BrowserReplay.ts:194`).

Only gaps get generated preflight; runtime input preparation is absent. This contradicts the broader module/replay equivalence in the codegen design, while leaving claim 14’s supplied valid-input fixture matrix intact (`src/core/compilers.ts:557`; `.orkestrel/browser/journeys-design.md:280`; `tests/service/journey.test.ts:265`). The TypeScript spelling control does not exercise JavaScript calls with missing inputs (`tests/service/journey.test.ts:365`).

Required repair: validate runtime inputs before generated side effects, or explicitly narrow the equivalence contract. Pin missing and unknown inputs against a mutating prefix on independently reset fixtures.

## Mutations

- OPEN — A replay-only mutation corrupting dialog/switch receipt or reason is outside the new replay/direct equality table; the older dedicated cases bypass replay (`tests/setup.ts:2296`; `tests/service/journey.test.ts:1018`; `tests/service/toolset.test.ts:219`, `tests/service/toolset.test.ts:251`).
- OPEN — The ordinary two-process race can still pass with an outside-lock revision comparison when one process loses exclusive creation. This is no longer its assigned mutation obligation: held-lock precedence distinguishes the move (`tests/src/server/stores/suite.ts:246`, `tests/src/server/stores/suite.ts:464`; `.orkestrel/browser/ledger.md:424`).
- OPEN — A recovery implementation that unlinks a replacement live lock passes the sole-recoverer test. Add the two-recoverer schedule in N1; the existing assertion observes only the parent’s write after the child exits (`tests/src/server/stores/suite.ts:138`).
- OPEN — Secret interpolation in the DOM missing-option error is outside the successful-password secrecy population; the existing leak is its own surviving negative control (`src/browser/elements/BrowserDOMElement.ts:129`; `tests/service/journey.test.ts:859`).
- OPEN — A compiler omitting all runtime input preparation still passes the valid-input equality matrix and TypeScript spelling control; N3 supplies the missing runtime control (`src/core/compilers.ts:557`; `tests/service/journey.test.ts:265`, `tests/service/journey.test.ts:365`).

VERDICT: FAIL — claims 5, 9, 10, 13, 15, 16; new findings N1–N3; first-round items marked OPEN remain unresolved.