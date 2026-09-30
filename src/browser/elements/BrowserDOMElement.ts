import type { BrowserCallOptions, BrowserReadingInterface } from '@src/core'
import type { BrowserDOMElementInput, BrowserDOMElementInterface } from '../types.js'
import { isString } from '@orkestrel/contract'
import { BrowserElementError, BrowserError, createBrowserReading } from '@src/core'
import { BROWSER_TYPED_INPUTS } from '../constants.js'
import { computeBrowserName, computeBrowserRole, matchesBrowserPopup } from '../helpers.js'

/**
 * Drives a referenced element of a DOM document with untrusted events.
 *
 * @remarks
 * `click` runs `HTMLElement.click()`; `fill` and `select` set the control through its native
 * prototype setter and dispatch `input` and `change`; `submit` runs `form.requestSubmit()` and
 * observes the outcome through a `submit` listener registered across the call. Each action
 * refuses, with a `BrowserElementError` naming the reason, what an untrusted event cannot do: a
 * disabled control, a link or submission that opens another browsing context, a file chooser,
 * and typing into a contenteditable element. An element removed from its document, or held
 * across a navigation, reports `GONE`.
 *
 * @example
 * ```ts
 * const view = createBrowserDOMView({ document: frame.contentDocument })
 * await view.elements.outline()
 * await view.elements.element('e1')?.click()
 * ```
 */
export class BrowserDOMElement implements BrowserDOMElementInterface {
	readonly #input: BrowserDOMElementInput

	constructor(input: BrowserDOMElementInput) {
		this.#input = input
	}

	get reference(): string {
		return this.#input.reference
	}

