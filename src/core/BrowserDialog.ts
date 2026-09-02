import type {
	BrowserDialogCategory,
	BrowserDialogInterface,
	BrowserFrameInterface,
} from './types.js'
import { BrowserError } from './errors.js'

/**
 * Represents one JavaScript dialog awaiting a user decision.
 */
export class BrowserDialog implements BrowserDialogInterface {
	readonly #frame: BrowserFrameInterface
	readonly #category: BrowserDialogCategory
	readonly #message: string
	readonly #default: string
	#handled = false
	#handling = false

	constructor(
		frame: BrowserFrameInterface,
		category: BrowserDialogCategory,
		message: string,
		value: string,
	) {
		this.#frame = frame
		this.#category = category
		this.#message = message
		this.#default = value
	}

	get category(): BrowserDialogCategory {
		return this.#category
	}

	get message(): string {
		return this.#message
	}

	get default(): string {
		return this.#default
	}

	async accept(value?: string): Promise<void> {
		this.#assert()
		this.#handling = true
		try {
			await this.#frame.send('Page.handleJavaScriptDialog', {
				accept: true,
				promptText: value,
			})
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	async dismiss(): Promise<void> {
		this.#assert()
		this.#handling = true
		try {
			await this.#frame.send('Page.handleJavaScriptDialog', { accept: false })
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	#assert(): void {
		if (this.#handled || this.#handling) {
			throw new BrowserError('Browser dialog is already handled')
		}
	}
}
