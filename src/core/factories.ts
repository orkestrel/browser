import type {
	BrowserReadingInput,
	BrowserReadingInterface,
	BrowserSnapshotInput,
	BrowserSnapshotInterface,
	CDPClientInterface,
	CDPClientOptions,
} from './types.js'
import { BrowserReading } from './BrowserReading.js'
import { BrowserSnapshot } from './BrowserSnapshot.js'
import { CDPClient } from './CDPClient.js'

/**
 * Creates a `CDPClientInterface` bound to the given `CDPTransportInterface`.
 *
 * @param options - The transport (and optional timeout) the client uses
 * @returns A {@link CDPClientInterface}
 *
 * @example
 * ```ts
 * import { createCDPClient } from '@orkestrel/browser'
 *
 * const client = createCDPClient({ transport })
 * await client.connect()
 * ```
 */
export function createCDPClient(options: CDPClientOptions): CDPClientInterface {
	return new CDPClient(options)
}

/**
 * Creates a navigable `BrowserSnapshotInterface` over decoded `BrowserSnapshotInput` data.
 *
 * @param input - Captured documents and computed-style names
 * @returns A {@link BrowserSnapshotInterface}
 *
 * @example
 * ```ts
 * import { createBrowserSnapshot, readBrowserSnapshot } from '@orkestrel/browser'
 *
 * const snapshot = createBrowserSnapshot(readBrowserSnapshot(captured, ['display']))
 * snapshot.find({ name: 'main' })
 * ```
 */
export function createBrowserSnapshot(input: BrowserSnapshotInput): BrowserSnapshotInterface {
	return new BrowserSnapshot(input)
}

/**
 * Creates a `BrowserReadingInterface` over a captured document, parsing its HTML one time.
 *
 * @remarks
 * A reading built with a `navigation` source reports `stale` when that source's epoch differs
 * from the `epoch` recorded at capture; a reading built without one never does.
 *
 * @param input - The document URL, title, and HTML, and the optional navigation epoch
 * @returns A {@link BrowserReadingInterface}
 *
 * @example
 * ```ts
 * import { createBrowserReading } from '@orkestrel/browser'
 *
 * const reading = createBrowserReading({
 * 	url: 'https://example.com/',
 * 	title: 'Example',
 * 	html: '<nav>Menu</nav><main><p>Body</p></main>',
 * })
 * reading.text({ distill: false }) // { text: 'Menu\nBody', offset: 0, total: 9 }
 * ```
 */
export function createBrowserReading(input: BrowserReadingInput): BrowserReadingInterface {
	return new BrowserReading(input)
}
