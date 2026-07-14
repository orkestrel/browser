import { Signal } from './signals/Signal.js'
import { Compute } from './computes/Compute.js'
import { Effect } from './effects/Effect.js'
import { Watch } from './watches/Watch.js'
import { Scope } from './scopes/Scope.js'
import { Resource } from './resources/Resource.js'
import { Channel } from './channels/Channel.js'
import { Stream } from './streams/Stream.js'
import { Scheduler } from './schedulers/Scheduler.js'
import { Queue } from './queues/Queue.js'
import { Pool } from './pools/Pool.js'
import { Worker } from './workers/Worker.js'
import { NodeWorker } from './workers/NodeWorker.js'
import { MemoryQueueStore } from './stores/MemoryQueueStore.js'
import { JsonQueueStore } from './stores/JsonQueueStore.js'
import { MsgReader } from './readers/MsgReader.js'
import { MsgBurner } from './readers/MsgBurner.js'
import { EmailParser } from './parsers/EmailParser.js'
import { Batch } from './batches/Batch.js'
import { Browser } from './browsers/Browser.js'
import type {
	BatchInterface,
	SignalInterface,
	SignalOptions,
	ComputeInterface,
	ComputeOptions,
	EffectInterface,
	WatchSource,
	WatchHandler,
	WatchOptions,
	WatchInterface,
	ScopeInterface,
	ResourceOptions,
	ResourceInterface,
	ChannelInterface,
	StreamSource,
	StreamInterface,
	SchedulerOptions,
	SchedulerInterface,
	QueueInterface,
	QueueOptions,
	PoolInterface,
	PoolOptions,
	WorkerInterface,
	WorkerOptions,
	NodeWorkerInterface,
	NodeWorkerOptions,
	QueueStoreInterface,
	MsgReaderInterface,
	MsgReaderOptions,
	MsgBurnerInterface,
	EmailParserInterface,
	EmailParserOptions,
	BrowserInterface,
	BrowserOptions,
	BrowserWorkerOptions,
} from './types.js'

// === Batch

/**
 * Create a reactive batch coordinator.
 *
 * @returns A BatchInterface instance
 *
 * @example
 * ```ts
 * const batcher = createBatch()
 * batcher.run(() => {
 *     count.set(1)
 *     status.set('ready')
 * })
 * ```
 */
export function createBatch(): BatchInterface {
	return new Batch()
}

// === Signal

/**
 * Create a writable reactive signal.
 *
 * @param value - Initial value
 * @param options - Optional configuration
 * @returns A SignalInterface instance
 *
 * @example
 * ```ts
 * const count = createSignal(0)
 * count.set(1)
 * console.log(count.get()) // 1
 * ```
 */
export function createSignal<T>(value: T, options?: SignalOptions<T>): SignalInterface<T> {
	return new Signal(value, options)
}

// === Compute

/**
 * Create a cached derived reactive value.
 *
 * @param compute - Function deriving the value from reactive sources
 * @param options - Optional configuration
 * @returns A ComputeInterface instance
 *
 * @example
 * ```ts
 * const count = createSignal(2)
 * const double = createCompute(() => count.get() * 2)
 * console.log(double.get()) // 4
 * ```
 */
export function createCompute<T>(
	compute: () => T,
	options?: ComputeOptions<T>,
): ComputeInterface<T> {
	return new Compute(compute, options)
}

// === Effect

/**
 * Create an auto-tracked reactive side effect.
 *
 * @param fn - Effect function; may return a cleanup callback
 * @returns An EffectInterface instance
 *
 * @example
 * ```ts
 * const count = createSignal(0)
 * const effect = createEffect(() => {
 *     console.log('count:', count.get())
 * })
 * count.set(1) // logs "count: 1"
 * effect.destroy()
 * ```
 */
export function createEffect(fn: () => void | (() => void)): EffectInterface {
	return new Effect(fn)
}

// === Watch

/**
 * Create an explicit source watcher.
 *
 * @param source - Signal, Compute, or getter function to watch
 * @param callback - Invoked with (newValue, oldValue) when source changes
 * @param options - Optional configuration
 * @returns A WatchInterface instance
 *
 * @example
 * ```ts
 * const count = createSignal(0)
 * createWatch(() => count.get(), (next, prev) => {
 *     console.log(`${prev} -> ${next}`)
 * })
 * count.set(1) // logs "0 -> 1"
 * ```
 */
export function createWatch<T>(
	source: WatchSource<T>,
	callback: WatchHandler<T>,
	options?: WatchOptions<T>,
): WatchInterface {
	return new Watch(source, callback, options)
}

// === Scope

