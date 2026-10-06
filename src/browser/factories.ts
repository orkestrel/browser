import type { BrowserToolsetInterface, CDPTransportInterface } from '@src/core'
import type {
	BrowserDOMViewOptions,
	BrowserDocumentToolsetOptions,
	BrowserDOMViewInterface,
	SocketCDPTransportOptions,
} from './types.js'
import { BrowserToolset } from '@src/core'
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
 * Creates a `BrowserToolsetInterface` that publishes the view tools over a DOM document and
 * adopts a source's page tools beside them.
 *
 * @remarks
 * The toolset runs over a view {@link createBrowserDOMView} creates for `document`, so it
 * advertises `read`, `click`, `type`, and `wait`, and a click or type receipt ends with
 * ` (untrusted event)`. `source` supplies page tools, which the toolset adopts during `start()`
 * and again on every `change`; `toolset.native` never includes them, so publishing it to a
 * registry leaves that registry's own tools alone. The view belongs to the toolset: `destroy()`
 * removes the toolset's tools, then destroys the view, which releases its listeners and fails
 * its pending waits, and a construction that throws destroys the view before it rethrows.
 * `journeys` adds `record`, `save`, `journeys`, `edit`, and `replay` at construction; a replay
 * runs the steps the document placement executes.
 *
 * @param options - The driven document, `own`, the page-tool source, the manager, the bound, the
 * journey stores, and the emitter hooks
 * @returns A {@link BrowserToolsetInterface} whose `view` drives the document
 * @throws Thrown when `document` is not a document attached to a window, with the code
 * `BROWSER_DOCUMENT`, when it is `globalThis.document` without `own: true`, with the code
 * `BROWSER_DOCUMENT_OWN`, and when `limit` is not a positive integer.
 *
 * @example
 * ```ts
 * const toolset = createDocumentToolset({ document: frame.contentDocument, source: bridge })
 * await toolset.start()
 * await toolset.tools.execute({ id: '1', name: 'read', arguments: { from: 1, search: 'form' } })
 * ```
 */
export function createDocumentToolset(
	options: BrowserDocumentToolsetOptions,
): BrowserToolsetInterface {
	const view = createBrowserDOMView({
		document: options.document,
		...(options.own === undefined ? {} : { own: options.own }),
	})
	try {
		return new BrowserToolset(view, {
			...(options.on === undefined ? {} : { on: options.on }),
			...(options.error === undefined ? {} : { error: options.error }),
			...(options.tools === undefined ? {} : { tools: options.tools }),
			...(options.source === undefined ? {} : { source: options.source }),
			...(options.limit === undefined ? {} : { limit: options.limit }),
			...(options.journeys === undefined ? {} : { journeys: options.journeys }),
			release: view.destroy.bind(view),
		})
	} catch (error) {
		view.destroy()
		throw error
	}
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
