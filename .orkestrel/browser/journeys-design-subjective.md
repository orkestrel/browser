# Design: browser journeys, the subjective lane (Opus `planner`)

This is the subjective lane. It owns the shape, the names, the guide voice, the vocabulary shared with the `orkestrel-journey` skill and with codegen, the ergonomics from Node, from a page, and through MCP, the `browse` binary's operator experience, and how the units are cut. Sections 3, 4, 7, and 10 state this lane's proposal wherever the objective lane owns the ruling, and each such point is marked "objective rules". Section 12 lists every judgment call as a tension. Paths are absolute.

## 1. The design in one paragraph

A journey is JSON data: one named user intent (`BrowserJourney`: `name`, `description`, `steps`). Its steps mirror the toolset's own tool calls (`BrowserJourneyStep`: `id`, `tool`, `arguments`, `target`, `inputs`), so the journey's vocabulary is the toolset's vocabulary. A step's target names its element the way a receipt does, by role and accessible name, and keeps the record-time reference and a CSS selector beside them.

Every engine lives in `src/core` over the toolset contract:

- **Recording from the toolset.** `createBrowserRecorder(toolset)` records the toolset's successful actions from a `step` event the toolset gains.
- **Recording a person.** `page.recorder()` records a person's own input on a page and replaces `page.codegen()`.
- **Editing.** `editBrowserJourney(journey, edits)` applies `add`, `remove`, and `update` edits. The edits are data and the function is pure.
- **Replay.** `createBrowserReplay(toolset, journey, { inputs, edits }).execute()` resolves each target to a fresh reference and calls the same tool through `toolset.tools`. Each step therefore settles through `navigation.record(frame)` and returns the toolset's own receipt. The result's steps carry the `action`, `trigger`, and `result` fields of the skill's journal.
- **Codegen.** `compileBrowserJourney(journey)` emits a readable module over the element contract.

The toolset gains a `journeys` option. It advertises `record`, `save`, `journeys`, `replay`, and `edit` in the toolset's own tool manager, so a Node program, a page, a model host, and the `browse` binary all see one surface.

The server face adds:

- a file store for `tmp/browsers/<journey>/journey.json`,
- run directories at `tmp/browsers/<journey>/<run>/`,
- `BrowserMCPServer` over stdio, modelled on probe's `ProbeServer`,
- a `browse` command. With no command it serves MCP. Its `record`, `replay`, `journeys`, and `compile` commands serve an operator at a terminal.

`BrowserCodegen` and the four-action CSS recorder are retired.

## 2. The journey data model

### Types

The types go in `/home/user/browser/src/core/types.ts` under a `// === Browser journeys` banner, which replaces `// === Browser codegen` (types.ts:1579-1661).

```ts
/**
 * Describes one user intent as data: the steps a person or a model took from the entry to the outcome.
 *
 * @remarks
 * - `name` — the journey's identity and its directory under `tmp/browsers`, matching
 *   `BROWSER_JOURNEY_NAME_PATTERN`; named for what the person achieves, such as `add-kettle`
 * - `description` — the intent in one sentence, such as `Add the Alpine Kettle to the cart`
 * - `steps` — the steps in replay order
 */
export interface BrowserJourney {
	readonly name: string
	readonly description: string
	readonly steps: readonly BrowserJourneyStep[]
}

/**
 * Describes a step before it holds an id: one call of a toolset tool, with the element it acts on
 * named as data rather than as a reference.
 *
 * @remarks
 * - `tool` — the tool the step calls: `click`, `type`, `press`, `navigate`, `wait`, `dialog`,
 *   `switch`, or the name of a page tool the toolset adopted
 * - `arguments` — the call's arguments without `ref`, as `@orkestrel/tool`'s `ToolCall` names them
 * - `target` — the element the call acts on; present exactly when the tool takes `ref`
 * - `inputs` — maps an argument key to the name of the input that replaces its value at replay;
 *   the recorded value is that input's default
 */
export interface BrowserJourneyStepInput {
	readonly tool: string
	readonly arguments: Readonly<Record<string, unknown>>
	readonly target?: BrowserJourneyTarget
	readonly inputs?: Readonly<Record<string, string>>
}

/** Describes one step of a journey; `id` is `s` followed by a positive integer, stable across edits. */
export interface BrowserJourneyStep extends BrowserJourneyStepInput {
	readonly id: string
}

/**
 * Names the element a step acts on the way a receipt names it.
 *
 * @remarks
 * - `role`, `name` — the accessible role and name, matched exactly
 * - `css` — a selector tried when the role and name match nothing
 * - `reference` — the reference the element held when the step was recorded, kept as evidence
 */
export interface BrowserJourneyTarget {
	readonly role: string
	readonly name: string
	readonly css?: string
	readonly reference?: string
}

/** Names what an edit does to a journey. */
export type BrowserJourneyOperation = 'add' | 'remove' | 'update'

/**
 * Describes one change to a journey, applied in order by `editBrowserJourney`.
 *
 * @remarks
 * - `add` — inserts `step` before or after the step an id names, or appends it when neither is given
 * - `remove` — deletes the step `id` names
 * - `update` — replaces the members it carries on the step `id` names
 */
export type BrowserJourneyEdit =
	| {
			readonly operation: 'add'
			readonly step: BrowserJourneyStepInput
			readonly before?: string
			readonly after?: string
	  }
	| { readonly operation: 'remove'; readonly id: string }
	| {
			readonly operation: 'update'
			readonly id: string
			readonly arguments?: Readonly<Record<string, unknown>>
			readonly target?: BrowserJourneyTarget
			readonly inputs?: Readonly<Record<string, string>>
	  }
```

The following types cover the recorder, the replay, and the store.

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

