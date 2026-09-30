# Browser journeys: the reconciled proposal, second revision (2026-09-30)

Revised by the Orchestrator after the first falsify round (`journeys-falsify-objective.md`, `journeys-falsify-subjective.md`) over the first revision (`design-reconciled-v1.md`). Every finding of both audits is ruled in § 13. The owner's rulings stand: codegen stays as the capability that emits a JavaScript or TypeScript module a developer runs as is or customizes, separate from the browse tooling and in step with it in capability; toolbox's patterns are prior art. Claims in § 10 are renumbered for the second round.

## 1. The design in one paragraph

A journey is one user intent as JSON: a name, a description, declared parameters, and steps that mirror the toolset's own tool calls, each acting step naming its element by role and exact accessible name with a CSS selector and the record-time reference kept beside them as evidence. One recorder contract produces steps from three sources: the toolset's actions through the `action` event the toolset emits for every admitted action call, a person's input on a page through `page.codegen()`, and a hand-written file. Two artifacts derive from the same steps: the journey file, which a model records, lists, edits, and replays through five tools on the same manager as `look` and `click`, and a generated module, which `compileBrowserJourney` emits as readable calls over the public page and element contracts for a developer. Replay prepares the whole run before its first side effect, holds the toolset, resolves each target on the live page by role and exact name, refuses ambiguity, executes every step through the toolset's own tools, judges each step from the structured action record, stops at the first step that did not complete, and writes a run under `tmp/browsers/<journey>/runs/<id>/`. A journey store and a run store keep the files with revisions, atomic writes, per-name locks, containment, paging, and typed corruption errors; memory twins serve core and tests. A `browse` binary serves the toolset and the journey tools over MCP on stdio like probe's binary, in a separate `@orkestrel/browse` package if the owner agrees. The `orkestrel-journey` skill reads a run's steps and output as automation evidence, and a proposal to scaffold names the shared vocabulary.

## 2. The journey data model

All types live in `src/core/types.ts` under `// === Browser journeys`, which replaces `// === Browser codegen`; § 6 names the codegen types that survive.

```ts
/** A JSON value: what a journey file, a run file, and a page tool's arguments can carry. */
export type BrowserJSONValue =
	| string | number | boolean | null
	| readonly BrowserJSONValue[]
	| { readonly [key: string]: BrowserJSONValue }

/** A string argument of a native tool: a literal, or a binding to one declared parameter by name. */
export type BrowserJourneyBinding = string | { readonly input: string }

/** Declares one parameter a journey takes: its default, or none when it is a secret. */
export interface BrowserJourneyParameter {
	readonly default?: string
	readonly secret?: boolean
}

/** Names the element an acting step acts on the way a receipt names it, with the fallback and the record-time evidence. */
export interface BrowserJourneyTarget {
	readonly role: string
	readonly name: BrowserJourneyBinding
	readonly css?: string
	readonly reference?: string
}

/** Names the tab a `switch` step moves to, portably. */
export interface BrowserJourneyTab {
	readonly url: string
	readonly title: string
}

/**
 * One step before it holds an id: a call of a toolset tool with its element or tab named as data.
 *
 * @remarks
 * - `action` — `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, a page tool's name, or `unresolved`
 * - `arguments` — the call's arguments without `ref` or `tab`; a native tool's string arguments can bind a parameter, a page tool's arguments are literal JSON
 * - `target` — present exactly when the action takes `ref`; `tab` — present exactly for `switch`
 * - `secret` — on `type`, the typed text is a secret parameter and never appears in a file, a receipt, or a listing
 * - `gap` — on `unresolved`, why the recorder could not express the gesture; replay refuses the journey at preparation
 */
export interface BrowserJourneyStepInput {
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>
	readonly target?: BrowserJourneyTarget
	readonly tab?: BrowserJourneyTab
	readonly secret?: boolean
	readonly gap?: string
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
	readonly parameters: Readonly<Record<string, BrowserJourneyParameter>>
	readonly steps: readonly BrowserJourneyStep[]
}

/** A journey as the store holds it, with the revision the store assigned; `revision` is `undefined` for an authored journey the store never held. */
export interface BrowserJourneyRevision {
	readonly journey: BrowserJourney
	readonly revision: number
}

/** One change to a journey; a batch is applied in order to a copy and refused whole on the first invalid edit. */
export type BrowserJourneyEdit =
	| { readonly operation: 'add'; readonly step: BrowserJourneyStepInput; readonly before?: string; readonly after?: string }
	| { readonly operation: 'remove'; readonly id: string }
	| { readonly operation: 'update'; readonly id: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>; readonly target?: BrowserJourneyTarget; readonly tab?: BrowserJourneyTab; readonly secret?: boolean }
	| { readonly operation: 'declare'; readonly name: string; readonly parameter: BrowserJourneyParameter }
