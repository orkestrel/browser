// The WebMCP registry double: an in-memory implementation of the `ModelContext` WebIDL in the
// WebMCP specification source `index.bs` at revision 19fc56516057, member for member and nothing
// beyond it.
//
// It is a protocol-faithful boundary stub of a FOREIGN surface, which is the one substitution
// the test contract permits: the Chromium the browser project drives exposes no
// `document.modelContext`, so the platform object a registry client talks to does not exist to
// drive. It never stands in for any part of this package or of `@orkestrel/mcp`: the bridge a
// proof drives is the real one `createModelContext` returns, and what this file supplies is only
// the thing the browser does not.
//
// `ModelContextRegistry` therefore declares exactly the IDL's own operations and its three
// event-handler attributes, and inherits `EventTarget` for the `toolchange`, `toolactivated`, and
// `toolcancel` events. The recorders a proof reads registrations and live subscriptions through
// are NOT registry members: they sit on the fixture handle beside the registry, over the same
// state, so the object installed on the document stays the shape a user agent would install.

import type {
	WebMCPAnnotations,
	WebMCPExecuteHandler,
	WebMCPExecuteOptions,
	WebMCPRegisteredTool,
	WebMCPRegisterOptions,
	WebMCPRegistryInterface,
	WebMCPTool,
	WebMCPToolEvent,
	WebMCPToolsOptions,
} from '@orkestrel/mcp/browser'
import { attempt, isRecord, isString } from '@orkestrel/contract'

/** Matches a tool name the `registerTool` steps accept: 1 to 128 ASCII alphanumerics, `_`, `-`, `.`. */
export const MODEL_CONTEXT_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

/** Holds one tool definition the registry keeps under its name, as the `registerTool` steps build it. */
export interface ModelContextDefinition {
	/** The tool dictionary the caller handed `registerTool`. */
	readonly tool: WebMCPTool
	/** The registration options the caller handed `registerTool`, `undefined` when omitted. */
	readonly options: WebMCPRegisterOptions | undefined
	/** The serialized input schema, the empty string when the tool declares none. */
	readonly schema: string
	/** The annotations with the dictionary defaults applied, `undefined` when the tool declares none. */
	readonly annotations: Required<WebMCPAnnotations> | undefined
	/** The origins `exposedTo` named, serialized. */
	readonly exposed: readonly string[]
}

/** Names the shape a WebMCP `EventHandler` attribute holds: a handler function, or nothing. */
export type ModelContextEventHandler = ((event: Event) => unknown) | null

/** Holds the live state the fixture handle reads a registry back through. */
export interface ModelContextState {
	/** Every live definition, keyed by the tool name the registry keys registration on. */
	readonly tools: Map<string, ModelContextDefinition>
	/** Every registry listener subscribed and not yet removed, in subscription order. */
	readonly listeners: EventListenerOrEventListenerObject[]
}

/** Pairs the installed registry double with the recorders over its live state. */
export interface ModelContextFixtureInterface {
	/** The IDL-faithful registry installed as the document's `modelContext`. */
	readonly registry: ModelContextRegistry
	/** The origin the registry reports for its tools: the document's own. */
	readonly origin: string
	/** Every definition the registry holds, in registration order. */
	registrations(): readonly ModelContextDefinition[]
	/** Every registry listener subscribed and not yet removed, in subscription order. */
	listeners(): readonly EventListenerOrEventListenerObject[]
}

/** Transliterates the `ToolActivatedEventInit` and `ToolCancelEventInit` dictionaries. */
export interface ModelContextToolEventInit extends EventInit {
	readonly toolName?: string
}

/** Carries the name of the tool whose execution begins, as the IDL's activation event does. */
export class ToolActivatedEvent extends Event implements WebMCPToolEvent {
	readonly toolName: string

	constructor(type: string, options: ModelContextToolEventInit = {}) {
		super(type, options)
		this.toolName = options.toolName ?? ''
	}
}

/** Carries the name of the tool whose execution is cancelled, as the IDL's cancel event does. */
export class ToolCancelEvent extends Event implements WebMCPToolEvent {
	readonly toolName: string

	constructor(type: string, options: ModelContextToolEventInit = {}) {
		super(type, options)
		this.toolName = options.toolName ?? ''
	}
}

/**
 * Reports whether a URL's origin is potentially trustworthy, the test `exposedTo` and
 * `fromOrigins` entries must pass.
 *
 * @param value - The origin string a caller supplied
 * @returns The serialized origin, or `undefined` when the string does not parse or its origin is
 * not potentially trustworthy
 */
