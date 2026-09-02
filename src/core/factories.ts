import type {
	BrowserSnapshotInput,
	BrowserSnapshotInterface,
	CDPClientInterface,
	CDPClientOptions,
} from './types.js'
import { BrowserSnapshot } from './BrowserSnapshot.js'
import { CDPClient } from './CDPClient.js'

/**
 * Creates a CDP client bound to the given transport.
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
 * Creates a navigable browser snapshot from decoded serializable data.
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
