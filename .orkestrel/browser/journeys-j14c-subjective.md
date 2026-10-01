# J14c verdict, subjective lane, over e05e51a (read-only)

Lane: subjective. It covers design fit, API shape and vocabulary, placement, guide and design voice against the code, and test sufficiency from the reader's side. I ran nothing. Every run cited here is the host's record: `tmp/codex/gwave-*.log` from 85b2488 (the parent of e05e51a at `.git/logs/refs/heads/ccr-d15a48b1-yyyll6:251-252`) and `tmp/codex/gwave-fix-*.log` from after the observer move.

## Claims

1. CONFIRMED. The action is captured per signal and emitted as the returned object (`src/core/BrowserToolset.ts:311-385`). The target is captured before input (`src/core/BrowserToolset.ts:1112-1133`). Tests: `tests/src/core/BrowserToolset.test.ts:294` (distinct actions, `:309` definedness), `:333`, `:372`, and `:587`. Host: `tmp/codex/gwave-test:src:core.log:11` (1088 passed).
2. CONFIRMED. `src/core/helpers.ts:123`, `src/core/elements/BrowserElementManager.ts:117`, `tests/src/core/elements/BrowserElementManager.test.ts:603`.
3. CONFIRMED. `src/core/helpers.ts:2386-2396`, `tests/service/journey.test.ts:130`. Host: `tmp/codex/gwave-service-journey.log:11` (31 passed).
4. CONFIRMED. `tests/service/journey.test.ts:196`.
5. CONFIRMED. The dialog and switch rows now replay through `createBrowserReplay`: `tests/service/journey.test.ts:1144-1201` and `tests/setup.ts:2383`. Reader-side weakness: the direct side takes its `ref` from the subject's own resolver (`tests/service/journey.test.ts:1112-1115`, `:1167-1174`), so a resolver defect shows on both sides. See N18.
6. CONFIRMED. `src/core/BrowserToolset.ts:387-412`, `:462-469`. Tests: `tests/src/core/BrowserToolset.test.ts:446`, `:505`, `:549`, `:587`, and `tests/service/journey.test.ts:500`, `:601`.
7. CONFIRMED. `tests/service/journey.test.ts:646`, `tests/src/core/helpers.test.ts:103-126`.
8. CONFIRMED. `src/core/BrowserReplay.ts:174-236`, `:259-263`. Tests: `tests/service/journey.test.ts:690`, `:726`, `:747`.
9. CONFIRMED. `src/server/stores/FileBrowserJourneyStore.ts:72-101`. Tests: `tests/src/server/stores/suite.ts:186-227` (two recoverers) and `:229` (two writers). Host: `tmp/codex/gwave-fix-server.log:11` (239 passed).
10. CONFIRMED by the suites (`tests/src/core/stores/suite.ts:19-132`, `tests/src/server/stores/suite.ts`). The reserved-name refusal comes from the name pattern (`src/core/constants.ts:788`). `BROWSER_FILE_STORE_RESERVED` duplicates that pattern and is never the deciding check (N8).
11. CONFIRMED. `src/server/stores/FileBrowserStore.ts:300-323`, `tests/src/server/stores/FileBrowserStore.test.ts:212`.
12. CONFIRMED. `src/core/recorders/BrowserCodegen.ts:410-424`, `tests/src/core/recorders/BrowserCodegen.test.ts:14`. Host: `tmp/codex/gwave-service-codegen.log:11`.
13. CONFIRMED. `tests/service/journey.test.ts:933`, `tests/src/core/BrowserToolset.test.ts:372`.
14. CONFIRMED. `tests/service/journey.test.ts:274`, `:328`, `:426`.
15. CONFIRMED under the amended wording (`.orkestrel/browser/journeys-design.md:468`). Host: `tmp/codex/gwave-test:distribution.log:11`.
16. UNPROVEN. This is ruled until the ollama proof returns (`.orkestrel/browser/journeys-design.md:551`).
17. UNPROVEN. The claim says every other removal failure is `BROWSER_JOURNEY_ACCESS`. Only the entry-unlink branch has a test (`tests/src/server/stores/FileBrowserStore.test.ts:99-125`). The directory-removal branch at `src/server/stores/FileBrowserStore.ts:390-392` has none: `Cannot remove lock directory` appears nowhere under `tests/`. Missing test: an `rmdir` failure other than `ENOENT` or `ENOTEMPTY` must yield `BROWSER_JOURNEY_ACCESS` naming the path. The rest holds: `tests/src/server/stores/FileBrowserStore.test.ts:21`, `:43`, `:63`, `:83`, `:126`, `:138`, `:154`, and `tests/src/server/stores/suite.ts:186`.
18. CONFIRMED.
    - Code: `src/browser/elements/BrowserDOMElement.ts:126`, `src/core/BrowserToolset.ts:593-601`.
    - Tests: `tests/src/core/BrowserToolset.test.ts:101`, `:134`, `:179`; `tests/src/core/BrowserReplay.test.ts:34`; `tests/src/browser/elements/BrowserDOMElement.test.ts:342`, `:391`.
    - Host: `tmp/codex/gwave-fix-browser.log:11` (235 passed), and `g2a` red on the host (`.orkestrel/browser/journeys-g2-claims.md:55`).
    - Attacked: an echo that truncates the value is outside the claim's "literal or JSON-quoted" scope.
