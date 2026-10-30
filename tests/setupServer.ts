import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http'
import type { AddressInfo, Server as NetServer, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { FileHandle } from 'node:fs/promises'
import type { AsyncHook } from 'node:async_hooks'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { RetryOptions, TeardownInterface } from '@orkestrel/test'
import type { MCPTransportInterface } from '@orkestrel/mcp'
import type {
	BrowserToolsetReason,
	BrowserCallOptions,
	BrowserContextInterface,
	BrowserIsolateOptions,
	BrowserPageInterface,
	BrowserStoreOptions,
} from '@src/core'
import type {
	FileBrowserStoreOptions,
	BrowserConnection,
	BrowserDiscoveryResult,
	BrowserEventMap,
	BrowserInterface,
	BrowserLaunchFunction,
	BrowserMCPServerOptions,
	BrowserOptions,
	BrowserStatus,
} from '@src/server'
import type { BrowserElementFixture, CDPSentMessage, CDPTestTransportInterface } from './setup.js'
import type { BrowserFilesystemCase } from './setup.js'
import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { createHook } from 'node:async_hooks'
import { addAbortListener } from 'node:events'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import { createBrowserMCPServer, formatBrowserLockEntry, parseBrowserLockEntry } from '@src/server'
import { createConnection, createServer as createNetServer } from 'node:net'
import { constants, existsSync, globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { open, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
	attempt,
	isArray,
	isError,
	isFunction,
	isInteger,
	isNumber,
	isObject,
	isRecord,
	isString,
	parseArray,
	parseJSON,
} from '@orkestrel/contract'
import {
	createNodeWebSocket,
	encodeWebSocketFrame,
	parseWebSocketFrame,
	WEBSOCKET_OPCODE_TEXT,
	WEBSOCKET_READY_OPEN,
} from '@orkestrel/websocket'
import {
	createLoopback,
	createScratch,
	isRunning,
	readErrorCode,
	supportsMode,
} from '@orkestrel/test/server'
import {
	createRecorder,
	createTeardown,
	requireValue,
	retryUntil,
	waitForCondition,
	waitForEvent,
} from '@orkestrel/test'
import { Emitter } from '@orkestrel/emitter'
import {
	BrowserContext,
	BrowserError,
	createBrowserToolset,
	parseBrowserTool,
	parseBrowserRemoval,
	parseBrowserInvocation,
	parseBrowserInvocationResult,
} from '@src/core'
import { isDeepStrictEqual } from 'node:util'
import { ModelContextRegistry } from './setup.js'
import {
	BROWSER_RUN_FIXTURE,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
} from './setup.js'
import { BrowserFixtureValue, createBrowserElementFixture, replyOk } from './setup.js'
import { FileBrowserStore } from '../src/server/stores/FileBrowserStore.js'

/** Refuses a missing or stale built browser entry before a proof starts its processes. */
export function requireBrowserBuild(root: string, entry: string): void {
	const newest = readdirSync(resolvePath(root, 'src'), { recursive: true, withFileTypes: true })
		.filter((file) => file.isFile())
		.map((file) => statSync(resolvePath(file.parentPath, file.name)).mtimeMs)
		.reduce<number | undefined>(
			(previous, modified) => (previous === undefined ? modified : Math.max(previous, modified)),
			undefined,
		)
	const built = attempt(() => statSync(entry))
	if (
		!built.success ||
		!built.value.isFile() ||
		(newest !== undefined && built.value.mtimeMs < newest)
	) {
		throw new Error(
			`The built entry ${entry} is missing or older than src/. Run npm run build before this proof.`,
		)
	}
}

/**
 * Holds a real file-lock entry outside the store's process-local queue.
 * @param path - Lock directory under the test's scratch root
 * @param action - Work that encounters the live holder
 * @returns Completion after releasing the entry
 */
export async function holdBrowserStoreLock(
	path: string,
	action: () => Promise<void>,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await mkdir(path)
	const entry = join(path, formatBrowserLockEntry(process.pid, randomUUID()))
	await writeFile(entry, '')
	try {
		await action()
	} finally {
		await unlink(entry)
		await rmdir(path)
	}
}

/**
 * Reports whether this platform delivers `SIGTERM` as a catchable signal a
 * process can trap and outlive.
 *
 * @remarks
 * Windows has no such signal: Node maps `SIGTERM` there onto an unconditional
 * terminate, so a `SIGTERM` handler never runs and no process survives the
 * signal. Gate any case asserting cooperative `SIGTERM` delivery on this
 * reading rather than repeating the platform test.
 */
export const COOPERATIVE_SIGTERM = process.platform !== 'win32'

/**
 * Reserves a free localhost port by binding an ephemeral server to port 0 and
 * immediately closing it — avoids hardcoded test ports colliding across
 * parallel/aborted runs.
 *
 * @returns A free TCP port number
 */
export async function reservePort(): Promise<number> {
	const probe = createNetServer()
	const port = await new Promise<number>((resolve, reject) => {
		probe.on('error', reject)
		probe.listen(0, '127.0.0.1', () => resolve(readServerPort(probe)))
	})
	await new Promise<void>((resolve) => probe.close(() => resolve()))
	return port
}

/** Reads the bound TCP port, or throws when the server has no address. */
export function readServerPort(server: NetServer): number {
	const address: AddressInfo | string | null = server.address()
	if (!isObject(address)) {
		throw new Error('Test server did not bind a TCP port')
	}
	return address.port
}

// === Server-only test helpers (AGENTS §16.1 — node:* allowed here)

/**
 * Waits until a process exits.
 *
 * @param pid - Process identifier to observe
 * @param timeout - Maximum wait in milliseconds
 * @returns A promise resolving after the process exits
 */
export function waitForProcessExit(pid: number, timeout = 5000): Promise<void> {
	return waitForCondition(`process ${pid} has exited`, () => !isRunning(pid), {
		budget: timeout,
		interval: 50,
	})
}

const tempDirectoryTeardown = createTeardown()

/** Allocates and registers a temporary scratch directory for deterministic test teardown. */
export function createTempDirectory(prefix = 'orkestrel-browser-test-'): ScratchInterface {
	const scratch = createScratch({ prefix })
	tempDirectoryTeardown.add(() => scratch.destroy())
	return scratch
}

/** Removes every registered test directory. */
export function destroyTempDirectories(): Promise<void> {
	return tempDirectoryTeardown.destroy()
}

/** Accepts raw TCP connections without completing a handshake. */
export interface StallServerInterface {
	readonly endpoint: string
	readonly connections: number
	close(): Promise<void>
}

/** Starts a raw TCP server that leaves every accepted connection open. */
export async function createStallServer(): Promise<StallServerInterface> {
	const server = new StallServer()
	await server.start()
	return server
}

/** Implements the stalling TCP fixture and holds its socket state. */
export class StallServer implements StallServerInterface {
	readonly #server: NetServer
	readonly #sockets = new Set<Socket>()
	#port: number | undefined
	#closed = false

	constructor() {
		this.#server = createNetServer((socket) => {
			this.#sockets.add(socket)
			socket.resume()
			socket.on('error', () => undefined)
			socket.on('close', () => this.#sockets.delete(socket))
		})
	}

	get endpoint(): string {
		if (this.#port === undefined) throw new Error('Stall server has not started')
		return `ws://127.0.0.1:${this.#port}/cdp`
	}

	get connections(): number {
		return this.#sockets.size
	}

	async start(): Promise<void> {
		if (this.#port !== undefined) return
		await new Promise<void>((resolve, reject) => {
			this.#server.once('error', reject)
			this.#server.listen(0, '127.0.0.1', resolve)
		})
		this.#server.removeAllListeners('error')
		this.#port = readServerPort(this.#server)
	}

	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true
		for (const socket of this.#sockets) socket.destroy()
		this.#sockets.clear()
		await new Promise<void>((resolve, reject) => {
			this.#server.close((error) => (error === undefined ? resolve() : reject(error)))
		})
	}
}

/** Severs and restores a connection through a restartable raw TCP proxy. */
export interface TCPProxyInterface {
	start(host: string, port: number): Promise<void>
	stop(): Promise<void>
}

/** Creates a restartable TCP proxy bound to a fixed local port. */
export function createTCPProxy(port: number): TCPProxyInterface {
	return new TCPProxy(port)
}

/** Implements the restartable TCP proxy fixture and holds its socket state. */
export class TCPProxy implements TCPProxyInterface {
	readonly #port: number
	readonly #sockets = new Set<Socket>()
	#server: NetServer | undefined

	constructor(port: number) {
		this.#port = port
	}

	async start(host: string, port: number): Promise<void> {
		if (this.#server !== undefined) throw new Error('TCP proxy is already started')

		const server = createNetServer((client) => {
			this.#sockets.add(client)
			const upstream = createConnection({ host, port })
			this.#sockets.add(upstream)
			client.pipe(upstream)
			upstream.pipe(client)
			client.on('error', () => undefined)
			upstream.on('error', () => undefined)
			client.on('close', () => this.#sockets.delete(client))
			upstream.on('close', () => this.#sockets.delete(upstream))
		})
		this.#server = server

		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject)
				server.listen(this.#port, '127.0.0.1', resolve)
			})
			server.removeAllListeners('error')
		} catch (error) {
			this.#server = undefined
			throw error
		}
	}

	async stop(): Promise<void> {
		for (const socket of this.#sockets) socket.destroy()
		this.#sockets.clear()

		const server = this.#server
		this.#server = undefined
		if (server === undefined) return
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error === undefined ? resolve() : reject(error)))
		})
	}
}

// === In-process CDP test server (HTTP discovery endpoints + WS CDP transport)

/** Describes one CDP JSON-RPC request frame the test server received. */
export interface CDPServerReceived {
	readonly id: number
	readonly method: string
	readonly params: Readonly<Record<string, unknown>> | undefined
}

/** Computes an auto-reply result for a scripted CDP method. */
export type CDPServerReplyHandler = (params: Readonly<Record<string, unknown>>) => unknown

/** Describes a WebMCP fixture's registrations and terminal invocation event. */
export interface CDPRegistryScript {
	readonly tools: readonly unknown[]
	readonly result: Readonly<Record<string, unknown>>
}

/**
 * Serves enough raw CDP over HTTP and WebSocket to drive
 * `Browser`/`WebSocketCDPTransport` end-to-end in tests — real sockets, no
 * mocks. Exposes `/json/version` and `/json/list` (scriptable) plus a `/cdp`
 * WebSocket endpoint that records every request and lets tests script
 * replies and push events.
 */
export interface CDPTestServerInterface {
	readonly port: number
	readonly url: string
	readonly endpoint: string
	readonly received: readonly CDPServerReceived[]
	/** Count of open WebSocket sockets (for close-propagation assertions). */
	readonly sockets: number
	/**
	 * Every CDP application-message write the server performed on an open WebSocket, one entry per
	 * socket write, in write order: each reply, failure, and event, and each WebMCP burst.
	 *
	 * @remarks
	 * The upgrade response, pongs, and close and other control frames go through
	 * `@orkestrel/websocket`'s own socket writer and are not recorded.
	 */
	readonly writes: readonly Buffer[]
	/** Set the targets returned by `/json/list` (drives `fetchCDPTargets`/`syncContexts`). */
	list(targets: readonly unknown[]): void
	/** Script an automatic reply for every request matching `method`. */
	script(method: string, result: unknown | CDPServerReplyHandler): void
	/** Scripts WebMCP with a command response and terminal event in one socket write. */
	advertise(tools: readonly unknown[], result: Readonly<Record<string, unknown>>): void
	/** Send a success reply for a specific request id over the active WebSocket. */
	reply(id: number, result: unknown): void
	/** Send an error reply for a specific request id over the active WebSocket. */
	fail(id: number, message: string): void
	/** Push a CDP event frame over the active WebSocket. */
	event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void
	/** When enabled, `/json/version` accepts the request and never responds (simulates a hung endpoint). */
	hang(enabled: boolean): void
	/** Close the HTTP server and any open sockets. */
	close(): Promise<void>
}

/**
 * Starts an in-process CDP test server on a free localhost port.
 *
 * @returns A {@link CDPTestServerInterface}
 */
export async function createCDPTestServer(): Promise<CDPTestServerInterface> {
	const server = new CDPTestServer()
	await server.start()
	return server
}

/** Implements the test CDP surface over a real HTTP and WebSocket server. */
export class CDPTestServer implements CDPTestServerInterface {
	readonly #server: HTTPServer
	readonly #received: CDPServerReceived[] = []
	readonly #scripts = new Map<string, unknown | CDPServerReplyHandler>()
	readonly #sockets = new Set<NodeWebSocketInterface>()
	readonly #writes: Buffer[] = []
	#targets: readonly unknown[] = []
	#active: NodeWebSocketInterface | undefined
	#socket: Duplex | undefined
	#registry: CDPRegistryScript | undefined
	#port: number | undefined
	#hanging = false
	#closed = false

	constructor() {
		this.#server = createServer((request, response) => this.#handle(request, response))
		this.#server.on('upgrade', (request, socket, head) => {
			this.#upgrade(request, socket, head)
		})
	}

	get port(): number {
		if (this.#port === undefined) throw new Error('CDP test server has not started')
		return this.#port
	}

	get url(): string {
		return `http://127.0.0.1:${this.port}`
	}

	get endpoint(): string {
		return `ws://127.0.0.1:${this.port}/cdp`
	}

	get received(): readonly CDPServerReceived[] {
		return this.#received
	}

	get sockets(): number {
		return this.#sockets.size
	}

	get writes(): readonly Buffer[] {
		return this.#writes
	}

	async start(): Promise<void> {
		if (this.#port !== undefined) return
		await new Promise<void>((resolve, reject) => {
			this.#server.once('error', reject)
			this.#server.listen(0, '127.0.0.1', resolve)
		})
		this.#server.removeAllListeners('error')

		this.#port = readServerPort(this.#server)
	}

	list(targets: readonly unknown[]): void {
		this.#targets = targets
	}

	script(method: string, result: unknown | CDPServerReplyHandler): void {
		this.#scripts.set(method, result)
	}

	advertise(tools: readonly unknown[], result: Readonly<Record<string, unknown>>): void {
		this.#registry = { tools, result }
	}

	reply(id: number, result: unknown): void {
		this.#send({ id, result })
	}

	fail(id: number, message: string): void {
		this.#send({ id, error: { message } })
	}

	event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void {
		const frame: Record<string, unknown> = { method, params: params ?? {} }
		if (sessionId !== undefined) frame['sessionId'] = sessionId
		this.#send(frame)
	}

	hang(enabled: boolean): void {
		this.#hanging = enabled
	}

	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true
		for (const socket of this.#sockets) socket.destroy()
		this.#sockets.clear()

		const closed = new Promise<void>((resolve, reject) => {
			this.#server.close((error) => (error === undefined ? resolve() : reject(error)))
		})
		this.#server.closeAllConnections()
		await closed
	}

	// === Private helpers

	#handle(request: IncomingMessage, response: ServerResponse): void {
		const url = request.url
		if (url?.startsWith('/json/version') === true) {
			if (this.#hanging) return
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ webSocketDebuggerUrl: this.endpoint, Browser: 'Test/1.0' }))
			return
		}
		if (url?.startsWith('/json/list') === true) {
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(this.#targets))
			return
		}
		response.writeHead(404)
		response.end()
	}

	#upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const key = request.headers['sec-websocket-key']
		if (!isString(key)) {
			socket.destroy()
			return
		}

		const webSocket = createNodeWebSocket({ socket, key, head })
		this.#active = webSocket
		this.#socket = socket
		this.#sockets.add(webSocket)
		webSocket.emitter.on('message', (text) => this.#message(text))
		webSocket.emitter.on('close', () => {
			this.#sockets.delete(webSocket)
			if (this.#active === webSocket) {
				this.#active = undefined
				this.#socket = undefined
			}
		})
	}

	#message(text: string): void {
		const parsed = parseJSON(text)
		if (!isRecord(parsed) || !isNumber(parsed['id']) || !isString(parsed['method'])) {
			return
		}

		const id = parsed['id']
		const method = parsed['method']
		const params = isRecord(parsed['params']) ? parsed['params'] : undefined
		this.#received.push({ id, method, params })

		if (this.#registry !== undefined && method.startsWith('WebMCP.')) {
			const sessionId = parsed['sessionId']
			if (method === 'WebMCP.enable') {
				this.#send({ id, result: {} })
				this.#send({
					method: 'WebMCP.toolsAdded',
					params: { tools: this.#registry.tools },
					sessionId,
				})
			} else if (method === 'WebMCP.invokeTool') {
				const invocationId = `invocation-${id}`
				this.#write(
					Buffer.concat([
						encodeWebSocketFrame(
							WEBSOCKET_OPCODE_TEXT,
							JSON.stringify({ id, result: { invocationId } }),
						),
						encodeWebSocketFrame(
							WEBSOCKET_OPCODE_TEXT,
							JSON.stringify({
								method: 'WebMCP.toolResponded',
								params: { ...this.#registry.result, invocationId },
								sessionId,
							}),
						),
					]),
				)
			} else if (method === 'WebMCP.disable' || method === 'WebMCP.cancelInvocation') {
				this.#send({ id, result: {} })
			}
			return
		}

		if (method === 'Target.getTargets' && !this.#scripts.has(method)) {
			const targetInfos = this.#targets.filter(isRecord).map((target) => ({
				targetId: target['id'],
				type: target['type'],
				title: target['title'],
				url: target['url'],
			}))
			this.#send({ id, result: { targetInfos } })
			return
		}
		if (method === 'Page.getFrameTree' && !this.#scripts.has(method)) {
			this.#send({
				id,
				result: {
					frameTree: { frame: { id: 'frame-main', url: 'about:blank' } },
				},
			})
			return
		}
		if (method === 'Target.setAutoAttach' && !this.#scripts.has(method)) {
			this.#send({ id, result: {} })
			return
		}
		if (
			(method === 'Network.enable' ||
				method === 'Network.disable' ||
				method === 'Emulation.setTouchEmulationEnabled' ||
				method === 'Page.setInterceptFileChooserDialog' ||
				method === 'Page.setLifecycleEventsEnabled' ||
				method === 'Browser.setDownloadBehavior') &&
			!this.#scripts.has(method)
		) {
			this.#send({ id, result: {} })
			return
		}

		if (!this.#scripts.has(method)) return
		const scripted = this.#scripts.get(method)
		const result = isFunction(scripted) ? scripted(params ?? {}) : scripted
		this.#send({ id, result })
	}

	#send(data: Record<string, unknown>): void {
		this.#write(encodeWebSocketFrame(WEBSOCKET_OPCODE_TEXT, JSON.stringify(data)))
	}

	// The one point every server frame leaves through, so `writes` records each socket write.
	#write(chunk: Buffer): void {
		const socket = this.#socket
		if (socket === undefined || this.#active?.readyState !== WEBSOCKET_READY_OPEN) return
		this.#writes.push(chunk)
		socket.write(chunk)
	}
}

/**
 * Reads the payloads of the WebSocket frames one socket write carries, in write order.
 *
 * @param chunk - One entry of `CDPTestServerInterface.writes`
 * @returns Each frame's payload decoded as UTF-8; empty for an empty chunk
 * @throws Thrown when the chunk ends inside a frame, naming the offset of that frame.
 */