/**
 * Configures one replay.
 *
 * @remarks
 * - `inputs` — values by input name, replacing the recorded defaults
 * - `edits` — changes applied to a copy of the journey before the first step; the stored journey
 *   is untouched
 * - `directory` — where the run's files go through the page's writer, as
 *   `<directory>/<journey>/<run>/`; omitted, nothing is written
 */
export interface BrowserReplayOptions {
	readonly on?: EmitterHooks<BrowserReplayEventMap>
	readonly error?: EmitterErrorHandler
	readonly inputs?: Readonly<Record<string, string>>
	readonly edits?: readonly BrowserJourneyEdit[]
	readonly directory?: string
}

/** Names how a replay resolved a step's target. */
export type BrowserReplayVia = 'reference' | 'role' | 'css'

/**
 * Describes one replayed step. `action`, `trigger`, and `result` carry the meaning of
 * `@orkestrel/test`'s `JournalStep` fields.
 *
 * @remarks
 * - `id` — the journey step's id
 * - `action` — the tool the step called
 * - `trigger` — what the person acted on: the target's accessible name, or the key, address, or
 *   text an untargeted step carried
 * - `arguments` — the arguments the replay sent, with `ref` resolved and inputs substituted
 * - `success` — the tool's `ToolResult.success`
 * - `result` — the receipt, or the refusal's message
 * - `via` — how the target resolved; absent for an untargeted step
 */
export interface BrowserReplayStep {
	readonly id: string
	readonly action: string
	readonly trigger: string
	readonly arguments: Readonly<Record<string, unknown>>
	readonly success: boolean
	readonly result: string
	readonly via?: BrowserReplayVia
}

/**
 * Describes one replay.
 *
 * @remarks
 * - `journey` — the journey as replayed, edits applied
 * - `inputs` — every input's effective value
 * - `steps` — the steps performed, in order; the replay stops after the first that did not succeed
 * - `output` — what the page logged and threw while the replay ran; absent where the placement
 *   cannot observe it
 * - `run` — the run directory's name when the replay wrote one
 */
export interface BrowserReplayResult {
	readonly journey: BrowserJourney
	readonly inputs: Readonly<Record<string, string>>
	readonly steps: readonly BrowserReplayStep[]
	readonly output?: readonly string[]
	readonly run?: string
}

export type BrowserReplayEventMap = { readonly step: readonly [step: BrowserReplayStep] }

/** Replays one journey over a toolset. */
export interface BrowserReplayInterface {
	readonly emitter: EmitterInterface<BrowserReplayEventMap>
	execute(options?: BrowserCallOptions): Promise<BrowserReplayResult>
}

/** Keeps journeys by name. */
export interface BrowserJourneyStoreInterface {
	save(journey: BrowserJourney): Promise<void>
	load(): Promise<readonly BrowserJourney[]>
	load(name: string): Promise<BrowserJourney | undefined>
	remove(name: string): Promise<void>
	clear(): Promise<void>
}

/**
 * Configures the journey tools a toolset advertises.
 *
 * @remarks
 * - `store` — where `save` writes and `journeys`, `replay`, and `edit` read
 * - `directory` — the replay `directory`, so each `replay` call writes its run
 */
export interface BrowserJourneyOptions {
	readonly store: BrowserJourneyStoreInterface
	readonly directory?: string
}

/** Configures `compileBrowserJourney`. */
export interface BrowserCodegenOptions {
	readonly language?: BrowserCodegenLanguage
}
```

### Changes to existing types

- `BrowserToolsetOptions` gains `journeys?: BrowserJourneyOptions`. `BrowserDocumentToolsetOptions` gains the same key.
- `BrowserToolsetEventMap` gains two events:
  - `step: [step: BrowserJourneyStepInput, receipt: string]`, emitted after an action tool succeeds;
  - `replay: [result: BrowserReplayResult]`, emitted after the `replay` tool.
- `BrowserToolName` gains `record`, `save`, `journeys`, `replay`, and `edit`.
- `BrowserElementQuery` gains `exact?: boolean`, which matches the whole accessible name rather than a substring.
- `BrowserPageInterface.codegen` becomes `recorder(options?: BrowserRecorderOptions): Promise<BrowserRecorderInterface>`, where `BrowserRecorderOptions` is `{ on?, error? }`.
- `BrowserCodegenLanguage` is kept.
- These are retired: `BrowserCodegenAction`, `BrowserCodegenEventMap`, `BrowserCodegenInterface`, the recorder meaning of `BrowserCodegenOptions`, and `BrowserCodegenScriptOptions`.

### Invariants

Every invariant in this list is a proposal; the objective lane rules each one.

1. `name` matches `BROWSER_JOURNEY_NAME_PATTERN`, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and is at most 64 characters. This keeps the directory name portable across hosts.
2. Step ids are unique within a journey. An added step takes one more than the highest id the journey holds.
3. `target` is present exactly when the tool takes `ref`. `arguments` never carries `ref`.
4. Every key in `inputs` names an argument whose value is a string. Two steps that bind one input name record equal values.
5. The inputs are derived by `collectBrowserJourneyInputs(journey)`. No journey-level declaration exists that could drift from the steps.
6. `description` is not empty.
7. `parseBrowserJourney(JSON.parse(JSON.stringify(journey)))` returns an equal value.

### Directory layout under `tmp/browsers`

The following tree shows one journey with one run.

```text
tmp/browsers/
  add-kettle/
    journey.json                   the journey the store keeps; edit it by hand, or through `edit`
    2026-09-30T14-03-12-481Z/      one replay, named for its start time
      replay.json                  the BrowserReplayResult: the journey as replayed, the inputs, the steps with receipts, the output
      s1.png s2.png …              one screenshot per step, taken after its receipt (page placement only)
