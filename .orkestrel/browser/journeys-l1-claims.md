# Unit L1: the toolset follows a recorded step — claims

Worktree `/home/user/browser/tmp/worktrees/l1`, branch `ccr-d15a48b1-yyyll6-l1` from 41c39c7. Nothing is committed.

## Changes

- `src/core/types.ts:2813` `BrowserFollowOptions` (extends `BrowserCallOptions` with `caller` and `secret`); `:2826` `BrowserTabLine` (`id`, `title`, `url`, `current`); `:2870` `BrowserToolsetInterface.follow(id, step: BrowserJourneyStepInput, options?: BrowserFollowOptions): Promise<BrowserAction>` with its TSDoc.
- `src/core/BrowserToolset.ts:452` `follow`: builds the context, resolves the target or tab, performs through `perform`, returns the action on `done` and `interrupted`, and throws `BrowserStepError` otherwise; `:1418` private `#resolveTarget` (exact role and name on the current view, refusing a bound name, a missing target, and several targets); `:1443` private `#resolveTab` (the `tabs` listing read through `parseBrowserTabLine`).
- `src/core/parsers.ts:729` `parseBrowserTabLine(line)`.
- `src/core/helpers.ts` drops `locateBrowserTarget` and `performBrowserStep`, plus the imports only they used. `src/core/index.ts` is unchanged because the barrel star-exports `helpers.js` and `parsers.js`.
- `src/core/BrowserReplay.ts:271` calls `this.#toolset.follow`.
- `src/core/compilers.ts:589` emits `await toolset.follow('sN', …)`; `:593` imports only `createBrowserToolset`. The TSDoc names the `follow` method.
- `tests/src/core/BrowserToolset.test.ts:5646` adds the `follow` block (10 cases). The views case at the `switch` ambiguity calls `toolset.follow`.
- `tests/src/core/parsers.test.ts:41` adds the `parseBrowserTabLine` block (2 cases).
- `tests/src/core/helpers.test.ts` drops the 9 cases that moved to the toolset's test, plus their imports.
- `tests/src/core/compilers.test.ts` expects the `follow` call and the single value import.
- `tests/setup.ts:3662`, `:3683`, `:3776` update `BROWSER_JOURNEY_MODULE`, its JavaScript twin, and `BROWSER_JOURNEY_ACTION_MODULE`. `:4343` updates the doc comment of `requireBrowserJourneyElement`.
- `tests/setup.test.ts` expects the single value import.
- `tests/service/journey.test.ts`:
  - Claim 3 records through `follow` and refuses the duplicate through `follow`.
  - Claim 4 refuses through `follow` and clicks Cancel through `follow`.
  - Claim 6 resolves the direct side's element through `requireBrowserJourneyElement`.
- `tests/service/toolset.test.ts` runs the journey perform-equality block through `toolset.follow`, and resolves the direct sides through `requireBrowserJourneyElement`. The DOM placement case calls `documentToolset.follow`.
- `guides/browser.md`:
  - Errors table rows `:283`, `:311`, `:314`, `:315`.
  - Helper rows removed; the `compileBrowserJourney` row changed.
  - Parser row `:477`, type rows `:1130` and `:1131`.
  - The `follow` prose `:1917` and Method row `:1924`.
  - The toolset fence gains the `follow` and `BrowserStepError` lines; the helpers fence loses them and gains no replacement.
  - The parsers fence gains `parseBrowserTabLine`.
  - The replay steps `:2087`, the module fence `:3255`, and the module prose.
  - The test bullets for `helpers.test.ts`, `BrowserToolset.test.ts`, and `parsers.test.ts`.
- `.orkestrel/browser/journeys-design.md`:
  - § 1 `:7`, § 2 `:99`, § 4 `:264`, § 6 `:281` and `:282`, and the § 6 fence `:296`.
  - § 14 `:543` (the id sentence), `:545`, and `:554`.

Diffstat: 16 files changed, 743 insertions(+), 548 deletions(-).

## Claims

