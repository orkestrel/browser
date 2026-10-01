# J11b claims: the store proof's journey task

Claim 16 holds in two of three evidence runs for the journey task and fails for the page tasks: with the journey tools advertised, the form task fails every attempt of every run, and the read task fails every attempt of run 2. The cause is measured: the journey tools and `type`'s `secret` add 784 prompt tokens to every turn, and the daemon loads `qwen3.5:2b-q4_K_M` with a 4 096-token window, so after the model's habitual opening `look` the third turn's prompt is cut and the task statement is gone. The same form task at a 16 384-token window passes on its first attempt. All three runs exit 1.

Evidence lives under `tmp/probes/logs/v11/`: `run-1/`, `run-2/`, and `run-3/` (the three runs on the final code, each with `run-N.out`, `run-N.start`, and `run-N.end`), `run-0/` (an earlier full run whose journey edit turn named the ids as placeholders), and `window/` (the window control). The development transcripts that drove each nudge are under `tmp/probes/logs/dev/j11b/dev1/` to `dev6/`. Each transcript carries its messages with thinking, its calls, the per-turn token usage (`turns`), the tool-list cost (`cost`), the malformed-call count (`violations`), and the JSON files the journey stores wrote (`files`). The provider runs with `think` off, as every store run does, so no turn surfaced thinking and the `thinking` fields are absent.

## Changes

The following list names each change by `path:line` in the checkout `/home/user/ollama`.

