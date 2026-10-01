# J7a claims

`compileBrowserJourney` is implemented in `src/core/compilers.ts`, and its TypeScript output for `add-kettle` equals the design fence byte for byte. The touched test file passes 53 tests, `test:src:core` passes 973, `test:policy` passes, and `npm run check` exits 0. Each of the three mutations fails its named assertion. `test:distribution` exits 1 because the worktree holds no built `dist/`, and this lane's charter forbids `build` (D1). The new distribution case is collected and fails for that same reason as three existing cases. A type probe against the source declarations supplies the type-check evidence instead.

## Changes

The following table lists each change with its location.

| Location | Change |
| --- | --- |
| `src/core/compilers.ts:1` | Imports `BrowserCodegenLanguage`, `BrowserCodegenScript`, `BrowserJourney`, `JSONValue`, the contract guards, `BROWSER_JOURNEY_ACTIONS`, and `validateBrowserJourney`. |
| `src/core/compilers.ts:492` | `compileBrowserJourneyValue(value, bindings?)` compiles a JSON value to a single-quoted JavaScript literal. It keeps identifier keys bare, quotes other keys, and gives an own `__proto__` key a computed key. When a `{ parameter }` binding is named in `bindings`, it compiles to the mapped expression. |
| `src/core/compilers.ts:550` | `compileBrowserJourney(journey, options?)` runs the validator first. It then emits the imports, the typed or untyped `execute`, one `performBrowserStep` call per step, gap throws, and the `try`/`finally` teardown, and returns `{ source, gaps }`. |
| `tests/setup.ts:3065` | `BROWSER_JOURNEY_MODULE` holds the design fence transcription, and a scratch script compared it with the bytes of `journeys-design.md` § 6. |
| `tests/setup.ts:3084` | `BROWSER_JOURNEY_MODULE_JAVASCRIPT` is the hand-written JavaScript twin. |
| `tests/setup.ts:3105` | `BROWSER_JOURNEY_ACTION_FIXTURE` covers every native action. It includes bound, required, and secret inputs, quoted text, both dialog answers, a tab, a gap at `s11`, and a page tool whose arguments carry `ref`, `tab`, `{ parameter }`, numbers, `null`, arrays, escapes, and non-identifier keys. |
| `tests/setup.ts:3175` | `BROWSER_JOURNEY_ACTION_MODULE` is the hand-transcribed TypeScript module for that journey. |
| `tests/src/core/compilers.test.ts:5` | Imports the compilers, `attempt`, and the fixtures. |
| `tests/src/core/compilers.test.ts:227` | Adds eight `compileBrowserJourney` cases. |
| `tests/src/core/compilers.test.ts:343` | Adds two `compileBrowserJourneyValue` cases. |
| `tests/distribution.test.ts:1` | Narrows the header's "nothing here names this package" sentence to apply outside the generated module case. |
| `tests/distribution.test.ts:26` | Imports `pathToFileURL`, `compileBrowserJourney`, and the fixtures. |
| `tests/distribution.test.ts:973` | Adds `generated journey module`. It checks the emitted modules against the installed declarations under `node16`, `nodenext`, and `bundler`. Each resolution also checks a control that must be refused. The case then emits the modules with `tsc` and imports the emitted modules and the JavaScript twin under Node. |

The diffstat is `4 files changed, 512 insertions(+), 5 deletions(-)`: `src/core/compilers.ts` +153, `tests/distribution.test.ts` +65/−5, `tests/setup.ts` +136, and `tests/src/core/compilers.test.ts` +163/−5.

## Claims

