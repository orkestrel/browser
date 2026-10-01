# J12 claims: the guide and the README

`npm run test:guides` moves from 12 failed and 195 passed (207) to 2 failed and 246 passed (248). The 2 remaining failures are one source defect: `BrowserCodegen.attach` is a public method that `BrowserCodegenInterface` does not declare (D1). With `tmp/units/journeys/j12-attach.patch` applied, the same command reports 248 passed in a scratch copy of this tree. Every other acceptance item of the J12 row is met. `npm run test:policy`, `npm run check`, and `npx oxfmt --check` over the 3 touched files exit 0.

## Changes

The worktree diff touches only the owned files: `README.md` +10 −4, `guides/browser.md` +1155 −433, and `tests/guides.test.ts` +122 −0. Most of the guide's removed lines are table rows that `npm run test:guides -- --to guide` rewrote and `oxfmt` padded again. The following table lists the changes by section and line in the final `guides/browser.md`.

| Location | Change |
| --- | --- |
| `guides/browser.md:8`–`15` | The intro names the three library faces and the `browse` binary, with the journeys in the core bullet and the file stores and `BrowserMCPServer` in the server bullet. |
| `:92`–`:138` | Core factories: 4 rows and a fence that records through the toolset and replays the journey. |
| `:139`–`:181` | Core classes: `BrowserHold`, `BrowserRecorder`, `BrowserReplay`, `BrowserJourneyToolset`, and the two memory stores. |
| `:182`–`:240` | Core constants: the 9 `BROWSER_JOURNEY_*` constants. |
| `:241`–`:345` | Errors: 19 code rows (`BROWSER_TOOLSET_BUSY`, 17 `BROWSER_JOURNEY_*` codes, and `BROWSER_SERVER_ENVIRONMENT`) and the `BROWSER_JOURNEY_DIALOG` note. |
| `:346`–`:877` | Helpers: 24 journey rows, the retired `compileCodegenScript`, `normalizeCodegenActions`, and `parseCodegenNavigateAction` removed, and a fence over every journey helper whose comments are probe outputs. |
| `:878`–`:1145` | Core types: 35 journey, codegen, and popup rows; the 4 retired codegen types removed. |
| `:1146`–`:1375` | Server factories, classes, constants, and types: 3, 4, 7, and 4 rows. |
| `:1509`–`:1525` | Methods intro: the journey classes, the stores, the server, and the popup objects paired with their interfaces. |
| `:1875` | `BrowserToolsetInterface`: the popup settlement, `perform`, `hold`, and `journeys` prose, two rows, and fence lines. |
| `:1977`–`:2133` | `BrowserCodegenInterface` rewritten; `BrowserRecorderInterface`, `BrowserReplayInterface`, `BrowserHoldInterface`, `BrowserJourneyStoreInterface`, `BrowserRunStoreInterface`, and `BrowserJourneyToolsetInterface` added. |
| `:2204` | `BrowserMCPServerInterface` added. |
| `:2334`, `:2342` | `BrowserPopupManagerInterface` and `BrowserPopupRecordInterface` added. |
| `:2807` | Tools: `type`'s `secret`, the 5 journey tool rows, and the `journeys` advertisement. |
| `:2832` | Receipts: 17 rows for the secret receipt, the busy refusal, and every journey tool result and refusal. |
| `:2891`–`:2975` | The `## Journeys` concept. |
| `:3023`–`:3048` | The Contract preamble and invariants 1, 2, 4, 6, 7, 9, 10, 15, 18, 19, and 21 rewritten in place. |
| `:3078`–`:3218` | Patterns: record and save, replay with inputs, edit, and generate a module, which replaces "Record and replay interactions with codegen". |
| `:3381` | Pattern: register the `browse` binary with Claude Code. |
| `:3460`–end | Tests: the `src:bin` project, 12 entries added, and 13 entries rewritten, with the broken `tests/src/core/BrowserCodegen.test.ts` link replaced. |
| `README.md:8`, `:71`–`:77`, `:83`–`:87` | The journeys in the feature paragraph, a `## Browse binary` paragraph, and the package bullets with the `bin` field. |
| `tests/guides.test.ts:69`–`:81`, `:230`–`:343` | 6 constants and the `Journeys` describe block, which holds 5 tests. |

## Claims

