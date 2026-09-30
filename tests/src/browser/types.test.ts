import { describe, it, expect } from 'vitest'
import type { BrowserToolSourceInterface } from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ModelContextInterface } from '@orkestrel/mcp/browser'

// === Tool source assignability (unit U9, E4)

/** Compiles only while the mcp model context satisfies the tool source contract. */
function adoptModelContext(context: ModelContextInterface): BrowserToolSourceInterface {
	return context
}

/** Resolves to `true` only while the contract refuses a shape without `adopt`. */
type RefusesEmitterOnly = {
	readonly emitter: EmitterInterface<{ readonly change: readonly [] }>
} extends BrowserToolSourceInterface
	? false
	: true

describe('browser face types', () => {
	it('accepts the mcp model context as a tool source', () => {
		expect(typeof adoptModelContext).toBe('function')
	})

	it('refuses a shape without adopt', () => {
		const refused: RefusesEmitterOnly = true
		expect(refused).toBe(true)
	})
})