```

Rulings behind the shape:

- A binding is a string-typed argument of a native tool (`text`, `url`, `key`, the `wait` text, `dialog`'s `text`, a target's `name`); a page tool's arguments are literal JSON, so an object with an `input` key inside them is data. The parser distinguishes the two by the action's name against the native tool list.
- A parameter is text; a `select` control's value is the option's text typed into it, and a multiple selection is a gap. A secret parameter has no default.
- No `frame` in a target: a child-frame element is a gap in this revision (`gap: 'the element is in a child frame'`), because a frame's protocol id is not portable across sessions; a portable frame locator is a follow-on unit. A `switch` step carries the tab's URL and title, never `tN`.
- `format: 1` and the store's `revision` follow toolbox's missing-revision lesson; the validators refuse an unknown format with `BROWSER_JOURNEY_FORMAT`.

Invariants (each checked by `validateBrowserJourney`, which asserts, over the value `parseBrowserJourney` returns or `undefined`):

1. `name` matches `^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$` and has at most 64 characters.
2. Step ids are unique; an added step takes one more than the highest id the journey ever held (the journey keeps `next` implicitly as the maximum plus one); ids never renumber.
3. `target` is present exactly when the action takes `ref`; `tab` exactly for `switch`; `arguments` never carries `ref` or `tab`.
4. Every binding names a declared parameter; every declared parameter is bound by at least one step of the final journey (the editor drops an unbound parameter after a batch).
5. A `type` step marked `secret` binds its `text` to a secret parameter; a secret parameter has no default; no file, receipt, listing, or generated module carries its value.
6. `parseBrowserJourney(JSON.parse(JSON.stringify(journey)))` equals `journey`.
7. The acting and observing actions a recorder emits are `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, and an adopted page tool; `look`, `read`, and `tabs` are never steps; `unresolved` is a gap.

The directory layout under `tmp/browsers` (one file per entry; captures beside the run file, never inside JSON):

```text
tmp/browsers/
  .profile/                    the browser profile the browse server owns, removed on exit
  add-kettle/
    journey.json               { "revision": 3, "journey": { … } }
    journey.lock               present only during a set
    runs/
      2026-09-30T14-03-12-481Z-7f3a/
        run.json               the BrowserRun
        s1.png s2.png …        one capture per acting step in the page placement
```

## 3. Recording

```ts
/** Maps the events a recorder emits. */
export type BrowserRecorderEventMap = {
	readonly start: readonly []
	readonly step: readonly [step: BrowserJourneyStep]
	readonly stop: readonly [steps: readonly BrowserJourneyStep[]]
	readonly clear: readonly []
}

/** Records the steps of a journey from one source as they happen. */
export interface BrowserRecorderInterface {
	readonly emitter: EmitterInterface<BrowserRecorderEventMap>
	readonly started: boolean
	start(): Promise<void>
	stop(): Promise<readonly BrowserJourneyStep[]>
	steps(): readonly BrowserJourneyStep[]
	clear(): void
	destroy(): Promise<void>
}

/** Configures the toolset recorder. */
export interface BrowserRecorderOptions {
	readonly on?: EmitterHooks<BrowserRecorderEventMap>
	readonly error?: EmitterErrorHandler
	readonly include?: boolean
}
```

Three sources, one contract:

- **The toolset's actions.** The toolset emits `action` for every call of an action tool or `wait` that the manager admitted to the handler, success or refusal, carrying the `BrowserAction` (§ 4) with the call's `id`. `createBrowserRecorder(toolset, options)` turns actions whose outcome is `done` into steps and assigns ids; `look`, `read`, `tabs`, the journey tools, and a refused action are never steps. An inner `replay` while the recorder runs becomes one `unresolved` step naming the journey (`gap: 'replayed add-kettle; include it or record its steps'`) unless `include` is true, and inclusion is refused for a journey with a secret parameter.
- **A person's input on a page.** `page.codegen()` is the one page entry (§ 6): it keeps the in-page listener and the runtime binding, reads the role and exact accessible name of the node the person acted on, and emits journey steps: a click becomes `click`; a committed field edit becomes `type`, consecutive edits on one field collapsing while the edit is open and never across a submission, a focus departure, a navigation, or stop; a single select change becomes `type` with the option's text; a multiple selection, an element in a child frame, a person's answer to a native dialog, and any other gesture it cannot express become `unresolved` with the gap; Enter in a field becomes `press`; a navigation the gesture caused is settlement evidence and not a `navigate` step. The listener never sends the value of a password control; it sends a marker, and the step is `type` with `secret: true` bound to a new secret parameter named after the control.
- **By hand.** A `journey.json` file or a `BrowserJourney` literal, checked by `validateBrowserJourney`.