```

Nothing is persisted outside `tmp/browsers`. A recording in progress is not written until `save`.

## 3. Recording

Objective rules on the algorithms; this section states the sources, the shapes, and what the developer meets.

A journey has three sources.

- **The toolset's calls.** `createBrowserRecorder(toolset)` listens to the toolset's `step` event and assigns ids. The toolset emits `step` after a `click`, `type`, `press`, `navigate`, `dialog`, `switch`, or page-tool call succeeds. The element it acted on becomes `target`: `role` and `name` from the element, `reference` from the call, and `css` computed in the element's document (objective rules on how). The recorder's first step is a `navigate` to the page's address, taken at `start()` on a page-backed toolset. A model host, a Node program, and a page script all record through this source.
- **A person's own input on a page.** `page.recorder()` is the successor of `page.codegen()`. It keeps the page binding and the in-page listener and emits journey steps instead of CSS actions. Clicks become `click`, fills and selects become `type`, and an Enter becomes `press`. It reads role and name for the node the person acted on, which claim 4 settles. It records a main-frame navigation only when no recorded input started it. The `browse record` command uses this source.
- **By hand.** Write the JSON file, or a `BrowserJourney` literal in Node.

The recorder never records the following:

- a pure observation (`look`, `read`, `tabs`);
- a refused call, or one whose `ToolResult.success` is false;
- the `journeys`, `record`, `save`, `edit`, and `replay` tools themselves. A replay's inner steps are recorded, because each one is a toolset action.
- a value typed into a password control. Such a step binds the value as an input with no default, so the stored journey carries the input's name and never the text (objective rules on detection).

The following fence records the toolset's calls from Node.

```ts
import { createBrowserRecorder, createBrowserToolset } from '@orkestrel/browser'

const toolset = createBrowserToolset(page)
await toolset.start()
const recorder = createBrowserRecorder(toolset)
await recorder.start()
// a model or a program drives toolset.tools here
const journey = {
	name: 'add-kettle',
	description: 'Add the Alpine Kettle to the cart',
	steps: await recorder.stop(),
}
```

`normalizeBrowserJourneySteps` carries invariant 9's normalization forward: it collapses consecutive `type` steps on one target to the latest.

## 4. Replay

Objective rules on the resolution ladder and the stop rules. This section states the shape a developer and a model meet.

`execute()` works through the journey in six steps:

1. It applies `edits` to a copy of the journey and merges `inputs` over `collectBrowserJourneyInputs`. An unknown input name is refused before the first step.
2. For a targeted step it resolves the target on the toolset's current view. This lane proposes the following ladder:
   1. The recorded `reference`, when the view's element manager still holds it and its role and name still match (`via: 'reference'`).
   2. `view.elements.find({ role, name, exact: true })` (`via: 'role'`).
   3. `view.elements.find({ css })` (`via: 'css'`).

   An ambiguous match refuses rather than picking one. That matches the skill's "ambiguous across N elements" voice.
3. It calls `toolset.tools.execute({ id, name: step.tool, arguments: { ...substituted, ref } })`. The toolset's `#element` accepts any reference its manager holds (/home/user/browser/src/core/BrowserToolset.ts:839-850), so settlement, the queue, dialog interruption, bounds, and the receipt come from the toolset unchanged.
4. It emits `step` and appends a `BrowserReplayStep`.
5. When a `directory` is set and the view is a page, it saves `sN.png` through `page.screenshot({ path })`.
6. It stops after the first step that did not succeed. A `wait` whose text did not appear counts as a failure even though the `wait` tool's receipt reads as a success; see tension T7.

A step failure is data, not a throw. `execute()` rejects only on abort or a destroyed toolset. This matches `settle` never rejecting at its timeout (/home/user/browser/guides/browser.md:1920). When a `directory` is set, the run's `replay.json` is written through the page's writer, which keeps invariant 4.

The model-facing text is `renderBrowserReplay(result)`. It keeps each step's receipt line and only the final view.

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

A stopped replay names the step, the reason, and the next calls.

```text
Replay of add-kettle stopped at s3 of 5: no button "Add to cart" is on the page; call look, then edit add-kettle.
s1 Navigated to https://shop.example.test/.
s2 Clicked e12 link "Alpine Kettle".

page "Alpine Kettle" https://shop.example.test/product/p1
…
```

A replay runs in two placements. From Node it runs over `createBrowserToolset(page)`. From a page it runs over `createDocumentToolset({ document })`, where its receipts end `(untrusted event)`. The following fence replays with changed inputs and edits.

```ts
import { createBrowserReplay } from '@orkestrel/browser'

const result = await createBrowserReplay(toolset, journey, {
	inputs: { email: 'ada@example.test' },
	edits: [{ operation: 'add', after: 's4', step: { tool: 'wait', arguments: { text: 'Added to cart' } } }],
}).execute()
const passed = result.steps.length === result.journey.steps.length && result.steps.every((step) => step.success)
```

## 5. Editing

`editBrowserJourney(journey, edits)` is a pure helper in `helpers.ts`. It applies the edits in order and returns the edited journey. It throws a `BrowserError` coded `BROWSER_JOURNEY_EDIT` when an edit cannot apply, and the error's `context` names the edit's index and the missing id. An edit list is data, so it has three uses: it travels over MCP, `replay` applies it to a copy, and `edit` persists it.

| Operation | Carries                                       | Refused when                                                                                                                     |
| --------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `add`     | `step`, and at most one of `before` or `after` | both `before` and `after` are given, or the named id is absent                                                                   |
| `remove`  | `id`                                          | the id is absent                                                                                                                 |
| `update`  | `id` and the members it replaces              | the id is absent, or the result breaks an invariant (a `target` on a tool without `ref`, or an `inputs` key naming no string argument) |

Substituting a value at replay is not an edit; it is `inputs`. Turning a recorded value into an input is `update` with `inputs`. An edit that cannot apply at replay refuses the whole replay before the first step, so a journey never runs half-edited. The model-facing refusal is `Step s9 is not in add-kettle; call journeys.`

## 6. Codegen

