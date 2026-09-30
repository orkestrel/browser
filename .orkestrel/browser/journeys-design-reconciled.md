# Browser journeys: the reconciled proposal (2026-09-30)

Reconciled by the Orchestrator from the objective design (`journeys-design-objective.md`), the subjective design (`journeys-design-subjective.md`), the toolbox terrain (`journeys-toolbox-terrain.md`), and two owner rulings given in the session: codegen stays as the capability that emits a JavaScript or TypeScript file a developer runs as is or customizes, separate from the browse tooling and in step with it; and toolbox's store and tool patterns are prior art for what worked and what did not. Every claim in § 10 is numbered for the falsify round.

## 1. The design in one paragraph

A journey is one user intent as JSON: a name, a description, declared inputs, and steps that mirror the toolset's own tool calls, each step naming its target by role and exact accessible name with the record-time reference and a CSS selector kept beside them. One recorder produces the steps from three sources (the toolset's actions, a person's input on a page, a hand-written file), and two artifacts derive from them: the journey file, which a model records, lists, edits, and replays through tools on the same manager as `look` and `click`, and a generated module, which codegen compiles from the same steps into readable calls over the public page and element contracts for a developer. Replay resolves each target on the live page, refuses ambiguity, and executes every step through the toolset's own tools, so settlement, dialogs, receipts, and the queue are the toolset's; it stops at the first failed step and writes a run record under `tmp/browsers/<journey>/runs/<run>/`. A file store with revisions, atomic writes, containment, paging, and typed corruption errors keeps journeys and runs; a memory twin serves core and tests. A `browse` binary serves the toolset and the journey tools over MCP on stdio like probe's binary. The `orkestrel-journey` skill reads a run's steps and output as it reads a journal, and a proposal to scaffold names the shared vocabulary.

## 2. The journey data model

All types live in `src/core/types.ts` under `// === Browser journeys`, which replaces `// === Browser codegen`; the codegen types that survive are named in § 6.

```ts
/** A literal argument value, or a binding to one declared input by name. */
export type BrowserJourneyBinding<T> = T | { readonly input: string }

/** Declares one input a journey takes: its shape, its default, and whether it is a secret. */
export interface BrowserJourneyInput {
	readonly format: 'text' | 'strings'
	readonly default?: string | readonly string[]
	readonly secret?: boolean
}

/** Names the element a step acts on the way a receipt names it, with a fallback and the record-time evidence. */
export interface BrowserJourneyTarget {
	readonly role: string
	readonly name: BrowserJourneyBinding<string>
	readonly css?: string
	readonly reference?: string
	readonly frame?: string
}

/** One call of a toolset tool, with its target named as data; `ref` is never an argument. */
export interface BrowserJourneyStepInput {
	readonly tool: string
	readonly arguments: Readonly<Record<string, BrowserJourneyBinding<unknown>>>
	readonly target?: BrowserJourneyTarget
	readonly reason?: string
}

/** A step with its identity: `s` followed by a positive integer, stable across edits. */
export interface BrowserJourneyStep extends BrowserJourneyStepInput {
	readonly id: string
}

/** One user intent as data. */
export interface BrowserJourney {
	readonly format: 1
	readonly name: string
	readonly description: string
	readonly inputs: Readonly<Record<string, BrowserJourneyInput>>
	readonly steps: readonly BrowserJourneyStep[]
}

/** A stored journey with the revision the store assigned. */
export interface BrowserJourneyRecord {
	readonly journey: BrowserJourney
	readonly revision: number
}

export type BrowserJourneyEdit =
	| { readonly operation: 'add'; readonly step: BrowserJourneyStepInput; readonly before?: string; readonly after?: string }
	| { readonly operation: 'remove'; readonly id: string }
	| { readonly operation: 'update'; readonly id: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding<unknown>>>; readonly target?: BrowserJourneyTarget; readonly reason?: string }
	| { readonly operation: 'input'; readonly name: string; readonly input: BrowserJourneyInput | undefined }
```

Rulings behind the shape:

- Inputs are declared at the journey level and bound inline in argument position (the objective lane's shape), because a secret input has no default and the listing must show a model what each input is; the subjective lane's derivation from the steps cannot express a secret. Invariant: every bound name is declared, and every declared name is bound by at least one step.
- `target.frame` names the frame the element belongs to (the toolset's elements carry `frame` since C6); shadow-root and region boundaries are deferred to a later unit that first gives the element managers a portable boundary description (§ 12).
- `tool: 'unresolved'` with a `reason` is the gap step the objective lane names: the page recorder emits it for a gesture it cannot express, and replay refuses it at preparation.
- `format: 1` and the store's `revision` follow toolbox's missing-revision lesson: a lost update is detectable and an old file is refused with a typed error, never read as absent.

Invariants:

1. `name` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and has at most 64 characters; it is the directory name.
2. Step ids are unique; an added step takes one more than the highest id the journey holds; ids never renumber.
3. `target` is present exactly when the tool takes `ref`; `arguments` never carries `ref`.
4. Every `{ input }` binding names a declared input whose `format` matches the argument (a string argument binds a `text` input; `select`'s values bind `strings`).
5. A secret input has no default; the recorder never stores the typed value, and a run record writes the input's name in its place.
6. `parseBrowserJourney(JSON.parse(JSON.stringify(journey)))` equals `journey`; an unknown `format` is refused with `BROWSER_JOURNEY_FORMAT`.
7. The recorded tools are `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, and adopted page tools; `look`, `read`, and `tabs` are never steps.

The directory layout under `tmp/browsers` (one file per entry, per toolbox's lesson; captures beside the run record, never inside JSON):

```text
tmp/browsers/
  add-kettle/
    journey.json               { revision, journey }
    journey.ts                 the compiled module, when compile wrote one
    runs/
      2026-09-30T14-03-12-481Z-7f3a/
        run.json               the BrowserRunRecord
        s1.png s2.png …        one capture per step in the page placement
```

## 3. Recording

One recorder contract, three sources:

- **The toolset's actions.** The toolset emits an `action` event after every action tool call, success or refusal, carrying the structured receipt (`BrowserActionRecord`: the tool, the arguments without `ref`, the target's role, exact name, reference, and frame captured before the input was dispatched, the outcome, the settlement stage and reason, the receipt text). `createBrowserRecorder(toolset)` turns successful actions into steps and assigns ids; a refused call, `look`, `read`, `tabs`, and the journey tools themselves are never steps; a replay's inner actions are steps of the outer recording only when the recorder is told to include them.
- **A person's input on a page.** `page.recorder()` replaces the codegen binding's four CSS actions: it keeps the in-page listener and the runtime binding, reads the role and exact accessible name of the node the person acted on, and emits journey steps: a click becomes `click`, a committed field edit becomes `type` (consecutive edits on one field collapse while the edit is open and never across a submission), a select change becomes `type` with the values, Enter in a field becomes `press`, a navigation the gesture caused is settlement evidence and not a `navigate` step, and a gesture it cannot express becomes `unresolved` with the reason.
- **By hand.** A `journey.json` file or a `BrowserJourney` literal, validated by `parseBrowserJourney`.

Never recorded: observations, refused calls, prompts or answers, raw events, cookies or storage, a secret's value.

## 4. Replay

`createBrowserReplay(toolset, journey, options).execute(call)`:

1. Preparation, before any side effect: parse the journey, apply `options.edits` to a copy, merge `options.inputs` over the declared defaults, refuse a missing or unknown input, a format mismatch, an `unresolved` step, or a tool the toolset does not advertise; the stored journey is untouched.
2. Hold the toolset: while a replay executes, another caller's action tool call is refused with `BROWSER_TOOLSET_BUSY` (observations pass), so no foreign action interleaves between steps.
3. For each step in order: resolve the target, execute the tool through `toolset.tools.execute({ name, arguments: { ...substituted, ref } })` with the call's signal, read the structured `action` record the toolset emitted for that call, append a `BrowserRunStep`, capture in the page placement, and stop after the first step whose outcome is not `done`.
4. Release the hold, write the run record through the store when one is given, and resolve with the `BrowserRunRecord`; `execute` rejects only on abort or a destroyed toolset.

Target resolution, in order, each refusing ambiguity rather than choosing:

1. The recorded reference, only when the toolset's current view still holds it and its role and exact name match (`via: 'reference'`).
2. `elements.find({ role, name, exact: true, frame })` with exactly one match (`via: 'role'`); several matches refuse with `BROWSER_JOURNEY_AMBIGUOUS` naming the count.
3. `elements.find({ css, frame })` with exactly one match whose role and name equal the recorded ones when the step carries them (`via: 'css'`); a match with another role or name refuses.
4. No match refuses with `BROWSER_JOURNEY_TARGET`, naming the role and name and the next calls (`call look, then edit NAME`).

Outcome judgement uses the structured record, never the receipt text: a `wait` whose text did not appear is a failed step even though its receipt is a sentence; a `requested` or `committed` settlement stage after the last step is reported and stops the run before a following action.

The run record:

```ts
export type BrowserRunOutcome = 'done' | 'refused' | 'timeout' | 'stopped' | 'aborted'

/** One replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's `JournalStep` fields. */
export interface BrowserRunStep {
	readonly id: string
	readonly action: string
	readonly trigger: string
	readonly arguments: Readonly<Record<string, unknown>>
	readonly via?: 'reference' | 'role' | 'css'
	readonly outcome: BrowserRunOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly result: string
	readonly capture?: string
	readonly elapsed: number
}

export interface BrowserRunRecord {
	readonly format: 1
	readonly journey: BrowserJourney
	readonly revision: number
	readonly run: string
	readonly inputs: Readonly<Record<string, string | readonly string[]>>
	readonly steps: readonly BrowserRunStep[]
	readonly outcome: BrowserRunOutcome
	readonly output?: readonly string[]
	readonly started: string
	readonly elapsed: number
}
```

A run id is minted by the producer (`<ISO time with - for :>-<4 hex>`), never derived from the name, so repeated runs accumulate (toolbox's workflow snapshots overwrote). The DOM placement (`createDocumentToolset`) replays the supported subset with `(untrusted event)` receipts and no captures; a step it cannot execute is refused at preparation, before any side effect.

## 5. Editing

`editBrowserJourney(journey, edits)` is pure and atomic: it applies the list in order to a copy, and any invalid edit (an unknown id, a duplicate insertion anchor, an `update` that removes the target of a `ref`-taking tool, a binding to an undeclared input, an `input` removal while a step still binds it) refuses the whole batch with `BROWSER_JOURNEY_EDIT` naming the edit's index and the reason. The store's `set` takes the expected revision and refuses a mismatch with `BROWSER_JOURNEY_REVISION`, so two editors cannot lose each other's work. The `edit` tool reads the current record, applies the batch, and sets with the read revision.

## 6. Codegen

Codegen stays a capability of the package and gains the journey's vocabulary; the owner's ruling is the rule: one recorder, two artifacts, each usable without the other.

- `page.codegen()` keeps its meaning: it records a person's input on the page and emits code. It is the page recorder of § 3 with a compiler attached, so `codegen.script({ language })` returns the module for the steps recorded so far; `BrowserCodegenLanguage` is kept. The four CSS actions and `compileCodegenScript` over them are retired.
- `compileBrowserJourney(journey, { language })` emits a standalone module from any journey: `export async function run(page, inputs)`, one readable statement group per step over the public contracts, with no dependency on the browse tooling, the replay, or the store:

```ts
import { resolveBrowserTarget } from '@orkestrel/browser'

export async function run(page, inputs = {}) {
	await page.navigate('https://shop.example.test/')
	{
		const record = page.navigation.record(page.id)
		await (await resolveBrowserTarget(page, { role: 'link', name: 'Alpine Kettle' })).click()
		await record.settle({ timeout: 5000 })
		record.destroy()
	}
	await (await resolveBrowserTarget(page, { role: 'textbox', name: 'Email' })).type(inputs.email ?? 'sam@example.test', { submit: true })
	await page.wait('Added to cart', { timeout: 5000 })
}
```

- `resolveBrowserTarget(view, target, options)` is one exported helper that runs the same ladder as § 4 (role and exact name, then CSS with the check), so a generated module and a replay resolve the same way; a developer who customizes the file keeps the guarantee or replaces the helper.
- A step codegen cannot express as a public call (`dialog`, `switch`, an adopted page tool) is emitted as a commented placeholder naming the step, and the compiler's result lists them; it never emits code that silently skips a step.
- The `compile` tool and `browse` write `tmp/browsers/<name>/journey.ts` (or `.js`) beside the journey.

## 7. The MCP surface and the browse binary

The toolset advertises the journey tools only when constructed with `journeys: { store, readonly?, captures? }`; each declares one required parameter; the copy lives in `BROWSER_TOOL_COPY`; a page tool with a reserved name is skipped as today.

| Tool | Parameters | Result | Refusals |
| --- | --- | --- | --- |
| `record` | `journey` (string, required) | `Recording NAME; each action you take is a step; call save when it is done.` and the view | a saved name; a recording in progress; `readonly` |
| `save` | `description` (string, required) | `Saved NAME with N steps.` and the listing | no recording; `readonly`; a store failure fails the call (persist before publish) |
| `journeys` | `what` (string, required) | the listing of every journey with its inputs and steps, paged with a truncation line | none |
| `edit` | `journey` (string, required), `edits` (array, required) | `Edited NAME.` and the listing | an unknown journey; the edit refusal naming the index; a revision mismatch; `readonly` |
| `replay` | `journey` (string, required), `inputs` (object) | `renderBrowserRun`: one receipt line per step and the final view, or the stop line naming the step, the reason, and the next calls | an unknown journey; a missing input; a busy toolset |
| `compile` | `journey` (string, required), `language` (string) | `Compiled NAME to journey.ts.` and the module text, bounded | an unknown journey |

Rulings: verbs as tools rather than one operation-discriminated tool, because the store proof's evidence for this model is one tool per verb with a required parameter; every refusal names the offending value and the alternatives (`unknown journey "checkout"; saved journeys: add-kettle, signup`); `readonly` gates `record`, `save`, and `edit` before any store access; the tool context's signal reaches every store call and step; a deleted journey is an operator's act on the directory.

The binary follows probe's: `bin: { browse: dist/bin/main.js }`, `src/bin/main.ts` starts the server and exits 1 on a coded error, registration through `.mcp.json` with `node node_modules/@orkestrel/browser/dist/bin/main.js`, no command-line commands (a script or a skill drives it through an MCP client, as probe is driven). The server launches or attaches Chromium lazily at the first tool that needs a page, so `tools/list` answers without a browser; it serves one page and one toolset with `context` and `journeys`; it owns the browser it launched and never attaches to another client's targets without `--port`.

The package question: the binary needs `@orkestrel/mcp` at run time. Two homes are possible: inside `@orkestrel/browser` (mcp becomes a runtime dependency and the package moves to layer 5, and every library consumer installs the MCP stack), or a separate `@orkestrel/browse` package (layer 5, depending on browser and mcp, holding the binary, the file store, and the server) with the journey core in `@orkestrel/browser`. The Orchestrator recommends the separate package, which is probe's own structure, and asks the owner to rule; the units are cut so the server-side pieces move without change.

## 8. The `orkestrel-journey` alignment

Shared: `journey` (one intent), `step`, the `action`, `trigger`, `result` fields, `output`, role and exact accessible name, `trusted`. Distinct: the skill's `record` appends a journal line while the browser's records steps to replay; the skill's `journal` is a run log while the browser's run record is a replay; `capture` is a portfolio under `tmp/captures` for the skill and `sN.png` in a run for the browser. The proposal to scaffold: a `references/recorded.md` in the skill (record with the browse server, replay, read a run's `steps` and `output` into the variant artifact, a step resolved `via: 'css'` as a population finding, the verb mapping `click` to `clickAccessible`, `type` to `typeAccessible` or `fillAccessible`, `press` to `pressKeys`, `wait` to `waitForText`), one bullet in `decide.md`, a `tmp/browsers` row in the orchestration layout, and the `.mcp.json` wiring. A trusted-input execution adapter over `@orkestrel/test/browser`'s verbs is a later unit that needs the owner's dependency ruling.

## 9. Alternatives ruled out

- References or CSS as the primary target: a reference belongs to a session; CSS cannot see ambiguity or a renamed control.
- A model repairing targets at replay: it can redirect a consequential action; a changed target is an explicit edit.
- Every observed navigation as a step: it repeats effects and turns a POST result into a GET.
- Retrying or resuming a failed action: input may have reached the application (two orders in v8–v10).
- Parsing receipt sentences for decisions: wording is presentation.
- A workflow language (branches, loops): an editable recorded sequence is inspectable; a program is codegen's job.
- A second coordinator extracted from the toolset (the objective lane's): replay calls the toolset's tools, so the toolset is the coordinator; the `action` event exposes its facts.
- Command-line subcommands in the binary (the subjective lane's): probe's model is MCP only; a client drives it.
- `@orkestrel/database` in the browser package: toolbox never exercised its JSON driver, its queries scan, and a journey is one small document; a point-access store with a memory and a file twin suffices.
- A single-file store (one JSON for every journey): a write would rewrite every entry, toolbox's driver shape.
- A run keyed by the journey name: reruns would overwrite.

## 10. Load-bearing claims

1. The toolset's `action` event carries the target's role, exact name, reference, and frame captured before the input is dispatched, and the outcome, stage, reason, and receipt after settlement, for every action tool call including refusals; the existing settlement cases are unchanged.
2. `elements.find({ role, name, exact: true })` matches the whole normalized accessible name in both placements, and `frame` scopes the search; the existing substring matching is unchanged for callers that do not pass `exact`.
3. On a page whose ids, classes, and order changed between record and replay, a uniquely named control resolves by role and exact name without input reaching another element; a duplicated name refuses before any input (Chromium probe).
4. A CSS fallback that matches an element with another role or name refuses; a CSS-only target with two matches refuses.
5. Replay executes every step through `toolset.tools.execute`, so the settlement stage, reason, receipt wording, dialog handling, and the changed note equal those of a direct tool call over the same fixture, and no step executes after a failure.
6. The hold refuses another caller's action during a replay and releases on every exit, including abort.
7. A `wait` whose text did not appear is a failed step judged from the structured record while its receipt text is unchanged.
8. Preparation refuses before any side effect: a missing input, an unknown input, a format mismatch, an `unresolved` step, an unknown tool; a page event counter stays at zero after every refusal.
9. `editBrowserJourney` is pure and atomic, and `set` with a stale revision refuses; two editors cannot lose an update.
10. The file store writes through a sibling temporary file and rename, refuses a name outside the pattern, resolves `undefined` only for an absent file, refuses a corrupt or old-format file with a typed error naming the path, lists with `limit` and `offset` and a truncation flag, and serializes writes per name; one conformance suite passes over the memory twin and the file twin, including a reopened path and a truncated file written to disk.
11. The page recorder emits one step per gesture with role and exact name, collapses field edits only while the edit is open, records a navigation the gesture caused as evidence and not as a step, and emits `unresolved` for a gesture it cannot express (Chromium probe with an independent fixture event log).
12. A secret's value never reaches `journey.json`, `run.json`, the listing, or a receipt; the input's name stands in its place.
13. `compileBrowserJourney` over a journey and `createBrowserReplay` over the same journey produce the same page outcome on independently reset fixtures, and a mutation that removes a step's call from the generated module fails the outcome assertion; a generated module runs with only `@orkestrel/browser` imported.
14. The `browse` binary, packed and spawned through the mcp package's stdio client, lists its tools before Chromium starts, then records, saves, edits, replays, and compiles; its runs land under `tmp/browsers/<name>/runs/` and nowhere else; EOF and SIGTERM release the browser it launched.
15. The store proof's model can call `journeys`, `replay` with an input, and `edit` with a `remove`, judged by page state and the store's files, not by its answer.

## 11. Units (dependency order; the lane per `.agents/orchestration.md` § Routing)

| Unit | Lane | Owns | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| J0 probe | `opus` | `tmp/probes/journeys/*.test.ts`, its logs, `tmp/units/journeys/probe-report.md` | none | claims 3, 4, 11 read twice on Chromium 141 with tapes; the readings appended to the brief before J5 and J7 |
| J1 types | `opus` | `src/core/types.ts` (the journey, recorder, run, store, toolset, query, page, codegen members), `src/core/constants.ts` (patterns, codes, copy), `src/core/errors.ts` | none | `check` green; TSDoc per `typescript.md`; every name one word |
| J2 leaves | `astra` | `src/core/parsers.ts` (`parseBrowserJourney`, `parseBrowserJourneyEdit`), `src/core/helpers.ts` (`editBrowserJourney`, `renderBrowserJourney`, `renderBrowserRun`, the run id), `src/core/validators.ts`, their tests | J1 | claims 8 (the pure part), 9, 12 (the render part) |
| J3 exact query | `astra` | the two element managers, their tests | J1 | claim 2 in both placements |
| J4 toolset action event and hold | `astra` | `src/core/BrowserToolset.ts`, its tests, `tests/setup.ts` | J1 | claims 1, 6, 7 |
| J5 recorder, replay, memory store, resolver | `astra` | `src/core/recorders/BrowserToolsetRecorder.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/MemoryBrowserJourneyStore.ts`, `src/core/resolvers.ts` (`resolveBrowserTarget`), `src/core/factories.ts`, their tests | J2, J3, J4, J0 | claims 3, 4, 5, 8, 10 (the memory twin), 12 |
| J6 codegen and compile | `opus` | `src/core/compilers.ts` (`compileBrowserJourney`), `src/core/BrowserCodegen.ts` (the page recorder with the compiler; the CSS engine retired), `src/core/BrowserPage.ts` (`codegen()`, `recorder()`), the recorder source constant, their tests | J5, J0 | claims 11, 13 |
| J7 journey tools | `opus` | `src/core/BrowserToolset.ts` (the `journeys` option and six handlers), `src/core/constants.ts` (copy), `src/browser/factories.ts`, their tests | J5, J6 | the table in § 7; every refusal's wording; `readonly`; the signal |
| J8 file store | `builder` | `src/server/stores/FileBrowserJourneyStore.ts`, `src/server/factories.ts`, `src/server/constants.ts`, its tests | J2 | claim 10 (the file twin) with the shared conformance suite |
| J9 binary | `opus`, after the owner's package ruling | `src/bin/main.ts`, `src/server/BrowserMCPServer.ts`, `package.json` (`bin`, `files`, the mcp range), the bin config, `tests/src/bin/` | J7, J8 | claim 14 |
| J10 service proofs and the store-proof rerun | `astra`; the consumer run in `/home/user/ollama` | `tests/service/journey.test.ts`, `tests/service/browse.test.ts`, `tests/setupServer.ts` variants as a patch; the ollama store proof gains a journey task | J5–J9 | claims 3–7, 11, 13, 15 on Chromium 141, three service runs |
| J11 guide and README | `opus` | `guides/browser.md`, `README.md`, `tests/guides.test.ts` | J1–J10 | `test:guides` green; the sections § 8 of the subjective design lists; invariants kept or retired as ruled |
| J12 scaffold proposal | `opus`, in the scaffold checkout with the owner's consent | the skill reference, `decide.md`, the orchestration layout row, the wiring | J9, J11 | scaffold's policy gate green |
| J13 falsify | Opus `reviewer` and Astra `analyst` | evidence only | J1–J11 | one round over the numbered claims |
| J14 verify | `verifier` | evidence only | J13 | the gates bare |

Shared files (`types.ts`, `constants.ts`, `helpers.ts`, `BrowserToolset.ts`, barrels) are edited by one unit at a time in the order listed; a later unit's patch to a shared file is reported and integrated by the Orchestrator.

## 12. Unresolved

- The binary's package (§ 7): the owner rules.
- Shadow-root and region boundaries in a target: deferred until the element managers describe a boundary path; `frame` ships.
- A trusted-input execution adapter over `@orkestrel/test/browser` and a `BASE_DEV_DEPENDENCIES` entry for the browser package: the owner rules on the dependencies.
- Page output in the DOM placement: a consumer-supplied source or "unavailable"; no production console override.
- The store proof's measure of the six journey tools' cost for a 2-billion-parameter model: claim 15's run settles it.
- Whether a replay's inner actions enter an outer recording by default: the recorder option defaults to excluding them; the falsify round attacks the default.