Never recorded: observations, refused calls, prompts or answers, raw events, cookies or storage, a secret's value.

## 4. Replay

```ts
/** What became of one action the toolset executed; the toolset emits it after every admitted action call. */
export interface BrowserAction {
	readonly id: string
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJSONValue>>
	readonly target?: { readonly role: string; readonly name: string; readonly reference: string; readonly frame: string }
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly receipt: string
	readonly elapsed: number
}

/** How one step ended. */
export type BrowserStepOutcome = 'done' | 'refused' | 'timeout' | 'interrupted'

/** How a run ended. */
export type BrowserRunOutcome = 'complete' | 'stopped' | 'aborted'

/** One replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's `JournalStep` fields. */
export interface BrowserRunStep {
	readonly id: string
	readonly action: string
	readonly trigger: string
	readonly arguments: Readonly<Record<string, BrowserJSONValue>>
	readonly via?: 'role' | 'css'
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly result: string
	readonly capture?: string
	readonly elapsed: number
}

/** One run of a journey. */
export interface BrowserRun {
	readonly format: 1
	readonly id: string
	readonly journey: BrowserJourney
	readonly revision?: number
	readonly inputs: Readonly<Record<string, string>>
	readonly steps: readonly BrowserRunStep[]
	readonly outcome: BrowserRunOutcome
	readonly output?: readonly string[]
	readonly elapsed: number
	readonly saved?: string
}

/** Configures one replay. */
export interface BrowserReplayOptions {
	readonly on?: EmitterHooks<BrowserReplayEventMap>
	readonly error?: EmitterErrorHandler
	readonly inputs?: Readonly<Record<string, string>>
	readonly edits?: readonly BrowserJourneyEdit[]
	readonly runs?: BrowserRunStoreInterface
}

export type BrowserReplayEventMap = { readonly step: readonly [step: BrowserRunStep] }

/** Replays one journey over a toolset. */
export interface BrowserReplayInterface {
	readonly emitter: EmitterInterface<BrowserReplayEventMap>
	execute(options?: BrowserCallOptions): Promise<BrowserRun>
}
```

`createBrowserReplay(toolset, revision, options).execute(call)`:

1. **Preparation**, before any side effect: validate the journey, apply `edits` to a copy, merge `inputs` over the parameters' defaults, refuse a missing or unknown input, a gap step, or an action the placement cannot execute (a page-backed toolset executes `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and, with `context`, `switch`; the DOM placement executes `click`, `type`, `wait`, and the page tools it adopted); a page tool's availability and a `dialog` step's admissibility are checked when reached. The stored journey is untouched.
2. **Hold**: `toolset.hold()` takes a queue turn and returns `{ token, release }`; while held, an action call whose `context.caller` is not the token is refused at admission with `BROWSER_TOOLSET_BUSY` (`The toolset is replaying NAME; call look or wait for it to finish.`); actions admitted before the hold complete first; observations pass. The `replay` tool's handler takes no queue turn of its own. `release` runs in `finally`, including abort.
3. **For each step in order**: resolve the target (or the tab), execute through `toolset.tools.execute({ id, name, arguments: { ...substituted, ref }, context: { caller: token, signal } })`, read the `BrowserAction` the toolset emitted for that call id (a manager-level refusal, such as an unknown tool or a pre-aborted call, has no action and is judged from the `ToolResult`), append a `BrowserRunStep`, capture in the page placement, and stop after the first step whose outcome is not `done`, except that an `interrupted` action (a dialog opened during its input) admits exactly the immediately following `dialog` step, after which the pending input completes and its action arrives.
4. **Finalization**: release the hold; write the run through `runs` when given, with a bounded write that does not carry the aborted signal, and record the write's failure in `saved` rather than failing the replay; resolve with the `BrowserRun`. `execute` rejects only on a destroyed toolset.

Target resolution (`locateBrowserTarget(view, target)` in `src/core/helpers.ts`, the same function the generated module calls), in order, each refusing ambiguity rather than choosing:

1. `elements.find({ role, name, exact: true })`: exactly one match resolves (`via: 'role'`); several refuse with `BROWSER_JOURNEY_AMBIGUOUS` (`Two buttons are named "Delete"; call look, then edit NAME.`).
2. `elements.find({ css })`: exactly one match whose role and exact name equal the step's resolves (`via: 'css'`); a match with another role or name, or several matches, refuses.
3. Nothing resolves with `BROWSER_JOURNEY_TARGET` (`No button "Add to cart" is on the page; call look, then edit NAME.`).