1. **Fence equality.** `compileBrowserJourney(BROWSER_JOURNEY_FIXTURE, { language: 'typescript' })` returns `{ source: BROWSER_JOURNEY_MODULE, gaps: [] }`. Its source includes the trailing newline, which CommonMark counts as fence content. See `emits the add-kettle module byte for byte in TypeScript` (`tests/src/core/compilers.test.ts:228`). Mutation `j7a1` fails that assertion.
2. **JavaScript twin.** The default language and `'javascript'` both return the twin, which drops the type import and every annotation. See `emits the JavaScript twin without the type import and the annotations, by default` (`:234`).
3. **Argument rendering for every action.** Native bindings render as `inputs.NAME ?? 'DEFAULT'`, or as `inputs.NAME` when the parameter is required or secret. Arguments keep their stored key order. A target emits only `{ role, name }` and drops `css` and `reference`, and a tab emits `{ url, title }`. `switch` carries its tab, and both dialog answers render. A page tool's arguments stay literal, `{ parameter: 'customer' }` included, even though `customer` is a declared parameter. The gap throws at `s11`, and the call after it stays in place. See `renders every action's arguments, keeps a page tool's arguments literal, and drops the target evidence` (`:242`), which compares the whole module.
4. **Secret.** A secret parameter becomes a required `readonly NAME: string` property, and `inputs` then takes no `= {}`. The `type` call passes `{ text: inputs.NAME, submit }` with `{ secret: true }` as its fourth argument, and no other line carries `secret: true`. See `requires a secret input and forwards it with secret: true and no literal fallback` (`:248`). Mutation `j7a2` fails that assertion.
5. **Gap.** Each `unresolved` step compiles to `throw new Error('sN: GAP; handle it here')` at its position, with quotes escaped. `gaps` lists the ids in step order. See `compiles each gap to a throw at its position and lists every gap in order` (`:265`). Mutation `j7a3` fails that assertion.
6. **Validator first.** An invalid name, a secret with a default, an undeclared binding, and an unknown format each reject with the validator's code (`BROWSER_JOURNEY_INVALID` or `BROWSER_JOURNEY_FORMAT`) and return no source. See `refuses an invalid journey with the validator code before compiling any source` (`:323`).
7. **Literal soundness.** The compiled literal for quotes, backslashes, newlines, U+2028, NUL, an empty key, and an own `__proto__` key evaluates back to a strictly equal value with an own `__proto__` property. A `{ parameter }` object is replaced only when it has a sole `parameter` member that the map names. See `tests/src/core/compilers.test.ts:344` and `:365`.
8. **Dialog continuation.** The emitted `click` and `dialog` steps are sequential awaits with no catch between them. `performBrowserStep` in `src/core/helpers.ts:2433` returns the action for `interrupted`, which matches the brief. The J4 report's earlier "throws on interrupted" note describes a superseded state.
9. **Imports.** The module imports only `@orkestrel/browser`. The type probe checked `kettle.ts` and `checkout.ts` with the worktree's `tsc` against the source declarations under the root `tsconfig.json`. That configuration sets `strict`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`. Both modules produced no diagnostics, and the probe exited 2 on the control alone, with `control.ts(11,87): error TS2551: Property 'emial' does not exist on type '{ readonly email?: string; }'`. `node --check` accepted the JavaScript twin of the action journey. The check against the packed tarball is still unrun (D1).

No `prove` closing line exists for any claim (D2).

## Mutations

`tmp/codex/j7a-mutations/run.ts ID` applies one edit to `src/core/compilers.ts`. It runs `npx vitest run --config vite.config.ts --project src:core --reporter=verbose tests/src/core/compilers.test.ts`, writes `ID.log` and `ID.diff`, and restores the source in `finally`. After the three runs, `git diff --stat src/core/compilers.ts` showed the unmutated +153, and the file run passed 53 tests.

| Mutation | Breaking edit | Named assertion and failure | Exit and counts |
| --- | --- | --- | --- |
| `j7a1` | `journey.steps.filter((step) => step.id !== 's3').map(...)` omits the call for step `s3` | `emits the add-kettle module byte for byte in TypeScript`: `expected { …(2) } to strictly equal { …(2) }` | 1; 5 failed, 48 passed (also the twin, action, secret, and gap cases) |
| `j7a2` | A secret renders `inputs.NAME ?? 'NAME'` | `requires a secret input and forwards it with secret: true and no literal fallback`: the `s4` line mismatch | 1; 2 failed, 51 passed (also the action case) |
| `j7a3` | A gap renders `// sN: GAP; handle it here` | `compiles each gap to a throw at its position and lists every gap in order`: the four-line slice mismatch | 1; 2 failed, 51 passed (also the action case) |

