## 1. The design in one paragraph

Make a journey a versioned JSON document containing stable step identities, semantic targets, typed input bindings, and explicit observations. A core recorder builds that document from toolset operations or page events; a pure editor produces another revision; a core runner validates, resolves, executes, settles, and journals each step through the existing page and element contracts. Extract the toolset’s action coordination into a shared core implementation so replay inherits its navigation records, submission observers, dialog handling, input-release barriers, and receipt wording. Codegen compiles the same document into a module that invokes this runner. Register journey operations beside the existing browser tools in the same `ToolManagerInterface`; a `browse` stdio MCP binary supplies browser launching and files under `tmp/browsers`. Integrate with `orkestrel-journey` through a narrow execution adapter that calls its published trusted-input verbs and produces its actual `{ steps, output }` journal shape. A completed automation run reports the operations and observations that completed; the skill remains responsible for proving the user’s outcome.

## 2. The journey data model

The following names describe the objective contract. Reconciliation with the SUBJECTIVE lane can change names without weakening these semantics. Put the authoritative declarations in `src/core/types.ts`.

The document carries replay instructions, not retained browser objects or tool-result prose.

```ts
/** Represents a literal value or a reference to one declared journey input. */
export type BrowserJourneyBinding<T> =
	| T
	| { readonly input: string }

/** Declares the value shape one input accepts. */
export type BrowserJourneyInput =
	| {
			readonly format: 'text'
			readonly default?: string
			readonly secret?: boolean
	  }
	| {
			readonly format: 'strings'
			readonly default?: readonly string[]
	  }

/**
 * Describes one element independently of its reference.
 *
 * Role and name match exactly after the existing whitespace normalization.
 * CSS is a fallback within the declared scope, never a first-match instruction.
 */
export interface BrowserJourneyLocator {
	readonly role?: string
	readonly name?: BrowserJourneyBinding<string>
	readonly css?: string
}

/**
 * Describes a boundary entered before resolving a target.
 *
 * Scopes are ordered from the outermost boundary to the innermost.
 * Every boundary must resolve uniquely.
 */
export interface BrowserJourneyScope {
	readonly boundary: 'frame' | 'shadow' | 'region'
	readonly locator: BrowserJourneyLocator
}

/**
 * Describes the recorded target and the boundaries that contain it.
 *
 * Reference records what the recorder acted on. It is not portable identity.
 * Recorded targets retain the observed role and name, including an empty name.
 */
export interface BrowserJourneyTarget extends BrowserJourneyLocator {
	readonly reference?: string
	readonly scope?: readonly BrowserJourneyScope[]
}

/**
 * Describes a tab by observable facts rather than its recorded t-number.
 *
 * URL is absolute. Supplied fields must all match exactly.
 */
export interface BrowserJourneyPage {
	readonly url: BrowserJourneyBinding<string>
	readonly title?: BrowserJourneyBinding<string>
}

/** Describes an executable operation or a recording gap requiring an edit. */
export type BrowserJourneyCommand =
	| {
			readonly action: 'click'
			readonly target: BrowserJourneyTarget
	  }
	| {
			readonly action: 'fill'
			readonly target: BrowserJourneyTarget
			readonly text: BrowserJourneyBinding<string>
			readonly submit?: boolean
	  }
	| {
			readonly action: 'type'
			readonly target: BrowserJourneyTarget
			readonly text: BrowserJourneyBinding<string>
	  }
	| {
			readonly action: 'select'
			readonly target: BrowserJourneyTarget
			readonly values: BrowserJourneyBinding<readonly string[]>
			readonly submit?: boolean
	  }
	| {
			readonly action: 'press'
			readonly key: BrowserJourneyBinding<string>
			readonly focus?: BrowserJourneyTarget
	  }
	| {
			readonly action: 'hover'
			readonly target: BrowserJourneyTarget
	  }
	| {
			readonly action: 'navigate'
			readonly url: BrowserJourneyBinding<string>
	  }
	| {
			readonly action: 'wait'
			readonly text: BrowserJourneyBinding<string>
			readonly timeout?: number
	  }
	| {
			readonly action: 'look'
			readonly what: string
	  }
	| {
			readonly action: 'read'
			readonly what: string
			readonly offset?: number
	  }
	| {
			readonly action: 'tabs'
			readonly what: string
	  }
	| {
			readonly action: 'switch'
			readonly destination: BrowserJourneyPage
	  }
	| {
			readonly action: 'dialog'
			readonly category: BrowserDialogCategory
			readonly message: BrowserJourneyBinding<string>
			readonly accept: boolean
			readonly text?: BrowserJourneyBinding<string>
	  }
	| {
			readonly action: 'capture'
			readonly state: string
	  }
	| {
			readonly action: 'unresolved'
			readonly reason: string
	  }

/**
 * Gives one operation a stable identity.
 *
 * Page is an optional precondition on the current view, not a navigation.
 * Timeout is a positive finite duration in milliseconds.
 */
export interface BrowserJourneyStep {
	readonly id: string
	readonly command: BrowserJourneyCommand
	readonly page?: BrowserJourneyPage
	readonly timeout?: number
}

/**
 * Represents one immutable revision of a recorded or authored journey.
 *
 * Entry describes the required starting page. The host prepares that page;
 * the runner checks it without silently navigating.
 */
export interface BrowserJourney {
	readonly version: 1
	readonly id: string
	readonly revision: string
	readonly parent?: string
	readonly title: string
	readonly entry?: BrowserJourneyPage
	readonly inputs: Readonly<Record<string, BrowserJourneyInput>>
	readonly steps: readonly BrowserJourneyStep[]
}
```

`fill` replaces a field’s contents in one operation. `type` replaces its contents through individual trusted keystrokes. The existing tool named `type` records the operation it actually performed: ordinarily `fill`, or `select` for a native select control. Its original tool name and arguments remain in the recording evidence.

