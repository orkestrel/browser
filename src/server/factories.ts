import type {
	BrowserJourneyStoreInterface,
	BrowserRunStoreInterface,
	CDPTransportInterface,
	BrowserWriterInterface,
} from '@src/core'
import type {
	FileBrowserStoreOptions,
	BrowserInterface,
	BrowserOptions,
	WebSocketCDPTransportOptions,
} from './types.js'
import { FileBrowserJourneyStore } from './stores/FileBrowserJourneyStore.js'
import { FileBrowserRunStore } from './stores/FileBrowserRunStore.js'
import { Browser } from './Browser.js'
import { WebSocketCDPTransport } from './transports/WebSocketCDPTransport.js'
import { FileBrowserWriter } from './writers/FileBrowserWriter.js'

/**
 * Creates a raw-CDP `BrowserInterface` façade with discovery, connection, and lifecycle
 * management.
 *
 * @param options - Connection, launch, and viewport configuration
 * @returns A {@link BrowserInterface}
 *
 * @example Connect to a browser and drive a page
 * ```ts
 * import { createBrowser } from '@orkestrel/browser/server'
 *
 * const browser = createBrowser({ headless: true })
 * await browser.connect() // CDP endpoint discovery → connect, else launch
 * const page = await browser.create({ url: 'https://example.com' })
 * await (await page.elements.find({ css: '#accept' }))[0]?.click()
 * const shot = await page.screenshot({ path: './out.png' })
 * await browser.destroy()
 * ```
 */
export function createBrowser(options?: BrowserOptions): BrowserInterface {
	return new Browser(options)
}

/**
 * Creates a Node `WebSocket`-backed `CDPTransportInterface` for the given CDP debugger URL.
 *
 * @param options - The CDP WebSocket debugger URL (and optional timeout)
 * @returns A {@link CDPTransportInterface}
 */
export function createCDPTransport(options: WebSocketCDPTransportOptions): CDPTransportInterface {
	return new WebSocketCDPTransport(options)
}

/**
 * Creates a filesystem-backed `BrowserWriterInterface` that persists bytes through
 * `node:fs/promises`.
 *
 * @returns A {@link BrowserWriterInterface} that persists bytes through `node:fs/promises`
 */
export function createBrowserWriter(): BrowserWriterInterface {
	return new FileBrowserWriter()
}

/**
 * Creates a journey store over an existing filesystem root.
 * @param options - Root and listing cap
 * @returns A durable journey store
 * @example
 * const store = createFileBrowserJourneyStore({ root: directory })
 */
export function createFileBrowserJourneyStore(
	options: FileBrowserStoreOptions,
): BrowserJourneyStoreInterface {
	return new FileBrowserJourneyStore(options)
}

/**
 * Creates a run store over an existing filesystem root.
 * @param options - Root and listing cap
 * @returns A durable run and capture store
 * @example
 * const store = createFileBrowserRunStore({ root: directory })
 */
export function createFileBrowserRunStore(
	options: FileBrowserStoreOptions,
): BrowserRunStoreInterface {
	return new FileBrowserRunStore(options)
}
