import type {
	BrowserAccessibilityInterface,
	BrowserAccessibilityOptions,
	BrowserAccessibilitySnapshot,
	BrowserFrameInterface,
} from './types.js'
import { readBrowserAccessibility, validateBrowserAccessibilityOptions } from './helpers.js'

/**
 * Chromium Accessibility-domain snapshots for one page.
 */
export class BrowserAccessibility implements BrowserAccessibilityInterface {
	readonly #frame: BrowserFrameInterface

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async snapshot(options?: BrowserAccessibilityOptions): Promise<BrowserAccessibilitySnapshot> {
		validateBrowserAccessibilityOptions(options)
		await this.#frame.send('Accessibility.enable')
		try {
			const result =
				options?.root === undefined
					? await this.#frame.send('Accessibility.getFullAXTree', {
							depth: options?.depth,
							frameId: this.#frame.id,
						})
					: await this.#frame.send('Accessibility.getPartialAXTree', {
							backendNodeId: options.root,
							fetchRelatives: true,
						})
			return readBrowserAccessibility(result)
		} finally {
			await this.#frame.send('Accessibility.disable').catch(() => undefined)
		}
	}
}