`compileBrowserJourney(journey, options?: BrowserCodegenOptions)` in `compilers.ts` replaces `compileCodegenScript`. It emits one module that exports one async function, named for the journey in camel case (`add-kettle` becomes `addKettle`), in `'javascript'` or `'typescript'`.

- **The first parameter.** It is a `BrowserPageInterface` when any step needs a page (`navigate`, `press`, or a page tool). Otherwise it is a `BrowserViewInterface`, so the module also runs in a page.
- **The second parameter.** It is `inputs`, typed with every input name, and its default holds the recorded values.
- **Each step.** A comment carries the step's listing line, followed by code over the element contract. A targeted step waits for its target by exact role and name, with the CSS selector as the fallback, so each step parks until its element exists rather than racing a navigation (claim 3). `wait` becomes `view.wait(text)`, `press` becomes `page.keyboard.press(key)`, and `navigate` becomes `page.navigate(url)`.
- **Refused steps.** A `dialog`, `switch`, or page-tool step refuses with `BROWSER_CODEGEN_STEP` naming the step (tension T13).

The following fence shows the output.

```ts
import type { BrowserPageInterface } from '@orkestrel/browser'

/** Add the Alpine Kettle to the cart. */
export async function addKettle(
	page: BrowserPageInterface,
	inputs: { readonly email: string } = { email: 'sam@example.test' },
): Promise<void> {
	// s1 navigate https://shop.example.test/
	await page.navigate('https://shop.example.test/')
	// s3 click button "Add to cart"
	const [s3] = await page.elements.wait({ role: 'button', name: 'Add to cart', exact: true }, { timeout: 5_000 })
	await s3?.click()
	// s4 type textbox "Email" as email, submit
	// … the remaining steps follow the same form
}
```

The four-action recorder is subsumed. Its binding and in-page listener survive inside `BrowserPageRecorder`, and its action list, its normalizer, its compiler, and `BrowserCodegen` are deleted with every consumer updated. The only code consumers are this package's own tests; the other hits are vendored guide mirrors. A compiled script does not settle a navigation through a record and returns no receipt. The guide states that limit and names the replay as the path that settles and receipts.

## 7. The MCP surface and the browse binary

### Tools

The toolset advertises these tools only when it is given `journeys`. Each declares a required parameter (guide :2383). Their copy lives in `BROWSER_TOOL_COPY`.

| Tool       | Parameters                                                      | Annotations | Description                                                                                  | Result                                                                                                      | Refusals                                                                                                                                                                |
| ---------- | --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record`   | `journey` (string, required)                                    | none        | `Starts recording your next actions as a journey with that name; call save when it is done.` | `Recording add-kettle; each action you take is a step.` and the fresh view                                   | `A journey named "add-kettle" is saved; call replay, or record under another name.`; `Journey add-kettle is recording; call save before you record another.`             |
| `save`     | `description` (string, required)                                | none        | `Stops recording and saves the journey; describe what it achieves in one sentence.`          | `Saved add-kettle with 5 steps.` followed by the listing                                                     | `No journey is recording; call record first.`                                                                                                                           |
| `journeys` | `what` (string, required)                                       | `pure`      | `Lists the saved journeys with their steps and the inputs each one takes.`                   | the listing of every journey, or `No journeys are saved; call record to start one.`                          | none                                                                                                                                                                    |
| `replay`   | `journey` (string, required), `inputs` (object of strings)      | none        | `Replays a saved journey step by step; inputs replace the values it names.`                  | `renderBrowserReplay`; the run is written when `directory` is set                                            | `No journey is named "add-ketle"; call journeys.`; `add-kettle takes no input "mail"; call journeys.`                                                                    |
| `edit`     | `journey` (string, required), `edits` (array of edits, required) | none        | `Changes a saved journey: add, remove, or update steps by their ids from journeys.`          | `Edited add-kettle.` followed by the listing                                                                 | the `editBrowserJourney` refusal; `No journey is named …`                                                                                                                |

The listing is `renderBrowserJourney`. It writes one line per step in the receipt's `ROLE "NAME"` form, without the reference.

```text
add-kettle "Add the Alpine Kettle to the cart" (inputs: email)
s1 navigate https://shop.example.test/
s2 click link "Alpine Kettle"
s3 click button "Add to cart"
s4 type textbox "Email" "sam@example.test" as email, submit
s5 wait "Added to cart"
```

There is no delete tool. Deleting a journey is an operator's act on `tmp/browsers/<journey>/`.

### The binary

The binary follows probe's pattern (/home/user/orkestrel/probe/src/bin/main.ts:1-10):

- `package.json` gains `"bin": { "browse": "dist/bin/main.js" }`, and `files` gains `dist/bin`.
- `src/bin/main.ts` runs `process.exitCode = await new BrowserCommand().execute(process.argv.slice(2))`.
- With no command, `BrowserCommand` starts `BrowserMCPServer`. It launches or attaches a browser, opens one page, and builds a toolset over it with `context` and `journeys: { store: createFileBrowserJourneyStore({ directory }), directory }`. It serves `toolset.tools` through `createMCPServer` and `createStdioServer`, the same composition as `ProbeServer.#publish` (/home/user/orkestrel/probe/src/server/ProbeServer.ts:186-210).

The binary is registered the way probe's is (/home/user/orkestrel/probe/README.md:25-41).

```json
{
	"mcpServers": {
		"browse": {
			"command": "node",
			"args": ["node_modules/@orkestrel/browser/dist/bin/main.js"],
			"cwd": "/srv/checkout"
		}
	}
}
```

The operator types the following at a terminal, through `npx browse`.

```text
browse                                                                        serve MCP on stdio (what .mcp.json registers)
browse record NAME --url URL --description TEXT                               open a headed window; record the person's input until the tab closes or Control+C; save
browse replay NAME [--input KEY=VALUE]...                                     replay; print the replay text and the run directory
browse journeys                                                               print every journey's listing
browse compile NAME [--language typescript] [--out FILE]                      print or write the compiled module
global flags: --headed (show the window), --port PORT (attach to or launch on that CDP port), --directory DIR (default tmp/browsers); --input repeats
```