The following invariants bind the model:

- JSON contains no functions, expressions, handles, DOM nodes, signals, protocol sessions, or executable imports.
- The schema version describes the file format. A revision identifies immutable content. Neither is a package version.
- Step identities are unique within a journey and survive edits that preserve the step. Array position determines execution order.
- Bindings name declared inputs. Every use must agree with its input’s value shape. Substitution replaces a complete field; it performs no string interpolation or code evaluation.
- Empty text is valid for a field replacement. Empty wait text is refused.
- A target requires a semantic locator or CSS. A recorded reference alone is insufficient.
- Recorded references, frame ids, session ids, backend ids, and tab numbers are evidence only. A different run never interprets them as live identities.
- Scopes are bounded, ordered data. An inaccessible scope is a refusal, not permission to search outside it.
- Commands execute in order. The document contains no implicit branching, retry, optional step, or exception-swallowing construct.
- An `unresolved` command makes a document inspectable and editable but prevents replay.
- Validation and preparation own their inputs and return immutable snapshots. They never mutate caller-owned documents.
- The validator enforces configured byte, collection, nesting, and string bounds before launching or acting. Reuse the installed `@orkestrel/contract` schema, guard, and parser capabilities.
- Capabilities are derived from commands and the selected execution backend. Do not persist a second capability list that can drift.
- Recording evidence, run evidence, and replay instructions remain distinct. A recording failure is not silently removed from the instructions.

The server owns this layout:

```text
tmp/browsers/
  <journey>/
    journey.json                     # current published revision
    revisions/
      <revision>.json                # immutable definitions
    <run>/
      manifest.json                  # operation, revision, source, bounds, lifecycle
      journey.json                   # exact definition used or produced
      inputs.json                    # effective substitutions; secret slots omitted
      events.ndjson                  # ordered recording or execution events
      receipts.ndjson                # structured per-step outcomes and rendered receipts
      journal.json                   # { steps, output }
      result.json                    # terminal result; absent during execution
      captures/
        <step>-<state>.png
      runtime/
        profile/                     # owned browser profile; removed after teardown
```

A recording and an edit also receive operation directories. Their manifests distinguish `record`, `edit`, and `run`; only replay produces execution receipts. An edit’s directory retains its changes and resulting definition.

Directory identifiers are validated single path components. They cannot collide with reserved filenames or directories. Capture names are identifiers, not caller-supplied paths. The filesystem implementation refuses traversal, absolute paths, and symlink escapes.

Publish a revision only after its immutable file exists, then atomically replace `journey.json`. Serialize revision publication across processes with an exclusive workspace-local lock. An abandoned operation directory remains inspectable; it never becomes a successful run merely because its process disappeared.

All package-managed artifacts and owned browser profiles stay under `tmp/browsers`. The binary explicitly supplies its run-local profile instead of using `Browser`’s operating-system temporary-profile default. It removes only that owned runtime directory after browser termination.

## 3. Recording

Recording has separate sources, selected when the recording begins. The source determines where intent originates; it does not create another journey format.

| Source | Recorded instructions | Recorded evidence |
|---|---|---|
| Toolset | Native operations after argument validation and target description, before input | Original call, normalized command, resolved target, structured outcome, receipt, timing |
| Page events | Supported human interactions and explicitly identified package-driven operations | Event sequence, target description, input provenance, navigation observations, recording gaps |
| Authored JSON | Validated commands supplied by the author | Validation and revision provenance |

For toolset recording, instrument the shared operation boundary, not rendered text and not a wrapper around arbitrary `ToolManager.execute` calls. Target information must be captured while the original reference still exists. A click that navigates can invalidate it before the tool returns.

Keep these target facts:

- The observed accessible role and normalized accessible name.
- The reference used during recording.
- The semantic scope needed to distinguish repeated controls.
- Frame and open-shadow-root boundaries.
- A CSS fallback anchored inside those boundaries.
- The current page URL and title as evidence; promote them to step preconditions only through the recorder’s documented rule or an explicit edit.
- Live document identity in recording evidence, so an event from an old document cannot attach to a later step.

The element managers need a supported way to describe a referenced target and its scope. The present interfaces expose neither durable CSS descriptions nor a portable boundary path. Add that capability at the element-manager boundary; do not make the recorder scrape receipt strings.

Page-event recording installs observation before declaring itself ready. It observes replacement documents and attached frame sessions through the page’s existing lifecycle. The in-page source follows accessible same-origin documents from a surviving host realm. It reports cross-origin or inaccessible boundaries explicitly.

Normalize gestures by their causal boundaries:

- Consecutive field `input` events may become one `fill` only while the same edit remains open.
- Commit the edit before a click, Enter, Tab, selection, navigation, focus departure, or recording stop.
- Do not collapse across a submission or an observed application effect.
- A select change records the complete selected-value array.
- A key that causes a click or submission records one initiating operation; its resulting events are evidence.
- A navigation caused by a recorded click or submission is settlement evidence, not an additional `navigate` command.
- A trusted key sequence records its focus precondition. Replay checks focus; it does not silently focus the target to make the sequence work.
- Standalone navigation becomes a `navigate` command only when the source establishes a navigation instruction. An unexplained commit, POST result, history traversal, or script navigation cannot safely be converted to a GET instruction. Record a gap when its cause is unavailable.

Toolset recording and page-event recording must not independently append the same action. Use operation identities for package-driven gestures. Do not deduplicate by elapsed-time proximity or matching text.

The recorder preserves failed attempts. For example, the v10 click transcript contains a refused `type` on “Add to cart” and unsuccessful waits whose tool transport results have `success: true`. Keep those observations. A reusable successful flow requires explicit removal or replacement of those steps; `stop` does not invent that edit.

