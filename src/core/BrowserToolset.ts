import type {
	BrowserAction,
	BrowserHoldInterface,
	BrowserToolsetResult,
	BrowserCallOptions,
	BrowserContextInterface,
	BrowserDestination,
	BrowserDestinationRelationship,
	BrowserDialogInterface,
	BrowserElementInterface,
	BrowserFrameInterface,
	BrowserNavigationRecordInterface,
	BrowserPageInterface,
	BrowserReadingInterface,
	BrowserTool,
	BrowserToolName,
	BrowserToolSourceInterface,
	BrowserToolsetEventMap,
	BrowserToolsetHandler,
	BrowserToolsetInterface,
	BrowserToolsetOptions,
	BrowserToolsetReason,
	BrowserToolsetWatch,
	BrowserViewInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	ToolCall,
	ToolContext,
	ToolInterface,
	ToolManagerInterface,
	ToolResult,
} from '@orkestrel/tool'
import {
	cloneJSONRecord,
	isArray,
	isBoolean,
	isError,
	isFiniteNumber,
	isInteger,
	isRecord,
	isString,
} from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BrowserHold } from './BrowserHold.js'
import { createTool, createToolManager } from '@orkestrel/tool'
import {
	BROWSER_SCHEMES,
	BROWSER_TOOL_CAPTURE_MS,
	BROWSER_TOOL_CHANGED_NOTE,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_CUT_FOOTER,
	BROWSER_TOOL_DEADLINE_NOTE,
	BROWSER_TOOL_HANDLED_STATUS,
	BROWSER_TOOL_LIMIT,
	BROWSER_TOOL_NAMES,
	BROWSER_TOOL_NAME_PATTERN,
	BROWSER_TOOL_TIMEOUT_LIMIT_MS,
	BROWSER_TOOL_TIMEOUT_MS,
	BROWSER_TOOL_VIEW_FOOTER,
	BROWSER_TYPED_ROLES,
} from './constants.js'
import {
	BrowserElementError,
	BrowserError,
	isBrowserElementError,
	isBrowserError,
} from './errors.js'
import { compileSubmitObserverExpression, compileSubmitReadExpression } from './compilers.js'
import {
	boundBrowserText,
	deriveBrowserToolSchema,
	normalizeBrowserKey,
	readBrowserToolString,
	renderBrowserElement,
	renderBrowserReceipt,
	renderBrowserToolOutput,
	requireBrowserReference,
	validateBrowserToolArguments,
} from './helpers.js'

/**
 * Publishes the browser vocabulary as `@orkestrel/tool` tools over one view and adopts the
 * view's own tools beside them.
 *
 * @remarks
 * Every toolset advertises `look`, `read`, `click`, `type`, and `wait`, which need only the
 * `BrowserViewInterface` it is constructed over. With `options.page` it also advertises `press`
 * and `navigate`, stages the `dialog` tool while a dialog is open on the current page, follows a
 * popup the current page opens and returns to the opener when the popup closes, and adopts
 * `page.registry` by default; with `options.context` as well it advertises `tabs` and `switch`.
 * The next result names each move of the view.
 *
 * Every tool, the page tools included, runs through one boundary. The boundary refuses with
 * `the browser session ended` after `destroy()`, refuses an aborted signal before the tool runs,
 * refuses every tool but `dialog` while a dialog is open, forwards `ToolContext.signal` into every
 * protocol call, refuses a call to a toolset tool that carries a parameter the tool does not
 * advertise, and cuts every returned string and every thrown message at `limit` characters plus
 * a footer; the footer of a cut result that carries a view names `read` as the next call. `look`
 * and `read` read the page, never one element. A page tool's error message and JSON output reach
 * the toolset already cut at `BROWSER_REGISTRY_OUTPUT_LIMIT` (4 096) by the registry, so a
 * `limit` over that shows at most 4 096 characters of either; a page tool's text output reaches
 * the boundary whole.
 *
 * `click`, `type`, `press`, `navigate`, and `switch` are actions: one runs at a time, in call
 * order, and holds the queue until its receipt. A queued action whose signal aborts leaves
 * without sending anything. An action whose receipt returned while its command was still
 * pending, because a dialog opened or a navigation was requested, is awaited by the next action.
 * Every pending step is raced against the page's `dialog` event, so a dialog returns the receipt
 * that names it while the blocked command settles later without a second receipt. Before `click`
 * sends its input and before `type` edits the control, the action opens the page's navigation
 * record for the element's frame, and `press` opens one for the main frame. Before that, `click`
 * and `type` with `submit` install a `submit` observer in the isolated world of the element's
 * document, and `press` in every document one `page.frames()` call lists; an action whose input
 * document cannot be observed is refused with `BROWSER_TOOLSET_OBSERVE` before any input, and a
 * document `press` did not list is not observed. A navigation that starts in the input's frame or
 * an ancestor before the input settles is followed; when the input settles first, each observed
 * submission that kept its default action names its destination frame, and the receipt waits for
 * the navigation the record selects to commit and load under the receipt's deadline; a submission
 * every listener prevented adds no wait. When the reads name no surviving destination and no
 * navigation followed, the receipt's status is `BROWSER_TOOL_HANDLED_STATUS`, which names `wait` as
 * the next call, after a prevented submission, and `no form received the submission` when `type`
 * with `submit`, or a `press` of Enter that an input a form owns received, recorded none. The
 * page placement's `type` with `submit` ends its action with `and submitted the form` when a read
 * recorded a submission, or when the navigation the receipt settled names `formSubmissionGet` or
 * `formSubmissionPost` as its reason, whatever the read answered, and with `and pressed Enter`
 * otherwise. A `read`
 * at an offset at or past its retained reading's end restarts that reading at 0. A receipt that
 * waits for a requested navigation shares one `BROWSER_TOOL_TIMEOUT_MS` deadline between that
 * wait and its view capture, of which `BROWSER_TOOL_CAPTURE_MS` is reserved for the capture. The
 * deadline runs from the moment the receipt starts waiting, after any time the action spent
 * queued and after `navigate`'s own load wait; its timers end with the receipt, and settling the
 * receipt aborts the capture. A capture that the page's change makes stale waits for the page's
 * readiness and reads the view once more inside the same deadline, and reports
 * `BROWSER_TOOL_CHANGED_NOTE` when that read fails too. `type` refuses an element whose role is
 * not in `BROWSER_TYPED_ROLES` before it sends anything, naming `click` as the next call. A `click` on an element whose role is in `BROWSER_TYPED_ROLES`
 * adds `; call type with REF to enter text` to its receipt line. A click
 * or type over a view whose `trusted` is `false` ends its receipt line with ` (untrusted event)`.
 *
 * A page tool is skipped, with `skip` emitted, when its name is reserved, when the manager holds
 * its name under a tool the toolset did not add (checked again immediately before each addition),
 * when its name falls outside `BROWSER_TOOL_NAME_PATTERN`, when its parameters or, for a source
 * that supplies `tools()`, its selected registration declare `what` optional, or when that
 * registration is marked `debugging`. The selected registration is the main frame's, then the
 * earlier one. A page tool whose parameters require nothing advertises a required `what`, which
 * is stripped before the tool runs. Every adopted tool is advertised `untrusted`. `destroy()`
 * removes only the tools the manager still holds under the instances the toolset added, never
 * closes a page, and ends only what `options.release` hands over, calling it one time last.
 *
 * @example
 * ```ts
 * import { BrowserToolset } from '@orkestrel/browser'
 *
 * const toolset = new BrowserToolset(page, { page })
 * await toolset.start()
 * const result = await toolset.tools.execute({ id: '1', name: 'look', arguments: { what: 'cart' } })
 * await toolset.destroy()
 * ```
 */
