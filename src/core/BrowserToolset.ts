import type {
	BrowserCallOptions,
	BrowserContextInterface,
	BrowserDialogInterface,
	BrowserElementInterface,
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
import type { ToolContext, ToolInterface, ToolManagerInterface } from '@orkestrel/tool'
import {
	isBoolean,
	isError,
	isFiniteNumber,
	isInteger,
	isRecord,
	isString,
} from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createTool, createToolManager } from '@orkestrel/tool'
import {
	BROWSER_SCHEMES,
	BROWSER_TOOL_CAPTURE_MS,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_DEADLINE_NOTE,
	BROWSER_TOOL_LIMIT,
	BROWSER_TOOL_NAMES,
	BROWSER_TOOL_NAME_PATTERN,
	BROWSER_TOOL_TIMEOUT_LIMIT_MS,
	BROWSER_TOOL_TIMEOUT_MS,
} from './constants.js'
import { BrowserElementError, BrowserError, isBrowserError } from './errors.js'
import {
	boundBrowserText,
	deriveBrowserToolSchema,
	normalizeBrowserKey,
	readBrowserToolString,
	renderBrowserElement,
	renderBrowserReceipt,
	renderBrowserToolOutput,
	requireBrowserReference,
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
 * protocol call, and cuts every returned string and every thrown message at `limit` characters
 * plus a footer. A page tool's error message and JSON output reach the toolset already cut at
 * `BROWSER_REGISTRY_OUTPUT_LIMIT` (4 096) by the registry, so a `limit` over that shows at most
 * 4 096 characters of either; a page tool's text output reaches the boundary whole.
 *
 * `click`, `type`, `press`, `navigate`, and `switch` are actions: one runs at a time, in call
 * order, and holds the queue until its receipt. A queued action whose signal aborts leaves
 * without sending anything. An action whose receipt returned while its command was still
 * pending, because a dialog opened or a navigation was requested, is awaited by the next action.
 * Every pending step is raced against the page's `dialog` event, so a dialog returns the receipt
 * that names it while the blocked command settles later without a second receipt. A receipt that
 * waits for a requested navigation shares one `BROWSER_TOOL_TIMEOUT_MS` deadline between that
 * wait and its view capture, of which `BROWSER_TOOL_CAPTURE_MS` is reserved for the capture. The
 * deadline runs from the moment the receipt starts waiting, after any time the action spent
 * queued and after `navigate`'s own load wait; its timers end with the receipt, and settling the
 * receipt aborts the capture. A click or type over a view whose `trusted` is `false` ends its
 * receipt line with ` (untrusted event)`.
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
	readonly #interrupts = new Map<PromiseWithResolvers<never>, string>()
	readonly #notes: string[] = []
	readonly #changeHandler = this.#handleChange.bind(this)
	readonly #removeHandler = this.#handleRemove.bind(this)
	readonly #clearHandler = this.#handleClear.bind(this)
	#page: BrowserPageInterface | undefined
	#following: BrowserToolSourceInterface | undefined
	#reading:
		| {
				readonly view: BrowserViewInterface
				readonly reference: string | undefined
				readonly reading: BrowserReadingInterface
		  }
		| undefined
	#tail: Promise<void> = Promise.resolve()
	#pending: Promise<void> | undefined
	#requested = Promise.withResolvers<string>()
	#committed = Promise.withResolvers<string>()
	#loaded = Promise.withResolvers<string>()
	#loader: string | undefined
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
		const look = this.#create('look', this.#look.bind(this))
		const read = this.#create('read', this.#read.bind(this))
		const click = this.#create('click', this.#click.bind(this))
		const type = this.#create('type', this.#type.bind(this))
		const wait = this.#create('wait', this.#wait.bind(this))
		this.#native = Object.freeze(
			options?.page === undefined
				? [look, read, click, type, wait]
				: [
						look,
						read,
						click,
						type,
						this.#create('press', this.#press.bind(this)),
						this.#create('navigate', this.#navigate.bind(this)),
						wait,
					],
		)
		this.#dialogTool =
			options?.page === undefined ? undefined : this.#create('dialog', this.#dialog.bind(this))
		this.#contextTools = Object.freeze(
			options?.context === undefined
				? []
				: [
						this.#create('tabs', this.#tabs.bind(this)),
						this.#create('switch', this.#switch.bind(this)),
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

	#create(name: BrowserToolName, handler: BrowserToolsetHandler): ToolInterface {
		return createTool({
			...BROWSER_TOOL_COPY[name],
			execute: this.#execute.bind(this, name, handler),
		})
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
	// boundary appends after cutting the body.
	async #execute(
		name: string,
		handler: BrowserToolsetHandler,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<string> {
		if (this.#destroying !== undefined) throw this.#ended()
		const signal = AbortSignal.any([context.signal, this.#lifetime.signal])
		try {
			signal.throwIfAborted()
			const dialog = this.#page === undefined ? undefined : this.#dialogs.get(this.#page)
			if (dialog !== undefined && name !== 'dialog') {
				throw new BrowserError(
					renderBrowserReceipt({ action: '', dialog }),
					'BROWSER_TOOLSET_DIALOG',
				)
			}
			const [body, footer] = await handler(args, { ...context, signal })
			return `${boundBrowserText(`${this.#drain()}${body}`, this.#limit)}${footer}`
		} catch (error) {
			if (context.signal.aborted && error === context.signal.reason) throw error
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT') {
				return boundBrowserText(`${this.#drain()}${error.message}`, this.#limit)
			}
			const message = isError(error) ? error.message : String(error)
			if (message.length <= this.#limit) throw error
			throw new BrowserError(
				boundBrowserText(message, this.#limit),
				isBrowserError(error) ? error.code : undefined,
				isBrowserError(error) ? error.context : undefined,
			)
		}
	}

	async #look(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const within = args['ref'] === undefined ? undefined : requireBrowserReference(args['ref'])
		// The outline carries the signal, so an abort rejects with its own pending protocol
		// entry's reason rather than a toolset-level copy of it.
		const outline = await this.#race(
			this.#cursor.elements.outline({
				...(within === undefined ? {} : { within }),
				signal: context.signal,
			}),
			'',
		)
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
		const reference = args['ref'] === undefined ? undefined : requireBrowserReference(args['ref'])
		const view = this.#cursor
		const retained = this.#reading
		let reading = retained?.reading
		// A continuation reuses the capture it continues; a changed view, reference, or document
		// recaptures, and the slice restarts at 0 so the footer shows the reset.
		if (
			offset === 0 ||
			retained === undefined ||
			reading === undefined ||
			retained.view !== view ||
			retained.reference !== reference ||
			reading.stale
		) {
			reading = await this.#race(
				reference === undefined
					? view.read({ signal: context.signal })
					: this.#element(reference).read({ signal: context.signal }),
				'',
				context.signal,
			)
			this.#reading = { view, reference, reading }
		}
		const start = reading === retained?.reading ? offset : 0
		// A move note shares the limit with the slice, so the continuation offset counts only the
		// reading characters this result carries.
		const note = boundBrowserText(this.#drain(), Math.max(1, this.#limit - 1))
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
		if (offset === 0 && !more) return [`${note}${slice.text}`, '']
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
		try {
			const element = this.#element(args['ref'])
			const action = `Clicked ${renderBrowserElement(element)}`
			return [
				await this.#settle(
					element.click({ signal: context.signal }),
					action,
					context.signal,
					this.#view.trusted,
				),
				'',
			]
		} finally {
			turn.resolve()
		}
	}

	async #type(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const text = readBrowserToolString(args, 'text')
		const submit = args['submit']
		if (submit !== undefined && !isBoolean(submit)) {
			throw new BrowserError(
				'The submit parameter must be a boolean.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'submit' },
			)
		}

		const turn = await this.#acquire(context.signal)
		try {
			const element = this.#element(args['ref'])
			const chosen = `Selected ${JSON.stringify(text)} in ${renderBrowserElement(element)} (programmatic)`
			const typed = `Typed ${JSON.stringify(text)} into ${renderBrowserElement(element)}`
			// A combobox or listbox role names a select element or a text input with suggestions;
			// the receipt names the path taken, and a dialog mid-edit names the path attempted.
			const choosing = element.role === 'combobox' || element.role === 'listbox'
			const edit = choosing
				? this.#choose(element, text, context.signal)
				: element.fill(text, { signal: context.signal }).then(() => false)
			const selected = await this.#command(edit, choosing ? chosen : typed, edit)
			const action = selected ? chosen : typed
			if (submit !== true) {
				return [
					await this.#settle(Promise.resolve(), action, context.signal, this.#view.trusted),
					'',
				]
			}
			return [
				await this.#settle(
					element.submit({ signal: context.signal }),
					`${action} and submitted the form`,
					context.signal,
					this.#view.trusted,
				),
				'',
			]
		} finally {
			turn.resolve()
		}
	}

	async #press(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<readonly [string, string]> {
		const key = normalizeBrowserKey(readBrowserToolString(args, 'key'))
		const turn = await this.#acquire(context.signal)
		try {
			const page = this.#paged()
			// The keyboard takes no signal and sends each release without one, so the signal is
			// checked before the first key goes down.
			context.signal.throwIfAborted()
			return [
				await this.#settle(page.keyboard.press(key), `Pressed ${key}`, context.signal, true),
				'',
			]
		} finally {
			turn.resolve()
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
		try {
			// The page's load wait rejects with the signal's reason after its cleanup, so the
			// command stays the queue's barrier until that cleanup settles.
			const navigation = page.navigate(url, { condition: 'load', signal: context.signal })
			const result = await this.#command(navigation, `Navigating to ${url}`, navigation)
			const action = `Navigated to ${result.url}`
			return [
				renderBrowserReceipt({ action, view: await this.#capture(action, context.signal) }),
				'',
			]
		} finally {
			if (this.#navigating === page) this.#navigating = undefined
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
		const page = this.#paged()
		const dialog = this.#dialogs.get(page)
		if (dialog === undefined) {
			throw new BrowserError('No dialog is open; call look.', 'BROWSER_TOOLSET_DIALOG')
		}
		// The boundary checked the signal with no await since, and the answer takes no signal.
		if (accept) await dialog.accept(text)
		else await dialog.dismiss()
		if (this.#dialogs.get(page) === dialog) this.#dialogs.delete(page)
		this.#stage()
		const action = `${accept ? 'Accepted' : 'Dismissed'} the ${dialog.category} dialog ${JSON.stringify(dialog.message)}`
		return [renderBrowserReceipt({ action, view: await this.#capture(action, context.signal) }), '']
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
		const input = synthetic
			? Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'what'))
			: args
		const output = await this.#race(
			Promise.resolve(tool.execute(input, context)),
			`Called ${tool.name}`,
			context.signal,
		)
		return [renderBrowserToolOutput(output), '']
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

	#element(value: unknown): BrowserElementInterface {
		const reference = requireBrowserReference(value)
		const element = this.#cursor.elements.element(reference)
		if (element === undefined) {
			throw new BrowserElementError(reference, 'UNKNOWN', 'is not in the current view')
		}
		return element
	}

	#paged(): BrowserPageInterface {
		if (this.#page === undefined) {
			throw new BrowserError('This view has no page', 'BROWSER_TOOLSET_PAGE')
		}
		return this.#page
	}

	// Waits for the action queue and for a command an earlier receipt left pending.
	async #acquire(signal: AbortSignal): Promise<PromiseWithResolvers<void>> {
		const previous = this.#tail
		const turn = Promise.withResolvers<void>()
		this.#tail = previous.then(() => turn.promise)
		try {
			await this.#race(previous, '', signal)
			const pending = this.#pending
			if (pending !== undefined) await this.#race(pending, '', signal)
			if (this.#pending === pending) this.#pending = undefined
		} catch (error) {
			turn.resolve()
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT') {
				throw new BrowserError(error.message, 'BROWSER_TOOLSET_DIALOG')
			}
			throw error
		}
		this.#requested = Promise.withResolvers<string>()
		this.#committed = Promise.withResolvers<string>()
		this.#loaded = Promise.withResolvers<string>()
		this.#loader = undefined
		return turn
	}

	// Races an action's command against a requested main-frame navigation, then bounds the wait
	// for that navigation's commit and load and the view capture by one deadline, of which the
	// capture keeps `BROWSER_TOOL_CAPTURE_MS` for itself.
	async #settle(
		command: Promise<void>,
		action: string,
		signal: AbortSignal,
		trusted: boolean,
	): Promise<string> {
		const url = await this.#command(
			Promise.race([command.then(() => undefined), this.#requested.promise]),
			action,
			command,
		)
		if (url === undefined) {
			return renderBrowserReceipt({ action, trusted, view: await this.#capture(action, signal) })
		}
		this.#hold(command)
		const deadline = performance.now() + BROWSER_TOOL_TIMEOUT_MS
		const bound = deadline - BROWSER_TOOL_CAPTURE_MS
		const committed = await this.#bounded(this.#committed.promise, bound, action, signal)
		if (committed === undefined) {
			return renderBrowserReceipt({
				action,
				trusted,
				status: `it requested ${url} and the page did not change`,
				view: await this.#capture(action, signal, deadline),
			})
		}
		const loaded = await this.#bounded(this.#loaded.promise, bound, action, signal)
		return renderBrowserReceipt({
			action,
			trusted,
			...(loaded === undefined ? { status: `the page is still loading ${committed}` } : {}),
			view: await this.#capture(action, signal, deadline),
		})
	}

	// Races a command that carries the signal itself; a dialog leaves it pending for the next
	// action to await.
	async #command<T>(step: Promise<T>, action: string, command: Promise<unknown>): Promise<T> {
		try {
			return await this.#race(step, action)
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

	// Settles with the step, or rejects with the receipt naming a dialog that opens on the view
	// first, or with the signal's reason.
	async #race<T>(step: Promise<T>, action: string, signal?: AbortSignal): Promise<T> {
		const interrupt = Promise.withResolvers<never>()
		const abort = signal === undefined ? undefined : this.#abandon.bind(this, interrupt, signal)
		this.#interrupts.set(interrupt, action)
		if (abort !== undefined) signal?.addEventListener('abort', abort, { once: true })
		if (signal?.aborted === true) interrupt.reject(signal.reason)
		const dialog = this.#page === undefined ? undefined : this.#dialogs.get(this.#page)
		if (dialog !== undefined) this.#interrupt(dialog)
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
		// or protocol call outlives the receipt.
		const receipt = new AbortController()
		try {
			// The deadline alone ends the capture; the outline's own timeout sits past it, so a
			// capture that runs out always reports the deadline note. The outline carries the
			// caller's signal, so an abort rejects with its pending protocol entry's reason.
			const outline = await this.#bounded(
				this.#cursor.elements.outline({
					signal: AbortSignal.any([signal, receipt.signal]),
					timeout: BROWSER_TOOL_TIMEOUT_MS,
				}),
				deadline,
				action,
			)
			if (outline === undefined) return BROWSER_TOOL_DEADLINE_NOTE
			return outline.text
		} catch (error) {
			if (signal.aborted || (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_RECEIPT')) {
				throw error
			}
			return `(The view could not be read: ${isError(error) ? error.message : String(error)}; call look.)`
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
			const wrapper = createTool({
				name,
				...(tool.title === undefined ? {} : { title: tool.title }),
				...(tool.description === undefined ? {} : { description: tool.description }),
				...(tool.summary === undefined ? {} : { summary: tool.summary }),
				parameters,
				annotations: { ...tool.annotations, untrusted: true },
				execute: this.#execute.bind(
					this,
					name,
					this.#invoke.bind(this, tool, parameters !== tool.parameters),
				),
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
			requested: this.#handleRequested.bind(this, page),
			navigated: this.#handleNavigated.bind(this, page),
			lifecycle: this.#handleLifecycle.bind(this, page),
			closed: this.#handleClosed.bind(this, page),
		}
		this.#watches.set(page, watch)
		page.emitter.on('dialog', watch.dialog)
		page.emitter.on('popup', watch.popup)
		page.emitter.on('close', watch.close)
		await Promise.all([
			page.subscribe('Page.frameRequestedNavigation', watch.requested),
			page.subscribe('Page.frameNavigated', watch.navigated),
			page.subscribe('Page.lifecycleEvent', watch.lifecycle),
			page.subscribe('Page.javascriptDialogClosed', watch.closed),
		])
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
		await page.unsubscribe('Page.frameRequestedNavigation', watch.requested)
		await page.unsubscribe('Page.frameNavigated', watch.navigated)
		await page.unsubscribe('Page.lifecycleEvent', watch.lifecycle)
		await page.unsubscribe('Page.javascriptDialogClosed', watch.closed)
	}

	async #teardown(): Promise<void> {
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

	#handleRequested(page: BrowserPageInterface, params: Readonly<Record<string, unknown>>): void {
		if (page !== this.#page || params['frameId'] !== page.id || !isString(params['url'])) return
		this.#requested.resolve(params['url'])
	}

	#handleNavigated(page: BrowserPageInterface, params: Readonly<Record<string, unknown>>): void {
		const frame = params['frame']
		if (
			page !== this.#page ||
			!isRecord(frame) ||
			frame['id'] !== page.id ||
			!isString(frame['url']) ||
			!isString(frame['loaderId'])
		) {
			return
		}
		this.#loader = frame['loaderId']
		this.#committed.resolve(frame['url'])
	}

	#handleLifecycle(page: BrowserPageInterface, params: Readonly<Record<string, unknown>>): void {
		if (
			page !== this.#page ||
			params['frameId'] !== page.id ||
			params['name'] !== 'load' ||
			this.#loader === undefined ||
			params['loaderId'] !== this.#loader
		) {
			return
		}
		this.#loaded.resolve(this.#loader)
	}
}