export function readWebSocketFrames(chunk: Buffer): readonly string[] {
	const frames: Array<{ readonly end: number; readonly text: string }> = []
	while (true) {
		const offset = frames.at(-1)?.end ?? 0
		if (offset >= chunk.length) break
		const frame = parseWebSocketFrame(chunk.subarray(offset))
		if (frame === undefined)
			throw new Error(`The write ends inside the frame at byte ${offset} of ${chunk.length}`)
		frames.push({ text: frame.payload.toString('utf8'), end: offset + frame.consumed })
	}
	return frames.map((frame) => frame.text)
}

// === Fake browser process (real spawned executable, no mocks)

/** Tracks one registered fake-browser fixture for teardown. */
export interface RegisteredFakeBrowser {
	readonly scratch: ScratchInterface
	readonly pidNames: readonly string[]
}

const registeredFakeBrowsers: RegisteredFakeBrowser[] = []

/**
 * Clears the fake-browser registry, sending `SIGKILL` to every still-alive
 * registered pid — the teardown safety net for every process created through
 * `createFakeBrowserProcess`, tolerating a not-yet-written pid file or an
 * already-dead process. Wire into a top-level `afterEach` alongside each
 * test's own explicit kills.
 */
export async function destroyFakeBrowsers(): Promise<void> {
	for (const fixture of registeredFakeBrowsers.splice(0)) {
		for (const pidName of fixture.pidNames) {
			const pid = readOptionalBrowserPid(fixture.scratch, pidName)
			if (pid === undefined) continue
			try {
				process.kill(pid, 'SIGKILL')
			} catch {
				// already dead (ESRCH) — nothing to do
			}
			await waitForProcessExit(pid).catch(() => undefined)
		}
		fixture.scratch.destroy()
	}
}

/** Reads a fixture process identifier, returning absence when its file is unreadable or empty. */
export function readOptionalBrowserPid(
	scratch: ScratchInterface,
	name: string,
): number | undefined {
	try {
		const contents = scratch.read(name)?.trim()
		return contents === undefined || contents.length === 0 ? undefined : Number(contents)
	} catch {
		return undefined
	}
}

/**
 * Reads a fixture process identifier after its spawned script has published it.
 *
 * @param scratch - The fixture's owned scratch directory
 * @param name - Root-relative pid file name written by the fixture process
 * @returns The published process identifier
 * @remarks The predicate rejects a torn write as well as a missing file, so a partially flushed
 * pid is retried rather than returned as `NaN`.
 */
export function readFixtureProcessId(scratch: ScratchInterface, name: string): Promise<number> {
	return retryUntil(
		`the fake browser pid at ${join(scratch.path, name)}`,
		() => Number(scratch.read(name)?.trim()),
		(pid) => isInteger(pid) && pid > 0,
		{ attempts: 50, interval: 20, budget: 1000 },
	)
}

/** Describes a real, spawned stand-in "browser" process for exercising Browser's launch path. */
export interface FakeBrowserProcessInterface {
	/** The Node executable path (used as `BrowserOptions.executable`) — spawnable identically on every platform. */
	readonly executable: string
	/** Launch args (used as `BrowserOptions.args`) — must precede any CDP flags `launchBrowserProcess` appends. */
	readonly args: readonly string[]
	/** Reads the PID the process wrote at startup (polls briefly if not yet written). */
	pid(): Promise<number>
	/** Reads the PID of the process-tree fixture requested through `descendant`. */
	descendant(): Promise<number>
	/** Reads the PID of the re-executed process serving CDP, requested through `launcher`. */
	browser(): Promise<number>
	/** Reads the WebSocket endpoint the serving fake announced on standard error, from the port it bound. */
	endpoint(): Promise<string>
	/** Reads the request paths the fake's HTTP server has served, in arrival order. */
	requests(): Promise<readonly string[]>
	/** Reads the complete process argument vector recorded at startup. */
	arguments(): Promise<readonly string[]>
	/**
	 * Sever the active CDP WebSocket socket (through an HTTP control request to the
	 * fake's own server) while leaving the process itself alive — simulates a
	 * transport-loss without a process exit. Only meaningful when constructed
	 * with `serveCDP: true`.
	 */
	dropSocket(): Promise<void>
}

/**
 * Writes a small, real Node script that stands in for a browser executable in
 * `Browser`'s launch path — no mocking of `child_process`. The script is
 * spawned as `node <script> <cdp-flags...>` (through `executable`/`args`) rather
 * than executed directly, so it is spawnable identically on Windows/macOS/Linux
 * (a directly-spawned shebang script is not portable to Windows).
 *
 * @param options - `serveCDP` runs a minimal real HTTP+WebSocket CDP endpoint
 * (parses `--remote-debugging-port=` from its own argv); `ignoreSIGTERM`
 * traps SIGTERM in the parent and requested descendant so only SIGKILL can
 * terminate them; `descendant` spawns that process-tree fixture; `launcher`
 * reproduces a Windows launcher (Microsoft Edge) by re-executing the script as
 * a descendant carrying the same argv and exiting 0 straight away, so the
 * spawned process is never the one that serves CDP; `unnamed` leaves
 * `SystemInfo.getProcessInfo` unanswered so the endpoint never names the
 * process serving it; `split` prints the endpoint line in two chunks; `crlf` ends
 * it `\r\n`; `flood` writes 1 MB to stderr after readiness; `mute` exits without
 * announcing readiness. With none of these options the process idles (never
 * serves CDP) — useful for launch-failure/abort scenarios.
 * `retainStderr` starts a detached descendant that inherits stderr, keeping the parent's
 * pipe open after its exit; fixture teardown owns and terminates that descendant separately.
 * @returns A {@link FakeBrowserProcessInterface}
 */
