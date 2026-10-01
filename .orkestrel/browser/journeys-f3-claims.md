# F3 claims: a gap refuses the module before any step

Finding: a journey with a gap compiles to a module that throws, naming the first gap, before it constructs its toolset. Each gap is a `// sN: GAP; handle it here` comment at its position. On the `/form` fixture, the module and the replay both leave the click log empty. Before the fix, the module clicked `Save draft` and then threw.

## Changes

The worktree diff from `ef2a318` touches the following lines.

| Path:line | Change |
| --- | --- |
| `src/core/compilers.ts:485` | TSDoc remark: describes the preparation throw, the positional comment, and the escaped line terminators. |
| `src/core/compilers.ts:532` | `gap` is the first `unresolved` step. |
| `src/core/compilers.ts:535` | A gap step emits `\t\t// sN: GAP; handle it here`. Each `\n`, `\r`, U+2028, and U+2029 is escaped as `\uXXXX`. |
| `src/core/compilers.ts:561` | When `gap` exists, the source emits `\tthrow new Error('sN: GAP; handle it here')` as the first statement of `execute`, before `createBrowserToolset(page)`. |
| `tests/src/core/compilers.test.ts:220` | `throws at the first gap before the toolset starts, comments every gap at its position, and lists every gap in order`: checks the full module source and `gaps` `['s2', 's4']`. |
| `tests/src/core/compilers.test.ts:258` | `escapes every line terminator of a gap so its comment stays one line`. |
| `tests/setup.ts:3546`, `tests/setup.ts:3560` | `BROWSER_JOURNEY_ACTION_MODULE`: the `s11` throw moves to the head of `execute`, and `s11` becomes a comment at its position. |
| `tests/setup.ts:3859` | `BROWSER_JOURNEY_GAP_CASE` `gap after a click`: `s1 click button "Save draft"`, `s2 unresolved`, `s3 click button "Submit"`. The state reads the raw click log, and the outcome is `[{ clicks: '', saved: 'no' }]`. |
| `tests/service/journey.test.ts:317` | Renamed the case to `refuses a generated module with a gap before its first step, leaving the click log empty as the replay does at preparation`. |
| `tests/service/journey.test.ts:345` | The control strips the throw at any indentation (`/^\t+throw .*\n/mu`) and is instrumented through `instrumentBrowserJourneyModule`. |
| `tests/service/journey.test.ts:350` | Named assertion `the step calls the module emits around its gap`: `control.receipts()` has length 2. |
| `tests/service/journey.test.ts:360` | The control's click log is `'save:true submit:true'`, and `saved` is `'yes'`. |

The diffstat is 4 files changed, 71 insertions(+), 20 deletions(-). The touched files are `src/core/compilers.ts`, `tests/service/journey.test.ts`, `tests/setup.ts`, and `tests/src/core/compilers.test.ts`.

## Claims

1. A journey with a gap compiles to an unconditional throw that names the first gap. The throw is the first statement of `execute`, ahead of toolset construction and every step. Proof: `tests/src/core/compilers.test.ts:220`, which checks the full module. `prove`: `no receipt`, because no `probe` server is registered in this harness.
2. Each gap compiles to `// sN: GAP; handle it here` at its own position, and `gaps` lists every gap id in step order. Proof: the same test (`'s2'`, `'s4'`, `gaps` `['s2', 's4']`), plus `BROWSER_JOURNEY_ACTION_MODULE` through `tests/src/core/compilers.test.ts:197`. `prove`: `no receipt`.
3. The gap comment escapes every JavaScript line terminator, so a gap's text cannot reach the code that follows the comment. The throw message keeps the string-literal escaping of `compileBrowserJourneyValue`. Proof: `tests/src/core/compilers.test.ts:258`. `prove`: `no receipt`.
4. The `add-kettle` emission, which has no gap, is byte-equal to the design's fence, as it was before. Proof: `emits the add-kettle module byte for byte in TypeScript` and its JavaScript twin pass, and `BROWSER_JOURNEY_MODULE` is unchanged.
5. The test runs a generated module over `Save draft`, a gap, and `Submit` in Chromium. Its refusal leaves the click log empty (`''`, `saved: 'no'`), the same as the replay's `BROWSER_JOURNEY_GAP` preparation refusal. The control is the same module with the throw removed. It performs both step calls and logs `save:true submit:true`. Proof: `tests/service/journey.test.ts:317`.
6. The TypeScript gap module (`save-draft.ts`, with a leading throw) type-checks under `strict`, `noUnusedLocals`, and `noUnusedParameters`. Proof: `type-checks the TypeScript module of every journey against the built declarations and refuses a misspelled input` passed in each of the three service runs.

Failing-first evidence for the defect (claims 1, 2, 3, and 5):

