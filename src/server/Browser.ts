import type { ChildProcess } from 'node:child_process'
import type {
	BrowserEventMap,
	BrowserOptions,
	BrowserEngine,
	BrowserStatus,
	BrowserConnection,
	BrowserInterface,
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	BrowserDiscoveryResult,
} from '../types.js'
import {
	BrowserConnectionError,
	BrowserNotConnectedError,
	BrowserDestroyedError,
} from '../errors.js'
import {
	BROWSER_DEFAULT_CDP_PORT,
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_CDP_PROTOCOL,
	BROWSER_NOT_FOUND_RESULT,
} from '../constants.js'
import {
	findSystemBrowser,
	launchBrowserProcess,
	waitForCdpReady,
	fetchCdpTargets,
} from '../helpers.js'
import { BrowserContext } from './BrowserContext.js'
import type { EmitterInterface } from '@scsr/core'
import { isRecord, isString, Emitter } from '@scsr/core'
import { CDPClient } from './CDPClient'

// === Browser

export class Browser implements BrowserInterface {
	#options: BrowserOptions
	#engine: BrowserEngine
	#status: BrowserStatus = 'idle'
	#connection: BrowserConnection | undefined
	#client: CDPClient
	#process: ChildProcess | undefined
	#cdpPort: number
	#contexts: BrowserContext[] = []
	#destroyed = false

	readonly #emitter: Emitter<BrowserEventMap>

