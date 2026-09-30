import type {
	BrowserCallOptions,
	BrowserElementInterface,
	BrowserElementManagerInterface,
	BrowserEpochFunction,
	BrowserViewInterface,
	CDPTransportEventMap,
} from '@src/core'
import type { EmitterErrorHandler, EmitterHooks } from '@orkestrel/emitter'

// === Browser document

/**
 * Configures a view that drives one browser document.
 *
 * @remarks
 * - `document` — the document the view reads and acts on; the view follows its window, so a
 *   navigation of that window moves the view to the window's next document
 * - `own` — if `true`, admits the realm's own `globalThis.document`; if `false`, refuses it,
 *   because an action that navigates the realm's own document cannot return. Default: `false`
 */
export interface BrowserDocumentOptions {
	readonly document: Document
	readonly own?: boolean
}

/**
 * Provides untrusted DOM actions through a stable element reference.
 *
 * @remarks
 * Every action dispatches events whose `isTrusted` is `false`. `submit` submits the element's
 * form through `requestSubmit()`, passing the element as the submitter when it is a submit
 * button.
 */
export interface BrowserDOMElementInterface extends BrowserElementInterface {
	submit(options?: BrowserCallOptions): Promise<void>
}

/** Provides the document operations of a view that drives a DOM document in its own realm. */
export interface BrowserDOMViewInterface extends BrowserViewInterface {
	readonly elements: BrowserElementManagerInterface<BrowserDOMElementInterface>
	/** Releases the navigation listeners and every element reference. */
	destroy(): void
}

/**
 * Binds a DOM element manager to the view that owns it.
 *
 * @remarks
 * - `document` — returns the document the view drives at the moment of the call
 * - `navigation` — reads the view's navigation epoch, which every reading records
 */
export interface BrowserDOMElementManagerInput {
	readonly document: () => Document
	readonly navigation: BrowserEpochFunction
}

/**
 * Binds a DOM element to its reference and the manager that minted it.
 *
 * @remarks
 * - `reference` — the reference the manager minted for the element
 * - `node` — the element the reference names
 * - `current` — true while the manager still holds the reference; false otherwise
 * - `navigation` — reads the view's navigation epoch, which every reading records
 */
export interface BrowserDOMElementInput {
	readonly reference: string
	readonly node: Element
	readonly current: () => boolean
	readonly navigation: BrowserEpochFunction
}

/**
 * Describes one wait parked on DOM mutations.
 *
 * @remarks
 * - `documents` — the documents whose mutations re-run the check; a `pagehide` in any of their
 *   windows fails the wait
 * - `check` — returns the value the wait settles on, or `undefined` to keep waiting
 * - `timeout` — ms before the wait fails
 * - `signal` — aborts the wait
 * - `subject` — names the wait in its timeout message
 */
export interface BrowserMutationWait<T> {
	readonly documents: readonly Document[]
	readonly check: () => T | undefined
	readonly timeout: number
	readonly signal?: AbortSignal | undefined
	readonly subject: string
}

// === Browser socket transport

/**
 * Configures a CDP transport over the browser's `WebSocket`.
 *
 * @remarks
 * - `url` — the CDP WebSocket debugger URL, with a `ws:` or `wss:` scheme
 * - `timeout` — ms before an opening handshake fails. Default: `BROWSER_DEFAULT_TIMEOUT_MS`
 *
 * The driven Chromium must be started with `--remote-allow-origins` naming the caller's origin;
 * otherwise it refuses the handshake and `start` rejects.
 */
export interface SocketCDPTransportOptions {
	readonly on?: EmitterHooks<CDPTransportEventMap>
	readonly error?: EmitterErrorHandler
	readonly url: string
	readonly timeout?: number
}
