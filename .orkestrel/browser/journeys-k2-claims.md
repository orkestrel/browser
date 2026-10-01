# K2 claims: the store proof's journey task on the final browser tree

Claim 16 holds in none of the three runs. The 16 384-token window closed the cut prompt: the form task types `Ada Lovelace` in 7 of 7 attempts (J11b: `John Smith` in 9 of 9), no turn's prompt falls below the previous turn's in any of the 31 transcripts, and the largest prompt is 14 630 tokens. The five page tasks pass together in run 2 only, and the journey task passes in run 3 only. The form task fails every attempt of runs 1 and 3 on a detour the K1 directives open: after placing the order, the model calls `save` with nothing recording, follows `No journey is recording; call record first.` into `record`, and then repeats `save` against `Nothing is recorded for NAME; perform an action, then call save.` until the 8-call limit, so it never reports the code. After a save, the `loops` count shows the `record` refusal still loops: 18, 14, and 28 refused calls in the three journey attempts that saved. All three runs exit 1.

Evidence lives under `tmp/probes/logs/v12/run-1/`, `run-2/`, and `run-3/`. Each directory holds the run's transcripts (`<task>-<attempt>.json`), the runner output `run-N.out`, the UTC start and end times (`run-N.start`, `run-N.end`), and the exit code (`run-N.exit`). The browser package is the tarball from the final tree, version 0.0.19. `grep -c 'is saved already' node_modules/@orkestrel/browser/dist/src/core/index.js` printed 1.

## Changes

The following list names each change by `path:line` in the checkout `/home/user/ollama`.

