# Browser journeys: the design (fourth and final revision, 2026-09-30)

Written by the Orchestrator after three falsify rounds (`journeys-falsify{,2,3}-{objective,subjective}.md`) over the reconciled proposal (`design-reconciled-v1.md` to `v3.md`). `.agents/orchestration.md` § Size gate ends the depth search at three rounds at one seam, so this revision rules the third round's findings in § 13 and hands the design to the units; the implementation's own falsify round (J14) attacks the claims against code. The owner's rulings stand: codegen stays as the capability that emits a JavaScript or TypeScript module a developer runs as is or customizes; the `browse` binary ships inside `@orkestrel/browser` in a bin config as probe ships its own; toolbox's patterns are prior art.

## 1. The design in one paragraph

A journey is one user intent as JSON: a name, a description, declared parameters, a step counter, and steps that mirror the toolset's own tool calls, each acting step naming its element by role and exact accessible name with the record-time reference and a CSS selector kept as evidence for a developer. One recorder contract produces steps from three sources: the toolset's actions through the structured `BrowserAction` the toolset returns from `perform` and emits as `action`, a person's input on a page through `page.codegen()`, and a hand-written file; a recorder's `journey()` turns the steps into a journey with its parameters derived. Two artifacts derive from the same steps: the journey file, which a model records, lists, edits, and replays through five tools a journey toolset registers on the same manager as `look` and `click`, and a generated module, which `compileBrowserJourney` emits as one readable `toolset.follow` call per step on a toolset the module constructs, so a developer's file runs with the same coordination as a replay and is customized by editing or replacing any step. Replay prepares the whole run before its first side effect, holds the toolset, resolves each target on the live page by role and exact name, refuses ambiguity, executes every step through `perform`, judges each step from the `BrowserAction` it returns, stops at the first step that did not complete, and writes a run under `tmp/browsers/<journey>/runs/<id>/`. A journey store and a run store keep the files with revisions that survive deletion, atomic writes, per-name locks, containment across every path component, paging with faults, and typed corruption errors; memory twins serve core and tests. A `browse` binary in the package serves the vocabulary over MCP on stdio, advertising every tool through its own dispatchers before it launches Chromium. The `orkestrel-journey` skill reads a run's steps and output as automation evidence, and a proposal to scaffold names the shared vocabulary.

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

/** Names the element an acting step acts on the way a receipt names it, with the record-time evidence a developer reads when a resolution is refused. */
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
 * - `gap` — on `unresolved`, why the recorder could not express the gesture; preparation refuses the journey
 */