`reference` is evidence only. `exact` matches the whole accessible name after the existing whitespace normalization, case-sensitively; the default query keeps its case-insensitive substring. A `switch` step resolves its tab from `tabs` by URL and title; two tabs matching refuse.

Outcome judgement uses the `BrowserAction`, never the receipt text: a `wait` whose text did not appear is `timeout`; a `requested` or `committed` stage stops the run before a following action (`stage` recorded).

A run id is minted by the producer as `<ISO time with - for :>-<4 hex>` and its directory is created exclusively, retrying on a collision. The DOM placement replays the supported subset with `(untrusted event)` receipts and no captures.

## 5. Editing

`editBrowserJourney(journey, edits)` is pure and atomic: it applies the batch in order to a copy, checking each edit's own structure as applied (an unknown id, a duplicate anchor, an `update` that removes the target of a `ref`-taking action, a `declare` of a secret with a default) and the cross-step invariants on the final candidate (every binding declared; every declared parameter bound after unbound ones are dropped); any failure refuses the whole batch with `BROWSER_JOURNEY_EDIT` naming the edit's index and the reason. `update.arguments` merges by key. The `edit` tool accepts `ref` in an added or updated step and converts it to a target from the current view before the pure editor runs, so a model never types a role and a name by hand.

The store's `set(journey, expected)` refuses a mismatch between `expected` and the stored revision with `BROWSER_JOURNEY_REVISION`, inside the per-name lock (§ 7), so two editors cannot lose an update.

## 6. Codegen

One recorder, two artifacts, each usable without the other:

- `page.codegen()` is the only page entry: `BrowserCodegenInterface extends BrowserRecorderInterface` with one composing member, `script(options: { language?, name, description })`, which compiles the steps recorded so far. The class moves to `src/core/recorders/BrowserPageRecorder.ts`; the four CSS actions, `compileCodegenScript`, `normalizeCodegenActions`, and `BrowserCodegenAction` are retired; `BrowserCodegenLanguage` stays.
- `compileBrowserJourney(journey, { language })` emits a standalone module from any journey, `export async function execute(page, inputs)`, typed in TypeScript with a required property per secret parameter and an optional one per defaulted parameter, one readable block per step over the public contracts, importing only `@orkestrel/browser`:

```ts
import type { BrowserPageInterface } from '@orkestrel/browser'
import { locateBrowserTarget } from '@orkestrel/browser'

export async function execute(page: BrowserPageInterface, inputs: { email?: string }): Promise<void> {
	await page.navigate('https://shop.example.test/')
	{
		const target = await locateBrowserTarget(page, { role: 'link', name: 'Alpine Kettle' })
		const record = page.navigation.record(target.frame)
		try {
			await target.click()
			const settled = await record.settle({ timeout: 5_000 })
			if (settled !== undefined && settled.stage !== 'loaded') throw new Error(`s2: the page is still loading ${settled.url}`)
		} finally {
			record.destroy()
		}
	}
	{
		const target = await locateBrowserTarget(page, { role: 'textbox', name: 'Email' })
		const record = page.navigation.record(target.frame)
		try {
			await target.fill(inputs.email ?? 'sam@example.test')
			await target.submit()
			const settled = await record.settle({ timeout: 5_000 })
			if (settled !== undefined && settled.stage !== 'loaded') throw new Error(`s3: the page is still loading ${settled.url}`)
		} finally {
			record.destroy()
		}
	}
	await page.wait('Added to cart', { timeout: 5_000 })
}
```

- `type` compiles to `fill(text)` for a text control and to `select([text])` for a `combobox` or `listbox`; a submit compiles to `submit()` inside the same record block; a secret parameter compiles to a required input with no default.
- A step the compiler cannot express as public calls (`dialog`, `switch`, a page tool) compiles to an unconditional `throw new Error('s4: dialog is not compiled; handle it here')` at its position, so the module runs its prefix and stops there rather than skipping the step; the compile result lists them.
- `compileBrowserJourney` is a Node API and a `browse` operation for a developer; it is not a model-facing tool.

## 7. The stores and the MCP surface

```ts
/** Keeps journeys by name with a revision per write. */
export interface BrowserJourneyStoreInterface {
	get(name: string): Promise<BrowserJourneyRevision | undefined>
	set(journey: BrowserJourney, expected?: number): Promise<BrowserJourneyRevision>
	delete(name: string): Promise<void>
	list(options?: { readonly offset?: number; readonly limit?: number }): Promise<{ readonly entries: readonly BrowserJourneyRevision[]; readonly count: number; readonly truncated: boolean }>
}

/** Keeps runs by journey name and run id. */
export interface BrowserRunStoreInterface {
	open(name: string): Promise<{ readonly id: string; readonly directory?: string; save(run: BrowserRun): Promise<void> }>
	get(name: string, id: string): Promise<BrowserRun | undefined>
	list(name: string, options?: { readonly offset?: number; readonly limit?: number }): Promise<{ readonly entries: readonly BrowserRun[]; readonly count: number; readonly truncated: boolean }>
}

/** Configures the journey tools a toolset advertises. */
export interface BrowserJourneyOptions {
	readonly journeys: BrowserJourneyStoreInterface
	readonly runs?: BrowserRunStoreInterface
	readonly readonly?: boolean
}
```

