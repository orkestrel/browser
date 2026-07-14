# Workflow

> Orchestration as DATA: a JSON-serializable `Workflow → Phase → Task` tree — a strict three levels, positional, no DAG — that a UI or an LLM authors, persistence stores, and a thin runner drives by COMPOSING the shipped substrate. The module deliberately is NOT a general DAG engine: it trades arbitrary dependency graphs for a fixed, deterministic shape, and it writes none of its own concurrency / retry / abort machinery — it reuses what already ships.

Two type families share the module. The **definition** family (`WorkflowDefinition → PhaseDefinition → TaskDefinition`) is pure JSON, with behavior referenced BY NAME through a registry — never inline functions — so the whole tree serializes, round-trips, and is safe for a 2B model to emit. The live **entity** family (`Workflow` / `Phase` / `Task`) is the runtime mirror BUILT from a definition: each node is an [§13-observable](emitter.md) synchronous state machine whose status is DERIVED from its children and snapshot-able at any instant. One compiled [contract](contract.md) (`createWorkflowContract`) keeps the JSON Schema + guard + parser + seeded generator in lockstep with the hand-written definition interfaces, so the two families can never drift.

**Determinism is fixed by design, not configured: tasks within a phase run concurrently; phases run sequentially.** A dependency is expressed STRUCTURALLY — you put a task that needs another's output in a later phase — so the same tree always sequences the same way and there is no DAG to misconfigure. The only per-phase knob is an optional `concurrency` resource throttle (max-in-flight), never a sequencing control.

The `WorkflowRunner` EXECUTES a live tree by composing the runner / scheduler / [abort](abort.md) + [timeout](timeout.md) + [budget](budget.md) substrate, under a `bail` failure policy: `false` (graceful, the default) records each leaf failure as data and finishes every phase; `true` (the database-transaction halt) aborts the in-flight siblings on the first failure and skips the rest. A task runs a `function`, a `tool`, or an `agent` (a subagent, behind a depth + cycle guard). `createWorkflowTool` wraps a whole definition as one LLM-callable tool that ADVERTISES a deliberately-simple FLAT authoring shape (`{ name?, steps: [{ name, via? }] }`) so even a small model can author a complete tree in one call — every authored form (flat, an ids-omitted draft, or the full nested definition) is widened ONLY at the tool boundary and re-validated against the STRICT `createWorkflowContract` before running, so the canonical contract and runner stay byte-for-byte unchanged.

Source: [`src/core`](../../src/core). Surfaced through the `@src/core` barrel.

## Surface

