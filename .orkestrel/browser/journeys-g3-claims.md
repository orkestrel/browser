# Unit G3: claims

The generated module now checks its inputs before its toolset starts. For a journey with parameters, `execute` first throws `Error('NAME: no parameter has that name')` for an input that names no parameter. It then throws `Error('NAME: the input is missing')` for each required parameter whose input is not a string. When the journey has a required parameter, the checks read `inputs ?? {}` and `inputs?.NAME`, so `execute(page)` reports the first required parameter as missing. Both checks run before the gap throw and before any step. Replay checks in the same order: unknown inputs, then missing ones, then gaps. Claim 5's table gains two rows: the interrupted click followed by `dialog`, and a `switch` over a toolset given its context. Both rows compare replay against direct calls on outcome, stage, reason, and masked receipt.

## Changes

- `src/core/compilers.ts:537` `required` replaces the `fallback` flag; `inputs` takes `= {}` when `required` is empty.
- `src/core/compilers.ts:543` `supplied` is `inputs ?? {}` when a required parameter exists and `inputs` otherwise. `src/core/compilers.ts:544` `preflight` compiles one unknown-input line over every parameter name, reading `supplied`, then one `typeof inputs?.NAME !== 'string'` line per required parameter. A journey without parameters gets none.
- `src/core/compilers.ts:578` `...preflight` is emitted right after the `execute` signature, ahead of the gap throw and the toolset.
- `src/core/compilers.ts:475` The description paragraph gains the summary sentence `The module checks its inputs before any step.` `src/core/compilers.ts:487` The remarks state the checks, their order, the messages, and the absent-inputs reading. The gap bullet places the gap throw after the checks.
- `tests/setup.ts:29` Type import of `JSONValue` for the sequence rows.
- `tests/setup.ts:2369` `BrowserJourneySequenceCase`, `tests/setup.ts:2383` `BROWSER_JOURNEY_SEQUENCE_CASES` (the dialog row and the switch row), and `tests/setup.ts:2412` `createBrowserJourneySequenceJourney`.
- `tests/setup.ts:3487`, `tests/setup.ts:3506`, `tests/setup.ts:3599` The `add-kettle` TypeScript fence, its JavaScript twin, and the action module each gain their preflight lines. Only the action module has required parameters, so only it reads `inputs ?? {}` and `inputs?.NAME`.
- `tests/setup.ts:3915` `BROWSER_JOURNEY_DRAFT_STATE` is the `/form` draft state that the gap case and the input cases share. The gap case now reads it instead of its own copy.
- `tests/setup.ts:4151` `BrowserJourneyRefusalCase` and `tests/setup.ts:4161` `BROWSER_JOURNEY_INPUT_CASES` hold two rows over `BROWSER_JOURNEY_PREPARED_JOURNEY` (`Save draft`, then `type` bound to the required `name`): `a missing input` (`{}`) and `an unknown input` (`{ name, nmae }`).
- `tests/src/core/compilers.test.ts:225` New case for the order and placement of the preflight, evaluated against seven input objects. `tests/src/core/compilers.test.ts:268` New case: the action module's emitted checks, run against `undefined` inputs, throw `customer: the input is missing`.
- `tests/src/core/compilers.test.ts:203`, `:340`, `:357` Existing cases updated: the secret case asserts both preflight lines and the shifted call line. The no-parameter case asserts that the toolset line follows the signature. The inherited-member case asserts that a required `toString` refuses `{}` and accepts an own `toString`.
- `tests/service/journey.test.ts:368` New `it.each(BROWSER_JOURNEY_INPUT_CASES)` in `compiled module equality`.
- `tests/service/journey.test.ts:440` The type-check case also compiles `name-draft.ts`, so a TypeScript module with a required-input preflight type-checks under strict options against the built declarations.
- `tests/service/journey.test.ts:1051` `contexts` with teardown in `afterEach`, and `tests/service/journey.test.ts:1128` new `it.each(BROWSER_JOURNEY_SEQUENCE_CASES)` in `claim 5`.
- `guides/browser.md:489` The summary cell equals the doc comment's description paragraph, so it gains the same sentence. `guides/browser.md:3189` The `add-kettle` fence gains the two-line check, laid out by the formatter (`tmp/units/journeys/g3-guides.patch`, applied with `git apply` on the coordinator's widened scope). `guides/browser.md:3223` The paragraph after the fence states the checks, the messages, and the absent-inputs case.
- `tests/setup.test.ts:1572` The `instrumentBrowserJourneyModule` expectation follows the twin's preflight line (scope note: a test of a fixture this unit changes).

Diffstat (`git diff --stat`): 6 files changed, 350 insertions(+), 18 deletions(-).

## Claims