19. UNPROVEN, with one wording mismatch.
    - The journey toolset's read of `held` has no test that tells it apart. The only `record` refusal test uses the journey toolset's own replay (`tests/src/core/BrowserJourneyToolset.test.ts:95-126`), which `#replaying` already refuses (`src/core/BrowserJourneyToolset.ts:519`). Missing test: `record` while a direct `toolset.hold()` or a `createBrowserReplay` owns the toolset.
    - Wording: with the input still pending and no dialog open, the refusal is `An earlier input is still pending; call look.` (`src/core/BrowserToolset.ts:473-479`), not "the dialog receipt". That sentence is in neither § 7 nor the guide (N13).
    - The rest holds: `tests/src/core/BrowserToolset.test.ts:84`, `:205`, `:241`; `tests/src/core/recorders/BrowserRecorder.test.ts:24`; `tests/src/core/BrowserJourneyToolset.test.ts:128`.
20. REFUTED.
    - (a) The default limit. `types.ts:2152` says `BrowserJourneyOptions.limit` "defaults to the enclosing toolset's limit". A directly constructed `BrowserJourneyToolset` falls back to `BROWSER_TOOL_LIMIT` instead (`src/core/BrowserJourneyToolset.ts:88`). Scenario: `new BrowserJourneyToolset(new BrowserToolset(view, { limit: 10 }), { store })` lists at `BROWSER_TOOL_LIMIT`, not 10. Only `src/core/BrowserToolset.ts:287` applies the owner's limit. The pinning test goes through that one path only (`tests/src/core/BrowserJourneyToolset.test.ts:39-80`).
    - (b) The twins differ on `set` with an invalid name. The memory store rejects `set({ ...journey, name: 'Add Kettle' })` with `BROWSER_JOURNEY_INVALID` (`src/core/stores/MemoryBrowserJourneyStore.ts:38`). The file store rejects it with `BROWSER_JOURNEY_PATH` (`src/server/stores/FileBrowserJourneyStore.ts:67`). The shared suite checks only `get` and `delete` (`tests/src/core/stores/suite.ts:35-41`).
    - (c) The guide's Receipts row codes the `journeys` offset refusal `BROWSER_TOOLSET_ARGUMENT` (`guides/browser.md:2896`). The code throws `BROWSER_JOURNEY_ARGUMENT` (`src/core/BrowserJourneyToolset.ts:229-235`), as `guides/browser.md:312` says.
    - Held: the grammar (`src/core/helpers.ts:2911-2944`, `tests/src/core/helpers.test.ts:89`), the edit index (`tests/src/core/helpers.test.ts:1220`), and `context.action` (`tests/src/core/helpers.test.ts:103`).
