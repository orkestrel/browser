import type { JSONValue, Result } from '@orkestrel/contract'
import type { EmitterInterface, Emitter } from '@orkestrel/emitter'
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
	BrowserReplayExecutionInterface,
	BrowserReplayOptions,
	BrowserRun,
	BrowserRunOutcome,
	BrowserRunSlot,
	BrowserRunStep,
	BrowserToolsetInterface,
	BrowserViewEventMap,
} from './types.js'
import { isString } from '@orkestrel/contract'
import { BROWSER_JOURNEY_ACTIONS, BROWSER_JOURNEY_FORMAT_VERSION } from './constants.js'
import { BrowserError, isBrowserStepError } from './errors.js'
import {
	deriveBrowserJourneyTrigger,
	generateBrowserRunId,
	resolveBrowserJourneyBinding,
} from './helpers.js'
import { isBrowserJourneyBinding, isBrowserSecretBinding } from './validators.js'

/** Owns the hold, captures, and completion of one prepared replay call. */
export class BrowserReplayExecution implements BrowserReplayExecutionInterface {
	readonly #toolset: BrowserToolsetInterface
	readonly #revision: BrowserJourneyRevision
	readonly #options: BrowserReplayOptions | undefined
	readonly #emitter: Emitter<BrowserReplayEventMap>
	readonly #inputs: Readonly<Record<string, string>>
	readonly #started: number
	readonly #secret: boolean
	readonly #visible: Readonly<Record<string, string>>
	readonly #result: Promise<BrowserRun>
	readonly #output: string[] = []
	readonly #cleanup: Array<() => void> = []
	readonly #observed = new Set<EmitterInterface<BrowserViewEventMap>>()
	#hold: BrowserHoldInterface | undefined
	#slot: BrowserRunSlot
	#outcome: BrowserRunOutcome = 'complete'
	#fault: string | undefined

