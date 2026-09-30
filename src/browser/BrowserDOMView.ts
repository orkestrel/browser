import type {
	BrowserCallOptions,
	BrowserElementManagerInterface,
	BrowserReadingInterface,
} from '@src/core'
import type {
	BrowserDOMElementInterface,
	BrowserDOMViewInterface,
	BrowserDocumentOptions,
} from './types.js'
import { BrowserError, createBrowserReading, validateBrowserTimeout } from '@src/core'
import { BrowserDOMElementManager } from './elements/BrowserDOMElementManager.js'
import { BROWSER_DOCUMENT_TIMEOUT_MS } from './constants.js'
import { isBrowserDocument, observeBrowserMutations } from './helpers.js'

/**
 * Reads and drives a DOM document from a realm that can reach it, with untrusted events.
 *
 * @remarks
 * The view follows the window of the document it was given, so after that window navigates it
 * drives the window's next document. A reading records the view's navigation epoch, and reports
 * stale after the epoch advances. The epoch advances on the Navigation API's `navigatesuccess`
 * where the window has that API, on `popstate` and `hashchange` where it does not, on `pagehide`,
 * and when the window's document changes. A `pushState` in a window without the Navigation API
 * fires none of those events, so a reading there stays current across it. A cross-document
 * navigation also clears every element reference. `trusted` is `false`: every action dispatches
 * events whose `isTrusted` is `false`.
 *
 * @example
 * ```ts
 * const view = createBrowserDOMView({ document: frame.contentDocument })
 * const reading = await view.read()
 * reading.text().text
 * ```
 */
export class BrowserDOMView implements BrowserDOMViewInterface {
	readonly #window: Window
	readonly #elements: BrowserDOMElementManager
	readonly #release = new AbortController()
	readonly #navigateHandler = this.#navigate.bind(this)
	#document: Document
	#epoch = 0
	#listeners = new AbortController()

	constructor(options: BrowserDocumentOptions) {
		const document = options.document
		if (!isBrowserDocument(document) || document.defaultView === null) {
			throw new BrowserError(
				'Browser DOM view requires a document attached to a window',
				'BROWSER_DOCUMENT',
			)
		}
		if (document === globalThis.document && options.own !== true) {
			throw new BrowserError(
				'Browser DOM view drives globalThis.document only with own: true, because an action that navigates the realm it runs in cannot return',
				'BROWSER_DOCUMENT_OWN',
			)
		}
		this.#window = document.defaultView
		this.#document = document
		this.#elements = new BrowserDOMElementManager({
			document: this.#current.bind(this),
			navigation: this.#navigation.bind(this),
		})
		this.#listen()
	}

	get url(): string {
		return this.#current().URL
	}

	get trusted(): boolean {
		return false
	}

	get elements(): BrowserElementManagerInterface<BrowserDOMElementInterface> {
		return this.#elements
	}

	async title(options?: BrowserCallOptions): Promise<string> {
		options?.signal?.throwIfAborted()
		return this.#current().title
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		options?.signal?.throwIfAborted()
		const document = this.#current()
		return createBrowserReading({
			url: document.URL,
			title: document.title,
			html: document.documentElement.outerHTML,
			navigation: this.#navigation.bind(this),
		})
	}

	async wait(text: string, options?: BrowserCallOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DOCUMENT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const document = this.#current()
		await observeBrowserMutations({
			documents: [document],
			check: this.#contains.bind(this, document, text),
			timeout,
			signal: options?.signal,
			subject: 'Browser text wait',
		})
	}

	destroy(): void {
		this.#release.abort()
		this.#listeners.abort()
		this.#elements.clear()
	}

	// Returns the window's document, first moving the view onto it after a document change.
	#current(): Document {
		const document = this.#window.document
		if (document !== this.#document && !this.#release.signal.aborted) {
			this.#document = document
			this.#navigate()
			this.#listen()
		}
		return this.#document
	}

	#navigation(): number {
		this.#current()
		return this.#epoch
	}

	#navigate(event?: Event): void {
		this.#epoch += 1
		if (event === undefined || event.type === 'pagehide') this.#elements.clear()
	}

	#contains(document: Document, text: string): true | undefined {
		return (document.body?.innerText ?? '').includes(text) ? true : undefined
	}

	// Subscribes to the navigation events of the window's current document.
	#listen(): void {
		this.#listeners.abort()
		this.#listeners = new AbortController()
		const options = { signal: this.#listeners.signal }
		if (Reflect.has(this.#window, 'navigation')) {
			this.#window.navigation.addEventListener('navigatesuccess', this.#navigateHandler, options)
		} else {
			this.#window.addEventListener('popstate', this.#navigateHandler, options)
			this.#window.addEventListener('hashchange', this.#navigateHandler, options)
		}
		this.#window.addEventListener('pagehide', this.#navigateHandler, options)
	}
}
