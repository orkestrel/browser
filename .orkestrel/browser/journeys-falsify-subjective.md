# Falsify report: reconciled journeys proposal, SUBJECTIVE lane (Opus `reviewer`; delivered by hand-back, transcribed verbatim by the Orchestrator)

**Lane.** This report covers API shape and names, guide voice, developer and model ergonomics, fit with the toolset vocabulary and the `orkestrel-journey` skill, and the cut of the units. Correctness under adverse orderings, the store's atomicity, and the secret's path are referred to the objective lane.

**Paths.** R is `tmp/units/journeys/design-reconciled.md` (the first revision, kept as `journeys-design-reconciled-v1.md`) and S is `journeys-design-subjective.md`.

## 1. Verdicts

1. BROKEN. A refusal can carry no target (`click {ref:'e99'}` fails in `#element` before any element exists); the emitting set is undefined (invariant 7 records `wait`, annotated `pure` like `look`, `read`, `tabs`, and § 4 lets observations pass the hold). Name the emitting set and state that `wait` emits `action`.
2. UNRESOLVED. J3's tests settle it; `frame` is added to the shared `BrowserElementQuery` but DOM elements carry no `frame` (`BrowserElementInterface` lacks it; only `BrowserPageElementInterface` has it).
3. BROKEN. Record in context A (one button "Delete" at `e7`); replay from a later process in context B with two "Delete" buttons: references are per-context counters (guide invariant 15), B's capture can mint `e7` onto the second "Delete", and the reference-first step clicks it `via: 'reference'`. Delete step 1; keep `reference` as evidence (O1).
4. BROKEN. `BrowserJourneyTarget` requires `role` and `name`, so a CSS-only target cannot exist; strike the clause; keep role and exact name required because § 9 rules CSS out as a primary target.
5. UNRESOLVED. The service comparison settles it; `#element` accepts any reference the manager holds, so a reference minted by `find` is executable through `tools.execute`.
6. UNRESOLVED. Two seams unnamed: caller identity (`ToolContext.caller` is forwarded without verification) and whether the `replay` tool's handler takes a queue turn (S T6). Name the key and state that `replay` takes no turn.
7. UNRESOLVED. Depends on claim 1's emitting set including `wait`.
8. BROKEN. Preparation refuses "a tool the toolset does not advertise": `dialog` is staged only while a dialog is open, and an adopted page tool is advertised only after its page loads, so `[click "Delete", dialog {accept:true}]` and a page-tool step on a later page are refused. Preparation checks what the placement can run; page-tool steps are checked when reached.
9. UNRESOLVED. Unit cases settle purity and the revision refusal; shape defects in O9.
10. UNRESOLVED. Referred to the objective lane; no store interface is declared (O2).
11. UNRESOLVED. The J0 probe settles it; `type` takes one `text` string so "type with the values" has no shape; the page recorder has no step form for a person's answer to a native dialog.
12. UNRESOLVED. Referred; the `type` receipt quotes the typed text and `tools.execute` has no channel that marks an argument secret.
13. BROKEN. The fence calls `.type(text, { submit: true })`, which `BrowserElementInterface` lacks (`fill`, `select`, `submit` exist); the type-and-submit step has no settlement block; the two ladders differ (the resolver lacks the reference step). Map `type` to `fill` or `select([text])` for `combobox`/`listbox`; map `submit` to `element.submit()` inside the record block; apply O1.
14. UNRESOLVED. The owner's package ruling settles it; R registers the browser package's bin while recommending `@orkestrel/browse`.
15. UNRESOLVED. The run settles it, but the measure omits `record`, `save`, `add`, `update`; a lone `remove` of the only binding step violates "every declared name is bound"; `input: undefined` cannot travel as JSON. Widen the task list.

## 2. Findings on the rulings and the shape