The exit codes follow the skill-script convention:

- 0: done.
- 1: a replay stopped at a step, a journey is missing, `record` meets a saved name, or the browser refused.
- 64: a usage refusal. The command names on stderr what it refused.

The split between the terminal and the model host is as follows:

- A person records their own input at the terminal. A model records the tool calls it makes through `record` and `save`.
- Both can list and replay.
- The operator edits `journey.json` in an editor, because the file is the edit surface. A model edits through `edit`.

## 8. The `orkestrel-journey` alignment

### Shared and distinct vocabulary

| Term                               | Skill (`@orkestrel/test/browser`)                                    | Browser                                                                                           | Ruling                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| journey                            | one user intent proven as a Vitest test                              | one user intent kept as data (`BrowserJourney`)                                                   | shared: one intent, named for what the person achieves; `description` is the intent                     |
| step                               | `JournalStep`                                                        | `BrowserJourneyStep`, `BrowserReplayStep`                                                          | shared                                                                                                  |
| `action`, `trigger`, `result`      | `JournalStep` fields (/home/user/browser/guides/test.md:262)           | `BrowserReplayStep` fields with the same meanings                                                 | shared                                                                                                  |
| `output`                           | `JournalInterface.output`: console calls and uncaught errors          | `BrowserReplayResult.output`                                                                      | shared                                                                                                  |
| role, accessible name, exact match | the resolver matches the name exactly (layer.md:134)                  | `BrowserJourneyTarget`, `BrowserElementQuery.exact`                                                | shared                                                                                                  |
| `within`                           | `clickAccessibleWithin(region, role, name)` (layer.md:318)            | `BrowserElementQuery.within` (a reference)                                                        | same word, different operand; a region target is deferred (T5)                                          |
| trusted                            | law 7: journeys carry trusted input (SKILL.md:200-201)                | `view.trusted`; receipts end `(untrusted event)`                                                   | shared                                                                                                  |
| record                             | `journal.record(action, trigger, result)` appends one log step        | the recorder and the `record` tool capture steps to replay                                        | distinct senses of one word; the guide names both                                                       |
| journal                            | the skill's run log                                                  | none; the browser's run record is a replay                                                        | distinct                                                                                                |
| replay                             | none                                                                 | `BrowserReplay`, the `replay` tool, and the HAR manager's `replay` (guide :2217-2225)              | browser only                                                                                            |
| capture                            | portfolio screenshots under `tmp/captures/states`                    | the view a receipt carries, and `sN.png` in a run directory                                        | distinct (T9)                                                                                           |
| variant                            | `JourneyVariant`                                                     | none                                                                                              | skill only                                                                                              |

### The proposal to scaffold

The skill is scaffold's, so this is a proposal.

1. **A reference file.** Add `references/recorded.md` to `/home/user/scaffold/.agents/skills/orkestrel-journey/`, and name it in SKILL.md's Read list: "before replaying or translating a recorded journey". It states:
   - How to record an intent against a served build with `browse record`, which captures a person's trusted input, and replay it with `browse replay`.
   - That a run's `replay.json` `steps` and `output` enter the per-variant artefact the way a journal's do.
   - That a step resolved `via: 'css'` is a surface finding under "Resolve the population": the control lost its role or its accessible name.
   - That a skill journey calls a recorded journey by translating each step into its verb. The mapping is: `click` to `clickAccessible(role, name)`, `type` to `typeAccessible` or `fillAccessible`, `press` to `pressKeys`, and `wait` to `waitForText`. `navigate` and `switch` are refused inside a journey, which enters through the real entry. The translation is required because the in-page face dispatches untrusted events, which law 7 forbids.

   The reference teaches through the binary and the JSON file and carries no fenced import of `@orkestrel/browser`. That package is outside `BASE_DEV_DEPENDENCIES` (/home/user/scaffold/src/core/constants.ts:563-574), and documentation.md:101 refuses such a fence.
2. **The rendered artefact.** In `references/decide.md` § The rendered artifact, add one bullet: "the `steps` and `output` of each recorded journey's replay the variant ran".
3. **The tmp layout.** In `/home/user/scaffold/.agents/orchestration.md` § tmp layout, add a row: `tmp/browsers/` holds journeys and their replays, which the `browse` server records.
4. **The wiring.** In `/home/user/scaffold/.claude/AGENTS.md` § Wiring, register `browse` in `.mcp.json` where the workspace declares `@orkestrel/browser`.

A later step, not proposed now, is an `@orkestrel/test/browser` verb that replays a journey's steps through its own trusted verbs. That verb makes "call as a step" literal, and it needs a dependency ruling (section 12, U4).

## 9. Alternatives ruled out, constraints, and refusals

### Alternatives ruled out

1. **A typed step union per tool** (`{ tool: 'click', target } | { tool: 'type', target, text, submit } | …`). It duplicates the toolset's argument validation (`validateBrowserToolArguments`). It cannot carry page tools. It drifts whenever the vocabulary gains a tool. The `ToolCall` mirror keeps one validator, the toolset's.
2. **Replay directly over the element contract, as a second actor beside the toolset.** It would duplicate the settlement, the receipts, the dialogs, and the queue. The C6 and C7 settlement took six review rounds to close (ledger:330-359), and the brief requires the toolset's receipt vocabulary.
3. **Journey tools in a sibling entity that publishes into the same manager.** It duplicates the boundary (the limit, the footers, the dialog refusal, the destroy check) and needs start-order coordination of reserved names.
4. **Journeys built by parsing receipts out of transcripts.** A receipt is model-facing prose tuned per small-model run; C8 changed a status line (ledger:364). A parser would freeze that prose. The `step` event carries the data structurally.
5. **`{{email}}` template strings for inputs.** They need a parser and escaping. The `inputs` map is plain data and keeps the recorded value as the default.
6. **An MCP-only binary, as probe is.** A person's own recording needs a headed window without a model host, and a regression replay needs no model.
7. **A skill journey replaying through `createDocumentToolset`.** Its events are untrusted, which law 7 forbids (SKILL.md:200-201).