21. REFUTED on "a change to a home changes every consumer". Journey-tool membership has two homes: `BROWSER_JOURNEY_TOOL_NAMES` (`src/core/constants.ts:835-841`) and the journey half of `BROWSER_JOURNEY_NON_STEP_TOOLS` (`src/core/constants.ts:801-805`).
    - Scenario: append a sixth journey tool to `BROWSER_JOURNEY_TOOL_NAMES`. The toolset reserves it, but the step validator (`src/core/helpers.ts:2880`) and the recorder (`src/core/recorders/BrowserRecorder.ts:116`) still admit it as a step.
    - The observation set is spelled inline at `src/core/BrowserToolset.ts:338` and again, with `wait`, at `:553`.
    - Held: the frame filter (`tests/src/core/recorders/BrowserCodegen.test.ts:14`), the required id (`src/core/types.ts:2596-2599`, `tests/src/core/helpers.test.ts:259`), and `src/core/helpers.ts:1-116` importing no implementation class.
22. CONFIRMED. `src/core/compilers.ts:537-553`, `:578`; `tests/service/journey.test.ts:374`, `:1144`.
23. UNPROVEN.
    - The ledger's counts (`.orkestrel/browser/ledger.md:443`) come from 85b2488 for format, lint, build, core, bin, config, distribution, and service (`tmp/codex/gwave-gates.txt:1-18`). After e05e51a, only check, browser, server, setup, policy, and guides re-ran (`tmp/codex/gwave-fix-*.log`). E05e51a edited `guides/browser.md:311-312` and test files, with no format or lint run after.
    - `npm test` chains `test:setup:browser` and `test:conformance` (`package.json:79`). No gate set in the wave records either. `setup:browser` shares `tests/setupGlobal.ts` with `src:browser` (`vite.config.ts:159`, `:316`), the project whose graph broke (`tmp/codex/gwave-test:src:browser.log:19-22`).
    - No test reads the design's fences. The `add-kettle` fence matches `tests/setup.ts:3588-3605` by inspection only.
    - The Errors table is defective (N3).
24. REFUTED on "no misplaced declaration".
    - `BrowserLockObserver` (`tests/src/server/stores/suite.ts:25-39`) is reusable Node-only test infrastructure, declared in a suite module. `/home/user/scaffold/.claude/rules/tests.md:186` requires such infrastructure in setup files, and `:197` places Node-only helpers in `tests/setupServer.ts`.
    - The cause is `tests/setupGlobal.ts:17`, which imports `tests/setupServer.ts` into the browser projects' global setup. I refer this rule conflict to the Orchestrator; the ledger records the move as a repair (`.orkestrel/browser/ledger.md:443`).
    - The added public member `held` (`src/core/types.ts:2821`) appears nowhere in `guides/browser.md`.
    - The bundle clause holds (`tmp/codex/gwave-fix-browser.log:10-11`).

## Second-round findings

Objective lane (`.orkestrel/browser/journeys-j14b-objective.md`). It lists only N1–N3 (`:129-151`); no N4 or N5 exists there.
- N1, dead-lock reclamation: CLOSED. `tests/src/server/stores/suite.ts:186-227`.
- S-O7, empty crash lock: CLOSED. `tests/src/server/stores/FileBrowserStore.test.ts:126`.
- N2, the DOM secret: CLOSED. `tests/src/browser/elements/BrowserDOMElement.test.ts:342`.
- N3, the module prefix: CLOSED. `tests/service/journey.test.ts:374`.
- Claim 5: CLOSED. `tests/service/journey.test.ts:1144`.
- Claim 15: CLOSED by wording. `.orkestrel/browser/journeys-design.md:468`.
- Claim 16: DEFERRED. `.orkestrel/browser/journeys-design.md:551`.
- The five mutations: CLOSED by `g3b`, `g3c`, the held-lock test, `g1a`, `g2a`, and `g3a` (`.orkestrel/browser/journeys-g{1,2,3}-claims.md`).
- A-O3, the launch double: DEFERRED. `.orkestrel/browser/journeys-design.md:545`.
- A-O4, the nested helper: CLOSED. `wording` is absent from `tests/service/toolset.test.ts`.
- S-design 10, helper placement: DEFERRED. `.orkestrel/browser/journeys-design.md:542`, `.orkestrel/browser/journeys-scaffold-proposal.md:25`.