	get role(): string {
		return computeBrowserRole(this.#input.node) ?? 'generic'
	}

	get name(): string {
		return computeBrowserName(this.#input.node)
	}

	async click(options?: BrowserCallOptions): Promise<void> {
		const view = this.#actionable(options)
		const node = this.#input.node
		if (matchesBrowserPopup(node)) {
			throw new BrowserElementError(
				this.reference,
				'UNKNOWN',
				'opens another browsing context, which an untrusted click cannot do',
			)
		}
		if (node.localName === 'input' && Reflect.get(node, 'type') === 'file') {
			throw new BrowserElementError(
				this.reference,
				'UNKNOWN',
				'opens a file chooser, which an untrusted click cannot do',
			)
		}
		if (node instanceof view.HTMLElement) {
			node.click()
			return
		}
		node.dispatchEvent(
			new view.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
		)
	}

	async fill(value: string, options?: BrowserCallOptions): Promise<void> {
		const view = this.#actionable(options)
		const node = this.#input.node
		if (node instanceof view.HTMLElement && node.isContentEditable) {
			throw new BrowserElementError(
				this.reference,
				'UNKNOWN',
				'is contenteditable, which an untrusted event cannot type into',
			)
		}
		const input = node instanceof view.HTMLInputElement ? node : undefined
		const control = input ?? (node instanceof view.HTMLTextAreaElement ? node : undefined)
		const setter = Reflect.getOwnPropertyDescriptor(
			input === undefined ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype,
			'value',
		)?.set
		if (
			control === undefined ||
			control.readOnly ||
			setter === undefined ||
			(input !== undefined && !BROWSER_TYPED_INPUTS.has(input.type))
		) {
			throw new BrowserElementError(this.reference, 'UNKNOWN', 'is not editable')
		}
		control.focus()
		Reflect.apply(setter, control, [value])
		control.dispatchEvent(
			new view.InputEvent('input', {
				bubbles: true,
				composed: true,
				inputType: 'insertReplacementText',
				data: value,
			}),
		)
		control.dispatchEvent(new view.Event('change', { bubbles: true }))
	}

	async select(values: readonly string[], options?: BrowserCallOptions): Promise<void> {
		const view = this.#actionable(options)
		const node = this.#input.node
		if (!(node instanceof view.HTMLSelectElement)) {
			throw new BrowserElementError(this.reference, 'UNKNOWN', 'is not a select control')
		}
		const choices = Array.from(node.options)
		const selected = values.map(
			(value) =>
				choices.find((option) => option.value === value) ??
				choices.find((option) => option.label === value),
		)
		const missing = values.find((_value, index) => selected[index] === undefined)
		if (missing !== undefined) {
			throw new BrowserElementError(
				this.reference,
				'UNKNOWN',
				`has no option ${JSON.stringify(missing)}`,
			)
		}
		for (const option of choices) option.selected = selected.includes(option)
		node.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }))
		node.dispatchEvent(new view.Event('change', { bubbles: true }))
	}

	async focus(options?: BrowserCallOptions): Promise<void> {
		const view = this.#current(options)
		const node = this.#input.node
		if (node instanceof view.HTMLElement || node instanceof view.SVGElement) node.focus()
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		this.#current(options)
		const document = this.#input.node.ownerDocument
		return createBrowserReading({
			url: document.URL,
			title: document.title,
			html: this.#input.node.outerHTML,
			navigation: this.#input.navigation,
		})
	}

	async submit(options?: BrowserCallOptions): Promise<void> {
		const view = this.#current(options)
		const node = this.#input.node
		const owner = node instanceof view.HTMLFormElement ? node : Reflect.get(node, 'form')
		if (!(owner instanceof view.HTMLFormElement)) {
			throw new BrowserElementError(this.reference, 'UNKNOWN', 'is not in a form')
		}
		const type = Reflect.get(node, 'type')
		const submitter =
			(node instanceof view.HTMLButtonElement && type === 'submit') ||
			(node instanceof view.HTMLInputElement && (type === 'submit' || type === 'image'))
				? node
				: undefined
		if (submitter?.matches(':disabled') === true) {
			throw new BrowserElementError(this.reference, 'DISABLED')
		}
		if (matchesBrowserPopup(submitter ?? owner)) {
			throw new BrowserElementError(
				this.reference,
				'UNKNOWN',
				'submits into another browsing context, which an untrusted submission cannot open',
			)
		}
		let submitted = false
		const release = new AbortController()
		owner.addEventListener(
			'submit',
			() => {
				submitted = true
			},
			{ signal: release.signal },
		)
		try {
			owner.requestSubmit(submitter ?? null)
		} finally {
			release.abort()
		}
		if (submitted) return
		const invalid = Array.from(owner.elements).find(
			(control) => control.localName !== 'fieldset' && control.matches(':invalid'),
		)
		if (invalid === undefined) {
			throw new BrowserError('did not submit', 'BROWSER_DOCUMENT_SUBMIT', {
				reference: this.reference,
			})
		}
		const field = computeBrowserName(invalid) || (invalid.getAttribute('name') ?? invalid.localName)
		const reason = Reflect.get(invalid, 'validationMessage')
		const message = isString(reason) ? reason : ''
		throw new BrowserError(`did not submit: ${field} — ${message}`, 'BROWSER_DOCUMENT_SUBMIT', {
			reference: this.reference,
			field,
			message,
		})
	}

	// Resolves the element's realm, refusing an element its view no longer holds.
	#current(options?: BrowserCallOptions): Window & typeof globalThis {
		options?.signal?.throwIfAborted()
		const node = this.#input.node
		const view = node.ownerDocument.defaultView
		if (!this.#input.current() || !node.isConnected || view === null) {
			throw new BrowserElementError(this.reference, 'GONE')
		}
		return view
	}

	// Resolves the realm of an element an action targets: current, rendered, and enabled.
	#actionable(options?: BrowserCallOptions): Window & typeof globalThis {
		const view = this.#current(options)
		const node = this.#input.node
		if (!node.checkVisibility()) {
			throw new BrowserElementError(this.reference, 'HIDDEN')
		}
		if (node.matches(':disabled')) throw new BrowserElementError(this.reference, 'DISABLED')
		return view
	}
}