### Constraints

- Single-word members, and `run` refused as a synonym of `execute`: /home/user/scaffold/AGENTS.md:50; /home/user/scaffold/.claude/rules/names.md:27-31 and :232.
- A discriminant names its axis (`operation`, `via`): names.md:118 and AGENTS.md:56.
- Inputs derived, never stored: AGENTS.md:55.
- No compatibility shims: AGENTS.md:64 and architecture.md:304.
- The store shape, and concrete stores under `stores/`: /home/user/scaffold/.claude/rules/architecture.md:240-252.
- An extension category gets its folder (`recorders/`): architecture.md:232-238.
- A runtime entry declares nothing: architecture.md:52.
- `on` is reserved for emitter hooks, and the emitter pattern applies: /home/user/scaffold/.claude/rules/patterns.md:27 and :73-79.
- Event names are one present-tense verb or noun: patterns.md:104.
- `src/bin/main.ts`, and the `bin` key naming the command: /home/user/scaffold/.claude/rules/workspace.md:25 and :36-40.
- Core imports: /home/user/browser/guides/browser.md:2495. Bytes through a writer: :2497. Codegen: :2502. References: :2508. One action at a time: :2511. Reserved names: :2514. Every tool declares a required parameter: :2383.
- The contracts touched: /home/user/browser/src/core/types.ts:1582-1586 (the codegen action), :1778-1783 (`BrowserElementQuery`), :2121-2131 (`BrowserToolName`), :2178-2182 (the toolset events), :2204-2214 (the toolset options), :2281-2287 (`BrowserReceipt`), and :301-320 (the navigation record).
- `@orkestrel/mcp` is a development dependency only: /home/user/browser/package.json:97-104 and :108.
- The tmp layout has no `tmp/browsers` row: /home/user/scaffold/.agents/orchestration.md:99-108.
- The journal shape: /home/user/browser/guides/test.md:262 and :953-959. The transcript call shape: /home/user/ollama/tests/setupStore.ts:652-661.

### Refusals

- **`run` as a method or tool name.** names.md:232: "Never introduce synonyms such as `cancel`, `reset`, or `run` for these meanings." The design uses `replay` for the tool, following the HAR precedent, and `execute` for the method.
- **Keeping `BrowserCodegen` beside the recorder.** AGENTS.md:64: "No compatibility shims. Update every consumer in the same change."
- **Keeping a `script()` method that forwards to the compiler.** architecture.md:162: "A public class method … never exists only to forward 1:1 to a helper."
- **`kind` or `type` as the discriminant of an edit or a step.** AGENTS.md:56: "Name the axis (`relationship`, `command`, `category`), never `kind` or `type`."
- **A journey tool with no required parameter.** Guide :2383: "Every tool declares at least one required parameter."
- **A fenced `@orkestrel/browser` import in the skill.** documentation.md:101: "Import only packages in `BASE_DEV_DEPENDENCIES` in those fences."
- **A shell launcher for the binary.** AGENTS.md:45: "Never write a bash, PowerShell, or Python script."

## 10. Load-bearing claims

Each claim names the instrument that settles it. The objective lane owns this list; these are the claims this lane's shape depends on.

1. A reference minted by `find` or `wait` is accepted by the toolset's `click` and `type` in the CDP and DOM placements. Settled by a unit case in `tests/src/core/BrowserToolset.test.ts` and a case in `tests/src/browser/factories.test.ts`.
2. `find({ role, name, exact: true })` returns the same element in both placements on the fixture pages. Settled by a case in `tests/service/document.test.ts` comparing the placements.
3. `elements.wait({ role, name, exact: true })` resolves on the destination document after a cross-document navigation of the main frame. Codegen depends on it. Settled by a real-Chromium probe under `tmp/probes/journeys/`, with a tape.
4. `page.recorder()` reads the role and accessible name of the node a trusted click, fill, or select targeted, through `Accessibility` by `backendNodeId`, before a navigation drops the node. Settled by a real-Chromium probe with a tape.
5. A journey recorded through the toolset replays on a fresh page in another context, each step reaching the receipt stage it reached when recorded. Settled by `tests/service/journey.test.ts`.
6. On the fixture's changed variant, where the CSS id is renamed and the button moved, the target resolves `via: 'role'`. With the accessible name renamed it resolves `via: 'css'`. With both gone the replay stops at that step with the refusal receipt. Settled by `tests/service/journey.test.ts` over fixture variants in `tests/setupServer.ts`.
7. `inputs` replaces the recorded value, an unknown input refuses before the first step, and a password control records no value. Settled by unit cases and one service case; detection is settled by the claim 4 probe.
8. `editBrowserJourney` refuses each case in the section 5 table with `BROWSER_JOURNEY_EDIT` and never returns a journey that breaks an invariant in section 2. Settled by unit cases in `tests/src/core/helpers.test.ts`.
9. The spawned `dist/bin/main.js` answers MCP `initialize` and `tools/list` with the journey tools. `record`, a `click`, and `save` write `tmp/browsers/<name>/journey.json`. `replay` writes `<run>/replay.json` and `sN.png`. Settled by `tests/service/browse.test.ts`, with the command's parsing and exit codes in `tests/src/bin/`.
10. A compiled module type-checks under the package's strict configuration and replays the fixture flow on a fresh page. Settled by the service case that replaces the `#save` replay at `tests/service/browser.test.ts:1210-1234`.
11. `parseBrowserJourney` and the guide's journey example round-trip. Settled by a unit case and a guide fence.

