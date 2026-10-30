import type { BrowserPageInterface } from './types.js'

/**
 * Retains popup arrivals for one action.
 *
 * @remarks
 * The popups announced while an action holds a popup record, with their openers; the action
 * moves the view itself, and the rest follow when it ends.
 */
export class BrowserPopupArrivals {
	readonly #entries: Array<readonly [opener: BrowserPageInterface, popup: BrowserPageInterface]> =
		[]

	get entries(): ReadonlyArray<
		readonly [opener: BrowserPageInterface, popup: BrowserPageInterface]
	> {
		return this.#entries
	}

	admit(opener: BrowserPageInterface, popup: BrowserPageInterface): void {
		this.#entries.push([opener, popup])
	}
}
