import type { BrowserFrameInterface, BrowserPoint, BrowserTouchInterface } from './types.js'
import { validateBrowserPoint } from './helpers.js'

/**
 * Sends trusted touch input through Chromium's CDP Input domain.
 *
 * @example
 * ```ts
 * import { BrowserTouch } from '@orkestrel/browser'
 *
 * const touch = new BrowserTouch(page)
 * await touch.tap({ x: 120, y: 240 })
 * ```
 */
export class BrowserTouch implements BrowserTouchInterface {
	readonly #frame: BrowserFrameInterface

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async tap(point: BrowserPoint): Promise<void> {
		validateBrowserPoint(point)
		const touch = { x: point.x, y: point.y }
		await this.#frame.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [touch],
		})
		try {
			await this.#frame.send('Input.dispatchTouchEvent', {
				type: 'touchEnd',
				touchPoints: [],
			})
		} catch (error) {
			await this.#frame
				.send('Input.dispatchTouchEvent', {
					type: 'touchCancel',
					touchPoints: [],
				})
				.catch(() => undefined)
			throw error
		}
	}
}