export interface BrowserJourneyStepInput {
	readonly action: string
	readonly arguments: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>
	readonly target?: BrowserJourneyTarget
	readonly tab?: BrowserJourneyTab
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

/** Describes one change to a journey; `editBrowserJourney` applies a batch to a copy, in order, and refuses it whole on the first invalid edit. */
export type BrowserJourneyEdit =
	| { readonly operation: 'add'; readonly step: BrowserJourneyStepInput; readonly before?: string; readonly after?: string }
	| { readonly operation: 'remove'; readonly id: string }
	| { readonly operation: 'update'; readonly id: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>>; readonly target?: BrowserJourneyTarget; readonly tab?: BrowserJourneyTab }
	| { readonly operation: 'declare'; readonly name: string; readonly parameter: BrowserJourneyParameter }

/** Describes an edit as the `edit` tool receives it over the wire: an added or updated step can name `ref` instead of a target, converted from the current view before the pure editor runs. */
export type BrowserJourneyEditRequest =
	| BrowserJourneyEdit
	| { readonly operation: 'add'; readonly step: Omit<BrowserJourneyStepInput, 'target'> & { readonly ref?: string }; readonly before?: string; readonly after?: string }
	| { readonly operation: 'update'; readonly id: string; readonly ref?: string; readonly arguments?: Readonly<Record<string, BrowserJourneyBinding | BrowserJSONValue>> }
```

Rulings behind the shape:

- A binding is a string argument of a native action (`type.text`, `navigate.url`, `press.key`, `wait.text`, `dialog.text`, a target's `name`); a secret parameter binds `type.text` only, and a `type` step whose `text` binds a secret parameter is secret by derivation, with no flag to forget. A page tool's arguments are literal JSON kept exactly as sent, `ref` and `tab` keys included; those keys are reserved only on the native actions that define them.
- A parameter is text; its name matches `^[a-z][a-zA-Z0-9]*$`; a secret has no default. A `select` control's step records the option's value as `text` when that value selects the option uniquely through the element's `select`, and is a gap otherwise; a multiple selection is a gap.
- No frame in a target: in the page placement an element whose frame is not the main frame is a gap (`gap: 'the element is in a child frame'`), as are shadow-root and region boundaries; the DOM placement records a same-origin child-frame element as an ordinary step because its `find` reaches that frame; a portable frame locator is a follow-on unit. J0's reading R2 (`journeys-probe-report.md`) bounds the CSS premise: a query that carries only `css` resolves elements outside the outline, so the toolset's target resolution never sends `css`. A `switch` step carries the tab's URL and title, never `tN`. The design brief's CSS fallback is retired: on the CDP placement a CSS query intersects the role-and-name outline, so a selector can never resolve what the semantic search did not; `css` and `reference` stay as evidence a developer reads when a resolution is refused.
- `next` persists the id counter, so a removed id is never reused. `format: 1` and the store's `revision` follow toolbox's missing-revision lesson; `validateBrowserJourney` refuses an unknown format with `BROWSER_JOURNEY_FORMAT`.

Invariants (asserted by `validateBrowserJourney(value): asserts value is BrowserJourney`; `parseBrowserJourney` returns the value or `undefined`):

1. `name` matches `^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$` and has at most 64 characters.
2. Step ids are unique and every id's number is below `next`; an added step takes `next` and increments it.
3. A native action's `target` is present exactly when it takes `ref`; `tab` exactly for `switch`; a native action's `arguments` never carries `ref` or `tab`.
4. Every binding names a declared parameter; every declared parameter is bound by at least one step.
5. A secret parameter binds `type.text` only and has no default.
6. `parseBrowserJourney(JSON.parse(JSON.stringify(journey)))` equals `journey`.
7. A journey's actions are `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page tool, and `unresolved`; `look`, `read`, `tabs`, `record`, `save`, `journeys`, `edit`, and `replay` are never steps.

The directory layout under `tmp/browsers` (one file per entry; captures beside the run file, never inside JSON):

```text
tmp/browsers/
  .profiles/
    7f3a-2026-09-30T14-03-12-481Z/   the profile one browse server owns, created exclusively, removed on its exit
  add-kettle/
    revision                         the revision counter, kept across delete and recreate
    journey.json                     { "revision": 3, "journey": { … } }
    journey.lock/                    present only during a set or a delete
      4121-9f2c0b7e-3c2a-4b1d-8e5f-6a7b8c9d0e1f   one empty entry, the holder's process id and token
    runs/
      2026-09-30T14-03-12.481Z-7f3a/
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
}
```

`journey()` derives the parameters: every secret marker declares a secret parameter named after its control's accessible name in lower camel case (`confirmPassword`), falling back to `secret1`, `secret2`, and so on when the derived name is invalid or taken; `next` is one past the highest id.

Three sources, one contract:

- **The toolset's actions.** `createBrowserRecorder(toolset, options)` subscribes to the toolset's `action`, `hold`, and `release` events (§ 4) and turns actions into steps in order: an action with outcome `done` becomes its step; an `interrupted` action whose next action is `dialog` with outcome `done` becomes its step followed by the `dialog` step, and an `interrupted` action followed by anything else becomes a gap; a `switch` step's `tab` comes from the action's `tab`; an action whose `target.frame` is present becomes the child-frame gap (the toolset includes `target.frame` only when the element's frame differs from the dispatching page's main frame at dispatch, so the recorder never consults the current view); a `type` action marked `secret` becomes a `type` step whose `text` binds a secret parameter; `look`, `read`, `tabs`, the journey tools, and a refused action are never steps; the actions between a `hold` and its `release` become one `unresolved` step naming the held journey (`gap: 'replayed add-kettle'`).
- **A person's input on a page.** `page.codegen(options?: BrowserRecorderOptions)` is the one page entry (§ 6): it keeps the in-page listener and the runtime binding, reads the role and exact accessible name of the node the person acted on, and emits journey steps: a click becomes `click`, except a click on a text control that the person then edits, which folds into that `type` step; a committed field edit becomes `type`, consecutive edits on one field collapsing while the edit is open and never across a submission, a focus departure, a navigation, or stop; Enter in a field a form owns becomes `type` with `submit: true`, the shape the toolset records, and Enter in an unedited field becomes `press`; a single select change becomes `type` with the option's value under § 2's rule; a multiple selection, an element whose `ownerDocument` is not the driven document, a person's answer to a native dialog, and any other gesture it cannot express become `unresolved` with the gap; a navigation the gesture caused closes the open edit and is not a `navigate` step. The listener never sends the value of a password control; it sends a marker, and the step binds a secret parameter.
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

/** Carries a performed call's tool result beside its structured action, present when the call reached a handler. */
export interface BrowserToolsetResult {
	readonly result: ToolResult
	readonly action?: BrowserAction
}

/** Owns the toolset while a replay runs; `destroy` releases it. */
export interface BrowserHoldInterface {
	readonly token: string
	readonly name: string
	destroy(): void
}
```

Additions to the toolset's contract, each landing with its implementing unit: `BrowserToolsetInterface.perform(call: ToolCall, context?: ToolContext): Promise<BrowserToolsetResult>` runs the same handler path as `tools.execute` (the manager's handlers call it) and returns the structured action beside the result; `BrowserToolsetInterface.hold(name: string, options?: BrowserCallOptions): Promise<BrowserHoldInterface>` refuses at once with the dialog receipt while the page has an open dialog or an input pending (a replay that started there would wait for an answer its own hold refuses), otherwise takes a queue turn under the call's signal, and reserves admission from the moment it is called: an action tool call without the token that arrives after the call is refused with `BROWSER_TOOLSET_BUSY`, while the actions admitted before it complete first; `BrowserToolsetEventMap` gains `action: [action: BrowserAction]`, `hold: [name: string]`, and `release: [name: string]`; `BrowserElementQuery` gains `exact?: boolean`; `BrowserViewInterface` becomes generic, `BrowserViewInterface<E extends BrowserElementInterface = BrowserElementInterface>` with `elements: BrowserElementManagerInterface<E>`, and `BrowserPageInterface` extends `BrowserViewInterface<BrowserPageElementInterface>`; `BrowserToolsetOptions` and `BrowserDocumentToolsetOptions` gain `journeys?: BrowserJourneyOptions`; the `type` tool gains `secret` (boolean) in `BROWSER_TOOL_COPY`, and during a secret call the toolset redacts the secret text from every receipt and error message it emits, so a lower layer's refusal that quotes the value reaches no result, action, run, or render, and the DOM element's missing-option refusal names no value at all; `BrowserToolName` gains the five journey tools. `target.frame` is present in the page placement only, and only when the element's frame is not the main frame of the page the input is dispatched on; the toolset recorder emits the child-frame gap on its presence.

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
	readonly runs?: BrowserRunStoreInterface
}

/** Maps the events a replay emits. */
export type BrowserReplayEventMap = { readonly step: readonly [step: BrowserRunStep] }

/** Replays one journey over a toolset. */
export interface BrowserReplayInterface {
	readonly emitter: EmitterInterface<BrowserReplayEventMap>
	execute(options?: BrowserCallOptions): Promise<BrowserRun>
}
```

`trigger` per action: a target's exact name for `click` and `type`; the key for `press`; the URL for `navigate`; the text for `wait`; the tab's title for `switch`; `accept` or `dismiss` for `dialog`; the tool's name for a page tool.

`createBrowserReplay(toolset, revision, options).execute(call)`:

1. **Preparation**, before any side effect: validate the journey, merge `inputs` over the parameters' defaults, refuse a missing or unknown input, a gap step, or a native action the placement cannot execute (a page-backed toolset executes `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and, with `context`, `switch`; the DOM placement executes `click`, `type`, `wait`, and its adopted page tools); a refusal rejects `execute` with a coded `BrowserError` (`BROWSER_JOURNEY_INPUT`, `BROWSER_JOURNEY_GAP`, `BROWSER_JOURNEY_PLACEMENT`, or the validator's code) before any run exists; a page tool's availability and a `dialog` step's admissibility are checked when reached; a live target's refusal stops the run at its step with the prefix executed. The stored journey is untouched.
2. **Hold**: `toolset.hold(name, { signal })` takes a queue turn and resolves with the hold; while held, `perform` or `tools.execute` for an action tool whose `context.caller` is not the token is refused at admission with `BROWSER_TOOLSET_BUSY`, `dialog` included; actions admitted before the hold complete first; `look`, `read`, `tabs`, and `wait` pass. `hold.destroy()` runs in `finally`, including abort.
3. **For each step in order**: build the call's arguments by action (the substituted bindings; `ref` for a native action that takes it, from the located target; `tab: tN` for `switch`, from the resolved tab; `secret: true` for a secret `type`; a page tool's arguments unchanged), call `toolset.perform({ id, name, arguments }, { caller: hold.token, signal })`, judge the `BrowserAction` it returns (a call the manager refused before any handler has no action and is judged from `result`), append a `BrowserRunStep`, capture in the page placement, and stop after the first step whose outcome is not `done`, except that an `interrupted` action (the toolset returns at once when a dialog opens during the input, the input staying pending as it does today) admits exactly the immediately following `dialog` step, after which the next `perform` awaits the pending input as the toolset does today.
4. **Finalization**: destroy the hold; write the run through `runs` when given, with a bounded write that carries its own signal rather than the aborted one, recording a write failure in `fault`; resolve with the `BrowserRun`; `output` collects the page's `console` and `error` events during the run in the page placement. A run of a journey with a secret parameter records no `output` and no captures, because a page can republish the value; the receipts are the toolset's, and a page that displays the value displays it (a documented bound). `execute` rejects only at preparation or on a destroyed toolset.

Target resolution (a private method of `BrowserToolset`, which `follow(id: string, step: BrowserJourneyStepInput, options?: BrowserFollowOptions): Promise<BrowserAction>` calls for every step replay and the generated module run): `elements.find({ role, name, exact: true })` on the toolset's current view; exactly one match resolves; several refuse with `BROWSER_JOURNEY_AMBIGUOUS`; none refuses with `BROWSER_JOURNEY_TARGET` (the sentences in § 7). `exact` matches the whole accessible name after the existing whitespace normalization, case-sensitively; the default query keeps its case-insensitive substring. A `switch` step resolves its tab from `tabs` by URL and title, each line read by `parseBrowserTabLine` in `src/core/parsers.ts`; two tabs matching refuse.

