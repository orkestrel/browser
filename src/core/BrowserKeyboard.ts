import type {
	BrowserFrameInterface,
	BrowserInputOptions,
	BrowserKeyboardInterface,
} from './types.js'
import {
	computeBrowserModifiers,
	keyToBrowserInput,
	parseBrowserChord,
	validateBrowserInputOptions,
} from './helpers.js'

/**
 * Sends trusted keyboard input through Chromium's CDP Input domain.
 *
 * @example
 * ```ts
 * import { BrowserKeyboard } from '@orkestrel/browser'
 *
 * const keyboard = new BrowserKeyboard(page)
 * await keyboard.type('orkestrel', { delay: 10 })
 * await keyboard.press('Control+Enter')
 * ```
 */
export class BrowserKeyboard implements BrowserKeyboardInterface {
	readonly #frame: BrowserFrameInterface
	readonly #modifiers = new Set<string>()

	constructor(frame: BrowserFrameInterface) {
		this.#frame = frame
	}

	async down(value: string): Promise<void> {
		const key = keyToBrowserInput(value)
		const modifier = ['Alt', 'Control', 'Meta', 'Shift'].includes(key.key)
		const modifiers = computeBrowserModifiers([...this.#modifiers, ...(modifier ? [key.key] : [])])
		const text = modifiers === 0 || modifiers === 8 ? key.text : undefined
		await this.#frame.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: key.key,
			code: key.code,
			text,
			unmodifiedText: key.text,
			windowsVirtualKeyCode: key.number,
			nativeVirtualKeyCode: key.number,
			modifiers,
		})
		if (modifier) this.#modifiers.add(key.key)
	}

	async up(value: string): Promise<void> {
		const key = keyToBrowserInput(value)
		try {
			await this.#frame.send('Input.dispatchKeyEvent', {
				type: 'keyUp',
				key: key.key,
				code: key.code,
				windowsVirtualKeyCode: key.number,
				nativeVirtualKeyCode: key.number,
				modifiers: computeBrowserModifiers([...this.#modifiers]),
			})
		} finally {
			this.#modifiers.delete(key.key)
		}
	}

	async press(value: string, options?: BrowserInputOptions): Promise<void> {
		validateBrowserInputOptions(options)
		const chord = parseBrowserChord(value)
		for (const modifier of chord.modifiers) await this.down(modifier)
		try {
			await this.down(chord.key)
			if (options?.delay !== undefined && options.delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, options.delay))
			}
			await this.up(chord.key)
		} finally {
			for (const modifier of [...chord.modifiers].reverse()) await this.up(modifier)
		}
	}

	async type(value: string, options?: BrowserInputOptions): Promise<void> {
		validateBrowserInputOptions(options)
		for (const character of value) {
			await this.down(character)
			await this.up(character)
			if (options?.delay !== undefined && options.delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, options.delay))
			}
		}
	}

	async insert(value: string): Promise<void> {
		await this.#frame.send('Input.insertText', { text: value })
	}
}