1. **The gate.** `npm run test:guides` exits 1 with 2 failed and 246 passed (248). Both failures name `BrowserCodegen.attach` (D1). With `j12-attach.patch` applied, the command exits 0 with 248 passed. That run, on 2026-10-01, used a scratch copy of this tree that links its `node_modules` and `dist`.
2. **Surface rows equal the export lists.** `documents every barrel export` and `documents only barrel exports` pass. The 96 undocumented exports and the 7 retired rows of the baseline are closed. Every Summary cell equals its TSDoc paragraph (`keeps every compared summary and example equal to its source` passes). The cells were set through `npm run test:guides -- --to guide`.
3. **Methods tables.** Each interface of §§ 2–4, § 7, and § 8 that declares a call signature has a table: the recorders, the replay, the hold, the two stores, the journey toolset, the MCP server, `perform` and `hold` on the toolset, and J4c's two popup interfaces. `documents every interface method`, `documents no phantom method`, and `documents an example for every method` pass for each table. The exception is `BrowserCodegen exposes no undocumented method`, which fails on `attach` (D1).
4. **The Journeys concept.** `## Journeys` (`:2891`) follows `## Toolset vocabulary`. It states what a journey is with the 7 invariants, the three sources, parameters and secrets, the listing, replay as-is and with inputs, the run and its render, the two artifacts, the layout under a root with the existing-root requirement, and the placements with the `browse` binary. The review-path sentence is at `:2910`: a model's recording keeps every completed action, as the store proof's double order showed, and `remove` through `edit` is the review path.
5. **The Tools table equals `BROWSER_TOOL_COPY`.** Each row's name, parameters with their required marks, annotations, and description equals the copy, `type`'s `secret` and the 5 journey tools included. The pinning test is `lists every tool BROWSER_TOOL_COPY advertises, with its parameters, annotations, and description`.
6. **Receipts.** The rows quote § 7's results and refusals verbatim, and add the refusals `BrowserJourneyToolset.ts` emits beyond § 7: `Editing … failed`, the `journeys` limit, and the 3 malformed-argument refusals. They also quote the secret receipt, the busy refusal, the run head lines, the 2 resolution sentences, and the popup note row, which already existed. `quotes the journey refusals the constants hold` checks the 4 constant strings. `tests/src/core/BrowserJourneyToolset.test.ts` asserts the rest verbatim.
7. **Errors.** The code table holds a row for every `BROWSER_JOURNEY_*` code the source throws, `BROWSER_TOOLSET_BUSY`, and `BROWSER_SERVER_ENVIRONMENT`. Each row names its thrower, read from the throw sites. `BROWSER_JOURNEY_DIALOG` is documented as a run refusal that never rejects `execute`.
8. **Tests entries.** The Tests section has entries for `tests/service/codegen.test.ts`, `tests/service/journey.test.ts` with its 3 blocks, `tests/src/bin/main.test.ts`, the hold, journey toolset, replay, recorder, codegen, memory store, and validator files, `tests/src/server/BrowserMCPServer.test.ts`, and the 3 file store files. It also covers the `journey perform equality` block, the distribution cases, and the setup modules. `links only to test files that exist` passes.
9. **Patterns.** "Record a journey from the toolset and save it" quotes the `browse` binary's answers from this unit's run. "Replay a journey with inputs" and "Edit a saved journey" carry comments from probes of `editBrowserJourney` and `renderBrowserJourney` on the built core. "Generate a module from a journey" carries the `add-kettle` module, which `carries the module compileBrowserJourney emits for add-kettle, laid out by the formatter` compares with the compiler's output. "Register the browse binary with Claude Code" gives the `.mcp.json` entry, the 4 environment variables, the exit-1 line, `--no-sandbox` on Linux as root, the 4 registration steps with Claude Code 2.1.286 output, the approval and its honest limit, the `subscriptions/listen` limit, and one recorded exchange.
10. **Invariants rewritten in place.** Invariant 1 adds the fourth face and its check project (`tests/src/bin/main.test.ts`). Invariant 2 adds the server's `@orkestrel/mcp` and `@orkestrel/tool` and the bin's import set (`tests/config.test.ts`, the 4 check projects). Invariant 4 states that captures go through the run store's `capture` (`BrowserReplay.test.ts`, `FileBrowserRunStore.test.ts`, D5). Invariant 6 adds `action`, `hold`, `release`, the recorder and replay events, and the lock refused at once (`recorders/*.test.ts`, `BrowserToolset.test.ts`, `FileBrowserJourneyStore.test.ts`). Invariant 7 adds the journey, busy, and environment codes (`validators`, `BrowserReplay`, `BrowserJourneyToolset`, the store suites, and `main.test.ts`). Invariant 9 restates codegen (`recorders/BrowserCodegen.test.ts`, `service/codegen.test.ts`, `compilers.test.ts`, and the `compiled module equality` block, which replaces `#save`). Invariant 10 names the paired classes (`guides.test.ts`). Invariant 15 makes a journey's `reference` evidence (the `journey semantic replay` block). Invariant 18 amends the hold (the `claim 6` block). Invariant 19 covers the replay's `dialog` and the foreign `dialog` (`BrowserReplay.test.ts`, the `claim 6` block). Invariant 21 covers the journey names and the server's own manager (`BrowserJourneyToolset.test.ts`, `BrowserMCPServer.test.ts`). `resolves every relative link` passes over each named file.
11. **README.** The feature paragraph names journeys, the five tools, and `compileBrowserJourney`. `## Browse binary` gives the one-paragraph hookup with the command, the approval, and the 4 variables, and links the guide's pattern. The package bullets add the journey and server exports and the `bin` field. Every statement repeats one in the guide, and `opens the README with the guide tagline` passes.

