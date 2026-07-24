import type { ChildProcess } from 'node:child_process'
import type {
	BrowserConnection,
	BrowserDiscoveryResult,
	BrowserEngine,
	BrowserEventMap,
	BrowserInterface,
	BrowserOptions,
	BrowserStatus,
} from './types.js'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserPageOptions,
	CDPTarget,
	CDPTransportInterface,
} from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import { addAbortListener, once } from 'node:events'
import { isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BrowserContext, BROWSER_DEFAULT_TIMEOUT_MS, CDPClient } from '@src/core'
import {
	BrowserConnectionError,
	BrowserDestroyedError,
	BrowserNotConnectedError,
} from './errors.js'
import {
	BROWSER_CDP_PROTOCOL,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_DEFAULT_CDP_PORT,
	BROWSER_DEFAULT_HOST,
	BROWSER_KILL_GRACE_MS,
	BROWSER_PORT_PROBE_TIMEOUT_MS,
	BROWSER_PROCESS_EXIT_CAUSE,
	BROWSER_TRANSPORT_LOSS_CAUSE,
	BROWSER_TRANSPORT_LOSS_DEFER_MS,
} from './constants.js'
import {
	browserToEngine,
	findSystemBrowser,
	launchBrowserProcess,
	parseBrowserEngine,
	waitForCDPReady,
} from './helpers.js'
import { createCDPTransport, createScreenshotWriter } from './factories.js'

// === Browser

export class Browser implements BrowserInterface {
	readonly #emitter: Emitter<BrowserEventMap>
	readonly #options: BrowserOptions
	readonly #abort = new AbortController()
	readonly #cdpPort: number
	readonly #cdpHost: string
	#engine: BrowserEngine
	#status: BrowserStatus = 'idle'
	#connection: BrowserConnection | undefined
	#owned: boolean | undefined
	#endpoint: string | undefined
	#client: CDPClient | undefined
	#process: ChildProcess | undefined
	#contexts: BrowserContext[] = []
	#destroyed = false
	#connecting: Promise<void> | undefined
	#disconnecting: Promise<void> | undefined
	#shutdown: Promise<void> | undefined
	#transport: CDPTransportInterface | undefined
	#onTransportClose = (): void => this.#handleTransportLoss()
	#onTransportError = (): void => this.#handleTransportLoss()
	#onProcessExit = (): void => this.#handleProcessExit()

