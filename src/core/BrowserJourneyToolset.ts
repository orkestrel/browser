import type {
	BrowserLine,
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
import {
	attempt,
	isArray,
	isBoolean,
	isInteger,
	isError,
	isRecord,
	isString,
} from '@orkestrel/contract'
import { createTool } from '@orkestrel/tool'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_IDLE_REFUSAL,
	BROWSER_JOURNEY_NAME_PATTERN,
	BROWSER_JOURNEY_READONLY_REFUSAL,
	BROWSER_JOURNEY_RECORDING_REFUSAL,
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_CUT_FOOTER,
	BROWSER_TOOL_LIMIT,
} from './constants.js'
import { BrowserElementError, BrowserError, isBrowserError } from './errors.js'
import { createBrowserRecorder, createBrowserReplay } from './factories.js'
import {
	editBrowserJourney,
	boundBrowserText,
	abbreviateBrowserText,
	renderBrowserLine,
	renderBrowserWindow,
	scanBrowserLines,
	validateBrowserLines,
	wrapBrowserLine,
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
 * Registers the journey tools `record`, `save`, `journeys`, `edit`, `replay`, `forget`, and `capture` over a toolset
 * and owns the recording and the active replay.
 *
 * @remarks
 * The journey toolset composes the toolset's public members: `perform` reads the view a receipt
 * carries through `read`, `hold` and `emitter` drive the recorder and the replay, `view` converts
 * an edit's `ref` to a target, and `tools` receives the journey tools at construction, which refuses
 * with `BROWSER_TOOLSET_RESERVED` when the manager already holds one of the names. Every refusal
 * is a sentence that names the next call, and a reason inside it is a clause without a directive
 * or a final period.
 *
 * `readonly` refuses `record`, `save`, `edit`, and `forget` before any store access; `replay` still writes
 * its run. The call's signal reaches every store call and every replayed step, and `destroy()`
 * aborts it as well. `save` writes a snapshot before it ends the recording, so a failed or
 * locked write keeps the recorder recording with its steps for the next
 * `save`. An empty snapshot refuses with `BROWSER_JOURNEY_EMPTY` and keeps recording.
 * `edit` accepts an array or its JSON string and names a parse error when the string is invalid.
 * `journeys` addresses the complete listing by inclusive `from` and `to` lines. Every result
 * fits the whole-result limit, including its footer. Save and edit continue through `journeys`.
 * Record and replay size their page window to the remaining room; replay uses a read directive
 * when a complete page window cannot fit.
 *
 * `destroy()` aborts the active replay and waits for it to finish, stops a recording without
 * saving it, and removes the journey tools the manager still holds under the instances it added.
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
		this.#limit = Math.min(limit, BROWSER_TOOL_LIMIT)
		this.#tools = Object.freeze([
			this.#create('record', this.#record.bind(this)),
			this.#create('save', this.#save.bind(this)),
			this.#create('journeys', this.#journeys.bind(this)),
			this.#create('edit', this.#edit.bind(this)),
			this.#create('replay', this.#replayJourney.bind(this)),
			this.#create('forget', this.#forget.bind(this)),
			this.#create('capture', this.#capture.bind(this)),
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
		const signal = AbortSignal.any([context.signal, this.#lifetime.signal])
		try {
			validateBrowserToolArguments(BROWSER_TOOL_COPY[name], args)
			signal.throwIfAborted()
			return boundBrowserText(await handler(args, signal), this.#limit, BROWSER_TOOL_CUT_FOOTER)
		} catch (error) {
			const message = isError(error) ? error.message : String(error)
			if (message.length <= this.#limit) throw error
			throw new BrowserError(
				boundBrowserText(message, this.#limit, BROWSER_TOOL_CUT_FOOTER),
				isBrowserError(error) ? error.code : undefined,
				isBrowserError(error) ? error.context : undefined,
			)
		}
	}

	async #capture(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		const full = args['full']
		if (!isBoolean(full))
			throw new BrowserError(
				'The full parameter must be true or false.',
				'BROWSER_TOOLSET_ARGUMENT',
			)
		this.#idleReplay()
		const view = this.#toolset.view
		if (!view.trusted)
			throw new BrowserError(
				'This view is untrusted; capture requires a trusted browser view.',
				'BROWSER_CAPTURE_UNTRUSTED',
			)
		if (view.screenshot === undefined)
			throw new BrowserError('This view cannot capture an image.', 'BROWSER_CAPTURE_UNAVAILABLE')
		const runs = this.#runs
		if (runs?.snapshot === undefined)
			throw new BrowserError(
				'Capture requires a runs store with standalone file storage.',
				'BROWSER_CAPTURE_UNAVAILABLE',
			)
		const screenshot = await view.screenshot({ format: 'png', full })
		signal.throwIfAborted()
		const path = await runs.snapshot(screenshot.bytes, { signal })
		if (path.length > this.#limit)
			throw new BrowserError(
				'The image was saved, but its path exceeds the result limit.',
				'BROWSER_TOOLSET_LIMIT',
			)
		return path
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
					`Journey ${JSON.stringify(name)} is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.`,
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
		return this.#view(
			signal,
			`Recording ${name}; each action you take is a step; call save when it is done.`,
		)
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
					`Nothing is recorded for ${name}: the actions before record are not steps. Perform the flow's actions and call save, or answer the user when the task is done.`,
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
		return this.#savedWindow(
			signal,
			name,
			`Saved ${name} with ${count} ${count === 1 ? 'step' : 'steps'}.`,
		)
	}

	async #listing(signal: AbortSignal): Promise<readonly BrowserLine[]> {
		const lines: BrowserLine[] = []
		const faults = new Set<string>()
		let offset = 0
		for (;;) {
			const page = await this.#store.list({ signal, offset })
			const listings = page.entries.map((entry) => renderBrowserJourney(entry.journey))
			for (const fault of page.faults) {
				if (faults.has(fault.name)) continue
				faults.add(fault.name)
				listings.push(renderBrowserJourneyFault(fault))
			}
			for (const listing of listings) {
				for (const text of listing.split(/\r\n|\n/))
					lines.push(...wrapBrowserLine({ spans: [{ category: 'text', text }] }))
			}
			offset += page.entries.length
			if (!page.truncated || page.entries.length === 0) return lines
		}
	}

	async #savedWindow(signal: AbortSignal, name: string, status: string): Promise<string> {
		const lines = await this.#listing(signal)
		const from = Math.max(
			1,
			lines.findIndex((line) => renderBrowserLine(line).startsWith(name + ' "')) + 1,
		)
		return renderBrowserWindow(lines, from, undefined, status, this.#limit, 'journeys')
	}

	async #journeys(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		const from = args['from']
		const to = args['to']
		const search = args['search']
		if (
			!isInteger(from) ||
			(to !== undefined && !isInteger(to)) ||
			(search !== undefined && !isString(search))
		)
			throw new BrowserError(
				'Journeys requires an integer from, an optional integer to, and optional search text.',
				'BROWSER_TOOLSET_ARGUMENT',
			)
		validateBrowserLines(from, to)
		const lines = await this.#listing(signal)
		validateBrowserLines(from, to, lines.length)
		if (lines.length === 0) return BROWSER_JOURNEY_EMPTY_LISTING
		const matches = search === undefined ? [] : scanBrowserLines(lines, search, from, to)
		const first = matches[0]
		const heading =
			'journeys (' +
			lines.length +
			' lines)' +
			(search === undefined
				? ''
				: '\n' +
					(matches.length === 0
						? 'No line matches ' + JSON.stringify(abbreviateBrowserText(search, 120)) + '.'
						: matches.length +
							' lines match ' +
							JSON.stringify(abbreviateBrowserText(search, 120)) +
							': ' +
							matches.slice(0, 50).join(', ') +
							(matches.length > 50
								? ', … and ' + (matches.length - 50) + ' more; add words to narrow'
								: '')))
		return renderBrowserWindow(
			lines,
			first === undefined ? from : Math.max(from, first - 1),
			to,
			heading,
			this.#limit,
			'journeys',
		)
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
		return this.#savedWindow(signal, saved.journey.name, `Edited ${name}.`)
	}

	async #forget(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		if (this.#readonly)
			throw new BrowserError(BROWSER_JOURNEY_READONLY_REFUSAL, 'BROWSER_JOURNEY_READONLY')
		this.#idleReplay()
		const name = readBrowserToolString(args, 'journey')
		if (this.#recording === name)
			throw new BrowserError(
				`Journey ${JSON.stringify(name)} is recording; call save first, or record another name.`,
				'BROWSER_JOURNEY_RECORDING',
				{ name },
			)
		await this.#find(name, signal)
		this.#idleReplay()
		let count: number
		try {
			// Remove runs first so a failed removal leaves the saved name available for a retry.
			count = (await this.#runs?.clear(name, { signal })) ?? 0
			await this.#store.delete(name, { signal })
		} catch (error) {
			if (signal.aborted) throw error
			const code = isBrowserError(error) ? error.code : 'BROWSER_JOURNEY_FILE'
			if (code === 'BROWSER_JOURNEY_LOCKED')
				throw new BrowserError(`Journey ${name} is locked; call forget again.`, code, { name })
			throw new BrowserError(
				`Forgetting ${name} failed: ${normalizeBrowserJourneyReason(error)}; call forget again.`,
				code,
				{ name },
			)
		}
		if (this.#saved === name) this.#saved = undefined
		return `Forgot ${name} and its ${count} ${count === 1 ? 'run' : 'runs'}; the name is free to record again.`
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
			return signal.aborted
				? boundBrowserText(renderBrowserRun(run), this.#limit, BROWSER_TOOL_CUT_FOOTER)
				: this.#view(signal, renderBrowserRun(run))
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
				'is not in the current view; call read for fresh refs',
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

	async #view(signal: AbortSignal, status: string): Promise<string> {
		const note = '(Call read to see the page.)'
		const prefix = boundBrowserText(
			status,
			Math.max(1, this.#limit - note.length - 2),
			BROWSER_TOOL_CUT_FOOTER,
		)
		const room = this.#limit - prefix.length - 2
		try {
			return prefix + '\n\n' + (await this.#toolset.read({ from: 1, limit: room, signal }))
		} catch (error) {
			if (signal.aborted) throw error
			if (isBrowserError(error) && error.code === 'BROWSER_TOOLSET_LIMIT')
				return boundBrowserText(prefix + '\n\n' + note, this.#limit, BROWSER_TOOL_CUT_FOOTER)
			return boundBrowserText(
				prefix + '\n\n' + (isError(error) ? error.message : String(error)),
				this.#limit,
				BROWSER_TOOL_CUT_FOOTER,
			)
		}
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
				`The toolset is replaying ${active} until it finishes; call read.`,
				'BROWSER_TOOLSET_BUSY',
			)
	}
}
