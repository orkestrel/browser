import type { BrowserPermissionManagerInterface, CDPClientInterface } from './types.js'

/**
 * Permission overrides isolated to one browser context.
 *
 * @example
 * ```ts
 * import { BrowserPermissionManager } from '@orkestrel/browser'
 *
 * const permissions = new BrowserPermissionManager(client)
 * await permissions.grant(['geolocation'], 'https://example.com')
 * await permissions.clear()
 * ```
 */
export class BrowserPermissionManager implements BrowserPermissionManagerInterface {
	readonly #client: CDPClientInterface
	readonly #context: string | undefined

	constructor(client: CDPClientInterface, context?: string) {
		this.#client = client
		this.#context = context
	}

	async grant(permissions: readonly string[], origin?: string): Promise<void> {
		await this.#set(permissions, 'granted', origin)
	}

	async deny(permissions: readonly string[], origin?: string): Promise<void> {
		await this.#set(permissions, 'denied', origin)
	}

	async clear(): Promise<void> {
		const params: Record<string, unknown> = {}
		if (this.#context !== undefined) params['browserContextId'] = this.#context
		await this.#client.send('Browser.resetPermissions', params)
	}

	async #set(
		permissions: readonly string[],
		setting: 'granted' | 'denied',
		origin?: string,
	): Promise<void> {
		for (const name of permissions) {
			const params: Record<string, unknown> = {
				permission: { name },
				setting,
			}
			if (origin !== undefined) params['origin'] = origin
			if (this.#context !== undefined) params['browserContextId'] = this.#context
			await this.#client.send('Browser.setPermission', params)
		}
	}
}
