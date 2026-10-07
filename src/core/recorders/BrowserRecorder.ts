import type {
	BrowserJourneyInput,
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
import {
	BROWSER_JOURNEY_ACTIONS,
	BROWSER_JOURNEY_NON_STEP_TOOLS,
	BROWSER_JOURNEY_STEP_KEYS,
} from '../constants.js'
import { BrowserError } from '../errors.js'
import {
	buildBrowserJourney,
	collectBrowserJourneyTextBindings,
	deriveBrowserJourneySecret,
} from '../helpers.js'

/**
 * Records semantic steps from completed toolset actions and omits refused or timed-out actions.
 * @remarks
 * Gaps mark a child frame, a held replay, or an unanswered interruption.
 * @example
 * const recorder = new BrowserRecorder(toolset)
 * await recorder.start()
 * await toolset.execute(call)
 * const steps = await recorder.stop()
 */
export class BrowserRecorder implements BrowserRecorderInterface {
	readonly #toolset: BrowserToolsetInterface
	readonly #emitter: Emitter<BrowserRecorderEventMap>
	readonly #action = this.#recordAction.bind(this)
	readonly #hold = this.#recordHold.bind(this)
	#active = false
	#steps: readonly BrowserJourneyStep[] = []
	#pending: BrowserAction | undefined

	constructor(toolset: BrowserToolsetInterface, options?: BrowserRecorderOptions) {
		this.#toolset = toolset
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
		toolset.emitter.on('action', this.#action)
		toolset.emitter.on('hold', this.#hold)
	}

	get emitter(): EmitterInterface<BrowserRecorderEventMap> {
		return this.#emitter
	}
	get active(): boolean {
		return this.#active
	}

	async start(): Promise<void> {
		if (this.#emitter.destroyed) throw new BrowserError('CLOSED', 'The recorder was destroyed')
		this.clear()
		this.#active = true
		const held = this.#toolset.held
		if (held !== undefined)
			this.#append({ action: 'unresolved', arguments: {}, gap: `replayed ${held}` })
		this.#emitter.emit('start')
	}

	async stop(): Promise<readonly BrowserJourneyStep[]> {
		this.#flushPending()
		this.#active = false
		const steps = this.steps()
		this.#emitter.emit('stop', structuredClone(steps))
		return steps
	}

	steps(): readonly BrowserJourneyStep[] {
		return structuredClone(this.#steps)
	}

	journey(options: BrowserJourneyInput): BrowserJourney {
		const steps: readonly BrowserJourneyStep[] =
			this.#pending === undefined
				? this.#steps
				: [
						...this.#steps,
						{
							id: `s${this.#steps.length + 1}`,
							action: 'unresolved',
							arguments: {},
							gap: `interrupted ${this.#pending.action}`,
						},
					]
		return buildBrowserJourney(steps, options)
	}

	clear(): void {
		this.#steps = []
		this.#pending = undefined
		this.#emitter.emit('clear')
	}

	async destroy(): Promise<void> {
		this.#active = false
		this.#pending = undefined
		this.#toolset.emitter.off('action', this.#action)
		this.#toolset.emitter.off('hold', this.#hold)
		this.#emitter.destroy()
	}

	#recordAction(action: BrowserAction): void {
		if (!this.#active || this.#toolset.held !== undefined) return
		if (this.#pending !== undefined) {
			const pending = this.#pending
			this.#pending = undefined
			if (action.action === 'dialog' && action.outcome === 'done') this.#appendAction(pending)
			else
				this.#append({ action: 'unresolved', arguments: {}, gap: `interrupted ${pending.action}` })
		}
		if (
			BROWSER_JOURNEY_NON_STEP_TOOLS.includes(action.action) ||
			action.outcome === 'refused' ||
			action.outcome === 'timeout'
		)
			return
		if (action.outcome === 'interrupted') {
			this.#pending = structuredClone(action)
			return
		}
		this.#appendAction(action)
	}

	#appendAction(action: BrowserAction): void {
		if (action.target?.frame !== undefined) {
			this.#append({ action: 'unresolved', arguments: {}, gap: 'the element is in a child frame' })
			return
		}
		const args = { ...action.arguments }
		if (BROWSER_JOURNEY_ACTIONS.some((name) => name === action.action)) {
			for (const key of BROWSER_JOURNEY_STEP_KEYS) delete args[key]
		}
		if (action.action === 'type' && action.secret === true) {
			const taken = collectBrowserJourneyTextBindings(this.#steps)
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
		if (!this.#active) return
		this.#flushPending()
		this.#append({ action: 'unresolved', arguments: {}, gap: `replayed ${name}` })
	}
}