Subjective lane N1–N10 (`.orkestrel/browser/journeys-j14b-subjective.md`):
- N1: CLOSED. `tests/src/core/helpers.test.ts:89`.
- N2: CLOSED. `tests/src/core/BrowserToolset.test.ts:241`.
- N3: CLOSED, as objective N2.
- N4: CLOSED for the local replay (`tests/src/core/BrowserJourneyToolset.test.ts:95`). OPEN for a foreign hold (claim 19, M1).
- N5: CLOSED, as objective N1.
- N6: CLOSED in code (`tests/src/core/BrowserToolset.test.ts:84`). OPEN in the guide (N16).
- N7: CLOSED. `tests/src/core/helpers.test.ts:1220`.
- N8: CLOSED. `tests/src/core/recorders/BrowserCodegen.test.ts:14`.
- N9: CLOSED (`tests/src/core/BrowserJourneyToolset.test.ts:128`). Guide prose is imprecise (N15).
- N10: CLOSED. `tests/src/core/stores/suite.ts:25`, `tests/src/server/stores/FileBrowserStore.test.ts:173`.

Design fit:
- 1, compound method names: DEFERRED. `.orkestrel/browser/journeys-design.md:545`.
- 2, positional `limit`: CLOSED (`src/core/types.ts:2159`). The default has two homes (claim 20a).
- 3, hold state in several places: CLOSED. `src/core/BrowserToolset.ts:307-309`; `src/core/recorders/BrowserRecorder.ts:59`, `:108`; `src/core/BrowserJourneyToolset.ts:519`.
- 4, the `#action` side channel: CLOSED as worded. Residue in N6.
- 5, the empty-name sentinel: CLOSED (`src/core/BrowserToolset.ts:462`). Residue in N12.
- 6, duplicated sets: OPEN (claim 21, N8).
- 7, `_PATH` on argument errors: CLOSED in code. OPEN in the guide (`guides/browser.md:311`, N3).
- 8, the invented `s1`: CLOSED. `src/core/helpers.ts:2392`.
- 9, the fault line: CLOSED in output (`tests/src/server/stores/FileBrowserJourneyStore.test.ts:25-49`). The mechanism is still wrong (N5).
- 10, the hand-listed grammar: CLOSED. `src/core/helpers.ts:2911-2944`.

First-round carry-overs:
- U16: DEFERRED, as claim 16.
- O4: CLOSED.
- DF1: the added codes are DEFERRED (`.orkestrel/browser/journeys-design.md:545`). `_PATH` on argument errors is OPEN in the guide (N3).
- DF2: DEFERRED. `.orkestrel/browser/journeys-design.md:545`.
- DF6, `s1`: CLOSED.
- The O6 residual, memory `get`: CLOSED (`tests/src/core/stores/suite.ts:35`). The `set` divergence is new (claim 20b).

Second-round mutations:
- `#admit` on `hold()`: OPEN (M2).
- `JSON.stringify` in the secret `chosen` branch: CLOSED. `tests/src/core/BrowserToolset.test.ts:179`.
- The held-start gap: CLOSED. `tests/src/core/recorders/BrowserRecorder.test.ts:24`.
- `continue` to `break` at the old lock line: OPEN (M3).

## New findings

N1 (medium). The guide's Receipts row disagrees with the code and with the Errors table.
- Wrong: `guides/browser.md:2896` codes the `journeys` `offset` refusal `BROWSER_TOOLSET_ARGUMENT`.
- Right: split the row; `journeys` `offset` is `BROWSER_JOURNEY_ARGUMENT` (`src/core/BrowserJourneyToolset.ts:229-235`).