- O1 (blocking): the reference-first ladder step conflicts with guide invariant 15 and with the resolver; delete it.
- O2 (blocking): § 2 declares data types only: no recorder interface, replay options, action record members, `journeys` option type, `BrowserElementQuery` and `BrowserToolName` additions, or store methods; the point-access store shape is `get`, `set`, `delete` but deletion is "an operator's act"; one store keeps journeys and runs; the route for capture bytes is unstated (guide invariant 4).
- O3 (required): two page entries for one recorder (`page.recorder()` and `page.codegen()`); keep `page.codegen()` as the only entry, extending the shared recorder interface with `script()`; move the class to `src/core/recorders/`.
- O4 (required): the generated module's `run` is a synonym of `execute` (names.md); the fence types neither `page` nor `inputs`; `record.destroy()` sits outside a `finally`. Export `execute(page, inputs)` with a secret required and defaults optional; `const target = await …`; `try … finally`.
- O5 (required): `resolve*` means "picks the effective value from options and defaults" and `resolvers.ts` is not a kind file; name it `locateBrowserTarget` in `helpers.ts`.
- O6 (required): parsers refuse instead of returning `undefined`; add `validateBrowserJourney(value): asserts` following `validateBrowserHAR`.
- O7 (required): `BrowserJourneyInput` misuses the creation-input suffix (rename `BrowserJourneyParameter`); the `Record` suffix on plain data beside the behavioural `BrowserNavigationRecord` (use `BrowserJourneyRevision`, `BrowserRun`, `BrowserAction`); `BrowserRunRecord.run` is an id (`id`).
- O8 (required): `format: 'strings'` binds to no tool (no `select` tool; `type` takes one `text`); drop `strings`; a multi-select change becomes `unresolved`; the `format` field then goes.
- O9 (required): `operation: 'input'` breaks the verb set and `input: undefined` cannot travel as JSON; the invariant refuses a lone `remove` of the only binding step; `update` does not say replace or merge. Drop unbound inputs after the batch; `declare` adds or replaces; `update.arguments` merges by key.
- O10 (required): a model must write targets by hand under invariant 3; the `edit` tool accepts `ref` and converts it from the current view.
- O11 (required): `journeys` has no continuation parameter; the listing text is unspecified. Add `offset`; adopt S's listing with `as NAME` and `NAME (secret)`.
- O12 (required): refusal voice copies toolbox's lowercase fragment; the toolset's refusals are sentences ending with `call TOOL`.
- O13 (required): the `compile` tool contradicts "separate from the browse tooling" and needs a module-writing seam; drop it; a developer calls `compileBrowserJourney` in Node.
- O14 (required): the default for a replay's inner actions silently drops the inner journey's page effects; including them copies substituted values; refuse `replay` while recording; record an inner replay as one `unresolved` step unless told to include it; refuse inclusion for a journey with a secret.
- O15 (required): `target.frame` is a CDP frame id, not portable; defer it or carry a portable description.
- O16 (required): guide invariants 2, 4, 6, 9, 18, 21 retired or amended without a ruling table.
- O17 (required): J11 cites the wrong section of S, deletes the codegen pattern the owner kept, adds a CLI interface R rules out; carry the guide's list in J11.
- O18 (required): J6 (`opus`) owns the Chromium-probed page recorder engine (route to `astra`); J8 (`builder`) covers atomic writes and containment (route to `astra`); the file store stays in `@orkestrel/browser/server` in either home; J9 is cut for the home R does not recommend.
- O19 (required): acceptance criteria that no one can check mechanically (J1's name list, J7's refusal wording, J11's invariant rulings, J12's policy gate).
- O20 (required): the skill verb map leaves `type` with two options; map it to `fillAccessible`; refuse `combobox`/`listbox`, `navigate`, `switch`, `dialog`, page tools.
- O21 (optional): "keeps the guarantee" violates writing.md.
- O22 (optional): `started` collides with the boolean `started`; `reason` has two meanings; `BrowserRunOutcome` mixes step and run states; `tool` and `action` name one fact.
- O23 (optional): repeated per-row controls fail late; the recorder can check uniqueness at record time.
- O24 (optional): the `{ input }` binding collides with a page tool's object argument.

## 3. Attacked and held

Verbs as tools over one operation tool (on vocabulary fit; the comparative reason overclaims); inline bindings with declared inputs; codegen emitting a readable module rather than a runner invocation (the owner's ruling); the `action` event as the one structured source; the producer-minted run id under `runs/`; the separate `@orkestrel/browse` package (zero unsolicited dependencies, the server's import set, mechanism not policy, the release layers), with the file store staying in browser; the deferred boundaries; the names `replay`, `execute`, `via`, `journeys` with `what`, `sN`, the `create*`/`edit*`/`render*` forms, `readonly`, `BROWSER_TOOLSET_BUSY`; `page.codegen()` and `compileBrowserJourney` as names.

VERDICT: FAIL 1, 3, 4, 8, 13; outside the claims: O1–O20
