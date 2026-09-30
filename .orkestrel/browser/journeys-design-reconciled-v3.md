# Browser journeys: the reconciled proposal, third revision (2026-09-30)

Revised by the Orchestrator after the second falsify round (`journeys-falsify2-objective.md`, `journeys-falsify2-subjective.md`) over the second revision (`design-reconciled-v2.md`). § 13 rules every finding of that round. The owner's rulings stand: codegen stays as the capability that emits a JavaScript or TypeScript module a developer runs as is or customizes; the `browse` binary ships inside `@orkestrel/browser` in a bin config as probe ships its own; toolbox's patterns are prior art. Claims in § 10 are renumbered for the third round.

## 1. The design in one paragraph

A journey is one user intent as JSON: a name, a description, declared parameters, a step counter, and steps that mirror the toolset's own tool calls, each acting step naming its element by role and exact accessible name with the record-time reference and a CSS selector kept as evidence. One recorder contract produces steps from three sources: the toolset's actions through the structured `BrowserAction` the toolset returns from `perform` and emits as `action`, a person's input on a page through `page.codegen()`, and a hand-written file; a recorder's `journey()` turns the steps into a journey with its parameters derived. Two artifacts derive from the same steps: the journey file, which a model records, lists, edits, and replays through five tools that a sibling entity registers on the same manager as `look` and `click`, and a generated module, which `compileBrowserJourney` emits as readable calls over the public page and element contracts for a developer. Replay prepares the whole run before its first side effect, holds the toolset, resolves each target on the live page by role and exact name, refuses ambiguity, executes every step through the toolset's `perform`, judges each step from the `BrowserAction` it returns, stops at the first step that did not complete, and writes a run under `tmp/browsers/<journey>/runs/<id>/`. A journey store and a run store keep the files with revisions, atomic writes, per-name locks, containment across every path component, paging with faults, and typed corruption errors; memory twins serve core and tests. A `browse` binary in the package serves the toolset and the journey tools over MCP on stdio, advertising the whole vocabulary before it launches Chromium. The `orkestrel-journey` skill reads a run's steps and output as automation evidence, and a proposal to scaffold names the shared vocabulary.

## 2. The journey data model

All declarations live in `src/core/types.ts` under `// === Browser journeys`, which replaces `// === Browser codegen`. Every TSDoc summary opens with a third-person verb.

```ts
/** Represents a JSON value: what a journey file, a run file, and a page tool's arguments carry. */
export type BrowserJSONValue =
	| string | number | boolean | null
	| readonly BrowserJSONValue[]
	| { readonly [key: string]: BrowserJSONValue }

/** Binds a native action's string argument to a literal or to one declared parameter by name. */
export type BrowserJourneyBinding = string | { readonly parameter: string }

/** Declares one parameter a journey takes: its default, or none when it is a secret. */
export interface BrowserJourneyParameter {
	readonly default?: string
	readonly secret?: boolean
}

/** Names the element an acting step acts on the way a receipt names it, with the record-time evidence. */
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
 * Describes one step before it holds an id: a call of a toolset tool with its element or tab named as data.
 *
 * @remarks
 * - `action` — `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page tool's name, or `unresolved`
 * - `arguments` — the call's arguments; for a native action without `ref` or `tab`, its string arguments binding a parameter; for a page tool, its literal JSON as sent
 * - `target` — present exactly when a native action takes `ref`; `tab` — present exactly for `switch`
 * - `secret` — on `type`, the typed text binds a secret parameter and never appears in a file, a receipt, a listing, or a module
 * - `gap` — on `unresolved`, why the recorder could not express the gesture; preparation refuses the journey
 */
export interface BrowserJourneyStepInput {
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>
	readonly target?: BrowserJourneyTarget
	readonly tab?: BrowserJourneyTab
	readonly secret?: boolean
	readonly gap?: string
}

/** Describes a step with its identity: `s` followed by a positive integer, stable across edits and never reused. */
export interface BrowserJourneyStep extends BrowserJourneyStepInput {
	readonly id: string
}

/** Describes one user intent as data; `next` is the number the next added step takes. */
export interface BrowserJourney {
	readonly format: 1
	readonly name: string
	readonly description: string
	readonly parameters: Readonly<Record<string, BrowserJourneyParameter>>
	readonly next: number
	readonly steps: readonly BrowserJourneyStep[]
}

/** Carries a journey with the revision the store assigned; `revision` is absent for a journey the store never held. */
export interface BrowserJourneyRevision {
	readonly journey: BrowserJourney
	readonly revision?: number
}

/** Describes one change to a journey; a batch is applied in order to a copy and refused whole on the first invalid edit. */
export type BrowserJourneyEdit =
	| { readonly operation: 'add'; readonly step: BrowserJourneyStepInput; readonly before?: string; readonly after?: string }
	| { readonly operation: 'remove'; readonly id: string }
	| { readonly operation: 'update'; readonly id: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>; readonly target?: BrowserJourneyTarget; readonly tab?: BrowserJourneyTab; readonly secret?: boolean }
	| { readonly operation: 'declare'; readonly name: string; readonly parameter: BrowserJourneyParameter }

/** Describes an edit as the `edit` tool receives it: an added or updated step can name `ref` instead of a target, converted from the current view before the pure editor runs. */
export type BrowserJourneyEditInput =
	| BrowserJourneyEdit
	| { readonly operation: 'add'; readonly step: Omit<BrowserJourneyStepInput, 'target'> & { readonly ref?: string }; readonly before?: string; readonly after?: string }
	| { readonly operation: 'update'; readonly id: string; readonly ref?: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>; readonly secret?: boolean }