N2 (medium). One sentence carries different codes depending on who throws it.
- Wrong: `Browser toolset limit must be a positive integer` is uncoded at `src/core/BrowserToolset.ts:231-235` and `BROWSER_JOURNEY_ARGUMENT` at `src/core/BrowserJourneyToolset.ts:89-97`. In the journey toolset it names the toolset limit when the bad value is `journeys.limit`. Its overflow directive "raise the toolset limit" (`src/core/BrowserJourneyToolset.ts:270`) is stale once `journeys.limit` is set.
- Right: name `journeys.limit` in both sentences and give one code per sentence.
- Referred to the Orchestrator: the `offset` split (`read` uses `BROWSER_TOOLSET_ARGUMENT` at `src/core/BrowserToolset.ts:617-623`, `journeys` uses `BROWSER_JOURNEY_ARGUMENT` for the same sentence) follows the ruling at `.orkestrel/browser/journeys-design.md:542`.

N3 (medium). The guide's Errors table has four defects.
- `guides/browser.md:312` has no Meaning cell.
- `:311` still lists "a page bound is not a nonnegative integer" under `_PATH`.
- `:298` omits `record` and `hold()` from what raises `BROWSER_TOOLSET_BUSY`.
- `:292` omits `hold()` and the pending-input case from `BROWSER_TOOLSET_DIALOG`.

N4 (medium). The default listing cap has two homes. See claim 20a.
- Right: either state "Default: `BROWSER_TOOL_LIMIT`; a toolset constructed with `journeys` passes its own" at `src/core/types.ts:2152`, or give the interface a way to read its owner's limit.

N5 (medium). The `journeys` tool scrapes store prose with regular expressions to build the fault line (`src/core/BrowserJourneyToolset.ts:244-256`). The store puts the path inside `message` (`src/server/stores/FileBrowserStore.ts:284-287`, `:329`), so the first round's message-parsing pattern returns.
- Right: the store reports a fault with a path-free reason, and an exported `render*` leaf in `src/core/helpers.ts` renders `NAME cannot be read: REASON`, with its own unit test.

N6 (medium). After a step fails, the performed action travels as `unknown` in `context`. Replay re-parses it field by field (`src/core/BrowserReplay.ts:256-307`). The outcome and stage sets are spelled again at `src/core/BrowserReplay.ts:292-293` and `src/core/helpers.ts:3130-3133`.
- Right: a typed carrier for the failed step's `BrowserAction`, and constant homes for the outcome and stage sets.

N7 (medium). Edit attribution re-derives invariants 4 and 5 (`src/core/helpers.ts:2580-2608` against `:3008-3032`). Reason-clause normalization is written twice (`src/core/helpers.ts:2613-2615`, `src/core/BrowserJourneyToolset.ts:497-501`).
- Right: the validator's error context names the parameter, step, and field, so attribution becomes one lookup; one helper normalizes reasons.

N8 (low). More sets without a single home:
- The keys `ref`, `tab`, and `secret`: `src/core/helpers.ts:2918`, `src/core/recorders/BrowserRecorder.ts:138-140`.
- The lock entry format: written at `src/server/stores/FileBrowserStore.ts:183`, parsed by an inline regex at `:199`, and hand-built in tests at `tests/src/server/stores/suite.ts:192` and `tests/src/server/stores/FileBrowserStore.test.ts:143`.
- `BROWSER_FILE_STORE_RESERVED` (`src/server/constants.ts:228-251`) is a dead second copy of the name pattern's lookahead. The check at `src/server/stores/FileBrowserStore.ts:46` cannot fire.

N9 (low). `BROWSER_JOURNEY_LOCK_FILE` names a directory since G1 (`src/server/constants.ts:217-218`, `guides/browser.md:1230`).
- Right: `BROWSER_JOURNEY_LOCK_DIRECTORY`, beside `BROWSER_RUN_DIRECTORY`.

N10 (low). `collectBrowserJourneySecrets` collects every `text` binding, as its own test name says (`tests/src/core/helpers.test.ts:127`; `src/core/helpers.ts:2730-2737`). It also reads page-tool literal arguments as bindings, which `collectBrowserJourneyBindings` skips (`src/core/helpers.ts:2482`).
- Right: derive the taken names from `collectBrowserJourneyBindings`, or rename the function for what it collects.