	constructor(options?: BrowserOptions) {
		this.#emitter = new Emitter({ on: options?.on, error: options?.error })
		this.#options = options ?? {}
		this.#engine =
			this.#options.engine ??
			(this.#options.executable !== undefined
				? (parseBrowserEngine(this.#options.executable) ?? 'chromium')
				: 'chromium')
		this.#cdpPort = this.#options.cdp?.port ?? BROWSER_DEFAULT_CDP_PORT
		this.#cdpHost = this.#options.cdp?.host ?? BROWSER_DEFAULT_HOST

		queueMicrotask(() => this.#emitter.emit('idle'))
	}

	get emitter(): EmitterInterface<BrowserEventMap> {
		return this.#emitter
	}

	get engine(): BrowserEngine {
		return this.#engine
	}

	get status(): BrowserStatus {
		return this.#status
	}

	get connection(): BrowserConnection | undefined {
		return this.#connection
	}

	get owned(): boolean | undefined {
		return this.#owned
	}

	get connected(): boolean {
		return this.#status === 'connected'
	}

	get pid(): number | undefined {
		return this.#process?.pid
	}

	async discover(): Promise<BrowserDiscoveryResult> {
		const result = await this.#discoverCDP()
		this.#emitter.emit('discover', result)
		return result
	}

	async connect(): Promise<void> {
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (this.#disconnecting !== undefined) await this.#disconnecting
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (this.#status === 'connected') return

		const active = this.#connecting
		if (active !== undefined) {
			await active
			return
		}

		const attempt = this.#establish()
		this.#connecting = attempt

		try {
			await attempt
		} finally {
			if (this.#connecting === attempt) this.#connecting = undefined
		}
	}

	adopt(): void {
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (
			this.#status !== 'connected' ||
			this.#client === undefined ||
			this.#endpoint === undefined
		) {
			throw new BrowserNotConnectedError()
		}
		this.#owned = true
	}

	async disconnect(): Promise<void> {
		if (this.#destroyed) return

		const active = this.#disconnecting
		if (active !== undefined) {
			await active
			return
		}
		if (this.#connecting !== undefined) {
			await this.#connecting.catch(() => undefined)
			if (this.#destroyed) return
		}
		if (this.#status !== 'connected' || this.#client === undefined) return

		const attempt = this.#detach()
		this.#disconnecting = attempt

		try {
			await attempt
		} finally {
			if (this.#disconnecting === attempt) this.#disconnecting = undefined
		}
	}

	context(index?: number): BrowserContextInterface | undefined {
		const i = index ?? 0
		if (i < 0 || i >= this.#contexts.length) return undefined
		return this.#contexts[i]
	}

	contexts(): readonly BrowserContextInterface[] {
		return [...this.#contexts]
	}

	async create(options?: BrowserPageOptions): Promise<BrowserPageInterface> {
		if (this.#destroyed) throw new BrowserDestroyedError()
		const client = this.#client
		if (this.#status !== 'connected' || client === undefined) {
			throw new BrowserNotConnectedError()
		}

		let context = this.#contexts[0]
		if (context === undefined) {
			context = new BrowserContext(
				client,
				undefined,
				this.#options.viewport,
				createScreenshotWriter(),
			)
			this.#contexts.push(context)
		}

		const page = await context.create(options)
		this.#emitter.emit('page', page)
		return page
	}

	destroy(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active
		if (this.#destroyed) return Promise.resolve()

		this.#destroyed = true
		this.#abort.abort()
		const shutdown = this.#destroyResources()
		this.#shutdown = shutdown
		return shutdown
	}

	close(): Promise<void> {
		const active = this.#shutdown
		if (active !== undefined) return active
		if (this.#destroyed) return Promise.resolve()

		this.#destroyed = true
		this.#abort.abort()
		const shutdown = this.#closeResources()
		this.#shutdown = shutdown
		return shutdown
	}

	// === Private helpers

	async #establish(): Promise<void> {
		this.#assertNotAborted()
		this.#status = 'connecting'

		try {
			if (this.#owned === true && this.#endpoint !== undefined) {
				await this.#connectCDP(this.#endpoint)
				return
			}

			const endpoint = this.#options.cdp?.endpoint
			if (endpoint !== undefined) {
				await this.#connectCDP(endpoint)
				return
			}

			const discover = this.#options.cdp?.discover ?? true
			if (discover) {
				const discovery = await this.#raceAbort(this.#discoverCDP(this.#signal()))
				if (discovery.found && discovery.endpoint !== undefined) {
					this.#engine = browserToEngine(discovery.browser)
					await this.#connectCDP(discovery.endpoint)
					return
				}
			} else {
				await this.#raceAbort(this.#assertPortFree())
			}

			this.#assertNotAborted()
			await this.#launch()
		} catch (error) {
			if (this.#destroyed) throw new BrowserDestroyedError()

			this.#status = 'error'
			this.#emitter.emit('error', error)
			if (error instanceof BrowserConnectionError) throw error

			const message = error instanceof Error ? error.message : String(error)
			throw new BrowserConnectionError(message, { executable: this.#options.executable })
		}
	}

	async #detach(): Promise<void> {
		this.#status = 'disconnected'
		this.#connection = undefined
		this.#unbindTransport()

		const client = this.#client
		this.#client = undefined
		await this.#destroyContexts()
		this.#contexts = []

		if (this.#owned !== true) {
			this.#owned = undefined
			this.#endpoint = undefined
		}

		await this.#closeClient(client)
		if (this.#destroyed) return

		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	#assertNotAborted(): void {
		if (this.#signal().aborted) throw new BrowserConnectionError('Connection aborted')
	}

	#signal(): AbortSignal {
		const external = this.#options.signal
		return external === undefined
			? this.#abort.signal
			: AbortSignal.any([this.#abort.signal, external])
	}

	async #raceAbort<T>(promise: Promise<T>): Promise<T> {
		const signal = this.#signal()
		if (signal.aborted) throw new BrowserConnectionError('Connection aborted')

		const aborted = Promise.withResolvers<never>()
		const listener = addAbortListener(signal, () => {
			aborted.reject(new BrowserConnectionError('Connection aborted'))
		})

		try {
			return await Promise.race([promise, aborted.promise])
		} finally {
			listener[Symbol.dispose]()
			void promise.catch(() => undefined)
		}
	}

	#handleProcessExit(): void {
		if (this.#destroyed) return

		const connected = this.#status === 'connected'
		const client = this.#client
		const contexts = this.#contexts
		this.#unbindTransport()
		this.#unbindProcess()
		this.#process = undefined
		this.#client = undefined
		this.#contexts = []
		this.#connection = undefined
		this.#owned = undefined
		this.#endpoint = undefined
		if (connected) this.#status = 'disconnected'

		void this.#destroyContextList(contexts)
		void this.#closeClient(client)
		this.#emitter.emit(
			'error',
			new BrowserConnectionError('The browser process exited unexpectedly', {
				cause: BROWSER_PROCESS_EXIT_CAUSE,
			}),
		)

		if (connected) {
			this.#emitter.emit('disconnect')
			this.#emitter.emit('idle')
		}
	}

	#handleTransportLoss(): void {
		if (this.#destroyed || this.#status !== 'connected') return

		const process = this.#process
		if (process !== undefined && (process.exitCode !== null || process.signalCode !== null)) {
			this.#handleProcessExit()
			return
		}

		if (process !== undefined) {
			setTimeout(() => this.#confirmTransportLoss(), BROWSER_TRANSPORT_LOSS_DEFER_MS)
			return
		}

		this.#confirmTransportLoss()
	}

	#confirmTransportLoss(): void {
		if (this.#destroyed || this.#status !== 'connected') return

		const process = this.#process
		if (process !== undefined && (process.exitCode !== null || process.signalCode !== null)) {
			this.#handleProcessExit()
			return
		}

		if (process?.pid !== undefined) {
			try {
				process.kill(0)
			} catch {
				this.#handleProcessExit()
				return
			}
		}

		const client = this.#client
		const owned = this.#owned === true
		const contexts = this.#contexts
		this.#unbindTransport()
		this.#client = undefined
		this.#contexts = []
		this.#connection = undefined
		this.#status = 'disconnected'

		if (!owned) {
			this.#owned = undefined
			this.#endpoint = undefined
		}

		void this.#destroyContextList(contexts)
		void this.#closeClient(client)
		this.#emitter.emit(
			'error',
			new BrowserConnectionError('The CDP transport connection was lost', {
				cause: BROWSER_TRANSPORT_LOSS_CAUSE,
			}),
		)
		this.#emitter.emit('disconnect')
		this.#emitter.emit('idle')
	}

	#bindTransport(transport: CDPTransportInterface): void {
		this.#unbindTransport()
		this.#transport = transport
		transport.emitter.on('close', this.#onTransportClose)
		transport.emitter.on('error', this.#onTransportError)
	}

	#unbindTransport(): void {
		const transport = this.#transport
		if (transport === undefined) return
		transport.emitter.off('close', this.#onTransportClose)
		transport.emitter.off('error', this.#onTransportError)
		this.#transport = undefined
	}

	#bindProcess(process: ChildProcess): void {
		this.#unbindProcess()
		process.once('exit', this.#onProcessExit)
		if (process.exitCode !== null || process.signalCode !== null) {
			queueMicrotask(this.#onProcessExit)
		}
	}

	#unbindProcess(): void {
		this.#process?.off('exit', this.#onProcessExit)
	}

	#timeout(): number {
		return this.#options.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
	}

	async #discoverCDP(signal?: AbortSignal): Promise<BrowserDiscoveryResult> {
		const url = `${BROWSER_CDP_PROTOCOL}://${this.#cdpHost}:${this.#cdpPort}${BROWSER_CDP_VERSION_PATH}`
		const requestSignal =
			signal === undefined
				? AbortSignal.timeout(this.#timeout())
				: AbortSignal.any([signal, AbortSignal.timeout(this.#timeout())])

		try {
			const response = await fetch(url, { signal: requestSignal })
			if (!response.ok) return this.#notFound()

			const info: unknown = await response.json()
			if (!isRecord(info)) return this.#notFound()

			const endpoint = isString(info['webSocketDebuggerUrl'])
				? info['webSocketDebuggerUrl']
				: undefined
			const browser = isString(info['Browser']) ? info['Browser'] : undefined

			return {
				found: endpoint !== undefined,
				endpoint,
				browser,
				connection: endpoint !== undefined ? 'cdp' : undefined,
			}
		} catch (error) {
			if (signal?.aborted === true) throw error
			return this.#notFound()
		}
	}

	#notFound(): BrowserDiscoveryResult {
		return { found: false, endpoint: undefined, browser: undefined, connection: undefined }
	}

	async #assertPortFree(): Promise<void> {
		if (await this.#probePort()) {
			throw new BrowserConnectionError(
				`Port ${this.#cdpPort} on ${this.#cdpHost} is already occupied by another CDP endpoint`,
				{ port: this.#cdpPort, host: this.#cdpHost },
			)
		}
	}

	async #probePort(): Promise<boolean> {
		const url = `${BROWSER_CDP_PROTOCOL}://${this.#cdpHost}:${this.#cdpPort}${BROWSER_CDP_VERSION_PATH}`

		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(BROWSER_PORT_PROBE_TIMEOUT_MS),
			})
			return response.ok
		} catch {
			return false
		}
	}

	async #connectCDP(endpoint: string): Promise<void> {
		const transport = createCDPTransport({ url: endpoint, timeout: this.#timeout() })
		const client = new CDPClient({ transport, timeout: this.#timeout() })
		const retained = this.#owned === true && this.#endpoint === endpoint

		try {
			await this.#raceAbort(client.connect())

			this.#client = client
			this.#endpoint = endpoint
			this.#connection = retained ? this.#retainedConnection() : 'cdp'
			this.#owned = retained
			this.#status = 'connected'
			this.#bindTransport(transport)

			await this.#syncContexts()
			this.#emitter.emit('connect', this.#connection)
		} catch (error) {
			this.#unbindTransport()
			if (this.#client === client) this.#client = undefined
			this.#contexts = []
			this.#connection = undefined
			if (!retained) {
				this.#owned = undefined
				this.#endpoint = undefined
			}
			await this.#closeClient(client)
			throw error
		}
	}

	async #launch(): Promise<void> {
		if (this.#process !== undefined) {
			throw new BrowserConnectionError('A browser process is already active on this instance')
		}

		const requestedEngine = this.#options.engine ?? this.#options.browsers?.engine
		let executable = this.#options.executable
		let resolvedEngine: BrowserEngine | undefined

		if (executable !== undefined) {
			resolvedEngine = parseBrowserEngine(executable) ?? 'chromium'
		} else {
			const found = findSystemBrowser({ ...this.#options.browsers, engine: requestedEngine })
			executable = found?.executable
			resolvedEngine = found?.engine
		}

		if (executable === undefined) {
			throw new BrowserConnectionError(
				'No Chromium browser found. Install Chrome, Edge, or Chromium.',
				requestedEngine === undefined ? undefined : { engine: requestedEngine },
			)
		}

		this.#engine = resolvedEngine ?? 'chromium'
		const profile = this.#options.profile
		const process = launchBrowserProcess(
			executable,
			this.#cdpPort,
			this.#options.headless ?? true,
			profile,
			this.#options.args,
		)
		this.#process = process

		let client: CDPClient | undefined

		try {
			const endpoint = await this.#waitForLaunch(process, executable, this.#options.args)
			const transport = createCDPTransport({ url: endpoint, timeout: this.#timeout() })
			client = new CDPClient({ transport, timeout: this.#timeout() })
			await this.#raceAbort(client.connect())

			const connection = profile === undefined ? 'launch' : 'persistent'
			this.#client = client
			this.#endpoint = endpoint
			this.#connection = connection
			this.#owned = true
			this.#status = 'connected'
			this.#bindTransport(transport)
			this.#bindProcess(process)

			await this.#syncContexts()
			this.#emitter.emit('launch', this.#engine)
			this.#emitter.emit('connect', connection)
		} catch (error) {
			this.#unbindTransport()
			this.#unbindProcess()
			await this.#closeClient(client)
			await this.#terminate(process)
			this.#process = undefined
			this.#client = undefined
			this.#endpoint = undefined
			this.#owned = undefined
			throw error
		}
	}

	async #waitForLaunch(
		process: ChildProcess,
		executable: string,
		args?: readonly string[],
	): Promise<string> {
		const context = { executable, args }
		const controller = new AbortController()
		const signal = AbortSignal.any([controller.signal, this.#signal()])
		const ready = waitForCDPReady(this.#cdpPort, this.#timeout(), this.#cdpHost, signal)
		const exited = once(process, 'exit', { signal }).then((values) => {
			const code = typeof values[0] === 'number' ? values[0] : null
			const exitSignal = typeof values[1] === 'string' ? values[1] : null
			throw new BrowserConnectionError(this.#formatLaunchExit(code, exitSignal), context)
		})

		try {
			return await Promise.race([ready, exited])
		} catch (error) {
			if (error instanceof BrowserConnectionError) throw error
			if (this.#signal().aborted) throw new BrowserConnectionError('Connection aborted', context)

			const message = error instanceof Error ? error.message : String(error)
			throw new BrowserConnectionError(message, context)
		} finally {
			controller.abort()
			void ready.catch(() => undefined)
			void exited.catch(() => undefined)
		}
	}

	#formatLaunchExit(code: number | null, signal: string | null): string {
		if (signal !== null) {
			return `Browser process exited before CDP became ready (signal: ${signal})`
		}
		if (code !== null) return `Browser process exited before CDP became ready (code: ${code})`
		return 'Browser process exited before CDP became ready'
	}

	#retainedConnection(): BrowserConnection {
		if (this.#process === undefined) return 'cdp'
		return this.#options.profile === undefined ? 'launch' : 'persistent'
	}

	async #syncContexts(): Promise<void> {
		const client = this.#client
		if (client === undefined) return

		let result: unknown
		try {
			result = await client.send('Target.getTargets')
		} catch {
			return
		}
		if (!isRecord(result) || !Array.isArray(result['targetInfos'])) return

		const pages: CDPTarget[] = []
		for (const target of result['targetInfos']) {
			if (
				!isRecord(target) ||
				!isString(target['targetId']) ||
				target['type'] !== 'page' ||
				!isString(target['title']) ||
				!isString(target['url'])
			) {
				continue
			}
			pages.push({
				id: target['targetId'],
				type: target['type'],
				title: target['title'],
				url: target['url'],
			})
		}
		if (pages.length === 0 || this.#contexts.length > 0) return

		const context = new BrowserContext(
			client,
			undefined,
			this.#options.viewport,
			createScreenshotWriter(),
		)
		await context.sync(pages)
		this.#contexts.push(context)
	}

	async #destroyResources(): Promise<void> {
		try {
			await this.#settle()
			this.#unbindTransport()
			this.#unbindProcess()

			const client = this.#client
			if (this.#owned === true) {
				await this.#closeContexts()
				if (this.#process === undefined) await this.#closeRemote(client)
			} else {
				await this.#destroyContexts()
			}
			this.#contexts = []

			await this.#terminate(this.#process)
			this.#process = undefined
			await this.#closeClient(client)
			this.#client = undefined
		} finally {
			this.#finish()
		}
	}

	async #closeResources(): Promise<void> {
		try {
			await this.#settle()
			this.#unbindTransport()
			this.#unbindProcess()

			const client = this.#client
			await this.#closeContexts()
			this.#contexts = []
			await this.#closeRemote(client)

			const process = this.#process
			if (process !== undefined) {
				const exited = await this.#waitForProcessWithin(process, BROWSER_KILL_GRACE_MS)
				if (!exited) await this.#terminate(process)
			}
			this.#process = undefined

			await this.#closeClient(client)
			this.#client = undefined
		} finally {
			this.#finish()
		}
	}

	async #settle(): Promise<void> {
		await this.#connecting?.catch(() => undefined)
		await this.#disconnecting?.catch(() => undefined)
	}

	async #closeRemote(client: CDPClient | undefined): Promise<void> {
		let remote = client
		let temporary = false

		if (remote === undefined && this.#owned === true && this.#endpoint !== undefined) {
			const transport = createCDPTransport({
				url: this.#endpoint,
				timeout: this.#timeout(),
			})
			remote = new CDPClient({ transport, timeout: this.#timeout() })
			try {
				await remote.connect()
				temporary = true
			} catch {
				await this.#closeClient(remote)
				return
			}
		}

		if (remote !== undefined) {
			try {
				await remote.send('Browser.close')
			} catch {
				// The remote may already be gone or close before acknowledging.
			}
		}

		if (temporary) await this.#closeClient(remote)
	}

	async #closeContexts(): Promise<void> {
		for (const context of this.#contexts) {
			try {
				await context.close()
			} catch {
				// Teardown is best-effort after the browser begins shutting down.
			}
		}
	}

	async #destroyContexts(): Promise<void> {
		await this.#destroyContextList(this.#contexts)
	}

	async #destroyContextList(contexts: readonly BrowserContext[]): Promise<void> {
		for (const context of contexts) {
			try {
				await context.destroy()
			} catch {
				// The transport may already be unavailable.
			}
		}
	}

	async #closeClient(client: CDPClient | undefined): Promise<void> {
		if (client === undefined) return
		try {
			await client.close()
		} catch {
			// Teardown is best-effort after a connection fault.
		}
	}

	async #waitForProcess(process: ChildProcess): Promise<void> {
		if (process.exitCode !== null || process.signalCode !== null) return
		await once(process, 'exit')
	}

	async #waitForProcessWithin(process: ChildProcess, timeout: number): Promise<boolean> {
		if (process.exitCode !== null || process.signalCode !== null) return true

		const signal = AbortSignal.timeout(timeout)
		try {
			await once(process, 'exit', { signal })
			return true
		} catch (error) {
			if (signal.aborted) {
				return process.exitCode !== null || process.signalCode !== null
			}
			throw error
		}
	}

	async #terminate(process: ChildProcess | undefined): Promise<void> {
		if (process === undefined || process.exitCode !== null || process.signalCode !== null) return

		try {
			process.kill('SIGTERM')
		} catch {
			return
		}

		if (await this.#waitForProcessWithin(process, BROWSER_KILL_GRACE_MS)) return

		try {
			process.kill('SIGKILL')
		} catch {
			return
		}
		await this.#waitForProcess(process)
	}

	#finish(): void {
		this.#unbindTransport()
		this.#unbindProcess()
		this.#status = 'disconnected'
		this.#connection = undefined
		this.#owned = undefined
		this.#endpoint = undefined
		this.#client = undefined
		this.#process = undefined
		this.#contexts = []
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