1. `performBrowserStep` and `locateBrowserTarget` no longer exist in source, tests, the barrel, or the guide. The command `git grep -n "performBrowserStep\|locateBrowserTarget" -- . ':!.orkestrel' ':!tmp'` returns no line. `npm run check` exits 0 with the interface member implemented.
2. `follow` resolves a target by role and exact name on the toolset's current view, and never reads the step's stored `reference` or `css`. Pinned by `follow > refuses ambiguity without trusting a stored reference or selector` and mutation `l1a`.
3. A missing target refuses with `BROWSER_JOURNEY_TARGET`, several refuse with `BROWSER_JOURNEY_AMBIGUOUS`, and a bound target name refuses with `BROWSER_JOURNEY_INPUT`. Each refusal names the step and comes before any `Input.*` message. Pinned by `follow > resolves a unique target on its own view and refuses a missing target or a bound name without sending input` and the ambiguity case.
4. `follow` builds the arguments by action, as the removed function did. `ref` goes only on `click` and `type` with a target. `secret` goes only on `type` with `options.secret`. `press`, `dialog`, `wait`, and `navigate` get no `ref`. A page tool's arguments pass unchanged, a `{ parameter }` literal included. Pinned by `builds ref only for element actions and forwards a secret through the action boundary`, `builds no ref for wait and stops a sequence at its unchanged timeout receipt`, and `passes a page tool its literal arguments unchanged without resolving an element target`.
5. A `switch` step resolves its tab id from the `tabs` listing by URL and title through `parseBrowserTabLine`. A missing tab refuses with `BROWSER_JOURNEY_TARGET` and an ambiguous one with `BROWSER_JOURNEY_AMBIGUOUS`, both before any `Page.bringToFront`. A toolset without `context` refuses with `sN: tool not found: tabs`. Pinned by `follow > resolves a switch tab by URL and title from the tabs listing and refuses a missing or ambiguous tab before switching` and by the service case `resolves a switch by URL and title and matches the direct tab receipt`.
6. `follow` returns the action on `done` and on `interrupted`. On a timeout it throws a `BrowserStepError` that carries the emitted action. When the manager refuses before any handler, it throws a plain `BrowserError` with no action. `caller` carries the hold token, and without the token an action under a hold is refused. Pinned by:
   - `follow > returns an interrupted action, answers the dialog, and continues the pending input`
   - `follow > throws a BrowserStepError that carries the performed action when a step times out`
   - `follow > throws a plain BrowserError with no action when the manager refuses the call before any handler`
   - `follow > runs under a hold with its token, releases the hold after aborting its input, and sends no suffix action`
7. `parseBrowserTabLine` returns the id, title, URL, and current mark of a listing line. It returns `undefined` for a line without the URL, the id, or a JSON title. Pinned by the 2 cases in `tests/src/core/parsers.test.ts:41` and mutation `l1c`.
8. `BrowserReplay` runs every step through `this.#toolset.follow`. Evidence: `tests/src/core/BrowserReplay.test.ts` is green inside `test:src:core`, and the replay claims of `tests/service/journey.test.ts` are green.
9. `compileBrowserJourney` emits `await toolset.follow('sN', …)` per step. It imports only `createBrowserToolset`, plus the type import in TypeScript. The byte-equality evidence:
   - `BROWSER_JOURNEY_MODULE`, its JavaScript twin, and `BROWSER_JOURNEY_ACTION_MODULE` equal the output (`tests/src/core/compilers.test.ts`).
   - The guide's fence equals the output under the formatter comparison (`npm run test:guides`).
   - The design's § 6 fence is byte-equal to `BROWSER_JOURNEY_MODULE`, which `compilers.test.ts` holds equal to the output; a string comparison returned `True`.

   Mutation `l1b` reddens the module assertions.
10. The service proofs keep every assertion they had and are green on Chromium. One assertion is added in claim 3: no mouse input after the `follow` refusal. Counts: `tests/service/journey.test.ts` 32 passed, `tests/service/toolset.test.ts` 30 passed.

No `prove` tool is registered in this session, so every claim's closing line is `no receipt`. Each claim rests on the named tests, the failing-first run, and the mutation table.

Failing-first, before the implementation, with the tests written and the types declared:

```text
npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/parsers.test.ts -t "follow|parseBrowserTabLine|catches tabs or switch"
before: Tests 13 failed | 7 passed | 162 skipped (182)
after:  Tests 20 passed | 162 skipped (182)
```

The 13 failing tests:
- the 10 `follow` cases
- the 2 `parseBrowserTabLine` cases
- `views > catches tabs or switch advertised without a context, a switch that skips bringing the tab forward, or a tab list without the current mark`

## Mutations

The patches are in `tmp/codex/l1-mutations/`. Each was applied with `git apply`, run, and reverted with `git apply -R`.

| Mutation | Patch                                                                                                                                                                    | Command                                                                                                           | Result                     | Named failing assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l1a`    | `#resolveTarget` returns `target.reference` when present                                                                                                                 | `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts -t "follow"`     | 1 failed, 16 passed        | `follow > refuses ambiguity without trusting a stored reference or selector`: `toMatchObject` expected `BROWSER_JOURNEY_AMBIGUOUS` but received `BrowserStepError: s3: Element e1 is not i…`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `l1b`    | the compiler emits `await performBrowserStep(toolset, …)` and imports `performBrowserStep`                                                                               | `npx vitest run --config vite.config.ts --project src:core tests/src/core/compilers.test.ts`                      | 6 failed, 47 passed        | Each case pins the emitted call text: `emits the add-kettle module byte for byte in TypeScript`, `emits the JavaScript twin without the type import and the annotations, by default`, `renders every action's arguments, keeps a page tool's arguments literal, and drops the target evidence`, `requires a secret input and forwards it with secret: true and no literal fallback`, `throws at the first gap before the toolset starts, comments every gap at its position, and lists every gap in order`, `reads only an own input for a parameter that names an inherited member` |
| `l1c`    | the parser's URL group becomes optional (`("…")(?: (\S+?))?`) and a missing URL reads as `''`                                                                            | `npx vitest run --config vite.config.ts --project src:core tests/src/core/parsers.test.ts`                        | 1 failed, 18 passed        | `parseBrowserTabLine > refuses a line without the URL, the id, or a JSON title`: `toStrictEqual` of the undefined array                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

