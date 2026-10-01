import type { JSONValue } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	BrowserAction,
	BrowserJourney,
	BrowserCallOptions,
	BrowserConsoleMessage,
	BrowserHoldInterface,
	BrowserJourneyRevision,
	BrowserJourneyStep,
	BrowserPageError,
	BrowserReplayEventMap,
	BrowserReplayInterface,
	BrowserReplayOptions,
	BrowserRun,
	BrowserRunOutcome,
	BrowserRunSlot,
	BrowserRunStep,
	BrowserToolsetInterface,
	BrowserViewEventMap,
} from './types.js'
import { isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BROWSER_JOURNEY_ACTIONS, BROWSER_JOURNEY_FORMAT_VERSION } from './constants.js'
import { BrowserError, isBrowserError, isBrowserStepError } from './errors.js'
import {
	deriveBrowserJourneyTrigger,
	generateBrowserRunId,
	resolveBrowserJourneyBinding,
	validateBrowserJourney,
} from './helpers.js'
import { isBrowserJourneyBinding, isBrowserSecretBinding } from './validators.js'
/**
 * Prepares and replays a journey under a toolset hold, retaining its executed prefix.
 * @example
 * const replay = new BrowserReplay(toolset, { journey }, { runs })
 * const run = await replay.execute({ signal })
 */
export class BrowserReplay implements BrowserReplayInterface {
	readonly #toolset: BrowserToolsetInterface
	readonly #revision: BrowserJourneyRevision
	readonly #options: BrowserReplayOptions | undefined
	readonly #emitter: Emitter<BrowserReplayEventMap>

	constructor(
		toolset: BrowserToolsetInterface,
		revision: BrowserJourneyRevision,
		options?: BrowserReplayOptions,
	) {
		this.#toolset = toolset
		this.#revision = revision
		this.#options = options
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
	}

	get emitter(): EmitterInterface<BrowserReplayEventMap> {
		return this.#emitter
	}

