import type { CDPTransportInterface } from '@src/core'
import type {
	BrowserDOMViewOptions,
	BrowserDOMViewInterface,
	SocketCDPTransportOptions,
} from './types.js'
import { BrowserDOMView } from './BrowserDOMView.js'
import { SocketCDPTransport } from './transports/SocketCDPTransport.js'

/**
 * Creates a view that reads and drives a DOM document without trusted input.
 *
 * @param options - The driven document, and `own` to admit the realm's own document
 * @returns A {@link BrowserDOMViewInterface} over the document's window
 * @throws Thrown when `document` is not a document attached to a window, with the code
 * `BROWSER_DOCUMENT`, and when it is `globalThis.document` without `own: true`, with the code
 * `BROWSER_DOCUMENT_OWN`.
 *
 * @example
 * ```ts
 * const frame = document.createElement('iframe')
 * document.body.append(frame)
 * const view = createBrowserDOMView({ document: frame.contentDocument })
 * await view.elements.outline() // { text: 'page "" about:blank\n(0 of 0 elements)', … }
 * ```
 */
export function createBrowserDOMView(options: BrowserDOMViewOptions): BrowserDOMViewInterface {
	return new BrowserDOMView(options)
}

/**
 * Creates a CDP transport over the browser's native `WebSocket`.
 *
 * @param options - The CDP WebSocket debugger URL, the opening deadline, and emitter hooks
 * @returns A {@link CDPTransportInterface} a `CDPClient` sends and receives frames over
 *
 * @example
 * ```ts
 * const client = createCDPClient({
 * 	transport: createSocketCDPTransport({ url: 'ws://127.0.0.1:9222/devtools/browser/abc' }),
 * })
 * await client.connect()
 * ```
 */
export function createSocketCDPTransport(
	options: SocketCDPTransportOptions,
): CDPTransportInterface {
	return new SocketCDPTransport(options)
}
