import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserToolsetInterface,
	BrowserViewport,
} from '@src/core'
import type { MCPCallResult, MCPExecutionContext, MCPMethodOptions } from '@orkestrel/mcp'
import type { PoolInterface, PoolToken } from '@orkestrel/pool'
import type { StdioServerInterface } from '@orkestrel/mcp/server'
import type { ToolContext, ToolInterface, ToolManagerInterface, ToolResult } from '@orkestrel/tool'
import type {
	BrowserInterface,
	BrowserLaunchFunction,
	BrowserMCPServerInterface,
	BrowserMCPServerOptions,
	BrowserServerCatalog,
} from './types.js'
import { randomUUID } from 'node:crypto'
import { addAbortListener } from 'node:events'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isError, isInteger, isRecord, isString } from '@orkestrel/contract'
import { createMCPLegacy, createMCPServer, JSONRPC_SERVER_ERROR, MCPError } from '@orkestrel/mcp'
import { createPool, isPoolError } from '@orkestrel/pool'
import { createStdioServer } from '@orkestrel/mcp/server'
import { createTool, createToolManager, toolToDefinition } from '@orkestrel/tool'
import {
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_NAMES,
	BROWSER_TOOL_LIMIT,
	BROWSER_TOOL_CUT_FOOTER,
	boundBrowserText,
	BrowserError,
	createBrowserToolset,
	createCDPClient,
	isBrowserError,
} from '@src/core'
import { version } from '../../package.json'
import {
	createBrowser,
	createWebSocketCDPTransport,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
} from './factories.js'
import {
	BROWSER_SERVER_EXHAUSTED,
	BROWSER_SERVER_BUSY,
	BROWSER_SERVER_HOLDER,
	BROWSER_SERVER_COPY,
	BROWSER_SERVER_LAUNCH,
	BROWSER_SERVER_OPTIONS,
	BROWSER_SERVER_POOL_LIMIT,
	BROWSER_SERVER_POOL_SIZE,
	BROWSER_SERVER_CONTEXTS,
	BROWSER_SERVER_CONTEXTS_LIMIT,
	BROWSER_SERVER_RECORD,
	BROWSER_SERVER_RESTARTS,
	BROWSER_SERVER_SWEEP,
	BROWSER_SERVER_TEARDOWN,
	BROWSER_SERVER_UNAVAILABLE,
	BROWSER_SERVER_CRASH,
	BROWSER_SERVER_UNRESOLVED,
} from './constants.js'
import {
	describeBrowserServerLoss,
	formatBrowserLockEntry,
	parseBrowserLockEntry,
	parseBrowserProfileRecord,
	probeProcess,
} from './helpers.js'

/**
 * Implements `BrowserMCPServerInterface`: serves the browser vocabulary and the journey tools over
 * the Model Context Protocol on stdio, and warms Chromium at server start.
 *
 * @remarks
 * The server's own manager holds one dispatcher per name of the vocabulary — `read`, `click`,
 * `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, `record`, `save`, `journeys`, `edit`,
 * `replay`, `forget`, and `capture` — each carrying the description, parameters, and annotations
 * `BROWSER_TOOL_COPY` gives, so `tools/list` answers before Chromium starts and with Chromium
 * absent. After the launch, a tool the toolset's manager adds under another name, such as a page
 * tool it adopts, is mirrored as a dispatcher with that tool's definition, and the mirror is
 * removed when the toolset withdraws the tool, so the server's tool list changes and a subscribed
 * client is notified. The server also advertises `acquire`, `execute`, `tools`, and `destroy` with
 * `BROWSER_SERVER_COPY`. Startup warms the pool and assigns a prepared context to the shared holder. The legacy
 * handshake and browser calls await that setup. Named holders each own a lease, a pending grant,
 * and loss notices; concurrent calls on a holder share its replacement grant. Ending a holder
 * closes its context and releases its lease, and admission counts that holder until disposal settles.
 * A launch creates `ROOT/.profiles/PID-UUID/` exclusively, connects a browser that never attaches to an
 * existing endpoint, opens one page in an isolated context, and constructs the page toolset with
 * that context and the file journey and run stores under the root, on a manager the toolset owns.
 * A dispatcher forwards its arguments and the call's context, signal included, to the toolset's
 * manager and returns that manager's value, or rejects with its failure message; a text value
 * reaches the client as one text block rather than as its JSON text.
 * A disconnect retires its browser and every hosted generation. A current-page crash retires only
 * that holder's context. A failed call receives a liveness ping;
 * loss makes its outcome unresolved, while a known success remains successful. Pending losses
 * prefix the next outcome on a successor, or a refusal, and calls are never repeated.
 * Concurrent checks share one ping per slot. Cancelling a call ends only its wait; the ping keeps
 * its deadline and records loss for the next call.
 *
 * `start()` serves stdio and destroys the server at the end of its input, on `SIGINT`, and on
 * `SIGTERM`. `destroy()` stops reading requests and removes every dispatcher, then destroys every
 * slot through the pool — each toolset, which aborts its active replay, then its context and downloads,
 * then its browser and its
 * profile — and rechecks the profile folders this server made or kept.
 *
 * Chromium on Linux refuses to start as the root user unless its sandbox is disabled, so a server
 * running as root on Linux launches Chromium with `--no-sandbox`; a launch that could run
 * sandboxed is never changed.
 *
 * @example
 * ```ts
 * import { BrowserMCPServer } from '@orkestrel/browser/server'
 *
 * const server = new BrowserMCPServer({ root: 'tmp/browsers', journeys: { readonly: true } })
 * await server.start()
 * await server.destroy()
 * ```
 */
