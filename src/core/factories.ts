import type {
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserRecorderInterface,
	BrowserRecorderOptions,
	BrowserReplayInterface,
	BrowserReplayOptions,
	BrowserRunStoreInterface,
	BrowserPageInterface,
	BrowserReadingInput,
	BrowserReadingInterface,
	BrowserSnapshotInput,
	BrowserSnapshotInterface,
	BrowserToolsetInterface,
	BrowserToolsetOptions,
	CDPClientInterface,
	CDPClientOptions,
} from './types.js'
import { BrowserRecorder } from './recorders/BrowserRecorder.js'
import { BrowserReplay } from './BrowserReplay.js'
import { MemoryBrowserJourneyStore } from './stores/MemoryBrowserJourneyStore.js'
import { MemoryBrowserRunStore } from './stores/MemoryBrowserRunStore.js'
import { BrowserReading } from './BrowserReading.js'
import { BrowserSnapshot } from './BrowserSnapshot.js'
import { BrowserToolset } from './BrowserToolset.js'
import { CDPClient } from './CDPClient.js'
/**
 * Creates a `CDPClientInterface` bound to the given `CDPTransportInterface`.
 *
 * @param options - The transport (and optional timeout) the client uses
 * @returns A {@link CDPClientInterface}
 *
 * @example
 * ```ts
 * import { createCDPClient } from '@orkestrel/browser'
 *
 * const client = createCDPClient({ transport })
 * await client.connect()
 * ```
 */
export function createCDPClient(options: CDPClientOptions): CDPClientInterface {
	return new CDPClient(options)
}

/**
 * Creates a navigable `BrowserSnapshotInterface` over decoded `BrowserSnapshotInput` data.
 *
 * @param input - Captured documents and computed-style names
 * @returns A {@link BrowserSnapshotInterface}
 *
 * @example
 * ```ts
 * import { createBrowserSnapshot, readBrowserSnapshot } from '@orkestrel/browser'
 *
 * const snapshot = createBrowserSnapshot(readBrowserSnapshot(captured, ['display']))
 * snapshot.find({ name: 'main' })
 * ```
 */
export function createBrowserSnapshot(input: BrowserSnapshotInput): BrowserSnapshotInterface {
	return new BrowserSnapshot(input)
}

/**
 * Creates a `BrowserReadingInterface` over a captured document, parsing its HTML one time.
 *
 * @remarks
 * A reading built with a `navigation` source reports `stale` when that source's epoch differs
 * from the `epoch` recorded at capture; a reading built without one never does.
 *
 * @param input - The document URL, title, and HTML, and the optional navigation epoch
 * @returns A {@link BrowserReadingInterface}
 *
 * @example
 * ```ts
 * import { createBrowserReading } from '@orkestrel/browser'
 *
 * const reading = createBrowserReading({
 * 	url: 'https://example.com/',
 * 	title: 'Example',
 * 	html: '<nav>Menu</nav><main><p>Body</p></main>',
 * })
 * reading.text({ distill: false }) // { text: 'Menu\nBody', offset: 0, total: 9 }
 * ```
 */
export function createBrowserReading(input: BrowserReadingInput): BrowserReadingInterface {
	return new BrowserReading(input)
}