export class BrowserToolset implements BrowserToolsetInterface {
	readonly #view: BrowserViewInterface
	readonly #origin: BrowserPageInterface | undefined
	readonly #tools: ToolManagerInterface
	readonly #source: BrowserToolSourceInterface | undefined
	readonly #context: BrowserContextInterface | undefined
	readonly #limit: number
	readonly #schemes: readonly string[]
	readonly #owned: (() => Promise<void> | void) | undefined
	readonly #emitter: Emitter<BrowserToolsetEventMap>
	readonly #lifetime = new AbortController()
	readonly #native: readonly ToolInterface[]
	readonly #dialogTool: ToolInterface | undefined
	readonly #contextTools: readonly ToolInterface[]
	readonly #added = new Set<ToolInterface>()
	readonly #adopted = new Map<string, ToolInterface>()
	readonly #watches = new Map<BrowserPageInterface, BrowserToolsetWatch>()
	readonly #dialogs = new Map<BrowserPageInterface, BrowserDialogInterface>()
	readonly #handlers = new WeakMap<
		ToolInterface,
		{ readonly handler: BrowserToolsetHandler; readonly clause: string }
	>()
	readonly #actions = new WeakMap<AbortSignal, Partial<BrowserAction>>()
	readonly #invocations = new WeakMap<
		ToolContext,
		{ readonly handler: BrowserToolsetHandler; readonly clause: string }
	>()
	readonly #faults = new WeakMap<BrowserToolsetResult, unknown>()
	#reservation: BrowserHoldInterface | undefined
	readonly #interrupts = new Map<PromiseWithResolvers<never>, string>()
	readonly #notes: string[] = []
	readonly #changeHandler = this.#handleChange.bind(this)
	readonly #removeHandler = this.#handleRemove.bind(this)
	readonly #clearHandler = this.#handleClear.bind(this)
	#page: BrowserPageInterface | undefined
	#following: BrowserToolSourceInterface | undefined
	#reading:
		| { readonly view: BrowserViewInterface; readonly reading: BrowserReadingInterface }
		| undefined
	#tail: Promise<void> = Promise.resolve()
	#pending: Promise<void> | undefined
	// Numbers each action, so the observer it installs answers only its own read and removal.
	#sequence = 0
	#navigating: BrowserPageInterface | undefined
	#generation = 0
	#started = false
	#starting: Promise<void> | undefined
	#destroying: Promise<void> | undefined

