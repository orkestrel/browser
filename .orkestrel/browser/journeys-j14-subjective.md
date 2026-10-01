# J14 falsify verdict: journeys at ef2a318 (Opus reviewer, objective lane assigned, read-only)

Summary: 9 CONFIRMED (claims 1, 2, 3, 4, 7, 11, 12, 13, 15), 5 UNPROVEN (claims 5, 8, 9, 10, 16), 2 REFUTED (claims 6, 14).

## Claims

1. CONFIRMED. `perform` keys per-call state by its signal (`src/core/BrowserToolset.ts:303-362`); `tools.execute` enters through `#dispatch` into `perform` (`:414-429`); the target and frame are captured before any input (`:1060-1081`); a dialog yields `interrupted` (`:533-534`); `switch` records `tab` (`:996-1000`); a secret `type` drops `text` (`:320-329`). Tests `tests/src/core/BrowserToolset.test.ts:115-151`, `:153-191`, `:193-243`, `:379-437`, `:3642-3647`; live `tests/service/toolset.test.ts:178-217`. Weakly pinned: the "own action" property is caught only through the emission count at `:137`.
2. CONFIRMED. Exact matching `src/core/helpers.ts:129-133`; both managers use it (`src/core/elements/BrowserElementManager.ts:117`, `src/browser/elements/BrowserDOMElementManager.ts:168`); case table `tests/setup.ts:1671-1711` in both placements.
3. CONFIRMED. Replay drops `css` and `reference` (`src/core/BrowserReplay.ts:250-257`); the locator queries role and exact name (`src/core/helpers.ts:2372-2375`); `tests/service/journey.test.ts:125-183`.
4. CONFIRMED. `tests/service/journey.test.ts:187-211` asserts `BROWSER_JOURNEY_TARGET`, no input, no `DOM.querySelectorAll`.
5. UNPROVEN. The live equality case compares `toolset.perform` with `tools.execute`, the same path (`src/core/BrowserToolset.ts:425`), and never runs a replay; the child-frame case calls `performBrowserStep`, not `createBrowserReplay` (`tests/service/toolset.test.ts:157-177`). Missing: `createBrowserReplay` over a one-step journey per `BROWSER_JOURNEY_SERVICE_CASES` row compared with a direct `tools.execute` on a fresh fixture, and a DOM-placement replay over the child-frame step.
6. REFUTED. Scenario: adopted action A pending; `hold('add-kettle')` queues behind A (`src/core/BrowserToolset.ts:370`); a foreign `click` B arrives, `#admit` passes because no reservation exists (`:432-441`, called at `:513`), B queues behind the hold's turn (`:1096-1100`); A ends, the hold reserves and releases its turn (`:374-379`); B runs inside the held window without the token. B's `action` lands between `hold` and `release`; the recorder drops it (`src/core/recorders/BrowserRecorder.ts:118`); B's input races the replay's resolution of s1 (`src/core/helpers.ts:2417-2419`). No test admits a foreign action while `hold()` waits. Fix: reserve admission at the `hold()` call.
7. CONFIRMED. `src/core/BrowserToolset.ts:910-920`, `src/core/BrowserReplay.ts:124-137`, `src/core/helpers.ts:2443-2451`; `tests/src/core/BrowserReplay.test.ts:169-186`; `tests/service/journey.test.ts:569-609`.
8. UNPROVEN. The `dialog` admission rule (`src/core/BrowserReplay.ts:236-240`) has no pin: deleting it leaves `tests/src/core/BrowserReplay.test.ts:382-404` green because the withdrawn tool refuses anyway. Missing: a dialog opened between steps, the following `dialog` step refused with no `Page.handleJavaScriptDialog` sent.
9. UNPROVEN. The two-process test accepts `BROWSER_JOURNEY_LOCKED` for the loser (`tests/setupServer.ts:1520-1527`), so moving the comparison outside the lock survives it; `j9b` failed the held-lock test instead (`.orkestrel/browser/journeys-j9-claims.md:50`).
10. UNPROVEN. The permission case skips as root (`tests/setupServer.ts:1625`); the `BROWSER_JOURNEY_ACCESS` branch (`src/server/stores/FileBrowserStore.ts:281-282`) has never run.
11. CONFIRMED. `src/server/stores/FileBrowserStore.ts:251-274`, `src/server/stores/FileBrowserRunStore.ts:88-105`; `tests/src/server/stores/FileBrowserStore.test.ts:9`, `tests/src/server/stores/FileBrowserRunStore.test.ts:20-77`.
12. CONFIRMED. `src/core/recorders/BrowserCodegen.ts:305-403`; `tests/service/codegen.test.ts:74-152`, `:154-180`.
13. CONFIRMED. `src/core/BrowserToolset.ts:707-708`, `:320-329`; `src/core/BrowserReplay.ts:72-75`, `:90`, `:109`, `:154`, `:266-267`; `src/core/validators.ts:252-256`; `src/core/compilers.ts:533-548`; `src/core/helpers.ts:2612-2616`; tests `tests/src/core/BrowserToolset.test.ts:193-243`, `tests/src/core/BrowserReplay.test.ts:760-830`, `tests/service/journey.test.ts:856`. The replay tool's final view can show a non-password field's value, the bound design § 4 documents.
14. REFUTED (the gap clause). `[s1 click button "Save draft", s2 unresolved]` on `/form`: the module performs s1 and throws at s2 (`src/core/compilers.ts:531-532`), the page ends `{ clicks: 1, saved: 'yes' }`; replay rejects at preparation (`src/core/BrowserReplay.ts:190-191`) with `{ clicks: 0, saved: 'no' }`. The gap fixture's prefix is a side-effect-free `wait` (`tests/setup.ts:3864-3868`).
15. CONFIRMED. `src/server/BrowserMCPServer.ts:104-113`, `:199-209`, `:212-217`, `:131-167`; `tests/distribution.test.ts:1171-1247`; `tests/src/bin/main.test.ts:73-127`; `tests/src/server/BrowserMCPServer.test.ts:71-120`, `:179-225`. Caveat: the packed run never exercises a journey refusal (finding 1).
16. UNPROVEN. No run artifact under `/home/user/ollama/tmp`; J11's report does not mention claim 16.