No `prove` tool is registered in this session, so no claim has a `prove` closing line. The tests, the mutations, and the probes are the evidence.

## Failing-first and mutation evidence for the added tests

The added tests are parity rules, not a defect fix. Each one was run against a guide with one mutation applied, and then the guide was restored (`cmp` equal). The runner was `scratchpad/mutate.ts`, which ran `npm run test:guides` once per mutation.

| Mutation of `guides/browser.md` | Failing test | Result |
| --- | --- | --- |
| `secret` removed from the `type` row | `lists every tool BROWSER_TOOL_COPY advertises, …` | 3 failed, 245 passed |
| `s3` of the listing reads "Add to basket" | `shows the listing renderBrowserJourney returns for add-kettle` | 3 failed, 245 passed |
| `s5` removed from the run render | `shows the render renderBrowserRun returns for a complete add-kettle run` | 3 failed, 245 passed |
| `s3`'s call removed from the module fence | `carries the module compileBrowserJourney emits for add-kettle, …` | 3 failed, 245 passed |

The module test carries its own control: the compiled module without `s3` normalizes to a different string.

## Recorded runs

- The `browse` exchange ran on 2026-10-01 against Chromium 141.0.7390.37 as root on Linux. `node node_modules/@orkestrel/browser/dist/bin/main.js` ran from a scratch consumer whose `node_modules/@orkestrel/browser` links this worktree, with a 2-page loopback shop. The sequence was `initialize`, `tools/list` (15 names), `navigate`, `record`, `click`, `look`, `click`, `wait`, `save` (`Saved add-kettle with 3 steps.`), `journeys`, `navigate`, and `replay` (`Replayed add-kettle: 3 of 3 steps.`). The client then closed and the binary exited 0. The run wrote `tmp/browsers/add-kettle/runs/2026-10-01T03-07-06.041Z-6d7e/` with `run.json` and `s1.png` to `s3.png`.
- The Claude Code commands ran with `CLAUDE_CONFIG_DIR` set to a scratch directory, so the user's configuration was untouched. `claude mcp add --scope project browse -- node node_modules/@orkestrel/browser/dist/bin/main.js` wrote the `.mcp.json` entry the guide quotes. `claude mcp list` and `claude mcp get browse` reported `⏸ Pending approval (run `claude` to approve)`.

## Validation

Every command ran from the worktree root through `env -C`, and each output was read bare.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --config .oxfmtrc.json --check guides/browser.md README.md tests/guides.test.ts` | 0 | 3 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings tests/guides.test.ts` | 0 | no diagnostic |
| `npm run test:guides` (baseline, `tmp/codex/j12-guides-baseline.log`) | 1 | 12 failed, 195 passed (207) |
| `npm run test:guides` | 1 | 2 failed, 246 passed (248); both failures are D1 |
| `npm run test:guides` with the 3 patch files applied, in the scratch copy | 0 | 248 passed (248) |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (115) |
| `npm run check` | 0 | root, `check:src:core`, `check:src:server`, `check:src:browser`, and `check:src:bin` pass |

The sweep for the substitution table matched `\b(should|simply|easy|just|currently|now|new|latest|utilize|leverage|via|in order to|e\.g\.|i\.e\.|etc\.|performant|robust|allows you to|and/or|since|once|above|below|please|sanity check|dummy|blacklist|whitelist|master|slave|we|our|let's|ensure|guarantee)\b`, case-insensitively, over the added lines of `guides/browser.md` and `README.md`. It found 17 hits (`new` 7, `once` 6, `since` 2, `below` 1, `via` 1), and each one is outside the banned sense:

- `at once` (immediately) and `once` in `BrowserHold`'s source summary (one time).
- `below \`next\`` (a comparison).
- `new`, `since`, and `via` inside code spans, quoted receipts, a source summary, or CLI output.

## Deviations and source patches