Stop establishes an admission cutoff, drains already admitted reports, flushes an open field edit, removes installed listeners and scripts, and returns the frozen document plus recording evidence. A lost session produces an incomplete recording with a gap. Repeated stop calls return the same result.

Never record as replay instructions:

- Model prompts, answers, reasoning, or inferred intent.
- Arbitrary page JavaScript, raw CDP commands, router calls, or application-store mutations.
- Cookies, storage snapshots, authorization headers, or profile contents.
- Literal password values or inputs explicitly marked secret.
- Mouse movement and every key’s low-level down/up pair when one supported gesture expresses the operation.
- Page-authored tool invocations as if they were native browser interactions.
- An unsupported gesture silently omitted from an otherwise “complete” flow.

A secret field records a required input slot without a default. Rendering and persistence omit that value before building receipts. Raw event payloads containing it are not retained. Captures around protected fields require masking or are reported unavailable. This does not claim that arbitrary page-authored output can always be recognized as sensitive.

A page-tool invocation or unsupported gesture leaves an `unresolved` step with a reason and recording evidence. The editor must replace or remove it before replay.

## 4. Replay

Replay prepares the entire run before its first side effect:

1. Validate and own the journey.
2. Pin its revision.
3. Apply the complete edit batch, if supplied by an in-process caller.
4. Resolve every input from the supplied value or declared default.
5. Refuse missing inputs, unknown inputs, shape mismatches, unresolved steps, invalid URLs, invalid key chords, and unsupported capabilities.
6. Establish the execution owner and its cancellation signal.
7. Check the entry precondition.
8. Execute the prepared steps in document order.

The binary prepares a fresh page at the declared entry. An in-process caller can supply an already prepared page or DOM view. An entry is not an instruction hidden from the run record: the manifest records host preparation separately.

### Target resolution

Resolve from fresh manager observations, not from the bounded text of `look`. A target omitted from the displayed outline can still be found through the manager.

The resolution algorithm is:

1. Check the step’s page precondition.
2. Resolve each scope uniquely, from outermost to innermost.
3. Search the final scope by role and exact normalized accessible name.
4. If exactly one semantic candidate exists, retain its live identity and proceed to actionability checks.
5. If several semantic candidates exist, refuse ambiguity. Do not use an old reference, ordinal, CSS position, or first match to choose one.
6. If no semantic candidate exists, consider CSS only in the same scope.
7. A CSS candidate must be unique and satisfy every supplied semantic constraint. A renamed button is not accepted merely because its old selector still matches.
8. For a deliberately CSS-only target, require one candidate and report that CSS supplied its identity.
9. Recheck the live target’s identity and eligibility immediately before input.

The existing `find({ name })` uses a case-insensitive substring. Replay must add exact matching or filter fresh candidates with the documented exact rule. It cannot use the existing query unchanged.

The existing CDP CSS search is main-document scoped. Frame and shadow fallback therefore require explicit manager support. Do not pretend `find({ css })` already resolves a portable nested path.

A reference cached during this run may avoid redundant work only while its manager and document identity remain valid, and only after its semantic constraints are checked. A reference read from the journey file is never such a cache.

If the target disappears before any input is dispatched, permit one fresh resolution under the same deadline. After any input may have been sent, refuse rather than repeat the action. Hidden, disabled, covered, unreachable, ambiguous, and unsupported targets never trigger a search for a different element.

The resolution record carries the recorded locator, selected strategy, current role/name/reference, scope, and any pre-input re-resolution. It states what was resolved without claiming the page remained unchanged afterwards.

### Execution by command

The shared action implementation supplies the following behavior:

| Command | Execution |
|---|---|
| `click` | Resolve, check actionability, and call the element’s click operation. |
| `fill` | Replace the field contents through `fill`; if `submit` is true, submit only if the edit did not already start navigation. |
| `type` | Resolve an editable control, select and replace its value through trusted keyboard input. Refuse a backend without this capability. |
| `select` | Select the exact value array. Preserve the programmatic selection marker; optionally submit under the same rule as `fill`. |
| `press` | Verify any recorded focus precondition, then send the chord to existing focus. Never call `focus()` to satisfy the precondition. |
| `hover` | Resolve and use the page element’s trusted hover operation. |
| `navigate` | Apply the toolset’s absolute-URL and scheme checks, then use page navigation and its load contract. |
| `wait` | Use the view’s visible-text wait. A timeout is a failed step, regardless of how a tool transport represents its sentence. |
| `look` | Capture the current outline and its limits. |
| `read` | Use the toolset’s retained-reading and offset semantics. Record the actual returned range. |
| `tabs` | Observe the context’s tab list. Recorded t-numbers remain evidence only. |
| `switch` | Resolve the destination uniquely by its supplied URL and title, then select it through the shared context coordinator. |
| `dialog` | Require the expected category and exact message, then accept or dismiss the already open dialog. |
| `capture` | Invoke the supplied capture capability at that point and record the resulting artifact identity. |
| `unresolved` | Refuse during preparation; it never reaches execution. |

No command invokes a page-registered tool as a substitute for a missing control.

### Settlement

Move action coordination out of the private-only toolset path into one core implementation consumed by both tool handlers and replay. Its responsibilities include queue ownership, observers, navigation records, pending input, dialogs, followed pages, structured outcomes, and receipt rendering.

For page-backed input:

- Install the applicable submission observers before the first input.
- Open `page.navigation.record(frame)` before that input.
- Race input completion with the record’s start observation.
- Retain unfinished input and release operations as the action barrier.
- Read observed submissions without turning an unavailable reading into `submitted: false`.
- Settle through the navigation record, using its destinations and existing frame/session/loader rules.
- Retain the selected navigation’s `stage`, `url`, and `reason`.
- Capture the view after settlement, under the existing bounded capture-and-settlement contract.
- Destroy the record and remove owned observers on every exit.

