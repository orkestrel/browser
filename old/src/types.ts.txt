/**
 * Custom equality comparison for suppressing redundant updates.
 */
export type EqualFunction<T> = (previous: T, next: T) => boolean

// === Reactive Internals

/**
 * Internal observer that reacts to dependency changes.
 * Implemented by Compute, Effect, and Watch.
 */
export interface ReactiveObserver {
	notify(): void
}

// === Batch

/**
 * Reactive batch coordinator for dependency tracking and
 * deferred notification scheduling.
 *
 * @remarks
 * - `active` — true when inside a batch
 * - `run` — execute a function with deferred notifications
 * - `schedule` — queue or fire a callback based on batch state
 * - `start` — begin tracking dependencies for an observer
 * - `stop` — end tracking and return collected dependency edges
 * - `report` — register a dependency from active observer to source
 * - `remove` — detach an observer from all dependency sources
 */
export interface BatchInterface {
	readonly active: boolean
	run<T>(fn: () => T): T
	schedule(callback: () => void): void
	start(observer: ReactiveObserver): void
	stop(): Set<Set<ReactiveObserver>>
	report(observers: Set<ReactiveObserver>): void
	remove(observer: ReactiveObserver, dependencies: Set<Set<ReactiveObserver>>): void
}

// === Signal

/**
 * Configuration for creating a Signal.
 *
 * @remarks
 * - `equal` — custom equality function (default `Object.is`)
 */
export interface SignalOptions<T> {
	readonly equal?: EqualFunction<T>
}

/**
 * Writable reactive state cell in the reactive graph.
 *
 * @remarks
 * - `get` — tracked read (registers dependency with active observer)
 * - `peek` — untracked read (no dependency registration)
 * - `set` — update value and notify dependents when changed
 * - `update` — transform value via callback and notify dependents
 * - `subscribe` — manual callback on value change
 */
export interface SignalInterface<T> {
	get(): T
	peek(): T
	set(value: T): void
	update(fn: (value: T) => T): void
	subscribe(callback: (value: T) => void): () => void
}

// === Compute

/**
 * Configuration for creating a Compute.
 *
 * @remarks
 * - `equal` — custom equality function for suppressing downstream updates (default `Object.is`)
 */
export interface ComputeOptions<T> {
	readonly equal?: EqualFunction<T>
}

/**
 * Cached derived reactive value.
 *
 * @remarks
 * - `get` — tracked read; recomputes lazily when dirty
 * - `peek` — untracked read of cached value
 * - `subscribe` — manual callback when computed value changes
 * - `destroy` — unsubscribe from all dependencies
 */
export interface ComputeInterface<T> {
	get(): T
	peek(): T
	subscribe(callback: (value: T) => void): () => void
	destroy(): void
}

// === Effect

/**
 * Tracked reactive side effect with automatic dependency tracking.
 *
 * @remarks
 * - Runs immediately on creation
 * - Re-runs when any tracked dependency changes
 * - `destroy` — run cleanup, unsubscribe from all dependencies
 */
export interface EffectInterface {
	destroy(): void
}

// === Watch

/**
 * Source for a Watch: a Signal, Compute, or getter function.
 */
export type WatchSource<T> = SignalInterface<T> | ComputeInterface<T> | (() => T)

/**
 * Callback invoked when a watched value changes.
 */
export type WatchHandler<T> = (value: T, previous: T) => void

/**
 * Configuration for creating a Watch.
 *
 * @remarks
 * - `equal` — custom equality function (default `Object.is`)
 * - `sync` — when true, callback fires synchronously on change (default false: batched)
 */
export interface WatchOptions<T> {
	readonly equal?: EqualFunction<T>
	readonly sync?: boolean
}

/**
 * Explicit source watcher with old/new value callback.
 *
 * @remarks
 * - Tracks only the source getter, not the callback
 * - Callback receives (newValue, oldValue) when source value changes
 * - `destroy` — stop watching, unsubscribe from source dependencies
 */
export interface WatchInterface {
	destroy(): void
}

// === Scope

/**
 * Any object with a `destroy` method.
 */
export interface Destroyable {
	destroy(): void
}

/**
 * Ownership container for grouping and tearing down resources.
 *
 * @remarks
 * - `run` — execute a function guarded against double-destroy
 * - `add` — register disposers (callbacks) or destroyable objects for teardown
 * - `destroy` — run all disposers in reverse order
 */
export interface ScopeInterface {
	run<T>(fn: () => T): T
	add(...items: ((() => void) | Destroyable)[]): void
	destroy(): void
}

// === Resource

/**
 * Async fetch function for a Resource.
 */
export type ResourceFetcher<T> = (signal: AbortSignal) => Promise<T>

/**
 * Lifecycle status of a Resource.
 */
export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Configuration for creating a Resource.
 *
 * @remarks
 * - `fetcher` — required async function producing the resource value
 * - `initial` — optional initial value before first load
 */
export interface ResourceOptions<T> {
	readonly fetcher: ResourceFetcher<T>
	readonly initial?: T
}

/**
 * Async state wrapper with lifecycle and reactive integration.
 *
 * @remarks
 * - `value` — current value (reactive via internal signal)
 * - `error` — current error (reactive via internal signal)
 * - `loading` — true while fetching (reactive via internal signal)
 * - `ready` — true after successful fetch (reactive via internal signal)
 * - `status` — current lifecycle status (reactive via internal signal)
 * - `load` — trigger initial fetch
 * - `reload` — cancel in-progress fetch and re-fetch
 * - `clear` — reset to initial state
 * - `destroy` — cancel fetch and release resources
 */
export interface ResourceInterface<T> {
	readonly value: T | undefined
	readonly error: unknown
	readonly loading: boolean
	readonly ready: boolean
	readonly status: ResourceStatus
	load(): Promise<void>
	reload(): Promise<void>
	clear(): void
	destroy(): void
}

// === Channel

/**
 * Manual pub/sub event transport.
 *
 * @remarks
 * - `send` — push a value to all subscribers
 * - `subscribe` — register a callback for incoming values
 * - `destroy` — remove all subscribers
 */
export interface ChannelInterface<T> {
	send(value: T): void
	subscribe(callback: (value: T) => void): () => void
	destroy(): void
}

// === Stream

/**
 * Source setup function for creating a Stream.
 * Receives an emit callback and optionally returns a cleanup function.
 */
export type StreamSource<T> = (emit: (value: T) => void) => void | (() => void)