## Validation

Every command ran through `env -C /home/user/browser/tmp/worktrees/j7a`. The format and lint population is the four touched files.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the touched files | 0 | 4 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root, core, server, and browser projects pass |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts` | 0 | 53 passed |
| `npm run test:src:core` | 0 | 973 passed across 45 files |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run test:distribution` | 1 | 4 failed, 3 passed. Packing without `dist/` leaves the exports targets missing, which fails `packs one archive…`, `ships every relative target…`, `declares types…`, and `generated journey module` (TS2307 on `@orkestrel/browser` under each resolution). Log: `tmp/codex/j7a-distribution.log`. |
| `npm run test:guides` (informational, not in the brief) | 1 | 5 failed, 202 passed. `documents every barrel export` lists 65 names: the J1–J4 journey surface plus `compileBrowserJourney` and `compileBrowserJourneyValue`. Log: `tmp/codex/j7a-guides.log`. |

## Deviations and scope notes

- **D1, distribution blocked on the build.** `npm pack --ignore-scripts` packs `dist/src`, which this worktree does not hold. This lane's charter forbids `build`, so the success path of the new case has not run. The case fails at the same missing output as the three existing installed-package cases. To close it, run `env -C /home/user/browser/tmp/worktrees/j7a npm run build` and then `env -C /home/user/browser/tmp/worktrees/j7a npm run test:distribution`. The expected result is 7 passed, with the browser entry case possibly skipping when no browser launches. Claim 9's probe is the substitute type evidence. Importing the emitted module under Node through the installed package remains unverified.
- **D2, no `prove` instrument.** No `prove` tool is registered in this session, so no `prove` receipt exists. The type probe, the hand-transcribed fixtures, and the mutations are the evidence.
- **D3, choices made within scope.** Each of these choices keeps the emitted module type-checking under the probe's strict settings, or follows a declared type:
  - When a parameter is required (a secret, or a parameter with no default), `inputs` takes no `= {}`. TypeScript refuses an empty default for a type with a required property.
  - A journey with no parameters emits `execute(page)` with no `inputs`, because `noUnusedParameters` refuses an unused parameter.
  - A defaulted parameter whose name is an `Object.prototype` member, such as `toString` or `constructor`, renders `(Object.hasOwn(inputs, 'NAME') ? inputs.NAME : undefined) ?? 'DEFAULT'`. Without this, the module reads the inherited member where replay, through `resolveBrowserJourneyBinding`, reads only an own input. See `reads only an own input for a parameter that names an inherited member` (`:304`).
  - A target emits only `role` and `name`, and a tab emits only `url` and `title`. `performBrowserStep`'s `step` parameter declares only those members, so an object literal carrying `css` or `reference` is an excess-property error.
  - `language` defaults to `'javascript'`, matching `BrowserCodegenScriptOptions`. The options parameter is the inline `{ readonly language?: BrowserCodegenLanguage }` the brief prescribes, so the function carries no dependency on the retiring options type.
  - The two import lines are emitted even when every step is a gap.
- **D4, added public export.** `compileBrowserJourneyValue` is a second export in `compilers.ts`. It is the recursive literal compiler the module emission needs, kept in its kind file because the architecture rules place a pure compiler's recursion there. Its guide row belongs to J12.
- **Scope notes.** `tests/setup.ts` received four fixtures, a test need that the brief's exception assigns to this unit. `tests/distribution.test.ts` received a one-sentence header change so that the header stays true with the new case. No shared source file outside the owned list changed, and no shared-file patch is needed.
- **Process.** Several early read-only commands, and the edit scripts and format comparison, used `cd` into this same worktree instead of `env -C`. Every validation in the preceding table was rerun through `env -C`. The formatter ran only on scratch copies, and its hunks were copied into the two owned files. The runtime probe under `tmp/probes/j7a/` was deleted. No commit, stash, reset, checkout, or index-wide git command was issued.