### Measurements

The following readings are supplied:

- The store proof's v8 to v10 runs: the tool path is stable, and the form task recorded two orders from a model's second submission (ledger:365-371).
- The P1 to P9 settlement readings that replay inherits by calling the toolset (c6 and c7 probe reports).
- The gate set at `8686f68`: `test:src` 1249, `test:guides` 207, `test:service` 53 (ledger:368).

The following readings are missing:

- claims 3 and 4 on Chromium 141;
- the duration of a replayed step against `BROWSER_TOOL_TIMEOUT_MS`;
- the binary's time to answer `tools/list`, with and without launching the browser first;
- whether `qwen3.5:2b-q4_K_M` calls `journeys` and `replay` correctly: a store-proof task in `@orkestrel/ollama` measures it;
- password-control detection in both placements.

## 11. Units

The units are listed in dependency order. Each unit edits only its owned files, and a shared file is report-only: the unit returns an exact patch. Routing follows /home/user/scaffold/.agents/orchestration.md:42-47.

| Unit | Lane (engine) | Owned files | Depends on | Acceptance |
| ---- | ------------- | ----------- | ---------- | ---------- |
| J0 probe | `astra` (Astra) | `tmp/probes/journeys/*.test.ts`, `tmp/probes/journeys/logs/`, `tmp/units/journeys/probe-report.md` | none | claims 3, 4, and 7's detection each read twice on Chromium 141 with tapes; `npm run test:probe` exit 0 |
| J1 types | `opus` (Opus) | `src/core/types.ts` (the journey, recorder, replay, store, toolset, query, and page members), `src/server/types.ts` (`BrowserMCPServer*`, `BrowserCommand*`, `FileBrowserJourneyStoreOptions`) | none | `npm run check:src:core` and `check:src:server` exit 0; every member one word; TSDoc per typescript.md; the codegen types left in place for J7; an `analyst` pass on the invariants |
| J2 journey leaves | `astra` | `src/core/helpers.ts` (`editBrowserJourney`, `collectBrowserJourneyInputs`, `normalizeBrowserJourneySteps`), `src/core/parsers.ts` (`parseBrowserJourney`, `parseBrowserJourneyEdit`), `src/core/constants.ts` (`BROWSER_JOURNEY_NAME_PATTERN`, the error codes), and their tests | J1 | claims 8 and 11; `npx vitest run --config vite.config.ts --project src:core tests/src/core/helpers.test.ts tests/src/core/parsers.test.ts` green |
| J3 query `exact` | `astra` | `src/core/elements/BrowserElementManager.ts`, `src/browser/elements/BrowserDOMElementManager.ts`, and their tests | J1 | exact and substring cases in both placements; `test:src:core` and `test:src:browser` green |
| J4 toolset `step` event | `astra` | `src/core/BrowserToolset.ts`, `tests/src/core/BrowserToolset.test.ts` | J1 | `step` emitted after each successful action with the target data, and never after a refusal or an observation; claim 1; the existing settlement cases unchanged |
| J5 recorder, replay, memory store | `astra` | `src/core/recorders/BrowserToolsetRecorder.ts`, `src/core/BrowserReplay.ts`, `src/core/stores/MemoryBrowserJourneyStore.ts`, `src/core/factories.ts` (`createBrowserRecorder`, `createBrowserReplay`, `createMemoryBrowserJourneyStore`), and their tests; barrel rows as a patch | J2, J3, J4 | the section 4 algorithm over the in-memory CDP transport and a DOM toolset; the stop rule; the `step` event; the run files written through a recording writer; claim 7 |
| J6 render, codegen, journey tools | `opus` | `src/core/helpers.ts` (`renderBrowserJourney`, `renderBrowserReplay`, serial after J2), `src/core/compilers.ts` (`compileBrowserJourney`), `src/core/constants.ts` (`BROWSER_TOOL_COPY` rows, serial after J2), `src/core/BrowserToolset.ts` (the `journeys` option, the five handlers, the `replay` event, reserved names, serial after J4), `src/browser/factories.ts` and `src/browser/types.ts` (`journeys` passed through), and their tests | J5 | the copy and receipts in section 7 verbatim or improved with a stated reason; the listing and replay text in sections 4 and 7; the compiled output in section 6 under both languages |
| J7 page recorder and codegen retirement | `astra` | `src/core/recorders/BrowserPageRecorder.ts`, `src/core/BrowserPage.ts` (`recorder()`), `src/core/constants.ts` (the recorder source), `src/core/parsers.ts` (the recorder payload); delete `src/core/BrowserCodegen.ts`, `compileCodegenScript`, `normalizeCodegenActions`, `parseCodegenActionPayload`, `parseCodegenNavigateAction`, and the codegen types; move `tests/src/core/BrowserCodegen.test.ts` to `recorders/BrowserPageRecorder.test.ts`; update `tests/src/core/BrowserPage.test.ts:1586-1696` and `tests/service/browser.test.ts:585-629` and `:1210-1234` | J0, J6 | claims 4 and 10; no `codegen` symbol left in `src` or `tests`; `test:src:core` and `test:service` green |
| J8 file store | `builder` (Sonnet) | `src/server/stores/FileBrowserJourneyStore.ts`, `src/server/factories.ts` (`createFileBrowserJourneyStore`), `src/server/constants.ts` (`BROWSER_JOURNEY_DIRECTORY`), `tests/src/server/stores/FileBrowserJourneyStore.test.ts` | J1, J2 | the store contract over a scratch directory: missing name returns `undefined`, removing a missing name is a no-op, `clear` empties, the layout in section 2 |
| J9 MCP server, command, binary | `opus`, with an `analyst` review of the stdin and signal lifecycle | `src/server/BrowserMCPServer.ts`, `src/server/BrowserCommand.ts`, `src/server/parsers.ts` (the arguments), `src/server/constants.ts` (usage), `src/bin/main.ts`, `configs/src/vite.bin.config.ts`, `tests/src/bin/`; `package.json`, `vite.config.ts`, `tsconfig.json`, and `tests/config.test.ts` as patches | J6, J8, the owner's ruling on T1 | claim 9; the usage line and exit codes in section 7; invariant 2 amended for `src/server` and `src/bin` |
| J10 service proofs | `astra` | `tests/service/journey.test.ts`, `tests/service/browse.test.ts`; `tests/setupServer.ts` fixture variants as a patch | J5, J7, J9 | claims 2, 5, 6, and 9 on Chromium 141; `test:service` green in three runs |
| J11 guide and README | `opus` | `/home/user/browser/guides/browser.md`, `/home/user/browser/README.md`, `tests/guides.test.ts` (internal list) | J1 to J10 | `npm run test:guides` green; the sections listed after this table; invariants 6, 9, and 21 restated and 2 amended; no banned term |
| J12 scaffold proposal | `opus`, in the scaffold repository, with the owner's consent | the scaffold files named in section 8 | J9, J11 | scaffold's `test:policy` green; the skill names only verified symbols |