export class BrowserMCPServer implements BrowserMCPServerInterface {
	readonly #root: string
	readonly #headless: boolean
	readonly #executable: string | undefined
	readonly #viewport: BrowserViewport | undefined
	readonly #readonly: boolean
	readonly #launcher: BrowserLaunchFunction
	readonly #input: NodeJS.ReadableStream
	readonly #tools: ToolManagerInterface
	readonly #transport: StdioServerInterface
	readonly #abort = new AbortController()
	readonly #signal: () => void
	readonly #vocabulary: ReadonlySet<string>
	#mirrored:
		| {
				readonly lease: {
					readonly token: PoolToken<{
						readonly browser: BrowserInterface
						readonly profile: string
					}>
					readonly generation: {
						readonly context: BrowserContextInterface
						readonly toolset: BrowserToolsetInterface
						readonly directory: string
					}
				}
				readonly added: (tool: ToolInterface) => void
				readonly removed: (tool: ToolInterface) => void
				readonly cleared: (tools: readonly ToolInterface[]) => void
		  }
		| undefined
	readonly #pool: PoolInterface<{
		readonly browser: BrowserInterface
		readonly profile: string
	}>
	readonly #log: NodeJS.WritableStream
	readonly #folders = new Set<string>()
	readonly #faults = new Set<unknown>()
	readonly #losses = new WeakMap<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		{ readonly cause: unknown }
	>()
	readonly #departures = new WeakMap<
		{
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
		{
			readonly cause: unknown
			readonly url: string
		}
	>()
	readonly #pings = new WeakMap<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		Promise<void>
	>()
	readonly #watches = new Map<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		{
			readonly resolve: (cause: unknown) => void
			readonly disconnect: () => void
			readonly subscription: Disposable
		}
	>()
	readonly #observed = new Map<
		{
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
		{
			readonly page: (page: BrowserPageInterface) => void
			readonly crashes: ReadonlyMap<BrowserPageInterface, () => void>
		}
	>()
	readonly #prepared = new Map<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		{
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		}
	>()
	readonly #owned = new Map<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		Set<{
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		}>
	>()
	readonly #building = new Map<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		Set<
			Promise<{
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}>
		>
	>()
	readonly #cleaning = new WeakMap<
		{
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
		Promise<boolean>
	>()
	readonly #endings = new WeakMap<
		{
			readonly browser: BrowserInterface
			readonly profile: string
		},
		PromiseWithResolvers<void>
	>()
	readonly #retentions = new Map<
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		unknown
	>()
	readonly #shared: {
		readonly id: string
		readonly purpose: string
		readonly abort: AbortController
	} = {
		id: 'shared',
		purpose: 'Shared browser',
		abort: this.#abort,
	}
	readonly #holders = new Map<
		string,
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		}
	>([[this.#shared.id, this.#shared]])
	readonly #leases = new Map<
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		{
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		}
	>()
	readonly #grants = new Map<
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		Promise<{
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		}>
	>()
	readonly #notices = new Map<
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		Set<{
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		}>
	>()
	readonly #disposals = new Map<string, Promise<void>>()
	readonly #drains = new Map<
		{
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		Set<Promise<void>>
	>()
	readonly #readers = new Map<string, Set<symbol>>()
	readonly #writers = new Set<string>()
	readonly #admission: number
	readonly #reference: () => string
	#references = 0
	#failure: unknown
	#stranded: unknown
	#starting: Promise<void> | undefined
	#sweeping: Promise<void> | undefined
	#closing: Promise<void> | undefined

	/**
	 * Registers the dispatchers and binds the protocol to the stdio streams without reading them.
	 *
	 * @param options - The root, the launch, the journeys' read-only switch, and the streams
	 */
	constructor(options?: BrowserMCPServerOptions) {
		const size = options?.pool?.size ?? BROWSER_SERVER_POOL_SIZE
		const contexts = options?.pool?.contexts ?? BROWSER_SERVER_CONTEXTS
		if (!isInteger(size) || size < 1 || size > BROWSER_SERVER_POOL_LIMIT)
			throw new BrowserError(
				BROWSER_SERVER_OPTIONS,
				`pool.size must be an integer from 1 through ${BROWSER_SERVER_POOL_LIMIT}`,
			)
		if (!isInteger(contexts) || contexts < 1 || contexts > BROWSER_SERVER_CONTEXTS_LIMIT)
			throw new BrowserError(
				BROWSER_SERVER_OPTIONS,
				`pool.contexts must be an integer from 1 through ${BROWSER_SERVER_CONTEXTS_LIMIT}`,
			)
		this.#admission = size * contexts
		this.#log = options?.log ?? process.stderr
		this.#reference = this.#issue.bind(this)
		this.#pool = createPool<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>({
			create: this.#warm.bind(this),
			destroy: this.#destroyRecord.bind(this),
			validate: this.#validate.bind(this),
			watch: this.#watch.bind(this),
			error: this.#fault.bind(this),
			min: size,
			capacity: contexts,
			restarts: BROWSER_SERVER_RESTARTS,
		})
		this.#root = resolve(options?.root ?? 'tmp/browsers')
		this.#headless = options?.browser?.headless ?? true
		this.#executable = options?.browser?.executable
		this.#viewport = options?.browser?.viewport
		this.#readonly = options?.journeys?.readonly ?? false
		this.#launcher = options?.pool?.launch ?? createBrowser
		this.#input = options?.stdio?.input ?? process.stdin
		this.#tools = createToolManager()
		const names = [...BROWSER_TOOL_NAMES, ...BROWSER_JOURNEY_TOOL_NAMES]
		this.#vocabulary = new Set([...names, ...Object.keys(BROWSER_SERVER_COPY)])
		for (const name of names) {
			this.#tools.add(
				createTool({
					...BROWSER_TOOL_COPY[name],
					execute: this.#forward.bind(this, this.#shared, name),
				}),
			)
		}
		this.#tools.add(
			createTool({ ...BROWSER_SERVER_COPY.acquire, execute: this.#acquire.bind(this) }),
		)
		this.#tools.add(
			createTool({ ...BROWSER_SERVER_COPY.execute, execute: this.#dispatch.bind(this) }),
		)
		this.#tools.add(createTool({ ...BROWSER_SERVER_COPY.tools, execute: this.#catalog.bind(this) }))
		this.#tools.add(
			createTool({ ...BROWSER_SERVER_COPY.destroy, execute: this.#dispose.bind(this) }),
		)
		const server = createMCPServer({
			identity: { name: 'browse', version },
			tools: this.#tools,
			execution: this.#execute.bind(this),
			handshake: this.#handshake.bind(this),
		})
		this.#transport = createStdioServer(createMCPLegacy(server), {
			input: this.#input,
			...(options?.stdio?.output === undefined ? {} : { output: options.stdio.output }),
		})
		// One reference serves the end of input and both signals, because a listener is removed by
		// identity.
		this.#signal = this.#end.bind(this)
	}

	async start(): Promise<void> {
		if (this.#closing !== undefined) throw this.#ended()
		this.#starting ??= this.#setup()
		return this.#starting
	}

	destroy(): Promise<void> {
		this.#closing ??= Promise.resolve().then(this.#destroy.bind(this))
		return this.#closing
	}

	async #setup(): Promise<void> {
		this.#input.on('end', this.#signal)
		process.on('SIGINT', this.#signal)
		process.on('SIGTERM', this.#signal)
		this.#transport.start()
		try {
			await mkdir(join(this.#root, '.profiles'), { recursive: true })
			if (this.#closing !== undefined) return
			this.#sweeping = this.#sweep()
			const warming = this.#pool.start().then(undefined, (error: unknown) => error)
			await this.#grant(this.#shared, this.#abort.signal)
			if (this.#closing !== undefined) return
			void warming.then(this.#exhaust.bind(this))
		} catch (error) {
			if (this.#closing !== undefined) return
			if (isBrowserError(error) && error.code === BROWSER_SERVER_UNAVAILABLE) throw error
			throw this.#unavailable(isPoolError(error) ? (error.cause ?? this.#failure) : error)
		}
	}

	async #destroy(): Promise<void> {
		// The handlers go first: a second signal during a slow teardown asks for the process.
		process.removeListener('SIGINT', this.#signal)
		process.removeListener('SIGTERM', this.#signal)
		this.#input.removeListener('end', this.#signal)
		this.#transport.stop()
		for (const tool of this.#tools.tools()) this.#tools.remove(tool.name)
		this.#unmirror()
		for (const generation of this.#observed.keys()) this.#untrack(generation)
		this.#leases.clear()
		for (const holder of this.#holders.values()) holder.abort.abort()
		this.#abort.abort()
		const barrier = this.#pool.destroy().catch((error: unknown) => {
			for (const failure of isPoolError(error) ? (error.context?.failures ?? [error]) : [error])
				this.#faults.add(failure)
		})
		await this.#starting?.catch(() => undefined)
		await barrier
		await Promise.allSettled(this.#grants.values())
		await Promise.allSettled(this.#disposals.values())
		this.#holders.clear()
		await this.#sweeping
		if (this.#stranded !== undefined) this.#faults.add(this.#stranded)
		for (const folder of this.#folders) {
			try {
				const record = parseBrowserProfileRecord(
					await readFile(join(folder, BROWSER_SERVER_RECORD), 'utf8'),
				)
				if (record === undefined || probeProcess(record.pid)) continue
			} catch (error) {
				if (!isError(error) || !('code' in error) || error.code !== 'ENOENT') continue
			}
			try {
				await rm(folder, { recursive: true, force: true, maxRetries: 5 })
				this.#folders.delete(folder)
			} catch (error) {
				this.#faults.add(error)
			}
		}
		if (this.#faults.size > 0)
			throw new AggregateError([...this.#faults], 'The browse server teardown failed')
	}

	// Runs the dispatcher and answers a text result as one text block, because the protocol's own
	// rendering of a value is its JSON text, which escapes every quote and line break of a receipt.
	async #execute(context: MCPExecutionContext): Promise<ToolResult | MCPCallResult> {
		const result = await context.tools.execute(context.call, {
			signal: context.signal,
			...(context.caller === undefined ? {} : { caller: context.caller }),
		})
		if (!result.success)
			return {
				...result,
				error: boundBrowserText(result.error, BROWSER_TOOL_LIMIT, BROWSER_TOOL_CUT_FOOTER),
			}
		if (typeof result.value !== 'string') return result
		const text =
			context.call.name === 'acquire' || context.call.name === 'tools'
				? result.value
				: boundBrowserText(result.value, BROWSER_TOOL_LIMIT, BROWSER_TOOL_CUT_FOOTER)
		return { resultType: 'complete', content: [{ type: 'text', text }] }
	}

	// Answers the end of input and a termination signal.
	#end(): void {
		if (this.#closing !== undefined) return
		void this.destroy().catch(this.#endFailure.bind(this))
	}

	#endFailure(error: unknown): void {
		process.exitCode = 1
		this.#write(`browse: ${describeBrowserServerLoss(BROWSER_SERVER_TEARDOWN, error)}`)
	}

	async #acquire(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
		context.signal.throwIfAborted()
		if (this.#closing !== undefined) throw this.#ended()
		const purpose = args['purpose']
		if (!isString(purpose) || purpose.trim().length === 0)
			throw new BrowserError('TOOLSET_ARGUMENT', 'purpose must describe the work')
		if (this.#holders.size >= this.#admission)
			throw new BrowserError(
				BROWSER_SERVER_BUSY,
				`${BROWSER_SERVER_BUSY}: ${[...this.#holders.values()].map((holder) => `${holder.id} (${holder.purpose})`).join(', ')}. Call destroy for a holder no longer needed or call the named tools to share the shared browser.`,
			)
		const holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		} = { id: randomUUID(), purpose, abort: new AbortController() }
		this.#holders.set(holder.id, holder)
		const listener = addAbortListener(context.signal, () =>
			holder.abort.abort(context.signal.reason),
		)
		try {
			const lease = await this.#serve(holder, context.signal)
			context.signal.throwIfAborted()
			if (holder.abort.signal.aborted || this.#holders.get(holder.id) !== holder)
				throw this.#ended()
			if (this.#leases.get(holder) !== lease)
				throw this.#unavailable(this.#departures.get(lease)?.cause)
			const catalog: BrowserServerCatalog = {
				holder: holder.id,
				tools: lease.generation.toolset.tools.definitions(),
			}
			return JSON.stringify(catalog)
		} catch (error) {
			await this.#retire(holder).catch(this.#fault.bind(this))
			throw error
		} finally {
			listener[Symbol.dispose]()
		}
	}

	#holder(value: unknown): {
		readonly id: string
		readonly purpose: string
		readonly abort: AbortController
	} {
		const holder = isString(value) ? this.#holders.get(value) : undefined
		if (holder === undefined || holder === this.#shared || holder.abort.signal.aborted)
			throw new BrowserError(
				BROWSER_SERVER_HOLDER,
				`${BROWSER_SERVER_HOLDER}: unknown or ended holder`,
			)
		return holder
	}

	async #dispatch(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<unknown> {
		const holder = this.#holder(args['holder'])
		const name = args['name']
		const parameters = args['arguments']
		if (!isString(name) || !isRecord(parameters))
			throw new BrowserError('TOOLSET_ARGUMENT', 'execute requires name and arguments')
		return this.#forward(holder, name, parameters, context)
	}

	async #catalog(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
		const holder = this.#holder(args['holder'])
		const signal = AbortSignal.any([context.signal, holder.abort.signal])
		try {
			const lease = await this.#serve(holder, signal)
			signal.throwIfAborted()
			if (this.#leases.get(holder) !== lease)
				throw this.#unavailable(this.#departures.get(lease)?.cause)
			const catalog: BrowserServerCatalog = {
				holder: holder.id,
				tools: lease.generation.toolset.tools.definitions(),
			}
			return this.#annotate(holder, JSON.stringify(catalog))
		} catch (error) {
			context.signal.throwIfAborted()
			if (holder.abort.signal.aborted)
				throw new BrowserError(
					BROWSER_SERVER_UNRESOLVED,
					`${BROWSER_SERVER_UNRESOLVED}: the holder ended during the call`,
				)
			if (isBrowserError(error))
				throw new BrowserError(
					error.code,
					this.#annotate(holder, `${error.code}: ${error.message}`),
				)
			throw error
		}
	}

	async #dispose(args: Readonly<Record<string, unknown>>): Promise<string> {
		const id = args['holder']
		const disposal = isString(id) ? this.#disposals.get(id) : undefined
		await (disposal ?? this.#retire(this.#holder(id)))
		return 'Holder destroyed.'
	}

	#retire(holder: {
		readonly id: string
		readonly purpose: string
		readonly abort: AbortController
	}): Promise<void> {
		const pending = this.#disposals.get(holder.id)
		if (pending !== undefined) return pending
		holder.abort.abort()
		const lease = this.#leases.get(holder)
		this.#leases.delete(holder)
		if (lease !== undefined) this.#untrack(lease.generation)
		const disposal = Promise.resolve().then(async () => {
			try {
				await this.#grants.get(holder)?.catch(() => undefined)
				if (lease !== undefined) await this.#release(holder, lease)
				await Promise.all(this.#drains.get(holder) ?? [])
				await Promise.all(
					[...(this.#notices.get(holder) ?? [])]
						.filter((lost) => this.#losses.has(lost.token.value))
						.map((lost) => this.#endings.get(lost.token.value)?.promise),
				)
			} catch (error) {
				this.#faults.add(error)
			} finally {
				if (this.#holders.get(holder.id) === holder && !this.#retentions.has(holder))
					this.#holders.delete(holder.id)
				this.#notices.delete(holder)
				this.#drains.delete(holder)
			}
		})
		this.#disposals.set(holder.id, disposal)
		return disposal
	}

	async #forward(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		name: string,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> {
		context.signal.throwIfAborted()
		const journey = args['journey']
		if ((name !== 'replay' && name !== 'forget') || !isString(journey))
			return this.#perform(holder, name, args, context)
		if (this.#writers.has(journey) || (name === 'forget' && this.#readers.has(journey)))
			throw new BrowserError(
				'JOURNEY_LOCKED',
				`JOURNEY_LOCKED: Journey ${journey} is locked; call ${name} again.`,
				{ name: journey },
			)
		const reader = Symbol(journey)
		if (name === 'forget') this.#writers.add(journey)
		else {
			const readers = this.#readers.get(journey) ?? new Set<symbol>()
			readers.add(reader)
			this.#readers.set(journey, readers)
		}
		try {
			return await this.#perform(holder, name, args, context)
		} finally {
			if (name === 'forget') this.#writers.delete(journey)
			else {
				const readers = this.#readers.get(journey)
				readers?.delete(reader)
				if (readers?.size === 0) this.#readers.delete(journey)
			}
		}
	}

	async #perform(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		name: string,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> {
		const signal =
			holder === this.#shared
				? context.signal
				: AbortSignal.any([context.signal, holder.abort.signal])
		let lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		}
		try {
			lease = await this.#serve(holder, signal)
		} catch (error) {
			context.signal.throwIfAborted()
			if (holder !== this.#shared && holder.abort.signal.aborted)
				throw new BrowserError(
					BROWSER_SERVER_UNRESOLVED,
					`${BROWSER_SERVER_UNRESOLVED}: the holder ended during the call`,
				)
			if (isBrowserError(error))
				throw new BrowserError(
					error.code,
					this.#annotate(holder, `${error.code}: ${error.message}`),
				)
			throw error
		}
		let result: ToolResult
		try {
			const execution = lease.generation.toolset.tools.execute(
				{ id: name, name, arguments: args },
				{ ...context, signal },
			)
			// A cancelled replay still persists its run before surrendering admission.
			const outcome = await (name === 'replay' || name === 'forget'
				? execution
				: this.#race(execution, signal))
			if (outcome === undefined) throw this.#ended()
			result = outcome
		} catch (error) {
			result = {
				id: name,
				name,
				success: false,
				error: isError(error) ? error.message : String(error),
			}
		}
		context.signal.throwIfAborted()
		if (holder !== this.#shared && holder.abort.signal.aborted)
			throw new BrowserError(
				BROWSER_SERVER_UNRESOLVED,
				BROWSER_SERVER_UNRESOLVED + ': the holder ended during the call',
			)
		if (!result.success) {
			if (this.#leases.get(holder) === lease && !context.signal.aborted) {
				try {
					await this.#race(this.#ping(lease.token.value), context.signal)
				} catch {
					// The shared ping records loss even when this caller stops waiting.
				}
			}
			context.signal.throwIfAborted()
			if (this.#leases.get(holder) !== lease) {
				const loss = this.#departures.get(lease)
				throw new BrowserError(
					BROWSER_SERVER_UNRESOLVED,
					this.#annotate(
						holder,
						describeBrowserServerLoss(BROWSER_SERVER_UNRESOLVED, loss?.cause, loss?.url),
						lease,
					),
				)
			}
			throw new BrowserError(
				'PROTOCOL',
				boundBrowserText(
					this.#annotate(holder, result.error, lease),
					BROWSER_TOOL_LIMIT,
					BROWSER_TOOL_CUT_FOOTER,
				),
			)
		}
		return typeof result.value === 'string'
			? this.#annotate(holder, result.value, lease)
			: result.value
	}

	#annotate(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		value: string,
		lease?: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
	): string {
		const notes: string[] = []
		for (const lost of this.#notices.get(holder) ?? []) {
			if (lost === lease) continue
			const loss = this.#departures.get(lost)
			notes.push(describeBrowserServerLoss(BROWSER_SERVER_CRASH, loss?.cause, loss?.url))
			this.#notices.get(holder)?.delete(lost)
		}
		return [...notes, value].join('\n')
	}

	#notice(context: BrowserContextInterface): string {
		const entry = [...this.#leases].find(([, lease]) => lease.generation.context === context)
		return entry === undefined ? '' : this.#annotate(entry[0], '')
	}

	async #handshake(options: MCPMethodOptions): Promise<void> {
		try {
			await this.#race(this.#starting, options.signal)
			if (this.#closing !== undefined) throw this.#ended()
		} catch (error) {
			options.signal.throwIfAborted()
			if (isBrowserError(error))
				throw new MCPError(`${error.code}: ${error.message}`, JSONRPC_SERVER_ERROR, {
					code: error.code,
				})
			throw error
		}
	}

	async #race<T>(promise: Promise<T> | undefined, signal: AbortSignal): Promise<T | undefined> {
		signal.throwIfAborted()
		const aborted = Promise.withResolvers<never>()
		const listener = addAbortListener(signal, () => aborted.reject(signal.reason))
		try {
			return await Promise.race([promise, aborted.promise])
		} finally {
			listener[Symbol.dispose]()
		}
	}

	async #grant(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		signal: AbortSignal,
	): Promise<{
		readonly token: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>
		readonly generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		}
	}> {
		const held = this.#leases.get(holder)
		if (held !== undefined) return held
		let granting = this.#grants.get(holder)
		if (granting === undefined) {
			granting = Promise.resolve().then(async () => {
				await Promise.allSettled(this.#drains.get(holder) ?? [])
				if (this.#retentions.has(holder)) throw this.#unavailable(this.#retentions.get(holder))
				const token = await this.#pool.acquire(holder.abort.signal)
				return this.#hold(holder, token)
			})
			this.#grants.set(holder, granting)
			void granting
				.finally(() => {
					if (this.#grants.get(holder) === granting) this.#grants.delete(holder)
				})
				.catch(() => undefined)
		}
		const lease = await this.#race(granting, signal)
		if (lease === undefined) throw this.#ended()
		return lease
	}

	async #hold(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		token: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>,
	): Promise<{
		readonly token: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>
		readonly generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		}
	}> {
		const slot = token.value
		if (
			this.#closing !== undefined ||
			this.#holders.get(holder.id) !== holder ||
			holder.abort.signal.aborted
		) {
			token.release()
			throw this.#ended()
		}
		if (!this.#prepared.has(slot)) await this.#ping(slot)
		if (this.#closing !== undefined || holder.abort.signal.aborted) {
			token.release()
			throw this.#ended()
		}
		if (this.#losses.has(slot)) {
			token.release()
			throw this.#unavailable(this.#losses.get(slot)?.cause)
		}
		let generation = this.#prepared.get(slot)
		this.#prepared.delete(slot)
		try {
			generation ??= await this.#build(slot, token)
		} catch (error) {
			if (this.#losses.has(slot)) await this.#endings.get(slot)?.promise
			else token.release()
			throw this.#unavailable(error)
		}
		const lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		} = { token, generation }
		if (
			this.#closing !== undefined ||
			this.#holders.get(holder.id) !== holder ||
			holder.abort.signal.aborted ||
			this.#losses.has(slot)
		) {
			await this.#release(holder, lease)
			throw this.#ended()
		}
		this.#leases.set(holder, lease)
		this.#observe(slot, generation)
		if (holder === this.#shared) {
			const tools = generation.toolset.tools
			const mirrored: {
				readonly lease: {
					readonly token: PoolToken<{
						readonly browser: BrowserInterface
						readonly profile: string
					}>
					readonly generation: {
						readonly context: BrowserContextInterface
						readonly toolset: BrowserToolsetInterface
						readonly directory: string
					}
				}
				readonly added: (tool: ToolInterface) => void
				readonly removed: (tool: ToolInterface) => void
				readonly cleared: (tools: readonly ToolInterface[]) => void
			} = {
				lease,
				added: this.#mirror.bind(this, lease),
				removed: this.#withdraw.bind(this, lease),
				cleared: this.#clear.bind(this, lease),
			}
			this.#mirrored = mirrored
			for (const tool of tools.tools()) this.#mirror(lease, tool)
			tools.emitter.on('add', mirrored.added)
			tools.emitter.on('remove', mirrored.removed)
			tools.emitter.on('clear', mirrored.cleared)
		}
		return lease
	}

	async #serve(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		signal: AbortSignal,
	): Promise<{
		readonly token: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>
		readonly generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		}
	}> {
		if (this.#closing !== undefined || holder.abort.signal.aborted) throw this.#ended()
		await this.#race(this.#starting, signal)
		if (this.#closing !== undefined || holder.abort.signal.aborted) throw this.#ended()
		const held = this.#leases.get(holder)
		if (held !== undefined) {
			try {
				await this.#race(this.#ping(held.token.value), signal)
				if (this.#leases.get(holder) === held) return held
			} catch {
				signal.throwIfAborted()
				if (holder.abort.signal.aborted) throw this.#ended()
			}
		}
		try {
			const lease = await this.#grant(holder, signal)
			if (this.#leases.get(holder) !== lease)
				throw this.#unavailable(this.#departures.get(lease)?.cause)
			return lease
		} catch (error) {
			signal.throwIfAborted()
			if (holder.abort.signal.aborted || (isPoolError(error) && error.code === 'destroyed'))
				throw this.#ended()
			if (isPoolError(error) && (error.code === 'create' || error.code === 'cleanup')) {
				this.#exhaust(error)
				throw this.#unavailable(error.cause ?? this.#failure)
			}
			throw error
		}
	}

	#ping(slot: { readonly browser: BrowserInterface; readonly profile: string }): Promise<void> {
		const pending = this.#pings.get(slot)
		if (pending !== undefined) return pending
		const ping = slot.browser
			.ping({ signal: this.#abort.signal })
			.catch((error: unknown) => {
				if (!this.#abort.signal.aborted) this.#lose(slot, error)
			})
			.finally(() => this.#pings.delete(slot))
		this.#pings.set(slot, ping)
		return ping
	}

	async #validate(slot: {
		readonly browser: BrowserInterface
		readonly profile: string
	}): Promise<boolean> {
		try {
			await slot.browser.ping({ signal: this.#abort.signal })
			return true
		} catch (error) {
			if (!this.#abort.signal.aborted) this.#lose(slot, error)
			return false
		}
	}

	#lose(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		cause: unknown,
	): void {
		if (this.#closing !== undefined || this.#losses.has(slot)) return
		this.#losses.set(slot, { cause })
		this.#failure = cause
		for (const [holder, lease] of this.#leases) {
			if (lease.token.value !== slot) continue
			this.#detach(holder, lease, cause)
		}
		const watch = this.#watches.get(slot)
		this.#unwatch(slot)
		watch?.resolve(cause)
	}

	#detach(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
		cause: unknown,
	): void {
		if (this.#leases.get(holder) !== lease || this.#holders.get(holder.id) !== holder) return
		this.#departures.set(lease, {
			cause,
			url: lease.generation.toolset.redact(lease.generation.toolset.view.url),
		})
		if (holder === this.#shared) this.#unmirror()
		this.#leases.delete(holder)
		this.#untrack(lease.generation)
		const notices =
			this.#notices.get(holder) ??
			new Set<{
				readonly token: PoolToken<{
					readonly browser: BrowserInterface
					readonly profile: string
				}>
				readonly generation: {
					readonly context: BrowserContextInterface
					readonly toolset: BrowserToolsetInterface
					readonly directory: string
				}
			}>()
		notices.add(lease)
		this.#notices.set(holder, notices)
	}

	#watch(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		signal: AbortSignal,
	): Promise<unknown> {
		const loss = Promise.withResolvers<unknown>()
		const disconnect = this.#disconnect.bind(this, slot)
		const subscription = addAbortListener(signal, this.#unwatch.bind(this, slot))
		this.#watches.set(slot, { resolve: loss.resolve, disconnect, subscription })
		slot.browser.emitter.on('disconnect', disconnect)
		if (signal.aborted) this.#unwatch(slot)
		else if (slot.browser.status !== 'connected') this.#disconnect(slot)
		return loss.promise
	}

	#observe(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
	): void {
		if (this.#observed.has(generation)) return
		const page = this.#track.bind(this, slot, generation)
		this.#observed.set(generation, { page, crashes: new Map() })
		generation.context.emitter.on('page', page)
		for (const current of generation.context.pages()) this.#track(slot, generation, current)
	}

	#track(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
		page: BrowserPageInterface,
	): void {
		const watch = this.#observed.get(generation)
		if (watch === undefined || watch.crashes.has(page)) return
		const crash = this.#crash.bind(this, slot, generation, page)
		page.emitter.on('crash', crash)
		this.#observed.set(generation, {
			...watch,
			crashes: new Map([...watch.crashes, [page, crash]]),
		})
	}

	#crash(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
		page: BrowserPageInterface,
	): void {
		if (this.#prepared.get(slot) === generation) {
			this.#prepared.delete(slot)
			this.#untrack(generation)
			void this.#clean(slot, generation).catch(this.#fault.bind(this))
			return
		}
		const held = [...this.#leases].find(([, lease]) => lease.generation === generation)
		if (held === undefined || page !== generation.toolset.view) return
		const [holder, lease] = held
		this.#detach(holder, lease, new Error('The current page renderer crashed'))
		const drain = this.#release(holder, lease)
		const drains = this.#drains.get(holder) ?? new Set<Promise<void>>()
		drains.add(drain)
		this.#drains.set(holder, drains)
		void drain.finally(() => drains.delete(drain)).catch(this.#fault.bind(this))
	}

	#untrack(generation: {
		readonly context: BrowserContextInterface
		readonly toolset: BrowserToolsetInterface
		readonly directory: string
	}): void {
		const watch = this.#observed.get(generation)
		if (watch === undefined) return
		this.#observed.delete(generation)
		generation.context.emitter.off('page', watch.page)
		for (const [page, crash] of watch.crashes) page.emitter.off('crash', crash)
	}

	#disconnect(slot: { readonly browser: BrowserInterface; readonly profile: string }): void {
		this.#lose(
			slot,
			new Error(
				slot.browser.pid === undefined
					? 'The browser process exited'
					: 'The browser transport disconnected',
			),
		)
	}

	#unwatch(slot: { readonly browser: BrowserInterface; readonly profile: string }): void {
		const watch = this.#watches.get(slot)
		if (watch === undefined) return
		this.#watches.delete(slot)
		slot.browser.emitter.off('disconnect', watch.disconnect)
		watch.subscription[Symbol.dispose]()
	}

	async #release(
		holder: {
			readonly id: string
			readonly purpose: string
			readonly abort: AbortController
		},
		lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
	): Promise<void> {
		const slot = lease.token.value
		const removed = await this.#clean(slot, lease.generation)
		const disposal = lease.generation.context.disposal
		if (!removed)
			this.#retentions.set(holder, new Error('The context downloads directory remains owned'))
		if (disposal?.confirmed !== true && !this.#losses.has(slot) && this.#closing === undefined) {
			// Releasing into a FIFO waiter would publish capacity on the dying browser.
			if (
				![...this.#leases.values()].some((held) => held.token.value === slot && held !== lease) &&
				(this.#building.get(slot)?.size ?? 0) === 0
			)
				lease.token.release()
			this.#lose(slot, disposal?.error ?? new Error('The context disposal is unconfirmed'))
			await this.#endings.get(slot)?.promise
		} else if (removed) lease.token.release()
	}

	#clean(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		generation: {
			readonly context: BrowserContextInterface
			readonly toolset: BrowserToolsetInterface
			readonly directory: string
		},
	): Promise<boolean> {
		let cleaning = this.#cleaning.get(generation)
		if (cleaning !== undefined) return cleaning
		cleaning = Promise.resolve().then(async () => {
			await generation.toolset.destroy().catch(this.#fault.bind(this))
			await generation.context.close().catch((error: unknown) => {
				if (!this.#losses.has(slot) && slot.browser.status === 'connected') this.#fault(error)
			})
			try {
				await rm(generation.directory, { recursive: true, force: true })
				this.#owned.get(slot)?.delete(generation)
				return true
			} catch (error) {
				this.#fault(error)
				return false
			}
		})
		this.#cleaning.set(generation, cleaning)
		return cleaning
	}

	#build(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		token?: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>,
	): Promise<{
		readonly context: BrowserContextInterface
		readonly toolset: BrowserToolsetInterface
		readonly directory: string
	}> {
		const construction = this.#construct(slot, token)
		const building =
			this.#building.get(slot) ??
			new Set<
				Promise<{
					readonly context: BrowserContextInterface
					readonly toolset: BrowserToolsetInterface
					readonly directory: string
				}>
			>()
		building.add(construction)
		this.#building.set(slot, building)
		void construction.finally(() => building.delete(construction)).catch(() => undefined)
		return construction
	}

	async #construct(
		slot: {
			readonly browser: BrowserInterface
			readonly profile: string
		},
		token?: PoolToken<{
			readonly browser: BrowserInterface
			readonly profile: string
		}>,
	): Promise<{
		readonly context: BrowserContextInterface
		readonly toolset: BrowserToolsetInterface
		readonly directory: string
	}> {
		const directory = join(slot.profile, 'contexts', randomUUID(), 'downloads')
		let context: BrowserContextInterface | undefined
		let toolset: BrowserToolsetInterface | undefined
		try {
			await mkdir(directory, { recursive: true })
			let page: BrowserPageInterface
			try {
				context = await slot.browser.isolate({
					reference: this.#reference,
					downloads: { path: directory },
					...(this.#viewport === undefined ? {} : { emulation: { viewport: this.#viewport } }),
				})
				page = await context.create()
			} catch (error) {
				if (token !== undefined) {
					// This construction still occupies one entry until its rejection settles.
					if (
						![...this.#leases.values()].some((lease) => lease.token.value === slot) &&
						(this.#building.get(slot)?.size ?? 0) === 1
					)
						token.release()
					this.#lose(slot, error)
				}
				throw error
			}
			toolset = createBrowserToolset(page, {
				context,
				notes: this.#notice.bind(this, context),
				journeys: {
					store: createFileBrowserJourneyStore({ root: this.#root }),
					runs: createFileBrowserRunStore({ root: this.#root }),
					readonly: this.#readonly,
				},
			})
			await toolset.start()
			const generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			} = { context, toolset, directory }
			const owned =
				this.#owned.get(slot) ??
				new Set<{
					readonly context: BrowserContextInterface
					readonly toolset: BrowserToolsetInterface
					readonly directory: string
				}>()
			owned.add(generation)
			this.#owned.set(slot, owned)
			return generation
		} catch (error) {
			await toolset?.destroy().catch(this.#fault.bind(this))
			await context?.close().catch((failure: unknown) => {
				// A launched browser defers its loss event; CDP can already report the disconnection.
				if (
					!this.#losses.has(slot) &&
					slot.browser.status === 'connected' &&
					this.#closing === undefined &&
					!(isBrowserError(failure) && failure.code === 'DISCONNECTED')
				)
					this.#fault(failure)
			})
			await rm(directory, { recursive: true, force: true }).catch(this.#fault.bind(this))
			throw error
		}
	}

	async #destroyRecord(slot: {
		readonly browser: BrowserInterface
		readonly profile: string
	}): Promise<void> {
		// A timed-out browser cannot answer context cleanup; kill before awaiting that cleanup.
		const cause = this.#losses.get(slot)?.cause
		if (isBrowserError(cause) && cause.code === 'TIMEOUT' && slot.browser.pid !== undefined) {
			try {
				process.kill(slot.browser.pid, 'SIGKILL')
			} catch (error) {
				if (!isError(error) || !('code' in error) || error.code !== 'ESRCH') this.#faults.add(error)
			}
		}
		try {
			await Promise.allSettled(this.#building.get(slot) ?? [])
			const prepared = this.#prepared.get(slot)
			if (prepared !== undefined) this.#untrack(prepared)
			this.#prepared.delete(slot)
			await Promise.all(
				[...(this.#owned.get(slot) ?? [])].map((generation) => this.#clean(slot, generation)),
			)
			await this.#destroySlot(slot.profile, slot.browser)
			this.#owned.delete(slot)
			this.#building.delete(slot)
			this.#endings.get(slot)?.resolve()
		} catch (error) {
			this.#endings.get(slot)?.reject(error)
			throw error
		}
	}

	#fault(error: unknown): void {
		this.#faults.add(error)
	}

	async #warm(): Promise<{
		readonly browser: BrowserInterface
		readonly profile: string
	}> {
		if (this.#closing !== undefined) throw this.#ended()
		if (this.#stranded !== undefined)
			throw new BrowserError(
				BROWSER_SERVER_TEARDOWN,
				isError(this.#stranded) ? this.#stranded.message : String(this.#stranded),
				isBrowserError(this.#stranded) ? this.#stranded.context : undefined,
			)
		const profile = join(this.#root, '.profiles', formatBrowserLockEntry(process.pid, randomUUID()))
		// Without `recursive`, an existing directory refuses with `EEXIST`, so no two launches share one.
		let browser: BrowserInterface | undefined
		let slot:
			| {
					readonly browser: BrowserInterface
					readonly profile: string
			  }
			| undefined
		try {
			await mkdir(profile)
			this.#folders.add(profile)
			browser = this.#launcher({
				headless: this.#headless,
				profile,
				cdp: { discover: false },
				signal: this.#abort.signal,
				...(this.#executable === undefined ? {} : { executable: this.#executable }),
				...(this.#viewport === undefined ? {} : { viewport: this.#viewport }),
				...(process.platform === 'linux' && process.getuid?.() === 0
					? { args: ['--no-sandbox'] }
					: {}),
			})
			await browser.connect()
			if (browser.pid !== undefined && browser.endpoint !== undefined) {
				const record = join(profile, BROWSER_SERVER_RECORD)
				await writeFile(
					`${record}.tmp`,
					JSON.stringify({ pid: browser.pid, endpoint: browser.endpoint }),
				)
				await rename(`${record}.tmp`, record)
			}
			slot = { browser, profile }
			const ending = Promise.withResolvers<void>()
			void ending.promise.catch(() => undefined)
			this.#endings.set(slot, ending)
			const generation = await this.#build(slot)
			this.#prepared.set(slot, generation)
			this.#observe(slot, generation)
			return slot
		} catch (error) {
			if (this.#folders.has(profile))
				await (
					slot === undefined ? this.#destroySlot(profile, browser) : this.#destroyRecord(slot)
				).catch((failure: unknown) => {
					this.#stranded = failure
				})
			if (this.#closing === undefined)
				this.#write(`browse: ${describeBrowserServerLoss(BROWSER_SERVER_LAUNCH, error)}`)
			throw error
		}
	}

	async #destroySlot(profile: string, browser?: BrowserInterface): Promise<void> {
		try {
			await browser?.destroy()
		} catch (error) {
			if (this.#closing === undefined)
				this.#write(`browse: ${describeBrowserServerLoss(BROWSER_SERVER_TEARDOWN, error)}`)
			throw error
		}
		try {
			await rm(profile, { recursive: true, force: true, maxRetries: 5 })
			this.#folders.delete(profile)
		} catch {
			// The shutdown recheck retries this folder; only its persistent failure reaches destroy.
		}
	}

	async #sweep(): Promise<void> {
		const profiles = join(this.#root, '.profiles')
		try {
			for (const entry of await readdir(profiles)) {
				if (this.#closing !== undefined) return
				const pid = parseBrowserLockEntry(entry)
				if (pid === undefined || pid === process.pid || probeProcess(pid)) continue
				const folder = join(profiles, entry)
				this.#folders.add(folder)
				try {
					const record = parseBrowserProfileRecord(
						await readFile(join(folder, BROWSER_SERVER_RECORD), 'utf8'),
					)
					if (record === undefined) continue
					if (probeProcess(record.pid)) {
						const transport = createWebSocketCDPTransport({ url: record.endpoint })
						const client = createCDPClient({ transport })
						try {
							// A file read can finish after shutdown; do not start an unobserved connection.
							this.#abort.signal.throwIfAborted()
							await this.#race(client.connect(), this.#abort.signal)
							await client.send('Browser.close', undefined, { signal: this.#abort.signal })
						} catch {
							// A dead peer can close without acknowledging, and a live peer can refuse.
						} finally {
							// Client close waits for connect; close the owned transport to end a held upgrade.
							await transport.close()
							await client.close()
						}
						if (probeProcess(record.pid)) continue
					}
				} catch (error) {
					if (!isError(error) || !('code' in error) || error.code !== 'ENOENT') continue
				}
				try {
					await rm(folder, { recursive: true, force: true, maxRetries: 5 })
					this.#folders.delete(folder)
				} catch {
					/* The shutdown recheck owns a later removal attempt. */
				}
			}
		} catch (error) {
			this.#write(`browse: ${describeBrowserServerLoss(BROWSER_SERVER_SWEEP, error)}`)
		}
	}

	#write(line: string): void {
		try {
			this.#log.write(`${line}\n`, (error?: Error | null) => {
				if (error !== undefined && error !== null) this.#faults.add(error)
			})
		} catch (error) {
			this.#faults.add(error)
		}
	}

	#exhaust(error: unknown): void {
		if (isPoolError(error) && error.code === 'create')
			this.#write(
				`browse: ${describeBrowserServerLoss(BROWSER_SERVER_EXHAUSTED, error.cause ?? this.#failure)}`,
			)
	}

	#unavailable(cause: unknown): BrowserError {
		const message = describeBrowserServerLoss(BROWSER_SERVER_UNAVAILABLE, cause)
		return new BrowserError(
			BROWSER_SERVER_UNAVAILABLE,
			message.slice(BROWSER_SERVER_UNAVAILABLE.length + 2),
		)
	}

	#issue(): string {
		return `e${++this.#references}`
	}

	// Adds a dispatcher for a tool the toolset's manager added under a name outside the vocabulary.
	#mirror(
		lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
		tool: ToolInterface,
	): void {
		if (this.#leases.get(this.#shared) !== lease || this.#vocabulary.has(tool.name)) return
		this.#tools.add(
			createTool({
				...toolToDefinition(tool),
				execute: this.#forward.bind(this, this.#shared, tool.name),
			}),
		)
	}

	// Removes the dispatcher of a withdrawn tool; a replacement publishes `remove` while it is
	// installed, so the mirror follows the manager's current tool rather than the event.
	#withdraw(
		lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
		tool: ToolInterface,
	): void {
		if (this.#leases.get(this.#shared) !== lease || this.#vocabulary.has(tool.name)) return
		const current = lease.generation.toolset.tools.tool(tool.name)
		if (current === undefined) this.#tools.remove(tool.name)
		else this.#mirror(lease, current)
	}

	#clear(
		lease: {
			readonly token: PoolToken<{
				readonly browser: BrowserInterface
				readonly profile: string
			}>
			readonly generation: {
				readonly context: BrowserContextInterface
				readonly toolset: BrowserToolsetInterface
				readonly directory: string
			}
		},
		tools: readonly ToolInterface[],
	): void {
		for (const tool of tools) this.#withdraw(lease, tool)
	}

	#unmirror(): void {
		const mirrored = this.#mirrored
		if (mirrored === undefined) return
		this.#mirrored = undefined
		const tools = mirrored.lease.generation.toolset.tools
		for (const tool of tools.tools())
			if (!this.#vocabulary.has(tool.name)) this.#tools.remove(tool.name)
		tools.emitter.off('add', mirrored.added)
		tools.emitter.off('remove', mirrored.removed)
		tools.emitter.off('clear', mirrored.cleared)
	}

	#ended(): BrowserError {
		return new BrowserError('TOOLSET_ENDED', 'the browser session ended')
	}
}