export function parseModelContextOrigin(value: string): string | undefined {
	const parsed = attempt(() => new URL(value))
	if (!parsed.success) return undefined
	const url = parsed.value
	const loopback =
		url.hostname === 'localhost' ||
		url.hostname.endsWith('.localhost') ||
		url.hostname === '[::1]' ||
		/^127(?:\.\d{1,3}){3}$/.test(url.hostname)
	const trustworthy =
		url.protocol === 'https:' || url.protocol === 'wss:' || url.protocol === 'file:' || loopback
	return trustworthy && url.origin !== 'null' ? url.origin : undefined
}

/** Implements the WebMCP `ModelContext` interface over an injected state record. */
export class ModelContextRegistry extends EventTarget implements WebMCPRegistryInterface {
	readonly #state: ModelContextState
	readonly #window: Window
	readonly #origin: string
	#changed: ModelContextEventHandler = null
	#activated: ModelContextEventHandler = null
	#cancelled: ModelContextEventHandler = null

	constructor(state: ModelContextState, host: Window, origin: string) {
		super()
		this.#state = state
		this.#window = host
		this.#origin = origin
	}

	/** Holds the `ontoolchange` event-handler attribute. */
	get ontoolchange(): ModelContextEventHandler {
		return this.#changed
	}

	set ontoolchange(handler: ModelContextEventHandler) {
		this.#replace('toolchange', this.#changed, handler)
		this.#changed = handler
	}

	/** Holds the `ontoolactivated` event-handler attribute. */
	get ontoolactivated(): ModelContextEventHandler {
		return this.#activated
	}

	set ontoolactivated(handler: ModelContextEventHandler) {
		this.#replace('toolactivated', this.#activated, handler)
		this.#activated = handler
	}

	/** Holds the `ontoolcancel` event-handler attribute. */
	get ontoolcancel(): ModelContextEventHandler {
		return this.#cancelled
	}

	set ontoolcancel(handler: ModelContextEventHandler) {
		this.#replace('toolcancel', this.#cancelled, handler)
		this.#cancelled = handler
	}