```

Rulings behind the shape:

- A binding is a string argument of a native action (`type.text`, `navigate.url`, `press.key`, `wait.text`, `dialog.text`, a target's `name`); a secret parameter binds `type.text` only, and the validator refuses any other binding of a secret. A page tool's arguments are literal JSON kept exactly as sent, `ref` and `tab` keys included; those keys are reserved only on the native actions that define them.
- A parameter is text; its name matches `^[a-z][a-zA-Z0-9]*$`; a secret has no default. A `select` control's value is the option's text typed into it; a multiple selection is a gap.
- No frame in a target: a child-frame element is a gap in this revision (`gap: 'the element is in a child frame'`), as are shadow-root and region boundaries; a portable frame locator is a follow-on unit. A `switch` step carries the tab's URL and title, never `tN`.
- `next` persists the id counter, so a removed id is never reused. `format: 1` and the store's `revision` follow toolbox's missing-revision lesson; `validateBrowserJourney` refuses an unknown format with `BROWSER_JOURNEY_FORMAT`.

Invariants (asserted by `validateBrowserJourney(value): asserts value is BrowserJourney`; `parseBrowserJourney` returns the value or `undefined`):

1. `name` matches `^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$` and has at most 64 characters.
2. Step ids are unique and every id's number is below `next`; an added step takes `next` and increments it.
3. A native action's `target` is present exactly when it takes `ref`; `tab` exactly for `switch`; a native action's `arguments` never carries `ref` or `tab`.
4. Every binding names a declared parameter; every declared parameter is bound by at least one step.
5. A `type` step marked `secret` binds its `text` to a secret parameter; a secret parameter binds nothing else and has no default.
6. `parseBrowserJourney(JSON.parse(JSON.stringify(journey)))` equals `journey`.
7. A recorder emits `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page tool, and `unresolved`; `look`, `read`, and `tabs` are never steps.

The directory layout under `tmp/browsers` (one file per entry; captures beside the run file, never inside JSON):

```text
tmp/browsers/
  .profiles/
    7f3a-2026-09-30T14-03-12-481Z/   the profile one browse server owns, created exclusively, removed on its exit
  add-kettle/
    journey.json                     { "revision": 3, "journey": { … } }
    journey.lock                     present only during a set
    runs/
      2026-09-30T14-03-12-481Z-7f3a/
        run.json                     the BrowserRun
        s2.png s3.png …              one capture per acting step in the page placement
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

/** Records the steps of a journey from one source as they happen and turns them into a journey. */
export interface BrowserRecorderInterface {
	readonly emitter: EmitterInterface<BrowserRecorderEventMap>
	readonly started: boolean
	start(): Promise<void>
	stop(): Promise<readonly BrowserJourneyStep[]>
	steps(): readonly BrowserJourneyStep[]
	journey(options: { readonly name: string; readonly description: string }): BrowserJourney
	clear(): void
	destroy(): Promise<void>
}

/** Configures a recorder. */
export interface BrowserRecorderOptions {
	readonly on?: EmitterHooks<BrowserRecorderEventMap>
	readonly error?: EmitterErrorHandler
	readonly include?: boolean
}
```

`journey()` derives the parameters: every secret marker declares a secret parameter named after its control's accessible name in lower camel case (`confirmPassword`), deduplicated with a number; the counter `next` is one past the highest id.

Three sources, one contract:

- **The toolset's actions.** `createBrowserRecorder(toolset, options)` subscribes to the toolset's `action` event (§ 4) and turns actions into steps in order: an action with outcome `done` becomes its step; an `interrupted` action whose next action is `dialog` with outcome `done` becomes its step followed by the `dialog` step, and an `interrupted` action followed by anything else becomes a gap; a `switch` step's `tab` comes from the action's `tab`; a `type` action with `secret` becomes a `type` step marked `secret`; `look`, `read`, `tabs`, the journey tools, and a refused action are never steps. An inner `replay` while the recorder runs becomes one `unresolved` step (`gap: 'replayed add-kettle; record its steps in this journey instead'`) unless `include` is true, and inclusion is refused for a journey with a secret parameter.
- **A person's input on a page.** `page.codegen()` is the one page entry (§ 6): it keeps the in-page listener and the runtime binding, reads the role and exact accessible name of the node the person acted on, and emits journey steps: a click becomes `click`; a committed field edit becomes `type`, consecutive edits on one field collapsing while the edit is open and never across a submission, a focus departure, a navigation, or stop; Enter in a field a form owns becomes `type` with `submit: true`, the shape the toolset records; a single select change becomes `type` with the option's text; a multiple selection, an element whose `ownerDocument` is not the driven document, a person's answer to a native dialog, and any other gesture it cannot express become `unresolved` with the gap; a navigation the gesture caused is settlement evidence and not a `navigate` step. The listener never sends the value of a password control; it sends a marker, and the step is `type` with `secret: true`.
- **By hand.** A `journey.json` file or a `BrowserJourney` literal, checked by `validateBrowserJourney`.

Never recorded: observations, refused calls, prompts or answers, raw events, cookies or storage, a secret's value.

## 4. The toolset's structured actions and replay

```ts
/** Describes what became of one action the toolset performed. */
export interface BrowserAction {
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJSONValue>>
	readonly target?: { readonly role: string; readonly name: string; readonly reference: string; readonly frame?: string }
	readonly tab?: BrowserJourneyTab
	readonly secret?: boolean
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly receipt: string
	readonly elapsed: number
}

/** Names how one step ended. */
export type BrowserStepOutcome = 'done' | 'refused' | 'timeout' | 'interrupted'

/** Names how a run ended. */
export type BrowserRunOutcome = 'complete' | 'stopped' | 'aborted'

/** Carries a performed call's tool result beside its structured action, when the call reached a handler. */
export interface BrowserPerformance {
	readonly result: ToolResult
	readonly action?: BrowserAction
}

/** Identifies a replay's ownership of the toolset while it runs. */
export interface BrowserHold {
	readonly token: string
	release(): void
}
```

