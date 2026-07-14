import type { CDPClientInterface, CDPClientOptions } from './types.js'
import { CDPClient } from './CDPClient.js'

/**
 * Create a CDP client bound to the given transport.
 *
 * @param options - The transport (and optional timeout) the client uses
 * @returns A {@link CDPClientInterface}
 *
 * @example
 * ```ts
 * import { createCDPClient } from '@src/core'
 *
 * const client = createCDPClient({ transport })
 * await client.connect()
 * ```
 */
export function createCDPClient(options: CDPClientOptions): CDPClientInterface {
	return new CDPClient(options)
}