- `tests/setupStore.ts:147` `STORE_JOURNEY_PROMPT`: `STORE_SYSTEM_PROMPT` followed by one sentence per journey tool, five sentences; the `edit` sentence carries a worked batch.
- `tests/setupStore.ts:396`, `:399`, `:406` `STORE_NAME_FIELD`, `STORE_ORDER_BUTTON`, and `renderCheckout` reading them; the served markup is byte-identical.
- `tests/setupStore.ts:700` `STORE_JOURNEY_BOUNDS`: `run` 2 400 000 (five user turns at `STORE_BOUNDS.run`), `budget` 7 200 000, `retry` 7 260 000, `predict` 256, `context` 16 384 (`num_ctx`), `turn` 300 000 (the provider's per-turn deadline).
- `tests/setupStore.ts:734` `StoreTranscript` gains `turns` (`:756`), `cost` (`:769`), `violations` (`:771`), and `files` (`:773`); `tests/setupStore.ts:781` `StoreCost` (`bare`, `page`, `full`).
- `tests/setupStore.ts:801` `StoreRunOptions` gains `root`, `system`, `meter`, and `followups`; `tests/setupStore.ts:829` and `:832` `StoreTurnFunction` and `StoreTurn`.
- `tests/setupStore.ts:900` `runStoreTask`: the toolset is constructed with `journeys: { store: createFileBrowserJourneyStore({ root }), runs: createFileBrowserRunStore({ root }) }` (`:904`), runs the task's system prompt, sends each follow-up turn after the model ends the previous one (`:943`), measures the tool lists after the run (`:973`), and records the JSON files under the root (`:1010`).
- `tests/setupStore.ts:1139`–`:1145` `STORE_JOURNEY_NAME` (`place-order`), `STORE_JOURNEY_PARAMETER` (`buyer`), `STORE_JOURNEY_BUYER` (`Grace Hopper`); `tests/setupStore.ts:1148` `StoreTask` gains `system` and `followups`; `tests/setupStore.ts:1164` `STORE_TASKS.journey`: five user turns.
- `tests/setupStore.ts:1211` `journeyPath` and `tests/setupStore.ts:1229` `attemptStoreTask`: each attempt allocates a scratch root with `createScratch` under `tmp/browsers`, passes the meter, and destroys the root after the page and the store.
- `tests/setupStore.ts:1479`–`:1795` the journey readers: `inferPageTools`, `measureToolCost`, `findMalformedCalls`, `collectStoreFiles`, `parseStoreJSON`, `StoreJourneyEvidence`, `extractJourneyEvidence`, `findBoundParameter`, `matchesNameBinding`, `filterSubmissionLines`, `renderJourneyEdit`, `matchesJourneyBatch`, `STORE_JOURNEY_SEQUENCE`, `matchesJourneySequence`, `matchesRemovedSubmission`, and `matchesJourneyOracle`.
- `tests/service/browser.test.ts:29` the header states the journey tools, the measurements, the five turns, and the window; `:109` `attempt` takes the provider and the meter; `:120` `createJourneyOllama`; `:140` and `:151` the browser lifecycle hoisted to the file so both describes share it; `:277` the journey task's `describe`.
- `tmp/units/j11b-setupStore.test.patch`: the patch for the shared `tests/setupStore.test.ts`, 25 cases over the journey readers (see Shared-file patch).

Diffstat (`git diff --stat -- tests/setupStore.ts tests/service/browser.test.ts`): `tests/service/browser.test.ts | 126 +++++++--`, `tests/setupStore.ts | 636 +++++++++++++++++++++++++++++++++++++++---`, 2 files changed, 694 insertions, 68 deletions.

The journey root is both file stores under one scratch directory per attempt, `tmp/browsers/<task>-<attempt>-XXXXXX`, removed after the attempt; the transcript keeps `journey.json` and `runs/<id>/run.json`.

## Claims

1. **The tool-list cost is 1 637 prompt tokens per turn, of which the journey tools and `type`'s `secret` are 784.** Every one of the 71 measured transcripts reads `full - bare` = 1 637, `page - bare` = 853, and `full - page` = 784, and `full` equals the run's own first-turn prompt count in every transcript, so the measurement reproduces the agent's request. The daemon counts the whole prompt whether or not it reused a cached prefix (two identical requests read 290 and 290), so the differences are the tool lists alone. First-turn prompts with every tool: read 2 888–2 894, click 2 896, search 2 897–2 907, form 2 902–2 912, paging 2 719, journey 3 070.
2. **The default window cuts a page task's prompt at its third turn.** The daemon's runner runs with `-c 4096`; a synthetic 4 098-token prompt reads `prompt_eval_count` 2 050 at the default window and 4 098 at `num_ctx` 8 192. In the runs, the second turn after an opening `look` reads 4 014–4 055 tokens and the third reads 3 030–3 765 (form 4 032 → 3 041, read 4 014 → 3 760, click 4 028 → 3 030), and the dropped message is the first user turn: the form task types `John Smith` in all 9 final-run attempts. Without the 784 journey tokens the second turn reads about 3 250 tokens.
3. **The window, not the toolset, fails the form task.** The window control (`window/`, the unchanged form task with every tool advertised): default window 3 of 3 attempts order `John Smith` with prompts falling from 4 032 to 3 041; `num_ctx` 16 384 orders `Ada Lovelace` on attempt 1 with prompts rising from 4 032 to 4 162. The read task held on attempt 1 at both windows in the control.
4. **The five page tasks with the journey tools advertised.** Attempts each task spent, by run (✗ is three failed attempts):

   | Task | run 1 | run 2 | run 3 | run 0 |
   | --- | --- | --- | --- | --- |
   | read | 1 | ✗ | 3 | 1 |
   | click | 1 | 3 | 3 | 3 |
   | search | 1 | 1 | 2 | 1 |
   | form | ✗ | ✗ | ✗ | ✗ |
   | paging | 1 | 3 | 2 | 1 |

   Page-task attempts called a journey tool in 4 of 33 final-run attempts (`run-1/form-3`, `run-2/paging-2`, `run-3/paging-1`, `run-3/read-2`); `run-3/paging-1` saved a journey `policy-reference` with 0 steps, and the window control's form attempt saved `checkout-with-adalovelace` with 0 steps.
5. **The journey task completes on the first attempt in runs 1 and 2.** `run-1/journey-1` and `run-2/journey-1`: `record`, the checkout (two submissions: `type` with `submit` then `press Enter`), `save` (3 and 4 steps), `journeys`, one `edit` batch answered `Edited place-order.`, and `replay` with `inputs: { buyer: "Grace Hopper" }` answered `Replayed place-order: 2 of 2 steps.` and `3 of 3 steps.`; `journey.json` holds revision 2 with `parameters: { buyer: { default: "Ada Lovelace" } }`, the name step's `text` bound to `{ parameter: "buyer" }`, and the removed `s3`/`s4` gone below `next`; `runs/<id>/run.json` reads outcome `complete`, revision 2, inputs `{ buyer: "Grace Hopper" }`; the store holds exactly one `Grace Hopper` order. 240 s and 394 s; 40 calls each, 30 and 29 of them refused `record`/`save` loops.
6. **The journey task fails all three attempts in run 3.** `journey-1` met every file oracle and then pressed Enter after the replay, whose final view shows the form before the delayed code, so the store holds two `Grace Hopper` orders; `journey-2` went to the cart, typed into a reference no view listed, and never saved; `journey-3` recorded one submission and a `wait`, so the edit turn named the steps in words and the model's own batch was refused twice.
7. **Malformed calls.** `findMalformedCalls` (an unadvertised tool, a schema breach read through `@orkestrel/contract`, or a key `validateBrowserToolArguments` refuses) counts, by run: run 1 0, run 2 0, run 3 1 (`journey-3`: `edits` sent as a string after unquoted ids broke its JSON), run 0 0. Daemon 500s for the model's malformed tool-call XML (`element <function> closed by </parameter>`): run 1 0, run 2 2 (`click-1`, `form-3`), run 3 0, run 0 1 (`form-3`). In development runs with the model composing the batch itself, 16 calls were malformed, every one an `edit` (`dev2` 8, `dev3` 6, `dev5` 1, `dev6` 1).

## Places the model needed a nudge

The following list is the finding set for J12's Journeys concept and the design's § 14; each nudge names the evidence that forced it.

1. **A sentence per tool in the system prompt** (`STORE_JOURNEY_PROMPT`). The `edit` sentence carries a worked batch, because the tool's flat item schema (eight optional properties) did not convey per-operation shapes: the model put a declare's default under `arguments`, dropped its `name`, and added `before`/`after` anchors (`dev1`–`dev4`).
2. **Key order in the worked batch.** With `arguments` last, the model closed the update item with three braces and dropped one, so Ollama passed the unparsable array through as a string and the tool refused `The edits parameter must be an array.` six times in a row (`dev2/journey-1`); with `arguments` before `id`, every batch the model sent from that example parsed.
3. **A 16 384-token window and a 300 s turn deadline for the journey model.** The journey conversation reaches 7 000–14 600 tokens (`dev3/journey-1` read 14 578), and two attempts aborted at the default 120 s provider deadline on a contended host (`dev1/journey-2`, `-3`).
4. **Five user turns instead of one.** With the whole sequence in one turn, the model merged or skipped phases: it saved before acting (0 steps), recorded after acting, and composed no valid batch in 9 attempts (`dev1`–`dev3`). The turns are: record the journey while completing the form task in its own words, save, list, edit, replay.
5. **The edit turn spells out the batch with the step ids the last listing shows** (`renderJourneyEdit`). The model copied the example's ids (`s5`, `dev2`, `dev3`) and placeholders verbatim (`"id": "NAME"`, `"id": "SECOND"`, `run-0/journey-2`, `-3`), so it does not pick the name step or the second submission from the listing by itself.
6. **The form task's own words in the recording turn.** "and report the confirmation code" is what makes the model hunt for the code and submit a second time; the second checkout submission the claim presumes appears in 9 of 14 non-empty recordings.

Further findings for the guide and the design, each read from the transcripts:

- After `save` the model loops refused `record` and `save` until the turn limit in every final-run attempt: `A journey named "place-order" is saved; call journeys, or record another name.` names no call the model takes.
- `save` accepts a recording with no step (`Saved place-order with 0 steps.`, `dev3/journey-1`, `dev4/journey-2`, `run-3/paging-1`, the window control), and a saved journey blocks re-recording its name; the vocabulary has no tool that removes a journey.
- The edit refusal `Edit 1 is refused: it has a malformed edit or duplicate anchors; call journeys.` names no field, and the model repeated the identical call up to eight times (`dev2/journey-2`).
- A `wait` that timed out while recording becomes a gap step: `run-0/journey-2` saved `s3 unresolved: timeout wait`, which preparation refuses at replay.
- The replay render's final view, taken as the handled submission returns, does not show the delayed confirmation, and the model submitted again after a complete replay (`run-3/journey-1`), the double order of v6–v10 reached through `replay`.
- The model's first click was the `Cart` link rather than `Checkout` in 8 of the 20 journey attempts that clicked, and it then acted on references the next view did not list.

## Validation

The following table lists each command run from `/home/user/ollama`, its exit code, and its counts.

| Command | Exit | Counts |
| --- | --- | --- |
| `npx oxfmt --config .oxfmtrc.json --check tests/setupStore.ts tests/service/browser.test.ts` | 0 | 2 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/setupStore.ts tests/service/browser.test.ts` | 0 | no diagnostic (a planted `any` and `debugger` read 2 errors, exit 1) |
| `npm run check` | 0 | `tsc` over `tsconfig.json` and `configs/src/tsconfig.core.json` |
| `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project setup tests/setupStore.test.ts` | 0 | 59 passed |
| `npm run test:service -- tests/service/browser.test.ts`, run 1 (2026-10-01 05:58–06:17 UTC) | 1 | 5 passed, 1 failed (form), 1 156 s |
| `npm run test:service -- tests/service/browser.test.ts`, run 2 (06:18–07:02 UTC) | 1 | 4 passed, 2 failed (read, form), 2 648 s |
| `npm run test:service -- tests/service/browser.test.ts`, run 3 (07:02–07:55 UTC) | 1 | 4 passed, 2 failed (form, journey), 3 145 s |
| `npm run test:policy` | 1 | 111 passed, 1 failed, 1 skipped; the failure is `surface name belongs to one package: sumUsage (agent)` at `tests/setupStore.ts:1458` |
| `npm run test:policy` on a copy of the tracked tree with the HEAD versions of both touched files | 1 | 111 passed, 1 failed, 1 skipped, the same `sumUsage` finding |
| the patched `tests/setupStore.test.ts` run as a probe twin in the `probe` project | 0 | 84 passed (59 existing, 25 added); `git apply --check` exit 0; format and lint clean |

## Shared-file patch

`tmp/units/j11b-setupStore.test.patch` applies to `tests/setupStore.test.ts` (`git apply --check` exit 0). It adds the imports and 25 cases: `inferPageTools`, `findMalformedCalls` (8 malformed shapes and a clean control), `collectStoreFiles`, `parseStoreJSON`, `extractJourneyEvidence` over files the real file stores wrote, `findBoundParameter` and `matchesNameBinding`, `filterSubmissionLines`, `renderJourneyEdit` (the spelled batch parses and holds `matchesJourneyBatch`; the worded fallback), `matchesJourneyBatch`, `matchesJourneySequence`, `matchesRemovedSubmission`, `matchesJourneyOracle` (one pass and six failing controls), `STORE_JOURNEY_PROMPT` (at most one sentence per tool, each naming its tool once), `STORE_JOURNEY_BOUNDS` (five turns fit `run`, three attempts fit `budget`), and `attemptStoreTask` leaving no root under `tmp/browsers` when the page cannot open.

## Deviations

1. **The five page tasks do not each complete within `STORE_BOUNDS.attempts`.** Expected: each passes with the journey tools present. Found: form fails in runs 1, 2, 3, and 0; read fails in run 2. Evidence: claims 2 and 3. Done: the runs, the measurement, and the window control. Not done: the page tasks run unchanged at the default window, as the brief prescribes. Hypothesis: the store proof's model takes a window that holds a page task's eight turns, such as `num_ctx` 8 192, or the vocabulary's advertised copy shrinks; that ruling is the Orchestrator's.
2. **The journey task fails run 3.** Expected: the journey completes within `STORE_BOUNDS.attempts` in every run. Found: runs 1 and 2 pass on attempt 1; run 3 spends three attempts (claim 6).
3. **The journey task's prompt and turns.** The store prompt stays unchanged for the five page tasks, because `tests/setupStore.test.ts` bounds it under 120 words and the browser guide quotes it; the journey task runs `STORE_JOURNEY_PROMPT`, five user turns, and an edit turn that spells out the batch (nudges 1–6).
4. **The journey model's settings.** The journey task's provider and meter take `num_ctx` 16 384 and a 300 s turn deadline through `createOllama` in the test file, because `createLiveOllama` in the unowned `tests/setupService.ts` takes neither.
5. **`tests/setupStore.test.ts` is shared.** Its additions are the patch, not an edit; the existing 59 cases pass against the changed module unpatched.
6. **The policy gate is red before this unit.** `sumUsage` in `tests/setupStore.ts` collides with the `sumUsage` the installed `@orkestrel/agent` 0.0.25 exports; the HEAD copy fails identically. The agent's export is a pairwise reducer, so closing it means folding with `turns.reduce` over the agent's `sumUsage`, deleting this export, and dropping its two cases from `tests/setupStore.test.ts`; that touches the shared file, so it is left for a ruling.
7. **An extra full run.** `run-0/` is a full run on the code before the edit turn computed its ids; it is evidence for nudge 5 and is not one of the three runs.