1. **Preflight shape.** A journey with parameters compiles one unknown-input line, then one missing-input line per required parameter, then the gap throw, then `createBrowserToolset`. This is the same in JavaScript and TypeScript. A journey without parameters compiles none of these lines. Evidence: `checks the inputs before a gap and before the toolset starts: a name no parameter carries, then each required input` (`tests/src/core/compilers.test.ts:225`); `takes no inputs when the journey declares no parameter` (`:340`); the full-source gap case (`:279`).
2. **Preflight semantics.** An unknown name is refused before a missing one, matching replay's preparation order. `undefined` and an inherited member count as missing. A defaulted parameter needs no input. Evidence: the seven-row table at `tests/src/core/compilers.test.ts:225`, and the required `toString` assertions at `:357`.
3. **No side effect (N3).** For a missing and for an unknown input, the generated JavaScript module throws the ruled message and replay refuses with `BROWSER_JOURNEY_INPUT`. Both leave the `/form` click log empty and the draft unsaved. With its preflight removed, the same module clicks `Save draft` (`clicks: 'save:true', saved: 'yes'`). Evidence: `refuses a generated module given $name before its first step, leaving the click log empty as the replay does at preparation` (`tests/service/journey.test.ts:368`); mutation `g3a`.
4. **`add-kettle` stays byte-equal to its transcription.** `compileBrowserJourney(BROWSER_JOURNEY_FIXTURE, { language: 'typescript' })` equals `BROWSER_JOURNEY_MODULE`, which now carries the one-line unknown-input check (`tests/src/core/compilers.test.ts:183`, `:189`). The defaulted-only form reads `Object.keys(inputs)`, unchanged by the absent-inputs ruling. The guide's fence carries the same check, and `npm run test:guides` passes (248 of 248). The coordinator amends the design's fence.
5. **Claim 5 dialog row.** Replay of the click that `/confirm`'s dialog interrupts, followed by `dialog { accept: true }`, completes. Each step's outcome (`interrupted`, then `done`), stage, reason, and masked receipt equal those of direct `tools.execute` calls in a second fresh context. Evidence: `replays the $name step by step …` row `interrupted click and its dialog` (`tests/service/journey.test.ts:1128`); mutation `g3b`.
6. **Claim 5 switch row.** Replay of a `switch` to the `Details` tab at `/popup/child`, over a toolset given its context, equals a direct `switch { tab: 't2' }` on outcome, stage, reason, and masked receipt. Evidence: the same `it.each`, row `switch with a context`; mutation `g3c`.
7. **Absent inputs (closed limit).** A module with a required parameter tolerates a missing `inputs` object: its emitted checks, run against `undefined`, throw `Error('customer: the input is missing')`, not a `TypeError`. A module whose parameters all have defaults keeps `Object.keys(inputs)` over its `= {}` default. Evidence: `reports the first required input as missing when execute receives no inputs object` (`tests/src/core/compilers.test.ts:268`); the byte-equal `add-kettle` cases (`:183`, `:189`); mutation `g3d`.

Proof instrument: no `prove` closing line exists for any claim, because this session has no `prove` tool (see Deviations). The failing-first and mutation runs are the evidence.

## Failing first

The command was `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts`. Before the compiler change it reported 6 failed, 45 passed of 51 (exit 1). After the change it reported 51 passed of 51 (exit 0). The failing tests were:

- `emits the add-kettle module byte for byte in TypeScript`
- `emits the JavaScript twin without the type import and the annotations, by default`
- `renders every action's arguments, keeps a page tool's arguments literal, and drops the target evidence`
- `requires a secret input and forwards it with secret: true and no literal fallback`
- `checks the inputs before a gap and before the toolset starts: a name no parameter carries, then each required input`
- `reads only an own input for a parameter that names an inherited member`

## Mutations

Each mutation was applied by `tmp/codex/g3-mutations/mutate.ts`, then the bundle was rebuilt with `npm run build` (exit 0), then this command ran: `npm run test:service -- tests/service/journey.test.ts`. Each mutation was restored afterwards and the bundle rebuilt. The diffs are under `tmp/codex/g3-mutations/`. Each mutation keeps the build valid: a first form of `g3a` and `g3b` broke the declaration build with TS6133, so those runs were discarded and do not count as evidence.

The following table lists each mutation and its result:

| Mutation | Edit | Result | Failing tests |
| --- | --- | --- | --- |
| `g3a` | `src/core/compilers.ts`: the preflight is dropped (`...preflight.slice(preflight.length)`) | exit 1; 2 failed, 29 passed (31) | Both rows of the input case: the click log reads `save:true` instead of empty |
| `g3b` | `src/core/BrowserReplay.ts`: replay's dialog admission is dropped (the `continue` condition never holds) | exit 1; 3 failed, 28 passed (31) | Claim 5 row `interrupted click and its dialog` (`stopped`, expected `complete`). Two existing cases need the same admission: the module case `click that opens a dialog` (CDP timeout) and claim 6's hold case (120 s timeout). The switch row passes. |
| `g3c` | `src/core/BrowserReplay.ts`: replay passes no `tab` to `performBrowserStep` | exit 1; 1 failed, 30 passed (31) | Claim 5 row `switch with a context` (`stopped`) |
| `g3d` | `src/core/compilers.ts`: the `?? {}` is dropped (`'inputs ?? {}'` becomes `'inputs'`); run as `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts`, no build needed | exit 1; 4 failed, 48 passed (52) | `reports the first required input as missing when execute receives no inputs object` (the message is not the ruled one). Three line-text pins also fail: `renders every action's arguments, …`, `requires a secret input …`, and `checks the inputs before a gap …` |

## Validation

All commands ran from the worktree root, after every mutation was restored. The following table lists the first round of commands with their exit codes and counts:

| Command | Exit | Counts |
| --- | --- | --- |
| `npx oxfmt --check` over the 5 touched files | 0 | 5 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 5 touched files | 0 | no diagnostics |
| `npm run check` | 0 | no diagnostics |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts` | 0 | 51 passed (51) |
| `npm run test:src:core` | 0 | 50 files, 1056 passed (1056) |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts` | 0 | 66 passed (66) |
| `npm run build` | 0 | output written to a log; no `error` line |
| `npm run test:service -- tests/service/journey.test.ts`, run 1 | 0 | 31 passed (31) |
| `npm run test:service -- tests/service/journey.test.ts`, run 2 | 0 | 31 passed (31) |
| `npm run test:service -- tests/service/journey.test.ts`, run 3 | 0 | 31 passed (31) |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (115) |
| `npm run test:guides` (read-only, outside the brief's list) | 1 | 1 failed, 247 passed (248): `carries the module compileBrowserJourney emits for add-kettle, laid out by the formatter`, until `tmp/units/journeys/g3-guides.patch` lands |

The following table lists the follow-up round, run after the guide patch and the absent-inputs change:

| Command | Exit | Counts |
| --- | --- | --- |
| `npx oxfmt --check` over the 6 touched files (the 5 earlier plus `guides/browser.md`) | 0 | 6 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 5 touched TypeScript files | 0 | no diagnostics |
| `npm run check` | 0 | no diagnostics |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts` | 0 | 52 passed (52) |
| `npm run test:src:core` | 0 | 50 files, 1057 passed (1057) |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts` | 0 | 66 passed (66) |
| `npm run build` | 0 | output written to `tmp/codex/g3-mutations/build-final.log`; no `error` line |
| `npm run test:service -- tests/service/journey.test.ts` | 0 | 31 passed (31) |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (115) |
| `npm run test:guides` | 0 | 248 passed (248) |

## Deviations

- **Guide (applied on widened scope).** The coordinator widened the scope to `guides/browser.md`. `tmp/units/journeys/g3-guides.patch` was applied with `git apply`, then the summary cell and the absent-inputs sentence were added. `npm run test:guides` passes 248 of 248.
- **Design fence change (for the design).** In `.orkestrel/browser/journeys-design.md` § 6, the `add-kettle` fence gains this line between the `execute` signature and `const toolset = createBrowserToolset(page)`:

  ```ts
  	for (const name of Object.keys(inputs)) if (!['email'].includes(name)) throw new Error(name + ': no parameter has that name')
  ```

  The fence cannot stay byte-equal without this line, because the ruling requires the unknown-input check for every journey with parameters, and `add-kettle` declares `email`. `BROWSER_JOURNEY_MODULE` (`tests/setup.ts:3483`) carries the amended fence.
- **Scope note.** `tests/setup.test.ts` is a test of the twin fixture this unit changes, so it is in scope under the brief's test-or-fixture rule. The type-check case in `compiled module equality` gains `name-draft.ts`.
- **Remaining bound.** In JavaScript, a defaulted parameter given `undefined` or a non-string value falls back to its default or passes the value through, while replay refuses it with `BROWSER_JOURNEY_INPUT`. No ruling covers this case. The absent-inputs `TypeError` that this bullet recorded earlier is closed by claim 7.
- **Instrument.** This session has no `prove` tool, so no `prove` closing line exists. The failing-first run and the mutations stand as the evidence.
- **Scratchpad deletion.** During cleanup, `rm -rf` on `*.ts` files, `*.fmt` files, and a `guides` directory in the session scratchpad (`/tmp/claude-0/-home-user/4338f304-4fe6-5169-89e8-36562d885cad/scratchpad/`) also matched files that other units had left there. Several redirects in this unit (`guides.patch`, `guides.log`, `service1.log`, `build.log`) may also have overwritten other units' files of the same name. The removed and overwritten files are not recoverable from here. No worktree file was affected.