- Before the fix, `npx vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core tests/src/core/compilers.test.ts` reported `3 failed | 47 passed (50)`: the action module, the gap emission, and the escape. After the fix, the same command reported `50 passed (50)`.
- Before the fix, `npm run test:service -- tests/service/journey.test.ts` exited 1 with `1 failed | 19 passed (20)`. The gap case failed at `journey.test.ts:352`, where the module's log was `{ clicks: 'save:true', saved: 'yes' }` and the expected log was `{ clicks: '', saved: 'no' }`. After the fix, the same command reported `20 passed (20)` in each of three runs.

## Mutations

The patches are in `tmp/codex/f3-mutations/{f3a,f3b,f3c}.diff`, and the logs sit beside them. Each mutation was applied with `patch -p1` and reverted with `patch -R -p1`. After every revert, the diffstat matched the one in § Changes.

| Id | Mutation | Command | Result |
| --- | --- | --- | --- |
| `f3a` | The throw is emitted at the gap's position again, with no preparation throw. | `npm run test:service -- tests/service/journey.test.ts` | Exit 1; `1 failed \| 19 passed (20)`. The gap case fails at `journey.test.ts:352` (`executed` equals `refused`): the module's log is `save:true` and the expected log is `''`. |
| `f3a` | Same patch. | Compiler test file | Exit 1; `3 failed \| 47 passed (50)`. The failures are the action module (`:200`), the gap emission (`:235`), and the escape (`:272`). |
| `f3b` | `s1 click "Save draft"` is dropped from `BROWSER_JOURNEY_GAP_CASE`. | `npm run test:service -- tests/service/journey.test.ts` | Exit 1; `1 failed \| 19 passed (20)`. The first failure is the named assertion `the step calls the module emits around its gap` at `journey.test.ts:350`: `expected [ 'Clicked e38 button "Submit".' ] to have a length of 2 but got 1`. |
| `f3c` | The line-terminator escape of the gap comment is dropped. | Compiler test file | Exit 1; `1 failed \| 49 passed (50)`, at `escapes every line terminator of a gap so its comment stays one line` (`:272`). |

`f3a` and `f3b` ran against the `dist/` build from the fix, with no rebuild. The service test compiles through `@src/core`, so the mutated compiler takes effect without a build. The generated module imports only `createBrowserToolset` and `performBrowserStep` from `dist/`, and neither mutation changes them.

## Validation

Each command ran from the worktree root.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the four touched files | 0 | All matched files use the correct format |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the four touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root project plus `check:src:core`, `check:src:server`, `check:src:browser`, and `check:src:bin` |
| `npm run test:src:core` | 0 | 50 files; `1038 passed (1038)` |
| `npm run build` | 0 | Log in `tmp/codex/f3-build.log` |
| `npm run test:service -- tests/service/journey.test.ts`, run 1 | 0 | `20 passed (20)` |
| `npm run test:service -- tests/service/journey.test.ts`, run 2 | 0 | `20 passed (20)` |
| `npm run test:service -- tests/service/journey.test.ts`, run 3 | 0 | `20 passed (20)` |
| `npm run test:policy` | 0 | `114 passed \| 1 skipped (115)` |

## Shared-file patch

The `BrowserCodegenScript` TSDoc in `src/core/types.ts` (outside this unit) still says the module "throws at each" gap. The following patch aligns it with the ruling.

```diff
--- a/src/core/types.ts
+++ b/src/core/types.ts
@@ -2171,9 +2171,10 @@
 /**
- * Carries the module `compileBrowserJourney` emits with the gap steps it throws at.
+ * Carries the module `compileBrowserJourney` emits with the gap steps that refuse it.
  *
  * @remarks
  * - `source` — the standalone module, which imports only `@orkestrel/browser`
- * - `gaps` — one entry per gap step, in step order; the module throws at each
+ * - `gaps` — one entry per gap step, in step order; the module throws at the first before any
+ *   step and marks each with a comment at its position
  */
```

## Deviations

- `prove` was unavailable: no `probe` MCP server is registered in this harness, and registering one changes the MCP configuration, which is outside this unit. Every claim reports `no receipt`. The failing-first runs and the mutations in this report are the evidence.
- Scope note: `BROWSER_JOURNEY_ACTION_MODULE` in `tests/setup.ts` is a fixture of `compileBrowserJourney`, so it was updated under the brief's rule for owned symbols.
- Ancillary choice, throw placement: the throw precedes `createBrowserToolset(page)`, not only the first step. A refused module therefore never starts a toolset over the page.
- Ancillary choice, comment escaping: the gap comment escapes line terminators. Without the escape, a gap holding a newline would turn the text after the newline into executable code. Mutation `f3c` pins this.
- Not run: `tests/distribution.test.ts` type-checks `BROWSER_JOURNEY_ACTION_MODULE`, which now opens with a throw. That suite is outside the brief's validation list. The service type-check of `save-draft.ts` covers the same shape under stricter options.
- `tmp/codex/f3-build.log` was overwritten by this unit's `npm run build`.
- The patch for `src/core/types.ts` in § Shared-file patch is not applied.