/**
 * Transformable event sequence over time.
 *
 * @remarks
 * - `subscribe` — register a callback for emitted values
 * - `map` — transform values into a new stream
 * - `filter` — create a stream of values matching a predicate
 * - `merge` — combine with another stream
 * - `destroy` — unsubscribe from source and remove all subscribers
 */
export interface StreamInterface<T> {
	subscribe(callback: (value: T) => void): () => void
	map<U>(fn: (value: T) => U): StreamInterface<U>
	filter(fn: (value: T) => boolean): StreamInterface<T>
	merge(other: StreamInterface<T>): StreamInterface<T>
	destroy(): void
}

// === Scheduler

/**
 * Configuration for creating a Scheduler.
 *
 * @remarks
 * - `concurrency` — max parallel job executions (default 1)
 */
export interface SchedulerOptions {
	readonly concurrency?: number
}

/**
 * Job execution scheduler with lifecycle control.
 *
 * @remarks
 * - `active` — true when started and processing jobs
 * - `paused` — true when paused
 * - `count` — number of pending jobs
 * - `running` — number of jobs currently executing
 * - `append` — add a job to the end of the queue
 * - `start` — begin processing jobs
 * - `pause` — suspend processing
 * - `resume` — continue after pause
 * - `stop` — stop processing and clear pending jobs
 * - `destroy` — permanent teardown
 * - `execute` — reusable barrier resolving when pending and running reach zero
 */
export interface SchedulerInterface {
	readonly active: boolean
	readonly paused: boolean
	readonly count: number
	readonly running: number
	append(job: () => Promise<void> | void): void
	start(): void
	pause(): void
	resume(): void
	stop(): void
	destroy(): void
	execute(): Promise<void>
}

// === Result Pattern

/**
 * Successful operation result.
 */
export interface Success<T> {
	readonly success: true
	readonly value: T
}

/**
 * Failed operation result.
 */
export interface Failure<E> {
	readonly success: false
	readonly error: E
}

/**
 * Discriminated union for operations that can succeed or fail safely.
 */
export type Result<T, E = Error> = Success<T> | Failure<E>

// === Queue

/**
 * Async handler invoked for each enqueued context.
 */
export type QueueHandler<TContext, TResult> = (context: TContext) => Promise<TResult>

/**
 * Lifecycle status of a tracked queue entry.
 */
export type QueueEntryStatus =
	| 'pending'
	| 'scheduled'
	| 'active'
	| 'completed'
	| 'failed'
	| 'aborted'
	| 'expired'

/**
 * Scheduling configuration for a queue entry.
 *
 * @remarks
 * - `delay` — ms from enqueue time until the entry becomes ready
 * - `activation` — absolute epoch timestamp when the entry becomes ready
 * - `expiration` — absolute epoch timestamp after which the entry is auto-expired
 */
export interface QueueEntrySchedule {
	readonly delay?: number
	readonly activation?: number
	readonly expiration?: number
}

/**
 * Per-entry overrides applied to a single enqueued context.
 *
 * @remarks
 * - `id` — user-provided identifier (auto-generated when omitted)
 * - `retries` — override queue-level retries for this entry
 * - `timeout` — override queue-level timeout for this entry
 * - `signal` — per-entry AbortSignal for individual cancellation
 * - `sequential` — when true, the entry runs exclusively with no other active tasks
 * - `bail` — override queue-level bail for this entry
 * - `priority` — higher values are promoted and processed first (default 0)
 * - `schedule` — scheduling configuration (delay, activation, expiration)
 */
export interface QueueEntryOptions {
	readonly id?: string
	readonly retries?: number
	readonly timeout?: number
	readonly signal?: AbortSignal
	readonly sequential?: boolean
	readonly bail?: boolean
	readonly priority?: number
	readonly schedule?: QueueEntrySchedule
}

/**
 * Public read-only snapshot of a tracked queue entry.
 */
export interface QueueEntryState<TContext> {
	readonly id: string
	readonly context: TContext
	readonly status: QueueEntryStatus
	readonly attempts: number
	readonly options: QueueEntryOptions | undefined
	readonly schedule: QueueEntrySchedule | undefined
	readonly timestamp: number
}

/**
 * Mutable subset of queue options for runtime reconfiguration.
 *
 * @remarks
 * - `concurrency` — max parallel workers
 * - `bail` — abort all pending on first failure
 * - `timeout` — ms before a single handler invocation is aborted
 * - `retries` — extra attempts after the first failure
 * - `signal` — replaces the external AbortSignal (detaches the previous one)
 */
export interface QueueConfiguration {
	readonly concurrency?: number
	readonly bail?: boolean
	readonly timeout?: number
	readonly retries?: number
	readonly signal?: AbortSignal
}

/**
 * Persistence contract for saving and restoring queue entry state.
 */
export interface QueueStoreInterface<TContext> {
	/**
	 * Save all tracked entries to the store.
	 *
	 * @param entries - Readonly snapshot of tracked entries
	 */
	save(entries: readonly QueueEntryState<TContext>[]): Promise<void>

	/**
	 * Load previously saved entries from the store.
	 *
	 * @returns Readonly array of stored entry states
	 */
	load(): Promise<readonly QueueEntryState<TContext>[]>

	/**
	 * Remove all entries from the store.
	 */
	clear(): Promise<void>
}

/**
 * Configuration for creating a Queue.
 *
 * @remarks
 * - `handler` — required async function processing each context
 * - `concurrency` — max parallel workers (default 1)
 * - `bail` — abort all pending on first failure (default false)
 * - `signal` — external AbortSignal for cancellation
 * - `timeout` — ms before a single handler invocation is aborted (default 0 = none)
 * - `retries` — extra attempts after the first failure (default 0)
 * - `store` — optional persistence store for sync/restore
 */
export interface QueueOptions<TContext, TResult> {
	readonly handler: QueueHandler<TContext, TResult>
	readonly concurrency?: number
	readonly bail?: boolean
	readonly signal?: AbortSignal
	readonly timeout?: number
	readonly retries?: number
	readonly store?: QueueStoreInterface<TContext>
}

/**
 * Internal entry binding an enqueued context to its promise resolver.
 */
export interface QueueEntry<TContext, TResult> {
	readonly id: string
	readonly context: TContext
	readonly resolve: (result: Result<TResult>) => void
	readonly options: QueueEntryOptions | undefined
}