Outcome judgement uses the `BrowserAction`, never the receipt text: a `wait` whose text did not appear is `timeout`; a `requested` or `committed` stage stops the run before a following action. A popup the input caused is part of the input's settlement: `Page.windowOpen` on the opener's session (which precedes the input's reply on Chromium 141) names it, `page.popups.record()` settles on its announcement, and the result returns after the view moved to it, with the note `The view moved to a new tab: URL.` and the popup's `{ url, title }` in the action's `tab`; the toolset recorder keeps `tab` only on a `switch` step.

A run id is minted by the producer as `<ISO time with - for :>-<4 hex>` and its directory is created exclusively, retrying on a collision. The DOM placement replays the supported subset with `(untrusted event)` receipts and no captures.

## 5. Editing

`editBrowserJourney(journey, edits)` is pure and atomic: it applies the batch to a copy, in order, checking each edit's own structure as applied (an unknown id, a duplicate anchor, an `update` that removes the target of a `ref`-taking action, a `declare` of a secret with a default) and the cross-step invariants on the final candidate; a parameter this batch unbound is dropped, and a `declare` whose parameter no step binds at the end of the batch is refused; any failure refuses the whole batch with `BROWSER_JOURNEY_EDIT` naming the edit's index and a reason clause (no directive, no final period, such as `declares "email" but no step binds it`). `update.arguments` merges by key. The `edit` tool converts a `ref` in an added or updated step to a target from the current view before the pure editor runs.

The store's `set(journey, expected)` refuses a mismatch between `expected` and the stored revision with `BROWSER_JOURNEY_STALE`, inside the per-name lock (§ 7); `delete` takes the same lock and keeps the `revision` counter, so a recreated journey continues the count and a stale writer is refused.

## 6. Codegen

One recorder, two artifacts, each usable without the other:

- `page.codegen(options?)` is the only page entry: `BrowserCodegenInterface extends BrowserRecorderInterface` with one composing member, `script(options: { readonly language?: BrowserCodegenLanguage; readonly name: string; readonly description: string }): BrowserCodegenScript`, which compiles the steps recorded so far through `compileBrowserJourney`. The class is `BrowserCodegen` in `src/core/recorders/BrowserCodegen.ts` and the toolset recorder is `BrowserRecorder` in `src/core/recorders/BrowserRecorder.ts`. The four CSS actions, `compileCodegenScript`, `normalizeCodegenActions`, `BrowserCodegenAction`, `BrowserCodegenEventMap`, `BrowserCodegenOptions`, and `BrowserCodegenScriptOptions` are retired; `BrowserCodegenLanguage` stays.
- `compileBrowserJourney(journey, options?: { readonly language?: BrowserCodegenLanguage }): BrowserCodegenScript`, where `BrowserCodegenScript` is `{ readonly source: string; readonly gaps: readonly string[] }`, emits a standalone module that imports only `@orkestrel/browser`: `export async function execute(page, inputs)`, typed in TypeScript with a required property per secret parameter and an optional one per defaulted parameter, one `toolset.follow` call per step, and imports only `createBrowserToolset` (and the type import in TypeScript). The module constructs its own toolset over the page, so every step runs with the toolset's coordination (observers, settlement, dialogs, popups, receipts) and equals a replay of the same journey; a developer customizes it by editing a step's target or arguments, inserting raw page calls between steps, or replacing a step. A journey with a gap compiles to an unconditional `throw new Error('s6: the element is in a child frame; handle it here')` before the first step, naming the first gap, with a comment `// s6: the element is in a child frame; handle it here` at each gap's position so a developer sees where to add code after removing the throw; `gaps` lists every gap id in order; the module's refusal equals replay's preparation refusal, with no side effect. The module also checks its inputs before the toolset starts: a required parameter without a value and an input naming no parameter each throw `Error('NAME: the input is missing')` or `Error('NAME: no parameter has that name')` before any step, as replay refuses them at preparation with `BROWSER_JOURNEY_INPUT`; a journey without parameters compiles no check, and a module with a required parameter called without an inputs object reports the first required parameter as missing rather than throwing a `TypeError`, and a defaulted parameter whose supplied value is neither omitted nor a string throws `Error('NAME: the input is not a string')`, as replay refuses it with `BROWSER_JOURNEY_INPUT`. `compileBrowserJourney` is a Node API only.
- `follow(id, step, options?)` on `BrowserToolsetInterface` resolves the target on the toolset's own view (§ 4), builds the arguments by action as replay does, calls `perform`, throws a `BrowserStepError` whose message is `s3: RECEIPT` and whose `action` is the performed `BrowserAction` when the outcome is not `done`, and returns the `BrowserAction`; a `dialog` step after an `interrupted` action runs as its continuation.

The example journey `add-kettle` (the same one § 7 lists): s1 `navigate`, s2 `click` link "Alpine Kettle", s3 `click` button "Add to cart", s4 `type` textbox "Email" bound to `email` (default `sam@example.test`) with submit, s5 `wait` "Added to cart".

```ts
import type { BrowserPageInterface } from '@orkestrel/browser'
import { createBrowserToolset } from '@orkestrel/browser'

export async function execute(page: BrowserPageInterface, inputs: { readonly email?: string } = {}): Promise<void> {
	for (const name of Object.keys(inputs)) if (!['email'].includes(name)) throw new Error(name + ': no parameter has that name')
	if (inputs.email !== undefined && typeof inputs.email !== 'string') throw new Error('email: the input is not a string')
	const toolset = createBrowserToolset(page)
	await toolset.start()
	try {
		await toolset.follow('s1', { action: 'navigate', arguments: { url: 'https://shop.example.test/' } })
		await toolset.follow('s2', { action: 'click', arguments: {}, target: { role: 'link', name: 'Alpine Kettle' } })
		await toolset.follow('s3', { action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } })
		await toolset.follow('s4', { action: 'type', arguments: { text: inputs.email ?? 'sam@example.test', submit: true }, target: { role: 'textbox', name: 'Email' } })
		await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
	} finally {
		await toolset.destroy()
	}
}
```

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

/** Keeps runs by the journey name and run id the run carries. */
export interface BrowserRunStoreInterface {
	open(name: string, options?: BrowserStoreOptions): Promise<BrowserRunSlot>
	get(name: string, id: string, options?: BrowserStoreOptions): Promise<BrowserRun | undefined>
	set(run: BrowserRun, options?: BrowserStoreOptions): Promise<void>
	capture(slot: BrowserRunSlot, name: string, bytes: Uint8Array, options?: BrowserStoreOptions): Promise<string | undefined>
	delete(name: string, id: string, options?: BrowserStoreOptions): Promise<void>
	list(name: string, options?: BrowserStoreOptions & { readonly offset?: number; readonly limit?: number }): Promise<BrowserStorePage<BrowserRun>>
}

/** Configures the journey toolset a toolset constructs. */
export interface BrowserJourneyOptions {
	readonly store: BrowserJourneyStoreInterface
	readonly runs?: BrowserRunStoreInterface
	readonly readonly?: boolean
}

/** Configures a file store: its root under the checkout and the listing cap. */
export interface FileBrowserStoreOptions {
	readonly root: string
	readonly limit?: number
}

/** Registers the five journey tools over a toolset and owns the recording and the active replay. */
export interface BrowserJourneyToolsetInterface {
	readonly recording: string | undefined
	readonly replaying: string | undefined
	destroy(): Promise<void>
}
```

Factories: `createMemoryBrowserJourneyStore()`, `createMemoryBrowserRunStore()` in core; `createFileBrowserJourneyStore(options: FileBrowserStoreOptions)`, `createFileBrowserRunStore(options: FileBrowserStoreOptions)` in the server entry. The file twins (`src/server/stores/FileBrowserJourneyStore.ts`, `FileBrowserRunStore.ts`) obey: the root is `realpath`-resolved once; every path is `resolve(root, …)` and must begin with the root and the separator; every component from the root to the target (the journey directory, `runs`, the run directory, `journey.json`, `run.json`, `revision`, a capture, a temporary file) is `lstat`-checked and a symbolic link anywhere refuses with `BROWSER_JOURNEY_PATH`; the threat boundary is a link present at the check, not a replacement raced in between the check and the use by a writer with access to the operator's own `tmp/browsers`, which is stated as an exclusion; a capture reaches the disk only through `capture(slot, name, bytes)`: the store writes the bytes under the file name into the run directory `open` created for that slot, after the same component check, refusing a slot it did not open, a name outside `sN.png`, and a directory that is missing or linked, and it creates no directory; replay takes the screenshot's bytes from the view and never hands the view a path (the page's writer, which creates parent directories and follows a link, is not on the capture path); the memory twin's `capture` resolves `undefined` and the step carries no `capture`; `set` and `delete` take `journey.lock` as a directory: `mkdir` creates it exclusively, and one exclusively created empty entry inside it named `PID-TOKEN` (the holder's process id and a random token) carries the holder's identity in its name, so the lock's identity exists or not at all, and the holder reads the directory after creating its entry and holds only while that entry is the sole one (a holder delayed between the two steps whose empty directory was removed and replaced would otherwise create its entry inside the replacement), otherwise unlinking its own entry and retrying; a lock whose entry names a live process, or whose shape cannot be read (two entries, an unparseable name, a liveness check failing without `ESRCH`), is refused at once with `BROWSER_JOURNEY_LOCKED` (no waiting, no polling; the tool tells the model to call again); a dead holder's entry is reclaimed by unlinking it under its exact name, which fails for every recoverer but one, then removing the directory, which fails while any entry exists, after which acquisition is retried; an empty directory is a holder between its two steps or a crash between them and is removed the same way, and a holder whose entry creation fails because its directory is gone retries; release unlinks the holder's own entry and removes the emptied directory; attempts are bounded at `BROWSER_JOURNEY_LOCK_ATTEMPTS` and exhaustion refuses with `BROWSER_JOURNEY_LOCKED`; so two recoverers never share the critical section, no live lock is removed (a directory with an entry cannot be removed, and an entry is unlinked only under the exact name of a process found dead), and a crash leaves no permanent lock (a reclaim by renaming a file lock is unsound because a rename binds to the path, never to the holder observed); and inside the lock read, compare `expected` (`expected: 0` means no journey is stored, the create-only write `save` uses, so two servers cannot save one name), take the next value of `revision`, write a sibling temporary file, and rename; a failed write removes the temporary file and leaves the previous revision readable; a missing file is `undefined`; a malformed file is `BROWSER_JOURNEY_FILE`, an unknown `format` is `BROWSER_JOURNEY_FORMAT`, and a permission error is `BROWSER_JOURNEY_ACCESS`, each naming the path, never `undefined`; `list` sorts by name, skips an entry whose name is outside `BROWSER_JOURNEY_NAME_PATTERN` (the server's `.profiles` directory among them) without a fault, applies `offset` and `limit` over readable entries against the configured cap, probes one extra entry for `truncated`, and reports an unreadable journey in `faults`; the `journeys` tool advances its offset by the entries it rendered; `open` creates the run directory exclusively. The memory twins hold clones and have no directories. One conformance suite runs the shared semantics over both twins of each store (get, set, revision, delete, list, paging, an unknown format refused), and a filesystem suite runs the file twins alone (a reopened path, a truncated file, malformed JSON, a permission error, two instances and two processes over one directory, delete and recreate with a stale writer refused, a symbolic link at each component, a reserved name, a failed write).

The journey tools are registered by `BrowserJourneyToolset` in `src/core/BrowserJourneyToolset.ts`, which the toolset constructs when given `journeys` and destroys first (aborting the active replay and removing the five tools), composed over the toolset's public members (`perform`, `hold`, `emitter`, `view`, `tools`); each tool declares at least one required parameter; copy in `BROWSER_TOOL_COPY`; a page tool with a reserved name is skipped as today.

| Tool | Description | Annotations | Parameters | Result |
| --- | --- | --- | --- | --- |
| `record` | `Starts recording your next actions as a journey with that name; call save when it is done.` | none | `journey` (string, required) | `Recording add-kettle; each action you take is a step; call save when it is done.` and the view |
| `save` | `Stops recording and saves the journey; describe what it achieves in one sentence.` | none | `description` (string, required) | `Saved add-kettle with 5 steps.` and the listing |
| `journeys` | `Lists the saved journeys with their steps and the parameters each one takes.` | `pure`, `untrusted` | `what` (string, required), `offset` (integer) | the listing, cut at the tool limit with `[characters START–END of TOTAL; call journeys with offset END for more]`; `No journeys are saved; call record to start one.` when none |
| `edit` | `Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.` | none | `journey` (string, required), `edits` (array of `BrowserJourneyEditRequest`, required) | `Edited add-kettle.` and the listing |
| `replay` | `Replays a saved journey step by step; give each parameter's value under inputs.` | none | `journey` (string, required), `inputs` (object of strings) | `renderBrowserRun` (the templates after this table) |

Every refusal, verbatim; REASON is a clause without a directive:

- `record`: `"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`; `A journey named "add-kettle" is saved; call journeys, or record another name.`; `A journey is recording; call save first.`; `The journeys are read-only; call replay.`; `The toolset is replaying add-kettle until it finishes; call look.` while a replay holds the toolset
- `save`: `No journey is recording; call record first.`; `Saving add-kettle failed: REASON; call save again.` (persist before publish: the recording stays open); `Journey add-kettle is locked; call save again.`
- `edit`: `No journey is named "checkout"; call journeys.`; `Edit 2 is refused: it REASON; call journeys.`; `Journey add-kettle changed since you read it; call journeys, then edit again.`; `Journey add-kettle is locked; call edit again.`; `The journeys are read-only; call replay.`; `Element e9 is not in the current view; call look for fresh refs.`
- `replay`: `No journey is named "checkout"; call journeys.`; `Journey add-kettle needs the input "email"; call replay with inputs.`; `Journey add-kettle has no parameter "emial"; call journeys.`; `Journey add-kettle has a gap at s4 (REASON); call edit to remove or replace s4.`; `Journey add-kettle cannot run here: s3 switch needs a browser context; call journeys.`; `Journey add-kettle cannot run here: s3 press is not available in a page toolset; call journeys.`; `Journey add-kettle is recording; call save before you replay another.`; `The toolset is replaying add-kettle until it finishes; call look.`; `Journey add-kettle cannot be read: REASON; call journeys.`
- Resolution, during a replay: `Step s3 names button "Delete", which 2 elements carry; call edit to remove or replace s3.`; `Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.`

The listing (`renderBrowserJourney`), one line per step, a binding shown as `as NAME`, the parameters line marking a secret and omitted for a journey without parameters, never a reference; the `journeys` listing joins journeys with one blank line:

```text
add-kettle "Add the Alpine Kettle to the cart" (parameters: email)
s1 navigate https://shop.example.test/
s2 click link "Alpine Kettle"
s3 click button "Add to cart"
s4 type "sam@example.test" as email into textbox "Email", submit
s5 wait "Added to cart"
```

The step templates: `sN navigate URL`; `sN click ROLE "NAME"`; `sN type "TEXT" into ROLE "NAME"`, with `as NAME` after the text when bound, `(secret)` in place of the text for a secret, and `, submit` when set; `sN press KEY`; `sN wait "TEXT"`; `sN dialog accept` or `sN dialog dismiss "TEXT"`; `sN switch "TITLE" URL`; `sN TOOL ARGUMENTS` for a page tool with its arguments as JSON; `sN unresolved: REASON` for a gap; a bound target name renders `ROLE "NAME" as PARAMETER`; an unreadable journey renders one line `NAME cannot be read: REASON` with no path.

`renderBrowserRun`: the head line, one line per step carrying the step's `result` with any `; call TOOL` directive stripped, a blank line, and the final view; the head lines are `Replayed add-kettle: 5 of 5 steps.`, `Replay of add-kettle stopped at s3 of 5: REASON.` (the resolution sentence, the receipt's refusal, `"TEXT" did not appear within 5 s`, `the page is still loading URL`, `it requested URL and the page did not change`, or `a dialog opened and s4 is not a dialog step`), and `Replay of add-kettle aborted at s3 of 5.`:

```text
Replayed add-kettle: 5 of 5 steps.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".
s3 Clicked e31 button "Add to cart".
s4 Typed "ada@example.test" into e33 textbox "Email" and submitted the form.
s5 "Added to cart" is on the page.

page "Cart" https://shop.example.test/cart
e40 link "Catalogue"
e41 link "Cart"
e42 link "Checkout"
# Your cart
Alpine Kettle
(3 of 3 elements)
```

`readonly` refuses `record`, `save`, and `edit` before any store access; `replay` still writes runs, and the guide says so. The tool context's signal reaches every store call and step.

## 8. The browse binary

By the owner's ruling the binary ships in `@orkestrel/browser` as probe ships its own: `bin: { browse: dist/bin/main.js }`, `src/bin/main.ts` (a fourth face with its own check project), a bin build config beside the existing ones, `@orkestrel/mcp` promoted from the development tarball edge to a runtime dependency at its published range (`^0.0.34` after it publishes) together with the peers that package declares (`@orkestrel/router`, `@orkestrel/server`), which the wave's dependency set records; the browser package's catalog layer moves to 5. Registration through `.mcp.json` with `node node_modules/@orkestrel/browser/dist/bin/main.js`; no command-line commands.

```ts
/** Configures the browse server. */
export interface BrowserMCPServerOptions {
	readonly root?: string
	readonly headless?: boolean
	readonly executable?: string
	readonly readonly?: boolean
}

/** Serves the browser vocabulary and the journey tools over MCP on stdio. */
export interface BrowserMCPServerInterface {
	start(): Promise<void>
	destroy(): Promise<void>
}
```

