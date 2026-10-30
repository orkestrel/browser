import type {
	RefusesEmitterOnly,
	RefusesUntrustedlessView,
	BrowserFaceContracts,
	BrowserFaceExports,
} from '../../setupBrowser.js'
import { adoptModelContext } from '../../setupBrowser.js'
import { describe, it, expect } from 'vitest'

describe('browser face types', () => {
	it('accepts the mcp model context as a tool source', () => {
		expect(typeof adoptModelContext).toBe('function')
	})

	it('refuses a shape without adopt', () => {
		const refused: RefusesEmitterOnly = true
		expect(refused).toBe(true)
	})

	it('assigns every browser face class to the core contract it implements', () => {
		const contracts: BrowserFaceContracts = [true, true, true, true, true, true, true]
		expect(contracts).toEqual([true, true, true, true, true, true, true])
	})

	it('re-exports the public browser face types from the barrel', () => {
		const exported: BrowserFaceExports = [true, true, true, true, true]
		expect(exported).toEqual([true, true, true, true, true])
	})

	it('refuses a view shape without trusted', () => {
		const refused: RefusesUntrustedlessView = true
		expect(refused).toBe(true)
	})
})
