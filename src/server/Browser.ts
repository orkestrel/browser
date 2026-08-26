import type { ChildProcess } from 'node:child_process'
import type {
	BrowserConnection,
	BrowserDiscoveryResult,
	BrowserEngine,
	BrowserEventMap,
	BrowserInterface,
	BrowserOptions,
	BrowserProfileResult,
	BrowserStatus,
} from './types.js'
import type {
	BrowserContextInterface,
	BrowserContextOptions,
	BrowserPageInterface,
	BrowserPageOptions,
	CDPTarget,
	CDPTransportInterface,
} from '@src/core'
import type { EmitterInterface } from '@orkestrel/emitter'
import { addAbortListener, once } from 'node:events'
import { isArray, isError, isInteger, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import {
	BrowserContext,
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_WAIT_POLL_INTERVAL_MS,
	CDPClient,
	validateBrowserContextOptions,
} from '@src/core'
import {
	BrowserConnectionError,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	isBrowserConnectionError,
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
	createBrowserProfile,
	findSystemBrowser,
	launchBrowserProcess,
	parseBrowserEngine,
	removeBrowserProfile,
	waitForCDPReady,
} from './helpers.js'
import { createCDPTransport, createScreenshotWriter } from './factories.js'

// === Browser

/**
 * Discovers, launches, connects to, and owns Chromium-family browser sessions.
 */
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
	// Identifier the launcher handed the endpoint to when it re-executed the
	// browser and exited before CDP became ready. Undefined whenever the
	// spawned child is itself the process serving the endpoint.
	#servingPid: number | undefined
	#profile: BrowserProfileResult | undefined
	#contexts: BrowserContext[] = []
	#destroyed = false
	#connecting: Promise<void> | undefined
	#disconnecting: Promise<void> | undefined
	#exitCleanup: Promise<void> | undefined
	#shutdown: Promise<void> | undefined
	#transport: CDPTransportInterface | undefined
	readonly #onTransportClose = this.#handleTransportLoss.bind(this)
	readonly #onTransportError = this.#handleTransportLoss.bind(this)
	readonly #onProcessExit = this.#handleProcessExit.bind(this)

	constructor(options?: BrowserOptions) {
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
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
		return this.#servingPid ?? this.#process?.pid
	}

	async discover(): Promise<BrowserDiscoveryResult> {
		const result = await this.#discoverCDP()
		this.#emitter.emit('discover', result)
		return result
	}

	async connect(): Promise<void> {
		if (this.#destroyed) throw new BrowserDestroyedError()

		const active = this.#connecting
		if (active !== undefined) {
			await active
			return
		}
		if (this.#status === 'connected') return

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

		const disconnecting = this.#disconnecting
		const connecting = this.#connecting
		if (disconnecting !== undefined) await disconnecting
		if (connecting !== undefined) await connecting.catch(() => undefined)
		if (this.#destroyed) return
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

	async isolate(options?: BrowserContextOptions): Promise<BrowserContextInterface> {
		if (this.#destroyed) throw new BrowserDestroyedError()
		const client = this.#client
		if (this.#status !== 'connected' || client === undefined) {
			throw new BrowserNotConnectedError()
		}
		validateBrowserContextOptions(options)
		const params: Record<string, unknown> = { disposeOnDetach: false }
		if (options?.proxy !== undefined) {
			params['proxyServer'] = options.proxy.server
			if (options.proxy.bypass !== undefined) {
				params['proxyBypassList'] = options.proxy.bypass.join(',')
			}
		}
		if (options?.origins !== undefined) {
			params['originsWithUniversalNetworkAccess'] = [...options.origins]
		}
		const result = await client.send('Target.createBrowserContext', params)
		if (!isRecord(result) || !isString(result['browserContextId'])) {
			throw new BrowserConnectionError('Failed to create isolated browser context')
		}
		const id = result['browserContextId']
		const context = new BrowserContext(
			client,
			id,
			options?.emulation?.viewport ?? this.#options.viewport,
			createScreenshotWriter(),
			options?.emulation,
			options?.downloads,
		)

		try {
			if (options?.downloads !== undefined) {
				await client.send('Browser.setDownloadBehavior', {
					behavior: options.downloads.named === true ? 'allowAndName' : 'allow',
					browserContextId: id,
					downloadPath: options.downloads.path,
					eventsEnabled: true,
				})
			}
		} catch (error) {
			await context.close().catch(() => undefined)
			throw error
		}

		this.#registerContext(context)
		return context
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
			this.#registerContext(context)
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
		if (this.#disconnecting !== undefined) await this.#disconnecting
		await this.#settleExit()
		if (this.#destroyed) throw new BrowserDestroyedError()
		if (this.#status === 'connected') return

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
			if (isBrowserConnectionError(error)) throw error

			const message = isError(error) ? error.message : String(error)
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
		const process = this.#process
		this.#unbindTransport()
		this.#unbindProcess()
		this.#process = undefined
		this.#servingPid = undefined
		const cleanup = this.#cleanupExitedProcess(process, contexts, client)
		this.#exitCleanup = cleanup
		void cleanup.catch((error: unknown) => this.#emitter.emit('error', error))
		this.#client = undefined
		this.#contexts = []
		this.#connection = undefined
		this.#owned = undefined
		this.#endpoint = undefined
		if (connected) this.#status = 'disconnected'

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

		if (this.#process === undefined) {
			this.#confirmTransportLoss()
			return
		}

		if (!this.#alive()) {
			this.#handleProcessExit()
			return
		}

		// A spawned child that is already dead is diagnosed by its own `exit`
		// event, never by a probe here: Node sets `exitCode` in the same callback
		// that emits `exit`, and reports ESRCH from `ChildProcess.kill(0)` as a
		// `false` return rather than a throw, so no reading of the handle can see
		// the death before the event does. The defer only has to outlast the loop
		// turn that delivers it.
		setTimeout(() => this.#confirmTransportLoss(), BROWSER_TRANSPORT_LOSS_DEFER_MS)
	}

	#confirmTransportLoss(): void {
		if (this.#destroyed || this.#status !== 'connected') return

		if (this.#process !== undefined && !this.#alive()) {
			this.#handleProcessExit()
			return
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
		// A launcher that handed the endpoint on has already exited, and its exit
		// says nothing about the browser now serving CDP. That browser has no
		// child handle, so the transport reports its death.
		if (this.#servingPid !== undefined) return
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
			const found = findSystemBrowser({
				...this.#options.browsers,
				...(requestedEngine !== undefined ? { engine: requestedEngine } : {}),
			})
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
		await this.#releaseProfile()
		const profile = await createBrowserProfile(this.#options.profile)
		this.#profile = profile
		let process: ChildProcess
		try {
			process = launchBrowserProcess(
				executable,
				this.#cdpPort,
				this.#options.headless ?? true,
				profile.path,
				this.#options.args,
			)
		} catch (error) {
			await this.#releaseProfile()
			throw error
		}
		this.#process = process

		let client: CDPClient | undefined

		try {
			const endpoint = await this.#waitForLaunch(process, executable, this.#options.args)
			const transport = createCDPTransport({ url: endpoint, timeout: this.#timeout() })
			client = new CDPClient({ transport, timeout: this.#timeout() })
			await this.#raceAbort(client.connect())
			await this.#takeEndpointOwner(process, client)

			const connection = this.#options.profile === undefined ? 'launch' : 'persistent'
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
			await this.#releaseProfile()
			this.#process = undefined
			this.#servingPid = undefined
			this.#client = undefined
			this.#endpoint = undefined
			this.#owned = undefined
			throw error
		}
	}

	/**
	 * Takes over the process serving the CDP endpoint when the spawned child is
	 * no longer it.
	 *
	 * @remarks
	 * A Windows launcher — Microsoft Edge — re-executes the browser with the
	 * same `--remote-debugging-port` and exits 0 before the endpoint answers, so
	 * the child this instance spawned parents the real tree without being part
	 * of it. Chromium names the process behind the endpoint as the `browser`
	 * entry of `SystemInfo.getProcessInfo`, which identifies it without a
	 * platform branch. An endpoint that names no such process cannot be owned,
	 * so the launch closes it and fails rather than leaking it.
	 */
	async #takeEndpointOwner(process: ChildProcess, client: CDPClient): Promise<void> {
		if (process.exitCode === null && process.signalCode === null) return

		let result: unknown
		try {
			result = await client.send('SystemInfo.getProcessInfo')
		} catch {
			result = undefined
		}

		let pid: number | undefined
		if (isRecord(result) && isArray(result['processInfo'])) {
			for (const entry of result['processInfo']) {
				if (!isRecord(entry) || entry['type'] !== 'browser' || !isInteger(entry['id'])) continue
				pid = entry['id']
				break
			}
		}

		if (pid === undefined) {
			await this.#closeRemote(client)
			throw new BrowserConnectionError(
				'The browser launcher exited without naming the process serving its CDP endpoint',
				{ executable: this.#options.executable, pid: process.pid },
			)
		}

		this.#servingPid = pid
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
			const code = isInteger(values[0]) ? values[0] : null
			const exitSignal = isString(values[1]) ? values[1] : null
			// A launcher that re-executes the browser exits cleanly and hands the
			// endpoint to the process it spawned, so a clean exit ends the child
			// rather than the launch. Keep waiting for the endpoint on the same
			// readiness budget, which still fails loudly when none appears.
			if (code === 0 && exitSignal === null) return ready
			throw new BrowserConnectionError(this.#formatLaunchExit(code, exitSignal), context)
		})

		try {
			return await Promise.race([ready, exited])
		} catch (error) {
			if (isBrowserConnectionError(error)) throw error
			if (this.#signal().aborted) throw new BrowserConnectionError('Connection aborted', context)

			const message = isError(error) ? error.message : String(error)
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
		if (!isRecord(result) || !isArray(result['targetInfos'])) return

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
		this.#registerContext(context)
	}

	async #destroyResources(): Promise<void> {
		let terminated = false
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
			this.#servingPid = undefined
			terminated = true
		} finally {
			const contexts = this.#contexts
			this.#contexts = []
			const client = this.#client
			this.#client = undefined
			try {
				await this.#cleanupLocal(contexts, client)
				if (terminated) await this.#releaseProfile()
			} finally {
				this.#finish()
			}
		}
	}

	async #closeResources(): Promise<void> {
		let terminated = false
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
				const exited = await this.#waitForTerminationWithin(process, BROWSER_KILL_GRACE_MS)
				if (!exited) await this.#terminate(process)
			}
			this.#process = undefined
			this.#servingPid = undefined
			terminated = true
		} finally {
			const contexts = this.#contexts
			this.#contexts = []
			const client = this.#client
			this.#client = undefined
			try {
				await this.#cleanupLocal(contexts, client)
				if (terminated) await this.#releaseProfile()
			} finally {
				this.#finish()
			}
		}
	}

	async #settle(): Promise<void> {
		await this.#connecting?.catch(() => undefined)
		await this.#disconnecting?.catch(() => undefined)
		await this.#settleExit()
	}

	async #settleExit(): Promise<void> {
		const cleanup = this.#exitCleanup
		if (cleanup === undefined) return
		await cleanup
		if (this.#exitCleanup === cleanup) this.#exitCleanup = undefined
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
		for (const context of [...this.#contexts]) {
			try {
				await context.close()
			} catch {
				// Teardown is best-effort after the browser begins shutting down.
			}
		}
	}

	async #destroyContexts(): Promise<void> {
		await this.#destroyContextList([...this.#contexts])
	}

	#registerContext(context: BrowserContext): void {
		this.#contexts.push(context)
		context.emitter.on('close', () => {
			const index = this.#contexts.indexOf(context)
			if (index >= 0) this.#contexts.splice(index, 1)
		})
		this.#emitter.emit('context', context)
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

	async #releaseProfile(): Promise<void> {
		const profile = this.#profile
		this.#profile = undefined
		if (profile !== undefined) await removeBrowserProfile(profile)
	}

	async #cleanupExitedProcess(
		process: ChildProcess | undefined,
		contexts: readonly BrowserContext[],
		client: CDPClient | undefined,
	): Promise<void> {
		let terminated = false
		try {
			await this.#terminate(process)
			terminated = true
		} finally {
			await this.#cleanupLocal(contexts, client)
		}
		if (terminated) await this.#releaseProfile()
	}

	async #cleanupLocal(
		contexts: readonly BrowserContext[],
		client: CDPClient | undefined,
	): Promise<void> {
		await this.#destroyContextList(contexts)
		await this.#closeClient(client)
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

	#hasProcessGroup(process: ChildProcess): boolean {
		const pid = process.pid
		return globalThis.process.platform !== 'win32' && pid !== undefined && pid > 0
	}

	// Whether the process serving the CDP endpoint is still running. The spawned
	// child reports through its own handle; a process the launcher handed the
	// endpoint to has none, so it is probed by identifier.
	#alive(): boolean {
		const process = this.#process
		if (process === undefined) return false
		if (this.#servingPid !== undefined) return this.#signalProcess(process, 0) !== false
		return process.exitCode === null && process.signalCode === null
	}

	// Whether the launch retains a process the reaped child does not account
	// for: the POSIX process group, or the process the launcher handed the
	// endpoint to.
	#inspectRemainder(process: ChildProcess): boolean | undefined {
		if (!this.#hasProcessGroup(process) && this.#servingPid === undefined) return false
		return this.#signalProcess(process, 0)
	}

	#signalProcess(process: ChildProcess, signal: NodeJS.Signals | 0): boolean | undefined {
		const pid = process.pid
		const serving = this.#servingPid
		try {
			if (this.#hasProcessGroup(process) && pid !== undefined) {
				return globalThis.process.kill(-pid, signal)
			}
			// Terminating the Chromium browser process takes its whole tree with
			// it, so Windows needs no separate tree walk to reach the renderers,
			// GPU, and utility children the serving process parents.
			if (serving !== undefined) return globalThis.process.kill(serving, signal)
			return process.kill(signal)
		} catch (error) {
			const code =
				isError(error) && 'code' in error && isString(error.code) ? error.code : undefined
			if (code === 'ESRCH') return false
			if (signal === 0) return code === 'EPERM' ? true : undefined
			throw new BrowserConnectionError('Failed to signal the browser process', {
				pid: serving ?? pid,
				signal,
				cause: error,
			})
		}
	}

	async #waitForRemainderWithin(
		process: ChildProcess,
		timeout: number,
	): Promise<boolean | undefined> {
		const deadline = performance.now() + timeout
		let confirmed = false
		// Node observes only the direct child, and neither the rest of a POSIX
		// process group nor a process the launcher handed the endpoint to raises
		// an exit event here, so bound the drain probe.
		while (true) {
			const alive = this.#inspectRemainder(process)
			if (alive === false) return true
			if (alive === true) confirmed = true
			const remaining = deadline - performance.now()
			if (remaining <= 0) return confirmed ? false : undefined
			await new Promise<void>((resolve) =>
				setTimeout(resolve, Math.min(BROWSER_WAIT_POLL_INTERVAL_MS, remaining)),
			)
		}
	}

	async #waitForTerminationWithin(
		process: ChildProcess,
		timeout: number,
		final = false,
	): Promise<boolean> {
		const exited = this.#waitForProcessWithin(process, timeout)
		const drained = this.#waitForRemainderWithin(process, timeout)
		const results = await Promise.all([exited, drained])
		return results[0] && (results[1] === true || (final && results[1] === undefined))
	}

	async #terminate(process: ChildProcess | undefined): Promise<void> {
		if (
			process === undefined ||
			((process.exitCode !== null || process.signalCode !== null) &&
				this.#inspectRemainder(process) === false)
		) {
			return
		}

		if (this.#signalProcess(process, 'SIGTERM') === false) return
		if (await this.#waitForTerminationWithin(process, BROWSER_KILL_GRACE_MS)) return

		if (this.#signalProcess(process, 'SIGKILL') === false) return
		if (await this.#waitForTerminationWithin(process, BROWSER_KILL_GRACE_MS, true)) return

		throw new BrowserConnectionError('Browser process did not exit after SIGKILL', {
			pid: this.#servingPid ?? process.pid,
		})
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
		this.#servingPid = undefined
		this.#exitCleanup = undefined
		this.#contexts = []
		this.#emitter.emit('destroy')
		this.#emitter.destroy()
	}
}