`BrowserMCPServer` in `src/server/BrowserMCPServer.ts` (`createBrowserMCPServer(options?)`) composes `createMCPServer`, `createMCPLegacy`, and `createStdioServer`: its own manager holds one dispatcher per name of the whole vocabulary (`look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, `switch`, `record`, `save`, `journeys`, `edit`, `replay`), each with the description and parameters `BROWSER_TOOL_COPY` gives, so `tools/list` answers with Chromium absent; a page tool the toolset adopts after a page loads is mirrored as a dispatcher added to the server's manager when the toolset's manager adds it and removed when it withdraws, so the mcp server's built-in `notifications/tools/list_changed` tells the client; the first call of a dispatcher launches Chromium (one launch, later callers awaiting it) with a profile created exclusively under `tmp/browsers/.profiles/<id>/`, opens one page, and constructs the page toolset with `context` and `journeys` over the file stores on a second manager the toolset owns, so the toolset's `start()` meets no foreign name and guide invariant 21 is untouched; every dispatcher forwards its call to the toolset's manager; a second server in the same checkout gets its own profile; EOF on stdin, SIGTERM, and SIGINT stop admission, abort the active replay, destroy the toolset and the browser it launched, and remove its profile; it never attaches to another client's browser.

## 9. The `orkestrel-journey` alignment

Shared: `journey` (one intent), `step`, the `action`, `trigger`, `result` fields, `output`, role and exact accessible name, `trusted`. Distinct: the skill's `record` appends a journal line while the browser's records steps to replay; the skill's `journal` is a run log while the browser's run is a replay; `capture` is a portfolio under `tmp/captures` for the skill and `sN.png` in a run for the browser. A run's `steps` and `output` are automation evidence for the skill's variant artifact and discharge none of its laws until a trusted-input adapter over the published verbs exists (a later unit under the owner's dependency ruling). The verb map for a skill journey that translates a recorded one: `click` to `clickAccessible(role, name)`, `type` to `fillAccessible` (a `combobox` or `listbox` `type` is refused), `press` to `pressKeys` with the chord translated, `wait` to `waitForText`; `navigate`, `switch`, `dialog`, and page tools are refused. The Journeys concept in the guide states that a model's recording keeps every completed action, as the double orders of v8–v10 show, and names the listing and `edit` with `remove` as the review path. The proposal to scaffold: `references/recorded.md` in the skill named from `SKILL.md`'s read list, one bullet in `decide.md`, a `tmp/browsers` row in the orchestration layout, and the `.mcp.json` wiring gated on the `BASE_DEV_DEPENDENCIES` ruling; the browser guide carries the validated Claude Code hookup (the `.mcp.json` entry, the exact registration and approval steps, and one recorded exchange).

## 10. Load-bearing claims (the implementation's falsify round attacks them against code)

1. `toolset.perform(call, context)` returns the `BrowserAction` for every call of `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, and an adopted page tool that reached a handler, with the target's role, exact name, reference, and frame (page placement) captured before the input is dispatched when a reference resolved, the outcome, stage, reason, and receipt after settlement, `interrupted` returned at once when a dialog opened during the input, `tab` on a `switch`, and `secret` on a secret `type`; `tools.execute` runs the same path and the `action` event carries the same value; two concurrent identical calls each receive their own action; the existing settlement cases are unchanged.
2. `elements.find({ role, name, exact: true })` matches the whole normalized accessible name case-sensitively in both placements; the default query is unchanged; a mutation to substring or case-insensitive comparison fails the proof.
3. On a page whose ids, classes, and order changed between record and replay, a uniquely named control resolves by role and exact name without input reaching another element; a duplicated name refuses before any input, whatever reference the step carries (Chromium, zero input events asserted).
4. A step whose role and exact name match nothing refuses with `BROWSER_JOURNEY_TARGET` even when its `css` matches exactly one element.
5. Replay through `perform` and a direct `tools.execute` over the same fixture produce equal outcome, stage, reason, and receipt wording for every native action (a run step's `result` is the action's receipt; the view notes the tool text appends are view state the run's capture carries), with the arguments built by action (no `ref` on `navigate`, `wait`, `press`, `dialog`, or `switch`; the resolved `tab` on `switch`; a page tool's arguments unchanged); a `click` that opens a dialog returns `interrupted`, the following `dialog` step completes it, the pending input then completes, and no step executes after a failure; a same-origin child-frame element replays in the DOM placement.
6. Under a hold, an action from a call without the token, `dialog` and an adopted page tool included, is refused at admission and one admitted before the hold completes first; a call with the token passes; `wait` and the observations pass; the hold destroys on every exit including an abort during a held input, after which no following action runs; `hold` honours its signal while it waits for its turn.
7. A `wait` whose text did not appear is `timeout` while its receipt text is unchanged; a mutation to `done` lets a forbidden suffix action run in the test.
8. Preparation rejects `execute` with a coded error before any side effect for a missing or unknown input, a gap step, or a native action the placement cannot execute; a page event counter stays at zero after every rejection; a `dialog` step is admitted only after an `interrupted` action; a live DOM refusal at a later step preserves the executed prefix.
9. `editBrowserJourney` is pure and atomic, drops only the parameters the batch unbound, refuses an unbound `declare`, merges `update.arguments` by key, and never reuses an id; the `edit` tool converts `ref` to a target from the current view; `set` with a stale revision refuses inside the lock, including after a delete and a recreate; a mutation moving the comparison outside the lock fails the held-lock precedence test (a held lock is refused with `BROWSER_JOURNEY_LOCKED` before a stale `expected` is compared), and the two-process test shows one writer wins.
10. The file journey store passes the shared and the filesystem suites: reopened path, truncated file, malformed JSON, unknown format, permission error, two instances and two processes over one directory with a lost update refused, delete and recreate with a stale writer refused, stable paging with `truncated` and `faults`, a failed write leaving the previous revision, a symbolic link at each path component refused, a reserved name refused, a held lock refused at once; a mutation returning `undefined` for a corrupt file fails.
11. The file run store creates each run directory exclusively and writes captures only into it; two producers forced to one first candidate yield two directories.
12. The page recorder emits one step per gesture with role and exact name, collapses field edits only while the edit is open, treats a navigation the gesture caused as a boundary that closes the open edit and emits no `navigate` step, distinguishes an Enter from the click it caused and an Enter in an unedited field as `press`, emits `unresolved` for a multiple selection, a cross-document element, a native dialog answer, and a select option that does not round-trip, and the binding's payload for a password control carries no value (Chromium; the oracle is the fixture's own event log projected to gestures by the rule J0 states).
13. A secret's value never reaches `journey.json`, `run.json`, the listing, the run render, a receipt (`Typed a secret into e33 textbox "Password".`), the `BrowserAction`, a capture's name, or a generated module; a secret parameter cannot bind anything but `type.text`; replay forwards `secret: true` into the call; a run of a journey with a secret parameter records no output and no captures; the `type` tool's `secret` argument produces that receipt for a direct call.
14. Over the same journey, `compileBrowserJourney`'s module and `createBrowserReplay` produce the same page outcome and the same step receipts on independently reset fixtures for a delayed in-frame submission, an editable combobox, a form whose submit navigates, a click that opens a dialog followed by a `dialog` step, and a click that opens a popup followed by a step in it; for a journey with a gap, the module's page state at its throw equals the replay's rejection at preparation (no side effect); a mutation that removes a step's call from the generated module fails the outcome assertion; the module type-checks and runs with only `@orkestrel/browser` imported.
15. The `browse` binary of `@orkestrel/browser`, packed and spawned through the mcp package's stdio client in the distribution project, lists the whole vocabulary before Chromium starts and with Chromium absent, then records, saves, edits, and replays; two servers in one checkout own two profiles; two first calls arriving at once on one stdio server launch once (a stdio server has one client, so two clients are two servers); its runs land under `tmp/browsers/<name>/runs/`; EOF and SIGTERM end the child process and remove its profile.
16. The store proof's model, with the journey tools and `type`'s `secret` advertised, completes the five existing tasks within their attempt budgets, then records the form task's flow and saves it, lists it, edits it in one batch with a `declare` with a default, an `update` binding the name step's `text`, and a `remove` of the second submission, and replays it with an input, judged by one recorded order in the store and the files under `tmp/browsers`, with the attempts, the malformed calls, and the tool-list cost recorded.