	constructor(view: BrowserViewInterface, options?: BrowserToolsetOptions) {
		const limit = options?.limit ?? BROWSER_TOOL_LIMIT
		if (!isInteger(limit) || limit < 1) {
			throw new BrowserError('Browser toolset limit must be a positive integer', undefined, {
				limit,
			})
		}
		if (options?.context !== undefined && options.page === undefined) {
			throw new BrowserError('Browser toolset context requires a page', 'BROWSER_TOOLSET_CONTEXT')
		}
		this.#view = view
		this.#origin = options?.page
		this.#page = options?.page
		this.#tools = options?.tools ?? createToolManager()
		this.#source = options?.source
		this.#context = options?.context
		this.#limit = limit
		this.#schemes = options?.schemes ?? BROWSER_SCHEMES
		this.#owned = options?.release
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
		const look = this.#create('look', this.#look.bind(this), BROWSER_TOOL_VIEW_FOOTER)
		const read = this.#create('read', this.#read.bind(this), BROWSER_TOOL_CUT_FOOTER)
		const click = this.#create('click', this.#click.bind(this), BROWSER_TOOL_VIEW_FOOTER)
		const type = this.#create('type', this.#type.bind(this), BROWSER_TOOL_VIEW_FOOTER)
		const wait = this.#create('wait', this.#wait.bind(this), BROWSER_TOOL_CUT_FOOTER)
		this.#native = Object.freeze(
			options?.page === undefined
				? [look, read, click, type, wait]
				: [
						look,
						read,
						click,
						type,
						this.#create('press', this.#press.bind(this), BROWSER_TOOL_VIEW_FOOTER),
						this.#create('navigate', this.#navigate.bind(this), BROWSER_TOOL_VIEW_FOOTER),
						wait,
					],
		)
		this.#dialogTool =
			options?.page === undefined
				? undefined
				: this.#create('dialog', this.#dialog.bind(this), BROWSER_TOOL_VIEW_FOOTER)
		this.#contextTools = Object.freeze(
			options?.context === undefined
				? []
				: [
						this.#create('tabs', this.#tabs.bind(this), BROWSER_TOOL_CUT_FOOTER),
						this.#create('switch', this.#switch.bind(this), BROWSER_TOOL_VIEW_FOOTER),
					],
		)
	}

	get emitter(): EmitterInterface<BrowserToolsetEventMap> {
		return this.#emitter
	}

	get tools(): ToolManagerInterface {
		return this.#tools
	}

	get native(): readonly ToolInterface[] {
		return this.#native
	}

	get view(): BrowserViewInterface {
		return this.#cursor
	}

	async perform(call: ToolCall, context?: ToolContext): Promise<BrowserToolsetResult> {
		const tool = this.#tools.tool(call.name)
		const entry =
			(context === undefined ? undefined : this.#invocations.get(context)) ??
			(tool === undefined ? undefined : this.#handlers.get(tool))
		if (entry === undefined || context?.signal.aborted === true)
			return { result: await this.#tools.execute(call, context) }
		const signal = AbortSignal.any([
			context?.signal ?? new AbortController().signal,
			this.#lifetime.signal,
		])
		const started = performance.now()
		const acting = !['look', 'read', 'tabs'].includes(call.name)
		let result: ToolResult
		let fault: unknown
		try {
			if (acting) {
				const secret = call.name === 'type' && call.arguments['secret'] === true
				this.#actions.set(signal, {
					action: call.name,
					arguments: cloneJSONRecord(
						Object.fromEntries(
							Object.entries(call.arguments).filter(([key]) => !secret || key !== 'text'),
						),
					),
					...(secret ? { secret: true } : {}),
				})
			}
			const value = await this.#execute(call.name, entry.clause, entry.handler, call.arguments, {
				...context,
				signal,
			})
			result = { id: call.id, name: call.name, success: true, value }
		} catch (error) {
			fault = error
			result = {
				id: call.id,
				name: call.name,
				success: false,
				error: isError(error) ? error.message : String(error),
			}
		}
		const state = this.#actions.get(signal)
		this.#actions.delete(signal)
		const action: BrowserAction | undefined =
			state?.arguments === undefined
				? undefined
				: {
						...state,
						action: call.name,
						arguments: state.arguments,
						outcome: result.success ? (state.outcome ?? 'done') : 'refused',
						receipt: result.success ? (state.receipt ?? String(result.value)) : result.error,
						elapsed: performance.now() - started,
					}
		const performed = { result, ...(action === undefined ? {} : { action }) }
		if (!result.success) this.#faults.set(performed, fault)
		if (action !== undefined) this.#emitter.emit('action', action)
		return performed
	}

	async hold(name: string, options?: BrowserCallOptions): Promise<BrowserHoldInterface> {
		this.#live()
		const signal = AbortSignal.any([
			options?.signal ?? new AbortController().signal,
			this.#lifetime.signal,
		])
		const turn = await this.#acquire(signal, false, false)
		try {
			signal.throwIfAborted()
			this.#admit('', undefined)
			const hold = new BrowserHold(name, this.#releaseHold.bind(this))
			this.#reservation = hold
			this.#emitter.emit('hold', name)
			return hold
		} finally {
			turn.resolve()
		}
	}

	start(options?: BrowserCallOptions): Promise<void> {
		if (this.#destroying !== undefined) return Promise.reject(this.#ended())
		if (this.#starting === undefined) {
			// The startup runs in a continuation, so the shared promise exists before any listener
			// the startup triggers can call `start()` again.
			const starting = Promise.resolve().then(this.#begin.bind(this, options))
			this.#starting = starting
			void starting.catch(this.#forget.bind(this, starting))
		}
		return this.#starting
	}

	destroy(): Promise<void> {
		this.#destroying ??= this.#teardown()
		return this.#destroying
	}

	get #cursor(): BrowserViewInterface {
		return this.#page ?? this.#view
	}

	#create(name: BrowserToolName, handler: BrowserToolsetHandler, clause: string): ToolInterface {
		const validated = this.#validate.bind(this, name, handler)
		const tool = createTool({
			...BROWSER_TOOL_COPY[name],
			execute: this.#dispatch.bind(this, name, validated, clause),
		})
		this.#handlers.set(tool, { handler: validated, clause })
		return tool
	}

	async #dispatch(
		name: string,
		handler: BrowserToolsetHandler,
		clause: string,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> {
		this.#live()
		context.signal.throwIfAborted()
		const invocation = { ...context }
		this.#invocations.set(invocation, { handler, clause })
		const performed = await this.perform({ id: '', name, arguments: args }, invocation)
		if (!performed.result.success)
			throw this.#faults.get(performed) ?? new BrowserError(performed.result.error)
		return performed.result.value
	}

	#admit(name: string, caller: unknown): void {
		const hold = this.#reservation
		if (
			hold !== undefined &&
			caller !== hold.token &&
			!['look', 'read', 'tabs', 'wait'].includes(name)
		)
			throw new BrowserError(
				`The toolset is replaying ${hold.name} until it finishes; call look.`,
				'BROWSER_TOOLSET_BUSY',
			)
	}

	#releaseHold(): void {
		const hold = this.#reservation
		this.#reservation = undefined
		if (hold !== undefined) this.#emitter.emit('release', hold.name)
	}

	// Refuses a parameter the tool does not advertise before its handler reads any argument.
	#validate(
		name: BrowserToolName,
		handler: BrowserToolsetHandler,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		validateBrowserToolArguments(BROWSER_TOOL_COPY[name], args)
		return handler(args, context)
	}

	// Every await is followed by a lifecycle check, so a `destroy()` that ran meanwhile leaves
	// nothing registered.
	async #begin(options?: BrowserCallOptions): Promise<void> {
		this.#live()
		const conflict = BROWSER_TOOL_NAMES.find((name) => {
			const held = this.#tools.tool(name)
			return held !== undefined && !this.#added.has(held)
		})
		if (conflict !== undefined) {
			throw new BrowserError(
				`The tool manager already holds a tool named ${conflict}, a name the browser toolset reserves`,
				'BROWSER_TOOLSET_RESERVED',
				{ name: conflict },
			)
		}
		const page = this.#page
		try {
			this.#listen(this.#source ?? page?.registry)
			if (this.#source === undefined && page !== undefined) await page.registry.start(options)
			this.#live()
			if (page !== undefined) await this.#watch(page)
			this.#live()
		} catch (error) {
			this.#listen(undefined)
			if (page !== undefined) await this.#unwatch(page)
			throw error
		}
		this.#tools.emitter.on('remove', this.#removeHandler)
		this.#tools.emitter.on('clear', this.#clearHandler)
		this.#started = true
		for (const tool of [...this.#native, ...this.#contextTools]) {
			this.#add(tool)
			this.#live()
		}
		this.#stage()
		await this.#adopt()
		this.#live()
	}

	// The one boundary every tool runs through; a handler returns its body and a footer the
	// boundary appends after cutting the body, and `clause` closes the footer of a cut body.
	async #execute(
		name: string,
		clause: string,
		handler: BrowserToolsetHandler,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<string> {
		if (this.#destroying !== undefined) throw this.#ended()
		const signal = context.signal
		try {
			signal.throwIfAborted()
			this.#admit(name, context.caller)
			const dialog = this.#page === undefined ? undefined : this.#dialogs.get(this.#page)
			if (dialog !== undefined && name !== 'dialog') {
				throw new BrowserError(
					renderBrowserReceipt({ action: '', dialog }),
					'BROWSER_TOOLSET_DIALOG',
				)
			}
			const [body, footer] = await handler(args, { ...context, signal })
			// A cancellation that lands while the handler finishes wins over its result.
			signal.throwIfAborted()
			const state = this.#actions.get(signal)
			if (state !== undefined)
				this.#actions.set(signal, {
					...state,
					receipt: boundBrowserText(body.split('\n\n')[0] ?? body, this.#limit, clause),
				})
			return `${boundBrowserText(`${this.#drain()}${body}`, this.#limit, clause)}${footer}`
		} catch (error) {
			if (context.signal.aborted && error === context.signal.reason) throw error
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT') {
				this.#actions.set(signal, { ...this.#actions.get(signal), outcome: 'interrupted' })
				return boundBrowserText(
					`${this.#drain()}${error.message}`,
					this.#limit,
					BROWSER_TOOL_CUT_FOOTER,
				)
			}
			const message = isError(error) ? error.message : String(error)
			if (message.length <= this.#limit) throw error
			throw new BrowserError(
				boundBrowserText(message, this.#limit, BROWSER_TOOL_CUT_FOOTER),
				isBrowserError(error) ? error.code : undefined,
				isBrowserError(error) ? error.context : undefined,
			)
		}
	}

	async #look(
		_args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		// The outline carries the signal, so an abort rejects with its own pending protocol
		// entry's reason rather than a toolset-level copy of it.
		const outline = await this.#race(this.#cursor.elements.outline({ signal: context.signal }), '')
		return [outline.text, '']
	}

	async #read(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const offset = args['offset'] ?? 0
		if (!isInteger(offset) || offset < 0) {
			throw new BrowserError(
				'The offset parameter must be a non-negative integer.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'offset' },
			)
		}
		const view = this.#cursor
		const retained = this.#reading
		let reading = retained?.reading
		// A continuation reuses the capture it continues; a changed view or a navigation recaptures.
		// The slice restarts at 0 after a recapture and at an offset at or past the retained
		// reading's end, so the footer shows the reset.
		if (
			offset === 0 ||
			retained === undefined ||
			reading === undefined ||
			retained.view !== view ||
			reading.stale
		) {
			reading = await this.#race(view.read({ signal: context.signal }), '', context.signal)
			this.#reading = { view, reading }
		}
		const start =
			reading === retained?.reading && offset < reading.markdown({ offset: 0, limit: 1 }).total
				? offset
				: 0
		// A move note shares the limit with the slice, so the continuation offset counts only the
		// reading characters this result carries.
		const note = boundBrowserText(
			this.#drain(),
			Math.max(1, this.#limit - 1),
			BROWSER_TOOL_CUT_FOOTER,
		)
		const room = this.#limit - note.length
		const slice =
			room < 1
				? { text: '', offset: start, total: reading.markdown({ offset: 0 }).total }
				: reading.markdown({ offset: start, limit: room })
		// A limit that cannot hold the next code point would never advance the continuation.
		if (note === '' && slice.text === '' && slice.offset < slice.total) {
			throw new BrowserError(
				`The read limit of ${this.#limit} characters cannot hold the next character at offset ${start}; raise the toolset limit.`,
				'BROWSER_TOOLSET_LIMIT',
				{ limit: this.#limit, offset: start },
			)
		}
		const end = slice.offset + slice.text.length
		const more = end < slice.total
		if (start === 0 && !more) return [`${note}${slice.text}`, '']
		return [
			`${note}${slice.text}`,
			`\n\n[characters ${start}–${end} of ${slice.total}${more ? `; call read with offset ${end} for more` : ''}]`,
		]
	}

	async #click(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const turn = await this.#acquire(context.signal)
		const observation = { token: (this.#sequence += 1), frames: new Set<BrowserFrameInterface>() }
		let record: BrowserNavigationRecordInterface | undefined
		try {
			const element = this.#element(args['ref'], context.signal)
			const action = BROWSER_TYPED_ROLES.has(element.role)
				? `Clicked ${renderBrowserElement(element)}; call type with ${element.reference} to enter text`
				: `Clicked ${renderBrowserElement(element)}`
			const page = this.#page
			if (page !== undefined) {
				const frame = this.#resolveFrame(page, element.reference)
				await this.#observe(
					await this.#locate(page, frame, context.signal),
					frame,
					observation,
					context.signal,
				)
				record = page.navigation.record(frame)
			}
			return [
				await this.#settle(
					element.click({ signal: context.signal }),
					action,
					context.signal,
					this.#view.trusted,
					record,
					observation,
				),
				'',
			]
		} finally {
			record?.destroy()
			try {
				await this.#unobserve(observation, context.signal)
			} finally {
				turn.resolve()
			}
		}
	}

	async #type(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const text = readBrowserToolString(args, 'text')
		const submit = args['submit']
		const secret = args['secret']
		if (secret !== undefined && !isBoolean(secret))
			throw new BrowserError(
				'The secret parameter must be a boolean.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'secret' },
			)
		if (submit !== undefined && !isBoolean(submit)) {
			throw new BrowserError(
				'The submit parameter must be a boolean.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'submit' },
			)
		}

		const turn = await this.#acquire(context.signal)
		const observation = { token: (this.#sequence += 1), frames: new Set<BrowserFrameInterface>() }
		let record: BrowserNavigationRecordInterface | undefined
		try {
			const element = this.#element(args['ref'], context.signal)
			// The role the latest capture recorded decides, so a control that takes no text is
			// refused before any protocol command reaches it.
			if (!BROWSER_TYPED_ROLES.has(element.role)) {
				throw new BrowserError(
					`Element ${renderBrowserElement(element)} takes no text; call click for ${/^[aeiou]/i.test(element.role) ? 'an' : 'a'} ${element.role}.`,
					'BROWSER_TOOLSET_ROLE',
					{ reference: element.reference, role: element.role },
				)
			}
			const chosen = `Selected ${secret === true ? 'a secret' : JSON.stringify(text)} in ${renderBrowserElement(element)} (programmatic)`
			const typed = `Typed ${secret === true ? 'a secret' : JSON.stringify(text)} into ${renderBrowserElement(element)}`
			// The observer and the record precede the edit, because the inserted text or the chosen
			// option can run a handler that submits the form.
			const page = this.#page
			if (page !== undefined) {
				const frame = this.#resolveFrame(page, element.reference)
				if (submit === true)
					await this.#observe(
						await this.#locate(page, frame, context.signal),
						frame,
						observation,
						context.signal,
					)
				record = page.navigation.record(frame)
			}
			// A combobox or listbox role names a select element or a text input with suggestions;
			// the receipt names the path taken, and a dialog mid-edit names the path attempted.
			const choosing = element.role === 'combobox' || element.role === 'listbox'
			const edit = choosing
				? this.#choose(element, text, context.signal)
				: element.fill(text, { signal: context.signal }).then(() => false)
			// The edit is the first input, so a navigation it starts wins the race as a click's does:
			// the unfinished edit stays the queue barrier, and no submission is sent through the
			// reference that navigation replaces.
			const attempted = choosing ? chosen : typed
			const started = record?.wait({ signal: context.signal }).then(
				() => undefined,
				() => new Promise<undefined>(() => undefined),
			)
			const selected = await this.#command(
				started === undefined ? edit : Promise.race([started, edit]),
				attempted,
				edit,
			)
			if (selected === undefined)
				return [
					await this.#settle(
						edit.then(() => undefined),
						attempted,
						context.signal,
						this.#view.trusted,
						record,
						observation,
					),
					'',
				]
			const action = selected ? chosen : typed
			if (submit !== true) {
				return [
					await this.#settle(Promise.resolve(), action, context.signal, this.#view.trusted, record),
					'',
				]
			}
			// The page placement submits with a trusted Enter, so its receipt names the submission
			// only when the observer recorded one; the DOM placement calls `requestSubmit()`.
			return [
				await this.#settle(
					element.submit({ signal: context.signal }),
					page === undefined ? `${action} and submitted the form` : `${action} and pressed Enter`,
					context.signal,
					this.#view.trusted,
					record,
					observation,
					page === undefined
						? undefined
						: { explicit: true, action: `${action} and submitted the form` },
				),
				'',
			]
		} finally {
			record?.destroy()
			try {
				await this.#unobserve(observation, context.signal)
			} finally {
				turn.resolve()
			}
		}
	}

	async #press(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const key = normalizeBrowserKey(readBrowserToolString(args, 'key'))
		const turn = await this.#acquire(context.signal)
		const observation = { token: (this.#sequence += 1), frames: new Set<BrowserFrameInterface>() }
		let record: BrowserNavigationRecordInterface | undefined
		try {
			const page = this.#paged()
			// The focused document receives the keys, so every document one census lists is observed,
			// and only the main frame's must install.
			const frames = await this.#race(page.frames(), '', context.signal)
			await this.#observe(frames, page.id, observation, context.signal)
			record = page.navigation.record(page.id)
			// The keyboard takes no signal and sends each release without one, so the signal is
			// checked before the first key goes down.
			context.signal.throwIfAborted()
			const action = `Pressed ${key}`
			return [
				await this.#settle(
					page.keyboard.press(key),
					action,
					context.signal,
					true,
					record,
					observation,
					key === 'Enter' ? { explicit: false, action } : undefined,
				),
				'',
			]
		} finally {
			record?.destroy()
			try {
				await this.#unobserve(observation, context.signal)
			} finally {
				turn.resolve()
			}
		}
	}

	async #navigate(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const url = readBrowserToolString(args, 'url')
		const parsed = URL.canParse(url) ? new URL(url) : undefined
		if (parsed === undefined) {
			throw new BrowserError(
				`Navigation refused: ${JSON.stringify(url)} is not an absolute URL.`,
				'BROWSER_TOOLSET_SCHEME',
				{ url },
			)
		}
		if (!this.#schemes.includes(parsed.protocol)) {
			throw new BrowserError(
				`Navigation refused: the ${parsed.protocol} scheme is not allowed; use ${this.#schemes.join(' or ')}.`,
				'BROWSER_TOOLSET_SCHEME',
				{ url },
			)
		}
		const turn = await this.#acquire(context.signal)
		const page = this.#paged()
		this.#navigating = page
		const record = page.navigation.record(page.id)
		try {
			// The page's load wait rejects with the signal's reason after its cleanup, so the
			// command stays the queue's barrier until that cleanup settles.
			const navigation = page.navigate(url, { condition: 'load', signal: context.signal })
			const result = await this.#command(navigation, `Navigating to ${url}`, navigation)
			const settled = await record.settle({ signal: context.signal, timeout: 0 })
			this.#actions.set(context.signal, {
				...this.#actions.get(context.signal),
				stage: 'loaded',
				...(settled?.reason === undefined ? {} : { reason: settled.reason }),
			})
			const action = `Navigated to ${result.url}`
			return [
				renderBrowserReceipt({ action, view: await this.#capture(action, context.signal) }),
				'',
			]
		} finally {
			if (this.#navigating === page) this.#navigating = undefined
			record.destroy()
			turn.resolve()
		}
	}

	async #wait(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const text = readBrowserToolString(args, 'text')
		const seconds = args['timeout']
		if (seconds !== undefined && (!isFiniteNumber(seconds) || seconds <= 0)) {
			throw new BrowserError(
				'The timeout parameter must be a positive number of seconds.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'timeout' },
			)
		}
		const timeout = Math.min(
			seconds === undefined ? BROWSER_TOOL_TIMEOUT_MS : Math.ceil(seconds * 1000),
			BROWSER_TOOL_TIMEOUT_LIMIT_MS,
		)
		const quoted = JSON.stringify(text)
		try {
			await this.#race(
				this.#cursor.wait(text, { timeout, signal: context.signal }),
				`Waited for ${quoted}`,
				context.signal,
			)
			return [`${quoted} is on the page.`, '']
		} catch (error) {
			if (
				!context.signal.aborted &&
				isBrowserError(error) &&
				error.code === 'BROWSER_WAIT_TIMEOUT'
			) {
				this.#actions.set(context.signal, {
					...this.#actions.get(context.signal),
					outcome: 'timeout',
				})
				return [`${quoted} did not appear within ${timeout / 1000} s.`, '']
			}
			throw error
		}
	}

	async #dialog(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const accept = args['accept']
		const text = args['text']
		if (!isBoolean(accept)) {
			throw new BrowserError(
				'The accept parameter must be a boolean.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'accept' },
			)
		}
		if (text !== undefined && !isString(text)) {
			throw new BrowserError('The text parameter must be a string.', 'BROWSER_TOOLSET_ARGUMENT', {
				key: 'text',
			})
		}
		const turn = await this.#acquire(context.signal, true)
		try {
			const page = this.#paged()
			const dialog = this.#dialogs.get(page)
			if (dialog === undefined) {
				throw new BrowserError('No dialog is open; call look.', 'BROWSER_TOOLSET_DIALOG')
			}
			context.signal.throwIfAborted()
			if (accept) await dialog.accept(text)
			else await dialog.dismiss()
			if (this.#dialogs.get(page) === dialog) this.#dialogs.delete(page)
			this.#stage()
			const action = `${accept ? 'Accepted' : 'Dismissed'} the ${dialog.category} dialog ${JSON.stringify(dialog.message)}`
			return [
				renderBrowserReceipt({ action, view: await this.#capture(action, context.signal) }),
				'',
			]
		} finally {
			turn.resolve()
		}
	}

	async #tabs(
		_args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const pages = this.#context?.pages() ?? []
		const lines = await this.#race(
			Promise.all(pages.map((page, index) => this.#tab(page, index, context.signal))),
			'',
			context.signal,
		)
		return [lines.join('\n'), '']
	}

	async #switch(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const tab = readBrowserToolString(args, 'tab')
		const turn = await this.#acquire(context.signal)
		try {
			const pages = this.#context?.pages() ?? []
			const match = /^t?([1-9]\d*)$/i.exec(tab.trim())
			const page = match === null ? undefined : pages[Number(match[1]) - 1]
			if (page === undefined) {
				throw new BrowserError(
					`Tab ${JSON.stringify(tab)} is not open; call tabs.`,
					'BROWSER_TOOLSET_TAB',
					{ tab },
				)
			}
			const action = `Switched to t${pages.indexOf(page) + 1} ${page.url}`
			this.#actions.set(context.signal, {
				...this.#actions.get(context.signal),
				tab: { url: page.url, title: await page.title({ signal: context.signal }) },
			})
			await this.#select(page)
			const front = page.send('Page.bringToFront', undefined, { signal: context.signal })
			await this.#command(front, action, front)
			return [
				renderBrowserReceipt({ action, view: await this.#capture(action, context.signal) }),
				'',
			]
		} finally {
			turn.resolve()
		}
	}

	async #invoke(
		tool: ToolInterface,
		synthetic: boolean,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const turn = await this.#acquire(context.signal)
		try {
			const input = synthetic
				? Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'what'))
				: args
			const command = Promise.resolve(tool.execute(input, context))
			const output = await this.#command(command, `Called ${tool.name}`, command, context.signal)
			return [renderBrowserToolOutput(output), '']
		} finally {
			turn.resolve()
		}
	}

	async #tab(page: BrowserPageInterface, index: number, signal: AbortSignal): Promise<string> {
		const title = await page
			.title({ signal, timeout: BROWSER_TOOL_TIMEOUT_MS })
			.catch((error: unknown) => {
				// A tab that does not answer its title keeps a line naming it.
				if (signal.aborted) throw error
				return ''
			})
		return `t${index + 1} ${JSON.stringify(title)} ${page.url}${page === this.#page ? ' (current)' : ''}`
	}

	async #choose(
		element: BrowserElementInterface,
		text: string,
		signal: AbortSignal,
	): Promise<boolean> {
		try {
			await element.select([text], { signal })
			return true
		} catch (error) {
			// The combobox role also names a text input with a suggestion list, which the select
			// function refuses and which takes typed text instead.
			if (!isBrowserError(error) || !error.message.includes('not a select control')) throw error
		}
		await element.fill(text, { signal })
		return false
	}

	#element(value: unknown, signal: AbortSignal): BrowserElementInterface {
		const reference = requireBrowserReference(value)
		const element = this.#cursor.elements.element(reference)
		if (element === undefined) {
			throw new BrowserElementError(
				reference,
				'UNKNOWN',
				'is not in the current view; call look for fresh refs',
			)
		}
		const frame = this.#page === undefined ? undefined : this.#resolveFrame(this.#page, reference)
		this.#actions.set(signal, {
			...this.#actions.get(signal),
			target: {
				role: element.role,
				name: element.name,
				reference: element.reference,
				...(frame === undefined ? {} : { frame }),
			},
		})
		return element
	}

	#paged(): BrowserPageInterface {
		if (this.#page === undefined) {
			throw new BrowserError('This view has no page', 'BROWSER_TOOLSET_PAGE')
		}
		return this.#page
	}

	// Waits for the action queue and for a command an earlier receipt left pending.
	async #acquire(
		signal: AbortSignal,
		answer = false,
		interruptible = !answer,
	): Promise<PromiseWithResolvers<void>> {
		const previous = this.#tail
		const turn = Promise.withResolvers<void>()
		this.#tail = previous.then(() => turn.promise)
		try {
			await this.#race(previous, '', signal, interruptible)
			const pending = this.#pending
			if (!answer && pending !== undefined) await this.#race(pending, '', signal, interruptible)
			if (!answer && this.#pending === pending) this.#pending = undefined
		} catch (error) {
			turn.resolve()
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT') {
				throw new BrowserError(error.message, 'BROWSER_TOOLSET_DIALOG')
			}
			throw error
		}
		return turn
	}

	// Races an action's command against the start of a navigation in its frame or an ancestor, then
	// bounds the settlement of the navigation the action started and the view capture by one
	// deadline, of which the capture keeps `BROWSER_TOOL_CAPTURE_MS` for itself. A command that settles
	// first leaves a form submission's navigation to start later, so the observation's reads name the
	// destinations the record also waits for under the same deadline. The record selects and follows
	// the navigation; this method holds no frame, session, loader, or request state. `enter` marks an
	// action that pressed Enter to submit: `explicit` when the model asked for the submission whatever
	// the Enter's target, and the `action` line that replaces the attempt when a read recorded a
	// submission, or when the settled navigation's reason names a form submission, which a form in a
	// document the observer does not cover can start; a navigation with another reason or none does
	// not prove one.
	async #settle(
		command: Promise<void>,
		action: string,
		signal: AbortSignal,
		trusted: boolean,
		record?: BrowserNavigationRecordInterface,
		observation?: { readonly token: number; readonly frames: Set<BrowserFrameInterface> },
		enter?: { readonly explicit: boolean; readonly action: string },
	): Promise<string> {
		let deadline: number | undefined
		try {
			// A wait that ends without a start leaves the command to decide the race.
			const started = record?.wait({ signal }).then(
				() => true,
				() => new Promise<boolean>(() => undefined),
			)
			const input = command.then(() => false)
			const first = await this.#command(
				started === undefined ? input : Promise.race([started, input]),
				action,
				command,
			)
			deadline = performance.now() + BROWSER_TOOL_TIMEOUT_MS
			const bound = deadline - BROWSER_TOOL_CAPTURE_MS
			if (first) this.#hold(command)
			const submissions =
				first || observation === undefined
					? { destinations: [], prevented: false, submitted: undefined, implicit: false }
					: await this.#readSubmissions(observation, action, signal, bound)
			const settled =
				record === undefined
					? undefined
					: await this.#race(
							record.settle({
								destinations: submissions.destinations,
								timeout: Math.max(0, bound - performance.now()),
								signal,
							}),
							action,
							signal,
						)
			signal.throwIfAborted()
			if (settled !== undefined)
				this.#actions.set(signal, {
					...this.#actions.get(signal),
					stage: settled.stage,
					...(settled.reason === undefined ? {} : { reason: settled.reason }),
				})
			// Without a surviving destination and a navigation, the observer names what became of the
			// submission: a listener handled it, or no form received the Enter the action asked for.
			const unmoved = settled === undefined && submissions.destinations.length === 0
			const status =
				settled?.stage === 'committed'
					? `the page is still loading ${settled.url}`
					: settled?.stage === 'requested'
						? `it requested ${settled.url} and the page did not change`
						: unmoved && submissions.prevented
							? BROWSER_TOOL_HANDLED_STATUS
							: unmoved &&
								  submissions.submitted === false &&
								  (enter?.explicit === true || (enter !== undefined && submissions.implicit))
								? 'no form received the submission'
								: undefined
			const line =
				enter !== undefined &&
				(submissions.submitted === true ||
					settled?.reason === 'formSubmissionGet' ||
					settled?.reason === 'formSubmissionPost')
					? enter.action
					: action
			return renderBrowserReceipt({
				action: line,
				trusted,
				...(status === undefined ? {} : { status }),
				view: await this.#capture(line, signal, deadline),
			})
		} finally {
			record?.destroy()
			if (observation !== undefined) await this.#unobserve(observation, signal, deadline)
		}
	}

	// Races a command that carries the signal itself; a dialog leaves it pending for the next
	// action to await.
	async #command<T>(
		step: Promise<T>,
		action: string,
		command: Promise<unknown>,
		signal?: AbortSignal,
	): Promise<T> {
		try {
			return await this.#race(step, action, signal)
		} catch (error) {
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT') this.#hold(command)
			throw error
		}
	}

	#hold(command: Promise<unknown>): void {
		this.#pending = command.then(
			() => undefined,
			() => undefined,
		)
	}

	// Returns the frame whose document receives an input on the referenced element: the frame the
	// element manager recorded for it, or the main frame.
	#resolveFrame(page: BrowserPageInterface, reference: string): string {
		return page.elements.element(reference)?.frame ?? page.id
	}

	// Lists the document of `frame` as one census lists it, whose isolated world the observer runs
	// in, or none.
	async #locate(
		page: BrowserPageInterface,
		frame: string,
		signal: AbortSignal,
	): Promise<readonly BrowserFrameInterface[]> {
		const frames = await this.#race(page.frames(), '', signal)
		return frames.filter((candidate) => candidate.id === frame)
	}

	// Installs the observer the action's token owns in each of `frames` concurrently; the action owns
	// a document from the moment its installation is sent, so every exit removes it. The document of
	// `required` receives the input and must install, or the action is refused before any input;
	// another document's failure leaves it unobserved.
	async #observe(
		frames: readonly BrowserFrameInterface[],
		required: string,
		observation: { readonly token: number; readonly frames: Set<BrowserFrameInterface> },
		signal: AbortSignal,
	): Promise<void> {
		const installs = frames.map((frame) => {
			observation.frames.add(frame)
			return this.#install(frame, observation.token, signal)
		})
		const installed = await this.#race(Promise.all(installs), '', signal)
		if (!frames.some((frame, index) => frame.id === required && installed[index] === true))
			throw new BrowserError(
				`The action was not sent: frame ${required}, which receives the input, could not be observed for a form submission; call look.`,
				'BROWSER_TOOLSET_OBSERVE',
				{ frame: required },
			)
	}

	async #install(
		frame: BrowserFrameInterface,
		token: number,
		signal: AbortSignal,
	): Promise<boolean> {
		try {
			await frame.evaluate(compileSubmitObserverExpression(token), { signal })
			return true
		} catch (error) {
			if (signal.aborted) throw error
			return false
		}
	}

	// Reads every document the action still owns within `bound` and returns the destination of each
	// surviving submission, whether a listener prevented one, and whether an Enter reached an input
	// a form owns. `submitted` is true when any read recorded a submission, false when every
	// document answered and none did, and undefined otherwise; a read that fails or runs out of time
	// adds nothing, because the record already holds any navigation the input started in its frame
	// or an ancestor.
	async #readSubmissions(
		observation: { readonly token: number; readonly frames: Set<BrowserFrameInterface> },
		action: string,
		signal: AbortSignal,
		bound: number,
	): Promise<{
		readonly destinations: readonly BrowserDestination[]
		readonly prevented: boolean
		readonly submitted: boolean | undefined
		readonly implicit: boolean
	}> {
		const reads = await Promise.all(
			[...observation.frames].map((frame) =>
				this.#readSubmission(frame, observation, action, signal, bound),
			),
		)
		const answered = reads.flatMap((read) => (read === undefined ? [] : [read]))
		return {
			destinations: answered.flatMap((read) => read.destinations),
			prevented: answered.some((read) => read.prevented),
			submitted: answered.some((read) => read.submitted)
				? true
				: answered.length > 0 && answered.length === reads.length
					? false
					: undefined,
			implicit: answered.some((read) => read.implicit),
		}
	}

	// Returns undefined for a read that failed, ran out of time, found no observer to read, or
	// answered a record whose members are not the read's types, which leaves the outcome unknown.
	async #readSubmission(
		frame: BrowserFrameInterface,
		observation: { readonly token: number; readonly frames: Set<BrowserFrameInterface> },
		action: string,
		signal: AbortSignal,
		bound: number,
	): Promise<
		| {
				readonly destinations: readonly BrowserDestination[]
				readonly prevented: boolean
				readonly submitted: boolean
				readonly implicit: boolean
		  }
		| undefined
	> {
		try {
			const read = await this.#bounded(
				frame.evaluate(compileSubmitReadExpression(observation.token), { signal }),
				bound,
				action,
				signal,
			)
			// A read that answered removed the observer, or found none to remove.
			if (read !== undefined) observation.frames.delete(frame)
			if (!isRecord(read)) return undefined
			const { destinations, prevented, submitted, implicit } = read
			if (
				!isArray(destinations) ||
				!destinations.every(isString) ||
				!isBoolean(prevented) ||
				!isBoolean(submitted) ||
				!isBoolean(implicit)
			)
				return undefined
			return {
				destinations: destinations
					.filter(
						(relationship): relationship is BrowserDestinationRelationship =>
							relationship === 'self' || relationship === 'parent' || relationship === 'top',
					)
					.map((relationship) => ({ frame: frame.id, relationship })),
				prevented,
				submitted,
				implicit,
			}
		} catch (error) {
			if (signal.aborted || (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT')) {
				throw error
			}
			return undefined
		}
	}

	// Sends the removal of every observer the action still owns, without the action's signal, and
	// awaits it within the receipt's remaining deadline, or `BROWSER_TOOL_CAPTURE_MS` before the receipt
	// started one, unless the action's signal aborts the wait with its reason. A JavaScript dialog
	// blocks every evaluation until it is answered, and an aborted action ends at once, so neither
	// waits for the removal to land. The token keeps a late removal
	// from touching a later action's observer, and a replaced document took its observer with it.
	async #unobserve(
		observation: { readonly token: number; readonly frames: Set<BrowserFrameInterface> },
		signal: AbortSignal,
		deadline?: number,
	): Promise<void> {
		const frames = [...observation.frames]
		observation.frames.clear()
		if (frames.length === 0) return
		const removal = Promise.allSettled(
			frames.map((frame) =>
				frame.evaluate(compileSubmitReadExpression(observation.token), {
					timeout: BROWSER_TOOL_CAPTURE_MS,
				}),
			),
		)
		if (signal.aborted || (this.#page !== undefined && this.#dialogs.has(this.#page))) return
		await this.#bounded(
			removal,
			deadline ?? performance.now() + BROWSER_TOOL_CAPTURE_MS,
			'',
			signal,
		).catch((error: unknown) => {
			if (signal.aborted) throw error
		})
	}

	// Settles with the step, or rejects with the receipt naming a dialog that opens on the view
	// first, or with the signal's reason.
	async #race<T>(
		step: Promise<T>,
		action: string,
		signal?: AbortSignal,
		interruptible = true,
	): Promise<T> {
		const interrupt = Promise.withResolvers<never>()
		const abort = signal === undefined ? undefined : this.#abandon.bind(this, interrupt, signal)
		if (interruptible) this.#interrupts.set(interrupt, action)
		if (abort !== undefined) signal?.addEventListener('abort', abort, { once: true })
		if (signal?.aborted === true) interrupt.reject(signal.reason)
		const dialog = this.#page === undefined ? undefined : this.#dialogs.get(this.#page)
		if (interruptible && dialog !== undefined) this.#interrupt(dialog)
		try {
			return await Promise.race([step, interrupt.promise])
		} finally {
			this.#interrupts.delete(interrupt)
			if (abort !== undefined) signal?.removeEventListener('abort', abort)
		}
	}

	#abandon(interrupt: PromiseWithResolvers<never>, signal: AbortSignal): void {
		interrupt.reject(signal.reason)
	}

	#interrupt(dialog: BrowserDialogInterface): void {
		for (const [interrupt, action] of this.#interrupts) {
			interrupt.reject(
				new BrowserError(renderBrowserReceipt({ action, dialog }), 'BROWSER_TOOLSET_RECEIPT'),
			)
		}
	}

	// Races a step against a deadline inside the dialog and abort race; the deadline's timer is
	// cleared whenever that race settles, whichever branch wins.
	async #bounded<T>(
		step: Promise<T>,
		deadline: number,
		action: string,
		signal?: AbortSignal,
	): Promise<T | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined
		const lapse = new Promise<undefined>((resolve) => {
			timer = setTimeout(resolve, Math.max(0, deadline - performance.now()), undefined)
		})
		try {
			return await this.#race(Promise.race([step, lapse]), action, signal)
		} finally {
			clearTimeout(timer)
		}
	}

	// Captures the view a receipt carries within the receipt's deadline; a capture that fails or
	// runs out of time is reported in the receipt, because the action it follows already
	// happened. An abort or a dialog still ends the receipt.
	async #capture(
		action: string,
		signal: AbortSignal,
		deadline = performance.now() + BROWSER_TOOL_TIMEOUT_MS,
	): Promise<string> {
		if (deadline - performance.now() < 1) return BROWSER_TOOL_DEADLINE_NOTE
		// The capture belongs to the receipt: settling the receipt aborts it, so no readiness wait
		// or protocol call outlives the receipt. The deadline alone ends the capture; the outline's
		// own timeout sits past it, so a capture that runs out always reports the deadline note.
		// The outline carries the caller's signal, so an abort rejects with its pending protocol
		// entry's reason.
		const receipt = new AbortController()
		const options = {
			signal: AbortSignal.any([signal, receipt.signal]),
			timeout: BROWSER_TOOL_TIMEOUT_MS,
		}
		try {
			const outline = await this.#bounded(this.#cursor.elements.outline(options), deadline, action)
			return outline === undefined ? BROWSER_TOOL_DEADLINE_NOTE : outline.text
		} catch (error) {
			if (signal.aborted || (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT')) {
				throw error
			}
			if (!isBrowserElementError(error) || error.context?.['reason'] !== 'GONE') {
				return `(The view could not be read: ${isError(error) ? error.message : String(error)}; call look.)`
			}
			// A navigation replaced the document mid-capture; the outline waits for the replacing
			// document's readiness before it reads once more, inside the same deadline.
			try {
				const outline = await this.#bounded(
					this.#cursor.elements.outline(options),
					deadline,
					action,
				)
				return outline === undefined ? BROWSER_TOOL_DEADLINE_NOTE : outline.text
			} catch (retry) {
				if (signal.aborted || (isBrowserError(retry) && retry.code === 'BROWSER_TOOLSET_RECEIPT')) {
					throw retry
				}
				return BROWSER_TOOL_CHANGED_NOTE
			}
		} finally {
			receipt.abort(new BrowserError('the receipt settled', 'BROWSER_TOOLSET_SETTLED'))
		}
	}

	// Returns the pending move notes as a block that leads the next result, and forgets them.
	#drain(): string {
		const notes = this.#notes.splice(0)
		return notes.length === 0 ? '' : `${notes.join(' ')}\n\n`
	}

	// A failed startup lets a later `start()` try again, unless `destroy()` ended the toolset.
	#forget(starting: Promise<void>): void {
		if (this.#starting === starting && this.#destroying === undefined) this.#starting = undefined
	}

	#live(): void {
		if (this.#destroying !== undefined) throw this.#ended()
	}

	#ended(): BrowserError {
		return new BrowserError('the browser session ended', 'BROWSER_TOOLSET_ENDED')
	}

	#current(generation: number, source: BrowserToolSourceInterface): boolean {
		return (
			generation === this.#generation &&
			this.#destroying === undefined &&
			source === this.#following
		)
	}

	#add(tool: ToolInterface): void {
		this.#added.add(tool)
		this.#tools.add(tool)
	}

	#withdraw(tool: ToolInterface): void {
		if (this.#tools.tool(tool.name) === tool) this.#tools.remove(tool.name)
		this.#added.delete(tool)
	}

	// Advertises `dialog` while the current page has an open dialog and the manager holds no other
	// tool under the name.
	#stage(): void {
		const staged = this.#dialogTool
		if (staged === undefined || !this.#started || this.#destroying !== undefined) return
		const open = this.#page !== undefined && this.#dialogs.has(this.#page)
		const held = this.#tools.tool('dialog')
		if (open && held === undefined) this.#add(staged)
		else if (!open && held === staged) this.#withdraw(staged)
	}

	#listen(source: BrowserToolSourceInterface | undefined): void {
		this.#following?.emitter.off('change', this.#changeHandler)
		this.#following = source
		source?.emitter.on('change', this.#changeHandler)
	}

	async #select(page: BrowserPageInterface, note?: string): Promise<void> {
		if (this.#destroying !== undefined) return
		this.#page = page
		this.#generation += 1
		if (note !== undefined) this.#notes.push(note)
		this.#stage()
		this.#emitter.emit('select', page)
		if (this.#source === undefined) {
			for (const tool of this.#adopted.values()) this.#withdraw(tool)
			this.#adopted.clear()
		}
		try {
			await this.#watch(page)
			if (this.#source === undefined && this.#page === page) {
				this.#listen(page.registry)
				await page.registry.start()
			}
		} catch {
			// A page that closes while the view moves to it refuses the subscriptions; its close
			// event returns the view.
			return
		}
		await this.#adopt()
	}

	// Re-checks the lifecycle, the generation, and the source after every synchronous emission,
	// because a manager or toolset listener can re-enter.
	async #adopt(): Promise<void> {
		const source = this.#following
		if (source === undefined || this.#destroying !== undefined || !this.#started) return
		this.#generation += 1
		const generation = this.#generation
		let adopted: readonly ToolInterface[]
		try {
			adopted = await source.adopt()
		} catch {
			// A source whose page closed refuses to project; the page tools of its last projection
			// stay until the next change or move replaces them.
			return
		}
		if (!this.#current(generation, source)) return
		const census = source.tools?.()
		const reasons = new Map<string, BrowserToolsetReason>()
		const kept = new Map<
			string,
			{ readonly tool: ToolInterface; readonly parameters: Readonly<Record<string, unknown>> }
		>()
		for (const name of (census ?? []).map((tool) => tool.name)) {
			const reason = reasons.has(name) ? undefined : this.#reason(name, census)
			if (reason !== undefined) reasons.set(name, reason)
		}
		for (const tool of adopted) {
			if (reasons.has(tool.name) || kept.has(tool.name)) continue
			const parameters = deriveBrowserToolSchema(tool.parameters)
			const reason =
				this.#reason(tool.name, census) ?? (parameters === undefined ? 'schema' : undefined)
			if (reason !== undefined) reasons.set(tool.name, reason)
			else if (parameters !== undefined) kept.set(tool.name, { tool, parameters })
		}
		for (const [name, tool] of [...this.#adopted]) {
			if (kept.has(name)) continue
			this.#adopted.delete(name)
			this.#withdraw(tool)
			if (!this.#current(generation, source)) return
		}
		for (const [name, { tool, parameters }] of kept) {
			const held = this.#tools.tool(name)
			if (held !== undefined && !this.#added.has(held)) {
				reasons.set(name, 'held')
				continue
			}
			const handler = this.#invoke.bind(this, tool, parameters !== tool.parameters)
			const wrapper = createTool({
				name,
				...(tool.title === undefined ? {} : { title: tool.title }),
				...(tool.description === undefined ? {} : { description: tool.description }),
				...(tool.summary === undefined ? {} : { summary: tool.summary }),
				parameters,
				annotations: { ...tool.annotations, untrusted: true },
				execute: this.#dispatch.bind(this, name, handler, BROWSER_TOOL_CUT_FOOTER),
			})
			this.#handlers.set(wrapper, {
				handler,
				clause: BROWSER_TOOL_CUT_FOOTER,
			})
			this.#adopted.set(name, wrapper)
			this.#add(wrapper)
			if (!this.#current(generation, source)) return
			this.#emitter.emit('adopt', wrapper)
			if (!this.#current(generation, source)) return
		}
		for (const [name, reason] of reasons) {
			this.#emitter.emit('skip', name, reason)
			if (!this.#current(generation, source)) return
		}
	}

	// Decides a skip by name, then by the registration the source selects for the name: the
	// current page's frame, then the earlier registration.
	#reason(
		name: string,
		census: readonly BrowserTool[] | undefined,
	): BrowserToolsetReason | undefined {
		if (BROWSER_TOOL_NAMES.some((reserved) => reserved === name)) return 'reserved'
		const held = this.#tools.tool(name)
		if (held !== undefined && !this.#added.has(held)) return 'held'
		if (!BROWSER_TOOL_NAME_PATTERN.test(name)) return 'pattern'
		const registrations = census?.filter((tool) => tool.name === name) ?? []
		const selected = registrations.find((tool) => tool.frame === this.#page?.id) ?? registrations[0]
		if (selected === undefined) return undefined
		if (deriveBrowserToolSchema(selected.schema) === undefined) return 'schema'
		if (selected.annotation.debugging === true) return 'debugging'
		return undefined
	}

	async #watch(page: BrowserPageInterface): Promise<void> {
		if (this.#watches.has(page)) return
		const watch: BrowserToolsetWatch = {
			dialog: this.#handleDialog.bind(this, page),
			popup: this.#handlePopup.bind(this, page),
			close: this.#handleClose.bind(this, page),
			closed: this.#handleClosed.bind(this, page),
		}
		this.#watches.set(page, watch)
		page.emitter.on('dialog', watch.dialog)
		page.emitter.on('popup', watch.popup)
		page.emitter.on('close', watch.close)
		await page.subscribe('Page.javascriptDialogClosed', watch.closed)
		// A watch removed while its subscriptions were landing releases what landed after.
		if (this.#watches.get(page) !== watch) await this.#release(page, watch)
	}

	async #unwatch(page: BrowserPageInterface): Promise<void> {
		const watch = this.#watches.get(page)
		if (watch === undefined) return
		this.#watches.delete(page)
		await this.#release(page, watch)
	}

	async #release(page: BrowserPageInterface, watch: BrowserToolsetWatch): Promise<void> {
		page.emitter.off('dialog', watch.dialog)
		page.emitter.off('popup', watch.popup)
		page.emitter.off('close', watch.close)
		await page.unsubscribe('Page.javascriptDialogClosed', watch.closed)
	}

	async #teardown(): Promise<void> {
		this.#reservation?.destroy()
		this.#generation += 1
		this.#lifetime.abort(this.#ended())
		this.#listen(undefined)
		for (const tool of [...this.#added]) this.#withdraw(tool)
		this.#tools.emitter.off('remove', this.#removeHandler)
		this.#tools.emitter.off('clear', this.#clearHandler)
		await Promise.all([...this.#watches.keys()].map((page) => this.#unwatch(page)))
		this.#dialogs.clear()
		this.#adopted.clear()
		this.#reading = undefined
		this.#emitter.destroy()
		await this.#owned?.()
	}

	#handleChange(): void {
		void this.#adopt()
	}

	#handleRemove(tool: ToolInterface): void {
		this.#added.delete(tool)
		if (this.#adopted.get(tool.name) === tool) this.#adopted.delete(tool.name)
	}

	#handleClear(tools: readonly ToolInterface[]): void {
		for (const tool of tools) this.#handleRemove(tool)
	}

	#handleDialog(page: BrowserPageInterface, dialog: BrowserDialogInterface): void {
		if (this.#navigating === page && dialog.category === 'beforeunload') {
			// `navigate` leaves the page at the model's request, so it answers the leave prompt; a
			// failed answer stages the dialog like any other.
			void dialog.accept().catch(this.#record.bind(this, page, dialog))
			return
		}
		this.#record(page, dialog)
	}

	#record(page: BrowserPageInterface, dialog: BrowserDialogInterface): void {
		this.#dialogs.set(page, dialog)
		if (page !== this.#page) return
		this.#stage()
		this.#interrupt(dialog)
	}

	#handleClosed(page: BrowserPageInterface): void {
		this.#dialogs.delete(page)
		if (page === this.#page) this.#stage()
	}

	#handlePopup(opener: BrowserPageInterface, popup: BrowserPageInterface): void {
		if (opener !== this.#page || popup.closed) return
		void this.#select(popup, `The view moved to a new tab: ${popup.url}.`)
	}

	#handleClose(page: BrowserPageInterface): void {
		void this.#unwatch(page)
		this.#dialogs.delete(page)
		const origin = this.#origin
		if (page !== this.#page || origin === undefined || page === origin) return
		const opener = page.opener
		const target = opener !== undefined && !opener.closed ? opener : origin
		void this.#select(target, `The tab ${page.url} closed; the view returned to ${target.url}.`)
	}
}