The 80% use case is two steps: author a `WorkflowDefinition` (pure JSON — phases in order, each phase's tasks concurrent, each task naming a registered behavior), then run it through a `WorkflowRunner` that builds the live tree and drives it to a `WorkflowResult`:

```ts
import { createWorkflowRunner } from '@src/core'
import type { WorkflowDefinition } from '@src/core'
import { createToolManager } from '@orkestrel/agent'

const definition: WorkflowDefinition = {
	id: 'release',
	name: 'Release',
	phases: [
		{
			id: 'build',
			name: 'Build',
			tasks: [
				{ id: 'compile', name: 'Compile', run: { via: 'function', name: 'compile' } },
				{ id: 'lint', name: 'Lint', run: { via: 'function', name: 'lint' } },
			],
		},
		{
			id: 'ship',
			name: 'Ship',
			tasks: [{ id: 'publish', name: 'Publish', run: { via: 'tool', name: 'publish' } }],
		},
	],
}

const tools = createToolManager()
const runner = createWorkflowRunner({
	functions: {
		compile: async (controller) => `built ${controller.task.id}`,
		lint: async () => 'clean',
	},
	tools, // a `publish` tool lives here
})

const result = await runner.execute(definition) // builds + drives the tree
result.status // 'completed'
result.workflow.phase('build')?.task('compile')?.status // 'completed'
result.results // every settled task's TaskResult, in positional order
```

Why this is safe: the definition is the SINGLE source of truth. `execute` builds the live tree from the definition itself — there is no separately-supplied tree to fall out of sync — so the executed entity can never drift from the `run` form / `concurrency` metadata, and the freshly-built live `workflow` is returned in the result. Phase `ship` starts only once phase `build` has fully settled; within `build`, `compile` and `lint` run concurrently. A task whose handler is not found AUTO-COMPLETES (the no-handler rule) — an unregistered name is a no-op, not an error, so a partial registry still runs.

### Factories

| API                           | Kind     | Summary                                                                                                                                     |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkflowContract`      | function | Compile the workflow-definition `ContractInterface` — JSON Schema + guard + parser + seeded generator, all from one shape.                  |
| `createWorkflowDraftContract` | function | Compile the LENIENT DRAFT `ContractInterface` — like the strict one but `id`/`name` optional at all three levels.                           |
| `createWorkflow`              | function | Build the live `WorkflowInterface` entity tree from a `WorkflowDefinition` (every node `pending`).                                          |
| `restoreWorkflow`             | function | Rebuild an equivalent live tree from a `WorkflowSnapshot` — the inverse of `snapshot()` (structure + status + results + order).             |
| `assertSnapshot`              | function | Validate a `WorkflowSnapshot`'s `bail` + every node's status / override against the lifecycle vocabulary (throws `RESTORE`).                |
| `createMemoryWorkflowStore`   | function | Create the in-memory default `WorkflowStoreInterface` — persists `WorkflowSnapshot`s by id (the durable-store seam; no TTL, no options).    |
| `createDatabaseWorkflowStore` | function | Create the driver-pluggable `WorkflowStoreInterface` over a `databases` table (the snapshot as one JSON column; driver defaults to memory). |
| `createWorkflowRunner`        | function | Create a `WorkflowRunnerInterface` over the behavior registries (`functions` / `tools` / `agents`) + an optional `scheduler`.               |
| `createWorkflowTool`          | function | Wrap a `WorkflowDefinition` as an LLM-callable `ToolInterface` that advertises the FLAT authoring shape (the nested form stays accepted).   |
| `createScheduler`             | function | Create the cross-environment `setTimeout`-based default `SchedulerInterface`.                                                               |
| `createRunner`                | function | Create a `RunnerInterface` over a handler — drives a `Queue`, ordered + fail-fast `execute`.                                                |
| `createDeferred`              | function | Create a `DeferredInterface` — a promise whose settlement (`resolve` / `reject`) is driven externally.                                      |

### Entities

Each entity class implements its interface exactly, so the `## Methods` tables below double as its per-instance method surface (AGENTS §22).

| Class          | Kind  | Role                                                                                                                                 |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Workflow`     | class | The live DERIVED root — status from its phases under `bail`, the cascade's top, `snapshot()` / `skip` / `stop`, an owned `emitter`.  |
| `Phase`        | class | The live DERIVED middle tier — status from its tasks, recomputes + escalates on a child transition, an owned `emitter`.              |
| `Task`         | class | The live leaf state machine — guarded `start` / `complete` / `fail` / `skip` / `stop`, records a `TaskResult`, an owned `emitter`.   |
| `PhaseManager` | class | The lean child registry of a workflow's live phases — insertion-ordered `append` / `phase` / `phases` / `count` (no batch matrix).   |
| `TaskManager`  | class | The lean child registry of a phase's live tasks — insertion-ordered `append` / `task` / `tasks` / `count` (order survives a `skip`). |
| `Runner`       | class | The orchestrator over a set of units — drives a `Queue`, ordered result aggregation, fail-fast, one-shot.                            |
| `Controller`   | class | The per-unit handle a runner handler receives — `id` / `input` / `signal` + `wait` / `spawn` / `abort`.                              |

### Scheduler

The cooperative host-yield primitive that paces the runner between phases: a loop decides WHAT to do; the scheduler decides WHEN the host regains control.

| API         | Kind  | Summary                                                                                      |
| ----------- | ----- | -------------------------------------------------------------------------------------------- |
| `Scheduler` | class | The cross-environment cooperative-yield default — `yield` / `delay` over `setTimeout` alone. |

### Environment backends

Beyond the cross-environment default, each host has a native cooperative-yield primitive a `yield()` should reach for; the backends are standalone `SchedulerInterface` implementations (no shared engine — unlike the [databases](database.md) query engine, there are only two methods to write per environment) that swap the `yield` primitive while keeping the **exact** abort semantics: a pending `yield` / `delay` rejects with `signal.reason` _verbatim_, an already-aborted signal rejects without arming, and either settle path clears the underlying handle and removes the abort listener (no leak, no double-settle). Each backend's `delay(ms)` is a real `setTimeout`; only the `yield` primitive differs.

The **Node** backend ships in [`src/server`](../../src/server), surfaced through `@src/server`. `NodeScheduler.yield()` waits on `setImmediate` — the canonical Node "give the event loop a turn", running after the current operation and pending I/O. It deliberately does **not** use `node:timers/promises` (whose `{ signal }` option rejects with a Node `AbortError`, `code: 'ABORT_ERR'`, _not_ the caller's `reason`); the timer and abort listener are hand-rolled to forward `signal.reason` verbatim. `priority` is accepted but a no-op — Node has no priority primitive.

The **browser** backends ship in [`src/browser`](../../src/browser), surfaced through `@src/browser`, one per host-turn strategy. All three feature-detect their native API through guards (`isRecord` / `isFunction` from `@src/core`), never an `as` (AGENTS §14), and fall back to a real macrotask where it is absent:

- `BrowserScheduler.yield()` posts to the **Prioritized Task Scheduling API** (`scheduler.postTask`) at the mapped priority (`user` → `'user-blocking'`, `normal` → `'user-visible'`, `background` → `'background'`) — so the urgency hint is honoured — falling back to a `setTimeout(0)` macrotask where `scheduler.postTask` is absent (Firefox today). The caller's `signal` is **not** handed to `postTask` (whose own abort rejects with a platform `AbortError`, not the caller's `reason`); an internal controller cancels the posted task while the scheduler rejects with the verbatim `signal.reason`.
- `FrameScheduler.yield()` resumes just before the next paint via `requestAnimationFrame` (and `cancelAnimationFrame` on abort) — for work that should batch per render frame and naturally pause while the tab is hidden. `priority` is a no-op.
- `IdleScheduler.yield()` resumes when the host is idle via `requestIdleCallback` (and `cancelIdleCallback` on abort), falling back to a `setTimeout(0)` macrotask where it is absent (Safari today) — for low-priority background work that must not contend with rendering or input. `priority` is a no-op.

| API                | Kind  | Summary                                                                                                                               |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NodeScheduler`    | class | The Node backend — `yield` over `setImmediate`, verbatim abort fidelity (hand-rolled, not `node:timers/promises`); priority a no-op.  |
| `BrowserScheduler` | class | The browser backend — `yield` over `scheduler.postTask` at the mapped priority, falling back to a macrotask; verbatim abort fidelity. |
| `FrameScheduler`   | class | The frame-aligned browser backend — `yield` over `requestAnimationFrame` (resume before paint); priority a no-op; verbatim abort.     |
| `IdleScheduler`    | class | The idle-time browser backend — `yield` over `requestIdleCallback`, falling back to a macrotask; priority a no-op; verbatim abort.    |

| API                      | Kind     | Summary                                                                                                 |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `createNodeScheduler`    | function | Create the Node-native `SchedulerInterface` (`yield` over `setImmediate`).                              |
| `createBrowserScheduler` | function | Create the browser-native `SchedulerInterface` (`yield` over `scheduler.postTask`, macrotask fallback). |
| `createFrameScheduler`   | function | Create the frame-aligned `SchedulerInterface` (`yield` over `requestAnimationFrame`).                   |
| `createIdleScheduler`    | function | Create the idle-time `SchedulerInterface` (`yield` over `requestIdleCallback`, macrotask fallback).     |

The browser backends also publish two supporting members through `@src/browser`: the `POST_TASK_PRIORITY` map `BrowserScheduler` reads to translate a portable `SchedulerPriority` into a `scheduler.postTask` priority level, and the `IdleAPI` shape of the feature-detected `requestIdleCallback` / `cancelIdleCallback` pair `IdleScheduler` narrows to (or resolves to `undefined`, falling back to a macrotask).

| Type      | Kind      | Shape                                                                                                            |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `IdleAPI` | interface | `{ request: (callback) => number; cancel: (handle) => void }` — the feature-detected `requestIdleCallback` pair. |

| API                  | Kind  | Summary                                                                                                                                               |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST_TASK_PRIORITY` | const | The `SchedulerPriority` → `scheduler.postTask` priority map (`user` → `'user-blocking'`, `normal` → `'user-visible'`, `background` → `'background'`). |

Each backend is a standalone `implements SchedulerInterface`, so its public methods are exactly `yield` / `delay` — the same [Methods](#methods) table below governs every one (AGENTS §22).

### Runner & task forms

The `WorkflowRunner` is THIN — it composes the substrate and DRIVES the live entity, never re-implementing status / concurrency / retries / abort. `createWorkflowRunner` builds one; `createWorkflowTool` is the by-agent path (a model authors + runs a whole workflow in one tool call).

| Class            | Kind  | Role                                                                                                                                       |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `WorkflowRunner` | class | Executes a live tree — phases sequential (a plain await loop), each phase's tasks concurrent (one substrate `createRunner` per phase).     |
| `TaskController` | class | The lean per-task handle a `WorkflowFunction` receives — a folded `signal` / `aborted`, the task's `input` + lineage, read-up `results()`. |

### Stores

The durable persistence seam (W-d) — a DUAL-store convention (the `QueueStore` / `SessionStore` pattern). A `WorkflowStoreInterface` persists the pure-JSON `WorkflowSnapshot` keyed by workflow id through two interchangeable backends: `MemoryWorkflowStore` (a plain `Map`, the zero-plumbing DEFAULT, `createMemoryWorkflowStore`) and `DatabaseWorkflowStore` (the opt-in, driver-pluggable twin over a `databases` table, the snapshot stored as ONE OPAQUE JSON column, `createDatabaseWorkflowStore`). Both live under `workflows/stores/`. The Database store's driver DEFAULTS to memory, so it ALSO works in memory out of the box; you opt into the durable plumbing (JSON / SQLite / IndexedDB) by passing a driver — and it swaps in through the SAME interface, without touching the runner or the entity tree. Restore stays the shipped `restoreWorkflow`.

| Class                   | Kind  | Role                                                                                                                                    |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryWorkflowStore`   | class | The in-memory default `WorkflowStoreInterface` — a process-lifetime `Map` of `WorkflowSnapshot`s by id; NO TTL (durable until delete).  |
| `DatabaseWorkflowStore` | class | The driver-pluggable twin `WorkflowStoreInterface` — wraps a `databases` table, the snapshot one opaque JSON column (driver-swappable). |

### Errors

| API               | Kind     | Summary                                                                                                              |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `WorkflowError`   | class    | Carries a `WorkflowErrorCode` (`TRANSITION` / `RESTORE` / `DEPTH` / `TOOL`) + an optional `context` naming the node. |
| `isWorkflowError` | function | Narrow an unknown caught value to a `WorkflowError`.                                                                 |

### Helpers & guards

Pure, side-effect-free, exhaustively unit-tested (AGENTS §4.3 / §14). The status derivations encode the §10 / §14 truth-table logic; the task-form guards narrow a `TaskForm` on its `via` discriminant; the lineage / snapshot builders seed the entity tree.

| API                         | Kind     | Behavior                                                                                                                                   |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `isFunctionTask`            | function | Narrow a `TaskForm` to the `function` form (`form.via === 'function'`).                                                                    |
| `isToolTask`                | function | Narrow a `TaskForm` to the `tool` form.                                                                                                    |
| `isAgentTask`               | function | Narrow a `TaskForm` to the `agent` form.                                                                                                   |
| `isWorkflowSnapshot`        | function | Narrow an `unknown` to a `WorkflowSnapshot` by shape — the §14 boundary guard `DatabaseWorkflowStore` uses to read back its JSON column.   |
| `isTerminalStatus`          | function | Whether a `LifecycleStatus` is terminal — the ONE check across all three tiers (`completed` / `failed` / `skipped` / `stopped`).           |
| `derivePhaseStatus`         | function | Derive a `PhaseStatus` from its tasks' statuses (order-insensitive; most-severe terminal wins; `bail`-agnostic).                           |
| `deriveWorkflowStatus`      | function | Derive a `WorkflowStatus` from its phases' statuses UNDER `bail` (`failed` reachable only when `bail: true`).                              |
| `canTransitionTask`         | function | Whether the live task state machine may move from one `TaskStatus` to another (reads `TASK_TRANSITIONS`).                                  |
| `workflowTag`               | function | The ancestry identifier of a workflow run — `workflow:<id>` (the W-c2 cycle-guard chain).                                                  |
| `agentTag`                  | function | The ancestry identifier of an agent in a run chain — `agent:<name>`.                                                                       |
| `buildWorkflowContext`      | function | Build a `WorkflowContext` (the identity every level inherits) from a node's `id` / `name` / optional `description`.                        |
| `buildPhaseContext`         | function | Build a `PhaseContext` (own identity + the workflow back-reference) from the parent context + a phase node.                                |
| `buildTaskContext`          | function | Build a `TaskContext` (own identity + the phase back-reference) from the parent phase context + a task node.                               |
| `definitionToSnapshot`      | function | Convert a `WorkflowDefinition` into an INITIAL all-`pending` `WorkflowSnapshot` — the unified construction path.                           |
| `phaseDefinitionToSnapshot` | function | Convert one `PhaseDefinition` into an initial all-`pending` `PhaseSnapshot` (the per-phase step).                                          |
| `taskDefinitionToSnapshot`  | function | Convert one `TaskDefinition` into an initial `pending` `TaskSnapshot` (the per-task leaf step — no result, empty metadata).                |
| `collectResults`            | function | Flatten per-phase `TaskResult` lists into one positional list — the workflow tier of the result tree.                                      |
| `workflowToolSummary`       | function | Summarize a terminal `WorkflowResult` into the PLAIN value a `createWorkflowTool` handler RETURNS on success (a lean `{ status, count }`). |
| `completeDraft`             | function | Complete a `WorkflowDraft` into a strict `WorkflowDefinition` — synthesize missing ids positionally + default each missing name to its id. |
| `completePhaseDraft`        | function | Complete one `PhaseDraft` into a strict `PhaseDefinition` (the per-phase step of `completeDraft`; phase `i` → `phase-<i>`).                |
| `completeTaskDraft`         | function | Complete one `TaskDraft` into a strict `TaskDefinition` (the per-task step; task `j` of `<phaseId>` → `<phaseId>-task-<j>`).               |
| `expandSteps`               | function | Expand a flat `WorkflowSteps` blob into a strict `WorkflowDefinition` — each step becomes a one-task phase, in order.                      |
| `stepToForm`                | function | Convert one flat `WorkflowStep` into a `TaskForm` — `name` → the form's `name`, `via` → its discriminant (defaulting to `function`).       |

### Shapes

The shape VALUES `createWorkflowContract` compiles into the four lockstep outputs. They agree with the hand-written definition interfaces (the source of truth, AGENTS §14); a round-trip parity test (`generate → is → parse`) guards against drift.

| API                  | Kind  | Summary                                                                                                           |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `taskFormShape`      | const | The `TaskForm` shape — a tagged union over `function` / `tool` / `agent`, discriminated by `via`.                 |
| `taskShape`          | const | The `TaskDefinition` shape — identity + the `taskFormShape` behavior reference.                                   |
| `phaseShape`         | const | The `PhaseDefinition` shape — identity + ordered `taskShape` tasks + an optional positive-integer `concurrency`.  |
| `workflowShape`      | const | The `WorkflowDefinition` shape (the contract root) — identity + ordered `phaseShape` phases + an optional `bail`. |
| `taskDraftShape`     | const | The DRAFT task shape — like `taskShape` but `id`/`name` optional (`run` still required).                          |
| `phaseDraftShape`    | const | The DRAFT phase shape — like `phaseShape` but `id`/`name` optional, holding `taskDraftShape` tasks.               |
| `workflowDraftShape` | const | The DRAFT workflow shape `createWorkflowDraftContract` compiles — `id`/`name` optional at all three levels.       |
| `stepShape`          | const | The flat STEP shape — `{ name, via? }`, the building block of `workflowStepsShape`.                               |
| `workflowStepsShape` | const | The FLAT shape `createWorkflowTool` advertises as its `parameters` — `{ name?, steps: [{ name, via? }] }`.        |

### Constants

| Constant                       | Kind  | Value                                                                                                              |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `DEFAULT_BAIL`                 | const | The default `bail` — `false` (graceful: continue on a leaf failure).                                               |
| `TASK_VIAS`                    | const | The three task-form mechanisms (`['function', 'tool', 'agent']`), frozen — the `TaskVia` source of truth.          |
| `TASK_STATUSES`                | const | Every `TaskStatus`, frozen (`pending` → `running` → the four terminals).                                           |
| `PHASE_STATUSES`               | const | Every `PhaseStatus`, frozen.                                                                                       |
| `WORKFLOW_STATUSES`            | const | Every `WorkflowStatus`, frozen.                                                                                    |
| `TERMINAL_TASK_STATUSES`       | const | The terminal `TaskStatus` values, frozen (`completed` / `failed` / `skipped` / `stopped`).                         |
| `TASK_TRANSITIONS`             | const | The legal `TaskStatus` transition graph — each status mapped to those it may move to directly, frozen.             |
| `DEFAULT_PHASE_CONCURRENCY`    | const | The per-phase task concurrency when a `PhaseDefinition` omits `concurrency` — a large cap (effectively unbounded). |
| `MAX_WORKFLOW_DEPTH`           | const | The maximum nesting depth an `agent` task may spawn into (`8`) — the bound the depth/cycle guard enforces.         |
| `WORKFLOW_TOOL_NAME`           | const | The name (`'workflow'`) the runner binds the workflow tool onto a dispatched subagent's context under.             |
| `WORKFLOW_TOOL_FLAT_EXAMPLE`   | const | A complete FLAT authoring example (`{ name, steps: [{ name, via }] }`) embedded verbatim in the tool description.  |
| `WORKFLOW_TOOL_NESTED_EXAMPLE` | const | A minimal NESTED authoring example (a full `WorkflowDefinition`) — the advanced-form example in the description.   |
| `WORKFLOW_TOOL_DESCRIPTION`    | const | The multi-line description `createWorkflowTool` advertises — the flat form (primary) + the nested form (advanced). |

### Types

| Type                      | Kind      | Shape                                                                                                                                                                                      |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TaskForm`                | type      | A tagged union over the three execution forms, discriminated by `via` — each `{ via, name }` (name = the registry key).                                                                    |
| `TaskVia`                 | type      | `'function' \| 'tool' \| 'agent'` — the `TaskForm` discriminant (the execution mechanism axis).                                                                                            |
| `TaskDefinition`          | interface | `{ id, name, description?, run, retries?, timeout? }` — one task's serializable definition (`run` = its `TaskForm`; `retries` / `timeout` are per-task reliability overrides).             |
| `PhaseDefinition`         | interface | `{ id, name, description?, tasks, concurrency?, bail? }` — ordered tasks (concurrent) + an optional throttle + an optional per-phase `bail` override.                                      |
| `WorkflowDefinition`      | interface | `{ id, name, description?, phases, bail? }` — the root a UI/LLM authors and the contract validates.                                                                                        |
| `TaskDraft`               | interface | `{ id?, name?, description?, run, retries?, timeout? }` — a `TaskDefinition` with OPTIONAL id/name (the tool synthesizes them).                                                            |
| `PhaseDraft`              | interface | `{ id?, name?, description?, tasks, concurrency?, bail? }` — a `PhaseDefinition` with OPTIONAL id/name + `TaskDraft` tasks.                                                                |
| `WorkflowDraft`           | interface | `{ id?, name?, description?, phases, bail? }` — the lenient form `createWorkflowDraftContract` validates + `completeDraft` completes.                                                      |
| `WorkflowStep`            | interface | `{ name, via? }` — one flat step (`name` = a registered behavior name; `via` defaults to `function`).                                                                                      |
| `WorkflowSteps`           | interface | `{ name?, steps }` — the FLAT authoring blob `createWorkflowTool` advertises; each step → a one-task phase via `expandSteps`.                                                              |
| `WorkflowContext`         | interface | `{ id, name, description? }` — the ambient identity every level inherits (the context chain's root).                                                                                       |
| `PhaseContext`            | interface | `WorkflowContext` + `{ workflow }` — a phase's identity plus the back-reference UP the tree.                                                                                               |
| `TaskContext`             | interface | `WorkflowContext` + `{ phase }` — a task's identity plus its full lineage (workflow → phase → task).                                                                                       |
| `WorkflowInput`           | type      | `Partial<WorkflowContext>` — the minimal data to create a workflow context.                                                                                                                |
| `PhaseInput`              | type      | `Partial<PhaseContext>` — the minimal data to create a phase context.                                                                                                                      |
| `TaskInput`               | interface | `Partial<TaskContext>` + `{ metadata? }` — plus the open consumer bag stored + snapshotted, never interpreted.                                                                             |
| `WorkflowErrorCode`       | type      | `'TRANSITION' \| 'RESTORE' \| 'DEPTH' \| 'TOOL'` — the machine-readable code of a `WorkflowError` (`TOOL` = a malformed workflow-tool args blob).                                          |
| `LifecycleStatus`         | type      | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'skipped' \| 'stopped'` — the ONE vocabulary the three tiers alias.                                                                  |
| `TaskStatus`              | type      | A semantic tier of `LifecycleStatus` — a task's lifecycle status.                                                                                                                          |
| `PhaseStatus`             | type      | A semantic tier of `LifecycleStatus` — a phase's status, derived from its tasks.                                                                                                           |
| `WorkflowStatus`          | type      | A semantic tier of `LifecycleStatus` — a workflow's status, derived from its phases under `bail`.                                                                                          |
| `PhaseDerivation`         | interface | `{ status, bail }` — one phase's contribution to the workflow-status derivation (its status + the EFFECTIVE bail it ran under); the input shape of `deriveWorkflowStatus`.                 |
| `TaskResult`              | interface | `{ task, phase, workflow, status, result?, timestamp }` — lineage + the boxed `Result` outcome (present for `completed` / `failed`).                                                       |
| `TaskSnapshot`            | interface | `{ id, name, description?, status, result?, metadata }` — the leaf of the snapshot tree (pure JSON).                                                                                       |
| `PhaseSnapshot`           | interface | `{ id, name, description?, status, override?, bail, tasks }` — `bail` is the effective per-phase policy (persisted); `override` present only when a whole-phase `skip` / `stop` forced it. |
| `WorkflowSnapshot`        | interface | `{ id, name, description?, status, override?, bail, phases, created, updated }` — the COMPLETE self-contained durable payload.                                                             |
| `WorkflowStoreInterface`  | interface | The durable persistence seam — async `get` / `set` / `delete` over a `WorkflowSnapshot` by id (the `SessionStore` driver-swap pattern; no TTL).                                            |
| `WorkflowSnapshotRow`     | interface | `{ id, snapshot }` — one row of the `DatabaseWorkflowStore` table, the snapshot held as one opaque JSON column (`unknown`, narrowed on `get`); keeps the row flat to dodge TS2589.         |
| `WorkflowEventMap`        | type      | The workflow's §13 push surface — `start(id)` · `complete()` · `fail(result)` · `stop()`.                                                                                                  |
| `PhaseEventMap`           | type      | The phase's §13 push surface — `start(id)` · `complete()` · `fail(result)` · `stop()`.                                                                                                     |
| `TaskEventMap`            | type      | The task's §13 push surface — `start(id)` · `complete(result)` · `fail(result)` · `skip()` · `stop()`.                                                                                     |
| `WorkflowHooks`           | type      | `EmitterHooks<WorkflowEventMap>` — initial workflow listeners (the reserved `on` option).                                                                                                  |
| `PhaseHooks`              | type      | `EmitterHooks<PhaseEventMap>` — initial phase listeners.                                                                                                                                   |
| `TaskHooks`               | type      | `EmitterHooks<TaskEventMap>` — initial task listeners.                                                                                                                                     |
| `TaskOptions`             | interface | `{ on?, error?, metadata? }` — the live task's construction bag (§8 / §13).                                                                                                                |
| `PhaseOptions`            | interface | `{ on?, error?, tasks? }` — the live phase's bag; `tasks` keys per-task `TaskOptions` by id.                                                                                               |
| `WorkflowOptions`         | interface | `{ on?, bail?, error?, phases? }` — the live workflow's bag; `phases` keys per-phase `PhaseOptions` by id.                                                                                 |
| `WorkflowInterface`       | interface | The live DERIVED root entity — `emitter` / `status` / `bail` / `phases` + the methods (see [Methods](#workflowinterface)).                                                                 |
| `PhaseInterface`          | interface | The live DERIVED phase entity — `emitter` / `status` / `bail` / `tasks` + the methods (see [Methods](#phaseinterface)).                                                                    |
| `TaskInterface`           | interface | The live leaf state-machine entity — `emitter` / `status` / `result` + the methods (see [Methods](#taskinterface)).                                                                        |
| `TaskManagerInterface`    | interface | The lean tasks manager — `count` + `append` / `task` / `tasks` (no batch matrix).                                                                                                          |
| `PhaseManagerInterface`   | interface | The lean phases manager — `count` + `append` / `phase` / `phases`.                                                                                                                         |
| `WorkflowFunction`        | type      | `(controller: TaskControllerInterface) => Promise<unknown> \| unknown` — the behavior a `function`-form task runs.                                                                         |
| `WorkflowFunctions`       | type      | `Readonly<Record<string, WorkflowFunction>>` — the `function`-task registry (a name absent ⇒ auto-complete).                                                                               |
| `WorkflowAgents`          | type      | `(name: string) => AgentInterface \| undefined` — the `agent`-task resolver (W-c2; resolve a FRESH agent per call).                                                                        |
| `TaskControllerInterface` | interface | The per-task handle — `signal` / `aborted` / `input` / `task` + `results()` (read-up the result tree).                                                                                     |
| `WorkflowResult`          | interface | `{ workflow, status, results }` — the settled live workflow + its terminal status + the flattened result tree.                                                                             |
| `WorkflowRunOptions`      | type      | `WorkflowOptions` + `{ signal?, timeout?, budget?, depth?, ancestry? }` — construction options PLUS the per-run bounds (+ W-c2 bookkeeping).                                               |
| `WorkflowRunnerOptions`   | interface | `{ functions?, tools?, agents?, scheduler? }` — the behavior registries the runner dispatches BY NAME through (+ pacing).                                                                  |
| `WorkflowToolOptions`     | interface | `{ depth?, ancestry? }` — the depth + ancestry a `createWorkflowTool`-built tool runs the NESTED workflow under (the propagation carrier).                                                 |
| `WorkflowToolBinder`      | type      | The `createWorkflowTool` signature, threaded into the runner at construction so it can bind a workflow tool onto a subagent.                                                               |
| `WorkflowRunnerInterface` | interface | The thin orchestrator — `execute(definition, options?)` builds + drives a live tree to a `WorkflowResult`.                                                                                 |
| `SchedulerPriority`       | type      | `'user' \| 'normal' \| 'background'` — a relative urgency hint (uniform in the default; backends honour it).                                                                               |
| `SchedulerOptions`        | interface | `{ priority?: SchedulerPriority; signal?: AbortSignal }` — options for a single `yield` / `delay`.                                                                                         |
| `SchedulerInterface`      | interface | The `yield` / `delay` cooperative-yield methods.                                                                                                                                           |
| `ControllerInterface`     | interface | The per-unit handle a runner handler receives — `id` / `input` / `signal` / `aborted` data members + `wait` / `spawn` / `abort` methods.                                                   |
| `RunnerHandler`           | type      | `(controller) => Promise<TResult> \| TResult` — runs one unit's work against its `Controller`.                                                                                             |
| `RunnerOptions`           | interface | `createRunner` options — `handler` + `concurrency?` / `retries?` / `timeout?` / `entries?` / `on?` / `error?`.                                                                             |
| `RunnerEntryOptions`      | interface | The per-entry reliability overrides for one unit — `{ retries?, timeout? }`, resolved from its input via `entries`.                                                                        |
| `RunnerInterface`         | interface | `emitter` / `active` / `stopped` data members + `execute` / `abort` / `destroy` methods.                                                                                                   |
| `RunnerEventMap`          | type      | The `Runner`'s observable events — `start` / `unit` / `spawn` / `settle` / `fail` / `finish` / `abort`.                                                                                    |
| `RunnerUnit`              | interface | One tracked unit's queue payload — `id` (keys its order + value) + `input` (the handler's work).                                                                                           |
| `UnitOutcome`             | type      | One unit's settled outcome — `{ ok: true; value }` \| `{ ok: false; error }`, so `undefined` is still a success.                                                                           |
| `DeferredInterface`       | interface | `{ promise, resolve, reject }` — a promise whose settlement is driven externally, e.g. for deterministic async test scenarios.                                                             |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed. Its `readonly` data members stay in the Surface rows above (`emitter` is the typed [§13](emitter.md) push surface — see [Observing](#observing); `status` / `result` / `context` / `signal` / `aborted` / `input` / `task` / `count` are read-state). Each `## Entities` / `## Runner` class implements its interface exactly, so this doubles as the per-instance method surface (AGENTS §22).

#### `WorkflowInterface`

The live DERIVED root. `status` is the override-or-derived workflow status (read-state, in the Surface row); the methods navigate down (`phase`), collect the result tree (`results`), force a terminal state (`skip` / `stop`), and serialize (`snapshot`).

| Method     | Returns                       | Behavior                                                                                       |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `phase`    | `PhaseInterface \| undefined` | Look up one live phase by its `id`.                                                            |
| `results`  | `readonly TaskResult[]`       | Every settled task's result across all phases, in positional order.                            |
| `skip`     | `void`                        | FORCE the workflow `skipped` (an override, survives a snapshot).                               |
| `stop`     | `void`                        | FORCE the workflow `stopped` (emits `stop`).                                                   |
| `complete` | `void`                        | FORCE the workflow `completed` (emits `complete`) — the runner settles an executed no-op tree. |
| `snapshot` | `WorkflowSnapshot`            | Serialize the whole live tree to a pure-JSON `WorkflowSnapshot`.                               |

#### `PhaseInterface`

The live DERIVED middle tier. `status` is derived from its tasks (override-or-derived).

| Method     | Returns                      | Behavior                                                          |
| ---------- | ---------------------------- | ----------------------------------------------------------------- |
| `task`     | `TaskInterface \| undefined` | Look up one live task by its `id`.                                |
| `results`  | `readonly TaskResult[]`      | The settled tasks' results, in positional order (the phase tier). |
| `skip`     | `void`                       | FORCE the phase `skipped`.                                        |
| `stop`     | `void`                       | FORCE the phase `stopped` (emits `stop`).                         |
| `snapshot` | `PhaseSnapshot`              | Serialize the phase + its tasks to a `PhaseSnapshot`.             |

#### `TaskInterface`

The live leaf state machine — each transition is GUARDED (an illegal move throws a `TRANSITION` `WorkflowError`) and records a `TaskResult` on a terminal outcome.

| Method     | Returns        | Behavior                                                                 |
| ---------- | -------------- | ------------------------------------------------------------------------ |
| `start`    | `void`         | `pending → running`; emits `start`, then cascades up.                    |
| `complete` | `void`         | `running → completed`; boxes the value as a `Success`, emits `complete`. |
| `fail`     | `void`         | `running → failed`; boxes the reason as a `Failure`, emits `fail`.       |
| `skip`     | `void`         | → `skipped` (intentionally not run); emits `skip`.                       |
| `stop`     | `void`         | → `stopped` (ended early); emits `stop`.                                 |
| `snapshot` | `TaskSnapshot` | Serialize identity + status + the recorded result + metadata.            |

#### `WorkflowRunnerInterface`

| Method    | Returns                   | Behavior                                                                                |
| --------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `execute` | `Promise<WorkflowResult>` | BUILD the live tree from a definition + drive it (phases sequential, tasks concurrent). |

#### `SchedulerInterface`

`yield` hands the host a turn (a macrotask, so the host actually runs) and resumes; `delay` resumes after a minimum interval. Both reject with `signal.reason` when an optional `options.signal` aborts.

| Method  | Returns         | Behavior                                                                                                            |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `yield` | `Promise<void>` | Yield control to the host (a `setTimeout(0)` macrotask, NOT a microtask), then resume. Abort rejects with `reason`. |
| `delay` | `Promise<void>` | Resume after at least `ms` milliseconds. Abort before the deadline rejects with `reason` and clears the timer.      |

#### `TaskControllerInterface`

The per-task handle a `WorkflowFunction` receives. `signal` / `aborted` / `input` / `task` are read-state (in the Surface row).

| Method    | Returns                 | Behavior                                                                         |
| --------- | ----------------------- | -------------------------------------------------------------------------------- |
| `results` | `readonly TaskResult[]` | Every settled task's result across already-finished phases (read-up, read-only). |

#### `PhaseManagerInterface`

The lean phases manager (AGENTS §9) — `count` is read-state (in the Surface row).

| Method   | Returns                       | Behavior                             |
| -------- | ----------------------------- | ------------------------------------ |
| `append` | `void`                        | Add one live phase at the end.       |
| `phase`  | `PhaseInterface \| undefined` | Look up one phase by `id`.           |
| `phases` | `readonly PhaseInterface[]`   | List the phases in positional order. |

#### `TaskManagerInterface`

The lean tasks manager (AGENTS §9) — `count` is read-state (in the Surface row). Order survives an interior `skip` (a skip is a status change, never a removal).

| Method   | Returns                      | Behavior                            |
| -------- | ---------------------------- | ----------------------------------- |
| `append` | `void`                       | Add one live task at the end.       |
| `task`   | `TaskInterface \| undefined` | Look up one task by `id`.           |
| `tasks`  | `readonly TaskInterface[]`   | List the tasks in positional order. |

#### `WorkflowStoreInterface`

The durable persistence seam (W-d) — three async primitives over a `WorkflowSnapshot`, keyed by its own id. BOTH stores implement exactly these — the in-memory `MemoryWorkflowStore` and the driver-pluggable `DatabaseWorkflowStore` (the snapshot one opaque JSON column) — so a durable backend (JSON / SQLite / IndexedDB) swaps in through the same three. There is NO TTL / eviction — a persisted run-state lives until an explicit `delete`.

| Method   | Returns                                  | Behavior                                                           |
| -------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `get`    | `Promise<WorkflowSnapshot \| undefined>` | Resolve the persisted snapshot for `id`, or `undefined` if absent. |
| `set`    | `Promise<void>`                          | Insert or replace under the snapshot's own `id`.                   |
| `delete` | `Promise<void>`                          | Drop by id; an absent id is a no-op (no throw).                    |

#### `RunnerInterface`

`execute` runs the declared units (and their spawns) once and resolves ordered results; `abort` / `destroy` are the §10 lifecycle verbs. The `active` / `stopped` counts are Surface rows.

| Method    | Returns                       | Behavior                                                                                                                      |
| --------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `execute` | `Promise<readonly TResult[]>` | Run all `inputs` and their spawns to completion; resolve results in order (declared first, then spawns). One-shot; fail-fast. |
| `abort`   | `void`                        | Cancel every in-flight + pending unit (and the backing queue); a running `execute` rejects.                                   |
| `destroy` | `void`                        | Tear the runner down — `abort` then stop the backing queue; idempotent.                                                       |

#### `ControllerInterface`

`wait` parks until the unit's signal aborts; `spawn` fans out a sibling unit; `abort` cancels this unit. The `id` / `input` / `signal` / `aborted` members are Surface rows.

| Method  | Returns            | Behavior                                                                                                                   |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `wait`  | `Promise<void>`    | Park until the unit's `signal` aborts — promise-parked, never a timer; resolves immediately if already aborted.            |
| `spawn` | `Promise<TResult>` | Add a sibling unit to the run through the same queue; returns its result promise. Fire-and-track — do NOT await it inline. |
| `abort` | `void`             | Cancel this unit — fires its `signal` with the optional reason.                                                            |

## Contract

These invariants hold across `src/core/workflows` ↔ `workflows.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the workflows source tree (`src/core/workflows`), and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`Workflow` / `Phase` / `Task` / `WorkflowRunner` / `TaskController` / `PhaseManager` / `TaskManager`) exposes exactly its interface's methods, no extra public surface (AGENTS §22). The `readonly` data members (`emitter` / `status` / `result` / `context` / `signal` / `aborted` / `input` / `task` / `count` / `id` / `name` / `description` / `bail` / `phases` / `tasks`) stay in the Surface rows.
3. **Definition is DATA; the runtime is the tree.** A `WorkflowDefinition → PhaseDefinition → TaskDefinition` is pure JSON — behavior referenced BY NAME through a registry, never inline functions — so it round-trips through `createWorkflowContract` (the LLM-tool-args / boundary-validation / restore / test-fixture spine) and persists unchanged. The `Workflow` / `Phase` / `Task` entity classes are the live mirror BUILT from a definition; the definition interfaces are hand-written (the source of truth, AGENTS §14), and the compiled contract's `is` / `parse` / `generate` narrow to them natively (no `as`) — a `generate → is → parse` round-trip parity test guards against drift between the two.
4. **Determinism is fixed by design.** Tasks within a phase run CONCURRENTLY; phases run SEQUENTIALLY. There is no per-task concurrent/sequential toggle and no dependency machinery — a dependency is structural (a later phase), so the same tree always sequences the same way. The per-phase knobs are `concurrency` (an optional resource THROTTLE — max-in-flight; omitted ⇒ `DEFAULT_PHASE_CONCURRENCY`, effectively unbounded) and `bail` (an optional per-phase failure-policy OVERRIDE; omitted ⇒ inherits the workflow `bail`), never a sequencing control; the per-task knobs are `retries` (extra attempts on failure) and `timeout` (per-attempt deadline ms), both reliability overrides threaded to the substrate per unit. The status derivations (`derivePhaseStatus` / `deriveWorkflowStatus`) are therefore order-insensitive set reductions, total (never throw), mirroring the contracts guards' totality (AGENTS §14).
5. **Status is derived from children, per-phase-bail-aware.** A `PhaseStatus` is derived from its tasks' statuses (`bail`-agnostic — a phase surfaces a task failure as `failed` so the policy can decide); a `WorkflowStatus` is derived from its phases' `PhaseDerivation`s (each phase's status paired with the EFFECTIVE `bail` it ran under, `effectiveBail = phase.bail ?? workflow.bail`). A `failed` phase propagates `failed` to the workflow ONLY when ITS effective `bail` is `true` — so a `bail: true` phase HALTS the run even under a graceful (`false`) workflow default, and a `bail: false` phase folds into completion (recorded as data in the result tree) even under a strict (`true`) workflow default. `deriveWorkflowStatus(PhaseDerivation[])` therefore takes the per-phase policy on each phase, not one scalar. The three §10 status tiers (`TaskStatus` / `PhaseStatus` / `WorkflowStatus`) alias ONE `LifecycleStatus` vocabulary, so the single `isTerminalStatus` predicate covers them all.
6. **The leaf is a guarded state machine; the override round-trips.** A `Task`'s transitions read the `TASK_TRANSITIONS` graph via `canTransitionTask` — an illegal move (completing a non-`running` task, starting a settled one) throws a `TRANSITION` `WorkflowError`, so the leaf can never reach an impossible state. A `skip` / `stop` on a DERIVED `Phase` / `Workflow` sets an `#override` that is PERSISTED in the snapshot's own `override` field and restored DIRECTLY (no fragile status-divergence guess); a leaf's terminal status IS its forced marker, so a `TaskSnapshot` needs no `override`.
7. **The result tree is lineage-navigable, three tiers.** A `TaskResult` carries its full lineage (`task` / `phase` / `workflow` contexts) and BOXES the produced outcome in a [`Result`](contract.md): present exactly for `completed` (a `Success`) / `failed` (a `Failure`), absent for `skipped` / `stopped` (terminal without an outcome) and for a non-terminal task. `Phase.results()` is the phase tier; `Workflow.results()` flattens every phase's via `collectResults` (the workflow tier). A `TaskController.results()` reads UP the live tree — every settled task across already-finished phases — so a later phase's `function` task reads an earlier phase's output (the result tree IS the inter-task data-flow map, read-only).
8. **Snapshot is the durable payload.** `Workflow.snapshot()` serializes the whole live tree to a `WorkflowSnapshot` — pure JSON (structure + each node's status + recorded results + the `#override` + positional order + the `bail` policy + creation/update stamps). It is COMPLETE and SELF-CONTAINED: it persists `bail` at BOTH tiers — the workflow default AND each `PhaseSnapshot`'s effective per-phase `bail` (REQUIRED, `phase.bail ?? workflow.bail`) — so `restoreWorkflow` re-derives status IDENTICALLY (per-phase-bail-aware) without a silent default; and it is designed in full so its shape is fixed. `restoreWorkflow` rebuilds an equivalent live tree (same status at every node, same recorded results, same positional order — an interior `skip` / `remove` survives); a structurally invalid snapshot (a status / override outside the lifecycle vocabulary, or a non-boolean `bail` at the workflow tier OR on any phase) is rejected loudly by `assertSnapshot` with a `RESTORE` `WorkflowError`, naming the offending node (the boundary-narrowing guard, AGENTS §14). Per-task `retries` / `timeout` are execution-only (like `run` / `concurrency`) and are NOT persisted — the runner reads them from the definition.
9. **The runner COMPOSES, never re-implements.** `WorkflowRunner.execute` builds the live tree from the definition (the SINGLE source of truth — the per-task `TaskForm` / `retries` / `timeout` and per-phase `concurrency` / `bail` come from the same definition the tree is built from, so the executed tree can never drift) and drives it: phases SEQUENTIALLY (a plain await loop), each phase's tasks CONCURRENTLY through ONE substrate `createRunner` per phase (`concurrency` = the phase's throttle). It writes ZERO concurrency / retry / abort logic — `#runPhase` reads the EFFECTIVE per-phase bail (`effectiveBail = phase.bail ?? workflow.bail`) and maps it onto that substrate Runner's fail-fast (`true`) vs settle-all (`false`), AND threads each task's `retries` / `timeout` through the Runner's per-entry `entries` resolver (the substrate's per-unit overrides); the run-level abort / [timeout](timeout.md) / [budget](budget.md) fold through `AbortSignal.any` (exactly as the agent runtime folds its bounds); pacing is the shipped scheduler. The runner DRIVES the live entity (`start` → `complete` / `fail` / `skip`), never re-implementing status. A run-level cancel halts the loop, `skip`s the remaining tasks / phases, and force-`stop`s the workflow (settles `stopped`); `execute` RESOLVES on a cancel (never rejects) — the partial outcome is read from the returned `WorkflowResult`. The three cancellation causes folded onto a task's signal are TOLD APART (`#runTask`'s `#skipping` discriminator, the runner `Controller`'s unit-`aborted` vs its attempt `signal`): a per-attempt `timeout` is a RETRYABLE FAILURE — a non-final timed-out attempt drives the substrate retry leaving the leaf `running` (a later attempt can still `complete`), a final one `fail`s the leaf — so a timed-out task ends `failed`, never `skipped`; whereas a sibling fail-fast under `bail` and a run-level cancel (abort / run-`timeout` / budget) STILL `skip` the in-flight leaf.
10. **A task runs a function, a tool, or an agent — dispatched BY NAME.** `#dispatch` branches on the task's `TaskForm`: `function` → the `WorkflowFunctions` registry (invoked with a `TaskController`), `tool` → the `ToolManagerInterface` (a tool result's `error` is re-thrown so the leaf `fail`s — honouring `bail`), `agent` → the `WorkflowAgents` resolver (W-c2). A handler that is NOT found (an unregistered name for ANY form) AUTO-COMPLETES (the no-handler rule). The `agent` form is bounded by a depth + cycle guard: running an `agent` task at depth `MAX_WORKFLOW_DEPTH` (it would author a nested workflow at depth + 1), or whose target agent is already an ancestor (`agentTag` in the run `ancestry`, a re-entry cycle), is REJECTED into a typed `DEPTH` `task.fail` — it never runs the agent.
11. **`createWorkflowTool` is the by-agent path, with a WIDENED authoring surface.** It wraps a `WorkflowDefinition` as one LLM-callable `ToolInterface` (named `WORKFLOW_TOOL_NAME`) so a model authors + runs a whole tree in one call, and `createMCPServer` / `createMCPRoutes` expose it over HTTP / WebSocket for free (nothing MCP is wired here). Because a 2B model reliably CALLS the tool but cannot reliably emit the full four-level nested definition (six required `id`/`name` strings, a nested tagged union, all-or-nothing), the tool **advertises the SIMPLE flat shape** (`workflowStepsShape` → `{ name?, steps: [{ name, via? }] }`) as its `parameters`, carries a worked example of both forms in its `description` (`WORKFLOW_TOOL_DESCRIPTION`), and threads per-field `description`s into the advertised schema (the `via` discriminant, the `run` union, the flat `name`/`via`). The widening is **ADDITIVE and lives ONLY at the tool boundary** — the canonical `WorkflowDefinition` / `createWorkflowContract` / runner are byte-for-byte unchanged and STRICT. The handler branches on the authored args' SHAPE: no args ⇒ the wrapped definition; a `steps` array ⇒ the FLAT form, parsed + `expandSteps`'d (one one-task phase per step, a step's `name` → `run.name`, `via` default `function`); otherwise the nested DRAFT form, `createWorkflowDraftContract`-parsed + `completeDraft`'d (any omitted `id`/`name` synthesized positionally — `wf` / `phase-<i>` / `<phaseId>-task-<j>`, a missing name defaulting to its id; a provided one kept; an explicitly-empty `id` rejected, garbage ≠ omitted). The full nested definition is still accepted as the draft super-set (the documented escape-hatch). **EVERY path then converges on the STRICT `createWorkflowContract().is` gate before running** (soundness preserved — the leniency never reaches the runner). The handler conforms to the **universal tool-handler contract** (AGENTS §14): it RETURNS the plain run-summary value (`{ status, count }`, via `workflowToolSummary`) on success and THROWS a typed `WorkflowError` on failure — it does NOT build a `ToolResult` itself. A blob that can't expand / complete, or whose result fails the strict gate (an empty `id`, `concurrency: 0`) ⇒ THROW a `TOOL` `WorkflowError` (no run); an over-deep / cyclic nested run ⇒ THROW a `DEPTH` `WorkflowError` (the same code the agent-task guard raises). The `ToolManager` then performs the ONE canonical wrap — `{ id, name, value }` on a return, `{ id, name, error }` on a throw (ISOLATED, nothing escapes the run) — so the outcome appears EXACTLY ONCE, identically, over BOTH the agent loop and MCP (and a failure's top-level `error` is what `buildToolResult` maps to MCP `isError: true`); there is no doubly-nested `{ id, name, value: { … } }` envelope. The factories→classes seam stays cycle-free: the runner receives `createWorkflowTool` as a value at construction (`WorkflowToolBinder`) rather than importing its own `factories.ts`.
12. **Observation is a pure side-channel (§13).** Each live `Workflow` / `Phase` / `Task` owns a typed `emitter` (`WorkflowEventMap` / `PhaseEventMap` / `TaskEventMap`) firing strictly AFTER each transition — a leaf's OWN event before the cascade re-derives the parents (cause before effect), so an observer sees the leaf changed before the phase / workflow does. The emitter isolates a listener throw and routes it to its OWN `error` handler (the `error` option, surfaced as `(error, event)`, NOT a domain event) — so a buggy observer can NEVER corrupt a transition or the cascade. The `WorkflowRunner` and `TaskController` are EVENT-FREE by design (the runner drives the entities' own emitters; the child managers `PhaseManager` / `TaskManager` are purely structural and observe nothing).

13. **The durable store is a DUAL-store convention.** A `WorkflowStoreInterface` persists the pure-JSON `WorkflowSnapshot` keyed by its own id through two interchangeable backends under `workflows/stores/` — the `QueueStore` / `SessionStore` pattern. `MemoryWorkflowStore` (`createMemoryWorkflowStore`) is the zero-plumbing DEFAULT: a process-lifetime `Map`, no encoding (the snapshot is already pure JSON). `DatabaseWorkflowStore` (`createDatabaseWorkflowStore`) is the opt-in, driver-pluggable twin over a `databases` table — it stores the snapshot as ONE OPAQUE JSON column (a `WorkflowSnapshotRow` `{ id; snapshot }`, the `snapshot` a `rawShape` blob — exactly as `DatabaseQueueStore` stores its `input`). Storing the snapshot whole is lossless (it is COMPLETE and self-contained) AND keeps the row type FLAT — a structured multi-column snapshot table would force the contract to `Infer` the deeply-nested snapshot shape (workflow → phases → tasks → results) and trip TS2589; the opaque column sidesteps it, reading back as `unknown` and narrowed to a `WorkflowSnapshot` on `get` by `isWorkflowSnapshot` (the AGENTS §14 boundary narrow — a total guard, never throwing). The Database store's driver DEFAULTS to memory (`createMemoryDriver()`), so it ALSO works in memory out of the box; you opt into durability by passing a JSON / SQLite / IndexedDB driver, and it swaps in behind the SAME three-method interface WITHOUT touching the runner or the entity tree. Restore stays the shipped `restoreWorkflow` (which applies the DEEPER `assertSnapshot` lifecycle-vocabulary gate — complementary to the shallow `isWorkflowSnapshot` shape guard).

What ships is **W-a → W-d**: the definition contract + the full type surface + the derivation helpers (W-a), the live entity tree + the result tree + snapshot/restore (W-b), the thin `WorkflowRunner` + the three task forms + `createWorkflowTool` + the depth/cycle-bounded agent-native recursion (W-c / W-c2), and the durable `WorkflowStore` (W-d — `WorkflowStoreInterface` + BOTH the in-memory `MemoryWorkflowStore` / `createMemoryWorkflowStore` AND the driver-pluggable `DatabaseWorkflowStore` / `createDatabaseWorkflowStore`, persisting the `WorkflowSnapshot` by id; the `QueueStore` / `SessionStore` driver-swap pattern, so a JSON / SQLite / IndexedDB backend swaps in through the same interface without touching the engine). Deliberately **not** part of this surface yet, by the "build only what earns its keep" discipline: a persistent server/browser driver wired in by default (the durable JSON / SQLite / IndexedDB driver lands with its environment — `DatabaseWorkflowStore` already takes any of them), `resource` (Pool / Worker) task forms, and a top-level `WorkflowManager` registry + child-manager batch overloads. Those are additive — everything above is unchanged.

14. **Cross-environment `setTimeout` default (scheduler).** `Scheduler` uses ONLY `setTimeout` / `clearTimeout` — universally available in browser and Node — so the default runs unchanged in either. It deliberately avoids env-specific fast paths (`setImmediate`, `scheduler.yield`, `requestAnimationFrame`, `node:timers/promises`, `MessageChannel`); those belong to the environment backends.
15. **`yield` is a macrotask host-turn, not a microtask.** `yield()` waits on a zero-delay `setTimeout`, not `queueMicrotask`. A microtask drains before the host regains control, so it would only defer within the current task — it would NOT let pending I/O, timers, or rendering run. A macrotask is the correct cross-environment "give the host a turn", so a microtask queued after a `yield()` call resolves before the yield does.
16. **Abort-aware, with full cleanup.** A pending `yield` / `delay` rejects with `signal.reason` (the standard `AbortSignal` convention) when its `options.signal` aborts. An already-aborted signal rejects immediately WITHOUT arming a timer. Either settle path — the timer firing or the signal aborting — clears the timer and removes the abort listener: no leaked timer, no leaked listener, and no double-settle.
17. **Priority accepted but uniform.** `options.priority` is part of the contract, but a `setTimeout`-based default cannot act on urgency, so it treats every priority the same. It is accepted without error and does not change behavior; environment backends honour it.
18. **Event-free (for now).** The scheduler primitive is pure and functional: no Emitter, no `EventMap`, no `on` hook. Observability is a separate deferred pass, so the surface above stays minimal.
19. **Environment backends honour priority and the native primitive; abort semantics are identical.** Each backend (`NodeScheduler` over `setImmediate`; `BrowserScheduler` over `scheduler.postTask`, `FrameScheduler` over `requestAnimationFrame`, `IdleScheduler` over `requestIdleCallback`) is a standalone `SchedulerInterface` that changes only the `yield` primitive — `delay(ms)` stays a real `setTimeout` — and preserves the contract's abort discipline byte-for-byte: reject with `signal.reason` verbatim, no arming when pre-aborted, full handle + listener cleanup on either settle path, settle-once. Native APIs are feature-detected through guards (`isRecord` / `isFunction`), never an `as` (AGENTS §14), with a real-macrotask fallback where absent. `NodeScheduler` does **not** delegate to `node:timers/promises` (it would replace `signal.reason` with a Node `AbortError`); the timer is hand-rolled. `BrowserScheduler` honours `priority` via `postTask`'s priority levels; the others accept `priority` as a documented no-op.
20. **DOC ↔ SOURCE method bijection (scheduler).** The `## Methods` table lists exactly `SchedulerInterface`'s public methods — exhaustive, both directions — and `Scheduler` plus every backend (`NodeScheduler` / `BrowserScheduler` / `FrameScheduler` / `IdleScheduler`) exposes the same public methods, no more (AGENTS §22).

## Patterns

### Authoring a definition (pure JSON)

```ts
import type { WorkflowDefinition } from '@src/core'

// Behavior is referenced BY NAME — never an inline function. A UI builds this, an LLM emits
// it, persistence stores it; it round-trips through createWorkflowContract.
const definition: WorkflowDefinition = {
	id: 'ingest',
	name: 'Ingest',
	bail: false, // the default — graceful; omit it for the same effect
	phases: [
		{
			id: 'fetch',
			name: 'Fetch',
			concurrency: 4, // an optional resource throttle (max in flight); omit ⇒ unbounded
			tasks: [
				{ id: 'a', name: 'Fetch A', run: { via: 'function', name: 'fetch' } },
				{ id: 'b', name: 'Fetch B', run: { via: 'function', name: 'fetch' } },
			],
		},
		// `summarize` is placed in a LATER phase, so the fetch results are ready when it runs —
		// the phase boundary is the only dependency edge the model has.
		{
			id: 'reduce',
			name: 'Reduce',
			tasks: [{ id: 's', name: 'Summarize', run: { via: 'agent', name: 'summarizer' } }],
		},
	],
}
```

### Validating + seeding with the contract

```ts
import { createWorkflowContract } from '@src/core'

const contract = createWorkflowContract()
contract.is(definition) // true — a total guard (malformed input ⇒ false, never throws)
contract.parse({ id: '', phases: [] }) // undefined — an empty id fails the refinement
contract.generate() // a deterministic valid WorkflowDefinition (seed a RandomFunction for reproducibility)
contract.schema // the emitted JSON Schema for the full definition (createWorkflowTool advertises the simpler FLAT shape)
```

### Running a workflow

```ts
import { createWorkflowRunner } from '@src/core'
import { createToolManager } from '@orkestrel/agent'

const tools = createToolManager() // holds the `tool`-form behaviors
const runner = createWorkflowRunner({
	functions: {
		// A function task receives a TaskController — its signal, input, lineage, and read-up results.
		fetch: async (controller) => {
			if (controller.aborted) return // race long work against controller.signal
			return `fetched ${controller.task.id}`
		},
	},
	tools,
	agents: (name) => registry.build({ provider /* … */ }), // resolve a FRESH agent per call (W-c2)
})

const result = await runner.execute(definition, { timeout: 30_000 })
result.status // 'completed' (graceful) — even if a leaf failed
result.workflow.results() // every settled task's TaskResult, lineage-navigable
```

`execute` is single-source — it builds the live tree from `definition` itself and returns it in `result.workflow`. Omitting `functions` / `tools` / `agents` makes those task forms auto-complete (no handler).

### The `bail` policy — graceful vs halt

```ts
// bail: false (default) — failures are DATA. Every phase runs to the end; the workflow completes.
const graceful = await runner.execute(definition) // a failed leaf is recorded; status === 'completed'

// bail: true — the database-transaction halt. The first failure aborts in-flight siblings
// (their controller.signal fires) AND skips the remaining tasks / phases; status === 'failed'.
const transactional = await runner.execute(definition, { bail: true })
```

A `bail` override on `execute` wins over the definition's `bail` (which wins over `DEFAULT_BAIL`). Under `bail: true`, a mid-flight sibling sees its `controller.signal` fire and should stop promptly.

A phase may OVERRIDE the workflow policy per phase (`effectiveBail = phase.bail ?? workflow.bail`) — a strict phase halts even under a graceful workflow, and a graceful phase settles-all even under a strict one:

```ts
const definition: WorkflowDefinition = {
	id: 'pipeline',
	name: 'Pipeline',
	bail: false, // graceful by default…
	phases: [
		// …but THIS phase is transactional: a failure here HALTS the run (skips the rest).
		{
			id: 'migrate',
			name: 'Migrate',
			bail: true,
			tasks: [/* … */],
		},
		{
			id: 'notify',
			name: 'Notify',
			tasks: [/* … */],
		}, // inherits the workflow bail (false)
	],
}
```

A task may declare per-task reliability — extra attempts on failure and a per-attempt deadline (both override the phase Runner's defaults; execution-only, not persisted):

```ts
{ id: 't', name: 'T', run: { via: 'function', name: 'fetch' }, retries: 3, timeout: 5000 }
```

A per-attempt `timeout` is a RETRYABLE FAILURE of that attempt, NOT a skip: when an attempt exhausts its deadline the runner RETRIES it while `retries` remain (a non-final timed-out attempt leaves the leaf `running` and a later attempt can still recover to `completed`), and only the FINAL attempt's timeout `fail`s the leaf — so a timed-out task ends `failed` (visible to `bail` and `deriveWorkflowStatus`), never `skipped`. A run-level cancel (abort / run-`timeout` / budget) and a sibling fail-fast under `bail` still `skip` the in-flight leaf — only a bare per-attempt deadline counts as a timeout failure.

### Bounding a run (abort / timeout / budget)

```ts
import { createAbort } from '@orkestrel/abort'
import { createBudget } from '@orkestrel/budget'

const abort = createAbort()
const result = await runner.execute(definition, {
	signal: abort.signal, // an external cancellation
	timeout: 10_000, // a whole-run deadline (a non-positive value ⇒ NO deadline)
	budget: createBudget({ max: 50_000, consume: (usage) => usage.total }), // a cost ceiling
})
// A fire of ANY bound folds via AbortSignal.any: it cancels every in-flight task, skips the rest,
// and force-stops the workflow → status === 'stopped'. `execute` RESOLVES (never rejects) on a cancel.
```

### Snapshot & restore (the durable payload)

```ts
import { createWorkflow, restoreWorkflow } from '@src/core'

const workflow = createWorkflow(definition) // a live tree, every node pending
workflow.phase('fetch')?.task('a')?.start() // pending → running (cascades up)

const snapshot = workflow.snapshot() // pure JSON — write to disk, send to a prompt, load across sessions
const restored = restoreWorkflow(snapshot) // an equivalent live tree (status + results + order + override)
restored.status === workflow.status // true — bail comes from the snapshot itself
```

The snapshot is self-contained (it persists `bail` + each node's `override`), so a restore re-derives status identically. An explicit `options.bail` on restore still wins (to deliberately re-run under a different policy).

### The helper functions — guards, derivation, lineage & synthesis

The pure functions the entity tree / runner / tool are built from (AGENTS §4.3 / §14) — exported directly, so a caller can reuse the same derivation or synthesis logic outside the shipped classes:

```ts
import {
	agentTag,
	assertSnapshot,
	buildPhaseContext,
	buildTaskContext,
	buildWorkflowContext,
	canTransitionTask,
	collectResults,
	completeDraft,
	completePhaseDraft,
	completeTaskDraft,
	definitionToSnapshot,
	derivePhaseStatus,
	deriveWorkflowStatus,
	expandSteps,
	isAgentTask,
	isFunctionTask,
	isTerminalStatus,
	isToolTask,
	isWorkflowSnapshot,
	phaseDefinitionToSnapshot,
	stepToForm,
	taskDefinitionToSnapshot,
	workflowTag,
	workflowToolSummary,
} from '@src/core'

// Task-form guards narrow a TaskForm on its `via` discriminant.
isFunctionTask({ via: 'function', name: 'compile' }) // true
isToolTask({ via: 'tool', name: 'publish' }) // true
isAgentTask({ via: 'agent', name: 'reviewer' }) // true

// Ancestry tags — the W-c2 depth/cycle-guard chain.
workflowTag('release') // 'workflow:release'
agentTag('reviewer') // 'agent:reviewer'

// Status predicates + derivations — pure, order-insensitive reductions (never throw).
isTerminalStatus('completed') // true
derivePhaseStatus(['completed', 'skipped']) // 'completed'
deriveWorkflowStatus([{ status: 'failed', bail: false }]) // 'completed' — a graceful-bail failure folds in
canTransitionTask('pending', 'running') // true — reads the TASK_TRANSITIONS graph

// Lineage context builders — each level's identity plus a back-reference up the tree.
const workflowContext = buildWorkflowContext({ id: 'wf', name: 'Wf' })
const phaseContext = buildPhaseContext(workflowContext, { id: 'p1', name: 'P1' })
buildTaskContext(phaseContext, { id: 't1', name: 'T1' })

// Definition → initial snapshot — the unified construction path `createWorkflow` builds from.
const snapshot = definitionToSnapshot(definition) // every node 'pending'
phaseDefinitionToSnapshot(definition.phases[0], snapshot.bail)
taskDefinitionToSnapshot(definition.phases[0].tasks[0])
assertSnapshot(snapshot) // throws a RESTORE WorkflowError on an invalid snapshot; void on a valid one
isWorkflowSnapshot(JSON.parse(JSON.stringify(snapshot))) // true — the shape survives a JSON round-trip

// Result-tree flattening + the tool's plain success summary.
collectResults([[], []]) // [] — no settled tasks yet
const result = await runner.execute(definition)
workflowToolSummary(result) // { status: 'completed', count: result.results.length }

// The tool's lenient-authoring synthesis — id/name auto-filled positionally.
completeDraft({ phases: [{ tasks: [{ run: { via: 'function', name: 'compile' } }] }] })
completePhaseDraft({ tasks: [] }, 0) // → { id: 'phase-0', name: 'phase-0', tasks: [] }
completeTaskDraft({ run: { via: 'function', name: 'compile' } }, 'phase-0', 0)
expandSteps({ steps: [{ name: 'compile' }] }) // one one-task phase per step
stepToForm({ name: 'compile' }) // { via: 'function', name: 'compile' }
```

Every one is pure and side-effect-free: the guards/predicates never throw (`assertSnapshot` is the sole exception — it validates the DEEPER lifecycle vocabulary and throws a `RESTORE` `WorkflowError`), and the builders/synthesizers are deterministic given the same input.

### Persisting & restoring (the durable store)

The `WorkflowStoreInterface` seam (`get` / `set` / `delete`, async, keyed by a snapshot's own id) has a DUAL-store convention — pick the backend, the seam is identical. `createMemoryWorkflowStore` is the zero-plumbing default (a plain `Map`); `createDatabaseWorkflowStore` is the driver-pluggable twin over a `databases` table (the snapshot one opaque JSON column, driver defaulting to memory). Both persist the `WorkflowSnapshot` from the section above unchanged; reading one back and rebuilding the live tree is the shipped `restoreWorkflow`. A durable backend (JSON / SQLite / IndexedDB) swaps in by passing the driver to `createDatabaseWorkflowStore` — without touching the runner or the entity tree (the `SessionStore` / `QueueStore` driver-swap pattern).

```ts
import {
	createDatabaseWorkflowStore,
	createMemoryWorkflowStore,
	createWorkflow,
	restoreWorkflow,
} from '@src/core'
import { createMemoryDriver } from '@orkestrel/database'

// The zero-plumbing default (a plain Map) — or the driver-pluggable twin (one opaque JSON column):
const store = createMemoryWorkflowStore()
// const store = createDatabaseWorkflowStore(createMemoryDriver()) // pass a JSON / SQLite / IndexedDB driver for durability
const workflow = createWorkflow(definition)

await store.set(workflow.snapshot()) // persist the run state under its own id
// …later, in another turn / process …
const snapshot = await store.get(definition.id) // the persisted snapshot, or undefined if absent
const restored = snapshot && restoreWorkflow(snapshot) // an identical live tree
await store.delete(definition.id) // drop it (an absent id is a no-op)
```

The store has NO TTL / eviction — a persisted workflow run-state is durable until an explicit `delete` (unlike a session store), so a long-paused run never silently expires.

### Driving the live entity tree directly

```ts
import { createWorkflow, isWorkflowError } from '@src/core'

const workflow = createWorkflow(definition)
const task = workflow.phase('fetch')?.task('a')
task?.start() // pending → running
task?.complete('done') // running → completed, records a Success; cascades up the tree

// Transitions are guarded — an illegal move throws a TRANSITION WorkflowError.
try {
	task?.complete('again') // already completed
} catch (error) {
	if (isWorkflowError(error) && error.code === 'TRANSITION') retry()
}
```

The cascade is reactive: a leaf transition recomputes its phase, which escalates to the workflow, each re-deriving its status (and emitting on a change). `skip` / `stop` on a phase or workflow FORCE its status (an override).

### Forcing a terminal status — `skip` / `stop`

```ts
import { createWorkflow } from '@src/core'

const workflow = createWorkflow(definition)
const phase = workflow.phase('optional-step')
const task = phase?.task('probe')

task?.skip() // leaf → 'skipped'; emits `skip` — never run, distinct from a stop
task?.stop() // leaf → 'stopped'; emits `stop` — ended early (guarded: only from a live status)

phase?.skip() // FORCE the whole phase 'skipped' — an override, survives a snapshot
phase?.stop() // FORCE the whole phase 'stopped'; emits `stop`

workflow.skip() // FORCE the whole workflow 'skipped' — overrides the derived status
workflow.stop() // FORCE the whole workflow 'stopped'; emits `stop`
```

A `skip` / `stop` at the phase / workflow tier is an OVERRIDE — it forces the node's status regardless of its children's derived value, and the override is persisted in `snapshot()`'s `override` field so `restoreWorkflow` restores it directly. A leaf's `skip` / `stop` is a real guarded transition (no override needed — its terminal status IS the marker).

### Building the live tree by hand — `append`

`createWorkflow` builds every phase/task from the definition via `PhaseManagerInterface.append` / `TaskManagerInterface.append` internally — the same methods are available directly on an already-built tree's managers, e.g. to graft a live phase (or task) built elsewhere onto it:

```ts
import { createWorkflow } from '@src/core'

const main = createWorkflow({ id: 'wf', name: 'Wf', phases: [{ id: 'p1', name: 'P1', tasks: [] }] })
const extra = createWorkflow({
	id: 'extra',
	name: 'Extra',
	phases: [
		{
			id: 'p2',
			name: 'P2',
			tasks: [{ id: 't1', name: 'T1', run: { via: 'function', name: 'noop' } }],
		},
	],
})

const phase = extra.phase('p2')
if (phase) main.phases.append(phase) // adds one live phase at the end, preserving order
main.phases.count // 2

const task = phase?.task('t1')
const target = main.phase('p1')
if (task && target) target.tasks.append(task) // adds one live task at the end
target?.tasks.count // 1
```

`append` adds one live child at the end, preserving positional order; `PhaseManagerInterface` / `TaskManagerInterface` otherwise stay lean (an accessor + `count`, no batch matrix, AGENTS §9.2).

### Authoring through the tool (the small-model path)

`createWorkflowTool` advertises a deliberately-simple FLAT shape so even a 2B model can author a complete tree. The tool accepts three forms and converges them all on the STRICT contract before running:

```ts
import { createWorkflowRunner, createWorkflowTool } from '@src/core'
import { createToolManager } from '@orkestrel/agent'

const tool = createWorkflowTool(definition, runner)

// 1) The ADVERTISED flat form — the simplest thing a small model can emit. Each step becomes a
//    one-task phase, in order; a step's `name` is a REGISTERED behavior name; `via` defaults to 'function'.
await tool.execute({
	name: 'release',
	steps: [{ name: 'compile' }, { name: 'publish', via: 'tool' }],
})
// → { status: 'completed', count: 2 }

// 2) A nested DRAFT — omit any id/name and they are synthesized positionally (wf / phase-0 /
//    phase-0-task-0), a missing name defaulting to its id.
await tool.execute({ phases: [{ tasks: [{ run: { via: 'function', name: 'compile' } }] }] })

// 3) The full nested WorkflowDefinition — the advanced escape-hatch (documented in the tool's
//    description), still accepted unchanged.
await tool.execute({ ...definition })
```

Every form is widened ONLY here, at the tool boundary, then validated against `createWorkflowContract().is` before it runs — a blob that can't expand/complete, or whose result fails the strict gate (an empty `id`, `concurrency: 0`), throws a typed `TOOL` `WorkflowError`. `completeDraft` / `expandSteps` are exported, so a caller can perform the same widening outside the tool.

### Agent tasks & the depth/cycle guard (W-c2)

```ts
import { createWorkflowRunner, createWorkflowTool } from '@src/core'
import { createToolManager } from '@orkestrel/agent'

// An `agent` task runs a subagent. The runner binds a depth/cycle-aware workflow tool onto the
// subagent's context, so the subagent can author + run a NESTED workflow (bounded by MAX_WORKFLOW_DEPTH).
const runner = createWorkflowRunner({ agents: (name) => freshAgentFor(name) })

// The by-agent path: wrap a whole definition as ONE LLM-callable tool.
const tool = createWorkflowTool(definition, runner) // parameters advertise the FLAT authoring shape
const tools = createToolManager()
tools.add(tool) // a model authors + runs a workflow in one call (MCP-exposable for free)
```

The guard rejects an over-deep nested run (past `MAX_WORKFLOW_DEPTH`) or a cycle (an agent / workflow already in the run `ancestry`) — as a typed `DEPTH` `task.fail` (an agent task) or a thrown `DEPTH` `WorkflowError` from the tool handler. The throw never escapes the run: the `ToolManager` ISOLATES it into the canonical tool result's top-level `error` (the universal tool-handler contract, AGENTS §14), so the agent loop / MCP see a clean tool error (MCP `isError: true`) rather than an uncaught fault.

### Observing

Each live `Workflow` / `Phase` / `Task` exposes a typed `emitter` (AGENTS §13) carrying its lifecycle for fire-and-forget observers — logging, metrics, progress UI. Subscribe via `entity.emitter.on(...)`, or wire initial listeners through the reserved `on` option (per-node, keyed by id under `WorkflowOptions.phases[id]` / `.tasks[id]`). Emitting is observation-only — every event fires strictly AFTER the relevant transition, so a listener can never change what a transition does:

```ts
import { createWorkflow } from '@src/core'

const workflow = createWorkflow(definition, { on: { complete: () => log('workflow done') } })
workflow.emitter.on('fail', (result) => log.warn('workflow failed under bail', result)) // the failing TaskResult
workflow
	.phase('fetch')
	?.task('a')
	?.emitter.on('complete', (result) => report(result))
```

The event vocabulary:

| Entity     | Event map          | Events                                                                  |
| ---------- | ------------------ | ----------------------------------------------------------------------- |
| `Workflow` | `WorkflowEventMap` | `start(id)` · `complete()` · `fail(result)` · `stop()`                  |
| `Phase`    | `PhaseEventMap`    | `start(id)` · `complete()` · `fail(result)` · `stop()`                  |
| `Task`     | `TaskEventMap`     | `start(id)` · `complete(result)` · `fail(result)` · `skip()` · `stop()` |

A `start` fires when a node begins (enters `running`); `complete` when it settles successfully; `fail` carries the failing `TaskResult` (a `Workflow` / `Phase` derives `fail` only under `bail: true`); `stop` when it is force-stopped. A `Task` adds `skip`. The leaf's own event fires BEFORE the cascade re-derives its parents (cause before effect). A listener throw is isolated by the emitter and routed to its `error` handler, never the domain surface — so a buggy observer can't corrupt a transition.

### Cooperative loop — yield the host a turn between work units

The dominant use of the scheduler: a long-running loop that periodically hands the host control so it stays responsive, checking an abort signal each pass.

```ts
import { createScheduler } from '@src/core'
import { createAbort } from '@orkestrel/abort'

const abort = createAbort()
const scheduler = createScheduler()

async function pump(): Promise<void> {
	while (!abort.signal.aborted) {
		processOneItem()
		// Give the host a turn (I/O, timers, rendering); abort rejects out of the loop.
		await scheduler.yield({ signal: abort.signal })
	}
}
```

### Backoff — delay a growing interval between attempts

`delay(ms)` waits at least `ms`; pair it with an exponential interval for a retry backoff, and pass a `signal` to bail early.

```ts
import { createScheduler } from '@src/core'

const scheduler = createScheduler()

async function withBackoff(attempt: () => Promise<boolean>, signal?: AbortSignal): Promise<void> {
	for (let n = 0; n < 5; n += 1) {
		if (await attempt()) return
		await scheduler.delay(2 ** n * 100, { signal }) // 100ms, 200ms, 400ms, …
	}
}
```

### Swap the scheduler backend — depend on the interface, choose the native primitive at the edge

Every scheduler is the same `SchedulerInterface`, so consumers type against the interface and never name a concrete class. Pick the host-native backend once at the composition root; the loop is identical regardless of which `yield` primitive runs underneath.

```ts
import type { SchedulerInterface } from '@src/core'
import { createNodeScheduler } from '@src/server' // setImmediate yield
import { createIdleScheduler } from '@src/browser' // requestIdleCallback yield

// Choose per environment at the edge…
const scheduler: SchedulerInterface = isServer ? createNodeScheduler() : createIdleScheduler()

// …then write the loop once against the portable interface.
async function pump(work: () => void, signal: AbortSignal): Promise<void> {
	while (!signal.aborted) {
		work()
		await scheduler.yield({ signal })
	}
}
```

### Practices

- **`yield` to stay cooperative** — between units of long-running work, `await scheduler.yield()` so the host can flush I/O, fire timers, and paint; never busy-loop a tight synchronous loop that starves the host.
- **Always thread a `signal` through the scheduler** — pass `options.signal` through `yield` / `delay` so cancellation rejects the pending wait at once (with the signal's `reason`) instead of stalling until the interval elapses; an aborted loop should fall out via that rejection, not a polled flag alone.
- **`delay` for spacing, `yield` for a turn** — reach for `delay(ms)` to space retries or paced work; reach for `yield()` (a zero-delay turn) when you only need to let the host run before continuing.
- **Type against `SchedulerInterface`** — depend on the interface, not a concrete class, and pick the backend at the composition root, so the same loop runs on any host.
- **No scheduler events yet** — the scheduler is a functional primitive; do not reach for an Emitter here (observability is a separate deferred pass).
- **Author the definition as DATA** — reference behavior BY NAME (`run: { via: 'function', name: '…' }`); register the handlers on the runner, not in the definition.
- **Express a dependency structurally** — put a task that needs another's output in a LATER phase; the phase boundary is the only dependency edge, and it guarantees the inputs are ready.
- **Lean on the contract** — `createWorkflowContract().parse` an untrusted authored blob (an LLM tool arg) into a `WorkflowDefinition` or `undefined`; never trust raw JSON.
- **Choose `bail` deliberately** — `false` (graceful) when failures are useful data and every phase should run; `true` (halt) for transaction semantics where the first failure aborts the rest.
- **Hold the live tree the runner returns** — `result.workflow` is the source of truth; navigate it (`phase(id)?.task(id)?.status` / `.result`) and read the result tree (`results()`).
- **Snapshot for durability** — `workflow.snapshot()` is the pure-JSON payload; `restoreWorkflow` rebuilds an identical live tree (the durable store backend is W-d).
- **Resolve a FRESH agent per `agent` task** — the runner binds a workflow tool onto each resolved agent's context, so two concurrent agent tasks naming the same agent must not share an instance.
- **Observe, don't drive** — subscribe to a node's `emitter` for progress / metrics; emitting is a pure side-channel, so a listener never changes what a transition does (and a throwing one can't corrupt it).

### Runner — Observing

The `Runner` exposes a typed `emitter` (AGENTS §13) carrying its run lifecycle for fire-and-forget observers — logging, metrics, tracing. Subscribe via `runner.emitter.on(...)`, or wire initial listeners through the reserved `on?` option; supply an `error?` handler to receive a listener's throw. **Emitting is observation-only**: every event fires strictly AFTER the relevant unit-launch / settle / drain transition, so a listener can never change what the run does — and a throwing listener can never corrupt it.

```ts
import { createRunner } from '@src/core'

const runner = createRunner<Job, Output>({
	handler: (controller) => run(controller.input),
	on: { finish: (results) => console.log(`done: ${results.length}`) }, // initial listener
})

runner.emitter.on('unit', (id) => trace.begin(id))
runner.emitter.on('fail', (id, error) => log.warn(`unit ${id} failed`, error))
```

The `RunnerEventMap<TResult>` vocabulary:

| Event    | Payload         | Fires when                                                                      |
| -------- | --------------- | ------------------------------------------------------------------------------- |
| `start`  | `[]`            | `execute` begins (once per run).                                                |
| `unit`   | `[id]`          | A unit's handler begins running (declared or spawned).                          |
| `spawn`  | `[id, parent?]` | A sub-unit is spawned — its id + the spawning parent's id.                      |
| `settle` | `[id]`          | A unit completed successfully (its value recorded).                             |
| `fail`   | `[id, error]`   | The FIRST unit failure (fail-fast) — its id + the error.                        |
| `finish` | `[results]`     | The batch settled OK — the ordered results (the same array `execute` resolves). |
| `abort`  | `[reason]`      | The run was aborted — fail-fast cascade, a user `abort`, or `destroy`.          |

A successful run fires `start` → `unit`/`settle` per unit → `finish`. A failure fires `fail` (the first failure only — later failures are ignored) then the run-level `abort`, and `execute` rejects WITHOUT a `finish`. A user `abort` fires `abort` (the units are cancelled, not failed, so no `fail`).

**The listener-isolation safety guarantee.** A listener throw is NEVER allowed to escape into the engine: the emitter isolates it and routes it to its OWN `error` handler (the `error` option, surfaced as `(error, event)`), NOT to a domain event — so a buggy observer is isolated yet not silently lost. Because every emit sits after the unit-launch / settle / drain transition AND is isolated, a buggy observer **cannot corrupt the one-shot / fail-fast / spawn-tracking engine**: the outstanding-unit count gate stays balanced (the run still drains, never truncates or hangs) and fail-fast still rejects with the first error.

### Runner — Run a set of units

```ts
import { createRunner } from '@src/core'

// Ordered (concurrency defaults to 1): each unit runs to completion before the next.
const runner = createRunner<Job, Output>({ handler: (controller) => run(controller.input) })

const outputs = await runner.execute(jobs) // results in input order
```

### Runner — Bounded concurrency

```ts
// Up to 5 units in flight at once; the rest wait for a slot (the Queue's backpressure).
const runner = createRunner<string, Response>({
	concurrency: 5,
	handler: (controller) => fetch(controller.input, { signal: controller.signal }),
})

const responses = await runner.execute(urls)
```

### Runner — Per-entry retries / timeout

```ts
// The runner-level retries / timeout are the defaults; `entries` overrides them per unit
// (its result is a RunnerEntryOptions — { retries?, timeout? }). An omitted field falls back.
const runner = createRunner<Job, Output>({
	retries: 0, // the default for every unit…
	handler: (controller) => run(controller.input, controller.signal),
	entries: (job) => (job.flaky ? { retries: 3 } : {}), // …overridden per input
})
```

### Runner — Fan out with `spawn`

```ts
// A handler discovers more work and fans it out as sibling units — they run through the
// same queue and their results join the output after the declared units, in spawn order.
const runner = createRunner<Task, Result>({
	concurrency: 8,
	handler: (controller) => {
		for (const child of discover(controller.input)) {
			controller.spawn(child) // fire-and-track — do NOT await inline (deadlock caveat)
		}
		return process(controller.input)
	},
})

const results = await runner.execute(roots) // declared roots first, then every spawn
```

`spawn` returns the sibling's result promise, but the run drains it whether or not you await it — so fan out and return. On a bounded runner, awaiting a spawn _inline_ from a slot-holding handler can deadlock; let the runner drain the closure instead.

### Runner — React to cancellation

```ts
const runner = createRunner<Job, Output>({
	concurrency: 4,
	handler: async (controller) => {
		const work = run(controller.input, controller.signal) // honour the signal
		await Promise.race([work, controller.wait()]) // wait() parks until cancelled
		return work
	},
})
```

A handler should observe its `controller.signal` (pass it to `fetch` / child aborts) and may `await controller.wait()` to park until the unit is cancelled — the wait is promise-parked, so it costs nothing until the signal fires.

### Runner — Fail-fast + abort

```ts
const runner = createRunner<Job, Output>({
	concurrency: 4,
	handler: (controller) => run(controller.input, controller.signal),
})
const run = runner.execute(jobs)

// The first unit to throw (after its retries) aborts the rest and rejects the run; an
// external abort does the same.
runner.abort(new Error('shutting down'))
await run.catch((error) => report(error))

// Tear the runner down when it's no longer needed — abort plus stop the backing queue.
// Idempotent: a second `destroy()` is a no-op.
runner.destroy()
```

### Runner — Deterministic async waits with `createDeferred`

`createDeferred` builds a `DeferredInterface` — a promise whose `resolve` / `reject` are exposed to the caller, for driving an async scenario's settlement externally instead of relying on a real delay:

```ts
import { createDeferred } from '@src/core'

const deferred = createDeferred<string>()

// Somewhere else, on your own schedule:
deferred.resolve('done')

await deferred.promise // 'done'
```

### Runner — Practices

- **Honour `controller.signal`** — pass it to `fetch` / child aborts and bail when it fires, so a fail-fast or an `abort` actually stops in-flight units instead of just abandoning their results.
- **Fan out, don't await inline** — `spawn` siblings and return; the run drains the whole closure. Awaiting a spawn inline from a bounded handler risks a slot-starvation deadlock.
- **`concurrency: 1` for ordering** — there is no separate sequential flag; a concurrency of one runs units one-at-a-time.
- **One-shot** — a `Runner` runs one `execute`; create a new one to run another set.
- **Observe, don't drive** — subscribe to `runner.emitter` for run lifecycle moments (see [Runner — Observing](#runner--observing)); emitting is a pure side-channel, so a listener never changes what the run does (and a throwing one can't corrupt it).

## Tests

- [`tests/guides/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ source bijection across `src/core/workflows` (value + type exports), plus each behavioral interface's `## Methods` ↔ source-method bijection and each implementing-class ↔ interface method parity.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — the pure helpers: the task-form guards, `isTerminalStatus`, the `derivePhaseStatus` / `deriveWorkflowStatus` truth tables (the latter taking `PhaseDerivation[]` — each phase's status + its effective `bail`; a graceful-bail `failed` phase folds into `completed` while a strict-bail `failed` phase propagates `failed`, mixed-bail permutations order-insensitive), `canTransitionTask`, the `workflowTag` / `agentTag` ancestry tags, the lineage builders, `definitionToSnapshot` + variants (`phaseDefinitionToSnapshot` persisting the effective per-phase `bail`), `collectResults`, `workflowToolSummary` (the plain `{ status, count }` value the tool handler returns), and the lenient-authoring synthesis — `completeDraft` / `completePhaseDraft` / `completeTaskDraft` (positional ids, name defaulting to id, a provided id/name preserved, the per-phase `bail` + per-task `retries` / `timeout` carried over) and `expandSteps` / `stepToForm` (one one-task phase per step, a step's `name` → `run.name`, `via` default `function`), each yielding a tree the STRICT contract accepts; and `isWorkflowSnapshot` (the §14 boundary narrow `DatabaseWorkflowStore` uses to read back its opaque JSON column — accepting a real snapshot + its JSON-revived form, rejecting off-shape values without throwing).
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — the shape descriptors: the `taskFormShape` / `taskShape` / `phaseShape` / `workflowShape` mirroring the hand-written definition interfaces, the per-field `description`s riding the `via` discriminant + key fields (Rank 1), `describedLiteral`, the draft shapes (`workflowDraftShape` / `phaseDraftShape` / `taskDraftShape` — id/name optional, `run` required, a provided id still `minLength: 1`), and the flat `stepShape` / `workflowStepsShape`.
- [`tests/src/core/tasks/Task.test.ts`](../../tests/src/core/tasks/Task.test.ts) — the leaf state machine: guarded `start` / `complete` / `fail` / `skip` / `stop`, the recorded `TaskResult` (the boxed `Success` / `Failure`), the `TRANSITION` `WorkflowError` on an illegal move, the snapshot, and the `emitter` (`TaskEventMap`) + emit-safety.
- [`tests/src/core/phases/Phase.test.ts`](../../tests/src/core/phases/Phase.test.ts) — the derived middle tier: `derivePhaseStatus` reacting to child transitions (the cascade), the `skip` / `stop` override, `results()`, the snapshot → restore round-trip (the `#override` + positional order after an interior `skip`), and the `emitter` (`PhaseEventMap`) + emit-safety.
- [`tests/src/core/Workflow.test.ts`](../../tests/src/core/Workflow.test.ts) — the derived root: `deriveWorkflowStatus` under both `bail` modes, the cascade propagating up, the result tree (`results()` flattening every phase), the override, the full `snapshot()` → `restoreWorkflow()` round-trip (self-contained `bail` + override), and the `emitter` (`WorkflowEventMap`) + emit-safety.
- [`tests/src/core/phases/PhaseManager.test.ts`](../../tests/src/core/phases/PhaseManager.test.ts) — the lean phases registry: `append` / `phase` / `phases` / `count`, insertion order preserved.
- [`tests/src/core/tasks/TaskManager.test.ts`](../../tests/src/core/tasks/TaskManager.test.ts) — the lean tasks registry: `append` / `task` / `tasks` / `count`, order surviving an interior `skip`.
- [`tests/src/core/tasks/TaskController.test.ts`](../../tests/src/core/tasks/TaskController.test.ts) — the per-task handle: `signal` / `aborted`, the `input` bag, the lineage `task`, and `results()` reading up the live tree.
- [`tests/src/core/WorkflowRunner.test.ts`](../../tests/src/core/WorkflowRunner.test.ts) — the runner end-to-end: phases-sequential / tasks-concurrent, a no-handler task auto-completing, the per-phase `concurrency` throttle, `bail: false` recording failures while finishing vs `bail: true` aborting on the first failure (incl. a fail-while-a-sibling-is-mid-flight), per-task `retries` recovering a divergent task while a no-retry sibling fails + a per-task `timeout` FAILING a parked leaf (never skipping it, the failure recorded under `bail: false`) + a retries+timeout attempt RECOVERING (attempt 1's deadline retries, attempt 2 `completes` — the recovered value kept) + a `bail: true` timeout-only fault deriving `failed` and halting a later phase + the sibling-fail-fast still SKIPPING a parked sibling (the timeout distinguisher does not break skip-on-fail-fast) + an omission-regression (neither field = today's behavior), the per-phase `bail` override (a strict phase halting under a graceful workflow / a graceful phase settling-all under a strict workflow / the `effectiveBail = phase.bail ?? workflow.bail` inheritance pair), the abort / timeout / budget fold (settling `stopped`), the `function` / `tool` / `agent` dispatch, and the depth-guard rejecting an over-deep / cyclic agent task into a typed `DEPTH` failure.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createWorkflowContract` / `createWorkflowDraftContract` / `createWorkflow` / `restoreWorkflow` / `assertSnapshot` / `createWorkflowRunner` / `createWorkflowTool` each return a working instance / value (a round-trip), and `assertSnapshot` rejecting an invalid snapshot with a `RESTORE` `WorkflowError`. The `createWorkflowTool` handler conforms to the universal tool-handler contract (AGENTS §14): a valid blob (or no args) RETURNS the plain `{ status, count }` summary, while a malformed blob THROWS a `TOOL` `WorkflowError` and an over-deep / cyclic call THROWS a `DEPTH` one. The WIDENED authoring surface is covered end-to-end: `tool.parameters` advertises the FLAT shape (`{ name, steps: [{ name, via }] }`, with per-field `description`s) — NOT the nested definition; a flat blob and an ids-omitted nested blob each run to `{ status: 'completed', count: N }`; the full nested form still runs as the escape-hatch; a flat blob that can't expand throws `TOOL`; the embedded doc examples (`WORKFLOW_TOOL_FLAT_EXAMPLE` / `WORKFLOW_TOOL_NESTED_EXAMPLE`) each satisfy their contract (Rank-1 anti-drift). The load-bearing F2-WRAP proof runs the tool through a REAL `createToolManager()` and asserts the resulting `ToolResult` is SINGLE-LEVEL (success → `value` IS the plain summary, no nested `{ id, name, value }`; failure → a top-level `error`, no `value`), then feeds that result to `buildToolResult` to assert a failure maps to MCP `isError: true` (and a success to the plain summary text).
- [`tests/src/core/stores/MemoryWorkflowStore.test.ts`](../../tests/src/core/stores/MemoryWorkflowStore.test.ts) — the in-memory store (W-d): a `set` → `get` round-trip returning the same `WorkflowSnapshot` and `restoreWorkflow`'ing an IDENTICAL live tree, for BOTH an all-pending snapshot (`createWorkflow(...).snapshot()`) and a real SETTLED one driven through `createWorkflowRunner().execute` (real `completed` statuses + recorded results); the driver-swap parity case (the retrieved payload survives `JSON.parse(JSON.stringify(...))` AND restores identically from the JSON-revived form — proving it persists unchanged across any JSON / SQLite / IndexedDB backend); `set` replacing under the same id; and `delete` (then `get` ⇒ `undefined`, an absent-id `delete` a no-op, an absent-id `get` ⇒ `undefined`). REAL data throughout (a real `WorkflowDefinition` + real `WorkflowFunction` handlers), no mocks.
- [`tests/src/core/stores/DatabaseWorkflowStore.test.ts`](../../tests/src/core/stores/DatabaseWorkflowStore.test.ts) — the driver-pluggable twin (W-d): the SAME `WorkflowStoreInterface` contract over a REAL `databases` table (a memory driver), with the snapshot stored as one opaque JSON column — a `set` → `get` round-trip returning the same `WorkflowSnapshot` and `restoreWorkflow`'ing an IDENTICAL live tree (all-pending AND a real SETTLED snapshot driven through `createWorkflowRunner().execute`); `set` replacing under the same id; `delete` (+ absent-id `delete` no-op, absent-id `get` ⇒ `undefined`); and the driver-swap smoke (the default-driver factory builds an equivalent memory-backed store; two distinct workflow ids coexist without cross-contamination). REAL `WorkflowSnapshot` values throughout (a real `WorkflowDefinition` + real `WorkflowFunction` handlers), NO mocks.
- [`tests/src/core/Runner.test.ts`](../../tests/src/core/Runner.test.ts) — `execute` runs every input and returns results in declared order (even with out-of-order completion); spawned siblings actually run and order after the declared units; nested spawns drain transitively; bounded concurrency caps handlers in flight; `retries` re-run a flaky unit; fail-fast (one unit throwing rejects `execute` AND fires the siblings' signals); `abort()` mid-run rejects `execute` and aborts every unit; one-shot (a second `execute` throws); `spawn` outside a run throws; empty `execute([])` resolves to `[]`; `active` / `stopped` reporting; idempotent `destroy`.
- [`tests/src/core/Controller.test.ts`](../../tests/src/core/Controller.test.ts) — `wait()` resolves when the unit's signal aborts and stays pending across real delays until it does (promise-parked, not timer-polled), resolving immediately if already aborted; `id` / `input` / `signal` / `aborted` reflect the unit; `abort(reason)` fires the signal with the reason; `spawn` delegates to the injected callback.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createRunner` round-trip: fan-out via `spawn` with ordered results, and concurrency / retries options honoured end to end — alongside the scheduler + workflow-runner + tool factories.

- [`tests/src/core/Scheduler.test.ts`](../../tests/src/core/Scheduler.test.ts) — `yield()` resolves asynchronously and as a macrotask (a microtask queued after it runs first), `yield` / `delay` reject with `signal.reason` when pre-aborted and when aborted while pending, `delay(ms)` resolves after `ms` (fake timers), an abort before the deadline clears the timer so it never later fires (no double-settle), a completed call leaves no pending timer or listener, and `priority` is accepted (across `yield` / `delay`, combined with `signal`) without changing behavior. Production-hardening: thousands of resolved AND aborted `yield` / `delay` calls never accumulate host timers (`vi.getTimerCount()` → 0) and the abort listener nets to zero across churn; one shared `AbortSignal` rejects ALL its pending operations with the reason and clears every timer/listener with no double-settle; many concurrent `delay`s at distinct deadlines each resolve at exactly their own time; abort-timing edges; the `ms` clamp for `0` / `1` / negative / `NaN` / very large; and the reason is forwarded verbatim.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createScheduler` returns a working `SchedulerInterface` whose `yield` and `delay` round-trip and whose `delay` is abort-aware, and returns independent stateless instances (aborting a signal bound to one does not affect another) — alongside the workflow-runner + tool factories.
- [`tests/src/server/NodeScheduler.test.ts`](../../tests/src/server/NodeScheduler.test.ts) — the Node backend over REAL `setImmediate` / `setTimeout`: `yield()` resolves as a `setImmediate` macrotask, `delay(ms)` resolves after `ms` with a `vi.getTimerCount()` leak proof, already-aborted `yield` / `delay` rejects with the EXACT `signal.reason` WITHOUT arming, an abort during a pending `delay` clears the timer, a completed call removes its abort listener, priority is an accepted no-op, and churn leaves zero pending timers / a balanced listener net.
- [`tests/src/server/factories.test.ts`](../../tests/src/server/factories.test.ts) — `createNodeScheduler` returns a working `SchedulerInterface` (shape + a real yield/delay round-trip), abort-aware, independent stateless instances.
- [`tests/src/browser/BrowserScheduler.test.ts`](../../tests/src/browser/BrowserScheduler.test.ts) — the browser backend in REAL headless Chromium (where `scheduler.postTask` exists): `yield()` resolves via the real `postTask` callback, every priority is accepted, abort rejects with the verbatim `signal.reason` and the posted task is cancelled, `delay` timing, and a completed call leaves no abort listener.
- [`tests/src/browser/FrameScheduler.test.ts`](../../tests/src/browser/FrameScheduler.test.ts) — the frame backend in REAL Chromium over `requestAnimationFrame`: `yield()` resolves in a real frame callback, abort cancels the rAF handle and rejects with the verbatim reason, `delay` timing, and no leaked listener.
- [`tests/src/browser/IdleScheduler.test.ts`](../../tests/src/browser/IdleScheduler.test.ts) — the idle backend in REAL Chromium over `requestIdleCallback`: `yield()` resolves in a real idle callback, abort cancels the idle handle and rejects with the verbatim reason, `delay` timing, and no leaked listener; the `setTimeout(0)` fallback is covered by the guard logic + a note.
- [`tests/src/browser/factories.test.ts`](../../tests/src/browser/factories.test.ts) — `createBrowserScheduler` / `createFrameScheduler` / `createIdleScheduler` each return a working `SchedulerInterface` (shape + a real yield/delay round-trip), abort-aware, independent instances, in real Chromium.

## See also

- [`contract.md`](contract.md) — the shape DSL and `createContract` the workflow definition contract is built on, and the `Result` a `TaskResult` boxes.
- `ToolManager` / `ToolInterface` (the future `@orkestrel/agent` package) — the `tool` task and `createWorkflowTool` use them, and its `AgentInterface` is what an `agent` task resolves.
- [`abort.md`](abort.md) · [`timeout.md`](timeout.md) · [`budget.md`](budget.md) — the run-level bounds the runner (`Runner` / `WorkflowRunner`) folds; the scheduler (pacing) is documented in this guide.
- [`emitter.md`](emitter.md) — the typed §13 emitter each live entity owns.
- [`AGENTS.md`](../../AGENTS.md) — the rules; §4.4 the `bail` boolean toggle, §10 the lifecycle vocabulary, §12 errors & `Result`, §14 totality, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