## 11. Guide invariants ruled (J12 rewrites each affected invariant in place, naming its pinning test)

| Invariant | Ruling |
| --- | --- |
| 1 (three faces) | amended: a fourth face `src/bin` with its own check project, as probe has |
| 2 (the server's import set) | amended: the server entry imports `@orkestrel/mcp` for `BrowserMCPServer`, a runtime dependency by the owner's ruling; the file stores use `node:fs` only |
| 4 (captures through the page's writer) | kept: a run's captures go through the writer into the run directory the store created |
| 6 (observable events) | extended: the toolset emits `action`, `hold`, `release`; the recorder emits `start`, `step`, `stop`, `clear`; the store never polls (a held lock refuses at once); the codegen emitter's `action` event is retired with the CSS actions |
| 7 (the error codes) | extended: `BROWSER_JOURNEY_FORMAT`, `_FILE`, `_ACCESS`, `_PATH`, `_LOCKED`, `_REVISION`, `_EDIT`, `_INPUT`, `_GAP`, `_PLACEMENT`, `_AMBIGUOUS`, `_TARGET`, and `BROWSER_TOOLSET_BUSY` in the table |
| 9 (codegen) | restated: the page recorder collapses consecutive edits on one field while the edit is open; `compileBrowserJourney` replaces `compileCodegenScript` and the service replay of the generated module replaces the `#save` case |
| 10 (class parity) | kept: `BrowserCodegen`, `BrowserRecorder`, `BrowserReplay`, `BrowserJourneyToolset`, `BrowserMCPServer`, the two memory stores, the two file stores, and `BrowserHold` pair with their interfaces |
| 15 (references are per context) | kept; a journey's `reference` is evidence, never a lookup |
| 18 (FIFO action execution) | amended: while a replay holds the toolset, an action admitted after the hold is refused with `BROWSER_TOOLSET_BUSY` rather than queued |
| 19 (a staged dialog) | amended: a replay's `dialog` step is admitted after an `interrupted` action, the continuation the toolset stages; a foreign `dialog` is refused under a hold |
| 21 (reserved names) | extended: `record`, `save`, `journeys`, `edit`, `replay` are reserved whenever the toolset is constructed with `journeys`; the browse server's dispatchers live on its own manager |

## 12. Units (dependency order; the lane per `.agents/orchestration.md` § Routing; a Chromium or host run is an `opus` lane because the codex sandbox refuses loopback binds)

| Unit | Lane | Owns | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| J0 instruments | `opus` | `tmp/probes/journeys/*.test.ts`, its logs, `tmp/units/journeys/probe-report.md` | none | feasibility readings on Chromium 141 with tapes: the exact-name query over a changed page with zero input events on a duplicate; the CSS intersection; the gesture projection rule stated and checked against a fixture event log for click, Enter-in-field, Enter-unedited, select, multiple select, child frame, native dialog, password |
| J1 contract | `opus` | `src/core/types.ts`, `src/core/constants.ts` (patterns, codes, copy), `src/core/errors.ts`, `src/core/index.ts`, `src/server/types.ts` | none | every additive declaration of §§ 2–4, § 7, and § 8 present with TSDoc opening on a third-person verb; the retirements and the interface changes (`perform`, `hold`, the generic view, `BrowserCodegenInterface`) deferred to J4, J6, J7 so `check` stays green; entity members one word |
| J3 exact query and the generic view | `astra` | the two element managers, `BrowserViewInterface`'s generic and `BrowserPageInterface`'s extension in `types.ts`, their tests | J1 | claim 2 with the two named mutations; `check` green |
| J2 leaves | `astra` | `src/core/parsers.ts`, `src/core/validators.ts`, `src/core/helpers.ts` (`validateBrowserJourney`, `editBrowserJourney`, `locateBrowserTarget`, `renderBrowserJourney`, `renderBrowserRun`, the run id, the secret-name derivation, `trigger`), their tests | J3 | claim 9's pure part; invariants 1–6 each with a failing case; the listing, the step templates, and the run render byte-equal to § 7's fences; `trigger` per action |
| J4 toolset perform, hold, action, secret | `astra` | `src/core/BrowserToolset.ts`, its tests, `tests/setup.ts` | J1 | claims 1, 6, 7, 13's receipt and forwarding; `performBrowserStep` in `helpers.ts` |
| J5 recorder, replay, memory stores | `astra` writing; `opus` host run | `src/core/recorders/BrowserRecorder.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/Memory*.ts`, `src/core/factories.ts`, the shared store suite in `tests/setup.ts`, their tests | J2, J4, J0 | claims 5, 8, 13 (the run and the render), the shared suite over the memory twins, invariant 7 for the toolset recorder; claims 3 and 4 on Chromium in the host run |
| J6 page recorder | `astra` writing; `opus` host run | `src/core/recorders/BrowserCodegen.ts` (the recorder half), the recorder source constant, the binding parser, `src/core/BrowserPage.ts` (`codegen()`), `BrowserCodegenInterface` in `types.ts`, their tests | J5, J0 | claim 12; invariant 7 for the page recorder |
| J7 codegen | `opus` | `src/core/compilers.ts` (`compileBrowserJourney`), `BrowserCodegen.script()`, the retirement of the CSS engine and its types, their tests | J6 | claim 14 |
| J8 journey toolset | `opus` | `src/core/BrowserJourneyToolset.ts`, `src/core/constants.ts` (copy), `src/core/BrowserToolset.ts` (the construction), `src/browser/factories.ts`, their tests | J5 | § 7's table, every refusal string, the listing, the step templates, and the run render asserted verbatim; `readonly`; the signal; the `ref` conversion |
| J9 file stores | `astra` writing; `opus` host run for the two-process case | `src/server/stores/File*.ts`, `src/server/factories.ts`, `src/server/constants.ts`, the filesystem suite, their tests | J5 | claims 10, 11 |
| J10 binary | `opus` for the lifecycle and protocol; `builder` for the manifest, the lock, the bin config, and the distribution test's placement | `src/bin/main.ts`, `src/server/BrowserMCPServer.ts`, `package.json` (`bin`, `files`, the mcp runtime range and its peers), the bin build config, `tests/src/bin/`, `tests/src/server/BrowserMCPServer.test.ts`, the packed case in the distribution project | J8, J9 | claim 15 |
| J11 service proofs and the store-proof journey task | `astra` writing; `opus` host runs; the consumer run in `/home/user/ollama` | `tests/service/journey.test.ts`, `tests/setupServer.ts` variants as a patch; the ollama store proof's journey task | J5–J9 | claims 3–9, 12–14 on Chromium 141, three runs; claim 16 |
| J12 guide and README | `opus` | `guides/browser.md`, `README.md`, `tests/guides.test.ts` | J1–J10 | `test:guides` green; Surface rows equal the export list; Methods tables for every interface of §§ 2–4, § 7, and § 8; a "Journeys" concept after "Toolset vocabulary" with the review-path sentence; the Tools table rows equal `BROWSER_TOOL_COPY` including `type`'s `secret`; the Receipts rows equal § 7's strings; the Errors rows for § 11's codes; the Tests entries for the new files; patterns to record from the toolset, replay with inputs, edit, generate code (rewriting "Record and replay interactions with codegen"), and register the binary with its validated Claude Code hookup; each invariant of § 11 rewritten in place naming its pinning test |
| J13 scaffold proposal | `opus`, in the scaffold checkout with the owner's consent | `SKILL.md`, `references/recorded.md`, `decide.md`, the layout row, the wiring gated on the dependency ruling | J10, J12 | the reference is named in `SKILL.md`'s read list and the files exist; scaffold's policy gate green; the wiring's gate stated in the reference |
| J14 falsify | Opus `reviewer` and Astra `analyst` | evidence only | J1–J12 | one round; closed when every claim is CONFIRMED or waived by the owner in writing and every outside finding is ruled |
| J15 verify | `verifier` | the gates bare | J14 | every gate green on the final tree |

Shared files (`types.ts`, `constants.ts`, `helpers.ts`, `BrowserToolset.ts`, barrels) are edited by one unit at a time in the order listed; a later unit's patch to a shared file is reported and integrated by the Orchestrator.

## 13. The third round's findings, ruled

| Finding | Ruling |
| --- | --- |
| obj 5, obj O3 | arguments built by action: `ref` for native ref-taking actions, the resolved `tab` for `switch`, `secret` for a secret `type`, a page tool's arguments unchanged |
| obj 9, obj 10 | the `revision` counter kept across delete and recreate; `delete` locked; the symbolic-link threat boundary stated as a link present at the check; captures written only into the store's run directory by a writer that creates none |
| obj 12, subj 12 | J0's projection rule covers Enter in an unedited field; the instrument settles it |
| obj 13 | secrecy derived from the bound parameter; forwarded as `secret: true`; no output and no captures for a run with a secret; the page-display bound stated |
| obj 14, subj 14, subj O10 | the generated module runs each step through `performBrowserStep` over its own toolset, so submissions, dialogs, popups, and the fill race are the toolset's; the generic view declared; claim 14 restated |
| obj 15, subj O15 | the browse server's dispatchers on its own manager forward to the toolset's manager; invariant 21 untouched; invariant 6 kept by refusing a held lock at once |
| obj 16, subj 16 | claim 16 names the form task's flow and its once-only oracle |
| obj O1, subj O3 | `hold` and `release` events; the recorder folds the held actions into one gap; `include` dropped |
| obj O2 | preparation rejects `execute` with a coded error before any run exists |
| obj O3 | a select option's value recorded when it round-trips, else a gap |
| obj O4, subj O20 | the secret-name fallback `secretN` |
| obj O5, subj 14, subj O4, subj O5, subj O7 | the generic view, `BrowserMCPServerInterface` and its options and factory, the file store options and factories, the journey toolset interface, `page.codegen(options?)`, `BrowserHoldInterface` with `destroy()`, `BrowserToolsetResult`, the event map's TSDoc, the codes `_FILE` and `_ACCESS` |
| obj O6, subj O8 | `set(run)`; `count` dropped |
| obj O7, subj O13 | J1 additive only; J2 after J3; J9 after J5; invariant 7 with J5 and J6; J13's executable checks; J14's closure includes outside findings |
| obj O8, subj O12 | "once acquired" and "in order to" removed |
| subj O1, subj O2 | REASON a clause; one directive per template; the resolution sentences name the step and the edit remedies |
| subj O6 | `BrowserJourneyToolset`, constructed and destroyed by the toolset |
| subj O9 | the toolset recorder's child-frame gap; the DOM placement's same-origin frame steps; claim 5 gains the case |
| subj O11, subj O21 | the step templates, the run render's head lines per outcome, the joins, a complete view in the fence, the directives stripped |
| subj O14 | the invariants rewritten in place with pinning tests; the validated Claude Code hookup in the guide; the Errors rows and the Tests entries |
| subj O16 | `edits` dropped from the replay options |
| subj O17 | `trigger` per action |
| subj O18 | `css` and `reference` as a developer's evidence; the CSS fallback retired in § 2 |
| subj O19 | `journeys` annotated `pure`, `untrusted` |
| subj O20 | "at least one required parameter"; `replay`'s description; the `type` line order; `options?`; `BrowserJourneyEditRequest` |
| subj (referred) | a foreign `dialog` is refused under a hold (§ 11, invariant 19) |

## 14. Unresolved
The step grammar derives the native arguments each action admits from `BROWSER_TOOL_COPY` (so `wait` admits `timeout` as the tool does), and `unresolved` joins the reserved names a page tool cannot take. A listing or store `limit` of 0 and a negative `offset` refuse with `BROWSER_JOURNEY_ARGUMENT`; `BrowserJourneyToolset` takes its listing cap through its options, never a positional parameter. An edit refusal names the edit that introduced the failure, the one whose structure or whose binding the final candidate cannot carry, never the last edit of the batch. A refused `save` keeps the recording open and recording. A child frame's same-document navigation closes no main-frame edit in the page recorder. `follow` takes the step id as a required parameter and invents none. `performBrowserStep` and `locateBrowserTarget` leave `helpers.ts`, whose members are pure leaves by the architecture rule's § Kind purity, and the leaf test sends a composition that reaches sibling members to a method: `BrowserToolsetInterface` gains `follow(id, step, options?)`, the public method that performs one recorded step on the live page (it resolves the target by role and exact name, builds the arguments by action, performs the call, judges the `BrowserAction`, and throws `BrowserStepError`); `BrowserReplay` and the generated module call it, the target resolution is the toolset's private method, and the tab-line match is `parseBrowserTabLine` in `parsers.ts`; the function-domain registration is withdrawn because registration judges nothing about what a module does and reserves its stem fleet-wide. The lock is a directory whose one entry names its holder (§ 7).

The third round's rulings. `tools.execute` runs through the same boundary as `perform`, so a secret call's result is redacted whether the manager answers before the handler (a pre-aborted call) or after it, and the redaction tests assert the sanitized text itself rather than the absence of a prefix. `record` reserves the recording name before its first `await` and releases it when the recorder fails to start, so two concurrent `record` calls yield one recording and one `BROWSER_JOURNEY_RECORDING` refusal. The generated module also refuses a defaulted parameter whose supplied value is neither omitted nor a string (§ 6). `BrowserToolsetInterface` exposes `held` and `limit`; `BrowserJourneyToolset` reads the owner's `limit` when `BrowserJourneyOptions.limit` is omitted, its refusals name the journeys limit, and its overflow directive says to raise the journeys limit; the toolset's own limit refusal is a `BrowserError` coded `BROWSER_TOOLSET_ARGUMENT`. A `hold` while an input is pending and no dialog is open refuses with `An earlier input is still pending; call look.` under `BROWSER_TOOLSET_DIALOG`; admission takes the kinds `observation` and `action`; no private method reuses a public tool verb; the interface remarks list the `action`, `hold`, and `release` events. A listing fault carries the entry's `name` and a path-free `reason`, and `renderBrowserJourneyFault` in `helpers.ts` renders `NAME cannot be read: REASON`; both twins refuse an invalid name in `set` with `BROWSER_JOURNEY_PATH` before shape validation; one exported helper checks a journey name and one checks a page's `offset` and `limit`, read by both twins and the file store; `BROWSER_FILE_STORE_RESERVED` is deleted because `BROWSER_JOURNEY_NAME_PATTERN` already excludes the reserved names; the lock constant is `BROWSER_JOURNEY_LOCK_DIRECTORY`, and one helper pair formats and parses a lock entry for the store and its tests. `BROWSER_OBSERVATION_TOOL_NAMES` is the observation set's home, `BROWSER_JOURNEY_NON_STEP_TOOLS` derives from it and `BROWSER_JOURNEY_TOOL_NAMES`, and the step keys `ref`, `tab`, and `secret` have one home. `follow` throws a `BrowserStepError` (in `errors.ts`) whose `action` is the performed `BrowserAction`, the outcome and stage sets live in `constants.ts`, and `follow` takes the id positionally, with `BrowserFollowOptions` carrying the signal, timeout, hold token, and secret flag, so `BrowserTargetOptions` is gone. The edit validator's error context names the parameter, step, and field, so attribution is one lookup, and one helper normalizes a reason clause. Replay and the `replay` tool share the clause `has no parameter named "X"`; the module's terse `NAME: …` messages stand. The taken-name derivation reads `collectBrowserJourneyBindings` restricted to `type.text` and is named `collectBrowserJourneyTextBindings`. The claim 5 proof resolves the direct side's element through `elements.find` with `exact: true`, never through the locator under test. `BrowserLockObserver` lives in `tests/setupServer.ts`, and `tests/setupGlobal.ts` takes `reservePort` from the service module it already loads dynamically, so the browser projects' global setup imports no server fixture statically. The third round closes the depth search under the size gate; the J15 verification runs `npm test` whole, format and lint included, on the final commit.

The consumer proof's rulings (J11b, the store model `qwen3.5:2b-q4_K_M` through `@orkestrel/ollama`). The journey tools and `type`'s `secret` add 784 prompt tokens to every turn (the full list 1 637, the page vocabulary 853), so the daemon's default 4 096-token window cuts a page task's third turn, and the proof's journey conversation needs a 16 384-token window; the window is the consumer's setting, and the guide's Journeys concept states the measured cost and the window. A journey has at least one step: `validateBrowserJourney` refuses an empty `steps`, `save` refuses an empty recording with `Nothing is recorded for NAME; perform an action, then call save.` under `BROWSER_JOURNEY_EMPTY` and keeps recording, and an edit batch that would leave no step is refused naming the edit. The directives after a save no longer form a loop: `record` of a saved name answers `Journey "NAME" is saved already and nothing is recording; call journeys to list it, edit to change it, or replay to run it.`, and `save` with nothing recording answers `Nothing is recording; "NAME" was saved. Call journeys, edit, or replay.` when the toolset saved a journey in this session, else the existing `No journey is recording; call record first.`. `validateBrowserJourneyEdit` names the operation and the field it refuses (`its "remove" names no step`, `its "declare" has no name`, `its "add" carries both "before" and "after"`, `it names no operation among add, update, remove, and declare`, and their kin), so `Edit N is refused: it REASON; call journeys.` carries the field. The `edit` tool accepts `edits` given as a JSON string of the array and parses it before validation, refusing a string that does not parse by naming the parse error. The recorder records nothing for a `timeout` action, as for `refused`; an `unresolved` gap marks only the child frame, the held replay, and an unanswered interruption. The guide tells a recorder to end with a `wait` for a delayed confirmation when the replay's final view must carry it. Deferred to the owner: a tool that removes a saved journey (the stores' `delete` is not advertised), and a token budget for the advertised copy.

The second consumer run (K2, the store proof on the K1 tree with a 16 384-token window on every attempt) settles the window: no prompt is cut and the form task types the right name in every attempt, while the page tasks' `save` with nothing recording still pulls a task that never meant to record into `record` and then `save`, and the saved-name `record` refusal still repeats. Rulings: `save` with nothing recording and no save in the session answers `No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.`; `save` on an empty recording answers `Nothing is recorded for NAME: the actions before record are not steps. Perform the flow's actions and call save, or answer the user when the task is done.`; `record` of a saved name answers `Journey "NAME" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.`; the `edit` tool's `edits` parameter is advertised as `anyOf` an array and a string, because the installed contract reads a `type` array as a shape that accepts anything. Claim 16 as stated (every task within its attempts in every run) is not met by `qwen3.5:2b-q4_K_M`: the journey task's record, save, list, one edit batch, and replay complete in one run of three on the K1 tree and two of three on the J11b tree, the page tasks complete together in one run of three, and the model's own errors (an Enter after a complete replay, a first click on the cart) account for the rest; the vocabulary's cost is settled at 798 prompt tokens per turn for the journey tools and `secret` on that tokenizer.

The third consumer run (K4, the store proof on the K3 tree, three runs with no test change) closes claim 16 as the evidence stands: the five page tasks complete within their attempts in every run with the journey tools advertised and the 16 384-token window, so the refusal loops the package's own directives caused are gone; the journey task completes its record, save, list, and edit phases and loses the replay phase in every run, because the model keeps issuing `record` and `save` calls after a successful step instead of ending its turn (53, 20, and 34 refused calls after the save in the three runs), which the refusal copy cannot change further. The journey task's record, save, list, edit, and replay held end to end in two of three J11b runs and one of three K2 runs, so the vocabulary is proven usable by the store model and claim 16's every-run wording is recorded as not met. The levers left are the consumer's: a turn that ends after a bounded number of refusals, or a prompt that asks for one sentence after each phase.


Recorded by the first falsify round (J14) and deferred with reasons: the replay reads the view's `emitter` and `screenshot` through structural checks because `BrowserViewInterface` declares no capture capability (a declared optional capability is a later unit); `follow` resolves a `switch` step's tab by reading the `tabs` tool's text through `parseBrowserTabLine`, the only tabs listing the toolset publishes (a structured listing is a later unit); the coded fault of a `perform` travels in a `WeakMap` keyed by the result object, so a copied result loses its code (the result's shape is the tool package's; a `code` member is a cross-package change). The server's unit tests launch Chromium through a recording launch double and an in-memory stdio pair (`BrowserMCPServerOptions.launch` and `stdio`); the real lifecycle is proven by the distribution project's packed cases, which read the process tree, so the double is a seam the unit tests keep for speed, not the evidence. Two-word verbs such as `validateName` and `translateError` stand where one verb would be ambiguous. The error codes the implementation added beyond § 11's table are `BROWSER_JOURNEY_INVALID`, `BROWSER_JOURNEY_MISSING`, `BROWSER_JOURNEY_SAVED`, `BROWSER_JOURNEY_RECORDING`, `BROWSER_JOURNEY_READONLY`, `BROWSER_JOURNEY_DIALOG`, and `BROWSER_SERVER_ENVIRONMENT`; the guide's Errors table carries them.


- A portable frame locator, shadow-root and region boundaries: a follow-on unit; gaps in this revision.
- The trusted-input adapter and the browser package in `BASE_DEV_DEPENDENCIES`: the owner's dependency rulings.
- Page output in the DOM placement: a consumer-supplied source or "unavailable".
- Claim 16's run settles the journey tools' cost for the store model.
- The mcp package's peers (`@orkestrel/router`, `@orkestrel/server`) reaching every consumer of the browser package: recorded for the wave; the owner can rule them optional at the mcp package.