Additions to the toolset's contract: `BrowserToolsetInterface.perform(call: ToolCall, context?: ToolContext): Promise<BrowserPerformance>` runs the same handler path as `tools.execute` (the manager's handlers call it) and returns the structured action beside the result; `BrowserToolsetInterface.hold(): Promise<BrowserHold>`; `BrowserToolsetEventMap` gains `action: [action: BrowserAction]`; `BrowserElementQuery` gains `exact?: boolean`; `BrowserToolsetOptions` and `BrowserDocumentToolsetOptions` gain `journeys?: BrowserJourneyOptions`; the `type` tool gains `secret` (boolean) in `BROWSER_TOOL_COPY`; `BrowserToolName` gains the five journey tools. `target.frame` is present in the page placement only.

```ts
/** Describes one replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's `JournalStep` fields. */
export interface BrowserRunStep {
	readonly id: string
	readonly action: string
	readonly trigger: string
	readonly arguments: Readonly<Record<string, BrowserJSONValue>>
	readonly outcome: BrowserStepOutcome
	readonly stage?: BrowserNavigationStage
	readonly reason?: BrowserNavigationReason
	readonly result: string
	readonly capture?: string
	readonly elapsed: number
}

/** Describes one run of a journey; `inputs` omits secret values; `fault` carries the run file's write failure. */
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
	readonly fault?: string
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

1. **Preparation**, before any side effect: validate the journey, apply `edits` to a copy, merge `inputs` over the parameters' defaults, refuse a missing or unknown input, a gap step, or a native action the placement cannot execute (a page-backed toolset executes `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and, with `context`, `switch`; the DOM placement executes `click`, `type`, `wait`, and its adopted page tools); a page tool's availability and a `dialog` step's admissibility are checked when reached; a live target's refusal stops the run at its step with the prefix executed. The stored journey is untouched.
2. **Hold**: `toolset.hold()` takes a queue turn and resolves with the hold; while held, `perform` or `tools.execute` for an action tool whose `context.caller` is not the token is refused at admission with `BROWSER_TOOLSET_BUSY`; actions admitted before the hold complete first; `look`, `read`, `tabs`, and `wait` pass. `release()` runs in `finally`, including abort.
3. **For each step in order**: resolve the target or the tab, call `toolset.perform({ id, name, arguments: { ...substituted, ref } }, { caller: hold.token, signal })`, judge the `BrowserAction` it returns (a call the manager refused before any handler has no action and is judged from `result`), append a `BrowserRunStep`, capture in the page placement, and stop after the first step whose outcome is not `done`, except that an `interrupted` action (the toolset returns at once when a dialog opens during the input, the input staying pending as it does today) admits exactly the immediately following `dialog` step, after which the next `perform` awaits the pending input as the toolset does today.
4. **Finalization**: release the hold; write the run through `runs` when given, with a bounded write that carries its own signal rather than the aborted one, recording a write failure in `fault`; resolve with the `BrowserRun`; `output` collects the page's `console` and `error` events during the run in the page placement. `execute` rejects only on a destroyed toolset.

Target resolution (`locateBrowserTarget<E extends BrowserElementInterface>(view: BrowserViewInterface<E>, target: { readonly role: string; readonly name: string }): Promise<E>` in `src/core/helpers.ts`, the function the generated module calls): `elements.find({ role, name, exact: true })`; exactly one match resolves; several refuse with `BROWSER_JOURNEY_AMBIGUOUS` (`button "Delete" names 2 elements; call look, then edit add-kettle.`); none refuses with `BROWSER_JOURNEY_TARGET` (`No button "Add to cart" is on the page; call look, then edit add-kettle.`). `css` and `reference` are evidence: a CSS query intersects the role-and-name outline on the CDP placement, so a CSS rung can never resolve what the semantic search did not. `exact` matches the whole accessible name after the existing whitespace normalization, case-sensitively; the default query keeps its case-insensitive substring. A `switch` step resolves its tab from `tabs` by URL and title; two tabs matching refuse.

Outcome judgement uses the `BrowserAction`, never the receipt text: a `wait` whose text did not appear is `timeout`; a `requested` or `committed` stage stops the run before a following action.

A run id is minted by the producer as `<ISO time with - for :>-<4 hex>` and its directory is created exclusively, retrying on a collision. The DOM placement replays the supported subset with `(untrusted event)` receipts and no captures.

## 5. Editing

`editBrowserJourney(journey, edits)` is pure and atomic: it applies the batch in order to a copy, checking each edit's own structure as applied (an unknown id, a duplicate anchor, an `update` that removes the target of a `ref`-taking action, a `declare` of a secret with a default) and the cross-step invariants on the final candidate; a parameter this batch unbound is dropped, and a `declare` whose parameter no step binds at the end of the batch is refused (`Edit 1 declares "email" but no step binds it; add or update a step that uses it in the same call.`); any failure refuses the whole batch with `BROWSER_JOURNEY_EDIT` naming the edit's index and the reason. `update.arguments` merges by key. The `edit` tool converts a `ref` in an added or updated step to a target from the current view before the pure editor runs.

The store's `set(journey, expected)` refuses a mismatch between `expected` and the stored revision with `BROWSER_JOURNEY_REVISION`, inside the per-name lock (§ 7).

## 6. Codegen

One recorder, two artifacts, each usable without the other:

- `page.codegen()` is the only page entry: `BrowserCodegenInterface extends BrowserRecorderInterface` with one composing member, `script(options: { readonly language?: BrowserCodegenLanguage; readonly name: string; readonly description: string }): BrowserCodegenScript`, which compiles the steps recorded so far through `compileBrowserJourney`. The class is `BrowserCodegen` in `src/core/recorders/BrowserCodegen.ts` and the toolset recorder is `BrowserRecorder` in `src/core/recorders/BrowserRecorder.ts`, so the guide's class parity check pairs each interface with its class. The four CSS actions, `compileCodegenScript`, `normalizeCodegenActions`, `BrowserCodegenAction`, `BrowserCodegenEventMap`, `BrowserCodegenOptions`, and `BrowserCodegenScriptOptions` are retired; `BrowserCodegenLanguage` stays.
- `compileBrowserJourney(journey, options: { readonly language?: BrowserCodegenLanguage }): BrowserCodegenScript`, where `BrowserCodegenScript` is `{ readonly source: string; readonly unsupported: readonly string[] }`, emits a standalone module: `export async function execute(page, inputs)`, typed in TypeScript with a required property per secret parameter and an optional one per defaulted parameter, one readable block per step over the public contracts, importing only `@orkestrel/browser`. `compileBrowserJourney` is a Node API only; the binary has no compile entry.

The example journey `add-kettle` (the same one § 7 lists): s1 `navigate`, s2 `click` link "Alpine Kettle", s3 `click` button "Add to cart", s4 `type` textbox "Email" bound to `email` (default `sam@example.test`) with submit, s5 `wait` "Added to cart".

```ts
import type { BrowserPageInterface } from '@orkestrel/browser'
import { fillBrowserElement, locateBrowserTarget, settleBrowserRecord } from '@orkestrel/browser'

export async function execute(page: BrowserPageInterface, inputs: { readonly email?: string } = {}): Promise<void> {
	await page.navigate('https://shop.example.test/')
	{
		const target = await locateBrowserTarget(page, { role: 'link', name: 'Alpine Kettle' })
		const record = page.navigation.record(target.frame)
		try {
			await target.click()
			await settleBrowserRecord(record, 's2', { timeout: 5_000 })
		} finally {
			record.destroy()
		}
	}
	{
		const target = await locateBrowserTarget(page, { role: 'button', name: 'Add to cart' })
		const record = page.navigation.record(target.frame)
		try {
			await target.click()
			await settleBrowserRecord(record, 's3', { timeout: 5_000 })
		} finally {
			record.destroy()
		}
	}
	{
		const target = await locateBrowserTarget(page, { role: 'textbox', name: 'Email' })
		const record = page.navigation.record(target.frame)
		try {
			await fillBrowserElement(target, inputs.email ?? 'sam@example.test')
			await target.submit()
			await settleBrowserRecord(record, 's4', { timeout: 5_000, destinations: [{ frame: target.frame, relationship: 'self' }] })
		} finally {
			record.destroy()
		}
	}
	await page.wait('Added to cart', { timeout: 5_000 })
}
```

- `fillBrowserElement(element, text)` in `src/core/helpers.ts` is the one helper the toolset's `type` and the module share: `select([text])` for a `combobox` or `listbox`, falling back to `fill(text)` on the toolset's editable-combobox refusal, and `fill(text)` for every other control.
- `settleBrowserRecord(record, step, options)` in `src/core/helpers.ts` settles and throws the receipt's own status when the stage is `requested` (`s4: it requested URL and the page did not change`) or `committed` (`s4: the page is still loading URL`); a submit passes the target's frame as a `self` destination, so a navigation that begins after the input reply is awaited; a form targeting `_parent` or `_top` is a documented limit of the module.
- A `press` step compiles to the page's key press inside a record block; a `dialog`, a `switch`, a page tool, or a step whose replay would follow a popup compiles to an unconditional `throw new Error('s6: dialog is not compiled; handle it here')` at its position, listed in `unsupported`, so the module runs its prefix and stops there.

## 7. The stores and the MCP surface

```ts
/** Carries the signal a store call honours. */
export interface BrowserStoreOptions {
	readonly signal?: AbortSignal
}

/** Names one entry a listing could not read. */
export interface BrowserStoreFault {
	readonly path: string
	readonly message: string
}

/** Carries one page of a listing with the entries it could not read. */
export interface BrowserStorePage<T> {
	readonly entries: readonly T[]
	readonly count: number
	readonly truncated: boolean
	readonly faults: readonly BrowserStoreFault[]
}

/** Keeps journeys by name with a revision per write. */
export interface BrowserJourneyStoreInterface {
	get(name: string, options?: BrowserStoreOptions): Promise<BrowserJourneyRevision | undefined>
	set(journey: BrowserJourney, expected?: number, options?: BrowserStoreOptions): Promise<BrowserJourneyRevision>
	delete(name: string, options?: BrowserStoreOptions): Promise<void>
	list(options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number }): Promise<BrowserStorePage<BrowserJourneyRevision>>
}

/** Names the run directory a store opened, as data. */
export interface BrowserRunSlot {
	readonly id: string
	readonly directory?: string
}

/** Keeps runs by journey name and run id. */
export interface BrowserRunStoreInterface {
	open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot>
	get(name: string, id: string, options?: BrowserStoreOptions): Promise<BrowserRun | undefined>
	set(name: string, run: BrowserRun, options?: BrowserStoreOptions): Promise<void>
	delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void>
	list(name: string, options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number }): Promise<BrowserStorePage<BrowserRun>>
}

/** Configures the journey tools a toolset registers. */
export interface BrowserJourneyOptions {
	readonly store: BrowserJourneyStoreInterface
	readonly runs?: BrowserRunStoreInterface
	readonly readonly?: boolean
}
```

