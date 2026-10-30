import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	BrowserCallOptions,
	BrowserJourneyRevision,
	BrowserReplayEventMap,
	BrowserReplayInterface,
	BrowserReplayOptions,
	BrowserRun,
	BrowserToolsetInterface,
} from './types.js'
import { isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BROWSER_JOURNEY_ACTIONS } from './constants.js'
import { BrowserError, isBrowserError } from './errors.js'
import { validateBrowserJourney } from './helpers.js'
import { BrowserReplayExecution } from './BrowserReplayExecution.js'
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
		if (this.#toolset.emitter.destroyed)
			throw new BrowserError('CLOSED', 'The browser session ended', { subject: 'toolset' })
		return await new BrowserReplayExecution(
			this.#toolset,
			revision,
			inputs,
			this.#emitter,
			this.#options,
			options,
		).result
	}

	#prepare(): Readonly<Record<string, string>> {
		const journey = this.#revision.journey
		const placement = this.#toolset.native.some((tool) => tool.name === 'navigate') ? 'page' : 'dom'
		try {
			validateBrowserJourney(journey)
		} catch (error) {
			if (!isBrowserError(error)) throw error
			throw new BrowserError(
				error.code,
				error.message,
				error.context ?? { action: 'replay', placement },
			)
		}
		const supplied = this.#options?.inputs ?? {}
		for (const name of Object.keys(supplied)) {
			if (!Object.hasOwn(journey.parameters, name))
				throw new BrowserError(
					'JOURNEY_INPUT',
					`Journey ${journey.name} has no parameter named ${JSON.stringify(name)}.`,
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
					'JOURNEY_INPUT',
					`Journey ${journey.name} needs input ${JSON.stringify(name)}.`,
					{ parameter: name },
				)
		}
		const inputs: Record<string, string> = {}
		for (const [name, parameter] of parameters) {
			const value = values.get(name)
			if (isString(value)) inputs[name] = value
			else if (value !== undefined)
				throw new BrowserError(
					'JOURNEY_INPUT',
					`Journey ${journey.name} input ${JSON.stringify(name)} is not a string.`,
					{ parameter: name },
				)
			else if (parameter.default !== undefined) inputs[name] = parameter.default
		}
		for (const step of journey.steps) {
			if (step.action === 'unresolved')
				throw new BrowserError('JOURNEY_GAP', `Step ${step.id} is unresolved: ${step.gap}.`, {
					step: step.id,
				})
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
						'JOURNEY_PLACEMENT',
						`Step ${step.id} cannot execute ${step.action} in this placement.`,
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
}
