import type {
	BrowserCallOptions,
	BrowserFrameInterface,
	BrowserInvocationResult,
	BrowserPageInterface,
	BrowserRegistryEventMap,
	BrowserRegistryInterface,
	BrowserRegistryOptions,
	BrowserRegistryPending,
	BrowserTool,
	CDPClientInterface,
	CDPHandler,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ToolAnnotations, ToolContext, ToolInterface } from '@orkestrel/tool'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createTool } from '@orkestrel/tool'
import { BrowserTransition } from './BrowserTransition.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_REGISTRY_ABSENT_CODE,
	BROWSER_REGISTRY_OUTPUT_LIMIT,
} from './constants.js'
import { BrowserError, isBrowserError } from './errors.js'
import {
	assertBrowserPage,
	renderBrowserToolOutput,
	deriveBrowserToolSchema,
	validateBrowserTimeout,
} from './helpers.js'
import {
	parseBrowserTool,
	parseBrowserRemoval,
	parseBrowserInvocation,
	parseBrowserInvocationResult,
} from './parsers.js'

/**
 * Mirrors the experimental WebMCP domain across a page's attached sessions.
 * @remarks The page owns the live session-to-frame map; protocol subscriptions use stable session ids.
 * @example
 * ```ts
 * const registry = page.registry
 * if (await registry.start()) {
 *   const tools = await registry.adopt()
 * }
 * ```
 */
export class BrowserRegistry implements BrowserRegistryInterface {
	readonly #page: BrowserPageInterface
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #frames: ReadonlyMap<string, string>
	readonly #emitter: Emitter<BrowserRegistryEventMap>
	readonly #tools = new Map<string, BrowserTool>()
	readonly #owners = new Map<string, string>()
	readonly #subscriptions = new Map<string, ReadonlyMap<string, CDPHandler>>()
	readonly #enabled = new Set<string>()
	readonly #enabling = new Map<string, Promise<boolean>>()
	readonly #pending = new Set<BrowserRegistryPending>()
	readonly #awaiting = new Set<BrowserRegistryPending>()
	readonly #identifiers = new Map<BrowserRegistryPending, string>()
	readonly #responses = new Map<string, Map<string, BrowserInvocationResult>>()
	readonly #starting = new BrowserTransition<boolean>()
	#destroying: Promise<void> | undefined
	readonly #sessionHandler = this.#attach.bind(this)
	readonly #navigateHandler = this.#navigate.bind(this)
	readonly #detachHandler = this.#invalidate.bind(this)

	constructor(
		page: BrowserPageInterface,
		client: CDPClientInterface,
		session: string,
		frames: ReadonlyMap<string, string> = new Map(),
		options?: BrowserRegistryOptions,
	) {
		this.#page = page
		this.#client = client
		this.#session = session
		this.#frames = frames
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
	}

	get emitter(): EmitterInterface<BrowserRegistryEventMap> {
		return this.#emitter
	}

	async start(options?: BrowserCallOptions): Promise<boolean> {
		this.#assert()
		options?.signal?.throwIfAborted()
		return await this.#starting.execute(() => this.#start(options))
	}

	tool(name: string, frame?: string): BrowserTool | undefined {
		if (frame !== undefined) return this.#tools.get(JSON.stringify([frame, name]))
		const main = this.#tools.get(JSON.stringify([this.#page.id, name]))
		return main ?? this.tools().find((tool) => tool.name === name)
	}

