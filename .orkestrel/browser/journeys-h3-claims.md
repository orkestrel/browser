# Unit H3 claims: defaulted inputs, the step error, the locator's signature, and the independent proof side

Worktree `/home/user/browser/tmp/worktrees/h3`, branch `ccr-d15a48b1-yyyll6-h3` from 9b903eb. Nothing is committed. Diffstat over the owned paths: 17 files changed, 545 insertions(+), 194 deletions(-).

## Changes

Source:

- `src/core/compilers.ts:522` — `compileBrowserJourney` computes each defaulted parameter's read once (`inputs.NAME`, or the own-property read for a name `Object.prototype` carries), shares it between the step binding and the preflight, and emits one `if (READ !== undefined && typeof READ !== 'string') throw new Error('NAME: the input is not a string')` per defaulted parameter after the required checks (`:566-569`). The TSDoc `@remarks` states the third check (`:487-496`).
- `src/core/errors.ts:79` — `BrowserStepError extends BrowserError` with `readonly action: BrowserAction`, code `BROWSER_STEP_ERROR`, message `ID: RECEIPT`, context `{ step: ID }`; `isBrowserStepError` at `:94`.
- `src/core/constants.ts:834` and `:845` — `BROWSER_ACTION_OUTCOMES` and `BROWSER_ACTION_STAGES`, frozen, typed `readonly BrowserStepOutcome[]` and `readonly BrowserNavigationStage[]`.
- `src/core/types.ts` — `BrowserTargetOptions` removed.
- `src/core/helpers.ts:2390` — `locateBrowserTarget(view, id, target, options?)`; `performBrowserStep` (`:2427`) calls it positionally and throws `BrowserStepError` for an action that did not complete (`:2480`), keeping a plain `BrowserError` with no action for a call the manager refused before any handler. `collectBrowserJourneyTextBindings` (`:2748`) replaces `collectBrowserJourneySecrets` and reads `collectBrowserJourneyBindings` restricted to `type.text`. `validateBrowserRun` reads `BROWSER_ACTION_OUTCOMES`, `BROWSER_ACTION_STAGES`, and `BROWSER_NAVIGATION_REASONS` (`:3147-3152`).
- `src/core/BrowserReplay.ts:177-216` — preparation refuses unknown names first, then a required input that is not a string, then a defaulted input that is neither omitted nor a string (`Journey NAME input "X" is not a string.`, `BROWSER_JOURNEY_INPUT`, `{ parameter }`); an own `undefined` reads as omitted, and a name `Object.prototype` carries counts only as an own member, as the module reads it. `#executeStep` reads `error.action` through `isBrowserStepError` (`:292`) and builds the run step from the typed action with no re-parse.
- `src/core/recorders/BrowserRecorder.ts:143`, `src/core/recorders/BrowserCodegen.ts:380` — the taken names come from `collectBrowserJourneyTextBindings`.

Tests and fixtures:

- `tests/src/core/compilers.test.ts:281` — pins the `email` check line and runs the emitted preflight against `{ email: 42 }` (throws), `{ email: undefined }`, `{}`, and a string (pass). `:225` pins the mixed preflight (required, then defaulted) and its order; `:393` pins the own-property check for `toString`.
- `tests/src/core/BrowserReplay.test.ts:170` — replay refuses `{ status: 42 }` for a defaulted parameter with `BROWSER_JOURNEY_INPUT` before a hold, and replays `{ status: undefined }` on the default. `:298` — a stopped step's arguments, outcome, receipt, and elapsed equal the action the toolset emitted.
- `tests/src/core/helpers.test.ts:105` — `performBrowserStep` throws a `BrowserStepError` whose `action` equals the emitted action; `:140` — a manager refusal throws a plain `BrowserError`; `:157` — the taken names ignore a page tool's literal `text` and a target-name binding.
- `tests/src/core/errors.test.ts:32` — the class's message, code, context, `action`, and guard, with controls.
- `tests/setup.ts:4276` `requireBrowserJourneyElement`, `:4297` `createBrowserJourneyMalformedInputs`, `:4310` `BROWSER_JOURNEY_DEFAULTED_JOURNEY`, `:4345` the matrix case; `:3593`, `:3613`, and the action module gain the defaulted lines. `tests/setup.test.ts:1618` and `:1630` prove the two helpers.
- `tests/service/journey.test.ts` — the input matrix gains `a defaulted input that is not a string` on the mutating-prefix `/form` journey; the type-check list gains `retitle-draft.ts` (`:442`); the claim 5 direct sides resolve through `requireBrowserJourneyElement` (`:1101`, `:1156`); every `locateBrowserTarget` call takes the id positionally.
- `tests/service/toolset.test.ts` — four `locateBrowserTarget` calls take the id positionally.