	// The subscription pair records into the injected state before delegating, because an
	// `EventTarget` publishes no way to read back what was subscribed.
	override addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean,
	): void {
		if (listener !== null) this.#state.listeners.push(listener)
		super.addEventListener(type, listener, options)
	}

	override removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: EventListenerOptions | boolean,
	): void {
		const index = listener === null ? -1 : this.#state.listeners.indexOf(listener)
		if (index !== -1) this.#state.listeners.splice(index, 1)
		super.removeEventListener(type, listener, options)
	}

	async registerTool(tool: WebMCPTool, options?: WebMCPRegisterOptions): Promise<void> {
		if (this.#state.tools.has(tool.name)) {
			throw new DOMException(`A tool named '${tool.name}' is registered`, 'InvalidStateError')
		}
		if (!MODEL_CONTEXT_NAME_PATTERN.test(tool.name)) {
			throw new DOMException(`The tool name '${tool.name}' is invalid`, 'InvalidStateError')
		}
		if (tool.description === '') {
			throw new DOMException('A tool description must not be empty', 'InvalidStateError')
		}
		let schema = ''
		if (tool.inputSchema !== undefined) {
			const serialized: unknown = JSON.stringify(tool.inputSchema)
			if (!isString(serialized)) throw new TypeError('The input schema does not serialize')
			schema = serialized
		}
		const signal = options?.signal
		if (signal?.aborted === true) throw signal.reason
		const exposed = (options?.exposedTo ?? []).map((origin) => parseModelContextOrigin(origin))
		if (exposed.includes(undefined)) {
			throw new DOMException('An exposedTo origin is not potentially trustworthy', 'SecurityError')
		}
		const annotations = tool.annotations
		this.#state.tools.set(tool.name, {
			tool,
			options,
			schema,
			annotations:
				annotations === undefined
					? undefined
					: {
							readOnlyHint: annotations.readOnlyHint ?? false,
							untrustedContentHint: annotations.untrustedContentHint ?? false,
							consequentialHint: annotations.consequentialHint ?? false,
							debugging: annotations.debugging ?? false,
						},
			exposed: exposed.flatMap((origin) => (origin === undefined ? [] : [origin])),
		})
		signal?.addEventListener('abort', this.#unregister.bind(this, tool.name), { once: true })
		// The draft queues the `toolchange` notification as a task, then queues another task that
		// resolves the registration, so a listener runs after this call returns and before the
		// returned promise settles.
		setTimeout(this.#notify.bind(this), 0)
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}

	async getTools(options?: WebMCPToolsOptions): Promise<readonly WebMCPRegisteredTool[]> {
		const origins = (options?.fromOrigins ?? []).map((origin) => parseModelContextOrigin(origin))
		if (origins.includes(undefined)) {
			throw new DOMException('A fromOrigins origin is not potentially trustworthy', 'SecurityError')
		}
		return [...this.#state.tools.values()]
			.map((definition) => this.#describe(definition))
			.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
	}

	async executeTool(
		tool: WebMCPRegisteredTool,
		input?: Readonly<Record<string, unknown>>,
		options?: WebMCPExecuteOptions,
	): Promise<string> {
		const expected = attempt(() => new URL(tool.origin).origin)
		if (!expected.success || expected.value === 'null') {
			throw new DOMException('The tool origin is not a tuple origin', 'NotSupportedError')
		}
		const serialized = JSON.stringify(input ?? {})
		const caller = options?.signal
		if (caller?.aborted === true) throw caller.reason
		const definition = this.#state.tools.get(tool.name)
		if (definition === undefined || expected.value !== this.#origin) {
			throw new DOMException(`No registered tool named '${tool.name}'`, 'UnknownError')
		}
		const parsed: unknown = JSON.parse(serialized)
		if (!isRecord(parsed)) throw new DOMException('The input is not an object', 'UnknownError')
		this.dispatchEvent(new ToolActivatedEvent('toolactivated', { toolName: tool.name }))
		const controller = new AbortController()
		const settled = Promise.withResolvers<string>()
		const release = new AbortController()
		caller?.addEventListener(
			'abort',
			() => {
				settled.reject(caller.reason)
				controller.abort(caller.reason)
				this.dispatchEvent(new ToolCancelEvent('toolcancel', { toolName: tool.name }))
			},
			{ signal: release.signal },
		)
		this.#run(definition.tool.execute, parsed, controller.signal).then(
			settled.resolve,
			settled.reject,
		)
		try {
			return await settled.promise
		} finally {
			release.abort()
		}
	}

	// Runs the imperative execute steps: the callback's value serialized, any failure an `UnknownError`.
	async #run(
		execute: WebMCPExecuteHandler,
		input: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
	): Promise<string> {
		const outcome = await Promise.resolve()
			.then(() => execute(input, { signal }))
			.then(
				(value) => ({ value }),
				() => undefined,
			)
		// Serializing the callback's value is part of completion: a value that does not serialize,
		// such as a `BigInt`, completes the execution unsuccessfully.
		const serialized = attempt((): unknown =>
			outcome === undefined ? undefined : JSON.stringify(outcome.value),
		)
		if (!serialized.success || !isString(serialized.value)) {
			throw new DOMException('The tool did not complete', 'UnknownError')
		}
		return serialized.value
	}

	#replace(
		type: string,
		previous: ModelContextEventHandler,
		handler: ModelContextEventHandler,
	): void {
		if (previous !== null) this.removeEventListener(type, previous)
		if (handler !== null) this.addEventListener(type, handler)
	}

	// Projects one definition onto the `RegisteredTool` dictionary `getTools` reports.
	#describe(definition: ModelContextDefinition): WebMCPRegisteredTool {
		const parsed: unknown = definition.schema === '' ? undefined : JSON.parse(definition.schema)
		return {
			name: definition.tool.name,
			title: definition.tool.title ?? '',
			description: definition.tool.description,
			window: this.#window,
			origin: this.#origin,
			...(isRecord(parsed) ? { inputSchema: parsed } : {}),
			...(definition.annotations === undefined ? {} : { annotations: definition.annotations }),
		}
	}

	#unregister(name: string): void {
		if (!this.#state.tools.delete(name)) return
		setTimeout(this.#notify.bind(this), 0)
	}

	#notify(): void {
		this.dispatchEvent(new Event('toolchange'))
	}
}

/**
 * Installs an IDL-faithful WebMCP registry on a document and returns it with its recorders.
 *
 * @remarks
 * The registry reports the document's window and origin for every tool, as `getTools` does for
 * tools registered in the caller's own document. Pass a document the proof owns, so no scenario
 * mutates the page the suite runs in.
 *
 * @param host - The document to install `modelContext` on; it needs a window
 * @returns The installed registry, its origin, and the recorders over its live state
 * @throws Thrown when the document has no window.
 */
export function installModelContext(host: Document): ModelContextFixtureInterface {
	const view = host.defaultView
	if (view === null) throw new Error('The registry double needs a document with a window')
	const state: ModelContextState = { tools: new Map(), listeners: [] }
	const origin = view.origin
	const registry = new ModelContextRegistry(state, view, origin)
	Object.defineProperty(host, 'modelContext', { value: registry, configurable: true })
	return {
		registry,
		origin,
		registrations(): readonly ModelContextDefinition[] {
			return [...state.tools.values()]
		},
		listeners(): readonly EventListenerOrEventListenerObject[] {
			return [...state.listeners]
		},
	}
}
