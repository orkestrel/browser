The sandbox rejected writing `tmp/units/journeys/j14-objective.md`. The full verdict follows.

# J14 objective verdict

Scope: `ef2a3185726525c1d5bddfd4ce1343ace9f76b67`. Confirmations concern inspected implementation and test assertions; they do not claim fresh Chromium or filesystem-suite execution. A read-only compiler probe confirmed the emission described under claim 14.

## 1. CONFIRMED

Invocation-local signals key the action state, manager dispatch enters `perform`, and the emitted object is the returned action (`src/core/BrowserToolset.ts:303`, `src/core/BrowserToolset.ts:345`, `src/core/BrowserToolset.ts:425`). Target capture precedes input; switch and secret metadata have explicit branches (`src/core/BrowserToolset.ts:1060`, `src/core/BrowserToolset.ts:997`, `src/core/BrowserToolset.ts:320`).

Assertions distinguish shared concurrent results, late target capture, secret echoing, and missing interruption (`tests/src/core/BrowserToolset.test.ts:115`, `tests/src/core/BrowserToolset.test.ts:153`, `tests/src/core/BrowserToolset.test.ts:193`, `tests/src/core/BrowserToolset.test.ts:379`). The native settlement comparison checks receipts, stage, reason, and outcomes (`tests/service/toolset.test.ts:178`).

## 2. CONFIRMED

Both managers use the normalized filter whose exact branch preserves case (`src/core/helpers.ts:112`, `src/core/elements/BrowserElementManager.ts:117`, `src/browser/elements/BrowserDOMElementManager.ts:168`).

The shared cases distinguish `Save`, `save`, `Save draft`, normalized whitespace, and partial names; both manager tests assert those declared results (`tests/setup.ts:1675`, `tests/src/core/elements/BrowserElementManager.test.ts:19`, `tests/src/browser/elements/BrowserDOMElementManager.test.ts:381`). Substring matching adds draft matches; case folding adds the opposite-case match, so either mutation changes the expected collection.

## 3. CONFIRMED

Resolution uses only role, name, and exact matching, requiring one result before forwarding input; stored references cannot bypass that check (`src/core/helpers.ts:2367`, `src/core/helpers.ts:2417`).

The Chromium proof changes markup, asserts the uniquely intended click, then asserts duplicate refusal, no dispatched mouse input, and an empty click log. Its control demonstrates that the log and transport detect input (`tests/service/journey.test.ts:125`, `tests/service/journey.test.ts:152`, `tests/service/journey.test.ts:165`, `tests/service/journey.test.ts:172`). Removing the uniqueness refusal makes these assertions fail.

## 4. CONFIRMED

The missing-target branch throws `BROWSER_JOURNEY_TARGET` and never queries CSS (`src/core/helpers.ts:2372`).

The test supplies a selector matching one different control, checks the code, and asserts no CSS query or mouse input (`tests/service/journey.test.ts:187`). A CSS fallback would violate both the refusal and zero-input assertions.

## 5. CONFIRMED

Action-specific construction and unchanged page-tool arguments are implemented in `performBrowserStep`; replay retains the returned action even when the helper rejects, and stops its suffix (`src/core/helpers.ts:2416`, `src/core/BrowserReplay.ts:241`, `src/core/BrowserReplay.ts:281`, `src/core/BrowserReplay.ts:124`).

Pins cover literal adopted arguments, argument construction, interruption, native receipt/stage/reason equality, DOM child-frame input, semantic switching, and the popup move note (`tests/src/core/helpers.test.ts:85`, `tests/src/core/helpers.test.ts:256`, `tests/src/core/helpers.test.ts:296`, `tests/service/toolset.test.ts:157`, `tests/service/toolset.test.ts:178`, `tests/service/toolset.test.ts:219`, `tests/service/toolset.test.ts:251`, `tests/service/toolset.test.ts:276`). Injecting `ref` into `wait` changes its receipt to an argument refusal; continuing after timeout executes the forbidden suffix (`tests/service/journey.test.ts:594`).

## 6. CONFIRMED

Admission checks the hold token before dispatch, acquisition joins the action queue, and replay releases in `finally` (`src/core/BrowserToolset.ts:364`, `src/core/BrowserToolset.ts:431`, `src/core/BrowserToolset.ts:513`, `src/core/BrowserReplay.ts:143`).