Do not copy the navigation selection algorithm into the runner. C6’s cross-process swaps and C7’s reason lifetime belong to the page and navigation record.

A `requested` or `committed` stage is truthful incomplete settlement. Autonomous replay stops before its next ordinary action. It does not retry the input or declare the step complete because a receipt was returned.

A prevented submission is not an instruction to press Enter again. Preserve the toolset’s sentence naming `wait`. The next recorded observation can wait for the declared outcome. A successful input without that observation proves only that the input completed.

`BrowserNavigationRecord` selects by arrival, not by proven causation. Preserve that limitation in the structured result. A record may select a delayed navigation from an earlier action; a rendered outcome assertion is stronger evidence than a selected navigation alone.

A DOM view executes the supported subset and retains `(untrusted event)`. It has no CDP navigation record. The shared coordinator must therefore expose a placement-specific settlement boundary: CDP uses `navigation.record(frame)`; DOM uses its existing document lifecycle and available observations, without inventing CDP reasons or trusted input. Capabilities unavailable in that placement are refused during preparation.

### Dialogs, popups, and ownership

A dialog can interrupt an input before its command returns. The runner records the interrupting receipt, retains the pending input barrier, and admits only the immediately following matching `dialog` step as its continuation. That handler bypasses the ordinary queue exactly as the toolset’s handler does. After the decision, finish the pending action before advancing.

An unexpected dialog, a mismatched expected dialog, or another ordinary step while a dialog is open stops the run. Replay never accepts a dialog merely to unblock itself.

Keep the toolset’s popup-following behavior. The run records every selected-view transition. Subsequent recorded page preconditions must match the followed view. A missing popup, an unexpected destination, or ambiguous tab selection stops replay before input reaches that view.

A run owns the coordinator across its steps. External browser-mutating calls cannot interleave with it. Return a busy refusal to external actions; permit inspection of persisted progress and cancellation. A recording owns admission order but permits the calls it is recording.

### Run records and receipts

Each step produces a structured record containing:

- Step identity and prepared command, with protected values omitted.
- Start and finish events, monotonic elapsed duration, and execution phase.
- Resolution evidence.
- Whether input was withheld, dispatched, or its dispatch became uncertain.
- Submission observations and navigation settlement.
- The `BrowserReceipt` fields and the rendered, bounded toolset text.
- A terminal step outcome and any coded failure.
- Capture references and explicit unavailable-capture reasons.

Keep machine facts independently of rendered text. Do not parse `Clicked …`, `did not appear …`, or `call wait …` to decide success.

The terminal run distinguishes `complete`, `failed`, `aborted`, and `interrupted`. Completion means every declared command and observation completed. It does not certify an application outcome that the journey never asserted.

Use existing element reasons and toolset codes unchanged where they apply. Add journey-domain codes for malformed documents, unsupported versions, revision conflicts, missing inputs, unsupported capabilities, missing targets, ambiguous targets, unmet preconditions, incomplete settlement, recording gaps, busy ownership, and persistence failures. Every failure names its phase and step when available.

Stop on the first failed command, failed observation, incomplete settlement, unexpected dialog, page loss, cancellation, deadline, or required artifact-write failure. Preserve the completed prefix and identify unexecuted steps by comparison with the pinned document. Never mark the suffix successful or automatically resume after reconnecting.

Write an admission event before input and a completion event afterwards. A crash between them leaves an uncertain effect. Neither a run identifier nor a receipt provides exactly-once execution against the remote application.

## 5. Editing

Edits address step identities, not array indices or JSON Pointer paths.

The editor accepts an expected revision and an ordered batch of these operations:

| Operation | Arguments | Invariant |
|---|---|---|
| Insert | Complete step; optional `before` step id | The inserted identity is unused. An omitted anchor appends. |
| Remove | Step id | The step exists. A missing id is a conflict, not an ignored deletion. |
| Replace | Step id; complete replacement step | The replacement retains that identity. Its command must validate. |
| Input | Input name; complete declaration | Every remaining binding must agree with the resulting declaration. |
| Substitute | Run-local input record | The original revision and defaults remain unchanged. |

A move is a remove followed by an insert in the same batch. A command change is a replacement. Keeping these operations explicit avoids a general patch language whose field paths become another public API.

Apply edits to a private copy. Validate each operation against the intermediate sequence and validate the entire resulting document before publishing. A bad anchor, duplicate identity, undeclared binding, wrong input shape, or revision mismatch rejects the complete batch and leaves the original unchanged.

Generate a distinct revision with `parent` naming the base. Persist the edit and resulting definition together. Existing run directories retain their original snapshots.

An active run never changes when its stored journey is edited. It continues against the pinned prepared snapshot or is explicitly aborted. The editor cannot splice a command into an executing input.

If an edit cannot apply during run preparation, return an edit refusal before browser input. If the edit is structurally valid but its target no longer resolves on the page, record a replay failure at that step. Do not fall back to the old revision, skip the step, restore a deleted step, or ask a model to repair it inside the same run.

## 6. Codegen

Change `compileCodegenScript` to accept the journey document. Emit a JavaScript or TypeScript module containing the validated JSON and an exported `execute` function that calls the public runner with supplied execution resources and inputs.

Generated code must:

- Use the same preparation, resolution, settlement, and journal implementation as direct replay.
- Return the structured run result.
- Preserve step identities.
- Keep input bindings as bindings.
- Quote literals through JSON serialization.
- Import no server launcher unless the caller explicitly chooses a separate Node-host example.
- Require no `eval`, `new Function`, or generated selector snippets.

Retire the four-action `BrowserCodegenAction[]` format and the compiler’s unguarded `[0]` lookup. Update its consumers and tests in the same change. Do not maintain a parallel CSS replay engine or compatibility overload.