J11 gives the guide the following sections:

- Surface rows for every export.
- Methods tables for `BrowserRecorderInterface`, `BrowserReplayInterface`, `BrowserJourneyStoreInterface`, `BrowserMCPServerInterface`, and `BrowserCommandInterface`.
- A concept section, "Journeys", after "Toolset vocabulary". It opens: "A journey is one user intent as data: the steps a person or a model took, each a call of a toolset tool whose target is named by role and accessible name. You record a journey once, edit it as data, and replay it with other inputs; codegen compiles it to a module you can edit as code."
- The journey tools and their receipts added to the Tools and Receipts tables.
- Patterns: "Record a journey from the toolset", "Replay a journey with other inputs", "Edit a journey", "Generate code from a journey", "Record and replay a journey in a page", and "Serve journeys over MCP with the browse binary". The last one absorbs "Host the toolset over MCP". "Record and replay interactions with codegen" is deleted.
- Tests rows.

## 12. Unresolved, tensions, and risks

### Unresolved

- **U1.** Whether a CDP session from Vitest browser mode (the `cdp()` function Vitest's Playwright provider exposes) can carry `CDPClient`, so a skill journey could replay through a page-backed toolset with trusted input. A probe inside a Vitest browser project settles it.
- **U2.** A format version member in `journey.json`. The objective lane rules on it.
- **U3.** Whether `@orkestrel/browser` joins `BASE_DEV_DEPENDENCIES` so scaffold can wire `browse` in every generated workspace. The owner rules.
- **U4.** A trusted replay verb in `@orkestrel/test/browser`. It needs `@orkestrel/test` to read the journey type, either through an authorized dependency or a structural copy, and fleet name ownership rule 1 prefers reuse. The owner rules.

### Tensions

- **T1.** `src/server` imports `@orkestrel/mcp`, which becomes a runtime dependency. AGENTS.md:36 requires an explicit request. The owner asked for "a browse mcp script like our probe script". The Orchestrator confirms with the owner.
- **T2.** The journey tools live in `BrowserToolset` behind `journeys`, which grows a large class, rather than in a sibling entity (alternative 3).
- **T3.** The journey tool names are reserved only when `journeys` is set, so a page's own `save` tool is adopted otherwise. Invariant 21 then reads conditionally.
- **T4.** Resolving by reference first in the same session, or by role first always.
- **T5.** An ambiguous target refuses rather than picking the first match; `within` region targets are deferred.
- **T6.** Whether a replay holds the toolset queue across its steps. If it does not, a concurrent call interleaves between steps. If it does, the step calls must bypass `tools.execute` to avoid waiting on the queue the replay holds.
- **T7.** The `wait` tool reports "did not appear" as a success. The replay judges the step either by the receipt or by a direct `view.wait`.
- **T8.** One `replay.json` per run, as proposed, or the brief's separate journey, inputs, and receipts files.
- **T9.** Run screenshots under `tmp/browsers/<journey>/<run>/`, or under `tmp/captures/`, which the orchestration layout names for screenshots.
- **T10.** The `tmp/browsers` row in scaffold's tmp layout.
- **T11.** One `editBrowserJourney` over `operation`-discriminated data, or split helpers under names.md § Split behavioral variants. This lane reads the edit list as data.
- **T12.** CLI commands in the binary, as proposed, or MCP only.
- **T13.** Codegen refuses `dialog`, `switch`, and page-tool steps rather than emitting partial code.
- **T14.** `output` in the replay result, for parity with the journal, against its capture cost.
- **T15.** The store's bulk shape with a `load(name?)` overload, a shape the stores rule does not name.
- **T16.** Launching the browser lazily at the first tool call, so `tools/list` answers before a launch. This conflicts with a toolset constructed over a page.
- **T17.** `description` is required.
- **T18.** Password detection per placement.

### Risks

- **R1.** A journey recorded from a model inherits its detours: the v8 to v10 form runs submitted twice. The listing from `journeys` and `edit` with `remove` are the review path, and the guide says so.
- **R2.** Each journey tool adds to what a 2-billion-parameter model reads. The tools appear only with `journeys`. The missing store-proof measurement settles whether they hurt.
- **R3.** Accessible names that carry counts or locale text ("Cart (2)") fail the exact match and fall to `css`. The `via` field makes that visible, and the skill reads it as a finding.
- **R4.** A compiled module does not settle navigations. It relies on claim 3.
- **R5.** Secrets on disk. `inputs` substituted at replay are written into `replay.json`. The replay writes the input's name in place of a value bound from a password control.
- **R6.** Retiring `page.codegen()` breaks the public API. The only code consumers are this package's tests; the other hits are vendored guide mirrors.
