import type {
	BrowserJourney,
	BrowserJourneyEdit,
	BrowserJourneyStep,
	BrowserJourneyParameter,
	BrowserJourneyEditorInterface,
} from './types.js'
import { isString } from '@orkestrel/contract'
import { BrowserError, isBrowserError } from './errors.js'
import { isBrowserJourneyValidationContext } from './validators.js'
import {
	validateBrowserJourney,
	validateBrowserJourneyEdit,
	validateBrowserJourneyStep,
	collectBrowserJourneyBindings,
	normalizeBrowserJourneyReason,
} from './helpers.js'

/** Applies one journey edit batch and retains the edit responsible for a refusal. */
export class BrowserJourneyEditor implements BrowserJourneyEditorInterface {
	readonly #steps: BrowserJourneyStep[]
	#parameters: Readonly<Record<string, BrowserJourneyParameter>>
	#next: number
	#index = 0
	#removal = 0
	readonly #declarations = new Map<string, number>()
	readonly #origins = new Map<string, number>()
	readonly #secrets = new Map<string, number>()
	readonly journey: BrowserJourney

	constructor(journey: BrowserJourney, edits: readonly BrowserJourneyEdit[]) {
		validateBrowserJourney(journey)
		this.#steps = [...journey.steps]
		this.#parameters = { ...journey.parameters }
		this.#next = journey.next
		this.journey = this.#edit(journey, edits)
	}

	#apply(edit: BrowserJourneyEdit): void {
		this.#index += 1
		validateBrowserJourneyEdit(edit)
		switch (edit.operation) {
			case 'add': {
				const anchor = edit.before ?? edit.after
				const position =
					anchor === undefined
						? this.#steps.length
						: this.#steps.findIndex((step) => step.id === anchor)
				if (position < 0) throw new BrowserError('ARGUMENT', `names unknown anchor "${anchor}"`)
				const step = { ...edit.step, id: `s${this.#next}` }
				this.#next += 1
				if (!Number.isSafeInteger(this.#next))
					throw new BrowserError('ARGUMENT', 'Invariant 2 (ids): has an invalid next counter')
				for (const field of [...Object.keys(step.arguments), 'target.name'])
					this.#origins.set(step.id + '.' + field, this.#index)
				this.#steps.splice(position + (edit.after === undefined ? 0 : 1), 0, step)
				break
			}
			case 'remove':
			case 'update': {
				const position = this.#steps.findIndex((step) => step.id === edit.id)
				const step = this.#steps[position]
				if (step === undefined)
					throw new BrowserError('ARGUMENT', `names unknown step "${edit.id}"`)
				if (edit.operation === 'remove') {
					this.#steps.splice(position, 1)
					this.#removal = this.#index
				} else {
					const updated = {
						...step,
						arguments: { ...step.arguments, ...edit.arguments },
						...(edit.target === undefined ? {} : { target: edit.target }),
						...(edit.tab === undefined ? {} : { tab: edit.tab }),
					}
					validateBrowserJourneyStep(updated)
					const fields = [
						...Object.entries(edit.arguments ?? {}),
						...(edit.target === undefined ? [] : [['target.name', edit.target.name]]),
					]
					for (const [field, value] of fields) {
						if (!isString(field)) continue
						const previous = field === 'target.name' ? step.target?.name : step.arguments[field]
						if (JSON.stringify(previous) !== JSON.stringify(value))
							this.#origins.set(step.id + '.' + field, this.#index)
					}
					this.#steps[position] = updated
				}
				break
			}
			case 'declare':
				if (edit.parameter.secret !== this.#parameters[edit.name]?.secret)
					this.#secrets.set(edit.name, this.#index)
				this.#parameters = { ...this.#parameters, [edit.name]: edit.parameter }
				this.#declarations.set(edit.name, this.#index)
		}
	}

	#edit(journey: BrowserJourney, edits: readonly BrowserJourneyEdit[]): BrowserJourney {
		try {
			Iterator.from(edits).forEach(this.#apply.bind(this))
			if (this.#steps.length === 0) {
				this.#index = this.#removal
				throw new BrowserError('ARGUMENT', 'removes the last step')
			}
			const bindings = collectBrowserJourneyBindings(this.#steps)
			for (const [name, declaration] of this.#declarations) {
				if (!bindings.has(name)) {
					this.#index = declaration
					throw new BrowserError('ARGUMENT', `declares "${name}" but no step binds it`)
				}
			}
			this.#parameters = Object.fromEntries(
				Object.entries(this.#parameters).filter(([name]) => bindings.has(name)),
			)
			const candidate = {
				...journey,
				steps: this.#steps,
				parameters: this.#parameters,
				next: this.#next,
			}
			try {
				validateBrowserJourney(candidate)
			} catch (error) {
				if (isBrowserError(error) && isBrowserJourneyValidationContext(error.context)) {
					const { parameter, step, field } = error.context
					this.#index = Math.max(
						this.#origins.get(step + '.' + field) ?? 0,
						this.#secrets.get(parameter) ?? 0,
					)
				}
				throw error
			}
			return structuredClone(candidate)
		} catch (error) {
			const reason = normalizeBrowserJourneyReason(error)
			throw new BrowserError(
				'JOURNEY_EDIT',
				`Edit ${this.#index} is refused: ${reason.startsWith('its ') ? reason : `it ${reason}`}`,
				{
					index: this.#index,
					reason,
				},
			)
		}
	}
}