After each revert, `git diff --stat` for the file matched the unit's own change.

## Validation

All commands ran from the worktree root, and each output was read without a filter.

| Command                                                                                                    | Exit | Count                                         |
| ---------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| `npx oxfmt --config .oxfmtrc.json --check` over the 14 touched TypeScript files and `guides/browser.md`    | 0    | 15 files, all formatted                       |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 14 touched TypeScript files                  | 0    | no diagnostic                                 |
| `npm run check`                                                                                            | 0    | root, core, server, browser, and bin projects |
| `npm run test:src:core`                                                                                    | 0    | 50 files, 1174 passed                         |
| `npm run test:src:server`                                                                                  | 0    | 11 files, 243 passed                          |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts`                               | 0    | 70 passed                                     |
| `npm run build`                                                                                            | 0    | built                                         |
| `npm run test:service -- tests/service/journey.test.ts`                                                    | 0    | 32 passed                                     |
| `npm run test:service -- tests/service/toolset.test.ts`                                                    | 0    | 30 passed                                     |
| `npm run test:policy`                                                                                      | 0    | 114 passed, 1 skipped                         |
| `npm run test:guides`                                                                                      | 0    | 248 passed                                    |

The policy skip is `denylist currency > registers every substitution-table term as either matched or judged`. This unit does not touch it.

A control on the guide parity: changing the `follow` row's summary in `guides/browser.md` reddened `test:guides` with `summary BrowserToolsetInterface.follow: guide … source …` (1 failed, 247 passed). The guide was then restored.

## Deviations

Each deviation was settled inside the owned files and is recorded here. None stopped the unit.

1. **The step type is `BrowserJourneyStepInput`, not the brief's `BrowserJourneyStep`.** The generated module passes the id as the first argument, and its step literals carry no `id`. The `distribution` project type-checks the generated TypeScript module against the installed declarations, so `BrowserJourneyStep` would force a duplicate `id` into every emitted literal.
2. **The options type is `BrowserFollowOptions`, not the brief's `BrowserCallOptions`.** It extends `BrowserCallOptions` with `caller` and `secret`. A replay must pass its hold token; without it, `BROWSER_TOOLSET_BUSY` refuses every replayed action. The generated module passes `{ secret: true }` to a secret `type` step. `BrowserCallOptions` carries neither field.
3. **`BrowserTabLine` adds `id` to the brief's title, URL, and current mark.** `id` is the `tN` that `switch` takes. Reading it from the line keeps the removed function's behaviour instead of inferring it from the line's position.
4. **`follow` adds one refusal.** A target name that binds a parameter refuses with `BROWSER_JOURNEY_INPUT`: `Step sN binds its target name to parameter "X"; pass the name itself.`, with context `{ step, parameter }`. The cause is that the step type admits a binding, and `follow` holds no inputs to resolve one. The guide's Errors row names `follow`.
5. **Some service direct sides use `requireBrowserJourneyElement` instead of `follow`.** This applies where a service proof called `locateBrowserTarget` only to get a reference for a direct `tools.execute` or `perform` call: the `toolset.test.ts` equality cases and the claim 6 hold cases. The helper in `tests/setup.ts` is an exact-name `elements.find`. `follow` performs the action, and a direct side must stay a plain tool call (design § 14: "resolves the direct side's element through `elements.find` with `exact: true`"). Every refusal assertion and every replay-side call uses `toolset.follow`.
6. **The design still names the two functions in four history places:**
   - the § 12 unit rows J2 and J4
   - the § 13 ruled-findings row
   - the § 14 ruling sentence "`performBrowserStep` and `locateBrowserTarget` leave `helpers.ts` …"

   These record units and rulings, as the ledger does. The § 1, § 2, and § 4 sentences that named the functions now read `follow`, along with § 6 and § 14.
7. **`oxfmt --check` did not cover `.orkestrel/browser/journeys-design.md`.** The formatter's ignore rules exclude `.orkestrel/`: run on that file alone, it exits 2 with `Expected at least one target file`.
8. **`l1b` reddens six compiler cases, not one.** Each of them pins the emitted call text, and all six are named in the mutation table.
9. **Claims carry no `prove` receipt.** No `prove` tool is registered in this session, so each closing line is `no receipt`.