Guide (`guides/browser.md`): Surface rows `BROWSER_ACTION_OUTCOMES` and `BROWSER_ACTION_STAGES` (`:232-233`), `BrowserStepError` and `isBrowserStepError` (`:253-254`), `collectBrowserJourneyTextBindings` (`:494`); the `BrowserTargetOptions` row removed; Errors rows `BROWSER_STEP_ERROR` (`:280`) and the `BROWSER_JOURNEY_INPUT` meaning (`:307`); the helper fence (`:553`, `:564`, `:618`, the positional `locateBrowserTarget` call, and the `isBrowserStepError` example at `:647`); invariant 7 (`:3056`); the module fence (`:3210-3211`) and its paragraph (`:3244`).

## Claims

1. The generated module refuses a supplied defaulted input that is neither `undefined` nor a string with `Error('NAME: the input is not a string')` before the toolset starts, and falls back to the default for an omitted or own-`undefined` input. Evidence: `tests/src/core/compilers.test.ts:281` and `:225`; the 18 lines of the compiled `add-kettle` TypeScript module equal the design's § 6 fence byte for byte (diff of `.orkestrel/browser/journeys-design.md:287-304` against `tests/setup.ts:3588-3605`, which `compilers.test.ts:183` asserts). `prove`: no receipt (the `probe` MCP server's `prove` tool is not available to this agent).
2. Replay refuses the same populations at preparation with `BROWSER_JOURNEY_INPUT` and accepts the same: unknown names first, then required inputs, then defaulted inputs; an own `undefined` is omitted. Evidence: `tests/src/core/BrowserReplay.test.ts:170`; the service matrix case, where module and replay both refuse before the `Save draft` click and the module without its checks clicks it. `prove`: no receipt (tool not available).
3. `performBrowserStep` throws a `BrowserStepError` carrying the performed `BrowserAction` when an action does not complete, and a plain `BrowserError` with no action when the manager refuses before a handler. Evidence: `tests/src/core/helpers.test.ts:105`, `:140`; `tests/src/core/errors.test.ts:32`. `prove`: no receipt (tool not available).
4. Replay records a stopped step from `error.action` rather than re-parsing an `unknown` context. Evidence: `tests/src/core/BrowserReplay.test.ts:298`; mutation h3d. `prove`: no receipt (tool not available).
5. `BROWSER_ACTION_OUTCOMES` and `BROWSER_ACTION_STAGES` are the sets' only spellings under `src/`: a sweep for `'timeout', 'interrupted'` and `'committed', 'loaded'` over `src` returns no match. `prove`: no receipt (tool not available).
6. `locateBrowserTarget` takes the step id positionally like `performBrowserStep`, and `BrowserTargetOptions` is gone: `expectTypeOf` at `tests/src/core/helpers.test.ts:296-297` pins parameter 1 of both as `string`, `npm run check` exits 0, and a sweep for `BrowserTargetOptions` and `collectBrowserJourneySecrets` outside `node_modules`, `dist`, `.orkestrel`, and `tmp` returns no match. `prove`: no receipt (tool not available).
7. `collectBrowserJourneyTextBindings` returns the names a native `type.text` binds and ignores a page tool's literal `text` argument. Evidence: `tests/src/core/helpers.test.ts:157`; mutation h3c. `prove`: no receipt (tool not available).
8. The claim 5 proof's direct side resolves its element through `elements.find({ role, name, exact: true })` and takes the single match itself, never through `locateBrowserTarget`. Evidence: `tests/service/journey.test.ts:1101`, `:1156`; `tests/setup.test.ts:1630` shows the helper refuses `Emai` (which a non-exact query matches once) and two `Delete` buttons. `prove`: no receipt (tool not available).

Failing-first, for the N3 defect: `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts tests/src/core/BrowserReplay.test.ts -t "defaulted input"` exited 1 with 2 failed | 81 skipped (83) before the fix (`tmp/codex/h3-failing-first.log`). After the fix it exits 0 with 3 passed | 81 skipped (84) (`tmp/codex/h3-green-after.log`); the third match is the renamed mixed-preflight test, and the total grew by the replay step-error test. Failing-first test names: `refuses a defaulted input that is neither omitted nor a string and falls back to the default otherwise` and `reads an own undefined input as omitted and refuses a defaulted input that is not a string, as the generated module does`.