export function createFakeBrowserProcess(
	options: {
		readonly serveCDP?: boolean
		readonly ignoreSIGTERM?: boolean
		readonly descendant?: boolean
		readonly retainStderr?: boolean
		readonly launcher?: boolean
		readonly unnamed?: boolean
		readonly split?: boolean
		readonly crlf?: boolean
		readonly flood?: boolean
		readonly mute?: boolean
	} = {},
): FakeBrowserProcessInterface {
	const scratch = createScratch({ prefix: 'orkestrel-browser-fake-' })
	const scriptPath = join(scratch.path, 'fake-browser.js')
	const pidFile = join(scratch.path, 'pid.txt')
	const descendantFile = join(scratch.path, 'descendant.txt')
	const browserFile = join(scratch.path, 'browser.txt')
	const argumentsFile = join(scratch.path, 'arguments.json')
	const portFile = join(scratch.path, 'port.txt')
	const requestsFile = join(scratch.path, 'requests.txt')

	// No shebang: the script is spawned through `node <script>`, never executed
	// directly, so it needs no execute bit and no shebang line.
	const crashLogPath = join(scratch.path, 'crash.log')
	const lines: string[] = [
		`process.on('uncaughtException', (e) => { try { require('fs').appendFileSync(${JSON.stringify(crashLogPath)}, String(e && e.stack)) } catch {} ; process.exit(1) })`,
	]

	// A published pid lets the test signal this process immediately.
	if (options.ignoreSIGTERM === true) {
		lines.push("process.on('SIGTERM', () => {})")
	}

	if (options.launcher === true) {
		// The launcher records itself, re-executes this same script with the
		// same CDP flags plus a marker, and exits 0 before the endpoint is up —
		// the shape Microsoft Edge takes on Windows. The re-executed process
		// records itself separately and goes on to serve CDP.
		lines.push(
			[
				"if (process.argv.includes('--orkestrel-relaunched')) {",
				`\trequire('fs').writeFileSync(${JSON.stringify(browserFile)}, String(process.pid))`,
				'} else {',
				`\trequire('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
				`\trequire('fs').writeFileSync(${JSON.stringify(argumentsFile)}, JSON.stringify(process.argv))`,
				// Windows destroys a non-detached child when its parent exits this
				// abruptly, so the re-executed process is detached there. POSIX
				// keeps it undetached, which leaves it in the launcher's process
				// group exactly as a real Chromium subprocess would be.
				"\tconst __child = require('child_process').spawn(process.execPath, [__filename, '--orkestrel-relaunched', ...process.argv.slice(2)], { stdio: ['ignore', 'ignore', 'inherit'], detached: process.platform === 'win32' })",
				'\t__child.unref()',
				'\tprocess.exit(0)',
				'}',
			].join('\n'),
		)
	} else {
		lines.push(
			`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
			`require('fs').writeFileSync(${JSON.stringify(argumentsFile)}, JSON.stringify(process.argv))`,
		)
	}

	if (options.descendant === true || options.retainStderr === true) {
		const descendantSource = [
			...(options.ignoreSIGTERM === true ? ["process.on('SIGTERM', () => {})"] : []),
			`require('fs').writeFileSync(${JSON.stringify(descendantFile)}, String(process.pid))`,
			`const __runnerPid = ${process.pid}`,
			'setInterval(() => {',
			'\ttry { process.kill(__runnerPid, 0) } catch { process.exit(0) }',
			'}, 500)',
		].join('\n')
		lines.push(
			`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: ${options.retainStderr === true ? "['ignore', 'ignore', 'inherit']" : "'ignore'"}, detached: ${options.retainStderr === true} }).unref()`,
		)
	}

	// Orphan watchdog: if the parent (test runner) is hard-aborted, this
	// process is reparented to init (ppid 1 on POSIX) — self-exit instead of
	// leaking across subsequent test runs. `process.kill(ppid, 0)` is a
	// cross-platform (including Windows) liveness probe: it throws when the
	// parent is gone even where reparenting never yields ppid 1. A `launcher`
	// fixture orphans its re-executed process by design, so that process
	// watches the test runner rather than its own immediate parent.
	lines.push(
		options.launcher === true
			? [
					`const __runner = ${process.pid}`,
					'setInterval(() => {',
					'\ttry { process.kill(__runner, 0) } catch { process.exit(0) }',
					'}, 500)',
				].join('\n')
			: [
					'const __ppid = process.ppid',
					'setInterval(() => {',
					'\tif (process.ppid === 1) { process.exit(0); return }',
					'\ttry { process.kill(__ppid, 0) } catch { process.exit(0) }',
					'}, 500)',
				].join('\n'),
	)

	if (options.mute === true) {
		lines.push('process.exit(0)')
	}

	if (options.serveCDP === true) {
		// The @orkestrel/websocket package is required by its real installed
		// .cjs entry point (resolved by using `createRequire` at script-GENERATION
		// time in this process, then embedded as a JSON-escaped string literal
		// so it is valid on every platform including Windows backslash paths):
		// this script runs from a temp dir with no node_modules of its own, and
		// it is spawned as plain CJS (matching the rest of this emitted
		// script), so an ESM `import` cannot be used here.
		const websocketEntry = createRequire(import.meta.url).resolve('@orkestrel/websocket')
		lines.push(
			[
				"const http = require('http')",
				`const { createNodeWebSocket } = require(${JSON.stringify(websocketEntry)})`,
				"const portArg = process.argv.find((a) => a.startsWith('--remote-debugging-port='))",
				"const port = Number(portArg.split('=')[1])",
				'const connection = new (class { value })()',
				'const server = http.createServer((req, res) => {',
				`\trequire('fs').appendFileSync(${JSON.stringify(requestsFile)}, req.url + '\\n')`,
				"\tif (req.url.startsWith('/json/version')) {",
				"\t\tres.writeHead(200, { 'content-type': 'application/json' })",
				"\t\tres.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/cdp', Browser: 'Fake/1.0' }))",
				'\t\treturn',
				'\t}',
				"\tif (req.url.startsWith('/json/list')) {",
				"\t\tres.writeHead(200, { 'content-type': 'application/json' })",
				"\t\tres.end('[]')",
				'\t\treturn',
				'\t}',
				"\tif (req.url.startsWith('/__drop')) {",
				'\t\tif (connection.value) connection.value.destroy()',
				'\t\tres.writeHead(204)',
				'\t\tres.end()',
				'\t\treturn',
				'\t}',
				'\tres.writeHead(404)',
				'\tres.end()',
				'})',
				"server.on('upgrade', (req, socket, head) => {",
				"\tconst key = req.headers['sec-websocket-key']",
				'\tconst ws = createNodeWebSocket({ socket, key, head })',
				'\tconnection.value = ws',
				"\tws.emitter.on('message', (text) => {",
				'\t\ttry {',
				'\t\t\tconst msg = JSON.parse(text)',
				"\t\t\tif (msg.method === 'Browser.close') {",
				'\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: {} }))',
				'\t\t\t\tsetImmediate(() => process.exit(0))',
				"\t\t\t} else if (msg.method === 'Browser.getVersion') {",
				"\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: { product: 'Fake/1.0' } }))",
				"\t\t\t} else if (msg.method === 'Target.getTargets') {",
				'\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: { targetInfos: [] } }))',
				`\t\t\t} else if (msg.method === 'SystemInfo.getProcessInfo' && ${String(options.unnamed !== true)}) {`,
				"\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: { processInfo: [{ type: 'browser', id: process.pid, cpuTime: 0 }] } }))",
				'\t\t\t}',
				'\t\t} catch {}',
				'\t})',
				"\tws.emitter.on('close', () => {",
				'\t\tif (connection.value === ws) connection.value = undefined',
				'\t})',
				'})',
				"server.on('error', (e) => { console.error('fake-browser listen error: ' + e.message); process.exit(12) })",
				"server.listen(port, '127.0.0.1', () => {",
				'\tconst bound = server.address().port',
				`\trequire('fs').writeFileSync(${JSON.stringify(portFile)}, String(bound))`,
				"\tconst line = 'DevTools listening on ws://127.0.0.1:' + bound + '/devtools/browser/FAKE'",
				`\tconst end = ${options.crlf === true ? "'\\r\\n'" : "'\\n'"}`,
				...(options.split === true
					? [
							'\tprocess.stderr.write(line.slice(0, 20))',
							'\tsetTimeout(() => process.stderr.write(line.slice(20) + end), 50)',
						]
					: ['\tprocess.stderr.write(line + end)']),
				...(options.flood === true
					? ["\tsetTimeout(() => process.stderr.write('x'.repeat(1024 * 1024) + '\\n'), 100)"]
					: []),
				'})',
			].join('\n'),
		)
	}

	scratch.write('fake-browser.js', `${lines.join('\n')}\n`)

	registeredFakeBrowsers.push({ scratch, pidNames: ['pid.txt', 'descendant.txt', 'browser.txt'] })

	return {
		executable: process.execPath,
		args: [scriptPath],
		async pid(): Promise<number> {
			return readFixtureProcessId(scratch, 'pid.txt')
		},
		async descendant(): Promise<number> {
			return readFixtureProcessId(scratch, 'descendant.txt')
		},
		async browser(): Promise<number> {
			return readFixtureProcessId(scratch, 'browser.txt')
		},
		async arguments(): Promise<readonly string[]> {
			const argv = await retryUntil(
				`the fake browser argument vector at ${argumentsFile}`,
				() => {
					const text = scratch.read('arguments.json')
					const parsed = text === undefined ? undefined : parseJSON(text)
					return parsed === undefined ? undefined : parseArray(parsed, isString)
				},
				(value) => value !== undefined,
				{ attempts: 50, interval: 20, budget: 1000 },
			)
			return requireValue(
				argv,
				`Fake browser process never wrote its arguments to ${argumentsFile}`,
			)
		},
		async endpoint(): Promise<string> {
			const port = await retryUntil(
				`the fake browser listening port at ${portFile}`,
				() => Number(scratch.read('port.txt')?.trim()),
				(value) => isInteger(value) && value > 0,
				{ attempts: 50, interval: 20, budget: 1000 },
			)
			return `ws://127.0.0.1:${port}/devtools/browser/FAKE`
		},
		async requests(): Promise<readonly string[]> {
			return (scratch.read('requests.txt') ?? '').split('\n').filter((line) => line.length > 0)
		},
		async dropSocket(): Promise<void> {
			const dropPort = await retryUntil(
				`the fake browser listening port at ${portFile}`,
				() => Number(scratch.read('port.txt')?.trim()),
				(port) => isInteger(port) && port > 0,
				{ attempts: 50, interval: 20, budget: 1000 },
			)
			await fetch(`http://127.0.0.1:${dropPort}/__drop`)
		},
	}
}

// === Fixture pages for the live-browser proofs

/**
 * Observes native pipes acquired after installation, removing each id when its handle closes.
 * @param pipes - The active ids the caller inspects
 * @returns The enabled hook; disable it after releasing the observed resources
 */
export function observeBrowserPipes(pipes: Set<number>): AsyncHook {
	return createHook({
		init(id, type) {
			if (type === 'PIPEWRAP') pipes.add(id)
		},
		destroy(id) {
			pipes.delete(id)
		},
	}).enable()
}

/**
 * Names a loopback host the fixture server answers on.
 *
 * @remarks
 * `127.0.0.1` and `localhost` are distinct sites to Chromium, so a `localhost` document framed
 * by a `127.0.0.1` document renders in its own process as an out-of-process frame.
 */
export type FixtureHost = '127.0.0.1' | 'localhost'

/** Names the text the late-text page inserts after its `Reveal` button is clicked. */
export const FIXTURE_LATE_TEXT = 'Confirmation code 4417'

/** Holds the delay in milliseconds between the `Reveal` click and the late text's insertion. */
export const FIXTURE_LATE_DELAY = 200

/** Names the order code a `POST` to `/checkout/order` answers with. */
export const FIXTURE_CHECKOUT_CODE = 'A1042'

/**
 * Holds the delay in milliseconds between the checkout page's receipt of the order code and the
 * confirmation line's insertion.
 */
export const FIXTURE_CHECKOUT_DELAY = 200

/**
 * Maps each bare specifier the served document page imports to the path the fixture server
 * answers it on.
 *
 * @remarks
 * The page's import map carries this table. Each path mirrors the package's installed ES module
 * entry under the workspace, so a relative import inside an entry resolves to a path
 * {@link loadFixtureModule} also answers.
 */
export const FIXTURE_DOCUMENT_IMPORTS: Readonly<Record<string, string>> = Object.freeze({
	'@orkestrel/codec': '/node_modules/@orkestrel/codec/dist/src/core/index.js',
	'@orkestrel/contract': '/node_modules/@orkestrel/contract/dist/src/core/index.js',
	'@orkestrel/emitter': '/node_modules/@orkestrel/emitter/dist/src/core/index.js',
	'@orkestrel/html': '/node_modules/@orkestrel/html/dist/src/core/index.js',
	'@orkestrel/markdown': '/node_modules/@orkestrel/markdown/dist/src/core/index.js',
	'@orkestrel/mcp/browser': '/node_modules/@orkestrel/mcp/dist/src/browser/index.js',
	'@orkestrel/sse': '/node_modules/@orkestrel/sse/dist/src/core/index.js',
	'@orkestrel/tool': '/node_modules/@orkestrel/tool/dist/src/core/index.js',
})

/** Lists the built bundle files the served document page imports, relative to the workspace. */
export const FIXTURE_DOCUMENT_BUNDLE: readonly string[] = Object.freeze([
	'dist/src/browser/index.js',
	'dist/src/core/index.js',
])

/** Names the served path of the WebMCP registry double the document page installs. */
export const FIXTURE_REGISTRY_MODULE = '/tests/fixtures/modelContext.js'

/** Serves the fixture pages the live-browser proofs drive on one loopback port. */
export interface FixtureServerInterface {
	readonly port: number
	/** Returns the absolute URL of a fixture path on the named host. Default host: `127.0.0.1`. */
	url(path: string, host?: FixtureHost): string
	/** Drops every live connection, stops listening, and releases the port. */
	destroy(): Promise<void>
}

const FIXTURE_WORKSPACE = fileURLToPath(new URL('../', import.meta.url))

// The served modules no import map entry names: the bundle files, which the page and the browser
// bundle import by path, and the `@orkestrel/mcp` core entry its browser entry imports relatively.
const FIXTURE_RELATIVE_MODULES: readonly string[] = [
	'/dist/src/browser/index.js',
	'/dist/src/core/index.js',
	'/node_modules/@orkestrel/mcp/dist/src/core/index.js',
]

const FORM_PAGE = `<!doctype html><html><head><title>Delivery form</title><style>body{margin:20px}input,textarea,select{display:block;margin:10px 0;width:200px}</style></head><body>
<main><h1>Delivery form</h1>
<form action="/form/placed" method="get">
<label>Name <input id="name" name="name" type="text" value="Ada"></label>
<label>Notes <textarea id="notes" name="notes">Leave at the door</textarea></label>
<label>Speed <select id="speed" name="speed"><option>Standard</option><option>Express</option></select></label>
<button id="submit" type="button">Submit</button>
<button id="save" type="button" onclick="document.body.dataset.saved = 'yes'">Save draft</button>
<button id="review" type="button" onclick="history.pushState({}, '', '/form/review')">Review</button>
</form>
<section id="pool" aria-label="Pool"></section>
</main>
<script>
document.addEventListener('click', (event) => { document.body.dataset.clicks = [document.body.dataset.clicks, event.target.id + ':' + event.isTrusted].filter(Boolean).join(' ') })
addEventListener('pageshow', (event) => { if (event.persisted) document.body.dataset.restored = 'yes' })
</script>
</body></html>`

const PLACED_PAGE = `<!doctype html><html><head><title>Order placed</title></head><body>
<main><h1>Order placed</h1><p id="summary">Pending</p></main>
<script>
const query = new URLSearchParams(location.search)
document.getElementById('summary').textContent = 'Delivery booked for ' + query.get('name') + ' at ' + query.get('speed') + ' speed.'
</script>
</body></html>`

const SHOP_PAGE = `<!doctype html><html><head><title>Cedar Tea Tray</title></head><body>
<main><h1>Cedar Tea Tray</h1>
<form action="/shop/cart" method="post"><input name="item" type="hidden" value="Cedar Tea Tray"><button id="add">Add to cart</button></form>
<form action="/shop/cart" method="post" onsubmit="event.preventDefault(); document.body.dataset.held = 'yes'"><button id="hold">Save for later</button></form>
</main>
</body></html>`

// The order form's `submit` listener prevents the submission, posts the name, and inserts the
// confirmation line after the order code arrives; the gift form keeps its default action.
const CHECKOUT_PAGE = `<!doctype html><html><head><title>Checkout</title></head><body>
<main><h1>Checkout</h1>
<form id="order" action="/checkout/order" method="post"><label>Name <input id="name" name="name" type="text"></label></form>
<form id="gift" action="/form/placed" method="get"><input name="speed" type="hidden" value="Standard"><label>Gift name <input id="recipient" name="name" type="text"></label></form>
</main>
<script>
document.getElementById('order').addEventListener('submit', (event) => {
	event.preventDefault()
	const name = document.getElementById('name').value
	fetch('/checkout/order', { method: 'POST', body: new URLSearchParams({ name }) }).then((response) => response.text()).then((code) => {
		setTimeout(() => { const line = document.createElement('p'); line.textContent = 'Order ' + code + ' placed for ' + name + '.'; document.querySelector('main').append(line) }, ${FIXTURE_CHECKOUT_DELAY})
	})
})
</script>
</body></html>`

const CART_PAGE = `<!doctype html><html><head><title>Cart</title></head><body>
<main><h1>Cart</h1><p>Your cart holds the Cedar Tea Tray.</p></main>
</body></html>`

// The 16 px button sits at the frame origin, so a point offset by the frame's border box rather
// than its content box lands on the frame's 10 px border in the outer document. The coupon form
// sits below it and submits to the frame's parent.
const INNER_PAGE = `<!doctype html><html><head><title>Payment</title><style>html,body{margin:0}#pay{position:absolute;left:0;top:0;width:16px;height:16px;margin:0;padding:0;border:0}#coupon{position:absolute;left:0;top:60px}</style></head><body>
<button id="pay" onclick="document.body.dataset.received = [document.body.dataset.received, event.target.id + ':' + event.isTrusted].filter(Boolean).join(' ')">Pay</button>
<form id="coupon" action="/frame/done" method="get" target="_parent"><label>Coupon <input id="code" name="code" type="text"></label></form>
</body></html>`

const DONE_PAGE = `<!doctype html><html><head><title>Voucher applied</title></head><body>
<main><h1>Voucher applied</h1><p id="key">Pending</p></main>
<script>
document.getElementById('key').textContent = 'Received key ' + new URLSearchParams(location.search).get('key')
</script>
</body></html>`

// The search form's field repeats the page's query, so its submission changes only the fragment and
// stays within the document.
const SEARCH_PAGE = `<!doctype html><html><head><title>Search</title></head><body>
<main><h1>Search</h1>
<form action="#found" method="get"><input name="q" type="hidden" value="tray"><button id="find">Find</button></form>
</main>
</body></html>`

const OVERLAY_PAGE = `<!doctype html><html><head><title>Overlay</title><style>body{margin:0}#save,#plain{position:absolute;left:20px;width:120px;height:40px}#save{top:20px}#plain{top:200px}#veil{position:absolute;left:0;top:0;width:300px;height:100px;z-index:9;background:rgba(0,0,0,.2)}</style></head><body>
<main><button id="save" onclick="document.body.dataset.saved = 'yes'">Save</button><button id="plain" onclick="document.body.dataset.plain = 'yes'">Plain</button></main>
<div id="veil"></div>
</body></html>`

const LATE_PAGE = `<!doctype html><html><head><title>Late</title></head><body>
<main><h1>Order</h1><button id="reveal" onclick="setTimeout(() => { const line = document.createElement('p'); line.textContent = '${FIXTURE_LATE_TEXT}'; document.querySelector('main').append(line); document.body.dataset.inserted = String(performance.timeOrigin + performance.now()) }, ${FIXTURE_LATE_DELAY})">Reveal</button></main>
</body></html>`

const ARTICLE_PAGE = `<!doctype html><html><head><title>Field notes</title></head><body>
<nav aria-label="Site"><a href="/form">Delivery desk</a><a href="/overlay">Overlay desk</a></nav>
<main><article><h1>Field notes</h1>
${Array.from({ length: 40 }, (_, index) => `<p>Field note ${index + 1} records the river gauge at the north bridge and the soil moisture in the east orchard for the survey log.</p>`).join('\n')}
<button id="subscribe" onclick="this.dataset.clicked = String(Number(this.dataset.clicked ?? '0') + 1)">Subscribe</button>
</article></main>
<footer>Footer chrome nobody reads</footer>
</body></html>`

const REGISTRY_PAGE = `<!doctype html><html><head><title>Registry</title></head><body>
<main><h1>Registry</h1></main>
<script>
const registry = navigator.modelContext ?? document.modelContext
if (registry !== undefined) registry.registerTool({ name: 'fixture_echo', description: 'Echoes the text it receives', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, execute: (input) => String(input.text) })
</script>
</body></html>`

const CONFIRM_PAGE = `<!doctype html><html><head><title>Drafts</title></head><body>
<main><h1>Drafts</h1>
<button id="delete" type="button" onclick="document.body.dataset.answer = String(confirm('Delete the draft?'))">Delete</button>
<button id="keep" type="button" onclick="document.body.dataset.kept = String(Number(document.body.dataset.kept ?? '0') + 1)">Keep</button>
</main>
</body></html>`

const LEAVE_PAGE = `<!doctype html><html><head><title>Unsaved note</title></head><body>
<main><h1>Unsaved note</h1><a href="/beforeunload/next">Next</a></main>
<script>
addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
</script>
</body></html>`

const PLAIN_PAGE = `<!doctype html><html><head><title>Saved note</title></head><body>
<main><h1>Saved note</h1><a href="/beforeunload/next">Next</a></main>
</body></html>`

const NEXT_PAGE = `<!doctype html><html><head><title>Next note</title></head><body>
<main><h1>Next note</h1></main>
</body></html>`

const POPUP_PAGE = `<!doctype html><html><head><title>Catalog</title></head><body>
<main><h1>Catalog</h1>
<button id="open" type="button" onclick="window.open('/popup/child', 'details')">Open details</button>
<button id="stay" type="button" onclick="document.body.dataset.stayed = 'yes'">Stay</button>
</main>
</body></html>`

const CHILD_PAGE = `<!doctype html><html><head><title>Details</title></head><body>
<main><h1>Details</h1>
<button id="like" type="button" onclick="document.body.dataset.liked = 'yes'">Like</button>
</main>
</body></html>`

const DOCUMENT_PAGE = `<!doctype html><html><head><title>Gift options</title>
<script type="importmap">${JSON.stringify({ imports: FIXTURE_DOCUMENT_IMPORTS })}</script>
</head><body>
<main><h1>Gift options</h1>
<a href="/form">Delivery desk</a>
<label><input id="wrap" type="checkbox"> Gift wrap</label>
<label>Message <input id="message" type="text"></label>
<button id="apply" type="button">Apply</button>
</main>
<script>
document.getElementById('wrap').addEventListener('click', (event) => { document.body.dataset.trusted = [document.body.dataset.trusted, String(event.isTrusted)].filter(Boolean).join(' ') })
</script>
<script type="module">
import { createBrowserDOMView } from '/dist/src/browser/index.js'
import { createBrowserToolset } from '/dist/src/core/index.js'
import { createModelContext } from '@orkestrel/mcp/browser'
import { installModelContext } from '${FIXTURE_REGISTRY_MODULE}'
try {
	installModelContext(document)
	const view = createBrowserDOMView({ document, own: true })
	const toolset = createBrowserToolset(view, { source: createModelContext({ document }) })
	await toolset.start()
	window.documentToolset = toolset
	document.body.dataset.ready = 'yes'
} catch (error) {
	document.body.dataset.failed = String(error)
}
</script>
</body></html>`

/**
 * Renders the fixture page a request path names.
 *
 * @param path - The request path, such as `/form` or `/frame/outer`
 * @param port - The fixture server's port, which a page embeds in each URL it names on the other
 * {@link FixtureHost}
 * @returns The page HTML; `undefined` for a path no fixture serves
 * @remarks
 * - `/form` — a form holding a text input, a textarea, a select, and three `type="button"`
 *   buttons, which an Enter in the text input submits to `/form/placed`; `Save draft` sets
 *   `document.body.dataset.saved`, `Review` pushes a same-document route, every click is
 *   recorded on `document.body.dataset.clicks`, a back-forward cache restore sets
 *   `document.body.dataset.restored`, and `section#pool`, outside the form, is an empty container
 * - `/form/placed` — the submission's result, whose summary names the submitted `name` and `speed`
 * - `/shop` — a product page whose `Add to cart` button posts its form to `/shop/cart`, and whose
 *   `Save for later` form's `submit` handler calls `preventDefault()` and sets
 *   `document.body.dataset.held`
 * - `/shop/cart` — the cart a `POST` to `/shop/cart` redirects to with `303`
 * - `/checkout` — an `Order` form holding one `Name` text input, whose `submit` listener calls
 *   `preventDefault()`, posts the name to `/checkout/order`, and inserts the line
 *   `Order CODE placed for NAME.` {@link FIXTURE_CHECKOUT_DELAY} milliseconds after the order code
 *   arrives, and a `Gift` form holding one `Gift name` text input, which an Enter submits to
 *   `/form/placed` with the `Standard` speed
 * - `/frame/outer` — a `127.0.0.1` document framing `/frame/inner` from `localhost` inside a
 *   10 px border at (220, 160), with a 16 px `Decoy` button under the frame-local point of the
 *   framed `Pay` button
 * - `/frame/inner` — the framed document; its `Pay` button appends the receiving node to
 *   `document.body.dataset.received`, as the `Decoy` button appends to
 *   `document.body.dataset.decoy` in the outer document, and its `Coupon` form below the button
 *   submits to `/frame/done` in the frame's parent
 * - `/frame/voucher` — a `127.0.0.1` document framing `/frame/field` from `localhost`
 * - `/frame/field` — a form holding one `Code` text input, which an Enter submits to
 *   `/frame/done` on `127.0.0.1`, so the frame navigates to another site and process; a
 *   `keydown` listener writes an Enter's key into the form's hidden `key` field before the
 *   submission, so the submitted query carries `key=Enter` only when the key-down reached the frame
 * - `/frame/done` — the voucher form's result, whose text reads back the submitted `key`
 * - `/frame/local` — a `127.0.0.1` document framing `/frame/away` from `127.0.0.1`, so the frame
 *   shares the page's process
 * - `/frame/away` — the voucher form of `/frame/field` with its action on `localhost`, so an Enter
 *   navigates the in-process frame to another site and process
 * - `/frame/nested` — a `127.0.0.1` document framing `/frame/middle` from `localhost`
 * - `/frame/middle` — a `localhost` document framing `/frame/inner` from `127.0.0.1`, so the inner
 *   frame renders out of process within an out-of-process frame; the inner page's `Coupon` form
 *   submits to `/frame/done` with the `_parent` target, which navigates this middle frame
 * - `/search` — a `Find` button whose form repeats the page's `q=tray` query and targets the
 *   `#found` fragment, so a submission from `/search?q=tray` stays within the document
 * - `/overlay` — a `Save` button covered by `div#veil` and an uncovered `Plain` button
 * - `/late` — a `Reveal` button that inserts {@link FIXTURE_LATE_TEXT} after
 *   {@link FIXTURE_LATE_DELAY} milliseconds and records the insertion's epoch time in
 *   milliseconds, `performance.timeOrigin + performance.now()`, on
 *   `document.body.dataset.inserted`
 * - `/article` — a long article between navigation and footer chrome, ending in a
 *   `Subscribe` button below the fold
 * - `/registry` — registers the `fixture_echo` tool through the page's WebMCP registry when
 *   the browser exposes one
 * - `/confirm` — a `Delete` button whose click asks `confirm('Delete the draft?')` and records
 *   the answer on `document.body.dataset.answer`, and a `Keep` button that counts its clicks on
 *   `document.body.dataset.kept` with no dialog
 * - `/beforeunload` — a `Next` link to `/beforeunload/next` on a page whose `beforeunload`
 *   handler asks to stay
 * - `/beforeunload/plain` — the same link on a page with no `beforeunload` handler
 * - `/beforeunload/next` — the link's destination
 * - `/popup` — an `Open details` button that opens `/popup/child` in a new tab through
 *   `window.open`, and a `Stay` button that sets `document.body.dataset.stayed` and opens nothing
 * - `/popup/child` — the opened tab; its `Like` button sets `document.body.dataset.liked`
 * - `/document` — imports the built `dist/src/browser` bundle through an import map of
 *   {@link FIXTURE_DOCUMENT_IMPORTS}, installs the registry double {@link FIXTURE_REGISTRY_MODULE}
 *   serves, and publishes `createBrowserToolset(createBrowserDOMView({ document, own: true }), { source })` over its own
 *   document on `window.documentToolset` after `start()`, then sets
 *   `document.body.dataset.ready`, or `document.body.dataset.failed` with the error; a listener
 *   records each `Gift wrap` checkbox click's `isTrusted` on `document.body.dataset.trusted`
 */
export function renderFixturePage(path: string, port: number): string | undefined {
	switch (path) {
		case '/form':
			return FORM_PAGE
		case '/form/placed':
			return PLACED_PAGE
		case '/shop':
			return SHOP_PAGE
		case '/shop/cart':
			return CART_PAGE
		case '/checkout':
			return CHECKOUT_PAGE
		case '/frame/outer':
			return `<!doctype html><html><head><title>Checkout</title><style>html,body{margin:0;height:100%}#decoy{position:absolute;left:0;top:0;width:16px;height:16px;margin:0;padding:0;border:0}iframe{position:absolute;left:220px;top:160px;width:300px;height:200px;border:10px solid gray;padding:0}</style></head><body>
<button id="decoy" onclick="document.body.dataset.decoy = [document.body.dataset.decoy, event.target.id + ':' + event.isTrusted].filter(Boolean).join(' ')">Decoy</button>
<iframe title="Payment" src="http://localhost:${port}/frame/inner"></iframe>
</body></html>`
		case '/frame/inner':
			return INNER_PAGE
		case '/frame/voucher':
			return `<!doctype html><html><head><title>Voucher</title></head><body>
<main><h1>Voucher</h1><iframe title="Voucher form" src="http://localhost:${port}/frame/field"></iframe></main>
</body></html>`
		case '/frame/field':
			return `<!doctype html><html><head><title>Voucher form</title></head><body>
<form action="http://127.0.0.1:${port}/frame/done" method="get"><label>Code <input id="code" name="code" type="text"></label><input id="key" name="key" type="hidden"></form>
<script>
document.getElementById('code').addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('key').value = event.key })
</script>
</body></html>`
		case '/frame/done':
			return DONE_PAGE
		case '/frame/local':
			return `<!doctype html><html><head><title>Local voucher</title></head><body>
<main><h1>Local voucher</h1><iframe title="Voucher form" src="http://127.0.0.1:${port}/frame/away"></iframe></main>
</body></html>`
		case '/frame/away':
			return `<!doctype html><html><head><title>Voucher form</title></head><body>
<form action="http://localhost:${port}/frame/done" method="get"><label>Code <input id="code" name="code" type="text"></label><input id="key" name="key" type="hidden"></form>
<script>
document.getElementById('code').addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('key').value = event.key })
</script>
</body></html>`
		case '/frame/nested':
			return `<!doctype html><html><head><title>Nested</title></head><body>
<main><h1>Nested</h1><iframe title="Middle" src="http://localhost:${port}/frame/middle"></iframe></main>
</body></html>`
		case '/frame/middle':
			return `<!doctype html><html><head><title>Middle</title></head><body>
<main><h1>Middle</h1><iframe title="Payment" src="http://127.0.0.1:${port}/frame/inner"></iframe></main>
</body></html>`
		case '/search':
			return SEARCH_PAGE
		case '/overlay':
			return OVERLAY_PAGE
		case '/late':
			return LATE_PAGE
		case '/article':
			return ARTICLE_PAGE
		case '/registry':
			return REGISTRY_PAGE
		case '/confirm':
			return CONFIRM_PAGE
		case '/beforeunload':
			return LEAVE_PAGE
		case '/beforeunload/plain':
			return PLAIN_PAGE
		case '/beforeunload/next':
			return NEXT_PAGE
		case '/popup':
			return POPUP_PAGE
		case '/popup/child':
			return CHILD_PAGE
		case '/document':
			return DOCUMENT_PAGE
		default:
			return undefined
	}
}

/**
 * Throws naming `npm run build` when a built bundle file the document page imports is absent.
 *
 * @param root - The workspace directory the bundle is built under. Default: this workspace
 * @throws Thrown when a {@link FIXTURE_DOCUMENT_BUNDLE} file is absent under `root`, naming each
 * absent file and `npm run build`.
 */
export function requireDocumentBundle(root: string = FIXTURE_WORKSPACE): void {
	const absent = FIXTURE_DOCUMENT_BUNDLE.filter((path) => !existsSync(join(root, path)))
	if (absent.length > 0)
		throw new Error(
			`Precondition failed: ${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} absent; run npm run build before the document proofs.`,
		)
}

/**
 * Loads the JavaScript the fixture server answers a module path with.
 *
 * @param path - The request path, such as `/dist/src/browser/index.js`
 * @param root - The workspace directory the module files are read from. Default: this workspace
 * @returns The module source; `undefined` for a path no fixture module serves or whose file is
 * absent under `root`
 * @remarks
 * The served paths are each {@link FIXTURE_DOCUMENT_IMPORTS} entry, the two
 * {@link FIXTURE_DOCUMENT_BUNDLE} files, the `@orkestrel/mcp` core entry the browser entry
 * imports relatively, and {@link FIXTURE_REGISTRY_MODULE}, which serves the delimited WebMCP fixture section
 * of `tests/setup.ts` with its types removed by Vite's `transformWithOxc`.
 */
export async function loadFixtureModule(
	path: string,
	root: string = FIXTURE_WORKSPACE,
): Promise<string | undefined> {
	if (path === FIXTURE_REGISTRY_MODULE) {
		const source = join(root, 'tests/setup.ts')
		if (!existsSync(source)) return undefined
		const text = readFileSync(source, 'utf8')
		const section = text
			.split('// === WebMCP fixture source')[1]
			?.split('// === WebMCP fixture end')[0]
		if (section === undefined) throw new Error('The WebMCP fixture source section is absent')
		const { transformWithOxc } = await import('vite')
		const imports = "import { attempt, isRecord, isString } from '@orkestrel/contract'\n"
		return (await transformWithOxc(imports + section, source)).code
	}
	if (
		!Object.values(FIXTURE_DOCUMENT_IMPORTS).includes(path) &&
		!FIXTURE_RELATIVE_MODULES.includes(path)
	)
		return undefined
	const file = join(root, path)
	return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

/**
 * Starts the fixture page server on an ephemeral `127.0.0.1` port.
 *
 * @returns A {@link FixtureServerInterface} answering a `POST` to `/shop/cart` with `303` and the
 * location `/shop/cart`, a `POST` to `/checkout/order` with `200` and
 * {@link FIXTURE_CHECKOUT_CODE} as plain text, every {@link renderFixturePage} path with `200` and
 * HTML, every {@link loadFixtureModule} path with `200` and JavaScript, and any other path with
 * `404`
 * @remarks Chromium resolves `localhost` to the loopback interface, so the one listener serves
 * both {@link FixtureHost} origins.
 */
export async function createFixtureServer(): Promise<FixtureServerInterface> {
	const server = createServer((request, response) => {
		void serveFixtureRequest(request, response)
	})
	const loopback = await createLoopback(server)
	return {
		port: loopback.port,
		url: (path: string, host: FixtureHost = '127.0.0.1'): string =>
			`http://${host}:${loopback.port}${path}`,
		destroy: (): Promise<void> => loopback.destroy(),
	}
}

async function serveFixtureRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
	if (request.method === 'POST' && path === '/shop/cart') {
		request.resume()
		response.writeHead(303, { location: '/shop/cart' })
		response.end()
		return
	}
	if (request.method === 'POST' && path === '/checkout/order') {
		request.resume()
		response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
		response.end(FIXTURE_CHECKOUT_CODE)
		return
	}
	const page = renderFixturePage(path, request.socket.localPort ?? 0)
	if (page !== undefined) {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end(page)
		return
	}
	const module = await loadFixtureModule(path).catch((error: unknown) =>
		error instanceof Error ? error : new Error(String(error)),
	)
	if (module instanceof Error) {
		response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
		response.end(module.message)
		return
	}
	response.writeHead(module === undefined ? 404 : 200, {
		'content-type':
			module === undefined ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
	})
	response.end(module ?? '')
}

/**
 * Holds the module hook a child script registers to load this workspace's TypeScript source under
 * Node: `@src/core` and `@src/server` resolve to their source barrels, and a relative `.js` specifier that
 * resolves nothing falls back to its `.ts` source.
 *
 * @remarks
 * The script imports `registerHooks` from `node:module`. Absolute barrel URLs keep resolution
 * independent of the child's working directory.
 */
export const SOURCE_HOOK = `registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '@src/core') return next(${JSON.stringify(new URL('../src/core/index.ts', import.meta.url).href)}, context)
		if (specifier === '@src/server') return next(${JSON.stringify(new URL('../src/server/index.ts', import.meta.url).href)}, context)
		try { return next(specifier, context) }
		catch (error) {
			if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:')))
				return next(specifier.slice(0, -3) + '.ts', context)
			throw error
		}
	}
})`

/** Loads the browse source entry in a child process without rebuilding the published bundle. */
export const BROWSE_SOURCE_ENTRY = `
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
${SOURCE_HOOK}
registerHooks({
	load(url, context, next) {
		if (url === ${JSON.stringify(new URL('../package.json', import.meta.url).href)})
			return { format: 'module', source: 'const manifest = ' + readFileSync(new URL(url), 'utf8') + '; export const version = manifest.version', shortCircuit: true }
		return next(url, context)
	}
})
await import(${JSON.stringify(new URL('../src/bin/main.ts', import.meta.url).href)})
`

// === Browse server fixtures

/** Observes the first promise created by a named stack and its settlement without replacing it. */
export class BrowserPromiseObserver {
	readonly #hook: AsyncHook
	#id: number | undefined
	#created: string | undefined
	#resolved: string | undefined

	constructor(origin: RegExp, settled?: () => void, created?: () => void) {
		this.#hook = createHook({
			init: (id, category) => {
				if (category !== 'PROMISE' || this.#id !== undefined) return
				const stack = new Error().stack ?? ''
				if (!origin.test(stack)) return
				this.#id = id
				this.#created = stack
				created?.()
			},
			promiseResolve: (id) => {
				if (id !== this.#id) return
				this.#resolved = new Error().stack ?? ''
				this.#hook.disable()
				settled?.()
			},
		})
		this.#hook.enable()
	}

	/** Holds the actual promise creation stack, or absence when the operation never began. */
	get created(): string | undefined {
		return this.#created
	}
	/** Holds the actual settlement stack, before the awaiting continuation runs. */
	get resolved(): string | undefined {
		return this.#resolved
	}
	/** Removes the runtime observer, including after an assertion fails. */
	destroy(): void {
		this.#hook.disable()
	}
}

/**
 * Configures a {@link BrowserLauncher}.
 *
 * @remarks
 * - `failures` — how many launches, in order, reject at `connect()` with a `BrowserError`
 * - `evaluation` — answers each `Runtime.evaluate` the element fixture leaves unanswered, so a
 *   proof can withhold the text-wait evaluation
 * - `released` — answers each `mouseReleased` dispatch, so a proof can withhold a click's release
 * - `registry` — answers `WebMCP.enable`, so a page registry exists and its tools are adopted
 * - `silent` — the number of initial doubles that never answer a ping
 * - `timeout` — the ping deadline in milliseconds
 * - `version` — receives each double's ping count, starting at 1
 */
export interface BrowserLauncherOptions {
	/** Answers context creation at the protocol boundary when a test holds or refuses it. */
	readonly isolation?: BrowserLaunchHandler
	/** Answers context disposal at the protocol boundary when a test holds or refuses it. */
	readonly disposal?: BrowserLaunchHandler
	/** Reports a live process that the calling test spawned and owns. */
	readonly pid?: number
	/** Counts initial doubles whose teardown refuses to confirm termination. */
	readonly survivors?: number
	/** Counts initial doubles whose isolation fails. */
	readonly broken?: number
	/** Fails teardown after the double released its transport. */
	readonly cleanup?: Error
	readonly silent?: number
	readonly timeout?: number
	readonly version?: (call: number) => Promise<void> | void
	readonly failures?: number
	readonly evaluation?: BrowserLaunchHandler
	readonly released?: BrowserLaunchHandler
	readonly registry?: BrowserLaunchHandler
}

/**
 * Answers one CDP request the element fixture hands to a proof, over the transport of the launch
 * that sent it.
 */
export type BrowserLaunchHandler = (
	message: CDPSentMessage,
	transport: CDPTestTransportInterface,
) => void

/**
 * Stands in for a launched Chromium at the browse server's launch boundary: `connect()` opens the
 * element fixture's in-memory CDP connection, and `isolate()` returns a real `BrowserContext` over
 * it whose new page is the fixture's scripted `main` target.
 *
 * @remarks
 * It records the options the server launched it with, each `connect()`, and `destroy()`. A
 * `connect()` waits on the gate its launcher holds and rejects when the launcher scripted a
 * failure for it.
 */
export class BrowserLaunchDouble implements BrowserInterface {
	readonly #contexts: BrowserContextInterface[] = []
	#pid: number | undefined
	readonly #options: BrowserOptions
	readonly #gate: Promise<void>
	readonly #failure: BrowserError | undefined
	readonly #handlers: BrowserLauncherOptions
	readonly #emitter = new Emitter<BrowserEventMap>()
	#fixture: BrowserElementFixture | undefined
	#connects = 0
	#pings = 0
	#targets = 0
	#isolations = 0
	readonly #remote = new Set<string>()
	readonly #scripts = new Map<string, BrowserLaunchHandler>()
	#destroyed = false
	#destroys = 0

	constructor(
		options: BrowserOptions,
		gate: Promise<void>,
		failure: BrowserError | undefined,
		handlers: BrowserLauncherOptions,
	) {
		this.#options = options
		this.#gate = gate
		this.#failure = failure
		this.#handlers = handlers
		this.#pid = handlers.pid
	}

	get emitter(): Emitter<BrowserEventMap> {
		return this.#emitter
	}

	get engine(): 'chromium' {
		return 'chromium'
	}

	get status(): BrowserStatus {
		return this.#fixture === undefined
			? 'idle'
			: this.#fixture.client.connected
				? 'connected'
				: 'disconnected'
	}

	get connection(): BrowserConnection | undefined {
		return this.#fixture === undefined ? undefined : 'persistent'
	}

	get owned(): boolean | undefined {
		return this.#fixture === undefined ? undefined : true
	}

	get pid(): number | undefined {
		return this.#pid
	}

	get endpoint(): string | undefined {
		return this.#fixture?.client.connected === true
			? 'ws://127.0.0.1/devtools/browser/fixture'
			: undefined
	}

	/** Holds the options the server launched this browser with. */
	get options(): BrowserOptions {
		return this.#options
	}

	/** Counts the `connect()` calls the server made. */
	get connects(): number {
		return this.#connects
	}

	/** Reports whether the server destroyed this browser. */
	get destroyed(): boolean {
		return this.#destroyed
	}

	/** Counts owner-side browser disposal calls. */
	get destroys(): number {
		return this.#destroys
	}

	/** Scripts a context protocol reply while retaining the real context and client. */
	script(method: string, handler: BrowserLaunchHandler): void {
		this.#scripts.set(method, handler)
	}

	/** Holds the in-memory CDP fixture a connect opened. */
	get fixture(): BrowserElementFixture | undefined {
		return this.#fixture
	}

	async ping(options?: BrowserCallOptions): Promise<void> {
		if (this.#destroyed) throw new BrowserError('CLOSED', 'Browser has been destroyed')
		const fixture = this.#fixture
		if (fixture?.client.connected !== true)
			throw new BrowserError('DISCONNECTED', 'Browser is not connected')
		const timeout = options?.timeout ?? this.#handlers.timeout
		await fixture.client.send('Browser.getVersion', undefined, {
			...options,
			...(timeout === undefined ? {} : { timeout }),
		})
	}

	async discover(): Promise<BrowserDiscoveryResult> {
		return { endpoint: undefined, browser: undefined }
	}

	async connect(): Promise<void> {
		this.#connects += 1
		const signal = this.#options.signal
		signal?.throwIfAborted()
		const aborted = Promise.withResolvers<never>()
		const listener =
			signal === undefined
				? undefined
				: addAbortListener(signal, () => aborted.reject(signal.reason))
		try {
			await Promise.race([this.#gate, aborted.promise])
		} finally {
			listener?.[Symbol.dispose]()
		}
		signal?.throwIfAborted()
		if (this.#failure !== undefined) throw this.#failure
		const { evaluation, released, registry } = this.#handlers
		// The fixture scripts its transport before it returns it, so each answer reads the transport
		// off the fixture this connect stores.
		const fixture = await createBrowserElementFixture({
			...(evaluation === undefined ? {} : { evaluation: this.#answer.bind(this, evaluation) }),
			...(released === undefined ? {} : { released: this.#answer.bind(this, released) }),
			...(registry === undefined ? {} : { registry: this.#answer.bind(this, registry) }),
		})
		const { transport } = fixture
		transport.onSend('Browser.getVersion', (message) => {
			const handler = this.#scripts.get(message.method)
			if (handler !== undefined) {
				handler(message, transport)
				return
			}
			const call = ++this.#pings
			if ((this.#handlers.silent ?? 0) > 0) return
			void Promise.resolve()
				.then(() => this.#handlers.version?.(call))
				.then(
					() => transport.reply(message.id, {}),
					(error: unknown) =>
						transport.fail(message.id, isError(error) ? error.message : String(error)),
				)
		})
		transport.onSend('Target.createTarget', (message) => {
			this.#targets += 1
			transport.reply(message.id, {
				targetId: this.#targets === 1 ? 'main' : `page-${this.#targets}`,
			})
		})
		transport.onSend('Target.createBrowserContext', (message) => {
			const handler = this.#scripts.get(message.method) ?? this.#handlers.isolation
			if (handler !== undefined) {
				handler(message, transport)
				return
			}
			const id = `context-${++this.#isolations}`
			this.#remote.add(id)
			transport.reply(message.id, { browserContextId: id })
		})
		transport.onSend('Target.disposeBrowserContext', (message) => {
			const handler = this.#scripts.get(message.method) ?? this.#handlers.disposal
			if (handler !== undefined) {
				handler(message, transport)
				return
			}
			this.#remote.delete(String(message.params?.['browserContextId']))
			transport.reply(message.id, {})
		})
		transport.onSend('Target.getBrowserContexts', (message) =>
			transport.reply(message.id, { browserContextIds: [...this.#remote] }),
		)
		transport.onSend('Target.attachToTarget', (message) =>
			transport.reply(message.id, { sessionId: `session-${String(message.params?.['targetId'])}` }),
		)
		for (const method of [
			'Page.setInterceptFileChooserDialog',
			'Browser.setDownloadBehavior',
			'Network.enable',
			'Page.bringToFront',
			'Target.closeTarget',
			'Target.detachFromTarget',
			'WebMCP.disable',
			'Emulation.setDeviceMetricsOverride',
			'Emulation.setTouchEmulationEnabled',
		])
			replyOk(transport, method)
		this.#fixture = fixture
	}

	adopt(): void {}

	async disconnect(): Promise<void> {
		await this.#fixture?.client.close()
	}

	/** Emits process loss before closing the fixture transport. */
	kill(): void {
		this.#pid = undefined
		this.#emitter.emit('disconnect')
		this.#fixture?.transport.closeRemote()
	}

	/** Closes the transport before reporting browser loss on the following macrotask. */
	drop(): void {
		this.#fixture?.transport.closeRemote()
		setImmediate(() => this.#emitter.emit('disconnect'))
	}

	context(index = 0): BrowserContextInterface | undefined {
		return this.#contexts[index]
	}

	contexts(): readonly BrowserContextInterface[] {
		return this.#contexts
	}

	async isolate(options?: BrowserIsolateOptions): Promise<BrowserContextInterface> {
		if ((this.#handlers.broken ?? 0) > 0)
			throw new BrowserError('PROTOCOL', 'The fixture refused isolation')
		const fixture = this.#fixture
		if (fixture === undefined) throw new BrowserError('ARGUMENT', 'The double is not connected')
		const result: unknown = await fixture.client.send('Target.createBrowserContext', {})
		if (!isRecord(result) || !isString(result['browserContextId']))
			throw new BrowserError('ARGUMENT', 'The fixture returned no context id')
		const { proxy: _proxy, origins: _origins, ...defaults } = options ?? {}
		const context = new BrowserContext(fixture.client, {
			...defaults,
			id: result['browserContextId'],
		})
		this.#contexts.push(context)
		return context
	}

	async create(): Promise<BrowserPageInterface> {
		const context = await this.isolate()
		return context.create()
	}

	async destroy(): Promise<void> {
		this.#destroyed = true
		this.#destroys += 1
		await this.#fixture?.client.close()
		if (this.#handlers.cleanup !== undefined) throw this.#handlers.cleanup
		if ((this.#handlers.survivors ?? 0) > 0)
			throw new BrowserError('CONNECTION', 'The fixture termination is unconfirmed')
	}

	async close(): Promise<void> {
		await this.destroy()
	}

	// Hands a request to a proof's handler with the transport of this connect.
	#answer(handler: BrowserLaunchHandler, message: CDPSentMessage): void {
		const transport = this.#fixture?.transport
		if (transport !== undefined) handler(message, transport)
	}
}

/**
 * Records every browser a browse server launches as a {@link BrowserLaunchDouble}, and holds or
 * fails their connects on request.
 */
export class BrowserLauncher {
	readonly #browsers: BrowserLaunchDouble[] = []
	readonly #handlers: BrowserLauncherOptions
	#failures: number
	#from = 0
	#refusing = Infinity
	#refusals = Infinity
	#gate = Promise.withResolvers<void>()

	constructor(options?: BrowserLauncherOptions) {
		this.#failures = options?.failures ?? 0
		this.#handlers = { ...options }
		this.#gate.resolve()
	}

	/** Lists the launched browsers in launch order. */
	get browsers(): readonly BrowserLaunchDouble[] {
		return this.#browsers
	}

	/** Creates the double the server connects, as the server's `launch` option. */
	get launch(): BrowserLaunchFunction {
		return (options) => {
			const failure =
				this.#failures > 0 || (this.#browsers.length >= this.#refusing && this.#refusals > 0)
					? new BrowserError('CONNECTION', 'The fixture refused the launch')
					: undefined
			if (this.#failures > 0) this.#failures -= 1
			if (this.#browsers.length >= this.#refusing) this.#refusals -= 1
			const browser = new BrowserLaunchDouble(
				options,
				this.#browsers.length >= this.#from ? this.#gate.promise : Promise.resolve(),
				failure,
				{
					...this.#handlers,
					silent: this.#browsers.length < (this.#handlers.silent ?? 0) ? 1 : 0,
					survivors: this.#browsers.length < (this.#handlers.survivors ?? 0) ? 1 : 0,
					broken: this.#browsers.length < (this.#handlers.broken ?? 0) ? 1 : 0,
				},
			)
			this.#browsers.push(browser)
			return browser
		}
	}

	/** Parks every later `connect()` until `release()`. */
	hold(from = this.#browsers.length): void {
		this.#from = from
		this.#gate = Promise.withResolvers<void>()
	}

	/** Refuses launches from the zero-based index for the requested count, or indefinitely. */
	refuse(from: number, count = Infinity): void {
		this.#refusing = from
		this.#refusals = count
	}

	/** Lets every parked and later `connect()` continue. */
	release(): void {
		this.#gate.resolve()
	}
}

/** Collects each diagnostic chunk a browse server writes. */
export class BrowseLog extends Writable {
	readonly #lines: string[] = []
	/** Lists the diagnostic chunks in write order. */
	get lines(): readonly string[] {
		return this.#lines
	}
	override _write(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void,
	): void {
		this.#lines.push(chunk.toString())
		callback()
	}
}

/** Creates an unstarted browse server and owns its streams, launch recorder, and scratch root.
 * @param options - Server overrides
 * @param launch - Double behavior
 * @returns The fixture and its teardown barrier
 */
export function createBrowseFixture(
	options?: BrowserMCPServerOptions,
	launch?: BrowserLauncherOptions,
) {
	const scratch = createScratch()
	const launcher = new BrowserLauncher(launch)
	const pair = new MCPStdioPair()
	const log = new BrowseLog()
	const root = join(scratch.path, 'browsers')
	const server = createBrowserMCPServer({
		root,
		stdio: pair,
		log,
		...options,
		pool: { launch: launcher.launch, ...options?.pool },
	})
	const teardown = createTeardown()
	teardown.add(() => scratch.destroy())
	teardown.add(() => {
		pair.input.destroy()
		pair.output.destroy()
		log.destroy()
	})
	teardown.add(() => server.destroy())
	return { scratch, root, launcher, pair, log, server, teardown }
}

/**
 * Drives a browse server over an in-memory stdio pair with newline-delimited JSON-RPC: `input` is
 * the stream the server reads and `output` the stream it writes.
 */
export class MCPStdioPair {
	readonly #input = new PassThrough()
	readonly #output = new PassThrough()
	readonly #answers = new Map<number, Readonly<Record<string, unknown>>>()
	readonly #transport: MCPTransportInterface
	#listener: ((message: string) => void) | undefined

	constructor() {
		createInterface({ input: this.#output }).on('line', (line) => this.#receive(line))
		this.#transport = {
			send: this.#deliver.bind(this),
			listen: this.#listen.bind(this),
			closed: this.#closed.bind(this),
			close: this.#close.bind(this),
		}
	}

	/**
	 * Holds the pair as the duplex message channel an `@orkestrel/mcp` client binds to, beside the
	 * line driver: each message it sends is one input line, and each output line reaches its
	 * listener.
	 */
	get transport(): MCPTransportInterface {
		return this.#transport
	}

	/** Holds the stream the server reads requests from. */
	get input(): PassThrough {
		return this.#input
	}

	/** Holds the stream the server writes answers to. */
	get output(): PassThrough {
		return this.#output
	}

	/** Lists the ids the server answered, in arrival order. */
	get answered(): readonly number[] {
		return [...this.#answers.keys()]
	}

	/** Writes each message as one line, all in one chunk. */
	send(...messages: ReadonlyArray<Readonly<Record<string, unknown>>>): void {
		this.#input.write(messages.map((message) => `${JSON.stringify(message)}\n`).join(''))
	}

	/**
	 * Sends one request and waits for its answer.
	 *
	 * @param id - The request id the answer carries
	 * @param method - The JSON-RPC method
	 * @param params - The request parameters
	 * @returns The answer's `result`, or its `error` record
	 */
	async request(
		id: number,
		method: string,
		params: Readonly<Record<string, unknown>> = {},
	): Promise<Readonly<Record<string, unknown>>> {
		this.send({ jsonrpc: '2.0', id, method, params })
		return this.answer(id)
	}

	/**
	 * Waits for the answer to one request.
	 *
	 * @param id - The request id
	 * @returns The answer's `result`, or its `error` record
	 */
	async answer(id: number): Promise<Readonly<Record<string, unknown>>> {
		await waitForCondition(`the answer to request ${id}`, () => this.#answers.has(id), {
			budget: 10_000,
			interval: 10,
		})
		return requireValue(this.#answers.get(id), `request ${id} has no answer`)
	}

	/** Sends the legacy handshake a dated client opens with and waits for its answer. */
	async initialize(): Promise<Readonly<Record<string, unknown>>> {
		return this.request(1, 'initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'browse-test', version: '1.0.0' },
		})
	}

	/**
	 * Calls one tool and reads its answer as text.
	 *
	 * @param id - The request id
	 * @param name - The tool name
	 * @param args - The tool arguments
	 * @returns The answer's first text block and whether the server flagged it an error
	 */
	async call(
		id: number,
		name: string,
		args: Readonly<Record<string, unknown>>,
	): Promise<{ readonly text: string; readonly error: boolean }> {
		const answer = await this.request(id, 'tools/call', { name, arguments: args })
		const content = answer['content']
		const first: unknown = Array.isArray(content) ? content[0] : undefined
		const text = isRecord(first) ? first['text'] : undefined
		if (!isString(text))
			throw new Error(`request ${id} answered no text: ${JSON.stringify(answer)}`)
		return { text, error: answer['isError'] === true }
	}

	// Keeps each answer's result, or its error record, by id, and hands the line to a bound client.
	#receive(line: string): void {
		this.#listener?.(line)
		const message = parseJSON(line)
		if (!isRecord(message) || !isInteger(message['id'])) return
		const body = message['result'] ?? message['error']
		if (isRecord(body)) this.#answers.set(message['id'], body)
	}

	#deliver(message: string): void {
		this.#input.write(`${message}\n`)
	}

	#listen(handler: (message: string) => void): void {
		this.#listener = handler
	}

	// The server never ends its output, so the channel reports no close.
	#closed(_handler: () => void): void {}

	#close(): void {
		this.#listener = undefined
	}
}

/**
 * Names the browse server's vocabulary in the order the design lists it: the toolset's tools,
 * `dialog` included, then the journey tools.
 */
export const BROWSE_VOCABULARY: readonly string[] = Object.freeze([
	'read',
	'click',
	'type',
	'press',
	'navigate',
	'wait',
	'dialog',
	'switch',
	'record',
	'save',
	'journeys',
	'edit',
	'replay',
	'forget',
	'capture',
	'acquire',
	'execute',
	'tools',
	'destroy',
])

/** Describes how a spawned browse child ended. */
export interface BrowseChildEnding {
	readonly code: number | null
	readonly signal: NodeJS.Signals | null
}

/**
 * Spawns a built browse entry as `node ENTRY` in a working directory, with every inherited
 * `BROWSE_` variable dropped by case-folded name before the given ones are added, and reads its
 * standard output as lines.
 */
export class BrowseChild {
	readonly #child: ChildProcess
	readonly #lines: string[] = []
	readonly #errors: Buffer[] = []
	readonly #ending: Promise<BrowseChildEnding>

	/**
	 * Spawns the entry.
	 *
	 * @param entry - The built entry's path
	 * @param cwd - The working directory the child runs in
	 * @param environment - The `BROWSE_` variables the child receives
	 */
	constructor(entry: string, cwd: string, environment: Readonly<Record<string, string>>) {
		const inherited = Object.entries(process.env).filter(
			([name]) => !name.toLowerCase().startsWith('browse_'),
		)
		this.#child = spawnProcess(process.execPath, [entry], {
			cwd,
			env: { ...Object.fromEntries(inherited), ...environment },
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		})
		this.#ending = new Promise((resolve) => {
			this.#child.once('exit', (code, signal) => resolve({ code, signal }))
		})
		this.#child.stderr?.on('data', (chunk: Buffer) => this.#errors.push(chunk))
		const output = this.#child.stdout
		if (output !== null)
			createInterface({ input: output }).on('line', (line) => this.#lines.push(line))
	}

	/** Reports the child process identifier while its handle retains it. */
	get pid(): number | undefined {
		return this.#child.pid
	}

	/** Lists the lines the child wrote to standard output. */
	get lines(): readonly string[] {
		return this.#lines
	}

	/** Holds what the child wrote to standard error. */
	get stderr(): string {
		return Buffer.concat(this.#errors).toString('utf8')
	}

	/** Resolves with the child's exit code and signal. */
	get ending(): Promise<BrowseChildEnding> {
		return this.#ending
	}

	/** Writes each message as one line. */
	send(...messages: ReadonlyArray<Readonly<Record<string, unknown>>>): void {
		this.#child.stdin?.write(messages.map((message) => `${JSON.stringify(message)}\n`).join(''))
	}

	/** Ends the child's standard input. */
	end(): void {
		this.#child.stdin?.end()
	}

	/** Closes the reader so the child's next diagnostic meets a broken pipe. */
	close(): void {
		this.#child.stderr?.destroy()
	}

	/**
	 * Sends a signal to the child.
	 *
	 * @param signal - The signal to send
	 */
	kill(signal: NodeJS.Signals): void {
		this.#child.kill(signal)
	}

	/** Kills a child still running, the teardown for a proof that failed before it ended. */
	async destroy(): Promise<void> {
		if (this.#child.exitCode === null && this.#child.signalCode === null)
			this.#child.kill('SIGKILL')
		await this.#ending
	}
}

/** Names a way a host ends a browse server: the end of its standard input, or `SIGTERM`. */
export type BrowseEnding = 'EOF' | 'SIGTERM'

/** Lists every way a host ends a browse server, as {@link BrowseEnding} names them. */
export const BROWSE_ENDINGS: readonly BrowseEnding[] = Object.freeze(['EOF', 'SIGTERM'])

/**
 * Ends a browse child the way a host does: closes its standard input, or signals it.
 *
 * @param child - The spawned child
 * @param ending - The way to end it
 */
export function endBrowseChild(child: BrowseChild, ending: BrowseEnding): void {
	if (ending === 'EOF') child.end()
	else child.kill(ending)
}

/**
 * Opens the protocol on a browse child and makes its first `read` call, which launches the
 * child's Chromium.
 *
 * @param child - The spawned child
 * @returns The text the `read` call answered
 * @throws Thrown when the call answers an error, or when no answer arrives within 60 seconds
 */
export async function startBrowseChild(child: BrowseChild): Promise<string> {
	child.send(
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'browse-test', version: '1.0.0' },
			},
		},
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name: 'read', arguments: { from: 1, search: 'the page' } },
		},
	)
	const answer = await retryUntil(
		'the answer to the first read',
		() =>
			child.lines
				.map((line): unknown => parseJSON(line))
				.find((message) => isRecord(message) && message['id'] === 2),
		(message) => message !== undefined,
		{ budget: 60_000, interval: 10 },
	)
	const result = isRecord(answer) ? answer['result'] : undefined
	const content = isRecord(result) ? result['content'] : undefined
	const first: unknown = isArray(content) ? content[0] : undefined
	const text = isRecord(first) ? first['text'] : undefined
	if (!isString(text) || !isRecord(result) || result['isError'] === true)
		throw new Error(`the first read answered ${JSON.stringify(answer)}`)
	return text
}

/**
 * Reports whether this host lists every process's arguments in a `/proc` table.
 *
 * @remarks
 * Linux exposes a process's arguments at `/proc/PID/cmdline`. Windows and macOS expose no such
 * table, so a case that reads a Chromium command line gates on this reading.
 */
export const PROCESS_TABLE = existsSync('/proc/self/cmdline')

/**
 * Describes a running Chromium process found by the profile its command line names.
 *
 * @remarks
 * - `pid` — the process identifier
 * - `profile` — the `--user-data-dir` value its command line carries
 * - `browser` — true for the browser process itself; false for a zygote, GPU, utility, or renderer
 *   process, each of which carries a `--type=` switch
 */
export interface ChromiumProcess {
	readonly pid: number
	readonly profile: string
	readonly browser: boolean
}

/**
 * Lists the running Chromium processes whose `--user-data-dir` sits directly in a directory, read
 * from the host's `/proc` table.
 *
 * @remarks
 * A process that ends between the table's listing and the read of its arguments is left out, and so
 * is a process that has ended but not been reaped, whose argument list reads empty.
 *
 * @param profiles - The directory the profiles sit in
 * @returns The processes, ordered by identifier
 * @throws Thrown when {@link PROCESS_TABLE} is false
 */
export function readChromiumProcesses(profiles: string): readonly ChromiumProcess[] {
	if (!PROCESS_TABLE) throw new Error('This host exposes no /proc process table')
	const directory = resolvePath(profiles)
	const found: ChromiumProcess[] = []
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/u.test(name)) continue
		try {
			const args = readFileSync(join('/proc', name, 'cmdline'), 'utf8').split('\0')
			const profile = args
				.find((arg) => arg.startsWith('--user-data-dir='))
				?.slice('--user-data-dir='.length)
			if (profile === undefined || dirname(resolvePath(profile)) !== directory) continue
			found.push({
				pid: Number(name),
				profile,
				browser: !args.some((arg) => arg.startsWith('--type=')),
			})
		} catch (error) {
			if (readErrorCode(error) !== 'ENOENT' && readErrorCode(error) !== 'ESRCH') throw error
		}
	}
	return found.sort((first, second) => first.pid - second.pid)
}

/**
 * Kills every Chromium process whose profile sits directly in a directory and waits until none
 * runs, the teardown for a proof that failed with a browser still open.
 *
 * @param profiles - The directory the profiles sit in
 * @returns Resolves after no such process runs
 * @throws Thrown when one still runs after 5 seconds
 */
export async function destroyChromiumProcesses(profiles: string): Promise<void> {
	for (const chromium of readChromiumProcesses(profiles)) {
		try {
			process.kill(chromium.pid, 'SIGKILL')
		} catch (error) {
			if (readErrorCode(error) !== 'ESRCH') throw error
		}
	}
	await waitForCondition(
		`no Chromium runs with a profile in ${profiles}`,
		() => readChromiumProcesses(profiles).length === 0,
		{ budget: 5000, interval: 50 },
	)
}

/**
 * Lists the absolute paths of the entries in a profiles directory.
 *
 * @param profiles - The directory the profiles sit in
 * @returns The entries' paths in name order, or none when the directory is absent
 */
export function readProfiles(profiles: string): readonly string[] {
	if (!existsSync(profiles)) return []
	return readdirSync(profiles)
		.sort()
		.map((name) => join(profiles, name))
}

/**
 * Reports whether this host can create a FIFO at a filesystem path.
 *
 * @remarks
 * A POSIX host creates one with `mkfifo`. Windows names its pipes under `\\.\pipe\` only, so no
 * path a store opens can be one, and a case that parks a reader on a FIFO gates on this reading.
 */
export const FIFO_PATHS = process.platform !== 'win32'

/**
 * Creates a FIFO at a path with the host's `mkfifo` command.
 *
 * @param path - The path the FIFO takes; its parent exists and the path does not
 * @throws Error when `mkfifo` refuses the path or cannot start
 */
export function createFifo(path: string): void {
	const result = spawnSync('mkfifo', [path], { encoding: 'utf8' })
	if (result.status !== 0)
		throw new Error(`mkfifo refused ${path}: ${result.error?.message ?? result.stderr}`)
}

/**
 * Opens the writing end of a FIFO after a process opens its reading end.
 *
 * @remarks
 * Each attempt opens without blocking, so no worker thread waits on a reader that never arrives:
 * an attempt before a reader exists fails with `ENXIO` and is retried within the budget. The
 * reader's read ends when the caller closes the writer.
 *
 * @param path - The FIFO
 * @param options - The retry bounds
 * @returns The writer
 */
export function openFifoWriter(path: string, options?: RetryOptions): Promise<FileHandle> {
	return retryUntil(
		`a reader opens the FIFO at ${path}`,
		() => open(path, constants.O_WRONLY | constants.O_NONBLOCK),
		() => true,
		options,
	)
}

/**
 * Returns the identifier of a Node process that has exited.
 *
 * @remarks
 * The process is spawned and reaped before this returns, so the identifier names no live process
 * until the host reuses it.
 *
 * @returns The exited process's identifier
 */
export function readExitedProcessId(): number {
	const result = spawnSync(process.execPath, ['--version'])
	if (result.status !== 0) throw new Error(`node --version exited ${String(result.status)}`)
	return result.pid
}

/** Names the bindings a bundle imports from one specifier and the ones it declares again. */
export interface BundleImports {
	readonly imported: readonly string[]
	readonly redeclared: readonly string[]
}

/**
 * Reads the named imports a built bundle takes from one specifier, and the ones among them that
 * the bundle also declares, under the same name or a bundler's `NAME$N` rename.
 *
 * @remarks
 * A bundle that inlines a module it also imports holds two bindings for one export, so an
 * `instanceof` check across them fails. An import alias does not change the imported name.
 *
 * @param bundle - The bundle's text
 * @param specifier - The import specifier as the bundle writes it
 * @returns The imported names in import order, and the redeclared ones in that order
 */
export function readBundleImports(bundle: string, specifier: string): BundleImports {
	const imported: string[] = []
	for (const match of bundle.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*(["'])(.*?)\2/gu)) {
		if (match[3] !== specifier) continue
		for (const entry of (match[1] ?? '').split(',')) {
			const name = entry.trim().split(/\s+as\s+/u)[0]
			if (name !== undefined && name !== '') imported.push(name)
		}
	}
	const declared = Array.from(
		bundle.matchAll(/\b(?:class|const|let|var|function\*?)\s+([A-Za-z_$][\w$]*)/gu),
		(match) => match[1] ?? '',
	)
	const redeclared = imported.filter((name) =>
		declared.some(
			(binding) =>
				binding === name ||
				(binding.startsWith(`${name}$`) && /^\$\d+$/u.test(binding.slice(name.length))),
		),
	)
	return { imported, redeclared }
}

/**
 * Holds a browse server launched over a {@link BrowserLauncher} and an {@link MCPStdioPair}.
 *
 * @remarks
 * - `browser` — the one launch its first `read` made
 * - `profile` — the profile directory that launch was given, which exists
 * - `listeners` — the `SIGTERM` and `SIGINT` listener counts from before `start()`
 * - `teardown` — removes the scratch root and destroys the server
 */
export interface BrowseSession {
	readonly pair: MCPStdioPair
	readonly launcher: BrowserLauncher
	readonly browser: BrowserLaunchDouble
	readonly profile: string
	readonly listeners: { readonly SIGTERM: number; readonly SIGINT: number }
	readonly teardown: TeardownInterface
}

/**
 * Starts a browse server under a scratch root and launches it with one `read`.
 *
 * @returns The started session
 * @throws Thrown when the `read` fails or the launch made no profile
 */
export async function openBrowseSession(): Promise<BrowseSession> {
	const scratch = createScratch()
	const launcher = new BrowserLauncher()
	const pair = new MCPStdioPair()
	const server = createBrowserMCPServer({
		root: join(scratch.path, 'tmp/browsers'),
		stdio: pair,
		pool: { launch: launcher.launch },
	})
	const listeners = {
		SIGTERM: process.listenerCount('SIGTERM'),
		SIGINT: process.listenerCount('SIGINT'),
	}
	const teardown = createTeardown()
	teardown.add(() => scratch.destroy())
	teardown.add(() => server.destroy())
	await server.start()
	await pair.initialize()
	const reading = await pair.call(2, 'read', { from: 1, search: 'the cart' })
	if (reading.error) throw new Error(reading.text)
	const browser = requireValue(launcher.browsers[0], 'no launch was recorded')
	const profile = requireValue(browser.options.profile, 'the launch named no profile')
	if (!existsSync(profile)) throw new Error(`the launch made no profile at ${profile}`)
	return { pair, launcher, browser, profile, listeners, teardown }
}

// === Compiled journey modules

// Imports the built package through the staged link, so the browser context it returns and every
// page that context opens come from the same module instance a generated journey module imports.
const BROWSER_JOURNEY_HARNESS = `import { BrowserContext, createCDPClient } from '@orkestrel/browser'
import { createWebSocketCDPTransport } from '@orkestrel/browser/server'

export async function connect(url) {
	const client = createCDPClient({ transport: createWebSocketCDPTransport({ url }) })
	await client.connect()
	const context = new BrowserContext(client)
	return {
		context,
		destroy: async () => {
			await context.destroy()
			await client.close()
		},
	}
}
`

/** Describes a generated journey module that Node's own loader imported from a stage. */
export interface BrowserJourneyModuleInterface {
	/** Runs the module's `execute` over a page with the given inputs. */
	execute(page: BrowserPageInterface, inputs: Readonly<Record<string, string>>): Promise<void>
	/** Returns the receipt of each action in the module's exported `actions` array, in order. */
	receipts(): readonly string[]
}

/** Describes a browser context the staged built package opened over a protocol connection. */
export interface BrowserJourneyConnectionInterface {
	readonly context: BrowserContextInterface
	/** Destroys the context and closes its protocol connection. */
	destroy(): Promise<void>
}

/**
 * Stages a scratch directory whose `node_modules/@orkestrel/browser` links a built package, for
 * generated journey modules that import only that package.
 *
 * @remarks
 * - `path` — the staged directory, whose `package.json` declares `"type": "module"`
 * - `load` — writes a JavaScript module and imports it through Node's own loader, so
 *   `@orkestrel/browser` resolves through the link rather than through a workspace alias
 * - `check` — writes TypeScript modules and returns every line the workspace's `tsc` reports
 *   for them under `nodenext` resolution and strict options
 * - `connect` — opens a browser context through the linked package over a debugger URL
 * - `destroy` — removes the directory; the linked package stays
 */
export interface BrowserJourneyStageInterface {
	readonly path: string
	load(file: string, source: string): BrowserJourneyModuleInterface
	check(sources: Readonly<Record<string, string>>): readonly string[]
	connect(url: string): Promise<BrowserJourneyConnectionInterface>
	destroy(): void
}

/**
 * Creates a {@link BrowserJourneyStageInterface} over a built package.
 *
 * @param root - The package directory the stage links, whose `dist/` holds the build. Default:
 * this workspace
 * @returns The stage, registered for removal with the other temporary directories
 */
export function createBrowserJourneyStage(
	root: string = FIXTURE_WORKSPACE,
): BrowserJourneyStageInterface {
	return new BrowserJourneyStage(createTempDirectory('journey-module-'), root)
}

/** Implements the journey-module stage over one scratch directory. */
export class BrowserJourneyStage implements BrowserJourneyStageInterface {
	readonly #scratch: ScratchInterface
	readonly #require: NodeJS.Require

	constructor(scratch: ScratchInterface, root: string) {
		this.#scratch = scratch
		scratch.link('node_modules/@orkestrel/browser', root)
		scratch.write('package.json', '{ "private": true, "type": "module" }\n')
		this.#require = createRequire(join(scratch.path, 'package.json'))
	}

	get path(): string {
		return this.#scratch.path
	}

	load(file: string, source: string): BrowserJourneyModuleInterface {
		// `require` of an ES module runs Node's own loader, which Vitest does not transform.
		const loaded: unknown = this.#require(this.#scratch.write(file, source))
		const execute = isObject(loaded) ? Reflect.get(loaded, 'execute') : undefined
		if (!isObject(loaded) || !isFunction(execute))
			throw new Error(`${file} exports no execute function`)
		return {
			execute: async (page, inputs) => {
				await execute(page, inputs)
			},
			receipts: () => {
				const actions = Reflect.get(loaded, 'actions')
				if (!isArray(actions)) throw new Error(`${file} exports no actions array`)
				return actions.map((action) => {
					const receipt = isRecord(action) ? action['receipt'] : undefined
					if (!isString(receipt)) throw new Error(`${file} recorded an action without a receipt`)
					return receipt
				})
			},
		}
	}

	check(sources: Readonly<Record<string, string>>): readonly string[] {
		for (const [file, source] of Object.entries(sources)) this.#scratch.write(file, source)
		const project = {
			compilerOptions: {
				module: 'nodenext',
				moduleResolution: 'nodenext',
				target: 'esnext',
				strict: true,
				exactOptionalPropertyTypes: true,
				noUncheckedIndexedAccess: true,
				noUnusedLocals: true,
				noUnusedParameters: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			files: Object.keys(sources),
		}
		const config = this.#scratch.write(
			'tsconfig.json',
			`${JSON.stringify(project, undefined, '\t')}\n`,
		)
		const compiler = join(
			dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
			'bin/tsc',
		)
		const result = spawnSync(process.execPath, [compiler, '--pretty', 'false', '-p', config], {
			cwd: this.path,
			encoding: 'utf8',
		})
		if (result.error !== undefined) throw result.error
		const lines = `${result.stdout}${result.stderr}`.split('\n').filter((line) => line !== '')
		if (result.status !== 0 && lines.length === 0)
			throw new Error(`tsc exited ${String(result.status)} without a diagnostic`)
		return lines
	}

	async connect(url: string): Promise<BrowserJourneyConnectionInterface> {
		const harness: unknown = this.#require(
			this.#scratch.write('harness.js', BROWSER_JOURNEY_HARNESS),
		)
		const connect = isObject(harness) ? Reflect.get(harness, 'connect') : undefined
		if (!isFunction(connect)) throw new Error('The journey harness exports no connect function')
		const connection: unknown = await connect(url)
		const context = isRecord(connection) ? connection['context'] : undefined
		const destroy = isRecord(connection) ? connection['destroy'] : undefined
		if (!isBrowserContextValue(context) || !isFunction(destroy))
			throw new Error('The built package opened no browser context')
		return {
			context,
			destroy: async () => {
				await destroy()
			},
		}
	}

	destroy(): void {
		this.#scratch.destroy()
	}
}

/** Checks whether a fixture connection exposes the context operations its consumer uses. */
export function isBrowserContextValue(value: unknown): value is BrowserContextInterface {
	return (
		isObject(value) &&
		isFunction(Reflect.get(value, 'create')) &&
		isFunction(Reflect.get(value, 'pages')) &&
		isFunction(Reflect.get(value, 'destroy'))
	)
}

/** Parks a real lock recoverer after reading the dead entry, before its unlink. */
export const BROWSER_LOCK_RECOVERER = `
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { once } from 'node:events'
${SOURCE_HOOK}
const { FileBrowserStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserStore.ts')).href)
class LockBarrier extends FileBrowserStore {
	#observed = false
	async check(path, options) {
		const exists = await super.check(path, options)
		if (!this.#observed && path === resolve(process.argv[2], 'journey.lock', process.argv[3])) {
			this.#observed = true
			const resume = once(process, 'message')
			process.send?.('observed')
			await resume
		}
		return exists
	}
}
try {
	const files = new LockBarrier({ root: process.argv[2] })
	await files.lock(resolve(process.argv[2], 'journey.lock'), async () => {
		const release = once(process, 'message')
		process.send?.('entered')
		await release
	})
	process.send?.('released')
} catch (error) {
	process.send?.(error instanceof Error && 'code' in error ? error.code : String(error))
} finally {
	process.disconnect?.()
}
`

/** Waits for the next IPC result from a filesystem fixture process. */
export async function waitForBrowserChild(child: ChildProcess): Promise<unknown> {
	const [message] = await waitForEvent<[unknown]>(
		(listener) => {
			child.once('message', listener)
			return () => {
				child.off('message', listener)
			}
		},
		'filesystem child message',
		{ budget: 10000 },
	)
	return message
}

/** Terminates an owned filesystem fixture process and observes its exit. */
export async function stopBrowserChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return
	const ending = waitForEvent<[number | null, NodeJS.Signals | null]>(
		(listener) => {
			child.once('exit', listener)
			return () => {
				child.off('exit', listener)
			}
		},
		'filesystem child exit',
		{ budget: 10000 },
	)
	child.kill('SIGKILL')
	await ending
}

/** Runs an external filesystem interleaving after each real component check. */
export class BrowserLockObserver extends FileBrowserStore {
	readonly #observe: (path: string) => Promise<void>

	constructor(options: FileBrowserStoreOptions, observe: (path: string) => Promise<void>) {
		super(options)
		this.#observe = observe
	}

	override async check(path: string, options?: BrowserStoreOptions): Promise<boolean> {
		const present = await super.check(path, options)
		await this.#observe(path)
		return present
	}
}

/**
 * Runs an interleaving before the next native filesystem promise delivers its completion.
 * @param action - Synchronous filesystem action after the native operation has finished
 * @returns The enabled hook, which the caller disables during cleanup
 */
export function observeBrowserFilesystem(action: () => void): AsyncHook {
	const pending = new BrowserFixtureValue<number | undefined>(undefined)
	const delivered = new BrowserFixtureValue(false)
	return createHook({
		init(id, category) {
			if (category === 'FSREQPROMISE' && pending.value === undefined) pending.value = id
		},
		before(id) {
			if (id !== pending.value || delivered.value) return
			delivered.value = true
			action()
		},
	}).enable()
}

/** Records a ruled comparison between a package reading and its pinned authority. */
export interface ConformanceRow {
	readonly symbol: string
	readonly expected: unknown
	readonly model: unknown
	readonly ruling: 'implement' | 'retain' | 'exclude'
	readonly closer?: string
}

/** Defers a ruled model reading until its independent wire input reaches the real operation. */
export interface ConformanceOperationRow extends ConformanceRow {
	readonly input: Readonly<Record<string, unknown>>
	readonly model: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
}

/** Enumerates source declarations and export clauses reachable through local star exports.
 * @param paths - Entry modules, including barrels or scratch controls
 * @returns Exported names by entry path
 * @throws Thrown when a module cannot be read or a star export is not relative.
 */
export function readConformanceExports(
	paths: readonly string[],
): ReadonlyMap<string, readonly string[]> {
	const exports = new Map<string, readonly string[]>()
	for (const path of paths) {
		const pending = [resolvePath(path)]
		const visited = new Set<string>()
		const names = new Set<string>()
		while (pending.length > 0) {
			const module = requireValue(pending.pop())
			if (visited.has(module)) continue
			visited.add(module)
			if (!existsSync(module)) throw new Error(`Missing export module: ${module}`)
			// Preserve quoted text while removing block and line comments, including between keywords.
			const source = readFileSync(module, 'utf8').replace(
				/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
				(token) => (token.startsWith('/') ? ' ' : token),
			)
			for (const match of source.matchAll(
				/\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum|namespace)\s+([$\w]+)/g,
			))
				names.add(requireValue(match[1]))
			for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
				for (const entry of requireValue(match[1]).split(',')) {
					const name = /^(?:type\s+)?([$\w]+)(?:\s+as\s+([$\w]+))?$/.exec(entry.trim())
					if (name !== null) names.add(requireValue(name[2] ?? name[1]))
				}
			}
			if (/\bexport\s+default\b/.test(source)) names.add('default')
			for (const match of source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
				const target = requireValue(match[1])
				if (!target.startsWith('.')) throw new Error(`Nonrelative star export: ${target}`)
				pending.push(resolvePath(dirname(module), target.replace(/\.js$/, '.ts')))
			}
		}
		exports.set(path, [...names].sort())
	}
	return exports
}

/** Supplies a star-export chain ending in indirect and comment-separated forbidden exports. */
export const WEBMCP_EXPORT_CONTROL = Object.freeze({
	'index.ts': "export * from './bridge.js'\n",
	'bridge.ts': "export * from './definitions.js'\n",
	'definitions.ts':
		'export class BrowserRegistry {}\nexport { BrowserRegistry as BrowserModelContext }\nexport /* note */ class ModelContextThing {}\n',
})

/** Locates the Orchestrator's revision-specific WPT tree listing. */
export const WEBMCP_WPT_LISTING_PATH = fileURLToPath(
	new URL('./mirrors/wpt-webmcp-e6ba3d7abea7.txt', import.meta.url),
)
/** Holds the supplied git tree listing, whose presence the setup proof requires. */
export const WEBMCP_WPT_LISTING = readFileSync(WEBMCP_WPT_LISTING_PATH, 'utf8')
/** Records each listed WPT path, excluding the provenance header. */
export const WEBMCP_WPT_ENTRIES: readonly string[] = Object.freeze(
	[...WEBMCP_WPT_LISTING.matchAll(/\t(webmcp\/[^\r\n]+)$/gm)].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	),
)

/** Reads the real registry's adoption and its retained protocol annotation.
 * @param input - Mirror-shaped tool delivered over the protocol boundary
 * @returns Adopted annotations and the retained autosubmit value
 */
export async function readAdoptionModel(
	input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	const fixture = await createBrowserElementFixture({
		registry: (message) => fixture.transport.reply(message.id, {}),
	})
	try {
		await fixture.page.registry.start()
		fixture.transport.event('WebMCP.toolsAdded', { tools: [input] }, 'session-main')
		const adopted = requireValue((await fixture.page.registry.adopt())[0])
		const autosubmit = fixture.page.registry.tools()[0]?.annotation.autosubmit
		return { annotations: adopted.annotations, ...(autosubmit === undefined ? {} : { autosubmit }) }
	} finally {
		await fixture.client.close()
	}
}

/** Reads the real toolset's exclusion and whether the excluded tool was installed.
 * @param input - Mirror-shaped tool delivered over the protocol boundary
 * @returns The emitted name and reason with the tool's membership
 */
export async function readSkipModel(input: Readonly<Record<string, unknown>>): Promise<unknown> {
	const fixture = await createBrowserElementFixture({
		registry: (message) => fixture.transport.reply(message.id, {}),
	})
	const toolset = createBrowserToolset(fixture.page)
	try {
		replyOk(fixture.transport, 'WebMCP.disable')
		const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
		toolset.emitter.on('skip', skips.handler)
		await toolset.start()
		fixture.transport.event('WebMCP.toolsAdded', { tools: [input] }, 'session-main')
		await waitForCondition('skip reported', () => skips.count > 0)
		const [name, reason] = requireValue(skips.calls[0])
		return { name, reason, present: toolset.tools.tool(name) !== undefined }
	} finally {
		await toolset.destroy()
		await fixture.client.close()
	}
}

/** Pins the specification source bytes. */
export const WEBMCP_INDEX_DIGEST =
	'e6c9b9790fd5cabc11662bbfeb296a6919388d8fd3f23bf7c85258059948b1b9'
/** Pins the webref IDL bytes. */
export const WEBMCP_WEBREF_DIGEST =
	'eddabc7932e9fdfe5e7c48efffb6fe4606657c5f45c9799038d361775802f332'
/** Pins the raw protocol domain cut. */
export const WEBMCP_DOMAIN_DIGEST =
	'13fb565428f1fc1e09bca51b1234536c5c8da77adf0bd952700e6cdbbc4f1bf6'
/** Pins the whole protocol file from which the domain was cut, without vendoring it. */
export const WEBMCP_PROTOCOL_DIGEST =
	'672d8481c92832907211e85488e216cd5b1a922fde273faff72f7f6cf765899e'
/** Records the domain byte range, with an exclusive end. */
export const WEBMCP_DOMAIN_RANGE = Object.freeze({ start: 1404474, end: 1415819 })
/** Locates the revision-named source mirror. */
export const WEBMCP_INDEX_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-index-19fc56516057.bs', import.meta.url),
)
/** Locates the revision-named IDL mirror. */
export const WEBMCP_WEBREF_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-webref-e6ba3d7abea7.idl', import.meta.url),
)
/** Locates the revision-named domain mirror. */
export const WEBMCP_DOMAIN_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-domain-dc2ddf369035.json', import.meta.url),
)

/** Formats a drift with the authority's expected value.
 * @param symbol - Compared symbol
 * @param authority - Pinned authority
 * @param value - Authority value
 * @returns The failure description
 */
export function formatConformanceDrift(symbol: string, authority: string, value: unknown): string {
	return `${symbol} drifted; ${authority}=${JSON.stringify(value)}`
}

/** Reports unequal readings, comparing composite values without depending on property order.
 * @param symbol - Compared symbol
 * @param local - Local reading
 * @param authority - Pinned authority
 * @param value - Authority reading
 * @returns A drift description, or undefined on equality
 */
export function readConformanceDrift(
	symbol: string,
	local: unknown,
	authority: string,
	value: unknown,
): string | undefined {
	return isDeepStrictEqual(local, value)
		? undefined
		: formatConformanceDrift(symbol, authority, value)
}

/** Reads raw bytes only after their digest matches the pin.
 * @param path - Mirror path
 * @param digest - Expected SHA-256 digest
 * @returns The verified bytes
 * @throws Thrown when the digest differs or the file cannot be read.
 */
export function readMirror(path: string, digest: string): Uint8Array {
	const bytes = readFileSync(path)
	if (createHash('sha256').update(bytes).digest('hex') !== digest)
		throw new Error(formatConformanceDrift(`${basename(path)} bytes`, 'SHA-256', digest))
	return bytes
}

/** Holds the verified specification source. */
export const WEBMCP_INDEX = readMirror(WEBMCP_INDEX_PATH, WEBMCP_INDEX_DIGEST)
/** Holds the verified webref IDL. */
export const WEBMCP_WEBREF = readMirror(WEBMCP_WEBREF_PATH, WEBMCP_WEBREF_DIGEST)
/** Holds the verified raw domain cut. */
export const WEBMCP_DOMAIN = readMirror(WEBMCP_DOMAIN_PATH, WEBMCP_DOMAIN_DIGEST)

/** Decodes verified mirror bytes without rewriting them.
 * @param bytes - Verified bytes
 * @returns UTF-8 text
 */
export function readMirrorText(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Reads an IDL declaration block from a pinned text mirror.
 * @param text - Mirror text
 * @param name - Interface or dictionary name
 * @returns The declaration body
 * @throws Thrown when the declaration is absent.
 */
export function readIDLBlock(text: string, name: string): string {
	const body = new RegExp(
		`(?:interface|dictionary) ${name}(?: : \\w+)? \\{([\\s\\S]*?)\\n\\};`,
	).exec(text)?.[1]
	if (body === undefined) throw new Error(`Missing IDL block: ${name}`)
	return body
}

/** Reads named records from one protocol collection.
 * @param root - Protocol object
 * @param key - Collection key
 * @returns Records in mirror order
 * @throws Thrown when the collection is malformed.
 */
export function readDomainRecords(
	root: unknown,
	key: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const values = isRecord(root) ? root[key] : undefined
	if (!Array.isArray(values) || !values.every(isRecord))
		throw new Error(`Missing protocol collection: ${key}`)
	return values
}

/** Finds a protocol record by its external name or id.
 * @param records - Protocol records
 * @param name - External name
 * @returns The record
 * @throws Thrown when absent.
 */
export function readDomainRecord(
	records: ReadonlyArray<Readonly<Record<string, unknown>>>,
	name: string,
): Readonly<Record<string, unknown>> {
	const record = records.find((entry) => entry['name'] === name || entry['id'] === name)
	if (record === undefined) throw new Error(`Missing protocol record: ${name}`)
	return record
}

/** Records property reads made by the real parser against a valid protocol value.
 * @param parser - Production parser
 * @param value - Valid protocol fixture
 * @returns Sorted external property names read by the parser
 */
export function readParserFields(
	parser: (value: unknown) => unknown,
	value: Readonly<Record<string, unknown>>,
): readonly string[] {
	const names = new Set<string>()
	parser(
		new Proxy(value, {
			get(target, key) {
				if (typeof key === 'string') names.add(key)
				return Reflect.get(target, key)
			},
		}),
	)
	return [...names].sort()
}

/** Holds a mirror-shaped tool with every optional coordinate populated. */
export const WEBMCP_TOOL = Object.freeze({
	name: 'search-cars',
	description: 'Search cars',
	frameId: 'main',
	backendNodeId: 50,
	inputSchema: { type: 'object', properties: { search: { type: 'string' } }, required: ['search'] },
	annotations: {
		readOnly: true,
		untrustedContent: false,
		consequential: true,
		debugging: false,
		autosubmit: true,
	},
	stackTrace: { callFrames: [] },
})
/** Holds the parsed domain authority. */
export const WEBMCP_PROTOCOL: unknown = JSON.parse(readMirrorText(WEBMCP_DOMAIN))
/** Holds the external tool fields the parser reads. */
export const WEBMCP_TOOL_FIELDS = readParserFields(parseBrowserTool, WEBMCP_TOOL)
/** Holds the external annotation fields the parser reads. */
export const WEBMCP_ANNOTATION_FIELDS = readParserFields(
	(annotations) => parseBrowserTool({ ...WEBMCP_TOOL, annotations }),
	WEBMCP_TOOL.annotations,
)
/** Holds the external removal fields the parser reads. */
export const WEBMCP_REMOVAL_FIELDS = readParserFields(parseBrowserRemoval, {
	name: 'search-cars',
	frameId: 'main',
})
/** Holds the external invocation fields the parser reads. */
export const WEBMCP_INVOCATION_FIELDS = readParserFields(parseBrowserInvocation, {
	invocationId: 'call',
	toolName: 'search-cars',
	frameId: 'main',
	input: '{}',
})
/** Holds the external result fields the parser reads, including its exception fallback. */
export const WEBMCP_RESULT_FIELDS = readParserFields(parseBrowserInvocationResult, {
	invocationId: 'call',
	status: 'Completed',
	output: 'cars',
	errorText: undefined,
	exception: { description: 'failure' },
})

/** Builds field rows from every property in a protocol type, retaining explicit exclusions.
 * @param name - Protocol type
 * @param fields - Fields the production parser read
 * @returns Ruled property comparisons
 */
export function buildDomainRows(
	name: string,
	fields: readonly string[],
): readonly ConformanceRow[] {
	return readDomainRecords(
		readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), name),
		'properties',
	).map((property): ConformanceRow => {
		const key = property['name']
		if (!isString(key)) throw new Error('Protocol property has no name')
		return key === 'stackTrace'
			? {
					symbol: `${name}.${key}`,
					expected: false,
					model: fields.includes(key),
					ruling: 'exclude',
					closer:
						'A developer diagnostics consumer; stackTrace is a developer datum excluded from the agent surface.',
				}
			: {
					symbol: `${name}.${key}`,
					expected: true,
					model: fields.includes(key),
					ruling: 'implement',
				}
	})
}

/** Rules every domain property against production parser reads. */
export const WEBMCP_DOMAIN_ROWS: readonly ConformanceRow[] = Object.freeze([
	...buildDomainRows('Tool', WEBMCP_TOOL_FIELDS),
	...buildDomainRows('Annotation', WEBMCP_ANNOTATION_FIELDS),
	...buildDomainRows('RemovedTool', WEBMCP_REMOVAL_FIELDS),
	...['enable', 'disable', 'invokeTool', 'cancelInvocation'].map((name): ConformanceRow => ({
		symbol: `command.${name}`,
		expected: name,
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'commands'), name)['name'],
		ruling: 'implement',
	})),
	...['toolsAdded', 'toolsRemoved', 'toolInvoked', 'toolResponded'].map((name): ConformanceRow => ({
		symbol: `event.${name}`,
		expected: name,
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'events'), name)['name'],
		ruling: 'implement',
	})),
	{
		symbol: 'InvocationStatus',
		expected: ['Completed', 'Canceled', 'Error'],
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')[
			'enum'
		],
		ruling: 'implement',
	},
	{
		symbol: 'invokeTool.invocationId ordering',
		expected: true,
		model: String(
			readDomainRecord(
				readDomainRecords(
					readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'commands'), 'invokeTool'),
					'returns',
				),
				'invocationId',
			)['description'],
		).includes('Response is sent before tool events.'),
		ruling: 'implement',
	},
	{
		symbol: 'toolResponded.output trust',
		expected: true,
		model: /untrusted/i.test(
			String(
				readDomainRecord(
					readDomainRecords(
						readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'events'), 'toolResponded'),
						'parameters',
					),
					'output',
				)['description'],
			),
		),
		ruling: 'implement',
	},
])

