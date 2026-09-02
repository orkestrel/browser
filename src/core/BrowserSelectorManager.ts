import type {
	BrowserFrameInterface,
	BrowserLocatorInterface,
	BrowserRoleOptions,
	BrowserSelectorManagerInterface,
	BrowserTextOptions,
} from './types.js'
import { BrowserLocator } from './BrowserLocator.js'

/**
 * Semantic locator factory for one frame.
 *
 * @example
 * ```ts
 * import { BrowserSelectorManager } from '@orkestrel/browser'
 *
 * const selectors = new BrowserSelectorManager(page)
 * await selectors.role('button', { name: 'Save' }).click()
 * await selectors.testId('checkout').click()
 * ```
 */
export class BrowserSelectorManager implements BrowserSelectorManagerInterface {
	readonly #frame: BrowserFrameInterface

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	css(value: string): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, { selector: 'css', value })
	}

	role(value: string, options?: BrowserRoleOptions): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, {
			selector: 'role',
			value,
			...(options?.name !== undefined ? { name: options.name } : {}),
			...(options?.exact !== undefined ? { exact: options.exact } : {}),
		})
	}

	text(value: string, options?: BrowserTextOptions): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, {
			selector: 'text',
			value,
			...(options?.exact !== undefined ? { exact: options.exact } : {}),
		})
	}

	label(value: string, options?: BrowserTextOptions): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, {
			selector: 'label',
			value,
			...(options?.exact !== undefined ? { exact: options.exact } : {}),
		})
	}

	placeholder(value: string, options?: BrowserTextOptions): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, {
			selector: 'placeholder',
			value,
			...(options?.exact !== undefined ? { exact: options.exact } : {}),
		})
	}

	testId(value: string): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, { selector: 'testId', value })
	}
}