	tools(): readonly BrowserTool[] {
		return [...this.#tools.values()]
	}

	async adopt(): Promise<readonly ToolInterface[]> {
		this.#assert()
		const adopted: ToolInterface[] = []
		for (const tool of this.tools()) {
			if (this.tool(tool.name) !== tool) continue
			const parameters = deriveBrowserToolSchema(tool.schema)
			if (parameters === undefined) continue
			const annotations: ToolAnnotations = {
				untrusted: true,
				...(tool.annotation.readOnly === undefined ? {} : { pure: tool.annotation.readOnly }),
				...(tool.annotation.consequential === undefined
					? {}
					: { consequential: tool.annotation.consequential }),
			}
			adopted.push(
				createTool({
					name: tool.name,
					description: tool.description,
					parameters,
					annotations,
					execute: this.#executeAdopted.bind(this, tool, parameters !== tool.schema),
				}),
			)
		}
		return adopted
	}

	async execute(
		tool: BrowserTool,
		input: Readonly<Record<string, unknown>>,
		options?: BrowserCallOptions,
	): Promise<BrowserInvocationResult> {
		this.#assert()
		options?.signal?.throwIfAborted()
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const session = this.#owners.get(tool.frame)
		if (
			session === undefined ||
			!this.#enabled.has(session) ||
			this.tool(tool.name, tool.frame) === undefined
		) {
			throw new BrowserError('ARGUMENT', 'Browser tool is not registered in an enabled frame')
		}
		const deferred = Promise.withResolvers<BrowserInvocationResult>()
		const pending: BrowserRegistryPending = {
			frame: tool.frame,
			session,
			signal: options?.signal,
			controller: new AbortController(),
			timer: setTimeout(() => this.#expire(pending), timeout),
			resolve: deferred.resolve,
			reject: deferred.reject,
		}
		this.#pending.add(pending)
		pending.signal?.addEventListener('abort', () => this.#abort(pending), {
			once: true,
			signal: pending.controller.signal,
		})
		void this.#invoke(pending, tool, input, timeout)
		return await deferred.promise
	}

	destroy(): Promise<void> {
		this.#destroying ??= this.#destroy()
		return this.#destroying
	}

	#assert(): void {
		if (this.#destroying !== undefined)
			throw new BrowserError('CLOSED', 'Browser registry is destroyed')
		assertBrowserPage(this.#page, this.#client)
	}

	async #start(options?: BrowserCallOptions): Promise<boolean> {
		this.#page.emitter.on('session', this.#sessionHandler)
		this.#page.emitter.on('navigate', this.#navigateHandler)
		this.#page.emitter.on('detach', this.#detachHandler)
		try {
			if (!(await this.#enable(this.#session, options))) {
				this.#unwatch()
				return false
			}
			this.#assert()
			for (const session of this.#frames.keys()) {
				try {
					await this.#enable(session, options)
				} catch (error) {
					if (options?.signal?.aborted === true) throw error
					this.#invalidateSession(session)
				}
			}
			this.#assert()
			return true
		} catch (error) {
			this.#unwatch()
			throw error
		}
	}

	#unwatch(): void {
		this.#page.emitter.off('session', this.#sessionHandler)
		this.#page.emitter.off('navigate', this.#navigateHandler)
		this.#page.emitter.off('detach', this.#detachHandler)
	}

	async #enable(session: string, options?: BrowserCallOptions): Promise<boolean> {
		if (this.#destroying !== undefined)
			throw new BrowserError('CLOSED', 'Browser registry is destroyed')
		if (this.#enabled.has(session)) return true
		const active = this.#enabling.get(session)
		if (active !== undefined) return await active
		const subscriptions = new Map<string, CDPHandler>()
		subscriptions.set('WebMCP.toolsAdded', this.#add.bind(this, session))
		subscriptions.set('WebMCP.toolsRemoved', this.#remove.bind(this))
		subscriptions.set('WebMCP.toolInvoked', this.#invoked.bind(this))
		subscriptions.set('WebMCP.toolResponded', this.#respond.bind(this, session))
		subscriptions.set('Page.frameNavigated', this.#navigated.bind(this))
		subscriptions.set('Page.frameDetached', this.#detached.bind(this))
		this.#subscriptions.set(session, subscriptions)
		for (const [method, handler] of subscriptions) this.#client.subscribe(method, handler, session)
		const enabling = this.#activate(session, options)
		this.#enabling.set(session, enabling)
		try {
			return await enabling
		} finally {
			this.#enabling.delete(session)
		}
	}

	async #activate(session: string, options?: BrowserCallOptions): Promise<boolean> {
		try {
			await this.#client.send('WebMCP.enable', undefined, { ...options, session })
			this.#enabled.add(session)
			return true
		} catch (error) {
			this.#unsubscribe(session)
			this.#invalidateSession(session)
			if (
				isBrowserError(error) &&
				error.code === 'REMOTE' &&
				error.context?.['code'] === BROWSER_REGISTRY_ABSENT_CODE
			)
				return false
			throw error
		}
	}

	#invalidateSession(session: string): void {
		for (const [frame, owner] of this.#owners) if (owner === session) this.#invalidate(frame)
	}

	#unsubscribe(session: string): void {
		for (const [method, handler] of this.#subscriptions.get(session) ?? [])
			this.#client.unsubscribe(method, handler, session)
		this.#subscriptions.delete(session)
	}

	#attach(frame: BrowserFrameInterface): void {
		if (this.#destroying !== undefined || !this.#enabled.has(this.#session)) return
		for (const [session, id] of this.#frames) {
			if (id === frame.id) {
				void this.#enable(session).catch(() => this.#invalidate(frame.id))
				return
			}
		}
	}

	#navigate(_url: string, same: boolean): void {
		if (same) return
		for (const frame of new Set([...this.tools(), ...this.#pending].map((entry) => entry.frame)))
			this.#invalidate(frame)
	}

	#navigated(params: Readonly<Record<string, unknown>>): void {
		if (this.#page.closed || this.#destroying !== undefined) return
		const frame = params['frame']
		if (isRecord(frame) && isString(frame['id'])) this.#invalidate(frame['id'])
	}

	#detached(params: Readonly<Record<string, unknown>>): void {
		if (this.#page.closed || this.#destroying !== undefined) return
		if (isString(params['frameId'])) this.#invalidate(params['frameId'])
	}

	#invalidate(frame: string): void {
		let removed = false
		for (const [key, tool] of this.#tools) {
			if (tool.frame === frame) {
				this.#tools.delete(key)
				removed = true
			}
		}
		this.#owners.delete(frame)
		for (const pending of this.#pending) {
			if (pending.frame === frame)
				this.#reject(pending, new BrowserError('CLOSED', 'Browser tool frame was invalidated'))
		}
		if (removed) this.#emitter.emit('change')
	}

	#add(session: string, params: Readonly<Record<string, unknown>>): void {
		if (this.#page.closed || this.#destroying !== undefined) return
		if (!isArray(params['tools'])) return
		for (const value of params['tools']) {
			const tool = parseBrowserTool(value)
			if (tool === undefined) continue
			this.#tools.set(JSON.stringify([tool.frame, tool.name]), tool)
			this.#owners.set(tool.frame, session)
		}
		this.#emitter.emit('change')
	}

	#remove(params: Readonly<Record<string, unknown>>): void {
		if (this.#page.closed || this.#destroying !== undefined) return
		if (!isArray(params['tools'])) return
		for (const value of params['tools']) {
			const key = parseBrowserRemoval(value)
			if (key !== undefined) this.#tools.delete(JSON.stringify([key.frame, key.name]))
		}
		this.#emitter.emit('change')
	}

	#invoked(params: Readonly<Record<string, unknown>>): void {
		const invocation = parseBrowserInvocation(params)
		if (invocation !== undefined) this.#emitter.emit('invoke', invocation)
	}

	#respond(session: string, params: Readonly<Record<string, unknown>>): void {
		const result = parseBrowserInvocationResult(params)
		if (result === undefined) return
		const pending = [...this.#pending].find(
			(entry) => entry.session === session && this.#identifiers.get(entry) === result.id,
		)
		if (pending !== undefined) {
			this.#release(pending)
			pending.resolve(result)
		} else if ([...this.#awaiting].some((entry) => entry.session === session)) {
			const responses = this.#responses.get(session) ?? new Map<string, BrowserInvocationResult>()
			responses.set(result.id, result)
			this.#responses.set(session, responses)
		}
		this.#emitter.emit('respond', result)
	}

	async #invoke(
		pending: BrowserRegistryPending,
		tool: BrowserTool,
		input: Readonly<Record<string, unknown>>,
		timeout: number,
	): Promise<void> {
		this.#awaiting.add(pending)
		try {
			// Abort must not discard the reply: its id is needed to cancel the remote invocation.
			const reply = await this.#client.send(
				'WebMCP.invokeTool',
				{ frameId: tool.frame, toolName: tool.name, input },
				{ session: pending.session, timeout },
			)
			if (!isRecord(reply) || !isString(reply['invocationId']))
				throw new BrowserError('PROTOCOL', 'WebMCP invocation reply has no invocationId')
			const id = reply['invocationId']
			// A settled entry with a reply means the deadline or abort won the race; cancel remotely.
			if (pending.signal?.aborted === true || !this.#pending.has(pending)) {
				this.#abortInvocation(pending.session, id)
				return
			}
			this.#identifiers.set(pending, id)
			const result = this.#responses.get(pending.session)?.get(id)
			this.#responses.get(pending.session)?.delete(id)
			if (result !== undefined) {
				this.#release(pending)
				pending.resolve(result)
			}
		} catch (error) {
			this.#reject(pending, error)
		} finally {
			this.#awaiting.delete(pending)
			if (![...this.#awaiting].some((entry) => entry.session === pending.session))
				this.#responses.delete(pending.session)
		}
	}

	#expire(pending: BrowserRegistryPending): void {
		const id = this.#identifiers.get(pending)
		if (id !== undefined) this.#abortInvocation(pending.session, id)
		this.#reject(pending, new BrowserError('PROTOCOL', 'Browser tool invocation timed out'))
	}

	#abort(pending: BrowserRegistryPending): void {
		const id = this.#identifiers.get(pending)
		if (id !== undefined) this.#abortInvocation(pending.session, id)
		this.#reject(pending, pending.signal?.reason)
	}

	#abortInvocation(session: string, id: string): void {
		void this.#client
			.send('WebMCP.cancelInvocation', { invocationId: id }, { session })
			.catch(() => undefined)
	}

	#release(pending: BrowserRegistryPending): void {
		clearTimeout(pending.timer)
		pending.controller.abort()
		this.#pending.delete(pending)
		this.#identifiers.delete(pending)
	}

	#reject(pending: BrowserRegistryPending, error: unknown): void {
		if (!this.#pending.has(pending)) return
		this.#release(pending)
		pending.reject(error)
	}

	async #executeAdopted(
		tool: BrowserTool,
		synthetic: boolean,
		input: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<string> {
		const parameters = synthetic
			? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'purpose'))
			: input
		const result = await this.execute(tool, parameters, { signal: context.signal })
		if (result.status !== 'Completed')
			throw new BrowserError(
				'PROTOCOL',
				`Browser tool ${result.status}: ${result.error ?? 'No error description'}`.slice(
					0,
					BROWSER_REGISTRY_OUTPUT_LIMIT,
				),
			)
		return renderBrowserToolOutput(result.output)
	}

	async #destroy(): Promise<void> {
		this.#unwatch()
		for (const session of [...this.#subscriptions.keys()]) this.#unsubscribe(session)
		for (const pending of [...this.#pending])
			this.#reject(pending, new BrowserError('CLOSED', 'Browser registry is destroyed'))
		this.#tools.clear()
		this.#owners.clear()
		this.#responses.clear()
		await Promise.allSettled(this.#enabling.values())
		await Promise.allSettled(
			[...this.#enabled].map((session) =>
				this.#client.send('WebMCP.disable', undefined, { session }),
			),
		)
		this.#enabled.clear()
		this.#emitter.destroy()
	}
}