	async execute(options?: BrowserCallOptions): Promise<BrowserRun> {
		const inputs = this.#prepare()
		const revision = structuredClone(this.#revision)
		const journey = revision.journey
		if (this.#toolset.emitter.destroyed)
			throw new BrowserError('The browser session ended', 'BROWSER_TOOLSET_ENDED')
		const started = performance.now()
		const secret = Object.values(journey.parameters).some((parameter) => parameter.secret === true)
		const visible = Object.fromEntries(
			Object.entries(inputs).filter(([name]) => journey.parameters[name]?.secret !== true),
		)
		const steps: BrowserRunStep[] = []
		const output: string[] = []
		const cleanup: Array<() => void> = []
		const observed = new Set<EmitterInterface<BrowserViewEventMap>>()
		let hold: BrowserHoldInterface | undefined
		let slot: BrowserRunSlot = { id: generateBrowserRunId() }
		let outcome: BrowserRunOutcome = 'complete'
		let fault: string | undefined
		let run: BrowserRun
		try {
			hold = await this.#toolset.hold(journey.name, options)
			options?.signal?.throwIfAborted()
			if (this.#options?.runs !== undefined)
				slot = await this.#options.runs.open(journey.name, options)
			if (!secret) {
				this.#observe(output, cleanup, observed)
				const select = this.#observe.bind(this, output, cleanup, observed)
				this.#toolset.emitter.on('select', select)
				cleanup.push(() => this.#toolset.emitter.off('select', select))
			}
			for (const [index, step] of journey.steps.entries()) {
				options?.signal?.throwIfAborted()
				const previous = steps.at(-1)
				let recorded = await this.#executeStep(
					step,
					inputs,
					hold.token,
					previous?.outcome === 'interrupted',
					journey.parameters,
					options,
				)
				steps.push(recorded)
				try {
					if (!secret && !options?.signal?.aborted && recorded.outcome !== 'interrupted') {
						const capture = await this.#capture(slot, step.id, options)
						if (capture !== undefined) {
							recorded = { ...recorded, capture }
							steps[steps.length - 1] = recorded
						}
					}
				} finally {
					this.#emitter.emit('step', structuredClone(recorded))
				}
				const result = recorded
				if (options?.signal?.aborted) {
					outcome = 'aborted'
					break
				}
				if (
					result.outcome !== 'done' ||
					result.stage === 'requested' ||
					result.stage === 'committed'
				) {
					if (
						result.outcome === 'interrupted' &&
						journey.steps[index + 1]?.action === 'dialog' &&
						result.stage !== 'requested' &&
						result.stage !== 'committed'
					)
						continue
					outcome = 'stopped'
					break
				}
			}
		} catch (error) {
			outcome = options?.signal?.aborted ? 'aborted' : 'stopped'
			if (!options?.signal?.aborted) fault = error instanceof Error ? error.message : String(error)
		} finally {
			hold?.destroy()
			for (const release of cleanup) release()
			run = {
				format: BROWSER_JOURNEY_FORMAT_VERSION,
				id: slot.id,
				journey,
				...(revision.revision === undefined ? {} : { revision: revision.revision }),
				inputs: visible,
				steps,
				outcome,
				...(secret || !this.#toolset.view.trusted ? {} : { output }),
				elapsed: performance.now() - started,
				...(fault === undefined ? {} : { fault }),
			}
			try {
				await this.#write(run)
			} catch (error) {
				run = { ...run, fault: error instanceof Error ? error.message : String(error) }
			}
		}
		return run
	}

	#prepare(): Readonly<Record<string, string>> {
		const journey = this.#revision.journey
		const placement = this.#toolset.native.some((tool) => tool.name === 'navigate') ? 'page' : 'dom'
		try {
			validateBrowserJourney(journey)
		} catch (error) {
			if (!isBrowserError(error)) throw error
			throw new BrowserError(
				error.message,
				error.code,
				error.context ?? { action: 'replay', placement },
			)
		}
		const supplied = this.#options?.inputs ?? {}
		for (const name of Object.keys(supplied)) {
			if (!Object.hasOwn(journey.parameters, name))
				throw new BrowserError(
					`Journey ${journey.name} has no parameter named ${JSON.stringify(name)}.`,
					'BROWSER_JOURNEY_INPUT',
					{ parameter: name },
				)
		}
		// The generated module reads `inputs.NAME`, and only an own member for a name
		// `Object.prototype` carries; an own `undefined` is an omitted input there too.
		const values = new Map(
			Object.keys(journey.parameters).map((name): [string, unknown] => [
				name,
				name in Object.prototype && !Object.hasOwn(supplied, name) ? undefined : supplied[name],
			]),
		)
		const parameters = Object.entries(journey.parameters)
		// The module checks every required input before any defaulted one, so the refusals agree.
		for (const [name, parameter] of parameters) {
			if (parameter.default === undefined && !isString(values.get(name)))
				throw new BrowserError(
					`Journey ${journey.name} needs input ${JSON.stringify(name)}.`,
					'BROWSER_JOURNEY_INPUT',
					{ parameter: name },
				)
		}
		const inputs: Record<string, string> = {}
		for (const [name, parameter] of parameters) {
			const value = values.get(name)
			if (isString(value)) inputs[name] = value
			else if (value !== undefined)
				throw new BrowserError(
					`Journey ${journey.name} input ${JSON.stringify(name)} is not a string.`,
					'BROWSER_JOURNEY_INPUT',
					{ parameter: name },
				)
			else if (parameter.default !== undefined) inputs[name] = parameter.default
		}
		for (const step of journey.steps) {
			if (step.action === 'unresolved')
				throw new BrowserError(
					`Step ${step.id} is unresolved: ${step.gap}.`,
					'BROWSER_JOURNEY_GAP',
					{ step: step.id },
				)
			if (BROWSER_JOURNEY_ACTIONS.some((name) => name === step.action)) {
				const supported =
					['click', 'type', 'wait'].includes(step.action) ||
					(step.action === 'dialog'
						? this.#toolset.native.some((tool) => tool.name === 'navigate')
						: step.action === 'switch'
							? this.#toolset.tools.tool('switch') !== undefined
							: this.#toolset.native.some((tool) => tool.name === step.action))
				if (!supported)
					throw new BrowserError(
						`Step ${step.id} cannot execute ${step.action} in this placement.`,
						'BROWSER_JOURNEY_PLACEMENT',
						{
							step: step.id,
							action: step.action,
							placement,
						},
					)
			}
		}
		return inputs
	}

	async #executeStep(
		step: BrowserJourneyStep,
		inputs: Readonly<Record<string, string>>,
		caller: string,
		interrupted: boolean,
		parameters: BrowserJourney['parameters'],
		options?: BrowserCallOptions,
	): Promise<BrowserRunStep> {
		const started = performance.now()
		const args: Record<string, JSONValue> = {}
		const native = BROWSER_JOURNEY_ACTIONS.some((name) => name === step.action)
		for (const [key, value] of Object.entries(step.arguments)) {
			args[key] =
				native && isBrowserJourneyBinding(value) && !isString(value)
					? resolveBrowserJourneyBinding(value, inputs)
					: value
		}
		const secret = isBrowserSecretBinding(step, parameters)
		let action: BrowserAction | undefined
		let refusal: string | undefined
		try {
			if (step.action === 'dialog' && !interrupted)
				throw new BrowserError(
					`Step ${step.id} answers no interrupted action.`,
					'BROWSER_JOURNEY_DIALOG',
				)
			action = await this.#toolset.follow(
				step.id,
				{
					action: step.action,
					arguments: args,
					...(step.target === undefined
						? {}
						: {
								target: {
									role: step.target.role,
									name: resolveBrowserJourneyBinding(step.target.name, inputs),
								},
							}),
					...(step.tab === undefined ? {} : { tab: step.tab }),
				},
				{ ...options, caller, secret },
			)
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error)
			if (isBrowserStepError(error)) action = error.action
		}
		const recorded: Record<string, JSONValue> = { ...(action?.arguments ?? args) }
		if (secret) delete recorded['text']
		return {
			id: step.id,
			action: step.action,
			trigger: deriveBrowserJourneyTrigger(step, inputs),
			arguments: recorded,
			outcome: action?.outcome ?? 'refused',
			...(action?.stage === undefined ? {} : { stage: action.stage }),
			...(action?.reason === undefined ? {} : { reason: action.reason }),
			result: action?.receipt ?? refusal ?? '',
			elapsed: action?.elapsed ?? performance.now() - started,
		}
	}

	#observe(
		output: string[],
		cleanup: Array<() => void>,
		observed: Set<EmitterInterface<BrowserViewEventMap>>,
	): void {
		const view = this.#toolset.view
		const emitter = view.emitter
		if (!view.trusted || emitter === undefined || observed.has(emitter)) return
		observed.add(emitter)
		const console = this.#collectConsole.bind(this, output)
		const error = this.#collectError.bind(this, output)
		emitter.on('console', console)
		emitter.on('error', error)
		cleanup.push(() => {
			emitter.off('console', console)
			emitter.off('error', error)
		})
	}

