import { describe, expect, it } from 'vitest'
import { attempt } from '@orkestrel/contract'
import {
	isBrowserSecretBinding,
	isBrowserJourneyBinding,
	isBrowserJourneyTab,
	isBrowserJourneyTarget,
	isBrowserJourneyValidationContext,
	validateBrowserJourney,
	validateBrowserJourneyEdit,
	validateBrowserJourneyParameter,
	validateBrowserJourneyStep,
	validateBrowserRun,
} from '@src/core'
import {
	BROWSER_JOURNEY_FIXTURE,
	BROWSER_JOURNEY_INVALID_CASES,
	BROWSER_JOURNEY_TEMPLATE_CASES,
	BROWSER_RUN_FIXTURE,
} from '../../setup.js'

describe('journey validators', () => {
	it('recognizes binding coordinates and contains hostile context reads', () => {
		expect(
			isBrowserJourneyValidationContext({ parameter: 'email', step: 's4', field: 'text' }),
		).toBe(true)
		expect(isBrowserJourneyValidationContext({ parameter: 'email', step: 's4' })).toBe(false)
		expect(isBrowserJourneyValidationContext({ parameter: 'email', step: 4, field: 'text' })).toBe(
			false,
		)
		expect(isBrowserJourneyValidationContext(undefined)).toBe(false)
		expect(
			isBrowserJourneyValidationContext(
				new Proxy(
					{},
					{
						get: () => {
							throw new Error('hostile context')
						},
					},
				),
			),
		).toBe(false)
	})
	it('names the undeclared binding coordinates in the validation context', () => {
		expect(
			attempt(() =>
				validateBrowserJourney({
					...BROWSER_JOURNEY_FIXTURE,
					parameters: {},
				}),
			),
		).toMatchObject({
			success: false,
			error: { context: { parameter: 'email', step: 's4', field: 'text' } },
		})
	})
	it('recognizes only declared secret type.text bindings and contains hostile reads', () => {
		const step = { action: 'type', arguments: { text: { parameter: 'password' } } }
		const parameters = { password: { secret: true } }
		expect(isBrowserSecretBinding(step, parameters)).toBe(true)
		expect(isBrowserSecretBinding({ ...step, action: 'wait' }, parameters)).toBe(false)
		expect(isBrowserSecretBinding(step, {})).toBe(false)
		expect(isBrowserSecretBinding(step, { password: { secret: false } })).toBe(false)
		expect(
			isBrowserSecretBinding({ action: 'type', arguments: { text: 'literal' } }, parameters),
		).toBe(false)
		expect(isBrowserSecretBinding(undefined, parameters)).toBe(false)
		expect(isBrowserSecretBinding(step, null)).toBe(false)
		expect(
			isBrowserSecretBinding(
				new Proxy(step, {
					get: () => {
						throw new Error('hostile step')
					},
				}),
				parameters,
			),
		).toBe(false)
		expect(
			isBrowserSecretBinding(
				step,
				new Proxy(parameters, {
					get: () => {
						throw new Error('hostile parameters')
					},
				}),
			),
		).toBe(false)
	})
	it.each(BROWSER_JOURNEY_INVALID_CASES)(
		'refuses invariant $invariant: $name',
		({ value, invariant }) => {
			const result = attempt(() => validateBrowserJourney(value))
			expect(result).toMatchObject({
				success: false,
				error: {
					code: 'BROWSER_JOURNEY_INVALID',
					message: expect.stringContaining(`Invariant ${invariant}`),
				},
			})
		},
	)
	it('refuses unknown formats with the format code', () => {
		expect(
			attempt(() => validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, format: 2 })),
		).toMatchObject({ success: false, error: { code: 'BROWSER_JOURNEY_FORMAT' } })
		expect(attempt(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, format: 2 }))).toMatchObject({
			success: false,
			error: { code: 'BROWSER_JOURNEY_FORMAT' },
		})
	})
	it('refuses a secret bound to wait.text', () => {
		expect(
			attempt(() =>
				validateBrowserJourney({
					...BROWSER_JOURNEY_FIXTURE,
					parameters: { password: { secret: true } },
					steps: [{ id: 's1', action: 'wait', arguments: { text: { parameter: 'password' } } }],
				}),
			),
		).toMatchObject({
			success: false,
			error: {
				code: 'BROWSER_JOURNEY_INVALID',
				message: 'Invariant 5 (secrets): binds secret "password" outside type.text',
				context: { parameter: 'password', step: 's1', field: 'text' },
			},
		})
	})
	it('refuses a secret target but accepts a secret type.text', () => {
		expect(() =>
			validateBrowserJourney({
				...BROWSER_JOURNEY_FIXTURE,
				parameters: { email: { secret: true } },
			}),
		).not.toThrow()
		expect(() =>
			validateBrowserJourney({
				...BROWSER_JOURNEY_FIXTURE,
				parameters: { password: { secret: true } },
				steps: [
					{
						id: 's1',
						action: 'click',
						arguments: {},
						target: { role: 'button', name: { parameter: 'password' } },
					},
				],
			}),
		).toThrow('Invariant 5')
	})
	it.each(BROWSER_JOURNEY_TEMPLATE_CASES)('accepts the $line shape', ({ step }) => {
		expect(() => validateBrowserJourneyStep(step)).not.toThrow()
	})
	it('validates the binding, target, tab, and parameter leaves', () => {
		expect(isBrowserJourneyBinding({ parameter: 'email' })).toBe(true)
		expect(isBrowserJourneyBinding({ parameter: 'Email' })).toBe(false)
		expect(isBrowserJourneyBinding({ parameter: 'email', extra: true })).toBe(false)
		expect(
			isBrowserJourneyTarget({ role: 'button', name: 'Save', css: '#save', reference: 'e1' }),
		).toBe(true)
		expect(isBrowserJourneyTarget({ role: '', name: 'Save' })).toBe(false)
		expect(isBrowserJourneyTab({ url: 'https://example.test/', title: 'Cart' })).toBe(true)
		expect(isBrowserJourneyTab({ url: 7, title: 'Cart' })).toBe(false)
		expect(() => validateBrowserJourneyParameter({ secret: false, default: 'Ada' })).not.toThrow()
		expect(() => validateBrowserJourneyParameter({ secret: 'yes' })).toThrow(Error)
		expect(() =>
			validateBrowserJourneyEdit({ operation: 'declare', name: 'email', parameter: {} }),
		).not.toThrow()
	})
	it('refuses cycles and non JSON values', () => {
		const cycle: Record<string, unknown> = { ...BROWSER_JOURNEY_FIXTURE }
		cycle['self'] = cycle
		expect(() => validateBrowserJourney(cycle)).toThrow('Invariant 6')
		expect(() => validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, next: Infinity })).toThrow(
			'Invariant 6',
		)
		expect(() =>
			validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, next: Number.MAX_SAFE_INTEGER + 1 }),
		).toThrow('Invariant 2')
	})
	it('validates runs and rejects malformed prefixes and optional fields', () => {
		expect(() => validateBrowserRun(BROWSER_RUN_FIXTURE)).not.toThrow()
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, elapsed: -1 })).toThrow(Error)
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, inputs: { email: 7 } })).toThrow(
			Error,
		)
		expect(() =>
			validateBrowserRun({
				...BROWSER_RUN_FIXTURE,
				steps: [{ ...BROWSER_RUN_FIXTURE.steps[0], id: 's2' }],
			}),
		).toThrow(Error)
		expect(() =>
			validateBrowserRun({
				...BROWSER_RUN_FIXTURE,
				steps: [{ ...BROWSER_RUN_FIXTURE.steps[0], stage: 'pending' }],
			}),
		).toThrow(Error)
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, output: [7] })).toThrow(Error)
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, revision: 0 })).toThrow(Error)
	})
	it('refuses secret inputs, output, and captures in run files', () => {
		const journey = { ...BROWSER_JOURNEY_FIXTURE, parameters: { email: { secret: true } } }
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, journey })).toThrow('Invariant 5')
		expect(() =>
			validateBrowserRun({ ...BROWSER_RUN_FIXTURE, journey, inputs: {}, output: [] }),
		).toThrow('Invariant 5')
		expect(() =>
			validateBrowserRun({
				...BROWSER_RUN_FIXTURE,
				journey,
				inputs: {},
				steps: [{ ...BROWSER_RUN_FIXTURE.steps[0], capture: 's1.png' }],
			}),
		).toThrow('Invariant 5')
	})
})