/**
 * Queue entry held in the sorted waiting list until its activation time.
 *
 * @remarks
 * - `entry` — the underlying queue entry with context and resolver
 * - `activation` — absolute epoch timestamp when the entry becomes ready
 * - `priority` — promotion priority (higher values processed first)
 * - `expiration` — absolute epoch timestamp after which the entry is auto-expired
 */
export interface QueueScheduledEntry<TContext, TResult> {
	readonly entry: QueueEntry<TContext, TResult>
	readonly activation: number
	readonly priority: number
	readonly expiration: number | undefined
}

/**
 * Public interface for a task queue with lifecycle control,
 * runtime configuration, per-entry options, and persistence.
 */
export interface QueueInterface<TContext, TResult> {
	readonly count: number
	readonly active: number
	readonly completed: number
	readonly failed: number
	readonly paused: boolean
	readonly stopped: boolean
	readonly aborted: boolean
	readonly bailed: boolean
	readonly idle: boolean

	/**
	 * Add a context to the end of the pending queue.
	 *
	 * @param context - Payload to process
	 * @param options - Optional per-entry overrides
	 * @returns Result of handler execution
	 */
	enqueue(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>

	/**
	 * Add a context to the front of the pending queue (priority).
	 *
	 * @param context - Payload to process
	 * @param options - Optional per-entry overrides
	 * @returns Result of handler execution
	 */
	prepend(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>

	/**
	 * Return the pending contexts without consuming them.
	 *
	 * @returns Readonly snapshot of pending payloads
	 */
	contexts(): readonly TContext[]

	/**
	 * Look up a tracked entry by ID.
	 *
	 * @param id - Entry identifier
	 * @returns Entry state or undefined if not found
	 */
	entry(id: string): QueueEntryState<TContext> | undefined

	/**
	 * Return all tracked entries across all statuses.
	 *
	 * @returns Readonly snapshot of all tracked entries
	 */
	entries(): readonly QueueEntryState<TContext>[]

	/**
	 * Update queue-level options at runtime.
	 *
	 * @param options - Partial configuration to merge
	 */
	configure(options: QueueConfiguration): void

	start(): void
	stop(): void
	pause(): void
	resume(): void
	abort(): void
	clear(): void
	destroy(): void

	/**
	 * Reusable barrier resolving when both pending and active reach zero.
	 */
	execute(): Promise<void>

	/**
	 * Save all tracked entries to the configured store.
	 * No-op when no store is configured.
	 */
	sync(): Promise<void>

	/**
	 * Load entries from the configured store and re-enqueue pending/active ones.
	 * No-op when no store is configured.
	 */
	restore(): Promise<void>

	/**
	 * Coordinated teardown: sync to store, stop workers, and wait for active
	 * tasks to drain. Resolves when all resources are released.
	 */
	shutdown(): Promise<void>
}

// === Pool

/**
 * Async factory producing a resource instance.
 */
export type PoolCreateFunction<T> = () => Promise<T>

/**
 * Async destructor cleaning up a resource instance.
 */
export type PoolDestroyFunction<T> = (resource: T) => Promise<void>

/**
 * Async health check returning true if the resource is usable.
 */
export type PoolValidateFunction<T> = (resource: T) => Promise<boolean>

export interface PoolWaiter<T> {
	readonly resolve: (token: PoolToken<T>) => void
	readonly reject: (error: Error) => void
	readonly timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Configuration for creating a Pool.
 *
 * @remarks
 * - `create` — required async factory
 * - `destroy` — optional async destructor
 * - `validate` — optional async health check run before each acquire
 * - `min` — minimum pre-created resources (default 0)
 * - `max` — upper bound on total resources (default Infinity)
 * - `timeout` — ms for create/acquire/drain before failing (default 30000)
 * - `retries` — create retry count on failure (default 0)
 */
export interface PoolOptions<T> {
	readonly create: PoolCreateFunction<T>
	readonly destroy?: PoolDestroyFunction<T>
	readonly validate?: PoolValidateFunction<T>
	readonly min?: number
	readonly max?: number
	readonly timeout?: number
	readonly retries?: number
}

/**
 * Handle returned by acquire. Callers must invoke release exactly once.
 */
export interface PoolToken<T> {
	readonly value: T
	readonly index: number
	release(): void
}

/**
 * Read-only snapshot of pool metrics.
 */
export interface PoolStats {
	readonly size: number
	readonly available: number
	readonly borrowed: number
	readonly pending: number
	readonly min: number
	readonly max: number
	readonly created: number
	readonly destroyed: number
	readonly failed: number
}

/**
 * Public interface for a resource pool with acquire/release semantics.
 */
export interface PoolInterface<T> {
	readonly size: number
	readonly borrowed: number
	readonly destroyed: boolean
	readonly draining: boolean
	readonly stats: PoolStats
	ready(): Promise<void>
	acquire(): Promise<PoolToken<T>>
	use<R>(fn: (resource: T) => Promise<R> | R): Promise<R>
	drain(timeout?: number): Promise<void>
	destroy(): Promise<void>
}

// === Worker

/**
 * Async handler invoked for each enqueued context with a pooled resource.
 */
export type WorkerHandler<TContext, TResource, TResult> = (
	context: TContext,
	resource: TResource,
) => Promise<TResult>

/**
 * Configuration for creating a Worker.
 *
 * @remarks
 * - `handler` — required async function receiving context and a pooled resource
 * - `pool` — required pool configuration (create, destroy, validate, min, max, timeout, retries)
 * - `concurrency` — max parallel task executions (default 1)
 * - `bail` — abort all pending on first failure (default false)
 * - `signal` — external AbortSignal for cancellation
 * - `timeout` — ms before a single handler invocation is aborted (default 0 = none)
 * - `retries` — extra handler attempts after the first failure (default 0)
 * - `store` — optional persistence store for sync/restore
 */
export interface WorkerOptions<TContext, TResource, TResult> {
	readonly handler: WorkerHandler<TContext, TResource, TResult>
	readonly pool: PoolOptions<TResource>
	readonly concurrency?: number
	readonly bail?: boolean
	readonly signal?: AbortSignal
	readonly timeout?: number
	readonly retries?: number
	readonly store?: QueueStoreInterface<TContext>
}

/**
 * Read-only snapshot of combined worker metrics.
 */
export interface WorkerStats {
	readonly count: number
	readonly active: number
	readonly completed: number
	readonly failed: number
	readonly size: number
	readonly available: number
	readonly borrowed: number
}

/**
 * Public interface for a resource-backed task worker combining
 * a queue (job lifecycle) with a pool (resource lifecycle).
 *
 * @remarks
 * - `count` — number of pending tasks
 * - `active` — number of tasks currently executing
 * - `completed` — total successful completions
 * - `failed` — total failures
 * - `paused` — true when paused
 * - `stopped` — true when stopped
 * - `aborted` — true when aborted
 * - `bailed` — true when bail triggered
 * - `idle` — true when pending, active, and scheduled are all zero
 * - `destroyed` — true after destroy or shutdown
 * - `stats` — combined queue and pool metrics snapshot
 * - `enqueue` — add a context to the end of the pending queue
 * - `prepend` — add a context to the front of the pending queue
 * - `contexts` — return pending contexts without consuming them
 * - `entry` — look up a tracked entry by ID
 * - `entries` — return all tracked entries
 * - `configure` — update queue-level options at runtime
 * - `start` — begin processing tasks
 * - `stop` — stop processing and clear pending tasks
 * - `pause` — suspend processing
 * - `resume` — continue after pause
 * - `abort` — cancel with signal propagation
 * - `clear` — remove pending tasks without stopping
 * - `execute` — reusable barrier resolving when idle
 * - `sync` — save tracked entries to configured store
 * - `restore` — load entries from configured store
 * - `shutdown` — coordinated teardown: drain queue, drain pool, destroy pool
 * - `destroy` — immediate teardown: abort queue, destroy pool
 */
export interface WorkerInterface<TContext, TResult> {
	readonly count: number
	readonly active: number
	readonly completed: number
	readonly failed: number
	readonly paused: boolean
	readonly stopped: boolean
	readonly aborted: boolean
	readonly bailed: boolean
	readonly idle: boolean
	readonly destroyed: boolean
	readonly stats: WorkerStats

	enqueue(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>
	prepend(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>
	contexts(): readonly TContext[]
	entry(id: string): QueueEntryState<TContext> | undefined
	entries(): readonly QueueEntryState<TContext>[]
	configure(options: QueueConfiguration): void

	start(): void
	stop(): void
	pause(): void
	resume(): void
	abort(): void
	clear(): void

	execute(): Promise<void>
	sync(): Promise<void>
	restore(): Promise<void>
	shutdown(): Promise<void>
	destroy(): Promise<void>
}

// === NodeWorker

/**
 * Execution context provided to a worker thread handler.
 * Wraps workerData, per-request cancellation, progress reporting,
 * and side-channel messaging.
 *
 * @remarks
 * - `id` — dispatch ID correlating request to response
 * - `context` — the dispatched payload
 * - `data` — workerData passed via NodeWorkerOptions
 * - `signal` — AbortSignal scoped to this dispatch
 * - `report` — emit a structured progress message to the main thread
 * - `send` — emit an arbitrary side-channel message to the main thread
 */
export interface NodeWorkerExecution<TContext, TData = unknown> {
	readonly id: string
	readonly context: TContext
	readonly data: TData
	readonly signal: AbortSignal
	report(progress: NodeWorkerProgress): void
	send(message: unknown): void
}

/**
 * Structured progress payload emitted from a worker thread.
 *
 * @remarks
 * - `percent` — optional 0–100 completion indicator
 * - `stage` — optional named stage label
 * - `detail` — optional freeform detail
 */
export interface NodeWorkerProgress {
	readonly percent?: number
	readonly stage?: string
	readonly detail?: unknown
}

/**
 * Function type for processing a context in a worker thread.
 * Receives an execution object for access to workerData,
 * abort signal, progress reporting, and side-channel messaging.
 */
export type NodeWorkerFunction<TContext, TResult, TData = unknown> = (
	context: TContext,
	execution: NodeWorkerExecution<TContext, TData>,
) => Promise<TResult> | TResult

/**
 * Message sent from the main thread to a worker thread.
 */
export interface NodeWorkerRequest<TContext> {
	readonly id: string
	readonly context: TContext
}

/**
 * Abort control message sent from the main thread to cancel an active dispatch.
 */
export interface NodeWorkerAbortRequest {
	readonly id: string
	readonly type: 'abort'
}

/**
 * Successful response from a worker thread.
 */
export interface NodeWorkerSuccess<TResult> {
	readonly id: string
	readonly type: 'result'
	readonly success: true
	readonly value: TResult
}

/**
 * Failed response from a worker thread.
 */
export interface NodeWorkerFailure {
	readonly id: string
	readonly type: 'result'
	readonly success: false
	readonly error: string
}

/**
 * Progress message from a worker thread.
 */
export interface NodeWorkerProgressMessage {
	readonly id: string
	readonly type: 'progress'
	readonly progress: NodeWorkerProgress
}

/**
 * Side-channel message from a worker thread.
 */
export interface NodeWorkerChannelMessage {
	readonly id: string
	readonly type: 'message'
	readonly value: unknown
}

/**
 * Discriminated outbound message from a worker thread.
 */
export type NodeWorkerOutbound<TResult> =
	| NodeWorkerSuccess<TResult>
	| NodeWorkerFailure
	| NodeWorkerProgressMessage
	| NodeWorkerChannelMessage

/**
 * Discriminated response (result-only subset of outbound messages).
 */
export type NodeWorkerResponse<TResult> = NodeWorkerSuccess<TResult> | NodeWorkerFailure

/**
 * Configuration for creating a NodeWorker.
 *
 * @remarks
 * - `script` — path or URL to the worker thread script
 * - `workerData` — optional data passed to each thread via workerData
 * - `concurrency` — max parallel thread executions (default 1)
 * - `bail` — abort all pending on first failure (default false)
 * - `signal` — external AbortSignal for cancellation
 * - `timeout` — ms before a single dispatch is aborted (default 0 = none)
 * - `retries` — extra dispatch attempts after the first failure (default 0)
 * - `min` — minimum pre-created threads (default 0)
 * - `max` — upper bound on total threads (default concurrency)
 * - `store` — optional persistence store for sync/restore
 * - `argv` — Node.js CLI flags forwarded to each thread (e.g. `['--expose-gc']`)
 */
export interface NodeWorkerOptions<TContext> {
	readonly script: string | URL
	readonly data?: unknown
	readonly concurrency?: number
	readonly bail?: boolean
	readonly signal?: AbortSignal
	readonly timeout?: number
	readonly retries?: number
	readonly min?: number
	readonly max?: number
	readonly store?: QueueStoreInterface<TContext>
	readonly argv?: readonly string[]
}

/**
 * Read-only snapshot of node worker thread pool metrics.
 */
export interface NodeWorkerStats {
	readonly count: number
	readonly active: number
	readonly completed: number
	readonly failed: number
	readonly threads: number
	readonly available: number
	readonly borrowed: number
}

/**
 * Public interface for a worker-thread-backed task processor.
 * Internally composes a Worker whose pooled resource is a thread.
 *
 * @remarks
 * - `count` — number of pending tasks
 * - `active` — number of tasks currently executing in threads
 * - `completed` — total successful completions
 * - `failed` — total failures
 * - `paused` — true when paused
 * - `stopped` — true when stopped
 * - `aborted` — true when aborted
 * - `bailed` — true when bail triggered
 * - `idle` — true when pending, active, and scheduled are all zero
 * - `destroyed` — true after destroy or shutdown
 * - `stats` — combined queue and thread pool metrics snapshot
 * - `enqueue` — dispatch a context to be processed by a thread
 * - `prepend` — dispatch a context at the front of the queue
 * - `contexts` — return pending contexts without consuming them
 * - `entry` — look up a tracked entry by ID
 * - `entries` — return all tracked entries
 * - `start` — begin dispatching to threads
 * - `stop` — stop dispatching and clear pending tasks
 * - `pause` — suspend dispatching
 * - `resume` — continue after pause
 * - `abort` — cancel with signal propagation
 * - `clear` — remove pending tasks without stopping
 * - `execute` — reusable barrier resolving when idle
 * - `sync` — save tracked entries to configured store
 * - `restore` — load entries from configured store
 * - `shutdown` — coordinated teardown: drain queue, drain threads, terminate
 * - `destroy` — immediate teardown: abort queue, terminate threads
 */
export interface NodeWorkerInterface<TContext, TResult> {
	readonly count: number
	readonly active: number
	readonly completed: number
	readonly failed: number
	readonly paused: boolean
	readonly stopped: boolean
	readonly aborted: boolean
	readonly bailed: boolean
	readonly idle: boolean
	readonly destroyed: boolean
	readonly stats: NodeWorkerStats

	enqueue(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>
	prepend(context: TContext, options?: QueueEntryOptions): Promise<Result<TResult>>
	contexts(): readonly TContext[]
	entry(id: string): QueueEntryState<TContext> | undefined
	entries(): readonly QueueEntryState<TContext>[]

	start(): void
	stop(): void
	pause(): void
	resume(): void
	abort(): void
	clear(): void

	execute(): Promise<void>
	sync(): Promise<void>
	restore(): Promise<void>
	shutdown(): Promise<void>
	destroy(): Promise<void>
}

// === MsgReader

/**
 * Lifecycle type of a directory entry in a CFB compound file.
 */
export type MsgDirectoryEntryType = 'root' | 'directory' | 'document' | 'unallocated'

/**
 * MAPI property data type tag.
 */
export type MsgFieldType = 'string' | 'unicode' | 'binary' | 'time' | 'integer' | 'boolean'

/**
 * Recipient role in a message.
 */
export type MsgRecipientRole = 'to' | 'cc' | 'bcc'

/**
 * CFB directory entry describing a storage or stream in the compound file.
 */
export interface MsgDirectoryEntry {
	readonly type: number
	readonly name: string
	readonly previousProperty: number
	readonly nextProperty: number
	readonly childProperty: number
	readonly startBlock: number
	readonly sizeBlock: number
	children?: number[]
}

/**
 * Internal mutable accumulator used during MSG field extraction.
 * Properties are assigned dynamically via index signature and
 * cast to the readonly MsgFieldData at the public boundary.
 */
export interface MsgMutableFieldData {
	dataType: 'msg' | 'attachment' | 'recipient' | null
	error?: string
	attachments?: MsgMutableFieldData[]
	recipients?: MsgMutableFieldData[]
	innerMsgContent?: true
	innerMsgContentFields?: MsgMutableFieldData
	dataId?: number
	contentLength?: number
	folderId?: number
	[key: string]: unknown
}

/**
 * Resolved named property entry from the __nameid_version1.0 storage.
 */
export interface MsgNameIdEntry {
	readonly useName: boolean
	readonly name?: string
	readonly propertySet?: string
	readonly propertyLid?: number
}

/**
 * CFB entry descriptor for the MSG burner (CFB binary writer).
 * Entries form a flat list starting with the root storage at index 0.
 */
export interface MsgBurnerEntry {
	readonly name: string
	readonly type: number
	readonly length: number
	readonly binaryProvider?: () => Uint8Array
	children?: number[]
}

/**
 * Internal lite entry with tree metadata used during CFB burn.
 * Tracks red-black coloring and sector allocation alongside
 * the source MsgBurnerEntry.
 */
export interface MsgBurnerLiteEntry {
	readonly entry: MsgBurnerEntry
	left: number
	right: number
	child: number
	firstSector: number
	readonly mini: boolean
	red: boolean
}

/**
 * Public interface for the CFB binary writer.
 * Reconstitutes a flat list of entry descriptors into a valid
 * Compound Binary File (CFB) byte stream.
 *
 * @remarks
 * - `burn` — write the entries to a CFB binary
 */
export interface MsgBurnerInterface {
	burn(entries: readonly MsgBurnerEntry[]): Uint8Array
}

/**
 * Parsed field data extracted from an MSG file.
 * Represents the root message, an attachment, or a recipient.
 *
 * @remarks
 * - `dataType` — discriminator: 'msg', 'attachment', 'recipient', or null on error
 * - `error` — set when parsing fails
 * - `subject` — message subject
 * - `senderName` — display name of the sender
 * - `senderEmail` — email address of the sender
 * - `body` — plain text body
 * - `headers` — transport message headers
 * - `bodyHtml` — HTML body (string)
 * - `html` — HTML body (binary)
 * - `compressedRtf` — compressed RTF body (binary)
 * - `attachments` — child attachment field data
 * - `recipients` — child recipient field data
 * - `innerMsgContent` — true if the attachment is an embedded .msg
 * - `innerMsgContentFields` — parsed fields of the embedded .msg
 * - `dataId` — internal CFBF entry index (for attachment binary access)
 * - `contentLength` — attachment binary length
 * - `folderId` — internal CFBF storage index (for embedded msg)
 * - `recipientRole` — recipient type: 'to', 'cc', or 'bcc'
 */
export interface MsgFieldData {
	readonly dataType: 'msg' | 'attachment' | 'recipient' | null
	readonly error?: string
	// email properties
	readonly subject?: string
	readonly senderName?: string
	readonly senderEmail?: string
	readonly senderAddressType?: string
	readonly senderSmtpAddress?: string
	readonly sentRepresentingSmtpAddress?: string
	readonly body?: string
	readonly headers?: string
	readonly bodyHtml?: string
	readonly html?: Uint8Array
	readonly compressedRtf?: Uint8Array
	readonly messageClass?: string
	readonly messageFlags?: number
	readonly messageId?: string
	readonly internetCodepage?: number
	readonly messageCodepage?: number
	readonly messageLocaleId?: number
	readonly clientSubmitTime?: string
	readonly messageDeliveryTime?: string
	readonly creationTime?: string
	readonly lastModificationTime?: string
	readonly lastModifierName?: string
	readonly creatorSmtpAddress?: string
	readonly lastModifierSmtpAddress?: string
	readonly preview?: string
	readonly conversationTopic?: string
	readonly normalizedSubject?: string
	// recipient properties
	readonly name?: string
	readonly email?: string
	readonly addressType?: string
	readonly smtpAddress?: string
	readonly recipientRole?: MsgRecipientRole
	// attachment properties
	readonly extension?: string
	readonly fileNameShort?: string
	readonly fileName?: string
	readonly contentId?: string
	readonly attachmentHidden?: boolean
	readonly mimeType?: string
	readonly contentLength?: number
	readonly dataId?: number
	readonly folderId?: number
	readonly innerMsgContent?: true
	readonly innerMsgContentFields?: MsgFieldData
	readonly attachments?: readonly MsgFieldData[]
	readonly recipients?: readonly MsgFieldData[]
	// contact properties
	readonly departmentName?: string
	readonly middleName?: string
	readonly generation?: string
	readonly surname?: string
	readonly givenName?: string
	readonly companyName?: string
	readonly jobTitle?: string
	readonly location?: string
	readonly postalAddress?: string
	readonly streetAddress?: string
	readonly postalCode?: string
	readonly country?: string
	readonly stateOrProvince?: string
	readonly homePhone?: string
	readonly mobilePhone?: string
	readonly businessPhone?: string
	readonly businessFax?: string
	readonly businessHomePage?: string
	readonly namePrefix?: string
	readonly homeAddressCity?: string
	// appointment / calendar properties
	readonly appointmentStart?: string
	readonly appointmentEnd?: string
	readonly clipStart?: string
	readonly clipEnd?: string
	readonly timeZoneDescription?: string
	readonly appointmentLocation?: string
	readonly appointmentOldLocation?: string
	readonly globalAppointmentId?: string
	// PidLid — common
	readonly votingResponse?: string
	readonly internetAccountName?: string
	// PidLid — address
	readonly yomiFirstName?: string
	readonly yomiLastName?: string
	readonly yomiCompanyName?: string
	readonly primaryEmailAddress?: string
	readonly primaryEmailDisplayName?: string
	readonly primaryEmailOriginalDisplayName?: string
	readonly fileUnder?: string
	readonly workAddressCity?: string
	readonly workAddressStreet?: string
	readonly workAddressState?: string
	readonly workAddressPostalCode?: string
	readonly workAddressCountry?: string
	readonly workAddressCountryCode?: string
	readonly addressCountryCode?: string
	readonly contactWebPage?: string
	readonly workAddress?: string
	readonly instantMessagingAddress?: string
	readonly fax1AddressType?: string
	readonly fax1EmailAddress?: string
	readonly fax1OriginalDisplayName?: string
	readonly fax2AddressType?: string
	readonly fax2EmailAddress?: string
	readonly fax2OriginalDisplayName?: string
	readonly fax3AddressType?: string
	readonly fax3EmailAddress?: string
	readonly fax3OriginalDisplayName?: string
}

/**
 * Extracted attachment content from an MSG file.
 *
 * @remarks
 * - `fileName` — the attachment file name
 * - `content` — the raw binary content
 */
export interface MsgAttachment {
	readonly fileName: string
	readonly content: Uint8Array
}

/**
 * Configuration for creating an MsgReader.
 *
 * @remarks
 * - `encoding` — encoding label for non-Unicode (PT_STRING8) strings (default 'windows-1252')
 */
export interface MsgReaderOptions {
	readonly encoding?: string
}

/**
 * Public interface for parsing Microsoft Outlook .msg files.
 *
 * @remarks
 * - `parse` — parse the MSG file and return extracted field data
 * - `attachment` — read attachment binary content by index
 * - `burn` — rebuild the parsed MSG as a standalone CFB/.msg binary
 */
export interface MsgReaderInterface {
	parse(): MsgFieldData
	attachment(index: number): MsgAttachment
	burn(): Uint8Array
}

// === EmailParser

/**
 * Supported email file format.
 */
export type EmailFormat = 'eml' | 'msg'

/**
 * Parsed MIME header with value and parameter map.
 *
 * @remarks
 * - `value` — primary header value (before first semicolon)
 * - `params` — key-value parameter map (e.g. charset, boundary)
 */
export interface MimeHeader {
	readonly value: string
	readonly params: ReadonlyMap<string, string>
}

/**
 * Recursive MIME part tree node.
 *
 * @remarks
 * - `headers` — parsed header map keyed by lowercase name
 * - `body` — raw body text (empty for multipart containers)
 * - `parts` — child parts for multipart types
 */
export interface MimePart {
	readonly headers: ReadonlyMap<string, MimeHeader>
	readonly body: string
	readonly parts: readonly MimePart[]
}

/**
 * Extracted attachment from an email message.
 *
 * @remarks
 * - `name` — attachment file name
 * - `mimeType` — MIME content type
 * - `size` — byte length
 * - `bytes` — raw binary content
 */
export interface EmailAttachment {
	readonly name: string
	readonly mimeType: string
	readonly size: number
	readonly bytes: Uint8Array
}

/**
 * Structured email message extracted from a parsed file.
 *
 * @remarks
 * - `from` — sender address string
 * - `to` — recipient addresses
 * - `cc` — carbon copy addresses
 * - `subject` — decoded subject line
 * - `date` — delivery date or undefined when absent/malformed
 * - `text` — plain-text body (includes quoted reply chain)
 * - `html` — HTML body (includes quoted reply chain)
 * - `attachments` — decoded file attachments
 */
export interface EmailMessage {
	readonly from: string
	readonly to: readonly string[]
	readonly cc: readonly string[]
	readonly subject: string
	readonly date: Date | undefined
	readonly text: string
	readonly html: string
	readonly attachments: readonly EmailAttachment[]
}

/**
 * Parsed email chain from a single file.
 *
 * @remarks
 * - `format` — detected file format ('eml' or 'msg')
 * - `messages` — extracted messages (always length 1 for single-file formats)
 */
export interface EmailChain {
	readonly format: EmailFormat
	readonly messages: readonly EmailMessage[]
}

/**
 * Configuration for creating an EmailParser.
 */
export interface EmailParserOptions {
	readonly charset?: string
}

/**
 * Public interface for parsing email files into structured chains.
 *
 * @remarks
 * - `parse` — parse a File into an EmailChain result
 * - `options` — current parser configuration
 */
export interface EmailParserInterface {
	parse(file: File): Promise<Result<EmailChain>>
	readonly options: EmailParserOptions
}

// === Browser

/**
 * Supported browser engine.
 */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit'

/**
 * How the browser connection was established.
 */
export type BrowserConnection = 'cdp' | 'launch' | 'persistent'

/**
 * Lifecycle status of a browser wrapper.
 */
export type BrowserStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * Page load condition for navigation.
 */
export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'

/**
 * Viewport dimensions for a browser page.
 */
export interface BrowserViewport {
	readonly width: number
	readonly height: number
}

/**
 * Result of passive browser discovery.
 *
 * @remarks
 * Returned by `discover()` to report whether an existing browser
 * is reachable via CDP without actually connecting to it.
 *
 * - `found` — true when a browser responded on the CDP endpoint
 * - `endpoint` — the CDP WebSocket URL when found
 * - `browser` — browser product name reported by the endpoint
 * - `connection` — the connection mode that would be used
 */
export interface BrowserDiscoveryResult {
	readonly found: boolean
	readonly endpoint: string | undefined
	readonly browser: string | undefined
	readonly connection: BrowserConnection | undefined
}

/**
 * CDP (Chrome DevTools Protocol) connection configuration.
 *
 * @remarks
 * - `port` — port number to probe for an existing CDP endpoint (default `9222`)
 * - `endpoint` — explicit CDP WebSocket URL; when provided, skips discovery
 */
export interface BrowserCdpOptions {
	readonly port?: number
	readonly endpoint?: string
}

/**
 * Configuration for creating a Browser.
 *
 * @remarks
 * - `engine` — browser engine to use (default `'chromium'`)
 * - `headless` — launch in headless mode (default `true`; ignored for CDP connections)
 * - `executable` — absolute path to a browser executable; when provided,
 *   skips Playwright's bundled browser and uses this binary directly
 * - `profile` — persistent browser profile directory for `persistent` connections
 * - `cdp` — CDP connection options (port and endpoint)
 * - `timeout` — connection and navigation timeout in milliseconds (default `30_000`)
 * - `viewport` — default viewport dimensions for new pages
 * - `signal` — external AbortSignal for cancelling the connection attempt
 * - `args` — additional command-line flags passed to the browser process
 */
export interface BrowserOptions {
	readonly engine?: BrowserEngine
	readonly headless?: boolean
	readonly executable?: string
	readonly profile?: string
	readonly cdp?: BrowserCdpOptions
	readonly timeout?: number
	readonly viewport?: BrowserViewport
	readonly signal?: AbortSignal
	readonly args?: readonly string[]
}

/**
 * Options for creating a browser page.
 *
 * @remarks
 * - `url` — navigate to this URL immediately after creation
 * - `viewport` — override the browser-level default viewport
 * - `timeout` — navigation timeout for the initial URL
 */
export interface BrowserPageOptions {
	readonly url?: string
	readonly viewport?: BrowserViewport
	readonly timeout?: number
}

/**
 * Options for page navigation.
 *
 * @remarks
 * - `condition` — page load condition to wait for (default `'load'`)
 * - `timeout` — navigation timeout in milliseconds
 */
export interface BrowserNavigationOptions {
	readonly condition?: BrowserWaitUntil
	readonly timeout?: number
}

/**
 * Options for element interaction (click, fill, select, wait).
 *
 * @remarks
 * - `timeout` — maximum time to wait for the selector in milliseconds
 */
export interface BrowserActionOptions {
	readonly timeout?: number
}

/**
 * Options for taking a page screenshot.
 *
 * @remarks
 * - `path` — file path to save the screenshot to disk
 * - `full` — capture the full scrollable page (default `false`)
 * - `type` — image format (default `'png'`)
 * - `quality` — JPEG quality 0–100 (ignored for PNG)
 */
export interface BrowserScreenshotOptions {
	readonly path?: string
	readonly full?: boolean
	readonly type?: 'png' | 'jpeg'
	readonly quality?: number
}

/**
 * Result of page content extraction.
 *
 * @remarks
 * - `url` — current page URL after navigation
 * - `title` — document title
 * - `html` — full HTML source
 * - `text` — visible text content (no markup)
 */
export interface BrowserContentResult {
	readonly url: string
	readonly title: string
	readonly html: string
	readonly text: string
}

/**
 * Result of a page screenshot.
 *
 * @remarks
 * - `bytes` — raw image bytes
 * - `path` — file path if saved to disk, otherwise undefined
 */
export interface BrowserScreenshotResult {
	readonly bytes: Uint8Array
	readonly path: string | undefined
}

/**
 * Abstraction over a single browser page or frame.
 *
 * @remarks
 * Wraps a Playwright Page or Frame with a simplified interface suitable
 * for programmatic use and agent tool calls.
 *
 * - `url` — current URL
 * - `closed` — true after `close()` is called
 * - `title` — resolve the document title
 * - `navigate` — go to a URL and wait for the specified load condition
 * - `content` — extract page URL, title, HTML, and visible text
 * - `screenshot` — capture a PNG or JPEG image of the page
 * - `click` — click an element matching the selector
 * - `fill` — type text into an input element
 * - `select` — choose option(s) in a `<select>` element
 * - `evaluate` — execute a JavaScript expression in the page context
 * - `wait` — wait for an element matching the selector to appear
 * - `frame` — look up a child frame by name
 * - `frames` — list all child frames
 * - `close` — close the page (no-op on frames)
 */
export interface BrowserPageInterface {
	readonly url: string
	readonly closed: boolean
	title(): Promise<string>
	navigate(url: string, options?: BrowserNavigationOptions): Promise<void>
	content(): Promise<BrowserContentResult>
	screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult>
	click(selector: string, options?: BrowserActionOptions): Promise<void>
	fill(selector: string, value: string, options?: BrowserActionOptions): Promise<void>
	select(selector: string, values: readonly string[], options?: BrowserActionOptions): Promise<void>
	evaluate(expression: string): Promise<unknown>
	wait(selector: string, options?: BrowserActionOptions): Promise<void>
	frame(name: string): BrowserPageInterface | undefined
	frames(): readonly BrowserPageInterface[]
	close(): Promise<void>
}

/**
 * Isolated browser session wrapping a Playwright BrowserContext.
 *
 * @remarks
 * Each context has independent cookies, storage, and cache — equivalent
 * to an incognito window. Pages created within a context share its session.
 *
 * Follows the manager accessor pattern:
 * - `page(index?)` → one page by index or the first page
 * - `pages()` → all pages in creation order
 *
 * - `create` — open a new page in this context
 * - `close` — close the context and all its pages
 */
export interface BrowserContextInterface {
	page(index?: number): BrowserPageInterface | undefined
	pages(): readonly BrowserPageInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	close(): Promise<void>
}

/**
 * Browser wrapper with discovery, connection management, and lifecycle control.
 *
 * @remarks
 * Encapsulates the full Playwright browser lifecycle behind a clean interface:
 *
 * **Connection strategy** (executed by `connect()`):
 * 1. If `cdp.endpoint` is set, connect directly via CDP
 * 2. Probe `localhost:{cdp.port}` for an existing browser (passive discovery)
 * 3. If found, connect over CDP (preserves existing browser session)
 * 4. Otherwise, launch a new browser process via Playwright
 *
 * This lets agents and automation scripts reuse an already-running browser
 * (e.g. Edge with a logged-in session) before falling back to a fresh launch.
 *
 * **Lifecycle:**
 * - `discover` — passive CDP probe, no side effects
 * - `connect` — establish connection using the strategy above
 * - `disconnect` — detach from the browser WITHOUT closing it (CDP only)
 * - `destroy` — close the browser process and release all resources
 *
 * **Page management:**
 * - `context(index?)` → one context or first
 * - `contexts()` → all contexts
 * - `create(options?)` → shortcut to open a page in the default context
 */
export interface BrowserInterface {
	readonly engine: BrowserEngine
	readonly status: BrowserStatus
	readonly connection: BrowserConnection | undefined
	readonly connected: boolean
	discover(): Promise<BrowserDiscoveryResult>
	connect(): Promise<void>
	disconnect(): void
	context(index?: number): BrowserContextInterface | undefined
	contexts(): readonly BrowserContextInterface[]
	create(options?: BrowserPageOptions): Promise<BrowserPageInterface>
	destroy(): Promise<void>
}

// === Browser Structural Types (Playwright boundary)

/**
 * Structural interface matching the subset of Playwright Page/Frame methods
 * used by the browser wrapper. Used for duck-type validation at the dynamic
 * import boundary — avoids `as` casts while keeping Playwright optional.
 */
export interface PlaywrightPageLike {
	url(): string
	title(): Promise<string>
	goto(url: string, options?: Record<string, unknown>): Promise<unknown>
	content(): Promise<string>
	evaluate(expression: string): Promise<unknown>
	click(selector: string, options?: Record<string, unknown>): Promise<void>
	fill(selector: string, value: string, options?: Record<string, unknown>): Promise<void>
	selectOption(
		selector: string,
		values: readonly string[],
		options?: Record<string, unknown>,
	): Promise<readonly string[]>
	waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>
	screenshot?(options?: Record<string, unknown>): Promise<Buffer>
	frame?(name: string): PlaywrightPageLike | null
	childFrames?(): readonly PlaywrightPageLike[]
	close?(): Promise<void>
	isClosed?(): boolean
	isDetached?(): boolean
}

/**
 * Structural interface matching the subset of Playwright BrowserContext methods
 * used by the browser wrapper.
 */
export interface PlaywrightContextLike {
	newPage(): Promise<PlaywrightPageLike>
	pages(): PlaywrightPageLike[]
	close(): Promise<void>
}

/**
 * Structural interface matching the subset of Playwright Browser methods
 * used by the browser wrapper.
 */
export interface PlaywrightBrowserLike {
	newContext(options?: Record<string, unknown>): Promise<PlaywrightContextLike>
	contexts(): PlaywrightContextLike[]
	close(): Promise<void>
	isConnected(): boolean
}

/**
 * Structural interface matching a Playwright engine launcher
 * (e.g. `chromium`, `firefox`, `webkit`).
 */
export interface PlaywrightEngineLike {
	connectOverCDP(
		endpointURL: string,
		options?: Record<string, unknown>,
	): Promise<PlaywrightBrowserLike>
	launch(options?: Record<string, unknown>): Promise<PlaywrightBrowserLike>
	launchPersistentContext(
		userDataDir: string,
		options?: Record<string, unknown>,
	): Promise<PlaywrightContextLike>
}

/**
 * Convenience factory options for creating a browser-backed worker.
 *
 * @remarks
 * - `handler` — async function receiving the task context and a connected BrowserInterface
 * - `browser` — BrowserOptions forwarded to createBrowser inside the pool
 * - `concurrency` — max parallel tasks (default 1)
 * - `bail` — abort all pending on first failure (default false)
 * - `signal` — external AbortSignal for cancellation
 * - `timeout` — ms before a single handler invocation is aborted (default 0 = none)
 * - `retries` — extra handler attempts after the first failure (default 0)
 * - `min` — minimum browser instances in the pool
 * - `max` — maximum browser instances in the pool
 * - `store` — optional persistence store for sync/restore
 */
export interface BrowserWorkerOptions<TContext, TResult> {
	readonly handler: (context: TContext, browser: BrowserInterface) => Promise<TResult>
	readonly browser?: BrowserOptions
	readonly concurrency?: number
	readonly bail?: boolean
	readonly signal?: AbortSignal
	readonly timeout?: number
	readonly retries?: number
	readonly min?: number
	readonly max?: number
	readonly store?: QueueStoreInterface<TContext>
}