The file twins (`src/server/stores/FileBrowserJourneyStore.ts`, `FileBrowserRunStore.ts`) obey: the root is `realpath`-resolved once; every path is `resolve(root, …)` and must begin with the root and the separator; every component from the root to the target (the journey directory, `runs`, the run directory, `journey.json`, `run.json`, a capture, a temporary file) is `lstat`-checked and a symbolic link anywhere refuses with `BROWSER_JOURNEY_PATH`; the journey store's `delete` removes `journey.json` only; `set` takes `journey.lock` with an exclusive create, waits a bounded time for a lock another process holds (aborting on the signal while it waits) and refuses with `BROWSER_JOURNEY_LOCKED` after it, and inside the lock reads, compares `expected`, assigns the revision, writes a sibling temporary file, and renames, completing the publication once acquired; a failed write removes the temporary file and leaves the previous revision readable; a missing file is `undefined`; a malformed file, a missing or unknown `format`, or a permission error is a typed error naming the path, never `undefined`; `list` sorts by name, applies `offset` and `limit` against a configured cap, probes one extra entry for `truncated`, and reports unreadable files in `faults`; `open` creates the run directory exclusively. The memory twins hold clones and have no directories. One conformance suite runs the shared semantics over both twins of each store (get, set, revision, delete, list, paging, an unknown format refused), and a filesystem suite runs the file twins alone (a reopened path, a truncated file, malformed JSON, a permission error, two instances and two processes over one directory, a symbolic link at each component, a reserved name, a failed write).

The journey tools are a sibling entity, `BrowserJourneyTools` in `src/core/BrowserJourneyTools.ts`, composed over the toolset's public members (`perform`, `hold`, `emitter`, `view`, `tools`) and registered on the toolset's manager when the toolset is constructed with `journeys`; each declares one required parameter; copy in `BROWSER_TOOL_COPY`; a page tool with a reserved name is skipped as today.

| Tool | Description | Annotations | Parameters | Result |
| --- | --- | --- | --- | --- |
| `record` | `Starts recording your next actions as a journey with that name; call save when it is done.` | none | `journey` (string, required) | `Recording add-kettle; each action you take is a step; call save when it is done.` and the view |
| `save` | `Stops recording and saves the journey; describe what it achieves in one sentence.` | none | `description` (string, required) | `Saved add-kettle with 5 steps.` and the listing |
| `journeys` | `Lists the saved journeys with their steps and the parameters each one takes.` | `pure` | `what` (string, required), `offset` (integer) | the listing, cut at the tool limit with `[characters START–END of TOTAL; call journeys with offset END for more]`; `No journeys are saved; call record to start one.` when none |
| `edit` | `Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.` | none | `journey` (string, required), `edits` (array of `BrowserJourneyEditInput`, required) | `Edited add-kettle.` and the listing |
| `replay` | `Replays a saved journey step by step; inputs replace the values its parameters name.` | none | `journey` (string, required), `inputs` (object of strings) | `renderBrowserRun` (the text after this table) |

Every refusal, verbatim:

- `record`: `"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`; `A journey named "add-kettle" is saved; call journeys, or record another name.`; `A journey is recording; call save first.`; `The journeys are read-only; call replay.`
- `save`: `No journey is recording; call record first.`; `Saving add-kettle failed: MESSAGE; call save again.` (persist before publish: the recording stays open)
- `edit`: `No journey is named "checkout"; call journeys.`; `Edit 2 is refused: REASON; call journeys.`; `Journey add-kettle changed since you read it; call journeys, then edit again.`; `The journeys are read-only; call replay.`; `Element e9 is not in the current view; call look for fresh refs.`
- `replay`: `No journey is named "checkout"; call journeys.`; `Journey add-kettle needs the input "email"; call replay with inputs.`; `Journey add-kettle has no parameter "emial"; call journeys.`; `Journey add-kettle has a gap at s4: REASON; call edit to remove or replace it.`; `Journey add-kettle cannot run here: s3 switch needs a browser context; call journeys.`; `Journey add-kettle is recording; call save before you replay another.`; `The toolset is replaying add-kettle until it finishes; call look.`; `Journey add-kettle cannot be read: MESSAGE; call journeys.`
- Resolution, during a replay: `button "Delete" names 2 elements; call look, then edit add-kettle.`; `No button "Add to cart" is on the page; call look, then edit add-kettle.`

The listing (`renderBrowserJourney`), one line per step in the receipt's `ROLE "NAME"` form, a binding shown as `as NAME`, the parameters line marking a secret, never a reference:

```text
add-kettle "Add the Alpine Kettle to the cart" (parameters: email)
s1 navigate https://shop.example.test/
s2 click link "Alpine Kettle"
s3 click button "Add to cart"
s4 type textbox "Email" "sam@example.test" as email, submit
s5 wait "Added to cart"
```

A journey with a secret lists `(parameters: email, password (secret))` and its step as `s6 type textbox "Password" as password (secret), submit`.

`renderBrowserRun`, one receipt line per step and the final view, or the stop line naming the step, the reason, and the next calls:

```text
Replayed add-kettle: 5 of 5 steps.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".
s3 Clicked e31 button "Add to cart".
s4 Typed "ada@example.test" into e33 textbox "Email" and submitted the form.
s5 "Added to cart" is on the page.

page "Cart" https://shop.example.test/cart
…
```

```text
Replay of add-kettle stopped at s3 of 5: No button "Add to cart" is on the page; call look, then edit add-kettle.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".

page "Alpine Kettle" https://shop.example.test/product/p1
…
```

`readonly` refuses `record`, `save`, and `edit` before any store access; `replay` still writes runs, and the guide says so. The tool context's signal reaches every store call and step.

## 8. The browse binary

By the owner's ruling the binary ships in `@orkestrel/browser` as probe ships its own: `bin: { browse: dist/bin/main.js }`, `src/bin/main.ts` (a fourth face with its own check project, like probe's), a bin build config beside the existing ones, `@orkestrel/mcp` promoted from the development tarball edge to a runtime dependency at its published range (`^0.0.34` after it publishes) together with the peers that package declares (`@orkestrel/router`, `@orkestrel/server`), which the wave's dependency set records; the browser package's catalog layer moves to 5. Registration through `.mcp.json` with `node node_modules/@orkestrel/browser/dist/bin/main.js`; no command-line commands.