describe('journey boundary validation', () => {
	it('keeps leaf guards total for hostile getters', () => {
		const binding = Object.defineProperty({}, 'parameter', {
			get: () => {
				throw new Error('hostile')
			},
			enumerable: true,
		})
		const target = Object.defineProperty({}, 'role', {
			get: () => {
				throw new Error('hostile')
			},
			enumerable: true,
		})
		const tab = Object.defineProperty({}, 'url', {
			get: () => {
				throw new Error('hostile')
			},
			enumerable: true,
		})
		expect(isBrowserJourneyBinding(binding)).toBe(false)
		expect(isBrowserJourneyTarget(target)).toBe(false)
		expect(isBrowserJourneyTab(tab)).toBe(false)
	})
	it('rejects native target and tab mismatches', () => {
		expect(() =>
			validateBrowserJourneyStep({
				action: 'press',
				arguments: { key: 'Enter' },
				target: { role: 'button', name: 'Save' },
			}),
		).toThrow('Invariant 3')
		expect(() => validateBrowserJourneyStep({ action: 'switch', arguments: {} })).toThrow(
			'Invariant 3',
		)
		expect(() =>
			validateBrowserJourneyStep({
				action: 'navigate',
				arguments: { url: 'https://example.test/', tab: 't1' },
			}),
		).toThrow('Invariant 3')
		expect(() =>
			validateBrowserJourneyStep({
				action: 'type',
				arguments: { text: 'Ada', submit: 'yes' },
				target: { role: 'textbox', name: 'Name' },
			}),
		).toThrow('Invariant 7')
		expect(() => validateBrowserJourneyStep({ action: 'unresolved', arguments: {} })).toThrow(
			'Invariant 7',
		)
	})
	it('rejects malformed parameters and id spellings', () => {
		expect(() =>
			validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, parameters: { Email: {} } }),
		).toThrow('Invariant 4')
		expect(() =>
			validateBrowserJourney({
				...BROWSER_JOURNEY_FIXTURE,
				steps: [{ id: 's01', action: 'wait', arguments: { text: 'ready' } }],
			}),
		).toThrow('Invariant 2')
		expect(() => validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, next: 0 })).toThrow(
			'Invariant 2',
		)
		expect(() => validateBrowserJourney({ ...BROWSER_JOURNEY_FIXTURE, next: 1.5 })).toThrow(
			'Invariant 2',
		)
	})
	it('refuses a complete run with an incomplete prefix or a failed step', () => {
		expect(() => validateBrowserRun({ ...BROWSER_RUN_FIXTURE, steps: [] })).toThrow(
			'Run completion',
		)
		expect(() =>
			validateBrowserRun({
				...BROWSER_RUN_FIXTURE,
				steps: BROWSER_RUN_FIXTURE.steps.map((step) => ({ ...step, outcome: 'refused' })),
			}),
		).toThrow('Run completion')
		expect(() =>
			validateBrowserRun({ ...BROWSER_RUN_FIXTURE, inputs: { unknown: 'Ada' } }),
		).toThrow('unknown input')
	})
	it('refuses secret text retained in a run step', () => {
		expect(() =>
			validateBrowserRun({
				...BROWSER_RUN_FIXTURE,
				journey: { ...BROWSER_JOURNEY_FIXTURE, parameters: { email: { secret: true } } },
				inputs: {},
			}),
		).toThrow('Invariant 5 (secrets): run retains secret type.text')
	})
})
