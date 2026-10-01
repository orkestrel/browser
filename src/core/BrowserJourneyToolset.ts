import type {
	BrowserJourney,
	BrowserJourneyEdit,
	BrowserJourneyOptions,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserJourneyTarget,
	BrowserJourneyToolsetInterface,
	BrowserRecorderInterface,
	BrowserRun,
	BrowserRunStoreInterface,
	BrowserToolName,
	BrowserToolsetInterface,
} from './types.js'
import type { ToolContext, ToolInterface } from '@orkestrel/tool'
import { attempt, isArray, isInteger, isRecord, isString } from '@orkestrel/contract'
import { createTool } from '@orkestrel/tool'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_IDLE_REFUSAL,
	BROWSER_JOURNEY_NAME_PATTERN,
	BROWSER_JOURNEY_READONLY_REFUSAL,
	BROWSER_JOURNEY_RECORDING_REFUSAL,
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
} from './constants.js'
import { BrowserElementError, BrowserError, isBrowserError } from './errors.js'
import { createBrowserRecorder, createBrowserReplay } from './factories.js'
import {
	editBrowserJourney,
	readBrowserToolString,
	renderBrowserJourney,
	renderBrowserRun,
	normalizeBrowserJourneyReason,
	renderBrowserJourneyFault,
	requireBrowserReference,
	validateBrowserToolArguments,
	validateBrowserJourneyEdit,
} from './helpers.js'

/**
 * Registers the journey tools `record`, `save`, `journeys`, `edit`, and `replay` over a toolset
 * and owns the recording and the active replay.
 *
 * @remarks
 * The journey toolset composes the toolset's public members: `perform` reads the view a receipt
 * carries through `look`, `hold` and `emitter` drive the recorder and the replay, `view` converts
 * an edit's `ref` to a target, and `tools` receives the five tools at construction, which refuses
 * with `BROWSER_TOOLSET_RESERVED` when the manager already holds one of the names. Every refusal
 * is a sentence that names the next call, and a reason inside it is a clause without a directive
 * or a final period.
 *
 * `readonly` refuses `record`, `save`, and `edit` before any store access; `replay` still writes
 * its run. The call's signal reaches every store call and every replayed step, and `destroy()`
 * aborts it as well. `save` writes a snapshot before it ends the recording, so a failed or
 * locked write keeps the recorder recording with its steps for the next
 * `save`. An empty snapshot refuses with `BROWSER_JOURNEY_EMPTY` and keeps recording.
 * `edit` accepts an array or its JSON string and names a parse error when the string is invalid.
 * `journeys` joins the listings with one blank line and cuts the result at `limit`
 * characters with a footer that names the next offset. `replay` returns the run's render followed
 * by the view after the run.
 *
 * `destroy()` aborts the active replay and waits for it to finish, stops a recording without
 * saving it, and removes the five tools the manager still holds under the instances it added.
 *
 * @example
 * ```ts
 * import { BrowserJourneyToolset, createMemoryBrowserJourneyStore } from '@orkestrel/browser'
 *
 * const journeys = new BrowserJourneyToolset(toolset, { store: createMemoryBrowserJourneyStore() })
 * await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'add-kettle' } })
 * await journeys.destroy()
 * ```
 */
export class BrowserJourneyToolset implements BrowserJourneyToolsetInterface {
	readonly #toolset: BrowserToolsetInterface
	readonly #store: BrowserJourneyStoreInterface
	readonly #runs: BrowserRunStoreInterface | undefined
	readonly #readonly: boolean
	readonly #limit: number
	readonly #lifetime = new AbortController()
	readonly #tools: readonly ToolInterface[]
	#recorder: BrowserRecorderInterface | undefined
	#recording: string | undefined
	#saved: string | undefined
	#replaying: string | undefined
	#replay: Promise<void> | undefined
	#destroying: Promise<void> | undefined