N11 (low). Sibling functions take the step id in two shapes: positionally in `performBrowserStep` (`src/core/helpers.ts:2418`) and as a required member of `BrowserTargetOptions` (`src/core/types.ts:2596-2599`). The design text was never amended: `.orkestrel/browser/journeys-design.md:264` still shows `options?: BrowserCallOptions`, and `:282` still says `Error('s3: RECEIPT')`.

N12 (low). The `#admit` category `'hold'` behaves exactly like `'action'` (`src/core/BrowserToolset.ts:462-468`), so the union is reducible. The private `#hold(command)` (`src/core/BrowserToolset.ts:1330`) reuses the public `hold` verb for a pending input.

N13 (low). The sentence `An earlier input is still pending; call look.` (`src/core/BrowserToolset.ts:476`) is in neither § 7 nor the guide's Receipts table. Its test checks only the code (`tests/src/core/BrowserToolset.test.ts:279-281`).

N14 (low). The `BrowserToolsetInterface` remarks list only `adopt`, `skip`, and `select` as events (`src/core/types.ts:2808`); `action`, `hold`, and `release` are missing.

N15 (low). `guides/browser.md:3131` says the next `save` "writes the same steps". After G5a, the retry also writes the steps recorded since the refusal.

N16 (low). Guide invariant 21 (`guides/browser.md:3060`) and the class TSDoc (`src/core/BrowserToolset.ts:153`) never say a page tool named `unresolved` is skipped. The skip is coded at `src/core/BrowserToolset.ts:1778`.

N17 (low). The memory twins repeat the name check six times (`src/core/stores/MemoryBrowserJourneyStore.ts:27`, `:54`; `src/core/stores/MemoryBrowserRunStore.ts:25`, `:43`, `:73`, `:84`). The paging check appears three times (`src/core/stores/MemoryBrowserJourneyStore.ts:68`, `src/core/stores/MemoryBrowserRunStore.ts:91`, `src/server/stores/FileBrowserStore.ts:251-260`).
- Right: one exported helper for each check.

N18 (low). The claim 5 proof checks replay against its own locator on the direct side (claim 5).

N19 (low). The same input refusal reads three ways: `has no input named` (`src/core/BrowserReplay.ts:194`), `has no parameter` (`src/core/BrowserJourneyToolset.ts:379`), and `no parameter has that name` (`src/core/compilers.ts:548`).

N20 (low). The design's layout fence shows a lock entry `4121-9f2c0b7e` (`.orkestrel/browser/journeys-design.md:121-122`). The parser refuses that name (`src/server/stores/FileBrowserStore.ts:199`).

## Mutations

- M1. Drop `?? this.#toolset.held` at `src/core/BrowserJourneyToolset.ts:519`. No named assertion fails. `record` under a foreign hold is untested. `replay` is still refused by the toolset itself with the same sentence (`src/core/BrowserToolset.ts:394`, test `tests/src/core/BrowserJourneyToolset.test.ts:925-928`).
- M2. Delete `this.#admit('hold', undefined)` at `src/core/BrowserToolset.ts:394`. No test runs a second `hold()` while one is held.
- M3. Change `continue` to `break` at `src/server/stores/FileBrowserStore.ts:194`. The directory vanishing between `mkdir` reporting `EEXIST` and `readdir` is untested.
- M4. Make `#removeLock` return instead of throwing at `src/server/stores/FileBrowserStore.ts:390-392`. Nothing fails (claim 17).
- M5. Reword `src/core/BrowserToolset.ts:476`. Nothing fails; the test checks the code only (`tests/src/core/BrowserToolset.test.ts:279-281`).
- M6. Delete `|| BROWSER_FILE_STORE_RESERVED.includes(name)` at `src/server/stores/FileBrowserStore.ts:46`. Behaviour does not change.

VERDICT: FAIL. Claims 20, 21, and 24 are REFUTED; 17, 19, and 23 are UNPROVEN (16 is ruled); new findings N1–N7 are medium and require changes.
