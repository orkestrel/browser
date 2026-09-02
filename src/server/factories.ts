import type { CDPTransportInterface, BrowserWriterInterface } from '@src/core'
import type { BrowserInterface, BrowserOptions, WebSocketCDPTransportOptions } from './types.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Browser } from './Browser.js'
import { WebSocketCDPTransport } from './transports/WebSocketCDPTransport.js'

/**
 * Create a raw-CDP Browser façade.
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
 * Create a Node `WebSocket`-backed CDP transport.
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
	return {
		async write(path: string, data: Uint8Array): Promise<void> {
			await mkdir(dirname(path), { recursive: true })
			await writeFile(path, data)
		},
	}
}