/**
 * Creates a `BrowserToolsetInterface` that publishes the browser vocabulary over one page into a
 * `@orkestrel/tool` manager.
 *
 * @remarks
 * The page is both the toolset's view and its `page` option, so the toolset advertises the seven
 * CDP tools. It registers its tools during `start()`: the generic tools first, then the page
 * tools as their adoption resolves. Its options are described on {@link BrowserToolsetOptions};
 * hand `toolset.tools` to an agent, and publish `toolset.native` to a built-in browser agent.
 *
 * @param page - The page the tools act on first
 * @param options - The manager, page-tool source, context, bound, and schemes; `page` is replaced
 * by the page argument
 * @returns A {@link BrowserToolsetInterface}
 *
 * @example
 * ```ts
 * import { createBrowserToolset } from '@orkestrel/browser'
 *
 * const toolset = createBrowserToolset(page, { context })
 * await toolset.start()
 * const result = await toolset.tools.execute({ id: '1', name: 'look', arguments: { search: 'cart' } })
 * ```
 *
 * @example Drive a page with a small model
 * ```ts
 * import { createAgent } from '@orkestrel/agent'
 * import { createBrowserToolset } from '@orkestrel/browser'
 * import { createBrowser } from '@orkestrel/browser/server'
 * import { createOllama } from '@orkestrel/ollama'
 * import { createToolManager } from '@orkestrel/tool'
 *
 * const system =
 * 	'You control a web browser with tools and must call a tool before you answer. ' +
 * 	'The first message shows the page as look returns it; references such as e4 name its elements. ' +
 * 	'To learn a fact, call read with search set to words from your question; when its result ends by naming an offset, call read again with that offset. ' +
 * 	"To use the site's search box, call type with its reference, the words, and submit true. " +
 * 	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
 * 	'If text you expect has not appeared, call wait once. ' +
 * 	'When the task is done, answer in one short sentence.'
 *
 * const browser = createBrowser({ headless: true })
 * await browser.connect()
 * const page = await browser.create({ url: 'https://shop.example.test/' })
 * const toolset = createBrowserToolset(page, { tools: createToolManager() })
 * await toolset.start()
 * toolset.tools.tools().map((tool) => tool.name) // ['look', 'read', 'plain', 'click', 'type', 'press', 'navigate', 'wait']
 * const seeded = await toolset.tools.execute({
 * 	id: 'seed',
 * 	name: 'look',
 * 	arguments: { search: '' },
 * })
 * const view = seeded.success ? String(seeded.value) : seeded.error
 * const agent = createAgent(createOllama({ model: 'qwen3.5:2b-q4_K_M' }), {
 * 	system,
 * 	tools: toolset.tools,
 * })
 * agent.context.messages.add({
 * 	role: 'user',
 * 	content: `What does the Alpine Kettle cost?\n\nThe browser shows this page:\n${view}`,
 * })
 * const result = await agent.generate()
 * await toolset.destroy()
 * await browser.destroy()
 * ```
 */
export function createBrowserToolset(
	page: BrowserPageInterface,
	options?: BrowserToolsetOptions,
): BrowserToolsetInterface {
	return new BrowserToolset(page, { ...options, page })
}

/**
 * Creates a recorder over toolset actions.
 * @param toolset - The recording source
 * @param options - Event hooks and observer error handling
 * @returns The recorder
 * @example
 * const recorder = createBrowserRecorder(toolset)
 * await recorder.start()
 */
export function createBrowserRecorder(
	toolset: BrowserToolsetInterface,
	options?: BrowserRecorderOptions,
): BrowserRecorderInterface {
	return new BrowserRecorder(toolset, options)
}

/**
 * Creates a replay of one journey revision.
 * @param toolset - The toolset that performs the steps
 * @param revision - The journey and optional stored revision
 * @param options - Inputs, run store, and event hooks
 * @returns The replay
 * @example
 * const run = await createBrowserReplay(toolset, { journey }).execute()
 */
export function createBrowserReplay(
	toolset: BrowserToolsetInterface,
	revision: BrowserJourneyRevision,
	options?: BrowserReplayOptions,
): BrowserReplayInterface {
	return new BrowserReplay(toolset, revision, options)
}

/**
 * Creates an in-memory journey store with persistent revision counters.
 * @returns The store
 * @example
 * const store = createMemoryBrowserJourneyStore()
 * await store.set(journey)
 */
export function createMemoryBrowserJourneyStore(): BrowserJourneyStoreInterface {
	return new MemoryBrowserJourneyStore()
}

/**
 * Creates an in-memory run store without capture directories.
 * @returns The store
 * @example
 * const runs = createMemoryBrowserRunStore()
 * await runs.set(run)
 */
export function createMemoryBrowserRunStore(): BrowserRunStoreInterface {
	return new MemoryBrowserRunStore()
}
