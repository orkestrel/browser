import type {
	BrowserLine,
	BrowserJourney,
	BrowserJourneyEdit,
	BrowserJourneyOptions,
	BrowserJourneyRevision,
	BrowserJourneyStoreInterface,
	BrowserJourneyTarget,
	BrowserRecorderInterface,
	BrowserRun,
	BrowserRunStoreInterface,
	BrowserToolName,
	BrowserToolsetInterface,
} from './types.js'
import type { ToolContext, ToolInterface } from '@orkestrel/tool'
import { attempt, isArray, isBoolean, isError, isRecord, isString } from '@orkestrel/contract'
import { createTool } from '@orkestrel/tool'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_IDLE_REFUSAL,
	BROWSER_JOURNEY_SAVE_SAVED_REFUSAL,
	BROWSER_JOURNEY_NAME_PATTERN,
	BROWSER_JOURNEY_READONLY_REFUSAL,
	BROWSER_JOURNEY_RECORDING_REFUSAL,
	BROWSER_JOURNEY_EMPTY_REFUSAL,
	BROWSER_JOURNEY_RECORD_EMPTY_REFUSAL,
	BROWSER_JOURNEY_RECORD_STEPS_REFUSAL,
	BROWSER_JOURNEY_EDIT_CHOICE_REFUSAL,
	BROWSER_JOURNEY_EDIT_EMPTY_REFUSAL,
	BROWSER_JOURNEY_TOOL_NAMES,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_CUT_FOOTER,
	BROWSER_TOOL_LIMIT,
} from './constants.js'
import { BrowserError, isBrowserError } from './errors.js'
import { parseBrowserToolInteger } from './parsers.js'
import { createBrowserRecorder, createBrowserReplay } from './factories.js'
import {
	editBrowserJourney,
	boundBrowserText,
	abbreviateBrowserText,
	renderBrowserLine,
	renderBrowserWindow,
	renderBrowserSearch,
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
 * The journey toolset composes the toolset's public members: `execute` reads the view a receipt
 * carries through `read`, `hold` and `emitter` drive the recorder and the replay, `view` converts
 * an edit's `ref` to a target, and `tools` receives the journey tools at construction, which refuses
 * with `TOOLSET_RESERVED` when the manager already holds one of the names. Every refusal
 * is a sentence that names the next call, and a reason inside it is a clause without a directive
 * or a final period.
 *
 * `readonly` refuses `record`, `save`, `edit`, and `forget` before any store access; `replay` still writes
 * its run. The call's signal reaches every store call and every replayed step, and `destroy()`
 * aborts it as well. `save` writes a snapshot before it ends the recording, so a failed or
 * locked write keeps the recorder recording with its steps for the next
 * `save`. An empty snapshot refuses with `JOURNEY_EMPTY` and keeps recording.
 * `edit` accepts an array or its JSON string and names a parse error when the string is invalid.
 * `journeys` addresses the complete listing by inclusive `from` and `to` lines. Every result
 * fits the whole-result limit, including its footer. Save and edit continue through `journeys`.
 * Record and replay size their page window to the remaining room; replay uses a read directive
 * when a complete page window cannot fit.
 *
 * `destroy()` aborts the active replay and waits for it to finish, stops a recording without
 * saving it, and removes the journey tools the manager still holds under the instances it added.
 *
 */
export class BrowserJourneyToolset {
	readonly #toolset: BrowserToolsetInterface
	readonly #notes: (() => string) | undefined
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

	constructor(
		toolset: BrowserToolsetInterface,
		options: BrowserJourneyOptions,
		notes?: () => string,
	) {
		const limit = options.limit ?? toolset.limit
		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new BrowserError('ARGUMENT', 'The journeys limit must be a positive integer', {
				subject: 'journey',
				limit,
			})
		}
		const held = BROWSER_JOURNEY_TOOL_NAMES.find((name) => toolset.tools.tool(name) !== undefined)
		if (held !== undefined) {
			throw new BrowserError(
				'TOOLSET_RESERVED',
				`The tool manager already holds a tool named ${held}, a name the browser toolset reserves`,
				{ name: held },
			)
		}
		this.#toolset = toolset
		this.#notes = notes
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
		handler: (
			args: Readonly<Record<string, unknown>>,
			signal: AbortSignal,
			note: string,
		) => Promise<string>,
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
		handler: (
			args: Readonly<Record<string, unknown>>,
			signal: AbortSignal,
			note: string,
		) => Promise<string>,
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<string> {
		if (this.#destroying !== undefined) throw this.#ended()
		const signal = AbortSignal.any([context.signal, this.#lifetime.signal])
		const note = abbreviateBrowserText(this.#notes?.() ?? '', 200)
		try {
			validateBrowserToolArguments(BROWSER_TOOL_COPY[name], args)
			signal.throwIfAborted()
			const result = await handler(args, signal, note)
			return name === 'capture' || name === 'forget'
				? boundBrowserText(
						[note, this.#toolset.redact(result)].filter(Boolean).join('\n'),
						this.#limit,
						BROWSER_TOOL_CUT_FOOTER,
					)
				: result
		} catch (error) {
			const original = isError(error) ? error.message : String(error)
			const message = [note, this.#toolset.redact(original)].filter(Boolean).join('\n')
			if (message === original && message.length <= this.#limit) throw error
			throw new BrowserError(
				isBrowserError(error) ? error.code : 'PROTOCOL',
				boundBrowserText(message, this.#limit, BROWSER_TOOL_CUT_FOOTER),
				isBrowserError(error) ? error.context : undefined,
			)
		}
	}

	async #capture(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		const full = args['full']
		if (!isBoolean(full))
			throw new BrowserError('ARGUMENT', 'The full parameter must be true or false.', {
				subject: 'toolset',
			})
		this.#idleReplay()
		const view = this.#toolset.view
		if (!view.trusted)
			throw new BrowserError(
				'CAPTURE_UNTRUSTED',
				'This view is untrusted; capture requires a trusted browser view.',
			)
		if (view.screenshot === undefined)
			throw new BrowserError('CAPTURE_UNAVAILABLE', 'This view cannot capture an image.')
		const runs = this.#runs
		if (runs?.write === undefined)
			throw new BrowserError(
				'CAPTURE_UNAVAILABLE',
				'Capture requires a runs store with standalone file storage.',
			)
		const screenshot = await view.screenshot({ format: 'png', full })
		signal.throwIfAborted()
		const path = await runs.write(screenshot.bytes, { signal })
		if (path.length > this.#limit)
			throw new BrowserError(
				'TOOLSET_LIMIT',
				'The image was saved, but its path exceeds the result limit.',
			)
		return path
	}

	async #record(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		note: string,
	): Promise<string> {
		if (this.#readonly) throw new BrowserError('JOURNEY_READONLY', BROWSER_JOURNEY_READONLY_REFUSAL)
		this.#idleReplay()
		const name = readBrowserToolString(args, 'journey')
		if (this.#recording !== undefined) {
			const count = this.#recorder?.steps().length ?? 0
			const refusal =
				name !== this.#recording
					? BROWSER_JOURNEY_RECORDING_REFUSAL
					: count === 0
						? BROWSER_JOURNEY_RECORD_EMPTY_REFUSAL
						: BROWSER_JOURNEY_RECORD_STEPS_REFUSAL
			throw new BrowserError(
				'JOURNEY_RECORDING',
				refusal
					.replace('{name}', this.#recording)
					.replace('{count}', String(count))
					.replace('{steps}', count === 1 ? 'step' : 'steps'),
			)
		}
		if (!BROWSER_JOURNEY_NAME_PATTERN.test(name)) {
			throw new BrowserError(
				'ARGUMENT',
				`${JSON.stringify(name)} is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`,
				{ subject: 'toolset', key: 'journey' },
			)
		}
		this.#recording = name
		let recorder: BrowserRecorderInterface | undefined
		try {
			if ((await this.#read(name, signal)) !== undefined) {
				throw new BrowserError(
					'JOURNEY_SAVED',
					`Journey ${JSON.stringify(name)} is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.`,
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
			note,
		)
	}

	async #save(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		note: string,
	): Promise<string> {
		if (this.#readonly) throw new BrowserError('JOURNEY_READONLY', BROWSER_JOURNEY_READONLY_REFUSAL)
		const description = readBrowserToolString(args, 'description')
		const recorder = this.#recorder
		const name = this.#recording
		if (recorder === undefined || name === undefined)
			throw new BrowserError(
				'JOURNEY_RECORDING',
				this.#saved === undefined
					? BROWSER_JOURNEY_IDLE_REFUSAL
					: BROWSER_JOURNEY_SAVE_SAVED_REFUSAL.replace('{name}', JSON.stringify(this.#saved)),
			)
		const snapshot = attempt(() => recorder.journey({ name, description }))
		if (!snapshot.success) {
			if (
				isBrowserError(snapshot.error) &&
				snapshot.error.code === 'JOURNEY_INVALID' &&
				snapshot.error.context?.['field'] === 'steps'
			)
				throw new BrowserError(
					'JOURNEY_EMPTY',
					BROWSER_JOURNEY_EMPTY_REFUSAL.replace('{name}', name),
					{ name },
				)
			throw snapshot.error
		}
		let saved: BrowserJourneyRevision
		try {
			saved = await this.#store.set(
				{
					...snapshot.value,
					...(snapshot.value.start === undefined
						? {}
						: { start: this.#toolset.redact(snapshot.value.start) }),
				},
				{ exclusive: true, signal },
			)
		} catch (error) {
			if (signal.aborted) throw error
			if (isBrowserError(error) && error.code === 'JOURNEY_STALE')
				throw new BrowserError(
					error.code,
					`A journey named "${name}" is saved; call journeys, or record another name.`,
					{ name },
				)
			if (isBrowserError(error) && error.code === 'STORE_LOCKED')
				throw new BrowserError(error.code, `Journey ${name} is locked; call save again.`, { name })
			throw new BrowserError(
				isBrowserError(error) ? error.code : 'STORE_FILE',
				`Saving ${name} failed: ${normalizeBrowserJourneyReason(error)}; call save again.`,
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
			note,
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
				for (const text of this.#toolset.redact(listing).split(/\r\n|\n/))
					lines.push(...wrapBrowserLine({ spans: [{ category: 'text', text }] }))
			}
			offset += page.entries.length
			if (!page.truncated || page.entries.length === 0) return lines
		}
	}

	async #savedWindow(
		signal: AbortSignal,
		name: string,
		status: string,
		note: string,
	): Promise<string> {
		const lines = await this.#listing(signal)
		const from = Math.max(
			1,
			lines.findIndex((line) => renderBrowserLine(line).startsWith(name + ' "')) + 1,
		)
		return renderBrowserWindow(
			lines,
			from,
			undefined,
			[note, this.#toolset.redact(status)].filter(Boolean).join('\n'),
			this.#limit,
			'journeys',
		)
	}

	async #journeys(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		note: string,
	): Promise<string> {
		const from = args['from'] === undefined ? 1 : parseBrowserToolInteger(args['from'])
		const to = parseBrowserToolInteger(args['to'])
		const search = args['search']
		if (
			from === undefined ||
			(args['to'] !== undefined && to === undefined) ||
			(search !== undefined && !isString(search))
		)
			throw new BrowserError(
				'ARGUMENT',
				'Journeys requires an integer from, an optional integer to, and optional search text.',
				{ subject: 'toolset' },
			)
		validateBrowserLines(from, to)
		const lines = await this.#listing(signal)
		validateBrowserLines(from, to, lines.length)
		if (lines.length === 0)
			return boundBrowserText(
				[note, BROWSER_JOURNEY_EMPTY_LISTING].filter(Boolean).join('\n'),
				this.#limit,
				BROWSER_TOOL_CUT_FOOTER,
			)
		const found = renderBrowserSearch(
			lines,
			from,
			to,
			search === undefined ? undefined : this.#toolset.redact(search),
		)
		const heading = [note, `journeys (${lines.length} lines)`, found.text]
			.filter(Boolean)
			.join('\n')
		return renderBrowserWindow(lines, found.from, to, heading, this.#limit, 'journeys')
	}

	async #edit(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		note: string,
	): Promise<string> {
		if (this.#readonly) throw new BrowserError('JOURNEY_READONLY', BROWSER_JOURNEY_READONLY_REFUSAL)
		let name: string
		if ('journey' in args) name = readBrowserToolString(args, 'journey')
		else {
			const saved = await this.#store.list({ signal, limit: Number.MAX_SAFE_INTEGER })
			const only = saved.entries[0]
			if (only === undefined || saved.entries.length !== 1)
				throw new BrowserError(
					'ARGUMENT',
					only === undefined
						? BROWSER_JOURNEY_EDIT_EMPTY_REFUSAL
						: BROWSER_JOURNEY_EDIT_CHOICE_REFUSAL.replace(
								'{names}',
								saved.entries.map((entry) => JSON.stringify(entry.journey.name)).join(', '),
							),
					{ subject: 'toolset', key: 'journey' },
				)
			name = only.journey.name
		}
		let requests = args['edits']
		if (isString(requests)) {
			const text = requests
			const parsed = attempt<unknown>(() => JSON.parse(text))
			if (!parsed.success)
				throw new BrowserError(
					'ARGUMENT',
					`The edits parameter is not valid JSON: ${normalizeBrowserJourneyReason(parsed.error)}; pass an array or a JSON string of the array.`,
					{ subject: 'toolset', key: 'edits' },
				)
			requests = parsed.value
		}
		if (!isArray(requests)) {
			throw new BrowserError(
				'ARGUMENT',
				'The edits parameter must be an array or a JSON string of the array.',
				{ subject: 'toolset', key: 'edits' },
			)
		}
		const revision = await this.#find(name, signal)
		const edits = requests.map((request, index) => this.#convert(request, index + 1))
		let edited: BrowserJourney
		try {
			edited = editBrowserJourney(revision.journey, edits)
		} catch (error) {
			if (!isBrowserError(error) || error.code !== 'JOURNEY_EDIT') throw error
			throw new BrowserError(error.code, `${error.message}; call journeys.`, error.context)
		}
		let saved: BrowserJourneyRevision
		try {
			saved = await this.#store.set(edited, {
				...(revision.revision === undefined ? {} : { revision: revision.revision }),
				signal,
			})
		} catch (error) {
			if (signal.aborted) throw error
			const code = isBrowserError(error) ? error.code : 'STORE_FILE'
			if (code === 'JOURNEY_STALE')
				throw new BrowserError(
					code,
					`Journey ${name} changed since you read it; call journeys, then edit again.`,
					{ name },
				)
			if (code === 'STORE_LOCKED')
				throw new BrowserError(code, `Journey ${name} is locked; call edit again.`, { name })
			throw new BrowserError(
				code,
				`Editing ${name} failed: ${normalizeBrowserJourneyReason(error)}; call edit again.`,
				{ name },
			)
		}
		return this.#savedWindow(signal, saved.journey.name, `Edited ${name}.`, note)
	}

	async #forget(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
		if (this.#readonly) throw new BrowserError('JOURNEY_READONLY', BROWSER_JOURNEY_READONLY_REFUSAL)
		this.#idleReplay()
		const name = readBrowserToolString(args, 'journey')
		if (this.#recording === name)
			throw new BrowserError(
				'JOURNEY_RECORDING',
				`Journey ${JSON.stringify(name)} is recording; call save first, or record another name.`,
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
			const code = isBrowserError(error) ? error.code : 'STORE_FILE'
			if (code === 'STORE_LOCKED')
				throw new BrowserError(code, `Journey ${name} is locked; call forget again.`, { name })
			throw new BrowserError(
				code,
				`Forgetting ${name} failed: ${normalizeBrowserJourneyReason(error)}; call forget again.`,
				{ name },
			)
		}
		if (this.#saved === name) this.#saved = undefined
		return `Forgot ${name} and its ${count} ${count === 1 ? 'run' : 'runs'}; the name is free to record again.`
	}

	async #replayJourney(
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		note: string,
	): Promise<string> {
		const name = readBrowserToolString(args, 'journey')
		const inputs: Record<string, string> = {}
		const given = args['inputs'] ?? {}
		if (!isRecord(given) || !Object.values(given).every(isString)) {
			throw new BrowserError('ARGUMENT', 'The inputs parameter must be an object of strings.', {
				subject: 'toolset',
				key: 'inputs',
			})
		}
		for (const [key, value] of Object.entries(given)) if (isString(value)) inputs[key] = value
		if (this.#recording !== undefined) {
			throw new BrowserError(
				'JOURNEY_RECORDING',
				`Journey ${this.#recording} is recording; call save before you replay another.`,
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
				? boundBrowserText(
						[note, this.#toolset.redact(renderBrowserRun(run))].filter(Boolean).join('\n'),
						this.#limit,
						BROWSER_TOOL_CUT_FOOTER,
					)
				: this.#view(signal, renderBrowserRun(run), note)
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
			case 'JOURNEY_INPUT': {
				const parameter = error.context?.['parameter']
				if (!isString(parameter)) return error
				if (!Object.hasOwn(journey.parameters, parameter))
					return new BrowserError(
						error.code,
						`Journey ${name} has no parameter named ${JSON.stringify(parameter)}; call journeys.`,
						error.context,
					)
				return new BrowserError(
					error.code,
					`Journey ${name} needs the input ${JSON.stringify(parameter)}; call replay with inputs.`,
					error.context,
				)
			}
			case 'JOURNEY_GAP': {
				const step = journey.steps.find((candidate) => candidate.id === error.context?.['step'])
				if (step === undefined) return error
				return new BrowserError(
					error.code,
					`Journey ${name} has a gap at ${step.id} (${step.gap}); call edit to remove or replace ${step.id}.`,
					error.context,
				)
			}
			case 'JOURNEY_PLACEMENT': {
				const id = error.context?.['step']
				const action = error.context?.['action']
				const placement = error.context?.['placement']
				if (!isString(id) || !isString(action) || !isString(placement)) return error
				return new BrowserError(
					error.code,
					action === 'switch'
						? `Journey ${name} cannot run here: ${id} switch needs a browser context; call journeys.`
						: `Journey ${name} cannot run here: ${id} ${action} is not available in a ${placement === 'dom' ? 'page' : 'browser'} toolset; call journeys.`,
					error.context,
				)
			}
			case 'STORE_FORMAT':
			case 'JOURNEY_INVALID':
				return new BrowserError(
					error.code,
					`Journey ${name} cannot be read: ${normalizeBrowserJourneyReason(error)}; call journeys.`,
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
				'JOURNEY_EDIT',
				`Edit ${index} is refused: ${reason.startsWith('its ') ? reason : `it ${reason}`}; call journeys.`,
				{ index, reason },
			)
		}
		return edit
	}

	#target(ref: unknown): BrowserJourneyTarget {
		const reference = requireBrowserReference(ref)
		const element = this.#toolset.view.elements.element(reference)
		if (element === undefined)
			throw new BrowserError('ELEMENT', this.#toolset.describe(reference), {
				reference: reference,
				reason: 'UNKNOWN',
			})
		return { role: element.role, name: element.name, reference: element.reference }
	}

	async #find(name: string, signal: AbortSignal): Promise<BrowserJourneyRevision> {
		const revision = BROWSER_JOURNEY_NAME_PATTERN.test(name)
			? await this.#read(name, signal)
			: undefined
		if (revision === undefined)
			throw new BrowserError(
				'JOURNEY_MISSING',
				`No journey is named ${JSON.stringify(name)}; call journeys.`,
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
				isBrowserError(error) ? error.code : 'STORE_FILE',
				`Journey ${name} cannot be read: ${normalizeBrowserJourneyReason(error)}; call journeys.`,
				{ name },
			)
		}
	}

	async #view(signal: AbortSignal, status: string, notice: string): Promise<string> {
		const note = '(Call read to see the page.)'
		const prefix = boundBrowserText(
			[notice, this.#toolset.redact(status)].filter(Boolean).join('\n'),
			Math.max(1, this.#limit - note.length - 2),
			BROWSER_TOOL_CUT_FOOTER,
		)
		const room = this.#limit - prefix.length - 2
		try {
			return prefix + '\n\n' + (await this.#toolset.read({ from: 1, limit: room, signal }))
		} catch (error) {
			if (signal.aborted) throw error
			if (isBrowserError(error) && error.code === 'TOOLSET_LIMIT')
				return boundBrowserText(prefix + '\n\n' + note, this.#limit, BROWSER_TOOL_CUT_FOOTER)
			return boundBrowserText(
				prefix + '\n\n' + this.#toolset.redact(isError(error) ? error.message : String(error)),
				this.#limit,
				BROWSER_TOOL_CUT_FOOTER,
			)
		}
	}

	#ended(): BrowserError {
		return new BrowserError('CLOSED', 'the browser session ended', { subject: 'toolset' })
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
				'TOOLSET_BUSY',
				`The toolset is replaying ${active} until it finishes; call read.`,
			)
	}
}