- `tests/setupStore.ts:11` imports `sumUsage` from `@orkestrel/agent`, and `:998` folds the usage with `turns.reduce<TokenUsage | undefined>((sum, turn) => sumUsage(sum, turn), undefined)`. The local `sumUsage` export and its two cases are deleted.
- `tests/setupStore.ts:674` `STORE_BOUNDS` gains `context` 16 384 (`:693`, the Ollama `num_ctx`) and `turn` 300 000 (`:695`, the provider's per-turn deadline); its remarks state why every attempt takes both.
- `tests/setupStore.ts:707` `STORE_JOURNEY_BOUNDS` keeps only `run`, `budget`, and `retry`. Its `predict`, `context`, and `turn` are gone because they equal or moved to `STORE_BOUNDS`.
- `tests/setupStore.ts:774` `StoreTranscript.loops`, set at `:1013` from `findJourneyLoops(calls).length`; `buildStoreTranscript` sets it to 0 (`:1349`).
- `tests/setupStore.ts:1770` `findJourneyLoops`: the unsuccessful `record` and `save` calls after the first successful `save`.
- `tests/setupStore.ts:1516` `normalizeSchemaTypes`, read by `findMalformedCalls` (`:1549`). The final tree advertises `edit`'s `edits` as `type: ["array", "string"]`, and `schemaToShape` in `@orkestrel/contract` 0.0.18 compiles a type array to a raw shape that accepts any value: with that shape, `edits: 3` and an item without `operation` both pass. The helper rewrites each multi-type node as an `anyOf` of one node per type, which compiles to a union that checks the array's items.
- `tests/setupStore.ts:1742` `parseJourneyEdits` reads `edits` the way the `edit` tool does, as an array or the JSON string of one. `matchesJourneyBatch` (`:1754`) and `matchesRemovedSubmission` (`:1820`) read the batch through it.
- `tests/setupService.ts:24`–`:27` `LiveProviderOptions` gains `context` and `turn`; `createLiveOllama` passes `num_ctx` (`:43`) and `timeout` (`:46`) only when given.
- `tests/service/browser.test.ts:109` `attempt(task, number)` builds the store model and the one-token meter through `createLiveOllama` with `STORE_BOUNDS.context` and `STORE_BOUNDS.turn`; every task, the journey task included (`:280`), goes through it. `createJourneyOllama` and the `createOllama`, `OLLAMA_CONFIG`, and `ProviderInterface` imports are gone. The header (`:29`–`:54`) states the window, the turn deadline, and `loops`.
- `tests/setupStore.test.ts`: the J11b patch is applied. The cases added after it are `STORE_BOUNDS` window and turn (`:512`), `normalizeSchemaTypes` (`:870`), the string batch in `matchesJourneyBatch` (`:1068`) and `matchesRemovedSubmission` (`:1129`), `STORE_JOURNEY_BOUNDS against STORE_BOUNDS` (`:1230`), `parseJourneyEdits` (`:1243`), and `findJourneyLoops` (`:1259`). In the `findMalformedCalls` cases, the string batch moves to the passing list and `edits: 3` (`:861`) is the wrong-type sample. The `sumUsage` describe and import are deleted, and two of `STORE_JOURNEY_BOUNDS`'s assertions (`context`, `turn`) move to `STORE_BOUNDS`.
- `tests/setupService.test.ts:348` the window reaches the wire as `num_ctx`; `:356` a parked fixture turn rejects at the 30 ms `turn` deadline, within 1 500 ms, while the caller's signal allows 3 000 ms.

`git diff --stat` over the five files reads 1 450 insertions and 96 deletions, against HEAD `5d109df`. That count includes J11b's uncommitted work in `tests/setupStore.ts` and `tests/service/browser.test.ts` and the applied patch: `tests/service/browser.test.ts | 104`, `tests/setupService.test.ts | 24`, `tests/setupService.ts | 13`, `tests/setupStore.test.ts | 689`, `tests/setupStore.ts | 716`.

## Attempts per task

The following table gives the attempts each task spent in each run; ✗ marks three failed attempts. J11b's run 1 to run 3 used the default window and the browser tree before K1.

| Task | run 1 | run 2 | run 3 | J11b run 1 | J11b run 2 | J11b run 3 |
| --- | --- | --- | --- | --- | --- | --- |
| read | 1 | 1 | 1 | 1 | ✗ | 3 |
| click | 1 | 3 | 1 | 1 | 3 | 3 |
| search | 2 | 1 | 2 | 1 | 1 | 2 |
| form | ✗ | 1 | ✗ | ✗ | ✗ | ✗ |
| paging | 1 | 1 | 2 | 1 | 3 | 2 |
| journey | ✗ | ✗ | 1 | 1 | 1 | ✗ |
| exit code | 1 | 1 | 1 | 1 | 1 | 1 |

The run times were as follows: run 1 2026-10-01 08:48:21–09:18:24 UTC (1 802.68 s, 4 passed and 2 failed: form and journey); run 2 09:19:01–09:42:58 UTC (1 435.81 s, 5 passed and 1 failed: journey); run 3 09:43:20–10:00:14 UTC (1 013.06 s, 5 passed and 1 failed: form).

## Malformed calls, daemon 500s, and loops

The following table gives the counts per run, summed over every transcript of that run.

| Count | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| malformed calls (`violations`) | 0 | 7 (`journey-2`) | 0 |
| daemon 500s | 0 | 1 (`journey-1`) | 0 |
| `loops` | 18 (`journey-1`: 17 `record`, 1 `save`) | 14 (`journey-1`: 14 `record`) | 28 (`journey-1`: 28 `record`) |
| refused `record` or `save` before any save, page tasks | 14 (`click-1` 4, `form-1` 3, `form-2` 3, `form-3` 4) | 4 (`click-3` 4) | 12 (`click-1` 3, `form-1` 3, `form-2` 3, `form-3` 3) |

- **Malformed calls.** The seven in run 2 are `run-2/journey-2`'s `edit` calls. The batch nests its `declare` inside `arguments`, so the first item carries no `operation`, and `normalizeSchemaTypes` is what lets the reader see it. Every one of those edits was refused with `No journey is named "place-order"; call journeys.` because that attempt never saved.
- **Daemon 500.** The one in run 2 is `element <function> closed by </parameter>`, in the edit turn of `run-2/journey-1` after its `edit` had succeeded, so that attempt never reached `replay`.
- **Loops.** Every attempt that saved looped on `record` after the save: `Journey "place-order" is saved already and nothing is recording; call journeys to list it, edit to change it, or replay to run it.` The model answered that refusal with another `record` at the start of each later user turn and between calls. `save` after a save was refused once in the three runs. J11b's two saving attempts read 30 and 29 loops, split between `record` and `save`, in 40 calls each. Here the counts are 18 in 32 calls, 14 in 27 calls (cut by the 500), and 28 in 40 calls.
- **Page-task detour.** The last row is outside `loops` by its definition, because no page attempt saved. It is the pre-save loop: `save` refused with `No journey is recording; call record first.`, then `record` (`checkout-with-ada-lovelace`, `add-tea-tray`), then `save` refused with `Nothing is recorded for NAME; perform an action, then call save.`, repeated. Every one of the 7 form attempts ordered `Ada Lovelace`. All 6 failed form attempts (runs 1 and 3) end at the 8-call limit with an empty answer, after this detour.

## Tool-list cost

Every one of the 31 transcripts reads `full - bare` = 1 651, `page - bare` = 853, and `full - page` = 798 prompt tokens, and in each one `full` equals the run's first-turn prompt count. The page vocabulary costs the same as in J11b. The journey tools and `type`'s `secret` cost 14 tokens more than J11b's 784, the K1 copy. First-turn prompts with every tool: read 2 902, click 2 910, search 2 911, form 2 916–2 926, paging 2 731–2 733, journey 3 083–3 084. The largest prompt per run: page tasks 5 319, 5 320, and 6 923; journey 14 630 (`run-1/journey-3`), 10 045, and 7 846. All of them fit the 16 384-token window. No transcript shows a turn whose prompt is smaller than the previous turn's, the signature of the cut J11b measured.

## Claim 16

The design states claim 16 as follows: the store model, with the journey tools and `type`'s `secret` advertised, completes the five page tasks within their attempt budgets. It then records the form task's flow and saves it, lists it, edits it in one batch (a `declare` with a default, an `update` binding the name step's `text`, and a `remove` of the second submission), and replays it with an input. The judges are one recorded order in the store and the files under `tmp/browsers`.

**Verdict: claim 16 fails in all three runs.** The two halves fail in different runs:

- **The five page tasks** complete within `STORE_BOUNDS.attempts` in run 2 only. In runs 1 and 3 the form task places the order in all three attempts and then spends its calls on the `save`/`record` detour, so it never reports the code.
- **The journey task** holds in run 3 only. `run-3/journey-1` (193 s, 40 calls) records `s1 click link "Checkout"`, `s2 type "Ada Lovelace" into textbox "Full name", submit`, and `s3 press Enter`, saves with 3 steps, and lists. It then edits in one batch, `declare buyer {default: "Ada Lovelace"}`, `update s2 text {parameter: "buyer"}`, and `remove s3`, answered `Edited place-order.`, and replays with `inputs: {buyer: "Grace Hopper"}`, answered `Replayed place-order: 2 of 2 steps.`. `place-order/journey.json` holds revision 2 with `parameters: {buyer: {default: "Ada Lovelace"}}` and `s2`'s `text` bound to `{parameter: "buyer"}`. `runs/<id>/run.json` reads outcome `complete`, revision 2, and inputs `{buyer: "Grace Hopper"}`. The store holds one `Grace Hopper` order.
- **Run 1's journey failures.** `run-1/journey-1` met every file oracle: revision 2, `buyer` bound, the second submission `s4 press Enter` removed, and the run `complete` with `Grace Hopper`. After the replay, though, the model pressed Enter on the replayed form, so the store holds two `Grace Hopper` orders. The replay's final view does not show the delayed code; the design's guide sentence on ending a recording with a `wait` targets this. `run-1/journey-2` and `-3` clicked `Cart` first, wandered the catalogue, and never saved.
- **Run 2's journey failures.** `run-2/journey-1` saved, listed, and edited, then ended at the daemon 500. `run-2/journey-2` clicked `Cart` twice, reached the checkout, never typed or saved, and sent the 7 malformed edits. `run-2/journey-3` clicked `Cart`, then looped `look` and `type` on the search page and never saved.

## Validation

The following table lists each command run from `/home/user/ollama`, its exit code, and its counts. The logs of the commands before the live runs are under `tmp/codex/`.

| Command | Exit | Counts |
| --- | --- | --- |
| `npm run test:policy`, before the change | 1 | 111 passed, 1 failed, 1 skipped: `surface name belongs to one package: sumUsage (agent)` at `tests/setupStore.ts:1458` |
| `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project setup tests/setupStore.test.ts tests/setupService.test.ts`, failing first (tests written, implementation absent) | 1 | 102 passed, 11 failed |
| `npm run check` | 0 | `tsc` over `tsconfig.json` and `configs/src/tsconfig.core.json` |
| `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project setup tests/setupStore.test.ts tests/setupService.test.ts` | 0 | 115 passed |
| `npm run test:policy` | 0 | 112 passed, 1 skipped |
| `npx vitest run … --project setup tests/setupService.test.ts` with the `timeout: options.turn` line removed | 1 | 22 passed, 1 failed: the turn-deadline case alone (`expected 3004.79 to be less than 1500`); the line restored after |
| `npx oxfmt --config .oxfmtrc.json --check` over the five files | 0 | all files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the five files | 0 | no diagnostic |
| `npm run test:setup` | 0 | 4 files, 224 passed |
| `npm run test:service -- tests/service/browser.test.ts`, run 1 | 1 | 4 passed, 2 failed (form, journey), 1 802.68 s |
| `npm run test:service -- tests/service/browser.test.ts`, run 2 | 1 | 5 passed, 1 failed (journey), 1 435.81 s |
| `npm run test:service -- tests/service/browser.test.ts`, run 3 | 1 | 5 passed, 1 failed (form), 1 013.06 s |

The failing-first run's 11 failures are the following cases: `createLiveOllama` `num_ctx` and turn deadline; `STORE_BOUNDS` window and turn; `findMalformedCalls` flags (the K1 schema drift: the string batch was flagged, and `[{ id: 's3' }]` passed as raw); `matchesJourneyBatch` string batch; `matchesRemovedSubmission` string batch; `STORE_JOURNEY_BOUNDS against STORE_BOUNDS`; `parseJourneyEdits` (two); and `findJourneyLoops` (two).

## Deviations

1. **Claim 16 fails in all three runs.**
   - Expected: the five page tasks and the journey task each pass within `STORE_BOUNDS.attempts` in every run.
   - Found: the attempts table. Form fails runs 1 and 3 on the pre-save `save`/`record` detour, and journey fails runs 1 and 2 (a double order after the replay, Cart-first detours, and a daemon 500).
   - Done: the three runs and the measurements. Not done: any change to the task texts, the store prompt, or the attempt budgets, which the brief fixes.
   - Hypothesis: `save` with nothing recording and no journey saved names `record` as the next call, which pulls a page task into recording. A refusal that names no journey tool when nothing was recorded in the session would stop the detour. That is a ruling on the browser package's copy, outside this unit.
2. **The `record` refusal after a save still loops.** Expected: the K1 directive `call journeys to list it, edit to change it, or replay to run it` ends the loop. Found: 18, 14, and 28 refused `record` calls after the save, against J11b's 30 and 29 split across `record` and `save`. The `save` loop is gone (1 in three runs), and the `record` loop is not.
3. **`findMalformedCalls` reads the schema through `normalizeSchemaTypes`.** The brief keeps `violations` but names no reader change. The final tree's `type: ["array", "string"]` for `edits` meets `schemaToShape`'s raw shape for a type array, which leaves the count blind to every malformed `edit`; this reader change restores it. A fix in `@orkestrel/contract` that maps a type array to a union would let this helper go.
4. **A JSON-string batch counts as a batch.** Because the K1 `edit` tool accepts `edits` as a JSON string, `matchesJourneyBatch` and `matchesRemovedSubmission` read it through `parseJourneyEdits`. The applied patch's case `fails … a string batch` now holds the string batch, and its `findMalformedCalls` case passes the string batch and flags `edits: 3`.
5. **No `prove` tool.** The `probe` MCP server's `prove` tool is not available in this session. The claims rest on the failing-first run and the revert in the validation table.
6. **Edit mechanism.** Two multi-hunk edits to `tests/setupStore.test.ts` went through inline `python3` heredocs rather than the edit tool. Nothing was written as a script file.
7. **Run directory layout.** `run-N.out`, `.start`, `.end`, and `.exit` sit inside each `run-N/` directory, where J11b kept them beside it.