`BrowserMCPServer` in `src/server/BrowserMCPServer.ts` composes `createMCPServer`, `createMCPLegacy`, and `createStdioServer`: it advertises the whole vocabulary (`look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, `tabs`, `switch`, `record`, `save`, `journeys`, `edit`, `replay`) from one manager before any browser exists, so `tools/list` answers with Chromium absent; the first call of a tool that needs a page launches Chromium with a profile created exclusively under `tmp/browsers/.profiles/<id>/`, opens one page, and constructs the toolset with `context` and `journeys` over the file stores behind the same manager (probe's lazy construction over a fixed tool list); a second server in the same checkout gets its own profile; EOF on stdin, SIGTERM, and SIGINT stop admission, abort the active replay, destroy the browser it launched, and remove its profile; it never attaches to another client's browser.

## 9. The `orkestrel-journey` alignment

Shared: `journey` (one intent), `step`, the `action`, `trigger`, `result` fields, `output`, role and exact accessible name, `trusted`. Distinct: the skill's `record` appends a journal line while the browser's records steps to replay; the skill's `journal` is a run log while the browser's run is a replay; `capture` is a portfolio under `tmp/captures` for the skill and `sN.png` in a run for the browser. A run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists (a later unit under the owner's dependency ruling). The verb map for a skill journey that translates a recorded one: `click` to `clickAccessible(role, name)`, `type` to `fillAccessible` (a `combobox` or `listbox` `type` is refused), `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and page tools are refused. The Journeys concept in the guide states that a model's recording keeps every completed action, as the double orders of v8–v10 show, and names the listing and `edit` with `remove` as the review path. The proposal to scaffold: `references/recorded.md` in the skill named from `SKILL.md`, one bullet in `decide.md`, a `tmp/browsers` row in the orchestration layout, and the `.mcp.json` wiring gated on the `BASE_DEV_DEPENDENCIES` ruling.

## 10. Load-bearing claims

1. `toolset.perform(call, context)` returns the `BrowserAction` for every call of `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, and an adopted page tool that reached a handler, with the target's role, exact name, reference, and frame (page placement) captured before the input is dispatched when a reference resolved, the outcome, stage, reason, and receipt after settlement, `interrupted` returned at once when a dialog opened during the input, `tab` on a `switch`, and `secret` on a secret `type`; `tools.execute` runs the same path and the `action` event carries the same value; the existing settlement cases are unchanged.
2. `elements.find({ role, name, exact: true })` matches the whole normalized accessible name case-sensitively in both placements; the default query is unchanged; a mutation to substring or case-insensitive comparison fails the proof.
3. On a page whose ids, classes, and order changed between record and replay, a uniquely named control resolves by role and exact name without input reaching another element; a duplicated name refuses before any input, whatever reference the step carries (Chromium probe with zero input events asserted).
4. A step whose role and exact name match nothing refuses with `BROWSER_JOURNEY_TARGET` even when its `css` matches exactly one element.
5. Replay through `perform` and a direct `tools.execute` over the same fixture produce equal stage, reason, receipt wording, and changed note; a `click` that opens a dialog returns `interrupted`, the following `dialog` step completes it, the pending input then completes, and no step executes after a failure.
6. Under a hold, an action from a call without the token is refused at admission and one admitted before the hold completes first; a call with the token passes; `wait` and the observations pass; an adopted page tool's call without the token is refused too; the hold releases on every exit including an abort during a held input, after which no following action runs.
7. A `wait` whose text did not appear is `timeout` while its receipt text is unchanged; a mutation to `done` lets a forbidden suffix action run in the test.
8. Preparation refuses before any side effect: a missing or unknown input, a gap step, a native action the placement cannot execute; a page event counter stays at zero after every refusal; a `dialog` step is admitted only after an `interrupted` action; a live DOM refusal at a later step preserves the executed prefix.
9. `editBrowserJourney` is pure and atomic, drops only the parameters the batch unbound, refuses an unbound `declare`, merges `update.arguments` by key, and never reuses an id; the `edit` tool converts `ref` to a target from the current view; `set` with a stale revision refuses inside the lock; a mutation moving the comparison outside the lock fails the two-process test.
10. The file journey store passes the shared and the filesystem suites: reopened path, truncated file, malformed JSON, unknown format, permission error, two instances and two processes over one directory with a lost update refused, stable paging with `truncated` and `faults`, a failed write leaving the previous revision, a symbolic link at each path component refused, a reserved name refused, a `set` waiting on a lock aborting on its signal; a mutation returning `undefined` for a corrupt file fails.
11. The file run store creates each run directory exclusively; two producers forced to one first candidate yield two directories.
12. The page recorder emits one step per gesture with role and exact name, collapses field edits only while the edit is open, records a navigation the gesture caused as evidence and not as a step, distinguishes an Enter from the click it caused, emits `unresolved` for a multiple selection, a child-frame element, and a native dialog answer, and the binding's payload for a password control carries no value (Chromium probe whose oracle is the fixture's own event log projected to gestures by a stated rule).
13. A secret's value never reaches `journey.json`, `run.json`, the listing, the run render, a receipt (`Typed a secret into e33 textbox "Password".`), the `BrowserAction`, a capture's name, or a generated module; a secret parameter cannot bind anything but `type.text`; the `type` tool's `secret` argument produces that receipt for a direct call.
14. Over the same journey, `compileBrowserJourney`'s module and `createBrowserReplay` produce the same page outcome on independently reset fixtures for a delayed in-frame submission, an editable combobox, and a form whose submit navigates; for a journey with an unsupported step, the module's page state at its throw equals the replay's after the same prefix; a mutation that removes a step's call from the generated module fails the outcome assertion; the module type-checks and runs with only `@orkestrel/browser` imported.
15. The `browse` binary of `@orkestrel/browser`, packed and spawned through the mcp package's stdio client in the distribution project, lists the whole vocabulary before Chromium starts and with Chromium absent, then records, saves, edits, and replays; two servers in one checkout own two profiles; its runs land under `tmp/browsers/<name>/runs/`; EOF and SIGTERM end the child process and remove its profile.
16. The store proof's model, with the journey tools and `type`'s `secret` advertised, completes the five existing tasks within their attempt budgets, then records a flow and saves it, lists it, edits it in one batch with a `declare` with a default, an `update` binding a step's `text`, and a `remove` of the duplicate submission, and replays it with an input, judged by page state and the store's files, with the attempts, the malformed calls, and the tool-list cost recorded.

## 11. Guide invariants ruled

| Invariant | Ruling |
| --- | --- |
| 1 (three faces) | amended: a fourth face `src/bin` with its own check project, as probe has |
| 2 (the server's import set) | amended: the server entry imports `@orkestrel/mcp` for `BrowserMCPServer`, a runtime dependency by the owner's ruling; the file stores use `node:fs` only |
| 4 (captures through the page's writer) | kept: a run's captures go through the writer to the run directory the store opened |
| 6 (observable events) | extended: the toolset emits `action`; the recorder emits `start`, `step`, `stop`, `clear`; the codegen emitter's `action` event is retired with the CSS actions |
| 9 (codegen) | restated: the page recorder collapses consecutive edits on one field while the edit is open; `compileBrowserJourney` replaces `compileCodegenScript` and the service replay of the generated module replaces the `#save` case |
| 10 (class parity) | kept: `BrowserCodegen`, `BrowserRecorder`, `BrowserReplay`, `BrowserJourneyTools`, `BrowserMCPServer`, the two memory stores, and the two file stores pair with their interfaces |
| 15 (references are per context) | kept; a journey's `reference` is evidence, never a lookup |
| 18 (FIFO action execution) | amended: while a replay holds the toolset, an action admitted after the hold is refused with `BROWSER_TOOLSET_BUSY` rather than queued |
| 19 (a staged dialog) | amended: a replay's `dialog` step is admitted after an `interrupted` action, the continuation the toolset stages |
| 21 (reserved names) | extended: `record`, `save`, `journeys`, `edit`, `replay` are reserved whenever the toolset is constructed with `journeys` |

## 12. Units (dependency order; the lane per `.agents/orchestration.md` § Routing; a Chromium or host run is an `opus` lane because the codex sandbox refuses loopback binds)

| Unit | Lane | Owns | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| J0 instruments | `opus` | `tmp/probes/journeys/*.test.ts`, its logs, `tmp/units/journeys/probe-report.md` | none | feasibility readings for claims 3, 4, 12 on Chromium 141 with tapes: the exact-name query over a changed page with zero input events on a duplicate, the CSS intersection, the gesture projection rule against a fixture event log; the readings appended to the briefs of J5 and J6 |
| J1 contract | `opus` | `src/core/types.ts`, `src/core/constants.ts` (patterns, codes, copy), `src/core/errors.ts`, `src/core/index.ts`, `src/server/types.ts` | none | every declaration of §§ 2–4 and § 7 present with TSDoc opening on a third-person verb; `check` green; entity members one word |
| J2 leaves | `astra` | `src/core/parsers.ts`, `src/core/validators.ts`, `src/core/helpers.ts` (`validateBrowserJourney`, `editBrowserJourney`, `locateBrowserTarget`, `fillBrowserElement`, `settleBrowserRecord`, `renderBrowserJourney`, `renderBrowserRun`, the run id), their tests | J1 | claim 9's pure part; invariants 1–7 each with a failing case; the listing and the run render byte-equal to § 7's fences |
| J3 exact query | `astra` | the two element managers, their tests | J1 | claim 2 with the two named mutations |
| J4 toolset perform, hold, action, secret | `astra` | `src/core/BrowserToolset.ts`, its tests, `tests/setup.ts` | J1 | claims 1, 6, 7, 13's receipt |
| J5 recorder, replay, memory stores | `astra` writing; `opus` host run | `src/core/recorders/BrowserRecorder.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/Memory*.ts`, `src/core/factories.ts`, their tests | J2, J3, J4, J0 | claims 5, 8, 9's tool part deferred to J8, the shared store suite over the memory twins, 13; claims 3 and 4 on Chromium in the host run |
| J6 page recorder | `astra` writing; `opus` host run | `src/core/recorders/BrowserCodegen.ts` (the recorder half), the recorder source constant, the binding parser, `src/core/BrowserPage.ts` (`codegen()`), their tests | J5, J0 | claim 12 |
| J7 codegen | `opus` | `src/core/compilers.ts` (`compileBrowserJourney`), `BrowserCodegen.script()`, the retirement of the CSS engine, their tests | J6 | claim 14 |
| J8 journey tools | `opus` | `src/core/BrowserJourneyTools.ts`, `src/core/constants.ts` (copy), `src/core/BrowserToolset.ts` (the registration), `src/browser/factories.ts`, their tests | J5 | § 7's table, every refusal string, the two listings, and the run render asserted verbatim; `readonly`; the signal; the `ref` conversion |
| J9 file stores | `astra` writing; `opus` host run for the two-process case | `src/server/stores/File*.ts`, `src/server/factories.ts`, `src/server/constants.ts`, the filesystem suite, their tests | J2 | claims 10, 11 |
| J10 binary | `opus` for the lifecycle and protocol; `builder` for the manifest, the lock, the bin config, and the distribution test's placement | `src/bin/main.ts`, `src/server/BrowserMCPServer.ts`, `package.json` (`bin`, `files`, the mcp runtime range and its peers), the bin build config, `tests/src/bin/`, `tests/src/server/BrowserMCPServer.test.ts`, the packed case in the distribution project | J8, J9 | claim 15 |
| J11 service proofs and the store-proof journey task | `astra` writing; `opus` host runs; the consumer run in `/home/user/ollama` | `tests/service/journey.test.ts`, `tests/setupServer.ts` variants as a patch; the ollama store proof's journey task | J5–J9 | claims 3–9, 12–14 on Chromium 141, three runs; claim 16 |
| J12 guide and README | `opus` | `guides/browser.md`, `README.md`, `tests/guides.test.ts` | J1–J10 | `test:guides` green; Surface rows equal the export list; Methods tables for every interface of §§ 2–4 and § 7; a "Journeys" concept after "Toolset vocabulary" with the review-path sentence; the Tools table rows equal `BROWSER_TOOL_COPY` including `type`'s `secret`; the Receipts rows equal § 7's strings; patterns to record from the toolset, replay with inputs, edit, generate code (rewriting "Record and replay interactions with codegen"), and run the binary with its validated hookup; § 11's table present as a section |
| J13 scaffold proposal | `opus`, in the scaffold checkout with the owner's consent | `SKILL.md`, `references/recorded.md`, `decide.md`, the layout row, the wiring gated on the dependency ruling | J10, J12 | the files exist as § 9 names them; scaffold's policy gate green |
| J14 falsify | Opus `reviewer` and Astra `analyst` | evidence only | J1–J12 | one round; closed when every claim is CONFIRMED or waived by the owner in writing |
| J15 verify | `verifier` | the gates bare | J14 | every gate green on the final tree |

Shared files (`types.ts`, `constants.ts`, `helpers.ts`, `BrowserToolset.ts`, barrels) are edited by one unit at a time in the order listed; a later unit's patch to a shared file is reported and integrated by the Orchestrator.

## 13. The second round's findings, ruled

| Finding | Ruling |
| --- | --- |
| obj 1, obj 5, obj 6, subj 5, subj 6 | `perform` returns the action beside the result, so no call id is needed; the context is a separate argument; the hold token is `context.caller`; `wait` passes the hold; an adopted tool's call without the token is refused |
| obj 5 (dialog) | `perform` returns `interrupted` at once when a dialog opens during the input; the `dialog` step is the continuation; the next `perform` awaits the pending input |
| subj 1 | `target.frame` optional, page placement only; the DOM recorder detects a child-frame element by `ownerDocument` |
| subj 4 | the CSS rung and `via` deleted; `css` is evidence; claim 4 restated |
| obj 10, subj 10, subj O8, obj O4 | `BrowserStorePage` with `faults`, `BrowserStoreFault`, `BrowserStoreOptions` on every store call, `BrowserRunSlot` as data, `set` and `delete` on the run store, the journey `delete` scoped |
| obj 13, subj 12, subj 13 | a secret binds `type.text` only; `inputs` omits secret values; `fillBrowserElement` and `settleBrowserRecord` shared with the toolset; a submit passes a `self` destination; the thrown messages mirror the receipt statuses; a popup-following step is unsupported in the module; one example journey in both fences |
| obj 14, subj 14 | claim 14 restated with the prefix comparison and the editable combobox |
| obj 15, subj O14 | the whole vocabulary advertised before launch over one manager; per-server profiles under `.profiles/<id>/` created exclusively; the packed case in the distribution project; `compileBrowserJourney` a Node API only |
| obj 16, subj 16 | claim 16 with a `declare`, an `update` binding a step, and a `remove` of the duplicate submission |
| obj O1 | `next` persisted |
| obj O2 | an `interrupted` action followed by its `dialog` recorded; `switch`'s action carries `tab` |
| obj O3 | `ref` and `tab` reserved on native actions only |
| obj O5 | containment across every path component |
| obj O6, subj O11 | the listing's `offset` counts characters of the rendered text with `read`'s footer form |
| obj O7 | compile is a Node API only |
| obj O8, subj O16 | J0 feasibility readings; J2's refusals moved to J8; J5's claims corrected; the packed proof in the distribution project; J13 owns `SKILL.md` and its wiring gated; J14's closure defined; writing and host runs split |
| obj O9, subj O19 | prose and TSDoc openings fixed; `output`'s producers named |
| subj O1 | every member declared in §§ 2–4 and § 7, `journeys?: { store, runs?, readonly? }` |
| subj O2 | `revision?: number` |
| subj O3 | `journey()` on the recorder; the parameter-name pattern |
| subj O4 | the binding key `parameter` |
| subj O5 | only unbound parameters dropped; an unbound `declare` refused |
| subj O6 | classes `BrowserCodegen` and `BrowserRecorder` |
| subj O7 | `fault` |
| subj O9, subj O10, subj O13 | descriptions, annotations, every refusal, the busy, ambiguity, and revision sentences, one example |
| subj O12 | `press` compiled to the page's key press; `locateBrowserTarget` generic; the combobox fallback shared |
| subj O15 | invariants 1, 9's compile half, and 10 ruled; the review-path sentence in the Journeys concept |
| subj O17 | taken: `BrowserJourneyTools` as a sibling entity |
| subj O18 | `BrowserMCPServer` |
| subj "line 3" | § 13 of the second revision omitted subj O2; this table and § 2 close it |

## 14. Unresolved

- A portable frame locator, shadow-root and region boundaries: a follow-on unit; gaps in this revision.
- The trusted-input adapter and the browser package in `BASE_DEV_DEPENDENCIES`: the owner's dependency rulings.
- Page output in the DOM placement: a consumer-supplied source or "unavailable".
- Claim 16's run settles the journey tools' cost for the store model.
- The mcp package's peers (`@orkestrel/router`, `@orkestrel/server`) reaching every consumer of the browser package: recorded for the wave; the owner can rule them optional at the mcp package.