	constructor(options?: BrowserOptions) {
		this.#emitter = new Emitter({ on: options?.on })
		this.#options = options ?? {}
		this.#engine = 'chromium'
		this.#cdpPort = this.#options.cdp?.port ?? BROWSER_DEFAULT_CDP_PORT
		this.#client = new CDPClient(this.#options.timeout)
		// Emit idle after construction to signal browser is ready for connection
		queueMicrotask(() => this.#emitter.emit('idle'))
	}

	get emitter(): EmitterInterface<BrowserEventMap> {
		return this.#emitter
	}

	// === Property accessors

	get engine(): BrowserEngine {
		return this.#engine
	}

	get status(): BrowserStatus {
		return this.#status
	}

	get connection(): BrowserConnection | undefined {
		return this.#connection
	}

	get connected(): boolean {
		// Detect stale connection: process exited or WebSocket closed externally
		if (this.#status === 'connected' && !this.#client.connected) {
			this.#handleExternalDisconnect()
		}
		return this.#status === 'connected'
	}

	// === Discovery

	async discover(): Promise<BrowserDiscoveryResult> {
		const result = await this.#discoverCdp()
		this.#emitter.emit('discover', result)
		return result
	}

	// === Connection

	async connect(): Promise<void> {
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (this.#status === 'connected') return

		this.#assertNotAborted()
		this.#status = 'connecting'

		try {
			// Step 1: explicit CDP endpoint (highest priority — user explicitly specified)
			const cdpEndpoint = this.#options.cdp?.endpoint
			if (cdpEndpoint !== undefined) {
				await this.#connectCdp(cdpEndpoint)
				return
			}

			// Step 2: passive CDP discovery (connect to existing browser if available)
			this.#assertNotAborted()
			const discovery = await this.#discoverCdp()
			if (discovery.found && discovery.endpoint !== undefined) {
				await this.#connectCdp(discovery.endpoint)
				return
			}

			// Step 3: launch system browser with CDP
			this.#assertNotAborted()
			await this.#launch()
		} catch (thrown) {
			this.#status = 'error'
			this.#emitter.emit('error', thrown)
			if (thrown instanceof BrowserConnectionError) throw thrown
			const message = thrown instanceof Error ? thrown.message : String(thrown)
			throw new BrowserConnectionError(message)
		}
	}

	// === Disconnection

	disconnect(): void {
		if (this.#destroyed || this.#status !== 'connected') return
		this.#reset()
		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	// === Context management

	context(index?: number): BrowserContextInterface | undefined {
		const i = index ?? 0
		if (i < 0 || i >= this.#contexts.length) return undefined
		return this.#contexts[i]
	}

	contexts(): readonly BrowserContextInterface[] {
		return [...this.#contexts]
	}

	// === Page creation shortcut

	async create(options?: BrowserPageOptions): Promise<BrowserPageInterface> {
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (this.#status !== 'connected') throw new BrowserNotConnectedError()

		// Get or create the default context
		let ctx = this.#contexts[0]
		if (ctx === undefined) {
			ctx = new BrowserContext(this.#client, this.#cdpPort, undefined, this.#options.viewport)
			this.#contexts.push(ctx)
		}
		const page = await ctx.create(options)
		this.#emitter.emit('page', page)
		return page
	}

	// === Lifecycle

	async destroy(): Promise<void> {
		if (this.#destroyed) return
		this.#destroyed = true

		try {
			// Close all managed contexts
			for (const ctx of this.#contexts) {
				try {
					await ctx.close()
				} catch {
					// Swallow errors during teardown
				}
			}
			this.#contexts = []

			// Close CDP client
			try {
				await this.#client.close()
			} catch {
				// Swallow
			}

			// Kill launched browser process
			if (this.#process !== undefined) {
				try {
					this.#process.kill()
				} catch {
					// Swallow
				}
				this.#process = undefined
			}
		} finally {
			this.#status = 'disconnected'
			this.#connection = undefined
			this.#emitter.emit('destroy')
			this.#emitter.destroy()
		}
	}

	// === Private helpers

	#assertNotAborted(): void {
		if (this.#options.signal?.aborted) {
			throw new BrowserConnectionError('Connection aborted')
		}
	}

	#reset(): void {
		this.#contexts = []
		this.#status = 'disconnected'
		this.#connection = undefined
	}

	/**
	 * Handle external disconnect — browser process exited or WebSocket closed
	 * without Browser.disconnect() being called. Cleans up orphaned state
	 * so the next connect() call can start fresh.
	 */
	#handleExternalDisconnect(): void {
		if (this.#process !== undefined) {
			try {
				this.#process.kill()
			} catch {
				// Process may already be dead
			}
			this.#process = undefined
		}
		this.#reset()
		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	#timeout(): number {
		return this.#options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	async #discoverCdp(): Promise<BrowserDiscoveryResult> {
		const port = this.#cdpPort
		const url = `${BROWSER_CDP_PROTOCOL}://localhost:${port}${BROWSER_CDP_VERSION_PATH}`

		try {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), this.#timeout())

			const response = await fetch(url, { signal: controller.signal })
			clearTimeout(timer)

			if (!response.ok) return BROWSER_NOT_FOUND_RESULT

			const info: unknown = await response.json()
			if (!isRecord(info)) return BROWSER_NOT_FOUND_RESULT

			const endpoint = isString(info['webSocketDebuggerUrl'])
				? info['webSocketDebuggerUrl']
				: undefined
			const browserName = isString(info['Browser']) ? info['Browser'] : undefined

			return {
				found: endpoint !== undefined,
				endpoint,
				browser: browserName,
				connection: endpoint !== undefined ? 'cdp' : undefined,
			}
		} catch {
			return BROWSER_NOT_FOUND_RESULT
		}
	}

	async #connectCdp(endpoint: string): Promise<void> {
		await this.#client.connect(endpoint)
		this.#connection = 'cdp'
		this.#status = 'connected'

		// Sync existing targets as contexts
		await this.#syncContexts()

		this.#emitter.emit('connect', 'cdp')
	}

	async #launch(): Promise<void> {
		const executable = this.#options.executable ?? findSystemBrowser()

		if (executable === undefined) {
			throw new BrowserConnectionError(
				'No Chromium browser found. Install Chrome, Edge, or Chromium.',
			)
		}

		const headless = this.#options.headless ?? true
		const profile = this.#options.profile
		const extra = this.#options.args

		this.#process = launchBrowserProcess(executable, this.#cdpPort, headless, profile, extra)

		// Wait for the CDP endpoint to be available
		const wsUrl = await this.#waitForLaunch(this.#process)

		// Connect to the browser via CDP
		await this.#client.connect(wsUrl)

		this.#connection = profile !== undefined ? 'persistent' : 'launch'
		this.#status = 'connected'

		// Sync existing targets
		await this.#syncContexts()

		this.#emitter.emit('launch', this.#engine)
		this.#emitter.emit('connect', this.#connection)
	}

	async #waitForLaunch(process: ChildProcess): Promise<string> {
		return await new Promise((resolve, reject) => {
			let settled = false

			const finish = (callback: () => void): void => {
				if (settled) return
				settled = true
				process.off('error', onError)
				process.off('exit', onExit)
				callback()
			}

			const onError = (error: Error): void => {
				finish(() => reject(new BrowserConnectionError(error.message)))
			}

			const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
				finish(() => reject(new BrowserConnectionError(this.#formatLaunchExit(code, signal))))
			}

			process.once('error', onError)
			process.once('exit', onExit)

			void waitForCdpReady(this.#cdpPort, this.#timeout()).then(
				(wsUrl) => {
					finish(() => resolve(wsUrl))
				},
				(error: unknown) => {
					const message = error instanceof Error ? error.message : String(error)
					finish(() => reject(new BrowserConnectionError(message)))
				},
			)
		})
	}

	#formatLaunchExit(code: number | null, signal: NodeJS.Signals | null): string {
		if (signal !== null) {
			return `Browser process exited before CDP became ready (signal: ${signal})`
		}

		if (code !== null) {
			return `Browser process exited before CDP became ready (code: ${code})`
		}

		return 'Browser process exited before CDP became ready'
	}

	async #syncContexts(): Promise<void> {
		const targets = await fetchCdpTargets(this.#cdpPort, this.#timeout())
		const pageTargets = targets.filter((t) => t.type === 'page')

		if (pageTargets.length > 0 && this.#contexts.length === 0) {
			const ctx = new BrowserContext(this.#client, this.#cdpPort, undefined, this.#options.viewport)
			await ctx.sync(pageTargets)
			this.#contexts.push(ctx)
		}
	}
}
