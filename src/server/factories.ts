import type { CDPTransportInterface, BrowserWriterInterface } from '@src/core'
import type { BrowserInterface, BrowserOptions, WebSocketCDPTransportOptions } from './types.js'
import { Browser } from './Browser.js'
import { WebSocketCDPTransport } from './transports/WebSocketCDPTransport.js'
import { FileBrowserWriter } from './writers/FileBrowserWriter.js'

/**
 * Creates a raw-CDP Browser façade.
 *
 * @param options - Connection, launch, and viewport configuration
 * @returns A {@link BrowserInterface}
 *
 * @example
 * ```ts
 * import { createBrowser } from '@orkestrel/browser/server'
 *
 * const browser = createBrowser()
 * await browser.connect()
 * ```
 */
export function createBrowser(options?: BrowserOptions): BrowserInterface {
	return new Browser(options)
}

/**
 * Creates a Node `WebSocket`-backed CDP transport.
 *
 * @param options - The CDP WebSocket debugger URL (and optional timeout)
 * @returns A {@link CDPTransportInterface}
 */
export function createCDPTransport(options: WebSocketCDPTransportOptions): CDPTransportInterface {
	return new WebSocketCDPTransport(options)
}

/**
 * Creates a filesystem-backed browser writer.
 *
 * @returns A {@link BrowserWriterInterface} that persists bytes through `node:fs/promises`
 */
export function createBrowserWriter(): BrowserWriterInterface {
	return new FileBrowserWriter()
}
