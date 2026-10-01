# K4 claims: the third consumer run on the K3 tree

Three runs of `npm run test:service -- tests/service/browser.test.ts` in `/home/user/ollama` against the browser tarball packed from `1e9efad` (sha256 `e674a040…`), with no test change after K2; transcripts under `tmp/probes/logs/v13/run-{1,2,3}/`. Every run exits 1 with 5 passed and 1 failed: the five page tasks pass in every run, the journey task fails in every run.

## Attempts per task

A ✗ means every attempt failed; a number is the attempt that passed.

| Task | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| read | 1 | 1 | 1 |
| click | 1 | 1 | 1 |
| search | 1 | 1 | 1 |
| form | 1 | 1 | 1 |
| paging | 1 | 2 | 1 |
| journey | ✗ | ✗ | ✗ |

## Loops and malformed calls

Refused `record` or `save` calls after a successful `save`, summed over the journey attempts: run 1 53, run 2 20, run 3 34. Malformed calls: run 1 0, run 2 0, run 3 0. The page tasks' refused `record` and `save` calls before any save, which failed the form task in K2's runs 1 and 3, no longer fail a page task.

## The journey task's failure

Each attempt records, acts, and saves (`Saved place-order with 3 steps.` in run 1's first attempt), lists, and then keeps calling `record` (refused with the K3 sentence) and `save` (refused with `Nothing is recording; "place-order" was saved…`) instead of ending its turn, so the turn runs to its call limit; run 1's first attempt also edited the journey correctly (revision 2 with the `buyer` binding and `s3` removed) and never reached `replay`. The first fourteen calls of each run's first attempt: run 1 `record click type press save journeys record! journeys record! save! journeys record! save! journeys`; run 2 `record click click! look click type press save journeys record! journeys record! record! record!`; run 3 `record click type press save journeys record! journeys record! record! record! record! record! record!`. The refusals the model receives name the tools to call and tell it to answer the user; the model follows them for one call and returns to `record`. The remaining defect is the model's turn-ending behaviour under this prompt, which the package's copy cannot change further.

## Verdict on claim 16

The page half holds: with the journey tools and `type`'s `secret` advertised and a 16 384-token window, the five page tasks complete within their attempts in every run. The journey half does not hold on this model in this run (it held in two of three J11b runs and one of three K2 runs): the record, save, list, and edit phases complete, and the replay phase is lost to the turn loop.