Tests pin cancellation of a queued hold, ordering after admitted work, foreign adopted actions and dialog answers, and the owner's continuation (`tests/src/core/BrowserToolset.test.ts:267`, `tests/src/core/BrowserToolset.test.ts:326`, `tests/src/core/BrowserToolset.test.ts:379`). The Chromium abort case checks one executed step, one release, no suffix effect, and a successful later foreign click (`tests/service/journey.test.ts:528`). Removing admission or release changes those assertions.

## 7. CONFIRMED

The timeout branch changes the action outcome while preserving the receipt (`src/core/BrowserToolset.ts:911`). Replay stops on that outcome (`src/core/BrowserReplay.ts:124`).

The host test asserts timeout, the unchanged direct receipt, the absent suffix click and navigation, and a positive control that executes them (`tests/service/journey.test.ts:569`). Changing `timeout` to `done` would allow Review to execute and fail the page-log and pathname assertions at `tests/service/journey.test.ts:604`.

## 8. CONFIRMED

Preparation precedes hold acquisition and run allocation, checks inputs, gaps, and placement, while dialog admissibility is checked when reached (`src/core/BrowserReplay.ts:66`, `src/core/BrowserReplay.ts:167`, `src/core/BrowserReplay.ts:236`).

Host cases assert coded rejection, zero page events, no input frames, and no stored run, then prove a valid control and preservation of a later-refused DOM prefix (`tests/service/journey.test.ts:613`, `tests/service/journey.test.ts:649`, `tests/service/journey.test.ts:670`). Unprompted dialog refusal is pinned separately (`tests/src/core/BrowserReplay.test.ts:382`). Moving preparation after the first action breaks the zero-event assertion.

## 9. UNPROVEN

The editor and locked revision check implement the requested behavior (`src/core/helpers.ts:2487`, `src/server/stores/FileBrowserJourneyStore.ts:73`). Editing assertions cover non-reused ids, unbound declarations, key merging, pruning, and atomic refusal; the service test covers ref conversion and stale edits (`tests/src/core/helpers.test.ts:1123`, `tests/src/core/helpers.test.ts:1131`, `tests/src/core/helpers.test.ts:1147`, `tests/src/core/helpers.test.ts:1191`, `tests/service/journey.test.ts:724`).

The stipulated two-process mutation proof is missing. Its children have a startup barrier, but no barrier between reading the revision and acquiring the lock, and either `LOCKED` or `STALE` satisfies the rejection assertion (`tests/setupServer.ts:1458`, `tests/setupServer.ts:1514`, `tests/setupServer.ts:1520`). With the comparison moved outside the lock, overlapping lock attempts can still yield one save and one `LOCKED` refusal.

J9 instead reports killing that mutation with a held-lock precedence test (`.orkestrel/browser/journeys-j9-claims.md:50`). Add a deterministic two-process stale-read interleaving; do not credit the existing race with proving it.

## 10. UNPROVEN

Corruption, version checks, retained revisions, exclusive locking, atomic replacement, and paging are implemented (`src/server/stores/FileBrowserJourneyStore.ts:33`, `src/server/stores/FileBrowserJourneyStore.ts:73`, `src/server/stores/FileBrowserStore.ts:120`, `src/server/stores/FileBrowserStore.ts:173`, `src/server/stores/FileBrowserStore.ts:198`).

Corresponding assertions cover reopening, malformed files, competing writers, deletion/recreation, locks, failed writes, paging, reserved names, and component links (`tests/setupServer.ts:1554`, `tests/setupServer.ts:1574`, `tests/setupServer.ts:1663`, `tests/setupServer.ts:1687`, `tests/setupServer.ts:1710`, `tests/setupServer.ts:1735`, `tests/setupServer.ts:1759`, `tests/src/server/stores/FileBrowserJourneyStore.test.ts:24`). Returning `undefined` for corruption fails the rejection assertions at `tests/setupServer.ts:1598`.

Permission-error behavior remains unproved on the supplied host evidence: the sole chmod case skips root, and J9 reports that skip (`tests/setupServer.ts:1625`, `.orkestrel/browser/journeys-j9-claims.md:67`). Require a run under a principal for which the fixture actually denies access and assert `BROWSER_JOURNEY_ACCESS`.

## 11. CONFIRMED

Allocation uses exclusive `mkdir` and retries `EEXIST`; capture requires the original opened slot, a constrained filename, and an existing owned directory (`src/server/stores/FileBrowserStore.ts:251`, `src/server/stores/FileBrowserRunStore.ts:34`, `src/server/stores/FileBrowserRunStore.ts:88`).