	constructor(toolset: BrowserToolsetInterface, options: BrowserJourneyOptions) {
		const limit = options.limit ?? toolset.limit
		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new BrowserError(
				'The journeys limit must be a positive integer',
				'BROWSER_JOURNEY_ARGUMENT',
				{
					limit,
				},
			)
		}
		const held = BROWSER_JOURNEY_TOOL_NAMES.find((name) => toolset.tools.tool(name) !== undefined)
		if (held !== undefined) {
			throw new BrowserError(
				`The tool manager already holds a tool named ${held}, a name the browser toolset reserves`,
				'BROWSER_TOOLSET_RESERVED',
				{ name: held },
			)
		}
		this.#toolset = toolset
		this.#store = options.store
		this.#runs = options.runs
		this.#readonly = options.readonly === true
		this.#limit = limit
		this.#tools = Object.freeze([
			this.#create('record', this.#record.bind(this)),
			this.#create('save', this.#save.bind(this)),
			this.#create('journeys', this.#journeys.bind(this)),
			this.#create('edit', this.#edit.bind(this)),
			this.#create('replay', this.#replayJourney.bind(this)),
		])
		toolset.tools.add(this.#tools)
	}

	get recording(): string | undefined {
		return this.#recording
	}

	get replaying(): string | undefined {
		return this.#replaying
	}

	destroy(): Promise<void> {
		this.#destroying ??= this.#teardown()
		return this.#destroying
	}

	#create(
		name: BrowserToolName,
		handler: (args: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<string>,
	): ToolInterface {
		return createTool({
			...BROWSER_TOOL_COPY[name],
			execute: this.#execute.bind(this, name, handler),
		})
	}

	// The one boundary every journey tool runs through: the lifecycle check, the advertised
	// parameters, and a signal that `destroy()` also aborts.
	async #execute(
		name: BrowserToolName,
		handler: (args: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<string>,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<string> {
		if (this.#destroying !== undefined) throw this.#ended()
		validateBrowserToolArguments(BROWSER_TOOL_COPY[name], args)
		const signal = AbortSignal.any([context.signal, this.#lifetime.signal])
		signal.throwIfAborted()
		return handler(args, signal)
	}

	async #record(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		if (this.#readonly)
			throw new BrowserError(BROWSER_JOURNEY_READONLY_REFUSAL, 'BROWSER_JOURNEY_READONLY')
		this.#idleReplay()
		const name = readBrowserToolString(args, 'journey')
		if (this.#recording !== undefined)
			throw new BrowserError(BROWSER_JOURNEY_RECORDING_REFUSAL, 'BROWSER_JOURNEY_RECORDING')
		if (!BROWSER_JOURNEY_NAME_PATTERN.test(name)) {
			throw new BrowserError(
				`${JSON.stringify(name)} is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`,
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'journey' },
			)
		}
		this.#recording = name
		let recorder: BrowserRecorderInterface | undefined
		try {
			if ((await this.#read(name, signal)) !== undefined) {
				throw new BrowserError(
					`Journey ${JSON.stringify(name)} is saved already and nothing is recording; call journeys to list it, edit to change it, or replay to run it.`,
					'BROWSER_JOURNEY_SAVED',
					{ name },
				)
			}
			this.#idleReplay()
			signal.throwIfAborted()
			if (this.#destroying !== undefined) throw this.#ended()
			recorder = createBrowserRecorder(this.#toolset)
			await recorder.start()
			signal.throwIfAborted()
			if (this.#destroying !== undefined) throw this.#ended()
			this.#recorder = recorder
		} catch (error) {
			this.#recording = undefined
			await recorder?.destroy()
			throw error
		}
		return `Recording ${name}; each action you take is a step; call save when it is done.\n\n${await this.#view(signal)}`
	}

	async #save(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		if (this.#readonly)
			throw new BrowserError(BROWSER_JOURNEY_READONLY_REFUSAL, 'BROWSER_JOURNEY_READONLY')
		const description = readBrowserToolString(args, 'description')
		const recorder = this.#recorder
		const name = this.#recording
		if (recorder === undefined || name === undefined)
			throw new BrowserError(
				this.#saved === undefined
					? BROWSER_JOURNEY_IDLE_REFUSAL
					: `Nothing is recording; ${JSON.stringify(this.#saved)} was saved. Call journeys, edit, or replay.`,
				'BROWSER_JOURNEY_RECORDING',
			)
		const snapshot = attempt(() => recorder.journey({ name, description }))
		if (!snapshot.success) {
			if (
				isBrowserError(snapshot.error) &&
				snapshot.error.code === 'BROWSER_JOURNEY_INVALID' &&
				snapshot.error.context?.['field'] === 'steps'
			)
				throw new BrowserError(
					`Nothing is recorded for ${name}; perform an action, then call save.`,
					'BROWSER_JOURNEY_EMPTY',
					{ name },
				)
			throw snapshot.error
		}
		let saved: BrowserJourneyRevision
		try {
			saved = await this.#store.set(snapshot.value, 0, { signal })
		} catch (error) {
			if (signal.aborted) throw error
			if (isBrowserError(error) && error.code === 'BROWSER_JOURNEY_STALE')
				throw new BrowserError(
					`A journey named "${name}" is saved; call journeys, or record another name.`,
					error.code,
					{ name },
				)
			if (isBrowserError(error) && error.code === 'BROWSER_JOURNEY_LOCKED')
				throw new BrowserError(`Journey ${name} is locked; call save again.`, error.code, { name })
			throw new BrowserError(
				`Saving ${name} failed: ${normalizeBrowserJourneyReason(error)}; call save again.`,
				isBrowserError(error) ? error.code : 'BROWSER_JOURNEY_FILE',
				{ name },
			)
		}
		this.#saved = name
		if (this.#recorder === recorder) {
			this.#recorder = undefined
			this.#recording = undefined
		}
		await recorder.destroy()
		const count = saved.journey.steps.length
		return `Saved ${name} with ${count} ${count === 1 ? 'step' : 'steps'}.\n\n${renderBrowserJourney(saved.journey)}`
	}

	async #journeys(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		const offset = args['offset'] ?? 0
		if (!isInteger(offset) || offset < 0) {
			throw new BrowserError(
				'The offset parameter must be a non-negative integer.',
				'BROWSER_JOURNEY_ARGUMENT',
				{ key: 'offset' },
			)
		}
		const listings: string[] = []
		const faults = new Set<string>()
		let position = 0
		for (;;) {
			const page = await this.#store.list({ signal, offset: position })
			listings.push(...page.entries.map((entry) => renderBrowserJourney(entry.journey)))
			// File stores can report the same unreadable path on successive pages.
			for (const fault of page.faults) {
				if (faults.has(fault.name)) continue
				faults.add(fault.name)
				listings.push(renderBrowserJourneyFault(fault))
			}
			const span = page.entries.length
			position += span
			if (!page.truncated || span === 0) break
		}
		if (listings.length === 0) return BROWSER_JOURNEY_EMPTY_LISTING
		const listing = listings.join('\n\n')
		const start = offset < listing.length ? offset : 0
		let end = Math.min(listing.length, start + this.#limit)
		const last = listing.charCodeAt(end - 1)
		if (end < listing.length && last >= 0xd800 && last <= 0xdbff) end -= 1
		// A limit that cannot hold the next code point would never advance the continuation.
		if (end === start) {
			throw new BrowserError(
				`The journeys limit of ${this.#limit} characters cannot hold the next character at offset ${start}; raise the journeys limit.`,
				'BROWSER_TOOLSET_LIMIT',
				{ limit: this.#limit, offset: start },
			)
		}
		const text = listing.slice(start, end)
		if (start === 0 && end === listing.length) return text
		return `${text}\n\n[characters ${start}–${end} of ${listing.length}${end < listing.length ? `; call journeys with offset ${end} for more` : ''}]`
	}

	async #edit(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		if (this.#readonly)
			throw new BrowserError(BROWSER_JOURNEY_READONLY_REFUSAL, 'BROWSER_JOURNEY_READONLY')
		const name = readBrowserToolString(args, 'journey')
		let requests = args['edits']
		if (isString(requests)) {
			const text = requests
			const parsed = attempt<unknown>(() => JSON.parse(text))
			if (!parsed.success)
				throw new BrowserError(
					`The edits parameter is not valid JSON: ${normalizeBrowserJourneyReason(parsed.error)}; pass an array or a JSON string of the array.`,
					'BROWSER_TOOLSET_ARGUMENT',
					{ key: 'edits' },
				)
			requests = parsed.value
		}
		if (!isArray(requests)) {
			throw new BrowserError(
				'The edits parameter must be an array or a JSON string of the array.',
				'BROWSER_TOOLSET_ARGUMENT',
				{
					key: 'edits',
				},
			)
		}
		const revision = await this.#find(name, signal)
		const edits = requests.map((request, index) => this.#convert(request, index + 1))
		let edited: BrowserJourney
		try {
			edited = editBrowserJourney(revision.journey, edits)
		} catch (error) {
			if (!isBrowserError(error) || error.code !== 'BROWSER_JOURNEY_EDIT') throw error
			throw new BrowserError(`${error.message}; call journeys.`, error.code, error.context)
		}
		let saved: BrowserJourneyRevision
		try {
			saved = await this.#store.set(edited, revision.revision, { signal })
		} catch (error) {
			if (signal.aborted) throw error
			const code = isBrowserError(error) ? error.code : 'BROWSER_JOURNEY_FILE'
			if (code === 'BROWSER_JOURNEY_STALE')
				throw new BrowserError(
					`Journey ${name} changed since you read it; call journeys, then edit again.`,
					code,
					{ name },
				)
			if (code === 'BROWSER_JOURNEY_LOCKED')
				throw new BrowserError(`Journey ${name} is locked; call edit again.`, code, { name })
			throw new BrowserError(
				`Editing ${name} failed: ${normalizeBrowserJourneyReason(error)}; call edit again.`,
				code,
				{ name },
			)
		}
		return `Edited ${name}.\n\n${renderBrowserJourney(saved.journey)}`
	}

	async #replayJourney(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
	): Promise<string> {
		const name = readBrowserToolString(args, 'journey')
		const inputs: Record<string, string> = {}
		const given = args['inputs'] ?? {}
		if (!isRecord(given) || !Object.values(given).every(isString)) {
			throw new BrowserError(
				'The inputs parameter must be an object of strings.',
				'BROWSER_TOOLSET_ARGUMENT',
				{ key: 'inputs' },
			)
		}
		for (const [key, value] of Object.entries(given)) if (isString(value)) inputs[key] = value
		if (this.#recording !== undefined) {
			throw new BrowserError(
				`Journey ${this.#recording} is recording; call save before you replay another.`,
				'BROWSER_JOURNEY_RECORDING',
				{ name: this.#recording },
			)
		}
		this.#idleReplay()
		// The replay claims the toolset before its first await, so a second `replay` is refused
		// rather than queued behind it.
		this.#replaying = name
		const finished = Promise.withResolvers<void>()
		this.#replay = finished.promise
		try {
			const revision = await this.#find(name, signal)
			let run: BrowserRun
			try {
				run = await createBrowserReplay(this.#toolset, revision, {
					inputs,
					...(this.#runs === undefined ? {} : { runs: this.#runs }),
				}).execute({ signal })
			} catch (error) {
				throw this.#prepared(error, revision.journey)
			}
			return renderBrowserRun(run, signal.aborted ? undefined : await this.#view(signal))
		} finally {
			this.#replaying = undefined
			this.#replay = undefined
			finished.resolve()
		}
	}

	// Maps a preparation refusal to its sentence; any other failure keeps its own message.
	#prepared(error: unknown, journey: BrowserJourney): unknown {
		if (!isBrowserError(error)) return error
		const name = journey.name
		switch (error.code) {
			case 'BROWSER_JOURNEY_INPUT': {
				const parameter = error.context?.['parameter']
				if (!isString(parameter)) return error
				if (!Object.hasOwn(journey.parameters, parameter))
					return new BrowserError(
						`Journey ${name} has no parameter named ${JSON.stringify(parameter)}; call journeys.`,
						error.code,
						error.context,
					)
				return new BrowserError(
					`Journey ${name} needs the input ${JSON.stringify(parameter)}; call replay with inputs.`,
					error.code,
					error.context,
				)
			}
			case 'BROWSER_JOURNEY_GAP': {
				const step = journey.steps.find((candidate) => candidate.id === error.context?.['step'])
				if (step === undefined) return error
				return new BrowserError(
					`Journey ${name} has a gap at ${step.id} (${step.gap}); call edit to remove or replace ${step.id}.`,
					error.code,
					error.context,
				)
			}
			case 'BROWSER_JOURNEY_PLACEMENT': {
				const id = error.context?.['step']
				const action = error.context?.['action']
				const placement = error.context?.['placement']
				if (!isString(id) || !isString(action) || !isString(placement)) return error
				return new BrowserError(
					action === 'switch'
						? `Journey ${name} cannot run here: ${id} switch needs a browser context; call journeys.`
						: `Journey ${name} cannot run here: ${id} ${action} is not available in a ${placement === 'dom' ? 'page' : 'browser'} toolset; call journeys.`,
					error.code,
					error.context,
				)
			}
			case 'BROWSER_JOURNEY_FORMAT':
			case 'BROWSER_JOURNEY_INVALID':
				return new BrowserError(
					`Journey ${name} cannot be read: ${normalizeBrowserJourneyReason(error)}; call journeys.`,
					error.code,
					error.context,
				)
			default:
				return error
		}
	}

	// Converts a wire edit's `ref` to a target from the current view, then checks the edit's own
	// shape, so the pure editor receives a typed batch.
	#convert(request: unknown, index: number): BrowserJourneyEdit {
		let edit = request
		if (isRecord(request) && request['operation'] === 'add' && isRecord(request['step'])) {
			const { ref, ...step } = request['step']
			if (ref !== undefined) edit = { ...request, step: { ...step, target: this.#target(ref) } }
		} else if (isRecord(request) && request['operation'] === 'update') {
			const { ref, ...update } = request
			if (ref !== undefined) edit = { ...update, target: this.#target(ref) }
		}
		try {
			validateBrowserJourneyEdit(edit)
		} catch (error) {
			const reason = normalizeBrowserJourneyReason(error)
			throw new BrowserError(
				`Edit ${index} is refused: ${reason.startsWith('its ') ? reason : `it ${reason}`}; call journeys.`,
				'BROWSER_JOURNEY_EDIT',
				{ index, reason },
			)
		}
		return edit
	}

	#target(ref: unknown): BrowserJourneyTarget {
		const reference = requireBrowserReference(ref)
		const element = this.#toolset.view.elements.element(reference)
		if (element === undefined)
			throw new BrowserElementError(
				reference,
				'UNKNOWN',
				'is not in the current view; call look for fresh refs',
			)
		return { role: element.role, name: element.name, reference: element.reference }
	}

	async #find(name: string, signal: AbortSignal): Promise<BrowserJourneyRevision> {
		const revision = BROWSER_JOURNEY_NAME_PATTERN.test(name)
			? await this.#read(name, signal)
			: undefined
		if (revision === undefined)
			throw new BrowserError(
				`No journey is named ${JSON.stringify(name)}; call journeys.`,
				'BROWSER_JOURNEY_MISSING',
				{ name },
			)
		return revision
	}

	async #read(name: string, signal: AbortSignal): Promise<BrowserJourneyRevision | undefined> {
		try {
			return await this.#store.get(name, { signal })
		} catch (error) {
			if (signal.aborted) throw error
			throw new BrowserError(
				`Journey ${name} cannot be read: ${normalizeBrowserJourneyReason(error)}; call journeys.`,
				isBrowserError(error) ? error.code : 'BROWSER_JOURNEY_FILE',
				{ name },
			)
		}
	}

	// Reads the view a receipt carries through `look`, so it is cut at the toolset's limit and
	// carries the notes of any view move.
	async #view(signal: AbortSignal): Promise<string> {
		const performed = await this.#toolset.perform(
			{ id: 'journey', name: 'look', arguments: { what: 'the page' } },
			{ signal },
		)
		return performed.result.success ? String(performed.result.value) : performed.result.error
	}

	#ended(): BrowserError {
		return new BrowserError('the browser session ended', 'BROWSER_TOOLSET_ENDED')
	}

	async #teardown(): Promise<void> {
		this.#lifetime.abort(this.#ended())
		for (const tool of this.#tools)
			if (this.#toolset.tools.tool(tool.name) === tool) this.#toolset.tools.remove(tool.name)
		const recorder = this.#recorder
		this.#recorder = undefined
		this.#recording = undefined
		await recorder?.destroy()
		await this.#replay
	}

	#idleReplay(): void {
		const active = this.#replaying ?? this.#toolset.held
		if (active !== undefined)
			throw new BrowserError(
				`The toolset is replaying ${active} until it finishes; call look.`,
				'BROWSER_TOOLSET_BUSY',
			)
	}
}