/** Holds source text decoded from verified bytes. */
export const WEBMCP_SOURCE = readMirrorText(WEBMCP_INDEX)
/** Holds IDL text decoded from verified bytes. */
export const WEBMCP_IDL = readMirrorText(WEBMCP_WEBREF)
/** Rules the specification's interface and annotation members. */
export const WEBMCP_SOURCE_ROWS: readonly ConformanceRow[] = Object.freeze([
	...[
		'registerTool',
		'getTools',
		'executeTool',
		'ontoolchange',
		'ontoolactivated',
		'ontoolcancel',
	].map((name): ConformanceRow => ({
		symbol: `index.ModelContext.${name}`,
		expected: true,
		model: readIDLBlock(WEBMCP_SOURCE, 'ModelContext').includes(name),
		ruling: 'implement',
	})),
	...['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'debugging'].map(
		(name): ConformanceRow => ({
			symbol: `index.ToolAnnotations.${name}`,
			expected: true,
			model: readIDLBlock(WEBMCP_SOURCE, 'ToolAnnotations').includes(`boolean ${name} = false;`),
			ruling: 'implement',
		}),
	),
	{
		symbol: 'index.executeTool return',
		expected: true,
		model: readIDLBlock(WEBMCP_SOURCE, 'ModelContext').includes('Promise<DOMString> executeTool('),
		ruling: 'implement',
	},
	{
		symbol: 'index.name validation',
		expected: true,
		model:
			/between 1 and 128, inclusive,[\s\S]*?ASCII alphanumeric[\s\S]*?code points[\s\S]*?U\+005F LOW LINE \(_\),\s*U\+002D HYPHEN-MINUS \(-\), and U\+002E FULL STOP \(\.\)/.test(
				WEBMCP_SOURCE,
			),
		ruling: 'implement',
	},
	{
		symbol: 'index.test suite',
		expected: true,
		model: /^Test Suite: https:\/\/wpt.fyi\/results\/webmcp$/m.test(WEBMCP_SOURCE),
		ruling: 'implement',
	},
	{
		symbol: 'BrowserToolAnnotation.autosubmit retained beyond source ToolAnnotations',
		expected: true,
		model:
			parseBrowserTool(WEBMCP_TOOL)?.annotation.autosubmit === true &&
			!readIDLBlock(WEBMCP_SOURCE, 'ToolAnnotations').includes('autosubmit'),
		ruling: 'retain',
		closer:
			'Retains the protocol annotation while the specification has no autosubmit hint; it emits no outline mark.',
	},
])
/** Rules webref's older interface against the package double. */
export const WEBMCP_WEBREF_ROWS: readonly ConformanceRow[] = Object.freeze([
	{
		symbol: 'webref.handlers',
		expected: ['ontoolchange'],
		model: [
			...readIDLBlock(WEBMCP_IDL, 'ModelContext').matchAll(/attribute EventHandler (\w+);/g),
		].map((match) => match[1]),
		ruling: 'implement',
	},
	{
		symbol: 'webref.hints',
		expected: ['readOnlyHint', 'untrustedContentHint', 'consequentialHint'],
		model: [...readIDLBlock(WEBMCP_IDL, 'ToolAnnotations').matchAll(/boolean (\w+)/g)].map(
			(match) => match[1],
		),
		ruling: 'implement',
	},
	...[
		...readIDLBlock(WEBMCP_IDL, 'ModelContext').matchAll(
			/\b(\w+)\(|attribute EventHandler (\w+);/g,
		),
	].map((match): ConformanceRow => ({
		symbol: `double.${match[1] ?? match[2]}`,
		expected: true,
		model: (match[1] ?? match[2] ?? '') in ModelContextRegistry.prototype,
		ruling: 'implement',
	})),
	...['ontoolactivated', 'ontoolcancel'].map((name): ConformanceRow => ({
		symbol: `double.${name} ahead of webref`,
		expected: true,
		model:
			name in ModelContextRegistry.prototype &&
			!readIDLBlock(WEBMCP_IDL, 'ModelContext').includes(name),
		ruling: 'retain',
		closer: 'Retains the specification source member while webref catches up.',
	})),
])
/** Records bounded gaps and the authority readings that support them. */
export const WEBMCP_GAPS: readonly ConformanceRow[] = Object.freeze([
	{
		symbol:
			'WPT cases remain outside the double: tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt at e6ba3d7abea7 lists 88 entries, including 55 under webmcp/imperative/ and 28 under webmcp/declarative/',
		expected: false,
		model: globSync('tests/**/webmcp/{imperative,declarative}/**/*.{js,html}').length > 0,
		ruling: 'exclude',
		closer:
			'A testharness runner under the Playwright provider must run these cases against the double.',
	},
	{
		symbol:
			'WPT directory provenance from tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt at e6ba3d7abea7',
		expected: { revision: true, entries: 88, imperative: 55, declarative: 28 },
		model: {
			revision: WEBMCP_WPT_LISTING.startsWith(
				'# wpt webmcp/ tree at e6ba3d7abea784a1f03347bccaad76e7a6347eae ',
			),
			entries: WEBMCP_WPT_ENTRIES.length,
			imperative: WEBMCP_WPT_ENTRIES.filter((path) => path.startsWith('webmcp/imperative/')).length,
			declarative: WEBMCP_WPT_ENTRIES.filter((path) => path.startsWith('webmcp/declarative/'))
				.length,
		},
		ruling: 'implement',
	},
	{
		symbol:
			'name charset and bound: provider ASCII alphanumerics _ - / 64; specification adds . / 128',
		expected: true,
		model:
			WEBMCP_SOURCE.includes('between 1 and 128, inclusive') &&
			WEBMCP_SOURCE.includes('U+002E FULL STOP (.)'),
		ruling: 'retain',
		closer:
			'Retains the provider charset and 64 bound documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts. The guide section Declared conformance gaps governs digest-pinned conformance and its refresh steps only.',
	},
	{
		symbol: 'declarative toolname, tooldescription, toolautosubmit ahead of source',
		expected: true,
		model:
			/<h3 id="declarative-api">[\s\S]*?This section is entirely a TODO/.test(WEBMCP_SOURCE) &&
			!/toolname|tooldescription|toolautosubmit/.test(WEBMCP_SOURCE),
		ruling: 'retain',
		closer: 'The specification declarative section; the mark follows the Chrome explainer.',
	},
	{
		symbol: 'webref lag: ontoolchange alone and three hints',
		expected: false,
		model:
			/ontoolactivated|ontoolcancel/.test(readIDLBlock(WEBMCP_IDL, 'ModelContext')) ||
			/debugging/.test(readIDLBlock(WEBMCP_IDL, 'ToolAnnotations')),
		ruling: 'exclude',
		closer: 'A webref extraction carrying the source handlers and debugging annotation.',
	},
])

/** Rules every terminal status the registry must settle. */
export const WEBMCP_STATUS_ROWS: readonly ConformanceRow[] = Object.freeze(
	['Completed', 'Canceled', 'Error'].map((symbol): ConformanceRow => ({
		symbol,
		expected: true,
		model:
			Array.isArray(
				readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')['enum'],
			) &&
			String(
				readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')['enum'],
			)
				.split(',')
				.includes(symbol),
		ruling: 'implement',
	})),
)
/** Rules annotations projected by the real registry adoption. */
export const WEBMCP_MAPPING_ROWS: readonly ConformanceOperationRow[] = Object.freeze([
	{
		symbol: 'readOnly false, consequential true, untrustedContent false',
		input: {
			...WEBMCP_TOOL,
			annotations: { readOnly: false, consequential: true, untrustedContent: false },
		},
		expected: { annotations: { pure: false, consequential: true, untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the package trust boundary: every page tool is untrusted, regardless of its hint.',
	},
	{
		symbol: 'readOnly true, consequential false, untrustedContent true',
		input: {
			...WEBMCP_TOOL,
			annotations: { readOnly: true, consequential: false, untrustedContent: true },
		},
		expected: { annotations: { pure: true, consequential: false, untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the package trust boundary: every page tool is untrusted, regardless of its hint.',
	},
	{
		symbol: 'omitted annotations',
		input: { name: 'search-cars', description: 'Search cars', frameId: 'main' },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains untrusted when the page supplies no annotations; absent behavioral hints stay absent.',
	},
	{
		symbol: 'omitted behavioral hints with untrustedContent true',
		input: { ...WEBMCP_TOOL, annotations: { untrustedContent: true } },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer: 'Retains untrusted without inventing pure or consequential hints.',
	},
	{
		symbol: 'omitted behavioral hints with untrustedContent false',
		input: { ...WEBMCP_TOOL, annotations: { untrustedContent: false } },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer: 'Retains untrusted without inventing pure or consequential hints.',
	},
	{
		symbol: 'autosubmit retained on the protocol tool without an adopted hint',
		input: { ...WEBMCP_TOOL, annotations: { autosubmit: true } },
		expected: { annotations: { untrusted: true }, autosubmit: true },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the protocol annotation on BrowserToolAnnotation without a tool hint or outline mark.',
	},
])
/** Rules tools excluded at the provider and debugging boundaries. */
export const WEBMCP_SKIP_ROWS: readonly ConformanceOperationRow[] = Object.freeze([
	{
		symbol: 'a.b',
		input: { ...WEBMCP_TOOL, name: 'a.b', annotations: {} },
		expected: { name: 'a.b', reason: 'pattern', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer:
			'Retains the provider charset documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts.',
	},
	{
		symbol: 'a'.repeat(65),
		input: { ...WEBMCP_TOOL, name: 'a'.repeat(65), annotations: {} },
		expected: { name: 'a'.repeat(65), reason: 'pattern', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer:
			'Retains the provider 64-character bound documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts.',
	},
	{
		symbol: 'debug',
		input: { ...WEBMCP_TOOL, name: 'debug', annotations: { debugging: true } },
		expected: { name: 'debug', reason: 'debugging', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer: 'Explicit developer-tool opt-in, outside the agent toolset.',
	},
])

/** Supplies the observations for the shared store contract. */
export const BROWSER_FILESYSTEM_STORE_CASES = Object.freeze<readonly BrowserFilesystemCase[]>([
	{
		title: 'retries a lock directory that vanishes after EEXIST and before readdir',
		async *run() {
			const { readdir } = await import('node:fs/promises')
			const scratch = createScratch()
			try {
				const lock = join(scratch.path, 'journey.lock')
				await mkdir(lock)
				const checks = new BrowserFixtureValue(0)
				const vanished = new BrowserFixtureValue(false)
				const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
					if (path !== lock) return
					checks.value += 1
					// The second check follows mkdir's EEXIST, immediately before reading the directory.
					if (checks.value !== 2) return
					await rmdir(lock)
					vanished.value = true
				})
				yield {
					comparison: 'identity',
					actual: await files.lock(lock, async () => 'entered'),
					expected: 'entered',
					message: 'vanished directory retries acquisition',
				}
				yield {
					comparison: 'identity',
					actual: vanished.value,
					expected: true,
				}
				yield {
					comparison: 'equal',
					actual: await readdir(scratch.path),
					expected: [],
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'refuses save when a second store saved the name between record and save',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const { BrowserToolset } = await import('@src/core')
			const { BrowserJourneyToolset } = await import('../src/core/BrowserJourneyToolset.js')
			const scratch = createScratch()
			const first = new FileBrowserJourneyStore({ root: scratch.path })
			const second = new FileBrowserJourneyStore({ root: scratch.path })
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store: first })
			try {
				await toolset.start()
				yield {
					comparison: 'object',
					actual: await toolset.tools.execute({
						id: '1',
						name: 'record',
						arguments: { journey: 'check-ready' },
					}),
					expected: { success: true },
				}
				const saved = await second.set(createBrowserJourneyFixture())
				await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
				yield {
					comparison: 'object',
					actual: await toolset.tools.execute({
						id: '2',
						name: 'save',
						arguments: { description: 'Replacement' },
					}),
					expected: {
						success: false,
						error: 'A journey named "check-ready" is saved; call journeys, or record another name.',
					},
				}
				yield {
					comparison: 'equal',
					actual: await first.get('check-ready'),
					expected: saved,
				}
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				scratch.destroy()
			}
		},
	},
	{
		title: 'skips non-journey names without faults or hiding journeys beyond the cap',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path, limit: 1 })
				await mkdir(join(scratch.path, '.profiles'))
				await mkdir(join(scratch.path, 'Not-a-journey'))
				for (const name of ['alpine', 'harbor'])
					await store.set(createBrowserJourneyFixture(undefined, { name }))
				const first = await store.list()
				const next = await store.list({ offset: first.entries.length })
				yield {
					comparison: 'equal',
					actual: first.faults,
					expected: [],
				}
				yield {
					comparison: 'equal',
					actual: next.faults,
					expected: [],
				}
				yield {
					comparison: 'identity',
					actual: first.truncated,
					expected: true,
				}
				yield {
					comparison: 'identity',
					actual: next.truncated,
					expected: false,
				}
				yield {
					comparison: 'equal',
					actual: [...first.entries, ...next.entries].map((entry) => entry.journey.name),
					expected: ['alpine', 'harbor'],
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'recovers a dead holder lock after refusing the live child',
		timeout: 15000,
		async *run() {
			const { readdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			scratch.write(
				'holder.ts',
				`
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { once } from 'node:events'
${SOURCE_HOOK}
const { FileBrowserStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserStore.ts')).href)
const files = new FileBrowserStore({ root: process.argv[2] })
await files.lock(resolve(process.argv[2], 'check-ready', 'journey.lock'), async () => {
	process.send?.('held')
	await once(process, 'message')
})
		`,
			)
			const child = spawnProcess(
				process.execPath,
				[join(scratch.path, 'holder.ts'), scratch.path],
				{ stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
			)
			try {
				const ready = await waitForEvent<[unknown]>(
					(listener) => {
						child.once('message', listener)
						return () => {
							child.off('message', listener)
						}
					},
					'child holds journey lock',
					{ budget: 10000 },
				)
				yield {
					comparison: 'identity',
					actual: ready[0],
					expected: 'held',
				}
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const lock = join(scratch.path, journey.name, 'journey.lock')
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([store.set(journey)]),
					expected: {
						code: 'STORE_LOCKED',
						message: `Journey is locked: ${lock}`,
					},
				}
				yield {
					comparison: 'equal',
					actual: (await readdir(lock)).map(parseBrowserLockEntry),
					expected: [child.pid],
				}
				const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
					(listener) => {
						child.once('exit', listener)
						return () => {
							child.off('exit', listener)
						}
					},
					'lock holder dies',
					{ budget: 10000 },
				)
				child.kill('SIGKILL')
				await exit
				yield {
					comparison: 'identity',
					actual: (await store.set(journey)).revision,
					expected: 1,
				}
				yield {
					comparison: 'object',
					actual: await store.get(journey.name),
					expected: { journey, revision: 1 },
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([readdir(lock)]),
					expected: { code: 'ENOENT' },
				}
			} finally {
				if (child.exitCode === null && child.signalCode === null) {
					const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
						(listener) => {
							child.once('exit', listener)
							return () => {
								child.off('exit', listener)
							}
						},
						'terminated lock holder',
						{ budget: 10000 },
					)
					child.kill('SIGKILL')
					await exit
				}
				scratch.destroy()
			}
		},
	},
	{
		title: 'admits exactly one of two processes that observed the same dead holder',
		timeout: 15000,
		async *run() {
			const { readdir } = await import('node:fs/promises')
			const scratch = createScratch()
			const children: ChildProcess[] = []
			try {
				const lock = join(scratch.path, 'journey.lock')
				const dead = formatBrowserLockEntry(
					readExitedProcessId(),
					'11111111-1111-4111-8111-111111111111',
				)
				await mkdir(lock)
				await writeFile(join(lock, dead), '')
				const script = scratch.write('recover.ts', BROWSER_LOCK_RECOVERER)
				while (children.length < 2)
					children.push(
						spawnProcess(process.execPath, [script, scratch.path, dead], {
							stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
						}),
					)
				yield {
					comparison: 'equal',
					actual: await Promise.all(children.map((child) => waitForBrowserChild(child))),
					expected: ['observed', 'observed'],
				}
				const [first, second] = children
				if (first === undefined || second === undefined) throw new Error('Missing recoverers')
				const entered = waitForBrowserChild(first)
				first.send('reclaim')
				yield {
					comparison: 'identity',
					actual: await entered,
					expected: 'entered',
				}
				const held = await readdir(lock)
				yield {
					comparison: 'equal',
					actual: held.map(parseBrowserLockEntry),
					expected: [first.pid],
				}
				const refused = waitForBrowserChild(second)
				second.send('reclaim')
				yield {
					comparison: 'identity',
					actual: await refused,
					expected: 'STORE_LOCKED',
					message: 'the second recoverer cannot enter while the first holds',
				}
				yield {
					comparison: 'equal',
					actual: await readdir(lock),
					expected: held,
					message: 'reclaim preserves the live winner',
				}
				const released = waitForBrowserChild(first)
				first.send('release')
				yield {
					comparison: 'identity',
					actual: await released,
					expected: 'released',
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([readdir(lock)]),
					expected: { code: 'ENOENT' },
				}
			} finally {
				await Promise.all(children.map((child) => stopBrowserChild(child)))
				scratch.destroy()
			}
		},
	},
	{
		title: 'prevents competing processes from both saving the same expected revision',
		timeout: 15000,
		async *run() {
			const { spawn } = await import('node:child_process')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			const children: ChildProcess[] = []
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await store.set(journey)
				scratch.write(
					'race.ts',
					`
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
${SOURCE_HOOK}
const { FileBrowserJourneyStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserJourneyStore.ts')).href)
const store = new FileBrowserJourneyStore({ root: process.argv[2] })
process.once('message', async (journey) => {
	try {
		const saved = await store.set(journey, { revision: 1 })
		process.send?.({ outcome: 'saved', revision: saved.revision })
	} catch (error) {
		process.send?.({ outcome: 'refused', code: error.code })
	} finally { process.disconnect?.() }
})
process.send?.({ outcome: 'ready' })
		`,
				)
				while (children.length < 2)
					children.push(
						spawn(process.execPath, [join(scratch.path, 'race.ts'), scratch.path], {
							stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
						}),
					)
				const exits = children.map((child) =>
					waitForEvent<[number | null, NodeJS.Signals | null]>(
						(listener) => {
							child.once('exit', listener)
							return () => {
								child.off('exit', listener)
							}
						},
						'file store child exits',
						{ budget: 10000 },
					),
				)
				const ready = await Promise.all(
					children.map((child) =>
						waitForEvent<[unknown]>(
							(listener) => {
								child.once('message', listener)
								return () => {
									child.off('message', listener)
								}
							},
							'file store child ready',
							{ budget: 10000 },
						),
					),
				)
				yield {
					comparison: 'equal',
					actual: ready.map((event) => event[0]),
					expected: [{ outcome: 'ready' }, { outcome: 'ready' }],
				}
				const answers = children.map((child) =>
					waitForEvent<[unknown]>(
						(listener) => {
							child.once('message', listener)
							return () => {
								child.off('message', listener)
							}
						},
						'file store child result',
						{ budget: 10000 },
					),
				)
				for (const child of children) child.send(journey)
				const results = (await Promise.all(answers)).map((event) => event[0])
				const saved = results.filter((value) => isRecord(value) && value['outcome'] === 'saved')
				yield {
					comparison: 'maximum',
					actual: saved.length,
					expected: 1,
				}
				yield {
					comparison: 'equal',
					actual: saved,
					expected: saved.map(() => ({ outcome: 'saved', revision: 2 })),
				}
				yield {
					comparison: 'length',
					actual: results.filter(
						(value) =>
							isRecord(value) &&
							value['outcome'] === 'refused' &&
							['STORE_LOCKED', 'JOURNEY_STALE'].includes(String(value['code'])),
					),
					expected: 2 - saved.length,
				}
				yield {
					comparison: 'equal',
					actual: await Promise.all(exits),
					expected: [
						[0, null],
						[0, null],
					],
				}
				yield {
					comparison: 'identity',
					actual: (await store.get(journey.name))?.revision,
					expected: 1 + saved.length,
				}
				// Publication can overlap and make both holders refuse. A later uncontended
				// write must still advance exactly once, then reject the stale expectation.
				yield {
					comparison: 'identity',
					actual: (await store.set(journey, { revision: 1 + saved.length })).revision,
					expected: 2 + saved.length,
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([store.set(journey, { revision: 1 + saved.length })]),
					expected: {
						code: 'JOURNEY_STALE',
					},
				}
			} finally {
				for (const child of children) {
					if (child.exitCode === null && child.signalCode === null) {
						const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
							(listener) => {
								child.once('exit', listener)
								return () => {
									child.off('exit', listener)
								}
							},
							'terminated file store child',
							{ budget: 10000 },
						)
						child.kill()
						await exit
					}
				}
				scratch.destroy()
			}
		},
	},
	{
		title: 'reopens journeys and runs from the same path',
		async *run() {
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const options = { root: scratch.path }
				const journeys = new FileBrowserJourneyStore(options)
				const runs = new FileBrowserRunStore(options)
				const journey = createBrowserJourneyFixture()
				const saved = await journeys.set(journey)
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
				await runs.set(run)
				yield {
					comparison: 'equal',
					actual: await new FileBrowserJourneyStore(options).get(journey.name),
					expected: saved,
				}
				yield {
					comparison: 'equal',
					actual: await new FileBrowserRunStore(options).get(run.journey.name, run.id),
					expected: run,
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'refuses corrupt files rather than returning absence',
		async *run() {
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const journeys = new FileBrowserJourneyStore({ root: scratch.path })
				const runs = new FileBrowserRunStore({ root: scratch.path })
				const saved = await journeys.set(createBrowserJourneyFixture())
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
				await runs.set(run)
				const journeyPath = join(scratch.path, saved.journey.name, 'journey.json')
				const runPath = join(scratch.path, run.journey.name, 'runs', run.id, 'run.json')
				for (const corrupt of [
					'',
					'{',
					'{bad json}',
					'{}',
					JSON.stringify({ revision: 1, journey: {} }),
					JSON.stringify({ format: 1, journey: {} }),
				]) {
					await writeFile(journeyPath, corrupt)
					await writeFile(runPath, corrupt)
					yield {
						comparison: 'path',
						actual: await Promise.allSettled([journeys.get(saved.journey.name)]),
						expected: { code: 'STORE_FILE', path: journeyPath },
					}
					yield {
						comparison: 'path',
						actual: await Promise.allSettled([runs.get(run.journey.name, run.id)]),
						expected: { code: 'STORE_FILE', path: runPath },
					}
				}
				await writeFile(
					journeyPath,
					JSON.stringify({ ...saved, journey: { ...saved.journey, format: 9 } }),
				)
				await writeFile(runPath, JSON.stringify({ ...run, format: 9 }))
				yield {
					comparison: 'path',
					actual: await Promise.allSettled([journeys.get(saved.journey.name)]),
					expected: { code: 'STORE_FORMAT', path: journeyPath },
				}
				yield {
					comparison: 'path',
					actual: await Promise.allSettled([runs.get(run.journey.name, run.id)]),
					expected: { code: 'STORE_FORMAT', path: runPath },
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'reports chmod 000 permission errors from a non-root child with the denied path',
		async *run() {
			yield {
				comparison: 'skip',
				actual: !supportsMode(),
				expected: 'supportsMode reports that chmod permission bits do not round-trip on this host',
			}
			const { chmod, stat } = await import('node:fs/promises')
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const root = process.getuid?.() === 0
			const account = root
				? readFileSync('/etc/passwd', 'utf8')
						.split(/\r\n|\n/)
						.find((line) => line.startsWith('nobody:'))
						?.split(':')
				: undefined
			if (root && account === undefined) {
				yield {
					comparison: 'skip',
					actual: true,
					expected: 'The nobody account is absent; root bypasses chmod 000 mode bits',
				}
				return
			}
			const uid = account === undefined ? undefined : Number(account[2])
			const gid = account === undefined ? undefined : Number(account[3])
			if (
				root &&
				(uid === undefined || uid <= 0 || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid))
			)
				throw new Error('The nobody account must have a non-root uid and an integer gid')
			const scratch = createScratch()
			try {
				const journeys = new FileBrowserJourneyStore({ root: scratch.path })
				const runs = new FileBrowserRunStore({ root: scratch.path })
				const saved = await journeys.set(createBrowserJourneyFixture())
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
				const paths = [
					join(scratch.path, saved.journey.name, 'journey.json'),
					join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs', slot.id, 'run.json'),
				]
				// The child must reach the files so denial measures file reads, not directory traversal.
				await chmod(scratch.path, 0o755)
				await chmod(join(scratch.path, saved.journey.name), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs'), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs', slot.id), 0o755)
				const control = scratch.write('read-control', 'readable')
				await chmod(control, 0o644)
				const script = scratch.write(
					'access.ts',
					`
import { strict as assert } from 'node:assert'
import { readFile, stat } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
${SOURCE_HOOK}
assert.notEqual(process.getuid?.(), 0)
const { FileBrowserJourneyStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserJourneyStore.ts')).href)
const { FileBrowserRunStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserRunStore.ts')).href)
const [root, journey, run, id] = process.argv.slice(2)
assert.equal(await readFile(join(root, 'read-control'), 'utf8'), 'readable')
const journeys = new FileBrowserJourneyStore({ root })
const runs = new FileBrowserRunStore({ root })
for (const path of [join(root, journey, 'journey.json'), join(root, run, 'runs', id, 'run.json')]) {
	assert.equal((await stat(path)).mode & 0o777, 0)
	await assert.rejects(readFile(path), { code: 'EACCES' })
}
const outcomes = await Promise.allSettled([journeys.get(journey), runs.get(run, id)])
console.log(JSON.stringify({
	uid: process.getuid?.(), gid: process.getgid?.(),
	outcomes: outcomes.map((outcome) => outcome.status === 'rejected'
		? { status: outcome.status, code: outcome.reason.code, message: outcome.reason.message }
		: { status: outcome.status })
}))
		`,
				)
				await chmod(script, 0o644)
				for (const path of paths) {
					yield {
						comparison: 'defined',
						actual: parseJSON(readFileSync(path, 'utf8')),
					}
					await chmod(path, 0)
					yield {
						comparison: 'identity',
						actual: (await stat(path)).mode & 0o777,
						expected: 0,
					}
				}
				try {
					const child = spawnSync(
						process.execPath,
						[script, scratch.path, saved.journey.name, BROWSER_RUN_FIXTURE.journey.name, slot.id],
						{ uid, gid, encoding: 'utf8', timeout: 10000 },
					)
					yield {
						comparison: 'undefined',
						actual: child.error,
					}
					yield {
						comparison: 'equal',
						actual: { status: child.status, stderr: child.stderr },
						expected: { status: 0, stderr: '' },
					}
					yield {
						comparison: 'access',
						actual: parseJSON(child.stdout),
						expected: { uid: uid ?? process.getuid?.(), gid: gid ?? process.getgid?.(), paths },
					}
				} finally {
					for (const path of paths) await chmod(path, 0o600)
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'allows one exclusive creator across independent file store instances',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const first = new FileBrowserJourneyStore({ root: scratch.path })
				const second = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const results = await Promise.allSettled([
					first.set(journey, { exclusive: true }),
					second.set({ ...journey, description: 'Second' }, { exclusive: true }),
				])
				yield {
					comparison: 'length',
					actual: results.filter((result) => result.status === 'fulfilled'),
					expected: 1,
				}
				yield {
					comparison: 'length',
					actual: results.filter((result) => result.status === 'rejected'),
					expected: 1,
				}
				yield {
					comparison: 'identity',
					actual: (await first.get(journey.name))?.revision,
					expected: 1,
				}
				yield {
					comparison: 'equal',
					actual: await first.get(journey.name),
					expected: await second.get(journey.name),
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'refuses a lost update across instances and preserves revisions after deletion',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const first = new FileBrowserJourneyStore({ root: scratch.path })
				const second = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await first.set(journey)
				const outcomes = await Promise.allSettled([
					first.set({ ...journey, description: 'First' }, { revision: 1 }),
					second.set({ ...journey, description: 'Second' }, { revision: 1 }),
				])
				yield {
					comparison: 'length',
					actual: outcomes.filter((outcome) => outcome.status === 'fulfilled'),
					expected: 1,
				}
				yield {
					comparison: 'length',
					actual: outcomes.filter((outcome) => outcome.status === 'rejected'),
					expected: 1,
				}
				yield {
					comparison: 'identity',
					actual: (await first.get(journey.name))?.revision,
					expected: 2,
				}
				await second.delete(journey.name)
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([first.set(journey, { revision: 2 })]),
					expected: {
						code: 'JOURNEY_STALE',
					},
				}
				yield {
					comparison: 'identity',
					actual: (await second.set(journey)).revision,
					expected: 3,
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([first.set(journey, { revision: 2 })]),
					expected: {
						code: 'JOURNEY_STALE',
					},
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'refuses a held lock before reading the expected revision',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await store.set(journey)
				const lock = join(scratch.path, journey.name, 'journey.lock')
				await mkdir(lock)
				const entry = join(
					lock,
					formatBrowserLockEntry(process.pid, '11111111-1111-4111-8111-111111111111'),
				)
				await writeFile(entry, '')
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([store.set(journey, { exclusive: true })]),
					expected: {
						code: 'STORE_LOCKED',
					},
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([store.delete(journey.name)]),
					expected: {
						code: 'STORE_LOCKED',
					},
				}
				await unlink(entry)
				await rmdir(lock)
				yield {
					comparison: 'identity',
					actual: (await store.set(journey, { revision: 1 })).revision,
					expected: 2,
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'keeps the previous revision and removes temporary files after a failed write',
		async *run() {
			const { readdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const saved = await store.set(journey)
				const revision = join(scratch.path, journey.name, 'revision')
				// A real directory at the counter path refuses the replacement before any data is lost.
				await unlink(revision)
				await mkdir(revision)
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([
						store.set({ ...journey, description: 'Uncommitted' }, { revision: 1 }),
					]),
					expected: { code: 'STORE_FILE' },
				}
				yield {
					comparison: 'equal',
					actual: await store.get(journey.name),
					expected: saved,
				}
				yield {
					comparison: 'equal',
					actual: (await readdir(join(scratch.path, journey.name))).sort(),
					expected: ['journey.json', 'revision'],
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'pages sorted readable journeys with a cap, truncation, and faults',
		async *run() {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path, limit: 1 })
				for (const name of ['zebra', 'broken', 'alpine', 'harbor'])
					await store.set(createBrowserJourneyFixture(undefined, { name }))
				await writeFile(join(scratch.path, 'broken', 'journey.json'), '{')
				const first = await store.list({ limit: 999 })
				yield {
					comparison: 'equal',
					actual: first.entries.map((entry) => entry.journey.name),
					expected: ['alpine'],
				}
				yield {
					comparison: 'identity',
					actual: first.truncated,
					expected: true,
				}
				yield {
					comparison: 'equal',
					actual: first.faults,
					expected: [{ name: 'broken', reason: 'Malformed journey revision' }],
				}
				const next = await store.list({ offset: 1 })
				yield {
					comparison: 'equal',
					actual: next.entries.map((entry) => entry.journey.name),
					expected: ['harbor'],
				}
				yield {
					comparison: 'identity',
					actual: next.truncated,
					expected: true,
				}
				yield {
					comparison: 'identity',
					actual: (await store.list({ offset: 2 })).truncated,
					expected: false,
				}
			} finally {
				scratch.destroy()
			}
		},
	},
	{
		title: 'refuses reserved and escaping names before filesystem access',
		async *run() {
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			const journeys = new FileBrowserJourneyStore({ root: scratch.path })
			const runs = new FileBrowserRunStore({ root: scratch.path })
			scratch.destroy()
			for (const name of ['con', 'aux', 'com1', 'lpt9', '../escape', 'two/parts', 'UPPER']) {
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([journeys.get(name)]),
					expected: { code: 'STORE_PATH' },
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([
						journeys.set(createBrowserJourneyFixture([], { name })),
					]),
					expected: { code: 'STORE_PATH' },
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([journeys.delete(name)]),
					expected: { code: 'STORE_PATH' },
				}
				yield {
					comparison: 'rejected',
					actual: await Promise.allSettled([runs.create(name)]),
					expected: { code: 'STORE_PATH' },
				}
			}
		},
	},
])