The forced first-candidate collision asserts distinct ids and directory membership; capture tests reject forged slots, missing directories, and component links (`tests/src/server/stores/FileBrowserStore.test.ts:9`, `tests/src/server/stores/FileBrowserRunStore.test.ts:20`, `tests/src/server/stores/FileBrowserRunStore.test.ts:42`, `tests/src/server/stores/FileBrowserRunStore.test.ts:54`). Reusing a colliding directory or recreating a deleted capture directory violates those assertions.

## 12. REFUTED

Navigation is not retained as settlement evidence. For a recorded click followed by `Page.frameNavigated`, the navigation handler only flushes an edit and clears Enter state; it discards the destination and records no navigation evidence (`src/core/recorders/BrowserCodegen.ts:419`). The emitted step remains the click assembled at `src/core/recorders/BrowserCodegen.ts:373`, indistinguishable from the same click without navigation.

The tests assert edit separation and absence of `navigate` steps, not retained settlement evidence (`tests/src/core/recorders/BrowserCodegen.test.ts:183`, `tests/service/codegen.test.ts:154`).

The remaining gesture and password properties have direct pins, including fixture-log comparison and the raw binding transport check (`tests/service/codegen.test.ts:74`, `tests/service/codegen.test.ts:123`, `tests/service/codegen.test.ts:145`; `src/core/constants.ts:277`). Preserve those properties when resolving the missing-evidence contract.

## 13. CONFIRMED

Secret text is removed from action arguments and replaced in receipts, recorded as a parameter binding, excluded from run inputs, and suppresses output and captures (`src/core/BrowserToolset.ts:320`, `src/core/BrowserToolset.ts:707`, `src/core/recorders/BrowserRecorder.ts:161`, `src/core/BrowserReplay.ts:72`, `src/core/BrowserReplay.ts:109`, `src/core/BrowserReplay.ts:267`). Secret bindings outside `type.text` are rejected (`src/core/validators.ts:252`; `tests/src/core/validators.test.ts:43`, `tests/src/core/validators.test.ts:60`).

The end-to-end test searches journey/run files, listing, render, receipts, actions, and both generated languages for the value and its prefix, asserts no capture files or output, and verifies delivery to the page (`tests/service/journey.test.ts:947`, `tests/service/journey.test.ts:958`, `tests/service/journey.test.ts:969`). Direct-call receipt and protocol delivery are independently pinned (`tests/src/core/BrowserToolset.test.ts:193`). This confirmation respects the design's explicit page-display bound (`.orkestrel/browser/journeys-design.md:261`).

## 14. REFUTED

Use a journey with `s1 click button "Save draft"` and `s2 unresolved`. Generated `execute` performs s1 before throwing at s2; replay rejects during preparation before s1 (`src/core/compilers.ts:530`, `src/core/compilers.ts:548`, `src/core/BrowserReplay.ts:66`, `src/core/BrowserReplay.ts:189`). On the form fixture this produces a saved draft/click in the module and no click in replay. The read-only compiler probe emitted exactly that call-before-throw ordering.

The existing test deliberately places a side-effect-free wait before the gap, so its equality assertion cannot distinguish this defect (`tests/setup.ts:3857`, `tests/setup.ts:3866`, `tests/service/journey.test.ts:317`). The successful-case outcome, receipt, and type-check assertions remain relevant but do not prove preparation parity (`tests/service/journey.test.ts:303`, `tests/service/journey.test.ts:362`). Add a mutating prefix before the gap and align generated preparation with replay.

## 15. UNPROVEN

The packed test covers vocabulary without Chromium, recording/editing/replay, run placement, and profile removal after client disconnect (`tests/distribution.test.ts:1171`). Shared startup and exclusive profiles are implemented (`src/server/BrowserMCPServer.ts:199`, `src/server/BrowserMCPServer.ts:211`).

The concurrency proof sends two requests through one in-memory stream and substitutes `BrowserLaunchDouble` for the browser; it does not observe real launch count through concurrent MCP clients (`tests/src/server/BrowserMCPServer.test.ts:71`, `tests/setupServer.ts:1816`). The spawned EOF test follows a failed launch, and the spawned SIGTERM test never launches Chromium, so neither proves EOF cleanup of a live browser/profile (`tests/src/bin/main.test.ts:73`, `tests/src/bin/main.test.ts:107`).

Add packed host cases for concurrent first calls, independent live profiles, and EOF with a live browser; observe actual process termination and profile removal.

## 16. UNPROVEN

The available consumer still constructs its toolset without journeys (`../ollama/tests/setupStore.ts:796`). Its form proof checks that orders contain the buyer, not the once-only edited replay and persisted journey/run artifacts (`../ollama/tests/service/browser.test.ts:205`).

