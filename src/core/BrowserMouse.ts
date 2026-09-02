import type {
	BrowserClickOptions,
	BrowserDragOptions,
	BrowserFrameInterface,
	BrowserMouseButton,
	BrowserMouseInterface,
	BrowserPoint,
} from './types.js'
import {
	computeBrowserButtons,
	validateBrowserInputOptions,
	validateBrowserPoint,
} from './helpers.js'

/**
 * Sends trusted mouse input through Chromium's CDP Input domain.
 *
 * @example
 * ```ts
 * import { BrowserMouse } from '@orkestrel/browser'
 *
 * const mouse = new BrowserMouse(page)
 * await mouse.click({ x: 50, y: 20 }, { button: 'left', count: 2 })
 * await mouse.drag({ x: 10, y: 10 }, { x: 90, y: 90 }, { steps: 20 })
 * ```
 */
export class BrowserMouse implements BrowserMouseInterface {
	readonly #frame: BrowserFrameInterface
	readonly #buttons = new Set<BrowserMouseButton>()
	#point: BrowserPoint = { x: 0, y: 0 }

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async move(point: BrowserPoint): Promise<void> {
		validateBrowserPoint(point)
		this.#point = point
		await this.#frame.send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: point.x,
			y: point.y,
			button: 'none',
			buttons: computeBrowserButtons([...this.#buttons]),
		})
	}

	async down(button: BrowserMouseButton = 'left', count = 1): Promise<void> {
		validateBrowserInputOptions({ count })
		const buttons = new Set(this.#buttons)
		buttons.add(button)
		await this.#frame.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x: this.#point.x,
			y: this.#point.y,
			button,
			buttons: computeBrowserButtons([...buttons]),
			clickCount: count,
		})
		this.#buttons.add(button)
	}

	async up(button: BrowserMouseButton = 'left', count = 1): Promise<void> {
		validateBrowserInputOptions({ count })
		const buttons = new Set(this.#buttons)
		buttons.delete(button)
		try {
			await this.#frame.send('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				x: this.#point.x,
				y: this.#point.y,
				button,
				buttons: computeBrowserButtons([...buttons]),
				clickCount: count,
			})
		} finally {
			this.#buttons.delete(button)
		}
	}

	async click(point: BrowserPoint, options?: BrowserClickOptions): Promise<void> {
		validateBrowserInputOptions(options)
		const button = options?.button ?? 'left'
		const count = options?.count ?? 1
		await this.move(point)
		await this.down(button, count)
		if (options?.delay !== undefined && options.delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, options.delay))
		}
		await this.up(button, count)
	}

	async drag(start: BrowserPoint, end: BrowserPoint, options?: BrowserDragOptions): Promise<void> {
		validateBrowserInputOptions(options)
		validateBrowserPoint(start)
		validateBrowserPoint(end)
		const steps = options?.steps ?? 10
		await this.move(start)
		await this.down(options?.button ?? 'left', 1)
		try {
			for (let step = 1; step <= steps; step += 1) {
				await this.move({
					x: start.x + ((end.x - start.x) * step) / steps,
					y: start.y + ((end.y - start.y) * step) / steps,
				})
				if (options?.delay !== undefined && options.delay > 0) {
					await new Promise((resolve) => setTimeout(resolve, options.delay))
				}
			}
		} finally {
			await this.up(options?.button ?? 'left', 1)
		}
	}

	async wheel(delta: BrowserPoint): Promise<void> {
		validateBrowserPoint(delta)
		await this.#frame.send('Input.dispatchMouseEvent', {
			type: 'mouseWheel',
			x: this.#point.x,
			y: this.#point.y,
			deltaX: delta.x,
			deltaY: delta.y,
			buttons: computeBrowserButtons([...this.#buttons]),
		})
	}
}
