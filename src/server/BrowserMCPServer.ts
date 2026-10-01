import type { BrowserToolsetInterface } from '@src/core'
import type { MCPCallResult, MCPExecutionContext } from '@orkestrel/mcp'
import type { StdioServerInterface } from '@orkestrel/mcp/server'
import type { ToolContext, ToolInterface, ToolManagerInterface, ToolResult } from '@orkestrel/tool'
import type {
	BrowserInterface,
	BrowserLaunchFunction,
	BrowserMCPServerInterface,
	BrowserMCPServerOptions,
} from './types.js'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createMCPLegacy, createMCPServer } from '@orkestrel/mcp'
import { createStdioServer } from '@orkestrel/mcp/server'
import { createTool, createToolManager, toolToDefinition } from '@orkestrel/tool'
import {
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_NAMES,
	BrowserError,
	createBrowserToolset,
} from '@src/core'
import { version } from '../../package.json' with { type: 'json' }
import {
	createBrowser,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
} from './factories.js'

/**
 * Implements `BrowserMCPServerInterface`: serves the browser vocabulary and the journey tools over
 * the Model Context Protocol on stdio, and launches Chromium on the first tool call.
 *
 * @remarks
 * The server's own manager holds one dispatcher per name of the vocabulary — `look`, `read`,
 * `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, `switch`, `record`, `save`,
 * `journeys`, `edit`, and `replay` — each carrying the description, parameters, and annotations
 * `BROWSER_TOOL_COPY` gives, so `tools/list` answers before Chromium starts and with Chromium
 * absent. After the launch, a tool the toolset's manager adds under another name, such as a page
 * tool it adopts, is mirrored as a dispatcher with that tool's definition, and the mirror is
 * removed when the toolset withdraws the tool, so the server's tool list changes and a subscribed
 * client is notified. The first call of any dispatcher launches Chromium one time: concurrent callers await
 * the same launch, a failed launch rejects every one of them, and the next call launches again.
 * A launch creates `ROOT/.profiles/ID/` exclusively, connects a browser that never attaches to an
 * existing endpoint, opens one page in an isolated context, and constructs the page toolset with
 * that context and the file journey and run stores under the root, on a manager the toolset owns.
 * A dispatcher forwards its arguments and the call's context, signal included, to the toolset's
 * manager and returns that manager's value, or rejects with its failure message; a text value
 * reaches the client as one text block rather than as its JSON text.
 *
 * `start()` serves stdio and destroys the server at the end of its input, on `SIGINT`, and on
 * `SIGTERM`. `destroy()` stops reading requests and removes every dispatcher, then destroys the
 * toolset, which aborts the active replay, then the browser it launched, then removes the profile.
 *
 * Chromium on Linux refuses to start as the root user unless its sandbox is disabled, so a server
 * running as root on Linux launches Chromium with `--no-sandbox`; a launch that could run
 * sandboxed is never changed.
 *
 * @example
 * ```ts
 * import { BrowserMCPServer } from '@orkestrel/browser/server'
 *
 * const server = new BrowserMCPServer({ root: 'tmp/browsers', readonly: true })
 * await server.start()
 * await server.destroy()
 * ```
 */
export class BrowserMCPServer implements BrowserMCPServerInterface {
	readonly #root: string
	readonly #headless: boolean
	readonly #executable: string | undefined
	readonly #readonly: boolean
	readonly #launcher: BrowserLaunchFunction
	readonly #input: NodeJS.ReadableStream
	readonly #tools: ToolManagerInterface
	readonly #transport: StdioServerInterface
	readonly #abort = new AbortController()
	readonly #signal: () => void
	readonly #vocabulary: ReadonlySet<string>
	readonly #added: (tool: ToolInterface) => void
	readonly #removed: (tool: ToolInterface) => void
	readonly #cleared: (tools: readonly ToolInterface[]) => void
	#mirrored: ToolManagerInterface | undefined
	#session: Promise<BrowserToolsetInterface> | undefined
	#browser: BrowserInterface | undefined
	#profile: string | undefined
	#started = false
	#closing: Promise<void> | undefined

