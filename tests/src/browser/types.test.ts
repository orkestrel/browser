import type { BrowserDOMElement } from '../../../src/browser/elements/BrowserDOMElement.js'
import type { BrowserDOMElementManager } from '../../../src/browser/elements/BrowserDOMElementManager.js'
import type {
	BrowserElementInterface,
	BrowserElementManagerInterface,
	BrowserToolSourceInterface,
	BrowserToolsetInterface,
	createBrowserToolset,
	BrowserViewInterface,
} from '@src/core'
import type {
	BrowserDOMViewOptions,
	BrowserDOMElementInput,
	BrowserDOMElementInterface,
	BrowserDOMElementManagerInput,
	BrowserDOMView,
	BrowserDOMViewInterface,
	BrowserDOMWaitInterface,
	BrowserMutationWait,
	BrowserNameContext,
	SocketCDPTransportOptions,
} from '@src/browser'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { ModelContextInterface } from '@orkestrel/mcp/browser'
import { describe, it, expect } from 'vitest'

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

// === Browser face assignability (unit U10b, R5)

/** Resolves to `true` only while the left type is assignable to the right one. */
type Assignable<TLeft, TRight> = [TLeft] extends [TRight] ? true : false

/** Holds one `true` per browser face class that satisfies the core contract it implements. */
type BrowserFaceContracts = [
	Assignable<BrowserDOMView, BrowserViewInterface>,
	Assignable<BrowserDOMView, BrowserDOMViewInterface>,
	Assignable<BrowserDOMElement, BrowserElementInterface>,
	Assignable<BrowserDOMElement, BrowserDOMElementInterface>,
	Assignable<BrowserDOMElementManager, BrowserElementManagerInterface>,
	Assignable<BrowserDOMElementManager, BrowserElementManagerInterface<BrowserDOMElementInterface>>,
	Assignable<ReturnType<typeof createBrowserToolset>, BrowserToolsetInterface>,
]

/** Holds one `true` per public browser face type the `@src/browser` barrel re-exports. */
type BrowserFaceExports = [
	Assignable<BrowserDOMViewOptions, { readonly document: Document }>,
	Assignable<BrowserNameContext, { readonly hidden?: boolean }>,
	Assignable<BrowserDOMElementInput, { readonly reference: string }>,
	Assignable<BrowserDOMElementManagerInput, { readonly signal: AbortSignal }>,
	Assignable<BrowserMutationWait<string>, { readonly subject: string }>,
	Assignable<BrowserDOMWaitInterface<string>, { readonly roots: readonly Node[] }>,
	Assignable<SocketCDPTransportOptions, { readonly url: string }>,
]

/** Resolves to `true` only while a view without `trusted` is refused by the core view contract. */
type RefusesUntrustedlessView =
	Assignable<Omit<BrowserDOMView, 'trusted'>, BrowserViewInterface> extends true ? false : true

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
		const exported: BrowserFaceExports = [true, true, true, true, true, true, true]
		expect(exported).toEqual([true, true, true, true, true, true, true])
	})

	it('refuses a view shape without trusted', () => {
		const refused: RefusesUntrustedlessView = true
		expect(refused).toBe(true)
	})
})