/**
 * Create an ownership container for resource cleanup.
 *
 * @returns A ScopeInterface instance
 *
 * @example
 * ```ts
 * const scope = createScope()
 * const effect = createEffect(() => { ... })
 * scope.add(effect) // register destroyable
 * scope.destroy()   // tears down everything
 * ```
 */
export function createScope(): ScopeInterface {
	return new Scope()
}

// === Resource

/**
 * Create an async state wrapper with reactive integration.
 *
 * @param options - Resource configuration
 * @returns A ResourceInterface instance
 *
 * @example
 * ```ts
 * const users = createResource({
 *     fetcher: async (signal) => fetch('/api/users', { signal }).then(r => r.json()),
 * })
 * await users.load()
 * console.log(users.value)
 * ```
 */
export function createResource<T>(options: ResourceOptions<T>): ResourceInterface<T> {
	return new Resource(options)
}

// === Channel

/**
 * Create a manual pub/sub event transport.
 *
 * @returns A ChannelInterface instance
 *
 * @example
 * ```ts
 * const events = createChannel<string>()
 * events.subscribe((msg) => console.log(msg))
 * events.send('hello') // logs "hello"
 * ```
 */
export function createChannel<T>(): ChannelInterface<T> {
	return new Channel<T>()
}

// === Stream

/**
 * Create a transformable event stream from a source function.
 *
 * @param source - Setup function receiving an emit callback
 * @returns A StreamInterface instance
 *
 * @example
 * ```ts
 * const ticks = createStream<number>((emit) => {
 *     let i = 0
 *     const id = setInterval(() => emit(i++), 100)
 *     return () => clearInterval(id)
 * })
 * const even = ticks.filter((n) => n % 2 === 0)
 * ```
 */
export function createStream<T>(source: StreamSource<T>): StreamInterface<T> {
	return new Stream(source)
}

// === Scheduler

/**
 * Create a job execution scheduler.
 *
 * @param options - Optional scheduler configuration
 * @returns A SchedulerInterface instance
 *
 * @example
 * ```ts
 * const scheduler = createScheduler()
 * scheduler.append(async () => { ... })
 * scheduler.start()
 * ```
 */
export function createScheduler(options?: SchedulerOptions): SchedulerInterface {
	return new Scheduler(options)
}

// === Queue

/**
 * Create a new task queue.
 *
 * @param options - Queue configuration
 * @returns A QueueInterface instance
 *
 * @example
 * ```ts
 * const queue = createQueue({ handler: async (n) => n * 2 })
 * queue.start()
 * const result = await queue.enqueue(5)
 * ```
 */
export function createQueue<TContext, TResult>(
	options: QueueOptions<TContext, TResult>,
): QueueInterface<TContext, TResult> {
	return new Queue(options)
}

// === Pool

/**
 * Create a new resource pool.
 *
 * @param options - Pool configuration
 * @returns A PoolInterface instance
 *
 * @example
 * ```ts
 * const pool = createPool({
 *     create: async () => new Connection(),
 *     destroy: async (conn) => conn.close(),
 *     min: 2,
 *     max: 10,
 * })
 * await pool.ready()
 * const token = await pool.acquire()
 * token.release()
 * ```
 */
export function createPool<T>(options: PoolOptions<T>): PoolInterface<T> {
	return new Pool(options)
}

// === Worker

/**
 * Create a resource-backed task worker.
 *
 * @param options - Worker configuration
 * @returns A WorkerInterface instance
 *
 * @example
 * ```ts
 * const worker = createWorker({
 *     handler: async (context, conn) => conn.query(context),
 *     pool: {
 *         create: async () => new Connection(),
 *         destroy: async (conn) => conn.close(),
 *         min: 2,
 *         max: 10,
 *     },
 *     concurrency: 4,
 * })
 * worker.start()
 * const result = await worker.enqueue('SELECT 1')
 * ```
 */
export function createWorker<TContext, TResource, TResult>(
	options: WorkerOptions<TContext, TResource, TResult>,
): WorkerInterface<TContext, TResult> {
	return new Worker(options)
}

// === NodeWorker

/**
 * Create a worker-thread-backed task processor.
 *
 * @param options - NodeWorker configuration
 * @returns A NodeWorkerInterface instance
 *
 * @example
 * ```ts
 * const pool = createNodeWorker({
 *     script: './worker-script.js',
 *     concurrency: 4,
 * })
 * pool.start()
 * const result = await pool.enqueue({ x: 10 })
 * ```
 */
export function createNodeWorker<TContext, TResult>(
	options: NodeWorkerOptions<TContext>,
): NodeWorkerInterface<TContext, TResult> {
	return new NodeWorker(options)
}