	constructor(
		toolset: BrowserToolsetInterface,
		revision: BrowserJourneyRevision,
		inputs: Readonly<Record<string, string>>,
		emitter: Emitter<BrowserReplayEventMap>,
		options?: BrowserReplayOptions,
		call?: BrowserCallOptions,
	) {
		this.#toolset = toolset
		this.#revision = revision
		this.#inputs = inputs
		this.#emitter = emitter
		this.#options = options
		this.#started = performance.now()
		const journey = revision.journey
		this.#secret = Object.values(journey.parameters).some((parameter) => parameter.secret === true)
		this.#visible = Object.fromEntries(
			Object.entries(inputs).filter(([name]) => journey.parameters[name]?.secret !== true),
		)
		this.#slot = { id: generateBrowserRunId() }
		this.#result = this.#execute(call)
	}

	get result(): Promise<BrowserRun> {
		return this.#result
	}

	async #execute(options?: BrowserCallOptions): Promise<BrowserRun> {
		const revision = this.#revision
		const journey = revision.journey
		const inputs = this.#inputs
		const started = this.#started
		const secret = this.#secret
		const visible = this.#visible
		const steps: BrowserRunStep[] = []
		const output = this.#output
		const cleanup = this.#cleanup
		const observed = this.#observed
		try {
			this.#hold = await this.#toolset.hold(journey.name, options)
			options?.signal?.throwIfAborted()
			if (this.#options?.runs !== undefined)
				this.#slot = await this.#options.runs.create(journey.name, options)
			if (!secret) {
				this.#observe(output, cleanup, observed)
				const select = this.#observe.bind(this, output, cleanup, observed)
				this.#toolset.emitter.on('select', select)
				cleanup.push(() => this.#toolset.emitter.off('select', select))
			}
			if (
				journey.start !== undefined &&
				journey.start !== this.#toolset.redact(this.#toolset.view.url)
			) {
				const navigation = await this.#toolset.execute(
					{ id: 'start', name: 'navigate', arguments: { url: journey.start } },
					{ caller: this.#hold.token, signal: options?.signal ?? new AbortController().signal },
				)
				if (
					!navigation.result.success ||
					navigation.action?.outcome !== 'done' ||
					navigation.action.stage === 'requested' ||
					navigation.action.stage === 'committed'
				) {
					const reason = navigation.result.success
						? (navigation.action?.receipt ?? String(navigation.result.value))
						: navigation.result.error
					throw new BrowserError(
						'NAVIGATION',
						this.#toolset.redact(
							`its start page ${journey.start} did not load: ${reason.replace(/\.+$/, '')}.`,
						),
					)
				}
			}
			for (const [index, step] of journey.steps.entries()) {
				options?.signal?.throwIfAborted()
				const previous = steps.at(-1)
				const recorded = await this.#executeStep(
					step,
					inputs,
					this.#hold.token,
					previous?.outcome === 'interrupted',
					journey.parameters,
					options,
				)
				const captured = await this.#captureStep(recorded, secret, step.id, options)
				const result = captured.success ? captured.value : recorded
				steps.push(result)
				this.#emitter.emit('step', structuredClone(result))
				if (!captured.success) throw captured.error
				if (options?.signal?.aborted) {
					this.#outcome = 'aborted'
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
					this.#outcome = 'stopped'
					break
				}
			}
		} catch (error) {
			this.#outcome = options?.signal?.aborted ? 'aborted' : 'stopped'
			if (!options?.signal?.aborted)
				this.#fault = error instanceof Error ? error.message : String(error)
		} finally {
			this.#hold?.destroy()
			for (const release of cleanup) release()
		}
		const run: BrowserRun = {
			format: BROWSER_JOURNEY_FORMAT_VERSION,
			id: this.#slot.id,
			journey,
			...(revision.revision === undefined ? {} : { revision: revision.revision }),
			inputs: visible,
			steps,
			outcome: this.#outcome,
			...(secret || !this.#toolset.view.trusted ? {} : { output }),
			elapsed: performance.now() - started,
			...(this.#fault === undefined ? {} : { fault: this.#fault }),
		}
		return await this.#write(run)
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
		const result = await this.#followStep(step, args, inputs, caller, interrupted, secret, options)
		const refusal = result.success
			? undefined
			: result.error instanceof Error
				? result.error.message
				: String(result.error)
		const action = result.success
			? result.value
			: isBrowserStepError(result.error)
				? result.error.action
				: undefined
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

	async #persist(run: BrowserRun): Promise<BrowserRun> {
		if (this.#options?.runs === undefined) return run
		const signal = AbortSignal.timeout(1_000)
		const deadline = Promise.withResolvers<void>()
		const abort = deadline.reject.bind(
			undefined,
			new BrowserError('STORE_FILE', 'Writing the run timed out'),
		)
		signal.addEventListener('abort', abort, { once: true })
		try {
			await Promise.race([
				this.#options.runs.set(structuredClone(run), { signal }),
				deadline.promise,
			])
			return run
		} finally {
			signal.removeEventListener('abort', abort)
		}
	}

	async #followStep(
		step: BrowserJourneyStep,
		args: Readonly<Record<string, JSONValue>>,
		inputs: Readonly<Record<string, string>>,
		caller: string,
		interrupted: boolean,
		secret: boolean,
		options?: BrowserCallOptions,
	): Promise<Result<BrowserAction>> {
		try {
			if (step.action === 'dialog' && !interrupted)
				throw new BrowserError('JOURNEY_DIALOG', `Step ${step.id} answers no interrupted action.`)
			const action = await this.#toolset.follow(
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
			return { success: true, value: action }
		} catch (error) {
			return { success: false, error }
		}
	}

	async #captureStep(
		recorded: BrowserRunStep,
		secret: boolean,
		id: string,
		options?: BrowserCallOptions,
	): Promise<Result<BrowserRunStep>> {
		try {
			if (!secret && !options?.signal?.aborted && recorded.outcome !== 'interrupted') {
				const capture = await this.#capture(this.#slot, id, options)
				if (capture !== undefined) return { success: true, value: { ...recorded, capture } }
			}
			return { success: true, value: recorded }
		} catch (error) {
			return { success: false, error }
		}
	}

	async #write(run: BrowserRun): Promise<BrowserRun> {
		try {
			return await this.#persist(run)
		} catch (error) {
			return { ...run, fault: error instanceof Error ? error.message : String(error) }
		}
	}
}