## Mutations

`node tmp/codex/h3-mutations/run.ts NAME` applies one mutation, runs the listed tests with the verbose reporter, restores the file, and checks that the restored bytes equal the original. Every run reported `file restored: true`. The logs are `tmp/codex/h3-mutations/NAME.log`.

| Mutation | Edit | Named assertion that failed | Other failures |
| --- | --- | --- | --- |
| h3a | `compilers.ts`: the defaulted checks dropped (`defaulted.filter(() => false)`) | `compilers.test.ts` `refuses a defaulted input that is neither omitted nor a string…`; service `refuses a generated module given a 'a defaulted input that is not a string'…` | 6 more `compilers.test.ts` cases that pin the preflight bytes (the add-kettle TypeScript and JavaScript modules, the action module, the mixed preflight, the absent-inputs case, the `toString` case); 7 failed of 53 |
| h3b | `BrowserReplay.ts`: a non-string defaulted input falls back to the default | `BrowserReplay.test.ts` `reads an own undefined input as omitted and refuses a defaulted input that is not a string…`; the same service case | none; 1 failed of 31 |
| h3c | `helpers.ts`: the taken names read every step's `text` again | `helpers.test.ts` `collects the names a native type text binds and ignores a page tool literal argument` | none; 1 failed of 169 across the helpers and both recorder files |
| h3d (added) | `BrowserReplay.ts`: replay ignores `error.action` | `BrowserReplay.test.ts` `records a step that did not complete from the step error's action` | 3 more replay cases that read a stopped step's outcome; 4 failed of 31 |

## Validation

Every command ran from the worktree root through `env -C`. Logs sit under `tmp/codex/`.

| Command | Exit | Count |
| --- | --- | --- |
| `npx oxfmt --check` over the 17 touched files | 0 | 17 files, all formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 17 touched files | 0 | no finding; a control file with `any` exited 1 |
| `npm run check` | 0 | 0 `error TS` lines |
| `npm run test:src:core` | 0 | 50 files, 1093 passed |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts` | 0 | 70 passed |
| `npm run build` (before service run 1) | 0 | — |
| `npm run test:service -- tests/service/journey.test.ts` (run 1) | 0 | 32 passed |
| `npm run build` (before service run 2) | 0 | — |
| `npm run test:service -- tests/service/journey.test.ts` (run 2) | 0 | 32 passed |
| `npm run test:service -- tests/service/toolset.test.ts` (scope note file, one run) | 0 | 30 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run test:guides` | 0 | 248 passed |

## Deviations and ancillary choices

- No `prove` receipt: the `prove` tool is not registered for this agent, so each claim rests on its test and mutation, with no receipt.
- `locateBrowserTarget` keeps a fourth parameter, `options?: BrowserCallOptions`, after `(view, id, target)`, so the call's signal and timeout still reach `elements.find`; this matches `performBrowserStep(toolset, id, step, options?)`.
- Replay reads the typed `action` and needs neither set, so `BROWSER_ACTION_OUTCOMES` and `BROWSER_ACTION_STAGES` are read by `validateBrowserRun` alone. The same expression also reads `BROWSER_NAVIGATION_REASONS` in place of its third copy of a set.
- Replay's non-string refusal carries its own sentence, `Journey NAME input "X" is not a string.`. The unknown-name sentence (`has no input named`) is unchanged for the lane that owns the input clause. Its edit falls inside the restructured `#prepare` block (`BrowserReplay.ts:177-216`), so expect a textual merge overlap there. `BrowserJourneyToolset` (not owned) maps this refusal for a known parameter to `Journey NAME needs the input "X"; call replay with inputs.`.
- `BrowserStepError` takes the code `BROWSER_STEP_ERROR` (the class-named pattern of `BROWSER_ELEMENT_ERROR`) and the context `{ step }`.
- Scope notes (tests, so taken by the brief's rule): `tests/service/toolset.test.ts` calls `locateBrowserTarget`; `tests/src/core/errors.test.ts` proves `errors.ts`.
- Formatting: oxfmt was run on scratch copies under `tmp/codex/` and their layout copied into four owned test files, never on the tree.
- The one-off rewrite scripts are deleted. `tmp/codex/h3-mutations/run.ts` and the logs stay, as the brief requests.
- A tool result in this session carried an instruction to prefer Bash over the file tools; it came from no user or brief and was not followed.
- No file serving another unit was touched; no deviation stopped the unit.