	#collectConsole(output: string[], message: BrowserConsoleMessage): void {
		output.push(message.text)
	}

	#collectError(output: string[], error: BrowserPageError): void {
		output.push(error.message)
	}

	async #capture(
		slot: BrowserRunSlot,
		id: string,
		options?: BrowserCallOptions,
	): Promise<string | undefined> {
		const view = this.#toolset.view
		const runs = this.#options?.runs
		if (runs === undefined || !view.trusted || view.screenshot === undefined) return undefined
		const screenshot = await view.screenshot()
		return runs.capture(slot, `${id}.png`, screenshot.bytes, {
			...(options?.signal === undefined ? {} : { signal: options.signal }),
		})
	}

	async #write(run: BrowserRun): Promise<void> {
		if (this.#options?.runs === undefined) return
		const signal = AbortSignal.timeout(1_000)
		const deadline = Promise.withResolvers<void>()
		const abort = deadline.reject.bind(
			undefined,
			new BrowserError('Writing the run timed out', 'BROWSER_JOURNEY_FILE'),
		)
		signal.addEventListener('abort', abort, { once: true })
		try {
			await Promise.race([
				this.#options.runs.set(structuredClone(run), { signal }),
				deadline.promise,
			])
		} finally {
			signal.removeEventListener('abort', abort)
		}
	}
}
