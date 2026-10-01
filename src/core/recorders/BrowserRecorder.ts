import type {
	BrowserAction,
	BrowserJourney,
	BrowserJourneyStep,
	BrowserJourneyStepInput,
	BrowserRecorderEventMap,
	BrowserRecorderInterface,
	BrowserRecorderOptions,
	BrowserToolsetInterface,
} from '../types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { Emitter } from '@orkestrel/emitter'
import { BROWSER_JOURNEY_ACTIONS } from '../constants.js'
import { BrowserError } from '../errors.js'
import { buildBrowserJourney, deriveBrowserJourneySecret } from '../helpers.js'

/**
 * Records semantic steps from completed toolset actions and marks replay boundaries as gaps.
 * @example
 * const recorder = new BrowserRecorder(toolset)
 * await recorder.start()
 * await toolset.perform(call)
 * const steps = await recorder.stop()
 */
export class BrowserRecorder implements BrowserRecorderInterface {
	readonly #toolset: BrowserToolsetInterface
	readonly #emitter: Emitter<BrowserRecorderEventMap>
	readonly #action = this.#recordAction.bind(this)
	readonly #hold = this.#recordHold.bind(this)
	readonly #release = this.#recordRelease.bind(this)
	#started = false
	#steps: readonly BrowserJourneyStep[] = []
	#pending: BrowserAction | undefined
	#held: string | undefined

	constructor(toolset: BrowserToolsetInterface, options?: BrowserRecorderOptions) {
		this.#toolset = toolset
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
		toolset.emitter.on('action', this.#action)
		toolset.emitter.on('hold', this.#hold)
		toolset.emitter.on('release', this.#release)
	}

	get emitter(): EmitterInterface<BrowserRecorderEventMap> {
		return this.#emitter
	}
	get started(): boolean {
		return this.#started
	}

	async start(): Promise<void> {
		if (this.#emitter.destroyed) throw new BrowserError('The recorder was destroyed')
		this.clear()
		this.#started = true
		if (this.#held !== undefined)
			this.#append({ action: 'unresolved', arguments: {}, gap: `replayed ${this.#held}` })
		this.#emitter.emit('start')
	}

	async stop(): Promise<readonly BrowserJourneyStep[]> {
		this.#flushPending()
		this.#started = false
		const steps = this.steps()
		this.#emitter.emit('stop', structuredClone(steps))
		return steps
	}

	steps(): readonly BrowserJourneyStep[] {
		return structuredClone(this.#steps)
	}

	journey(options: { readonly name: string; readonly description: string }): BrowserJourney {
		return buildBrowserJourney(this.#steps, options)
	}

	clear(): void {
		this.#steps = []
		this.#pending = undefined
		this.#emitter.emit('clear')
	}

	async destroy(): Promise<void> {
		this.#started = false
		this.#pending = undefined
		this.#toolset.emitter.off('action', this.#action)
		this.#toolset.emitter.off('hold', this.#hold)
		this.#toolset.emitter.off('release', this.#release)
		this.#emitter.destroy()
	}

	#recordAction(action: BrowserAction): void {
		if (!this.#started || this.#held !== undefined) return
		if (this.#pending !== undefined) {
			const pending = this.#pending
			this.#pending = undefined
			if (action.action === 'dialog' && action.outcome === 'done') this.#appendAction(pending)
			else
				this.#append({ action: 'unresolved', arguments: {}, gap: `interrupted ${pending.action}` })
		}
		if (
			['look', 'read', 'tabs', 'record', 'save', 'journeys', 'edit', 'replay'].includes(
				action.action,
			) ||
			action.outcome === 'refused'
		)
			return
		if (action.outcome === 'interrupted') {
			this.#pending = structuredClone(action)
			return
		}
		if (action.outcome === 'done') this.#appendAction(action)
		else
			this.#append({
				action: 'unresolved',
				arguments: {},
				gap: `${action.outcome} ${action.action}`,
			})
	}

	#appendAction(action: BrowserAction): void {
		if (action.target?.frame !== undefined) {
			this.#append({ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' })
			return
		}
		const args = { ...action.arguments }
		if (BROWSER_JOURNEY_ACTIONS.some((name) => name === action.action)) {
			delete args['ref']
			delete args['tab']
			delete args['secret']
		}
		if (action.action === 'type' && action.secret === true) {
			const taken = this.#steps.flatMap((step) => {
				const value = step.arguments['text']
				return typeof value === 'object' &&
					value !== null &&
					'parameter' in value &&
					typeof value.parameter === 'string'
					? [value.parameter]
					: []
			})
			args['text'] = { parameter: deriveBrowserJourneySecret(action.target?.name ?? '', taken) }
		}
		this.#append({
			action: action.action,
			arguments: args,
			...(action.target === undefined
				? {}
				: {
						target: {
							role: action.target.role,
							name: action.target.name,
							reference: action.target.reference,
						},
					}),
			// A click that opened a popup carries the popup's tab as settlement evidence; only a switch
			// step names a tab.
			...(action.action !== 'switch' || action.tab === undefined ? {} : { tab: action.tab }),
		})
	}

	#append(step: BrowserJourneyStepInput): void {
		const recorded = structuredClone({ ...step, id: `s${this.#steps.length + 1}` })
		this.#steps = [...this.#steps, recorded]
		this.#emitter.emit('step', structuredClone(recorded))
	}

	#flushPending(): void {
		if (this.#pending === undefined) return
		const pending = this.#pending
		this.#pending = undefined
		this.#append({ action: 'unresolved', arguments: {}, gap: `interrupted ${pending.action}` })
	}

	#recordHold(name: string): void {
		this.#held = name
		if (!this.#started) return
		this.#flushPending()
		this.#append({ action: 'unresolved', arguments: {}, gap: `replayed ${name}` })
	}

	#recordRelease(name: string): void {
		if (this.#held === name) this.#held = undefined
	}
}