	/**
	 * Registers the dispatchers and binds the protocol to the stdio streams without reading them.
	 *
	 * @param options - The root, the launch, the journeys' read-only switch, and the streams
	 */
	constructor(options?: BrowserMCPServerOptions) {
		this.#root = resolve(options?.root ?? 'tmp/browsers')
		this.#headless = options?.headless ?? true
		this.#executable = options?.executable
		this.#readonly = options?.readonly ?? false
		this.#launcher = options?.launch ?? createBrowser
		this.#input = options?.stdio?.input ?? process.stdin
		this.#tools = createToolManager()
		const names = [...BROWSER_TOOL_NAMES, ...BROWSER_JOURNEY_TOOL_NAMES]
		this.#vocabulary = new Set(names)
		for (const name of names) {
			this.#tools.add(
				createTool({
					...BROWSER_TOOL_COPY[name],
					execute: this.#forward.bind(this, name),
				}),
			)
		}
		const server = createMCPServer({
			identity: { name: 'browse', version },
			tools: this.#tools,
			execution: this.#execute.bind(this),
		})
		this.#transport = createStdioServer(createMCPLegacy(server), {
			input: this.#input,
			...(options?.stdio?.output === undefined ? {} : { output: options.stdio.output }),
		})
		// One reference serves the end of input and both signals, because a listener is removed by
		// identity.
		this.#signal = this.#end.bind(this)
		this.#added = this.#mirror.bind(this)
		this.#removed = this.#withdraw.bind(this)
		this.#cleared = this.#clear.bind(this)
	}

	async start(): Promise<void> {
		if (this.#closing !== undefined) throw this.#ended()
		if (this.#started) return
		this.#started = true
		this.#transport.start()
		this.#input.on('end', this.#signal)
		process.on('SIGINT', this.#signal)
		process.on('SIGTERM', this.#signal)
	}

	destroy(): Promise<void> {
		this.#closing ??= this.#destroy()
		return this.#closing
	}

	async #destroy(): Promise<void> {
		// The handlers go first: a second signal during a slow teardown asks for the process.
		process.removeListener('SIGINT', this.#signal)
		process.removeListener('SIGTERM', this.#signal)
		this.#input.removeListener('end', this.#signal)
		this.#transport.stop()
		for (const tool of this.#tools.tools()) this.#tools.remove(tool.name)
		this.#unmirror()
		// Aborting the launch signal ends a connect in flight, so its launch cleans up after itself.
		this.#abort.abort()
		// Each step runs whether or not an earlier one failed, so the profile is always removed.
		const failures: unknown[] = []
		const toolset = await this.#session?.catch(() => undefined)
		await toolset?.destroy().catch((error: unknown) => failures.push(error))
		await this.#browser?.destroy().catch((error: unknown) => failures.push(error))
		this.#browser = undefined
		const profile = this.#profile
		this.#profile = undefined
		// `rm` retries a busy directory within its budget, which a Chromium that has ended can leave.
		if (profile !== undefined) await rm(profile, { recursive: true, force: true, maxRetries: 5 })
		if (failures.length > 0) throw new AggregateError(failures, 'The browse server teardown failed')
	}

	// Runs the dispatcher and answers a text result as one text block, because the protocol's own
	// rendering of a value is its JSON text, which escapes every quote and line break of a receipt.
	async #execute(context: MCPExecutionContext): Promise<ToolResult | MCPCallResult> {
		const result = await context.tools.execute(context.call, {
			signal: context.signal,
			...(context.caller === undefined ? {} : { caller: context.caller }),
		})
		if (!result.success || typeof result.value !== 'string') return result
		return { resultType: 'complete', content: [{ type: 'text', text: result.value }] }
	}

	// Answers the end of input and a termination signal.
	#end(): void {
		void this.destroy()
	}

	async #forward(
		name: string,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> {
		const toolset = await this.#open()
		const result = await toolset.tools.execute({ id: name, name, arguments: args }, context)
		if (!result.success) throw new BrowserError(result.error)
		return result.value
	}

	// Returns the launch every caller shares; a rejected launch is forgotten so the next call retries.
	// Stopping the transport aborts a call in flight and `destroy()` removes the dispatchers, so the
	// refusal here is the last of three layers that keep a call from launching after `destroy()`.
	#open(): Promise<BrowserToolsetInterface> {
		if (this.#closing !== undefined) return Promise.reject(this.#ended())
		const current = this.#session
		if (current !== undefined) return current
		const session = this.#launch()
		this.#session = session
		session.catch(() => {
			if (this.#session === session) this.#session = undefined
		})
		return session
	}

	async #launch(): Promise<BrowserToolsetInterface> {
		await mkdir(this.#root, { recursive: true })
		const profiles = join(this.#root, '.profiles')
		await mkdir(profiles, { recursive: true })
		const profile = join(profiles, randomUUID())
		// Without `recursive`, an existing directory refuses with `EEXIST`, so no two launches share one.
		await mkdir(profile)
		this.#profile = profile
		let browser: BrowserInterface | undefined
		let toolset: BrowserToolsetInterface | undefined
		try {
			browser = this.#launcher({
				headless: this.#headless,
				profile,
				cdp: { discover: false },
				signal: this.#abort.signal,
				...(this.#executable === undefined ? {} : { executable: this.#executable }),
				...(process.platform === 'linux' && process.getuid?.() === 0
					? { args: ['--no-sandbox'] }
					: {}),
			})
			this.#browser = browser
			await browser.connect()
			const context = await browser.isolate()
			const page = await context.create()
			toolset = createBrowserToolset(page, {
				context,
				journeys: {
					store: createFileBrowserJourneyStore({ root: this.#root }),
					runs: createFileBrowserRunStore({ root: this.#root }),
					readonly: this.#readonly,
				},
			})
			// The toolset adopts page tools during `start()`, so the mirror follows it from before.
			this.#mirrored = toolset.tools
			toolset.tools.emitter.on('add', this.#added)
			toolset.tools.emitter.on('remove', this.#removed)
			toolset.tools.emitter.on('clear', this.#cleared)
			await toolset.start()
			return toolset
		} catch (error) {
			this.#unmirror()
			if (this.#browser === browser) this.#browser = undefined
			if (this.#profile === profile) this.#profile = undefined
			await toolset?.destroy().catch(() => undefined)
			await browser?.destroy().catch(() => undefined)
			await rm(profile, { recursive: true, force: true, maxRetries: 5 })
			throw error
		}
	}

	// Adds a dispatcher for a tool the toolset's manager added under a name outside the vocabulary.
	#mirror(tool: ToolInterface): void {
		if (this.#vocabulary.has(tool.name)) return
		this.#tools.add(
			createTool({ ...toolToDefinition(tool), execute: this.#forward.bind(this, tool.name) }),
		)
	}

	// Removes the dispatcher of a withdrawn tool; a replacement publishes `remove` while it is
	// installed, so the mirror follows the manager's current tool rather than the event.
	#withdraw(tool: ToolInterface): void {
		if (this.#vocabulary.has(tool.name)) return
		const current = this.#mirrored?.tool(tool.name)
		if (current === undefined) this.#tools.remove(tool.name)
		else this.#mirror(current)
	}

	#clear(tools: readonly ToolInterface[]): void {
		for (const tool of tools) this.#withdraw(tool)
	}

	#unmirror(): void {
		const mirrored = this.#mirrored
		if (mirrored === undefined) return
		this.#mirrored = undefined
		mirrored.emitter.off('add', this.#added)
		mirrored.emitter.off('remove', this.#removed)
		mirrored.emitter.off('clear', this.#cleared)
	}

	#ended(): BrowserError {
		return new BrowserError('the browser session ended', 'BROWSER_TOOLSET_ENDED')
	}
}