The file twins (`src/server/stores/FileBrowserJourneyStore.ts`, `FileBrowserRunStore.ts`) obey: the root is `realpath`-resolved once; every path is `resolve(root, name, …)` and must begin with the root and the separator; a journey directory that is a symbolic link is refused; `set` takes `journey.lock` with an exclusive create, waits a bounded time for a lock another process holds and refuses with `BROWSER_JOURNEY_LOCKED` after it, and inside the lock reads, compares `expected`, assigns the revision, writes a sibling temporary file, and renames; a failed write removes the temporary file and leaves the previous revision readable; a missing file is `undefined`; a malformed file, a missing or unknown `format`, or a permission error is a typed error naming the path, never `undefined`; `list` sorts by name, applies `offset` and `limit` against a configured cap, probes one extra entry for `truncated`, and reports unreadable files in a `faults` member without blocking the page; `open` creates the run directory exclusively. The memory twins hold clones. One conformance suite runs over both twins of each store, with a reopened path, a truncated file, malformed JSON, an unknown format, a permission error, two instances over one directory, and paging.

The toolset advertises the journey tools only with `journeys`; each declares one required parameter; copy in `BROWSER_TOOL_COPY`; a page tool with a reserved name is skipped as today.

| Tool | Parameters | Result | Refusals |
| --- | --- | --- | --- |
| `record` | `journey` (string, required) | `Recording add-kettle; each action you take is a step; call save when it is done.` and the view | `A journey named "add-kettle" is saved; call journeys, or record another name.`; `A journey is recording; call save first.`; `The journeys are read-only; call replay.` |
| `save` | `description` (string, required) | `Saved add-kettle with 5 steps.` and the listing | `No journey is recording; call record first.`; a store failure fails the call with its message (persist before publish) |
| `journeys` | `what` (string, required), `offset` (integer) | the listing, cut at the tool limit with `call journeys with offset N for more` | none |
| `edit` | `journey` (string, required), `edits` (array, required) | `Edited add-kettle.` and the listing | `No journey is named "checkout"; call journeys.`; `Edit 2 is refused: …; call journeys.`; `Journey add-kettle changed under you; call journeys, then edit again.` |
| `replay` | `journey` (string, required), `inputs` (object of strings) | `renderBrowserRun` (§ 8 of the subjective design's shape): one receipt line per step and the final view, or the stop line naming the step, the reason, and the next calls | `No journey is named "checkout"; call journeys.`; `Journey add-kettle needs the input "email"; call replay with inputs.`; `Journey NAME is recording; call save before you replay another.`; `The toolset is replaying NAME; …` |

The listing (`renderBrowserJourney`) is one line per step in the receipt's `ROLE "NAME"` form, a binding shown as `as NAME`, the parameters line marking `NAME (secret)`, and never a reference:

```text
add-kettle "Add the Alpine Kettle to the cart" (parameters: email, password (secret))
s1 navigate https://shop.example.test/
s2 click link "Alpine Kettle"
s3 click button "Add to cart"
s4 type textbox "Email" "sam@example.test" as email, submit
s5 wait "Added to cart"
```

`readonly` refuses `record`, `save`, and `edit` before any store access; `replay` still writes runs, and the guide says so. The tool context's signal reaches every store call and step. A refusal is a sentence ending with a `call TOOL` directive, and a list of names is bounded.

## 8. The browse binary and its package

The binary follows probe's: `bin: { browse: dist/bin/main.js }`, `src/bin/main.ts` starts the server and exits 1 on a coded error, registration through `.mcp.json` with `node node_modules/@orkestrel/browse/dist/bin/main.js`, no command-line commands. The server answers `tools/list` from a bootstrap manager that holds the journey tools over the file stores before any browser exists; the first tool that needs a page launches Chromium with a profile under `tmp/browsers/.profile`, builds the page toolset with `context` and `journeys`, and moves the journey tools onto it; EOF on stdin, SIGTERM, and SIGINT stop admission, abort the active replay, and destroy the browser it launched with its profile; it never attaches to another client's browser.

The package: `@orkestrel/browse` at layer 5, depending on `@orkestrel/browser` and `@orkestrel/mcp`, holding the binary and the server; the journey core (types, recorder, replay, editor, compiler, locator, memory stores, journey tools) and the file stores (`node:fs` only) stay in `@orkestrel/browser`. Both audits favour this home (the browser library keeps its layer and its import set; the binary's directory, launch, and single page are host policy). The owner rules; the units below cut the browse package as its own unit so the ruling changes nothing else.

## 9. The `orkestrel-journey` alignment

Shared: `journey` (one intent), `step`, the `action`, `trigger`, `result` fields, `output`, role and exact accessible name, `trusted`. Distinct: the skill's `record` appends a journal line while the browser's records steps to replay; the skill's `journal` is a run log while the browser's run is a replay; `capture` is a portfolio under `tmp/captures` for the skill and `sN.png` in a run for the browser. A run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists (a later unit under the owner's dependency ruling). The verb map for a skill journey that translates a recorded one: `click` to `clickAccessible(role, name)`, `type` to `fillAccessible` (a `combobox` or `listbox` `type` is a programmatic selection and is refused), `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and page tools are refused. A step resolved `via: 'css'` is reported as a resolution finding without a cause. The proposal to scaffold: `references/recorded.md` in the skill, one bullet in `decide.md`, a `tmp/browsers` row in the orchestration layout, and the `.mcp.json` wiring.

## 10. Load-bearing claims

1. The toolset emits `action` for every call of `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, and an adopted page tool that the manager admitted to the handler, with the call's `id`, the target's role, exact name, reference, and frame captured before the input is dispatched when a reference resolved, the outcome, stage, reason, and receipt after settlement, and `interrupted` when a dialog opened during the input; the existing settlement cases are unchanged.
2. `elements.find({ role, name, exact: true })` matches the whole normalized accessible name case-sensitively in both placements; the default query is unchanged.
3. On a page whose ids, classes, and order changed between record and replay, a uniquely named control resolves by role and exact name without input reaching another element; a duplicated name refuses before any input, whatever reference the step carries (Chromium probe).
4. A CSS fallback that matches an element with another role or name, or several elements, refuses.
5. Replay executes every step through `toolset.tools.execute`, so the stage, reason, receipt wording, and the changed note equal those of a direct tool call over the same fixture; a `click` that opens a dialog is `interrupted`, the following `dialog` step completes it, and no step executes after a failure.
6. The hold refuses a foreign action admitted after it and lets one admitted before it complete first; an inner call carrying the token passes; the hold releases on every exit including abort, and an abort during a held input leaves the queue released with no following action.
7. A `wait` whose text did not appear is `timeout` while its receipt text is unchanged.
8. Preparation refuses before any side effect: a missing or unknown input, a gap step, an action the placement cannot execute; a page event counter stays at zero after every refusal; a `dialog` step is admitted only after an `interrupted` action.
9. `editBrowserJourney` is pure and atomic, drops unbound parameters, merges `update.arguments` by key, and the `edit` tool converts `ref` to a target from the current view; `set` with a stale revision refuses inside the lock.
10. The file journey store passes the conformance suite: reopened path, truncated file, malformed JSON, unknown format, permission error, two instances and two processes over one directory (a lost update refused), stable paging with `truncated` and `faults`, a failed write leaving the previous revision, a symbolic-link directory refused, a reserved name refused; a mutation that returns `undefined` for a corrupt file fails.
11. The file run store creates each run directory exclusively and a collision retries; two producers minting one id yield two directories.
12. The page recorder emits one step per gesture with role and exact name, collapses field edits only while the edit is open, records a navigation the gesture caused as evidence and not as a step, distinguishes an Enter from the click it caused, emits `unresolved` for a multiple selection, a child-frame element, and a native dialog answer, and never sends a password control's value through the binding (Chromium probe with an independent fixture event log).
13. A secret's value never reaches `journey.json`, `run.json`, the listing, a receipt (`Typed a secret into e33 textbox "Password".`), the `action` record, a capture's name, or a generated module; the `type` tool's `secret` argument produces that receipt for a direct call as well.
14. `compileBrowserJourney` over a journey and `createBrowserReplay` over the same journey produce the same page outcome on independently reset fixtures including a delayed submission, a form whose submit navigates, and an unsupported step (the module throws at its position); a mutation that removes a step's call from the generated module fails the outcome assertion; the module type-checks and runs with only `@orkestrel/browser` imported.
15. The `browse` binary, packed and spawned through the mcp package's stdio client, lists its tools before Chromium starts and with Chromium absent, then records, saves, edits, and replays; its runs land under `tmp/browsers/<name>/runs/` and its profile under `tmp/browsers/.profile`; EOF and SIGTERM end the child process and remove the profile.
16. The store proof's model, with the journey tools advertised, records a flow and saves it, lists it, edits it with an `update` of an argument and a `remove` of a binding step, and replays it with an input, judged by page state and the store's files, with the attempts and the tool-list cost recorded.

## 11. Guide invariants ruled

| Invariant | Ruling |
| --- | --- |
| 2 (the server's import set) | unchanged: the file stores use `node:fs`; `@orkestrel/mcp` stays out of the browser package |
| 4 (captures through the page's writer) | kept: a run's captures go through the writer to the run directory the store opened |
| 6 (observable events) | extended: the toolset emits `action`; the recorder emits `start`, `step`, `stop`, `clear`; the codegen emitter's `action` event is retired with the CSS actions |
| 9 (codegen collapses consecutive fills) | restated: the page recorder collapses consecutive edits on one field while the edit is open |
| 15 (references are per context) | kept; a journey's `reference` is evidence, never a lookup |
| 18 (FIFO action execution) | amended: while a replay holds the toolset, a foreign action admitted after the hold is refused with `BROWSER_TOOLSET_BUSY` rather than queued |
| 19 (a staged dialog) | kept; a replay's `dialog` step is the continuation the toolset stages |
| 21 (reserved names) | extended: `record`, `save`, `journeys`, `edit`, `replay` are reserved whenever the toolset is constructed with `journeys` |

## 12. Units (dependency order; the lane per `.agents/orchestration.md` § Routing)

| Unit | Lane | Owns | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| J0 probes | `opus` (the codex sandbox refuses loopback binds) | `tmp/probes/journeys/*.test.ts`, its logs, `tmp/units/journeys/probe-report.md` | none | claims 3, 4, 12 as named assertions with controls (a duplicated name refusing with zero input events; a renamed CSS match refusing; the gesture log equal to the fixture's event log), read twice on Chromium 141 with tapes |
| J1 contract | `opus` | `src/core/types.ts`, `src/core/constants.ts` (patterns, codes, copy), `src/core/errors.ts`, `src/core/index.ts` | none | the interfaces of §§ 2–4 and § 7 declared with TSDoc per `typescript.md`; `check` green; the entity members one word (`names.md` exempts type names and helpers) |
| J2 leaves | `astra` | `src/core/parsers.ts`, `src/core/validators.ts`, `src/core/helpers.ts` (`validateBrowserJourney`, `editBrowserJourney`, `locateBrowserTarget`, `renderBrowserJourney`, `renderBrowserRun`, the run id), their tests | J1 | claims 9 (the pure part), 13 (the render part); invariant 6; every refusal string of § 7's table asserted verbatim |
| J3 exact query | `astra` | the two element managers, their tests | J1 | claim 2 |
| J4 toolset action event, hold, secret | `astra` | `src/core/BrowserToolset.ts`, its tests, `tests/setup.ts` | J1 | claims 1, 6, 7, 13 (the receipt) |
| J5 recorder, replay, memory stores | `astra` | `src/core/recorders/BrowserToolsetRecorder.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/Memory*.ts`, `src/core/factories.ts`, their tests | J2, J3, J4, J0 | claims 3, 4, 5, 8, 9, 10 and 11 (the memory twins), 13 |
| J6 page recorder engine | `astra` | `src/core/recorders/BrowserPageRecorder.ts`, the recorder source constant, the binding parser, their tests | J5, J0 | claim 12 |
| J7 codegen | `opus` | `src/core/compilers.ts` (`compileBrowserJourney`), `src/core/BrowserPage.ts` (`codegen()`), the retirement of the CSS engine, their tests | J6 | claim 14 |
| J8 journey tools | `opus` | `src/core/BrowserToolset.ts` (the `journeys` option and five handlers), `src/core/constants.ts` (copy), `src/browser/factories.ts`, their tests | J5 | § 7's table asserted verbatim; `readonly`; the signal; the `ref` conversion |
| J9 file stores | `astra` | `src/server/stores/File*.ts`, `src/server/factories.ts`, `src/server/constants.ts`, `src/server/types.ts`, the shared conformance suite in `tests/setup.ts`, their tests | J2 | claims 10, 11 |
| J10 browse package | `opus` for the lifecycle and protocol, `builder` for the manifest and lock, in the new checkout after the owner's ruling | `@orkestrel/browse`: `src/bin/main.ts`, `src/server/BrowseServer.ts`, `package.json`, the bin config, `tests/` | J8, J9 | claim 15 |
| J11 service proofs and the store-proof journey task | `astra`; the consumer run in `/home/user/ollama` | `tests/service/journey.test.ts`, `tests/setupServer.ts` variants as a patch; the ollama store proof gains the journey task | J5–J9 | claims 3–9, 12–14 on Chromium 141, three runs; claim 16 |
| J12 guide and README | `opus` | `guides/browser.md`, `README.md`, `tests/guides.test.ts` | J1–J9 | `test:guides` green; Surface rows and Methods tables for every interface of §§ 2–4 and § 7; a "Journeys" concept after "Toolset vocabulary"; rows for the five tools and their receipts; patterns to record from the toolset, replay with inputs, edit, and generate code; "Host the toolset over MCP" gains `journeys`; § 11's table applied |
| J13 scaffold proposal | `opus`, in the scaffold checkout with the owner's consent | the skill reference, `decide.md`, the layout row, the wiring | J10, J12 | the files named in § 9 exist and scaffold's policy gate is green |
| J14 falsify | Opus `reviewer` and Astra `analyst` | evidence only | J1–J12 | one round over the numbered claims, closed when every claim is CONFIRMED or ruled |
| J15 verify | `verifier` | evidence only | J14 | the gates bare |

Shared files (`types.ts`, `constants.ts`, `helpers.ts`, `BrowserToolset.ts`, barrels) are edited by one unit at a time in the order listed; a later unit's patch to a shared file is reported and integrated by the Orchestrator.

## 13. The first round's findings, ruled

| Finding | Ruling |
| --- | --- |
| obj 1, subj 1 | `action` covers calls admitted to the handler, carries the call id, `target` optional; manager-level refusals judged from the result; `wait` emits |
| obj 2, subj 2 | `exact` is case-sensitive over the normalized name; `frame` dropped from the query and the target |
| obj 3, subj 3, subj O1 | the reference-first step deleted; `reference` is evidence |
| obj 4, subj 4 | the CSS-only target struck; role and name required |
| obj 5, subj 8 | preparation checks the placement's capabilities; `dialog` and page tools checked when reached; `interrupted` and the continuation defined |
| obj 6, subj 6 | the hold as a token over the queue turn; admitted work completes first; the `replay` handler takes no turn |
| obj 9, obj 10 | the lock's scope defined inside the file store; the conformance suite named |
| obj 11, subj O8 | `strings` dropped; a multiple selection is a gap; `select` is `type` with the option text |
| obj 12 | the `type` tool's `secret` argument; the listener's marker; protection before receipts |
| obj 13, subj 13, subj O4 | `execute`, typed inputs, `fill`/`select`/`submit`, the record on the target's frame, `finally`, an unconditional throw for an unsupported step |
| obj 14, obj O12, subj O18 | the separate package recommended; the file stores stay in the browser's server entry; the profile placed and removed; `--port` dropped |
| obj 15, subj 15 | claim 16 widened |
| obj O1, subj O24 | bindings only on native string arguments; page-tool arguments literal JSON |
| obj O2, subj O9 | `declare` adds or replaces; unbound parameters dropped; batch validation on the final candidate; `update.arguments` merges |
| obj O3, subj O15 | child-frame elements are gaps; `switch` carries URL and title; preparation limited to static capabilities |
| obj O4 | containment, reserved names, symbolic links, exclusive run directories |
| obj O5 | step, run, and artifact outcomes separated; `saved`; an authored journey's `revision` undefined |
| obj O6, subj O11 | `journeys` takes `offset`; `readonly` protects definitions only, stated |
| obj O7, subj O14 | an inner replay is a gap unless included; `replay` refused while recording |
| obj O8, subj O20 | automation evidence only; the verb map ruled |
| obj O9, subj O16 | § 11 |
| obj O10, subj O5, subj O6, subj O7, subj O22 | `execute`, `locateBrowserTarget` in `helpers.ts`, `validateBrowserJourney` asserting and `parseBrowserJourney` returning `undefined`, `BrowserJourneyParameter`, `BrowserJourneyRevision`, `BrowserRun`, `BrowserAction`, `id`, `started` dropped, `gap`, step and run outcomes split, `action` on both step kinds |
| obj O11, subj O17, subj O19 | the units recut with verbatim oracles; the guide's section list carried by J12 |
| subj O3 | `page.codegen()` the only page entry |
| subj O10 | the `edit` tool converts `ref` |
| subj O12 | refusal sentences with `call TOOL` |
| subj O13 | the `compile` tool dropped; a Node API and a `browse` developer operation |
| subj O21 | the `guarantee` sentence removed |
| subj O23 | optional, not taken: ambiguity is detected at replay in this revision |

## 14. Unresolved

- The binary's package: the owner rules (§ 8).
- A portable frame locator, shadow-root and region boundaries: a follow-on unit; gaps in this revision.
- The trusted-input adapter and the browser package in `BASE_DEV_DEPENDENCIES`: the owner's dependency rulings.
- Page output in the DOM placement: a consumer-supplied source or "unavailable".
- Claim 16's run settles the journey tools' cost for the store model.