- **D1, `BrowserCodegen.attach` (blocks the gate; not fixed here).**
  - Expected: `BrowserCodegen` exposes exactly `BrowserCodegenInterface`'s methods, which is invariant 10 and the documentation rule.
  - Found: `attach(session)` at `src/core/recorders/BrowserCodegen.ts:108` is public and undeclared. `BrowserPage.ts:1291` calls it before a frame resumes. J6 recorded it.
  - Evidence: `BrowserCodegen exposes no undocumented method` and `keeps behavioral interfaces and implementing classes in parity` fail on it.
  - Patch: `tmp/units/journeys/j12-attach.patch`. It declares `attach` on `BrowserCodegenInterface`, following `BrowserEmulationManagerInterface.attach` (`src/core/types.ts:1581`), and adds the guide row and sentence. `git apply --check` passes, `check:src:core` passes in the scratch copy, and `test:guides` reports 248 passed. Apply its two halves together, because the guide row alone fails `documents no phantom method`. The types half is:

    ```diff
    --- a/src/core/types.ts
    +++ b/src/core/types.ts
    @@ -2182,6 +2182,8 @@
     
     /** Records semantic page gestures and compiles the resulting journey. */
     export interface BrowserCodegenInterface extends BrowserRecorderInterface {
    +	/** Installs recording on an attached frame before its owner resumes it. */
    +	attach(session: string): Promise<void>
     	/** Compiles the recorded journey into a standalone module and lists its gaps. */
     	script(options: {
    ```

  - Hypothesis: the concrete hook was added for J0's pre-resume ordering without a contract row.
- **D2, `BROWSER_JOURNEY_FILE` names a constant and an error code (does not block).** `src/server/constants.ts:214` exports `BROWSER_JOURNEY_FILE = 'journey.json'`, and the stores throw the code `'BROWSER_JOURNEY_FILE'`. A backticked `BROWSER_JOURNEY_FILE` in prose or TSDoc (`src/core/types.ts:2060`) therefore names both, which breaks one concept, one term.
  - Patch: `tmp/units/journeys/j12-store-findings.patch` renames the constant to `BROWSER_JOURNEY_SNAPSHOT_FILE`, after its summary "Names the persisted journey snapshot", in `constants.ts`, `FileBrowserJourneyStore.ts`, and the guide row.
  - Evidence: the patch passes `check:src:server`, the 3 store test files (38 passed, 1 skipped), and `test:guides` in the scratch copy.
- **D3, a missing root is reported as a malformed file (does not block).** The `FileBrowserStore` constructor maps `realpathSync`'s `ENOENT` to `BROWSER_JOURNEY_FILE`. `directory()` reports the same condition later as `BROWSER_JOURNEY_PATH` `Missing root`.
  - The guide documents the present behavior: the FILE row and `:2960`.
  - The same patch file maps `ENOENT` at construction to `BROWSER_JOURNEY_PATH` `Missing root: ROOT` and updates the 2 guide rows and the sentence. It also adds `refuses a missing root with BROWSER_JOURNEY_PATH naming the root` to `tests/src/server/stores/FileBrowserStore.test.ts`.
  - Failing first in the scratch copy: before the fix, `npx vitest run --config vite.config.ts --project src:server tests/src/server/stores/FileBrowserStore.test.ts -t 'missing root'` reports 1 failed, 5 skipped. After the fix, the whole file reports 6 passed.
- **D4, `guides/README.md` (not owned).** `tmp/units/journeys/j12-guides-index.patch` adds `src/bin` and `tests/src/bin` to the concept row and `src/bin` to the directory index, because the guide documents that face. `test:guides` and `test:policy` pass with it.
- **D5, invariant 4.** § 11 rules invariant 4 as "kept: … through the writer". J5b moved captures to `BrowserRunStoreInterface.capture`, which takes bytes without a path, so the invariant states the code as it ships and names J5b's tests.
- **D6, the Claude Code approval.** The approval prompt is interactive and was not driven, and the guide says so. Steps 2 and 3 ran against Claude Code 2.1.286, and the exchange drove the same command over stdio. The recorded exchange is this unit's own run of the built binary. The guide also names J10's `packed browse binary` distribution case.
- **D7, ancillary choices.**
  - Summary cells were set with `npm run test:guides -- --to guide`, the source-to-guide direction, because the brief makes the TSDoc authoritative.
  - The 3 owned files were formatted by piping `oxfmt --stdin-filepath` output back into them. No tree-wide `format` ran.
  - Guide fences stay `ts`, the one listed fence language. The listing, the render, and the exchange are therefore comments in `ts` fences, and the `.mcp.json` entry is a code span.
- **Scope.** No commit, stash, reset, checkout, or index-wide git command was issued. Every probe, scratch tree, and scratch Claude Code configuration lives in the session scratchpad, outside the worktree. `git status` lists the 3 owned files alone. The 3 patch files and this report sit in the ignored `tmp/units/journeys/`.