Sub­sume `BrowserCodegen`’s page-event acquisition into the journey recorder. Its replacement owns actual listener/script teardown, including new-document installations. The compiler remains a projection of journey data; it does not own recording state.

Retire unconditional consecutive-fill normalization. Replace it with the gesture-boundary rule in Recording, because adjacent input events can have observable effects.

The guide invariants receive these rulings:

| Guide invariant | Ruling |
|---|---|
| 1, 10: export and method parity | Keep; update tables and executable examples with the replacement surface. |
| 2: environment boundaries and import sets | Keep the boundaries. Amend the server import set to include the MCP and tool composition needed by the explicitly requested binary. Core gains neither MCP nor host imports. |
| 3, 11: transport boundaries | Keep unchanged. |
| 4: injected byte persistence | Keep; journey persistence is also injected and server-owned. |
| 5, 12, 13: connection, readiness, and ownership | Keep. The binary uses `Browser` and an explicitly owned run-local profile. |
| 6: observable lifecycle | Keep. Replace the codegen-specific event contract with the recorder’s documented lifecycle; retain page/context events and event-driven waits. |
| 7, 8: coded errors and bounded results | Keep and extend to journey input and evidence bounds. |
| 9: CSS action compiler and fill collapse | Retire for the reasons stated in this section. |
| 14–17: snapshots, references, readings, registry | Keep. Persisted references are additionally forbidden as cross-run identity. |
| 18: serialized actions and settlement | Keep in the shared coordinator; extend ownership across a replay run. |
| 19: dialog interruption | Keep, including the queue bypass for the dialog decision. |
| 20: trusted and untrusted placements | Keep; report programmatic selection separately. |
| 21: reserved tool names | Keep and extend to enabled journey tools. |
| 22–26: own-document guard and documented limits | Keep. A journey does not remove any of these limits. |

## 7. The MCP surface and the browse binary

