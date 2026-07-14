import type { ChildProcess } from 'node:child_process'
import type {
	BrowserEventMap,
	BrowserOptions,
	BrowserEngine,
	BrowserStatus,
	BrowserConnection,
	BrowserInterface,
	BrowserDiscoveryResult,
} from './types.js'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	CDPTransportInterface,
} from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import { isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { CDPClient, BrowserContext, BROWSER_DEFAULT_TIMEOUT_MS } from '@src/core'
import {
	BrowserConnectionError,
	BrowserNotConnectedError,
	BrowserDestroyedError,
} from './errors.js'
import {
	BROWSER_DEFAULT_CDP_PORT,
	BROWSER_DEFAULT_HOST,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_CDP_PROTOCOL,
	BROWSER_KILL_GRACE_MS,
	BROWSER_PORT_PROBE_TIMEOUT_MS,
	BROWSER_TRANSPORT_LOSS_DEFER_MS,
} from './constants.js'
import {
	findSystemBrowser,
	parseBrowserEngine,
	browserToEngine,
	launchBrowserProcess,
	waitForCdpReady,
	fetchCdpTargets,
} from './helpers.js'
import { createCDPTransport, createScreenshotWriter } from './factories.js'

// === Browser

export class Browser implements BrowserInterface {
	readonly #emitter: Emitter<BrowserEventMap>
	#options: BrowserOptions
	#engine: BrowserEngine
	#status: BrowserStatus = 'idle'
	#connection: BrowserConnection | undefined
	#client: CDPClient | undefined
	#process: ChildProcess | undefined
	#cdpPort: number
	#cdpHost: string
	#contexts: BrowserContext[] = []
	#destroyed = false
	#transportUnbind: (() => void) | undefined
	#processUnbind: (() => void) | undefined
	#lastPid: number | undefined

	constructor(options?: BrowserOptions) {
		this.#emitter = new Emitter({ on: options?.on })
		this.#options = options ?? {}
		this.#engine =
			this.#options.engine ??
			(this.#options.executable !== undefined
				? (parseBrowserEngine(this.#options.executable) ?? 'chromium')
				: 'chromium')
		this.#cdpPort = this.#options.cdp?.port ?? BROWSER_DEFAULT_CDP_PORT
		this.#cdpHost = this.#options.cdp?.host ?? BROWSER_DEFAULT_HOST

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
		return this.#status === 'connected'
	}

	get pid(): number | undefined {
		return this.#process?.pid ?? this.#lastPid
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
			const discover = this.#options.cdp?.discover ?? true
			if (discover) {
				this.#assertNotAborted()
				const discovery = await this.#raceAbort(this.#discoverCdp())
				if (discovery.found && discovery.endpoint !== undefined) {
					this.#engine = browserToEngine(discovery.browser ?? '')
					await this.#connectCdp(discovery.endpoint)
					return
				}
			} else {
				// Discovery explicitly disabled — the caller demanded a fresh
				// launch with a specific profile/engine, so a stray listener on
				// the port must reject loudly rather than being silently attached to.
				this.#assertNotAborted()
				await this.#raceAbort(this.#assertPortFree())
			}

			// Step 3: launch system browser with CDP
			this.#assertNotAborted()
			await this.#launch()
		} catch (thrown) {
			this.#status = 'error'
			this.#emitter.emit('error', thrown)
			if (thrown instanceof BrowserConnectionError) throw thrown
			const message = thrown instanceof Error ? thrown.message : String(thrown)
			throw new BrowserConnectionError(message, { executable: this.#options.executable })
		}
	}

	// === Disconnection

	async disconnect(): Promise<void> {
		if (this.#destroyed || this.#status !== 'connected') return

		// An ephemeral 'launch' (no persistent profile) has no way to be
		// reattached to later — detaching here would strand its process with
		// no path back to it. Callers must use destroy() instead. A
		// 'persistent' (profile-backed) launch IS reattachable (via CDP
		// discovery on the same port), so it falls through to the same
		// release-without-killing path as a 'cdp' connection.
		if (this.#connection === 'launch') {
			throw new BrowserConnectionError(
				'Cannot disconnect() an ephemeral launch — no persistent profile to reattach to; ephemeral launches must use destroy() to release it',
				{ connection: this.#connection },
			)
		}

		this.#unbindTransport()
		this.#unbindProcess()

		const client = this.#client
		if (client !== undefined) {
			try {
				await client.close()
			} catch {
				// Swallow — best-effort close on detach
			}
		}

		// Release ownership of a launched process WITHOUT killing it, so a
		// 'persistent' session's browser stays alive for later reattachment.
		// The pid stays readable on this instance until destroy() or an
		// observed process exit clears it.
		if (this.#process?.pid !== undefined) this.#lastPid = this.#process.pid
		this.#process = undefined

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
		if (this.#status !== 'connected' || this.#client === undefined)
			throw new BrowserNotConnectedError()

		// Get or create the default context
		let ctx = this.#contexts[0]
		if (ctx === undefined) {
			ctx = new BrowserContext(
				this.#client,
				undefined,
				this.#options.viewport,
				createScreenshotWriter(),
			)
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
			this.#unbindTransport()
			this.#unbindProcess()

			// Owned (launch/persistent) browsers close their pages/contexts
			// normally. A CDP-attached browser is a LOCAL DETACH ONLY — other
			// clients may share those targets, so no remote close is sent.
			const owned = this.#process !== undefined
			if (owned) {
				for (const ctx of this.#contexts) {
					try {
						await ctx.close()
					} catch {
						// Swallow errors during teardown
					}
				}
			}
			this.#contexts = []

			// Kill launched browser process, then close CDP client (§13 order)
			await this.#terminate(this.#process)
			this.#process = undefined

			if (this.#client !== undefined) {
				try {
					await this.#client.close()
				} catch {
					// Swallow
				}
				this.#client = undefined
			}
		} finally {
			this.#status = 'disconnected'
			this.#connection = undefined
			this.#lastPid = undefined
			this.#emitter.emit('destroy')
			this.#emitter.destroy()
		}
	}

	/**
	 * Gracefully shut down the remote browser, whether this instance owns its
	 * process or merely attached to it via CDP.
	 *
	 * @remarks
	 * Sends CDP `Browser.close` best-effort; on an owned browser also awaits
	 * the process's exit (bounded by the kill-escalation grace period,
	 * escalating to a kill only if it does not exit in time). Ends in the
	 * same local-cleanup state as `destroy()`.
	 */
	async close(): Promise<void> {
		if (this.#destroyed) return
		this.#destroyed = true

		try {
			this.#unbindTransport()
			this.#unbindProcess()

			const client = this.#client
			if (client !== undefined) {
				try {
					await client.send('Browser.close')
				} catch {
					// Best-effort — the remote may not support it or may already be gone
				}
			}

			const process = this.#process
			if (process !== undefined) {
				const exited = new Promise<void>((resolve) => {
					process.once('exit', () => resolve())
				})

				let timer: ReturnType<typeof setTimeout> | undefined
				const timedOut = await Promise.race([
					exited.then(() => false),
					new Promise<boolean>((resolve) => {
						timer = setTimeout(() => resolve(true), BROWSER_KILL_GRACE_MS)
					}),
				])
				if (timer !== undefined) clearTimeout(timer)

				// Browser.close already asked nicely — escalate only if the
				// process failed to exit within the bound.
				if (timedOut) await this.#terminate(process)
				this.#process = undefined
			}

			for (const ctx of this.#contexts) {
				try {
					await ctx.close()
				} catch {
					// Swallow errors during teardown
				}
			}
			this.#contexts = []

			if (client !== undefined) {
				try {
					await client.close()
				} catch {
					// Swallow
				}
				this.#client = undefined
			}
		} finally {
			this.#status = 'disconnected'
			this.#connection = undefined
			this.#lastPid = undefined
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

	/**
	 * Race a promise against the connection's external AbortSignal (if any),
	 * rejecting promptly with a coded BrowserConnectionError when it fires.
	 */
	async #raceAbort<T>(promise: Promise<T>): Promise<T> {
		const signal = this.#options.signal
		if (signal === undefined) return promise
		if (signal.aborted) throw new BrowserConnectionError('Connection aborted')

		let abortWon = false

		return await new Promise<T>((resolve, reject) => {
			const onAbort = (): void => {
				abortWon = true
				cleanup()
				reject(new BrowserConnectionError('Connection aborted'))
			}
			const cleanup = (): void => signal.removeEventListener('abort', onAbort)
			signal.addEventListener('abort', onAbort, { once: true })
			promise.then(
				(value) => {
					cleanup()
					resolve(value)
				},
				(error: unknown) => {
					cleanup()
					reject(error)
				},
			)
		}).catch((error: unknown) => {
			// When the abort signal wins the race, `promise` is still in
			// flight — attach an observer so its eventual rejection doesn't
			// surface as an unhandled rejection once nobody is listening.
			if (abortWon) promise.catch(() => undefined)
			throw error
		})
	}

	#reset(): void {
		this.#contexts = []
		this.#status = 'disconnected'
		this.#connection = undefined
		this.#client = undefined
	}

	/**
	 * Handle the owned process exiting on its own (not via destroy()/close()).
	 * The process is already gone — no kill is attempted. Cleans up orphaned
	 * state so the next connect() call can start fresh, and emits a coded
	 * `error` (cause: process exit) before `disconnect`.
	 */
	#handleProcessExit(): void {
		if (this.#destroyed) return
		if (this.#status !== 'connected') return

		this.#unbindTransport()
		this.#unbindProcess()

		const client = this.#client
		this.#process = undefined
		this.#lastPid = undefined
		this.#reset()

		if (client !== undefined) client.close().catch(() => undefined)

		this.#emitter.emit(
			'error',
			new BrowserConnectionError('The browser process exited unexpectedly', {
				cause: 'process-exit',
			}),
		)
		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	/**
	 * Handle a transport close/error while the owned process (if any) is
	 * still alive, or the connection is CDP-attached. Never kills the
	 * process — only the local client is reset, so the SAME instance can
	 * reconnect (e.g. rediscover on the port and reattach). Emits a coded
	 * `error` (cause: connection loss) before `disconnect`.
	 */
	#handleTransportLoss(deferred = false): void {
		if (this.#destroyed) return
		if (this.#status !== 'connected') return

		const process = this.#process
		if (process !== undefined && (process.exitCode !== null || process.signalCode !== null)) {
			// The owned process is already dead — this IS a process exit, not
			// merely a lost connection.
			this.#handleProcessExit()
			return
		}

		if (process !== undefined && !deferred) {
			// A killed owned process's sockets can close before its 'exit'
			// event is reaped by libuv — defer briefly so an already-pending
			// 'exit' (handled by #handleProcessExit via the bound listener)
			// gets first say over what really happened; if it wins, this call
			// becomes a no-op via the #status guard above. Only ever defers once.
			setTimeout(() => this.#handleTransportLoss(true), BROWSER_TRANSPORT_LOSS_DEFER_MS)
			return
		}

		if (process !== undefined && process.pid !== undefined) {
			// The 'exit' event may still not have reached us even after the
			// defer (a slow-to-reap libuv tick) — re-verify liveness directly
			// via signal 0 so a genuinely dead process routes through the
			// process-exit cleanup path (clearing #process) instead of being
			// left stranded as a resumable owned process.
			try {
				process.kill(0)
			} catch {
				this.#handleProcessExit()
				return
			}
		}

		this.#unbindTransport()

		const client = this.#client
		this.#reset()

		if (client !== undefined) client.close().catch(() => undefined)

		this.#emitter.emit(
			'error',
			new BrowserConnectionError('The CDP transport connection was lost', {
				cause: 'connection-loss',
			}),
		)
		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	/** Subscribe to the CDP transport's close/error events for deterministic transport-loss detection. */
	#bindTransport(transport: CDPTransportInterface): void {
		const onClose = (): void => this.#handleTransportLoss()
		const onError = (): void => this.#handleTransportLoss()
		transport.emitter.on('close', onClose)
		transport.emitter.on('error', onError)
		this.#transportUnbind = () => {
			transport.emitter.off('close', onClose)
			transport.emitter.off('error', onError)
		}
	}

	#unbindTransport(): void {
		this.#transportUnbind?.()
		this.#transportUnbind = undefined
	}

	/** Subscribe to a launched process's exit event for deterministic process-exit detection. */
	#bindProcess(process: ChildProcess): void {
		const onExit = (): void => this.#handleProcessExit()
		process.once('exit', onExit)
		this.#processUnbind = () => process.off('exit', onExit)
	}

	#unbindProcess(): void {
		this.#processUnbind?.()
		this.#processUnbind = undefined
	}

	#timeout(): number {
		return this.#options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	async #discoverCdp(): Promise<BrowserDiscoveryResult> {
		const port = this.#cdpPort
		const url = `${BROWSER_CDP_PROTOCOL}://${this.#cdpHost}:${port}${BROWSER_CDP_VERSION_PATH}`
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.#timeout())

		try {
			const response = await fetch(url, { signal: controller.signal })

			if (!response.ok) return this.#notFoundResult()

			const info: unknown = await response.json()
			if (!isRecord(info)) return this.#notFoundResult()

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
			return this.#notFoundResult()
		} finally {
			clearTimeout(timer)
		}
	}

	#notFoundResult(): BrowserDiscoveryResult {
		return { found: false, endpoint: undefined, browser: undefined, connection: undefined }
	}

	/**
	 * Reject when something is already listening on the configured CDP port —
	 * used ahead of a `discover: false` launch, so a caller demanding a fresh
	 * browser never silently attaches to a stranger already on that port.
	 */
	async #assertPortFree(): Promise<void> {
		const occupied = await this.#probePort()
		if (occupied) {
			throw new BrowserConnectionError(
				`Port ${this.#cdpPort} on ${this.#cdpHost} is already occupied by another CDP endpoint`,
				{ port: this.#cdpPort, host: this.#cdpHost },
			)
		}
	}

	/** Very short probe of the CDP version endpoint — just enough to detect an occupied port, not full discovery. */
	async #probePort(): Promise<boolean> {
		const url = `${BROWSER_CDP_PROTOCOL}://${this.#cdpHost}:${this.#cdpPort}${BROWSER_CDP_VERSION_PATH}`
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), BROWSER_PORT_PROBE_TIMEOUT_MS)

		try {
			const response = await fetch(url, { signal: controller.signal })
			return response.ok
		} catch {
			return false
		} finally {
			clearTimeout(timer)
		}
	}

	async #connectCdp(endpoint: string): Promise<void> {
		const transport = createCDPTransport({ url: endpoint, timeout: this.#timeout() })
		const client = new CDPClient({ transport, timeout: this.#timeout() })

		try {
			await this.#raceAbort(client.connect())

			this.#client = client
			this.#connection = 'cdp'
			this.#status = 'connected'
			this.#bindTransport(transport)

			// Sync existing targets as contexts
			await this.#syncContexts()

			this.#emitter.emit('connect', 'cdp')
		} catch (error) {
			try {
				await client.close()
			} catch {
				// Swallow — best-effort cleanup of the failed attempt
			}
			throw error
		}
	}

	async #launch(): Promise<void> {
		if (this.#process !== undefined) {
			throw new BrowserConnectionError('A browser process is already active on this instance')
		}

		const requestedEngine = this.#options.engine
		let executable = this.#options.executable
		let resolvedEngine: BrowserEngine | undefined

		if (executable !== undefined) {
			resolvedEngine = parseBrowserEngine(executable) ?? 'chromium'
		} else {
			const found = findSystemBrowser({ engine: requestedEngine })
			executable = found?.executable
			resolvedEngine = found?.engine
		}

		if (executable === undefined) {
			throw new BrowserConnectionError(
				'No Chromium browser found. Install Chrome, Edge, or Chromium.',
				requestedEngine !== undefined ? { engine: requestedEngine } : undefined,
			)
		}

		this.#engine = resolvedEngine ?? 'chromium'

		const headless = this.#options.headless ?? true
		const profile = this.#options.profile
		const extra = this.#options.args

		const process = launchBrowserProcess(executable, this.#cdpPort, headless, profile, extra)
		this.#process = process

		let transport: CDPTransportInterface | undefined
		let client: CDPClient | undefined

		try {
			// Wait for the CDP endpoint to be available
			const wsUrl = await this.#raceAbort(this.#waitForLaunch(process, executable, extra))

			// Connect to the browser via CDP
			transport = createCDPTransport({ url: wsUrl, timeout: this.#timeout() })
			client = new CDPClient({ transport, timeout: this.#timeout() })
			await this.#raceAbort(client.connect())

			this.#client = client
			this.#connection = profile !== undefined ? 'persistent' : 'launch'
			this.#status = 'connected'
			this.#bindTransport(transport)
			this.#bindProcess(process)

			// Sync existing targets
			await this.#syncContexts()

			this.#emitter.emit('launch', this.#engine)
			this.#emitter.emit('connect', this.#connection)
		} catch (error) {
			if (client !== undefined) {
				try {
					await client.close()
				} catch {
					// Swallow — best-effort cleanup of the failed attempt
				}
			}
			await this.#terminate(process)
			this.#process = undefined
			throw error
		}
	}

	async #waitForLaunch(
		process: ChildProcess,
		executable: string,
		args?: readonly string[],
	): Promise<string> {
		const context = { executable, args }

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
				finish(() => reject(new BrowserConnectionError(error.message, context)))
			}

			const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
				finish(() =>
					reject(new BrowserConnectionError(this.#formatLaunchExit(code, signal), context)),
				)
			}

			process.once('error', onError)
			process.once('exit', onExit)

			void waitForCdpReady(this.#cdpPort, this.#timeout(), this.#cdpHost).then(
				(wsUrl) => {
					finish(() => resolve(wsUrl))
				},
				(error: unknown) => {
					const message = error instanceof Error ? error.message : String(error)
					finish(() => reject(new BrowserConnectionError(message, context)))
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
		if (this.#client === undefined) return

		const targets = await fetchCdpTargets(this.#cdpPort, this.#timeout(), this.#cdpHost)
		const pageTargets = targets.filter((t) => t.type === 'page')

		if (pageTargets.length > 0 && this.#contexts.length === 0) {
			const ctx = new BrowserContext(
				this.#client,
				undefined,
				this.#options.viewport,
				createScreenshotWriter(),
			)
			await ctx.sync(pageTargets)
			this.#contexts.push(ctx)
		}
	}

	/**
	 * Terminate a browser process, escalating from SIGTERM to SIGKILL if it
	 * does not exit within the grace period. Tolerates a process that has
	 * already exited (ESRCH).
	 */
	async #terminate(process: ChildProcess | undefined): Promise<void> {
		if (process === undefined) return
		if (process.exitCode !== null || process.signalCode !== null) return

		const exited = new Promise<void>((resolve) => {
			process.once('exit', () => resolve())
		})

		try {
			process.kill('SIGTERM')
		} catch {
			// Already dead — tolerate ESRCH
			return
		}

		let timer: ReturnType<typeof setTimeout> | undefined
		const timedOut = await Promise.race([
			exited.then(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(true), BROWSER_KILL_GRACE_MS)
			}),
		])
		if (timer !== undefined) clearTimeout(timer)

		if (timedOut) {
			try {
				process.kill('SIGKILL')
			} catch {
				// Already dead — tolerate ESRCH
			}
			await exited
		}
	}
}