// === Queue Stores

/**
 * Create a new in-memory queue store for persistence.
 *
 * @returns A QueueStoreInterface backed by an in-memory Map
 *
 * @example
 * ```ts
 * const store = createMemoryQueueStore<string>()
 * const queue = createQueue({ handler, store })
 * await queue.sync()
 * ```
 */
export function createMemoryQueueStore<TContext>(): QueueStoreInterface<TContext> {
	return new MemoryQueueStore()
}

/**
 * Create a new JSON file-backed queue store for disk persistence.
 *
 * @param path - Absolute or relative path to the JSON file
 * @returns A QueueStoreInterface backed by a JSON file
 *
 * @example
 * ```ts
 * const store = createJsonQueueStore<string>('./queue-state.json')
 * const queue = createQueue({ handler, store })
 * await queue.sync()
 * ```
 */
export function createJsonQueueStore<TContext>(path: string): QueueStoreInterface<TContext> {
	return new JsonQueueStore(path)
}

// === MsgReader

/**
 * Create a new MSG file reader.
 *
 * @param buffer - ArrayBuffer containing the raw .msg file bytes
 * @param options - Optional reader configuration
 * @returns A MsgReaderInterface instance
 *
 * @example
 * ```ts
 * const buffer = fs.readFileSync('email.msg')
 * const reader = createMsgReader(buffer.buffer)
 * const data = reader.parse()
 * console.log(data.subject, data.senderName)
 * ```
 */
export function createMsgReader(
	buffer: ArrayBuffer,
	options?: MsgReaderOptions,
): MsgReaderInterface {
	return new MsgReader(buffer, options)
}

// === MsgBurner

/**
 * Create a new CFB binary writer for reconstituting .msg files.
 *
 * @returns A MsgBurnerInterface instance
 *
 * @example
 * ```ts
 * const burner = createMsgBurner()
 * const binary = burner.burn(entries)
 * ```
 */
export function createMsgBurner(): MsgBurnerInterface {
	return new MsgBurner()
}

// === EmailParser

/**
 * Create a new email file parser.
 *
 * @param options - Optional parser configuration
 * @returns An EmailParserInterface instance
 *
 * @example
 * ```ts
 * const parser = createEmailParser()
 * const result = await parser.parse(file)
 * if (result.success) {
 *     console.log(result.value.messages[0].subject)
 * }
 * ```
 */
export function createEmailParser(options?: EmailParserOptions): EmailParserInterface {
	return new EmailParser(options)
}

// === Browser

/**
 * Create a browser wrapper with Playwright.
 *
 * @param options - Browser configuration
 * @returns A BrowserInterface instance
 *
 * @example
 * ```ts
 * const browser = createBrowser({ engine: 'chromium' })
 * await browser.connect()
 * const page = await browser.create()
 * await page.navigate('https://example.com')
 * const { html } = await page.content()
 * await browser.destroy()
 * ```
 */
export function createBrowser(options?: BrowserOptions): BrowserInterface {
	return new Browser(options)
}

/**
 * Create a browser-backed task worker.
 *
 * Convenience factory that wires a Worker with a Pool of Browser instances.
 * Each task receives a connected BrowserInterface; the pool handles
 * creation, validation, and teardown of browser instances automatically.
 *
 * @param options - Browser worker configuration
 * @returns A WorkerInterface for browser-backed tasks
 *
 * @example
 * ```ts
 * const scraper = createBrowserWorker<string, BrowserContentResult>({
 *     handler: async (url, browser) => {
 *         const page = await browser.create()
 *         await page.navigate(url, { condition: 'networkidle' })
 *         const result = await page.content()
 *         await page.close()
 *         return result
 *     },
 *     browser: { headless: true },
 *     concurrency: 3,
 *     min: 1,
 *     max: 3,
 * })
 *
 * scraper.start()
 * const result = await scraper.enqueue('https://example.com')
 * await scraper.shutdown()
 * ```
 */
export function createBrowserWorker<TContext, TResult>(
	options: BrowserWorkerOptions<TContext, TResult>,
): WorkerInterface<TContext, TResult> {
	return new Worker<TContext, BrowserInterface, TResult>({
		handler: options.handler,
		pool: {
			create: async () => {
				const browser = createBrowser(options.browser)
				await browser.connect()
				return browser
			},
			destroy: async (browser) => browser.destroy(),
			validate: async (browser) => browser.connected,
			min: options.min,
			max: options.max,
		},
		concurrency: options.concurrency,
		bail: options.bail,
		signal: options.signal,
		timeout: options.timeout,
		retries: options.retries,
		store: options.store,
	})
}
