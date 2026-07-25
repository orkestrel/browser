import type { BrowserFileChooserInterface, BrowserFrameInterface } from './types.js'
import { BrowserError } from './errors.js'

/**
 * One intercepted file input selection.
 */
export class BrowserFileChooser implements BrowserFileChooserInterface {
	readonly #frame: BrowserFrameInterface
	readonly #backend: number
	readonly #multiple: boolean
	#handled = false
	#handling = false

	constructor(frame: BrowserFrameInterface, backend: number, multiple: boolean) {
		this.#frame = frame
		this.#backend = backend
		this.#multiple = multiple
	}

	get multiple(): boolean {
		return this.#multiple
	}

	async upload(files: readonly string[]): Promise<void> {
		this.#assert()
		if (!this.#multiple && files.length > 1) {
			throw new BrowserError('Single file chooser cannot accept multiple files')
		}
		this.#handling = true
		try {
			await this.#frame.send('DOM.setFileInputFiles', {
				backendNodeId: this.#backend,
				files: [...files],
			})
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	async cancel(): Promise<void> {
		this.#assert()
		this.#handling = true
		try {
			await this.#frame.send('DOM.setFileInputFiles', {
				backendNodeId: this.#backend,
				files: [],
			})
			this.#handled = true
		} finally {
			this.#handling = false
		}
	}

	#assert(): void {
		if (this.#handled || this.#handling) {
			throw new BrowserError('Browser file chooser is already handled')
		}
	}
}