## Outside the claims

1. The packed server bundle carries a second `BrowserError` class, so the `edit` and `save` refusals degrade: the store files import core by relative path (`src/server/stores/FileBrowserStore.ts:7`, `FileBrowserJourneyStore.ts:10-11`, `FileBrowserRunStore.ts:11-14`) while the server build externalizes only `@src/core` (`vite.config.ts:191-195`), giving `var BrowserError$1` at `dist/src/server/index.js:873` beside core's class; `isBrowserError` is an `instanceof` check (`src/core/errors.ts:128-130`), so in the binary a stale `edit` reports `Editing X failed: …` with `BROWSER_JOURNEY_FILE` instead of the stale sentence (`src/core/BrowserJourneyToolset.ts:289-295`) and a locked `save` loses its sentence (`:210-211`). Source tests resolve both specifiers to one file. Fix: import from `@src/core`; add a distribution case for a stale `edit`.
2. The toolset recorder records a popup-opening click as a child-frame gap (`src/core/BrowserToolset.ts:1179-1180`, `:1258`, `:1070-1078`; `src/core/recorders/BrowserRecorder.ts:148-153`); the recorder test uses an action without a frame.
3. `journeys` skips readable entries after a fault (the tool advances by entries plus faults, `src/core/BrowserJourneyToolset.ts:242-243`; the store counts readable entries, `src/server/stores/FileBrowserStore.ts:229-230`), and `.profiles` is always a fault (`src/server/BrowserMCPServer.ts:213-214`, `src/server/stores/FileBrowserStore.ts:38-40`), so with more than 100 journeys the 101st is never listed.
4. `save` overwrites a journey another server saved after `record` checked the name (`src/core/BrowserJourneyToolset.ts:176`, `:207`; `src/server/stores/FileBrowserJourneyStore.ts:77`). Fix: a create-only expectation.
5. NOT-EVIDENCED: replay captures a screenshot after an `interrupted` step while the dialog is open (`src/core/BrowserReplay.ts:108-118`); a failed capture stops the run before the `dialog` step (`:140-142`).
6. The memory and file twins diverge: `MemoryBrowserRunStore.set` accepts a run it never opened (`src/core/stores/MemoryBrowserRunStore.ts:44-50`) while the file twin refuses (`src/server/stores/FileBrowserRunStore.ts:137-142`); the memory journey store accepts negative paging (`src/core/stores/MemoryBrowserJourneyStore.ts:61-66`) while the file twin refuses (`src/server/stores/FileBrowserStore.ts:205-211`); the stale sentences differ (`MemoryBrowserJourneyStore.ts:39`, `FileBrowserJourneyStore.ts:79`). The shared suites test none of these edges.
7. A crashed `set` or `delete` leaves `journey.lock` (`src/server/stores/FileBrowserStore.ts:173-189`); the stdio host sends SIGKILL after its grace window; the refusal's "call save again" then loops forever.
8. The shared store suites register `describe`, `it`, and `expect` in `tests/setup.ts:3188`, which `/home/user/scaffold/.claude/rules/tests.md:187` forbids.

## Mutations

1. Deleting `src/core/BrowserReplay.ts:236-240` survives `tests/src/core/BrowserReplay.test.ts:382-404` (claim 8).
2. Moving the revision comparison outside the lock survives the two-process oracle (claim 9).
3. Mapping `EACCES` or `EPERM` to `BROWSER_JOURNEY_FILE` survives every recorded host run (claim 10).
4. A compiler that throws before `toolset.start()`, and one that throws after the prefix, both pass `tests/service/journey.test.ts:317-360` (claim 14).
5. Keying action state by `call.id` is caught only by the third emission's receipt (`tests/src/core/BrowserToolset.test.ts:137`); no assertion requires `second.action` to be defined.
6. `j7b1` was never shown to fail the popup case.

## Design fit

1. Error codes grew past § 11: `BROWSER_JOURNEY_INVALID`, `_MISSING`, `_SAVED`, `_RECORDING`, `_READONLY`, `_DIALOG`; `_PATH` also used for argument errors.
2. `FileBrowserStore` methods are nouns (`name`, `id`, `path`, `directory`, `error`).
3. Barrel exports no consumer can usefully construct: `BrowserHold` (`src/core/index.ts:34`), `FileBrowserStore` (`src/server/index.ts:10`).
4. Duplicated logic: secret-binding detection at five sites; `journey()` duplicated between the two recorders.
5. Replay duck-types the view (`src/core/BrowserReplay.ts:289-295`, `:319-323`).
6. `performBrowserStep` resolves tabs by parsing `tabs` prose (`src/core/helpers.ts:2422-2440`); the locator invents `s1` when no id is given.
7. Preparation errors carry no `context`, so the journey tool parses messages (`src/core/BrowserJourneyToolset.ts:399`).
8. Stores speak the tool's directives (`src/core/stores/MemoryBrowserJourneyStore.ts:39`, `src/server/stores/FileBrowserStore.ts:179`).
9. The coded fault travels through a `WeakMap` keyed by the result object (`src/core/BrowserToolset.ts:201`, `:359`, `:427`).
10. Throwing validators sit in `validators.ts`, which `/home/user/scaffold/.claude/rules/patterns.md:116` reserves for total `is*` guards; I/O orchestration sits in `helpers.ts`.