Publish journey tools through the same manager that holds `look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, and the context tools. Core constructs the journey tools from core contracts. The server supplies persistence and browser ownership.

All package-owned argument objects have explicit properties, required fields, and `additionalProperties: false`. A nonempty required argument is present on every tool, preserving the small-model parser constraint. Derive validation and advertised schemas from one contract source.

The surface is:

| Tool | Arguments | Result | Refusals |
|---|---|---|---|
| `record` | Required `journey`, `source: 'tools' \| 'events'`; optional `title`, `url`, `headless` | Recording id, base revision when present, initial view, artifact directory | Busy session, duplicate recording, invalid URL, unavailable event source, unwritable directory |
| `stop` | Required `record` | Frozen definition, revision, gaps, recording evidence locations | Unknown recording; repeated stop returns its established result |
| `list` | Required `what`; optional `journey`, `run`, `offset`, `limit` | Bounded catalogue or selected record, with explicit continuation | Invalid identifiers or bounds; unknown selected record |
| `edit` | Required `journey`, `revision`, nonempty `changes` | Resulting revision, resulting definition or bounded preview, edit artifact location | Revision conflict or any invalid edit; applies nothing |
| `run` | Required `journey`, `revision`, `run`; optional `inputs`, `timeout`, `capture` | Terminal run result, bounded receipt summary, journal and capture locations | Preparation refusal, busy ownership, conflicting run id, execution failure |
| `abort` | Required `run` | Recorded cancellation state and artifact location | Unknown run; completed runs return their existing terminal state |
| `create` | Required `journey` containing an authored document | Validated initial revision and stored definition | Existing journey id, invalid document, recording-only evidence presented as executable instructions |

`list` is a bounded read over stored records. With no journey filter it lists journeys. A journey filter lists its current revision and runs. A run filter reads that run’s manifest and pages through its steps and receipts. Each result states what collection its offset addresses and the next offset; it never returns syntactically truncated JSON.

The `run` parameter is a caller-chosen operation identity. Repeating it with identical prepared content returns the recorded result or joins the active execution. Reusing it with different content is refused. An interrupted run with uncertain input returns that uncertainty and is not replayed automatically. A deliberate repeat uses a different run id.

`run` is the MCP operation name the brief requests. The core lifecycle method is `execute`, following the coding contract.

Journey tools have these annotation rules:

- `list` is pure and its page-derived content is untrusted.
- Recording, editing, creating, running, stopping, and aborting are not pure.
- `run` is consequential because its document can act on an external application.
- Page-authored content and recorded receipts retain the untrusted-content boundary.
- Journey tools belong to the native tool surface when enabled; adopted page tools never enter that native set.

Reservation happens before startup adds any tool. A collision rolls back startup without leaving half a surface. An adopted page tool with a reserved journey name is skipped using the existing reserved-name behavior.

Tool transport success and journey success stay separate. Structured content carries the run’s outcome. MCP rendering must mark refused or failed operations as tool failures while preserving the result and artifact locations where the installed MCP result contract permits them. Keep bounded text fallbacks for hosts that do not consume structured content.

### Binary protocol and registration

Ship:

```json
{
	"bin": {
		"browse": "dist/bin/main.js"
	}
}
```

Register its built entry in the same form as `probe`:

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

The entry constructs the server and starts it. Runtime declarations and lifecycle behavior belong in the server environment, not in `src/bin/main.ts`.

Compose `createMCPServer`, `createMCPLegacy`, and `createStdioServer` from the installed MCP package. The transport is newline-delimited JSON-RPC on stdin/stdout. Diagnostic text goes to stderr. Do not handwrite MCP negotiation, framing, cancellation, or protocol revision dispatch.

Promote the existing MCP development dependency to the runtime dependency required by the shipped binary. Resolve its published range during the release unit; do not ship the workspace tarball path.

Discovery and stored `list`/`edit` operations must not launch Chromium. Launch lazily for an operation that needs a page. Use one active browser operation per server. A run uses its own profile and cleanup ownership; the binary does not silently attach to somebody else’s browser.

The terminal command is:

```text
node node_modules/@orkestrel/browser/dist/bin/main.js
```

That starts the MCP server. It is not a human command parser. `browse record`, `browse list`, `browse run`, and `browse edit` are refused as usage errors rather than interpreted as another protocol.

From a model host, the operator requests the named tools, for example:

```text
record {"journey":"checkout","source":"tools","url":"https://shop.example.test/"}
stop   {"record":"RECORD_ID"}
list   {"what":"saved journeys"}
run    {"journey":"checkout","revision":"REVISION_ID","run":"checkout-attempt","inputs":{"customer":"Ada"}}
edit   {"journey":"checkout","revision":"REVISION_ID","changes":[...]}
```

`RECORD_ID` and `REVISION_ID` denote identifiers returned by earlier calls. The final edit example denotes a schema-valid change batch, not a literal CLI argument.

For terminal automation, a TypeScript client creates the published MCP client with a stdio client transport and calls the same tools. A program that needs no process boundary uses the core manager or runner directly. Do not add a second CLI operation implementation.

EOF, transport closure, and termination signals stop admission, abort active work, drain owned evidence writes, and destroy owned browser resources. Preserve exact listener ownership. Reuse the probe server’s composition pattern without copying its version-specific transport workarounds blindly.

## 8. The `orkestrel-journey` alignment

The installed journal contract is concrete:

```ts
{
	steps: readonly {
		action: string
		trigger: string
		result: string
	}[]
	output: readonly string[]
}
```

Use that exact structural shape for `journal.json`:

- `action` is the performed verb.
- `trigger` names the resolved role/name and scope, or the URL/key/observation subject.
- `result` states what the surface reported after the step, including an exact refusal when it failed.
- `output` contains observed page console output and uncaught failures. It is not a second receipt list.

Keep richer execution metadata in receipts. Core does not import or re-export `@orkestrel/test/browser` types. A development-time structural conformance test checks compatibility with the installed `JournalStep` and journal shape.

The vocabulary mapping is:

| Recorded command | Skill vocabulary |
|---|---|
| `click` | `clickAccessible`, `clickAccessibleWithin`, or `clickDisclosure` when the target is a native disclosure |
| `fill` | `fillAccessible` |
| `type` | `typeAccessible` |
| `press` | `pressKeys`, with explicit key-grammar translation |
| `hover` | `hoverAccessible` |
| Visible outcome wait | `waitForText` over the appropriate published perception reader |
| Capture placement | `createPortfolio().place` after the skill’s assertion and paint settlement |
| Journal entry | `createJournal().record(action, trigger, result)` |

CDP chord strings and the provider’s `{Enter}`/`[Code]` syntax are not interchangeable. The adapter translates supported chords and refuses unsupported sequences; it never concatenates unescaped input into key syntax.

These names and meanings remain distinct:

- A recorded journey is reusable automation data. A skill journey is an acceptance test for a user intent.
- `BrowserNavigationRecordInterface` records navigation settlement. It is not the action recorder or the journal.
- A browser action receipt describes execution. Probe’s `receipt` is a proof token. Neither is the other.
- `wait` for text is not `waitForAnimations`.
- The existing tool `type` is not necessarily the skill’s keystroke-by-keystroke `typeAccessible`.
- A programmatic select operation is not evidence of trusted keyboard selection.
- A DOM-native replay is not a trusted-input journey.

Add a narrow execution extension point to the core runner, with the skill adapter as its first consumer. It supplies supported operations and executes a prepared step through published test verbs; the core still owns preparation, ordering, cancellation, evidence, and stop rules. Do not write another interpreter in a skill example.

The adapter must refuse before execution:

- CSS-only interactive targets.
- Unsupported frame or shadow resolution.
- Commands requiring programmatic selection when trusted interaction is the claim.
- Router calls, application-store access, arbitrary evaluation, or automatic focus repair.
- Mid-journey direct navigation used in place of a visible link.
- Any operation for which the installed journey layer supplies no compliant verb.

A skill test can invoke a compatible recorded journey as one composed step. Its nested records remain available, and it performs its own rendered outcome assertion afterwards. Keyboard traversal remains an independent acceptance requirement; replaying clicks does not prove it.

Propose these changes in scaffold’s canonical skill:

- Describe recorded journeys and their compatible command subset.
- Require the trusted execution adapter for acceptance work.
- Require explicit entry preparation, unconditional steps, exact refusals, and a rendered outcome assertion after replay.
- Keep `createJournal` started within the test and stopped in `finally`.
- Merge nested step records into the variant artifact without duplicating console output already observed by the outer journal.
- Preserve the per-variant artifact containing accessible tree, focus, style rows, journal, and capture filenames.
- Keep skill portfolios under their existing capture layout; reference them from the recorded run rather than relocating the skill’s artifacts.
- State that a completed automation result alone does not discharge the skill’s family, statechart, refusal, matrix, or capture proofs.

This is a proposal for scaffold. Do not edit the browser repository’s scaffold-owned pointers.

## 9. Alternatives ruled out

The following alternatives fail a required contract:

- **Persist raw tool calls and replay their references.** References belong to a context and document. The v10 transcript also demonstrates that successful tool transport can carry a failed observation.
- **Keep CSS as the primary target.** The existing compiler accepts the first match, cannot distinguish ambiguity, and misses the skill’s semantic target contract.
- **Use fuzzy names or a model to repair targets during replay.** That can redirect a consequential action. A changed target requires an explicit edit.
- **Treat every observed navigation as a command.** This repeats navigation effects and can turn a submitted POST result into a GET.
- **Compile independent direct element calls.** They bypass the runner’s settlement, stop rules, and receipts.
- **Parse receipt sentences for machine decisions.** Wording is presentation; the existing wait result already disproves transport-success inference.
- **Retry or resume a failed action automatically.** Input may have reached the application. The store evidence’s repeated orders make this boundary concrete.
- **Use global network idle as completion.** The existing navigation record expresses frame and loader settlement; application outcomes need their own observation.
- **Make the format a workflow language.** Branches, loops, arbitrary expressions, and exception suppression are unnecessary for editable recorded sequences and make unconditional replay harder to inspect.
- **Depend on WebMCP.** Browser automation works without a page registry. MCP hosting is a separate transport composition.
- **Build a parallel command-line browser engine.** It would duplicate the MCP and in-process semantics.
- **Import the test package into production core.** Its provider-bound browser helpers violate the environment boundary. The adapter belongs with the consumer tests.
- **Claim trusted behavior from a DOM journal.** Matching output shape cannot change how the input was delivered.
- **Store profiles or recordings in a global cache.** The requested ownership and artifact root is the workspace’s `tmp/browsers`.

## 10. Load-bearing claims

These claims require implementation evidence. None is claimed proven by this design reading.

1. **An input executes once when its navigation outlasts or outruns the input reply.** Run real-Chromium POST/303, same-document, child-frame, reverse process-swap, and nested `_parent` cases through direct replay and MCP. Tape command, reply, and navigation arrival order. Remove the pre-input record in the control.

2. **Replay and ordinary tools produce the same settlement facts and receipt wording.** Drive the same fixture operations through each entry and compare independently asserted destination state, submission clause, navigation stage, and reason. Include C7’s unknown observer result and stale reason sequence.

3. **Changed DOM structure preserves a uniquely named target without selecting a different control.** Record on one fixture, change ids/classes/order, and replay on another. Duplicate the semantic target in the control and assert no input reached either candidate.

4. **Fallback stays inside its declared scope.** Repeat a named control across main document, child frames, regions, and open shadow roots. Change one boundary and assert a scoped refusal. Prove CSS fallback separately in same-process and out-of-process frames.

5. **Page-event recording neither duplicates nor loses an initiating gesture.** Record fill, Enter, submit-button activation, select, navigation, and stop during queued reports. Compare recorded instructions with an independent fixture event log. Include a navigation caused by the gesture as the duplicate-control case.

6. **A recording gap cannot become a successful replay.** Produce an unsupported gesture and an unclassifiable navigation, then assert preflight refusal. Remove or replace the gap explicitly and prove the resulting instructions.

7. **Input substitution and edits are atomic before input.** Test revision conflicts, bad anchors, duplicate ids, shape changes, missing inputs, literal binding-like text, and caller mutation. A real page event counter remains unchanged after every preparation refusal.

8. **A timeout sentence cannot complete a wait step.** Reuse the v10 pattern with nonexistent text. Assert a failed structured outcome and an unexecuted suffix. Control with text inserted through the fixture’s real asynchronous behavior.

9. **A prevented submission is not repeated.** Record a form whose handler posts once and renders confirmation later. Replay submission followed by the declared wait. Assert one submitted order and the visible confirmation. Omit the wait as a control for the outcome assertion.

10. **Dialog continuation does not deadlock or advance ordinary input early.** Exercise `confirm` and `beforeunload` through real Chromium. Match and mismatch the recorded decision, abort while blocked, and assert release/barrier behavior.

11. **Cancellation releases input and preserves uncertainty.** Abort queued work, a pressed key/button, settlement, and capture. Assert no queued input, matching releases, no following action, and truthful partial evidence. Drop the transport after dispatch in a separate case.

12. **DOM replay reports its limits before acting.** Run the supported subset over a real same-origin document. Require an unsupported press, cross-origin scope, or trusted-only command later in the document and assert that preparation prevents the earlier side effect too.

13. **The skill adapter drives the installed published verbs.** Run an acceptance fixture in Vitest’s browser provider with exact semantic targets and real input. A mutation omitting the recorded act must fail the rendered destination assertion. A DOM-native executor must be refused for the trusted claim.

14. **Generated code and JSON replay share behavior.** Execute a generated module and direct replay against independently reset real fixtures. Compare semantic outcomes and failure step identities, excluding run ids, timings, and fresh references.

15. **The built binary is a usable MCP server.** Spawn its packed entry through the real MCP stdio client. Discover tools before Chromium starts, then create/edit/record/run/list. Verify modern and supported legacy dispatch through the installed MCP adapters.

16. **Stored evidence survives failure without inventing completion.** Terminate the binary after an admission event, restart it, inspect the interrupted run, and repeat its operation id. Assert no automatic second input. Test write failure and concurrent revision publication with real filesystem resources.

17. **Artifact containment and ownership hold.** Test traversal and symlink escapes, run collisions, capture names, teardown, and a caller-owned browser in the library path. Inspect the actual filesystem population and confirm only the recorded owned runtime directory is removed.

18. **Small-model use remains workable.** Use the store model and its existing oracle discipline to call record/list/edit/run. Inspect page state, not the model’s answer. Retain transcripts showing wrong arguments, correction receipts, substituted input, and a successful repeated flow.

Use the C6/C7 instrument pattern: a recording transport, module-level helpers, protocol-faithful fixture servers, and wire tapes under the probe’s `logs/`. Promote settled runtime claims into service or mirrored tests. Use `prove` for suitable TypeScript claims with negative controls; use real-browser and built-process instruments for claims its stages do not model.

## 11. Units

This is a large cross-package design. Integrate shared-file changes serially. Each implementation unit owns its mirrored tests; helpers belong in the appropriate `tests/setup*.ts` module.

| Unit | Dependencies | Owner files | Acceptance | Implementation lane |
|---|---|---|---|---|
| Contract and schema | Reconciled design | `src/core/types.ts`, `schemas.ts`, `validators.ts`, `parsers.ts`, `errors.ts`, `index.ts`; schema proofs | JSON, input, edit, receipt, execution-port, and persistence contracts typecheck; bounded validation and immutable ownership proven | `opus` for final public shape; subsequent mechanical schema transcription to `builder` |
| Shared action coordinator | Contract | `src/core/BrowserToolset.ts`, coordinator class, core factories/constants/helpers; toolset and coordinator tests | Existing queue, observer, settlement, dialog, popup, bounds, and cleanup behavior preserved; structured facts available without parsing prose | `astra` |
| Durable target descriptions | Contract | Core and DOM element managers, element implementations, environment helpers/compilers; serial type/barrel patches | Exact resolution, semantic scopes, target descriptions, frame/shadow CSS fallback, and pre-input re-resolution proven | `astra`, split into disjoint core and DOM units after the shared contract lands |
| Pure preparation and editing | Contract | Core editor/preparation implementation and kind files | Atomic edits, revision checks, input binding, capability validation, and zero-side-effect refusals proven | `astra` |
| Runner and evidence | Coordinator, targets, preparation | Core runner/recorder evidence classes, journal projection, core factories; integration tests | Ordered execution, stop rules, dialog continuation, cancellation, run ownership, truthful receipts, and partial journal proven | `astra` |
| Recording sources | Coordinator, targets, runner evidence | `BrowserCodegen.ts` replacement, page lifecycle integration, event-source compilers, browser recorder; mirrored/service tests | Tool and event sources produce the same format; gesture deduplication, stop draining, protected inputs, and explicit gaps proven | `astra`; core and browser source implementations can separate after their contract lands |
| Journey tool publication | Runner, editor, recorder | Core tool publication class, schemas/constants, `BrowserToolset.ts`; manager integration tests | Every tool validated, reserved, bounded, and available through the same manager; failures retain structured outcomes | `astra` for behavior; `opus` for advertised wording |
| File persistence | Contract, editor, evidence | `src/server/stores/` implementation, server helpers/types/factories; filesystem tests | Containment, immutable revisions, atomic publication, run-id conflicts, interrupted-run reads, and write failures proven | `astra` |
| Browse host and package | Tools, persistence | `src/server` browse server, `src/bin/main.ts`, `package.json`, lockfile, build ownership patches, distribution tests | Packed stdio server launches lazily, serves the shared manager, contains artifacts, handles teardown, and installs its runtime dependencies | `astra` for lifecycle/protocol; `builder` for reconciled manifest/build wiring |
| Code generation | Runner, recording | `src/core/compilers.ts`, obsolete codegen declarations/helpers, consumer tests | Generated JS/TS invokes the shared runner; legacy CSS engine removed; all consumers migrated | `astra` |
| Skill consumer proof | Runner execution port, codegen | Browser test setup and integration proofs; proposed scaffold patch as a report | Installed test verbs execute a compatible recording, journal shape matches, and trusted/refusal/outcome controls fail as intended | `astra` for adapter correctness; `opus` for the scaffold skill proposal |
| Guides and API parity | Implemented surface | `guides/browser.md`, `README.md`, guide proofs; scaffold proposal files in its own checkout when authorized by the Orchestrator | Record/edit/run examples execute; binary registration works; every invariant is retained or retired as ruled; imports and methods match | `opus` |
| Integrated adversarial audit | Implementation and guides | Numbered claims and evidence; no source ownership | One `orkestrel-falsify` round over resolution, settlement, recording, persistence, and skill boundaries | Independent reviewer engine under orchestration routing |
| Verification | Audit fixes | Evidence only | Scoped projects, service proof, distribution proof, and tree-wide gates run and reported from bare output | `verifier` |

The runner, recorder, tools, and persistence units must not independently edit shared type and barrel files in parallel. Return exact patches for the Orchestrator’s serial integration or use isolated worktrees when the dispatch requires overlapping ownership.

## 12. Unresolved

The remaining questions are empirical or belong to reconciliation:

- **Page-event intent boundaries.** The existing recorder does not establish how reliably a gesture can be paired with submission, navigation, and focus changes across frame swaps. Claim 5 must settle this. The selected behavior is to preserve a gap whenever classification is uncertain.
- **Portable scope descriptions.** The managers need additional support for semantic regions, frame owners, and open-shadow boundaries. Claims 3 and 4 must establish which descriptions survive real page changes. Closed roots and inaccessible documents remain explicit capability limits.
- **Trusted adapter coverage.** The installed journey layer supplies the verbs read in the terrain, but not every browser command has a compliant counterpart. Claim 13 establishes the supported subset. Unsupported commands remain preflight refusals; the adapter cannot silently widen the skill’s laws.
- **Page output capture in the DOM placement.** The production DOM view has no console-event source. Accept a consumer-supplied journal/output source or report output observation unavailable; do not install a production console override merely to imitate the test journal.
- **MCP dependency release ordering.** The workspace holds MCP through a development tarball pin. The binary requires a published runtime range and a packed-install proof. This is a release dependency, not a reason to implement a second protocol stack.
- **Small-model tool ergonomics.** The v5–v10 evidence supports required arguments, bounded views, and concrete refusal instructions. It does not prove the proposed journey schemas usable by that model. Claim 18 settles that question without changing page-state oracles.
- **Public names and guide presentation.** The SUBJECTIVE lane owns their final proposal. Reconciliation must preserve the data-first format, exact target refusal rules, shared settlement implementation, immutable active runs, and distinction between automation completion and acceptance proof.

This lane read source and retained evidence only. It wrote no files, spawned no agents, and ran no implementation probes or gates.