# J14b falsify verdict: journeys at 897a99e (Opus reviewer, objective lane assigned, read-only)

Summary: claims 1–5, 7–12, 14, 15 CONFIRMED; 6 REFUTED (a `hold()` called while a click's dialog is open waits on `#pending` with `#waiting` set, so the `dialog` call that would answer it is refused with `BROWSER_TOOLSET_BUSY` and the toolset deadlocks until the signal aborts); 13 REFUTED in the DOM placement (`BrowserDOMElement.select` quotes the secret in `Element e5 has no option "hunter2".`, which reaches the result, the action, the run, and the render); 16 UNPROVEN (no transcript records a replay yet).

First-round findings: R6, R14, U5, U8, U9, U10, O1–O8, M1–M6, DF3, DF4, DF7, DF8, DF10, the objective lane's claim 12 and 15, O3, M3 CLOSED; U16 OPEN; O4 (the nested `wording` helper) OPEN; DF1 DEFERRED for the added codes and OPEN for `_PATH` on argument errors; DF2 OPEN (compound verbs); DF5, DF6 (tabs prose), DF9 DEFERRED; DF6 OPEN for the invented `'s1'`. O6 residual: the memory `get` returns `undefined` for an invalid name while the file twin refuses with `BROWSER_JOURNEY_PATH`.

New findings:
- N1 (high): a recorded `wait` with `timeout` can never be saved; the step grammar admits only `text` on `wait` (`src/core/helpers.ts:2841-2863`), `save` fails with `has malformed native arguments`, the step stays, and `record` refuses while the recording holds.
- N2 (high): the hold deadlock under claim 6 (`src/core/BrowserToolset.ts:371-379`, `:1108-1109`, `:439-448`, `:521-527`).
- N3 (medium): the DOM secret leak under claim 13 (`src/browser/elements/BrowserDOMElement.ts:124-130`; `src/core/BrowserToolset.ts:339-356`; `src/core/BrowserReplay.ts:280`, `:293`).
- N4 (medium): `record` during a replay records the replayed steps; the new recorder subscribes after the `hold` event so `#held` stays unset (`src/core/BrowserJourneyToolset.ts:163-192`; `src/core/recorders/BrowserRecorder.ts:42-44`, `:58-59`).
- N5 (medium): two reclaimers of a dead holder's lock both enter the critical section (`src/server/stores/FileBrowserStore.ts:186`, `:192`, `:204`); a crash between the exclusive create and the pid write leaves an empty lock refused forever (`:196`).
- N6 (low): `unresolved` is not reserved from page tool names; such a tool is recorded without a `gap` and `save` wedges.
- N7 (low): an edit refusal found on the final candidate names the last index, not the edit that caused it (`src/core/helpers.ts:2540-2557`).
- N8 (low): `Page.navigatedWithinDocument` carries `frameId`, which the child-frame filter never reads, so a child frame's hash change splits a main-frame edit (`src/core/recorders/BrowserCodegen.ts:168`, `:402-403`).
- N9 (low): a refused `save` leaves a stopped recorder behind while `recording` stays set, so later actions are dropped (`src/core/BrowserJourneyToolset.ts:204`, `:224-227`).
- N10 (low): a listing cap of 0 is accepted and every page reports no journeys (`src/server/stores/FileBrowserStore.ts:25`, `:265`).

Mutations no named assertion catches: deleting `this.#admit('', undefined)` at `src/core/BrowserToolset.ts:371`; `JSON.stringify(text)` in the secret branch of `chosen` at `:714` (no test contains `Selected a secret`); deleting the held-start gap at `src/core/recorders/BrowserRecorder.ts:58-59`; `continue` to `break` at `src/server/stores/FileBrowserStore.ts:194`.

Design fit: 1 compound method names in `FileBrowserStore`; 2 a positional `limit` on `BrowserJourneyToolset`; 3 hold state kept in three places (`#reservation`, `#waiting`, the journey toolset's `#held`, the recorder's `#held`); 4 replay recovers the action through a mutable `#action` side channel because `performBrowserStep` discards the action when it throws; 5 `#admit('', undefined)` uses an empty name as a sentinel; 6 duplicated sets (the non-step tool list, the run-id pattern, the secret-name `taken` derivation); 7 `BROWSER_JOURNEY_PATH` on argument errors; 8 the invented `'s1'` in `locateBrowserTarget`; 9 the listing's fault line has no § 7 template and repeats absolute paths; 10 the step grammar lists native arguments by hand instead of deriving them from `BROWSER_TOOL_COPY`, the cause of N1.