J11b specifies the required new flow and measurements, but that dispatch is not execution evidence (`tmp/units/journeys/j11b-brief.md:11`, `tmp/units/journeys/j11b-brief.md:22`). Supply the implemented model test and transcripts recording attempts, malformed calls, tool-list cost, the edit batch, one replayed order, and persisted files.

## Outside the claims

**O1 — Valid journeys disappear after a corrupt entry.** With limit 1 and sorted names `alpine`, `broken`, `harbor`, `zebra`, where `broken` contains malformed JSON, the first store page contains `alpine` and a fault. The tool advances to offset 2 because it adds faults, while the file store counts only readable entries; the next page therefore starts at `zebra` and `harbor` disappears (`src/core/BrowserJourneyToolset.ts:239`, `src/core/BrowserJourneyToolset.ts:242`, `src/server/stores/FileBrowserStore.ts:228`). The real filesystem fixture already pins readable-entry offsets (`tests/setupServer.ts:1735`). Advance by `entries.length` and add an integration test over the real file store.

**O2 — Recording a popup-opening action creates a false child-frame gap.** A click on the opener captures `target.frame` as the opener's id (`src/core/BrowserToolset.ts:1070`). Settlement selects the popup before emitting `action` (`src/core/BrowserToolset.ts:1180`, `src/core/BrowserToolset.ts:1258`, `src/core/BrowserToolset.ts:360`). The recorder compares that original frame with the now-current popup id and emits `unresolved` instead of `click` (`src/core/recorders/BrowserRecorder.ts:146`). Consequently the saved journey cannot replay because preparation rejects its gap (`src/core/BrowserReplay.ts:189`). Compare against the action's originating page, while continuing to reject genuine child-frame targets. The purported regression test supplies a frame-less action and never moves the view, so it misses this path (`tests/src/core/recorders/BrowserRecorder.test.ts:37`).

**O3 — A behavioral fake conceals the paging integration defect.** The listing test replaces `store.list` with a function that returns the next entry only for offset 2, then asserts that very offset (`tests/src/core/BrowserJourneyToolset.test.ts:422`, `tests/src/core/BrowserJourneyToolset.test.ts:450`). This contradicts the real store's readable-entry offset and violates the prohibition on reimplementing project-owned behavior in a fake (`/home/user/scaffold/.claude/rules/tests.md:27`, `/home/user/scaffold/.claude/rules/tests.md:30`). Replace it with a real filesystem fixture containing a corrupt file. `BrowserLaunchDouble` likewise substitutes browser lifecycle behavior rather than recording a real browser's lifecycle (`tests/setupServer.ts:1886`, `tests/setupServer.ts:1940`); it cannot discharge claim 15's host integration obligations.

**O4 — Prohibited nested helper.** The dialog equality test declares and assigns `wording` inside its test callback (`tests/service/toolset.test.ts:242`). This violates the explicit ban on local function assignments (`/home/user/scaffold/.claude/rules/architecture.md:167`). Inline the one-use projection or move reusable behavior to the designated setup helper.

## Mutations

**M1 — The two-process test does not reliably kill the revision-comparison mutation.** If both outside-lock checks read revision 1 and their exclusive lock attempts overlap, one writer saves and the other returns `LOCKED`: all assertions still pass (`tests/setupServer.ts:1516`, `tests/setupServer.ts:1520`). J9's reported kill is a different assertion, held-lock precedence (`.orkestrel/browser/journeys-j9-claims.md:50`). A forced stale-read schedule is missing.

**M2 — The gap equality assertion survives dropping the pre-gap wait.** Removing s1 from the generated gap fixture still leaves the same page state and the same s2 throw; the test asserts no pre-gap receipt or execution count (`tests/setup.ts:3866`, `tests/service/journey.test.ts:350`). J7b's reported step-removal mutation only targets the successful-case matrix (`.orkestrel/browser/journeys-j7b-claims.md:59`). It supplies no negative control for gap preparation parity.

**M3 — The popup-recording regression assertion survives rejecting every action carrying frame metadata.** Its fixture supplies no `target.frame`, so the assertion never reaches the load-bearing comparison (`tests/src/core/recorders/BrowserRecorder.test.ts:41`, `src/core/recorders/BrowserRecorder.ts:149`). A real popup action carrying the opener frame is the missing control.

**VERDICT: FAIL — claims 9, 10, 12, 14, 15, 16 remain open; outside findings O1–O4.**